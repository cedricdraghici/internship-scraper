/**
 * Polite fetching: identifies itself, retries with backoff, and caches raw responses
 * to disk so parsing can be re-run without re-fetching (CLAUDE.md scraping principles).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const CACHE_DIR = resolve(process.cwd(), 'data/cache');
const UA = 'job-tracker/0.1 (personal job search aggregator)';

export interface FetchOptions {
  /** Serve from cache when the cached copy is younger than this. 0 disables. */
  maxAgeMs?: number;
  retries?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cachePath(url: string): string {
  return resolve(CACHE_DIR, `${createHash('sha256').update(url).digest('hex').slice(0, 20)}.txt`);
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const { retries = 3, timeoutMs = 20_000, headers = {} } = opts;
  // JT_NO_CACHE (set by `npm run scrape -- --no-cache`) forces a fresh fetch.
  const maxAgeMs = process.env.JT_NO_CACHE ? 0 : opts.maxAgeMs ?? 30 * 60 * 1000;

  const cached = cachePath(url);
  if (maxAgeMs > 0 && existsSync(cached) && Date.now() - statSync(cached).mtimeMs < maxAgeMs) {
    return readFileSync(cached, 'utf8');
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: '*/*', ...headers },
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      // Back off and retry on rate limit / transient server errors.
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

      const text = await res.text();
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cached, text, 'utf8');
      return text;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T = unknown>(url: string, opts?: FetchOptions): Promise<T> {
  return JSON.parse(await fetchText(url, { ...opts, headers: { accept: 'application/json', ...opts?.headers } })) as T;
}
