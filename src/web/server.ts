/**
 * Local dashboard. Reads only from SQLite, never live-scrapes (CLAUDE.md).
 *
 *   npm run web   ->  http://localhost:4000
 */

import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb, setStatus } from '../lib/db.js';
import type { JobStatus } from '../types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4000);
const VALID_STATUS: JobStatus[] = ['new', 'applied', 'interview', 'rejected', 'offer'];

interface JobRow {
  id: string; title: string; company: string; location: string; province: string | null;
  remote: number; url: string; source: string; sources: string; posted_at: string | null;
  first_seen_at: string; salary_raw: string | null; type: string | null;
  role_category: string | null; matched_by: string | null; canada_confidence: string;
  canada_matched_by: string | null; status: string;
}

const db = openDb();

function queryJobs(params: URLSearchParams): JobRow[] {
  const where: string[] = [];
  const args: Array<string | number> = [];

  const q = params.get('q')?.trim();
  if (q) {
    where.push('(title LIKE ? OR company LIKE ? OR location LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  for (const [param, col] of [['source', 'source'], ['province', 'province'],
                              ['category', 'role_category'],
                              ['status', 'status']] as const) {
    const v = params.get(param);
    if (v) {
      where.push(`${col} = ?`);
      args.push(v);
    }
  }

  // `type=students` is a grouping, not a stored value: internships arrive labelled
  // either intern or co-op depending on the employer's wording, and they're the same
  // thing to the person job-hunting. Everything else is an exact match.
  const type = params.get('type');
  if (type === 'students') {
    where.push("type IN ('intern', 'co-op')");
  } else if (type) {
    where.push('type = ?');
    args.push(type);
  }
  if (params.get('remote') === '1') where.push('remote = 1');
  if (params.get('confirmed') === '1') where.push("canada_confidence = 'confirmed'");
  // Sort by real posting date. Postings with no date sort last in both directions
  // rather than inheriting the scrape timestamp, ~a third of rows come from repos
  // with no date column, and letting them borrow "today" pushed them above genuinely
  // recent postings and made "newest" useless.
  // Drop stale postings. Most are long closed, and an internship posted a year ago is
  // noise regardless. Sources with no date are kept: `posted_at` is null for a third
  // of rows, so filtering on it would discard them all.
  const maxAgeDays = Number(params.get('max_age_days') ?? 30);
  if (Number.isFinite(maxAgeDays) && maxAgeDays > 0) {
    where.push(`(posted_at IS NULL OR posted_at >= datetime('now', ?))`);
    args.push(`-${Math.floor(maxAgeDays)} days`);
  }

  const dir = params.get('sort') === 'oldest' ? 'ASC' : 'DESC';
  // Name the columns rather than SELECT *: `description` alone is ~32KB across the
  // table and the dashboard never renders it, so it was a third of every response.
  const sql = `SELECT id, title, company, location, province, remote, url, source,
                      sources, posted_at, first_seen_at, salary_raw, type,
                      role_category, matched_by, canada_confidence, canada_matched_by,
                      status
               FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY COALESCE(posted_at, first_seen_at) ${dir}, company ASC
               LIMIT 500`;
  return db.prepare(sql).all(...args) as unknown as JobRow[];
}

/**
 * Facet counts are the same for every visitor and change only when a scrape writes,
 * but computing them runs five GROUP BY queries over the whole table. On a shared CPU
 * that competes with the scrape running in this same process, so cache them briefly.
 */
let facetCache: { at: number; value: ReturnType<typeof computeFacets> } | null = null;
const FACET_TTL_MS = 30_000;

function facets(): ReturnType<typeof computeFacets> {
  const now = Date.now();
  if (facetCache && now - facetCache.at < FACET_TTL_MS) return facetCache.value;
  const value = computeFacets();
  facetCache = { at: now, value };
  return value;
}

function computeFacets() {
  const col = (c: string) =>
    (db.prepare(`SELECT ${c} AS v, COUNT(*) AS n FROM jobs WHERE ${c} IS NOT NULL AND ${c} != ''
                 GROUP BY ${c} ORDER BY n DESC`).all() as unknown as Array<{ v: string; n: number }>);
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    sources: col('source'),
    provinces: col('province'),
    categories: col('role_category'),
    // Only intern and co-op exist in the db, the scrape drops everything else, so
    // this is a sub-filter between the two, not a way to reach other job types.
    types: col('type'),
    statuses: col('status'),
    total: one('SELECT COUNT(*) AS n FROM jobs'),
    fresh: one("SELECT COUNT(*) AS n FROM jobs WHERE status = 'new'"),
    runs: db.prepare(`SELECT source, ok, kept, inserted, started_at, error FROM runs
                      WHERE id IN (SELECT MAX(id) FROM runs GROUP BY source)
                      ORDER BY source`).all() as unknown as Array<{
                        source: string; ok: number; kept: number; inserted: number;
                        started_at: string; error: string | null }>,
  };
}

/**
 * Failed-login throttle.
 *
 * Basic auth has no lockout of its own, so without this an attacker can guess
 * passwords as fast as the network allows. Only *failures* are counted, a valid
 * session browses freely no matter how many requests it makes.
 */
const MAX_FAILURES = Number(process.env.JT_MAX_FAILURES ?? 10);
const LOCKOUT_MS = Number(process.env.JT_LOCKOUT_MINUTES ?? 15) * 60_000;
/** Cap on tracked IPs, so a spray across many addresses can't exhaust memory. */
const MAX_TRACKED_IPS = 10_000;

const failures = new Map<string, { count: number; until: number }>();

/**
 * The client's address, as reported by the Fly proxy.
 *
 * `fly-client-ip` is set by the proxy itself and cannot be spoofed by the caller;
 * trusting `x-forwarded-for` instead would let anyone reset their own counter by
 * forging a header. Falls back to the socket address when running locally.
 */
function clientIp(req: IncomingMessage): string {
  const flyIp = req.headers['fly-client-ip'];
  if (typeof flyIp === 'string' && flyIp) return flyIp;
  return req.socket.remoteAddress ?? 'unknown';
}

/** Milliseconds remaining on a lockout, or 0 when the caller may try again. */
function lockedFor(ip: string, now = Date.now()): number {
  const entry = failures.get(ip);
  if (!entry) return 0;
  if (entry.until <= now) {
    failures.delete(ip);
    return 0;
  }
  return entry.count >= MAX_FAILURES ? entry.until - now : 0;
}

function recordFailure(ip: string, now = Date.now()): void {
  // Opportunistically drop expired entries before growing the map.
  if (failures.size >= MAX_TRACKED_IPS) {
    for (const [key, entry] of failures) if (entry.until <= now) failures.delete(key);
    if (failures.size >= MAX_TRACKED_IPS) return; // still full: stop tracking new IPs
  }
  const entry = failures.get(ip);
  // The window slides: each failure pushes the unlock time back out.
  failures.set(ip, { count: (entry?.count ?? 0) + 1, until: now + LOCKOUT_MS });
}

/**
 * Basic auth, enabled only when JT_PASSWORD is set.
 *
 * Locally the variable is unset and the dashboard stays open, exactly as before.
 * On a public host it is set, and this is what keeps the board private, it holds
 * personal application tracking, so it should never be world-readable.
 */
function authorized(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const expected = process.env.JT_PASSWORD;
  if (!expected) return true;

  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const supplied = decoded.slice(decoded.indexOf(':') + 1);

  // Constant-time compare so the password can't be recovered by timing responses.
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (process.env.JT_PASSWORD) {
    const ip = clientIp(req);
    const ok = authorized(req);

    if (ok) {
      // Check the password before the lockout, so this is one user's own board and a
      // burst of typos can't shut them out of it. An attacker gains nothing: being
      // let through already required the right password.
      failures.delete(ip);
    } else {
      const waitMs = lockedFor(ip);
      if (waitMs > 0) {
        const seconds = Math.ceil(waitMs / 1000);
        res.writeHead(429, { 'retry-after': String(seconds), 'content-type': 'text/plain' });
        res.end(`Too many failed attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`);
        return;
      }
      recordFailure(ip);
      res.writeHead(401, {
        'www-authenticate': 'Basic realm="Job Tracker", charset="UTF-8"',
        'content-type': 'text/plain',
      });
      res.end('Authentication required');
      return;
    }
  }

  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(join(HERE, 'index.html'), 'utf8'));
      return;
    }

    if (url.pathname === '/api/jobs') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jobs: queryJobs(url.searchParams), facets: facets() }));
      return;
    }

    if (url.pathname === '/api/status' && req.method === 'POST') {
      const body = await new Promise<string>((resolve, reject) => {
        let d = '';
        req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
        req.on('end', () => resolve(d));
        req.on('error', reject);
      });
      const { id, status } = JSON.parse(body) as { id?: string; status?: string };
      if (!id || !status || !VALID_STATUS.includes(status as JobStatus)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'id and a valid status are required' }));
        return;
      }
      setStatus(db, id, status as JobStatus);
      // Marking a job changes the unreviewed count, so don't serve a stale one back.
      facetCache = null;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// 0.0.0.0 so the process is reachable from outside its container when deployed;
// locally this behaves the same as binding localhost.
server.listen(PORT, '0.0.0.0', () => {
  const { total, fresh } = facets();
  const lock = process.env.JT_PASSWORD ? ' [password protected]' : '';
  console.log(`job-tracker → http://localhost:${PORT}  (${total} jobs, ${fresh} unreviewed)${lock}`);
});
