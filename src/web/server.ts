/**
 * Local dashboard. Reads only from SQLite — never live-scrapes (CLAUDE.md).
 *
 *   npm run web   ->  http://localhost:4000
 */

import { createServer } from 'node:http';
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
  // rather than inheriting the scrape timestamp — ~a third of rows come from repos
  // with no date column, and letting them borrow "today" pushed them above genuinely
  // recent postings and made "newest" useless.
  const dir = params.get('sort') === 'oldest' ? 'ASC' : 'DESC';
  const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY (posted_at IS NULL) ASC, posted_at ${dir},
                        first_seen_at DESC, company ASC LIMIT 500`;
  return db.prepare(sql).all(...args) as unknown as JobRow[];
}

function facets() {
  const col = (c: string) =>
    (db.prepare(`SELECT ${c} AS v, COUNT(*) AS n FROM jobs WHERE ${c} IS NOT NULL AND ${c} != ''
                 GROUP BY ${c} ORDER BY n DESC`).all() as unknown as Array<{ v: string; n: number }>);
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    sources: col('source'),
    provinces: col('province'),
    categories: col('role_category'),
    // Only intern and co-op exist in the db — the scrape drops everything else — so
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
 * Basic auth, enabled only when JT_PASSWORD is set.
 *
 * Locally the variable is unset and the dashboard stays open, exactly as before.
 * On a public host it is set, and this is what keeps the board private — it holds
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

  if (!authorized(req)) {
    res.writeHead(401, {
      'www-authenticate': 'Basic realm="Job Tracker", charset="UTF-8"',
      'content-type': 'text/plain',
    });
    res.end('Authentication required');
    return;
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
