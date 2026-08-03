/**
 * Polite fetching: identifies itself, retries with backoff, and caches raw responses
 * to disk so parsing can be re-run without re-fetching (CLAUDE.md scraping principles).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const CACHE_DIR = resolve(process.env.JT_DATA_DIR ?? resolve(process.cwd(), 'data'), 'cache');
const UA = 'job-tracker/0.1 (personal job search aggregator)';

export interface FetchOptions {
  /** Serve from cache when the cached copy is younger than this. 0 disables. */
  maxAgeMs?: number;
  retries?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  /**
   * The URL to actually request, when it differs from the cache key. POST endpoints
   * (Workday) return different results for the same URL depending on the body, so
   * callers pass a body-qualified cache key as `url` and the real endpoint here.
   */
  realUrl?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cachePath(url: string): string {
  return resolve(CACHE_DIR, `${createHash('sha256').update(url).digest('hex').slice(0, 20)}.txt`);
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const { retries = 3, timeoutMs = 20_000, headers = {}, method, body, realUrl } = opts;
  const target = realUrl ?? url;
  // JT_NO_CACHE (set by `npm run scrape -- --no-cache`) forces a fresh fetch.
  const maxAgeMs = process.env.JT_NO_CACHE ? 0 : opts.maxAgeMs ?? 30 * 60 * 1000;

  const cached = cachePath(url);
  if (maxAgeMs > 0 && existsSync(cached) && Date.now() - statSync(cached).mtimeMs < maxAgeMs) {
    return readFileSync(cached, 'utf8');
  }

  let lastErr: unknown;
  /** Set from a 429's Retry-After, so the next wait is what the server asked for. */
  let retryAfterMs = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
      await sleep(Math.max(backoff, retryAfterMs));
      retryAfterMs = 0;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(target, {
        method: method ?? 'GET',
        body,
        headers: { 'user-agent': UA, accept: '*/*', ...headers },
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      // Back off and retry on rate limit / transient server errors.
      if (res.status === 429 || res.status >= 500) {
        // Greenhouse and Workday both answer 429 with Retry-After; obeying it beats
        // guessing, and a server that has to repeat itself is one that starts blocking.
        const retryAfter = res.headers.get('retry-after');
        if (retryAfter) {
          const seconds = Number(retryAfter);
          // The header is either a delay in seconds or an HTTP date.
          const ms = Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(retryAfter) - Date.now();
          // Cap it: a server asking for an hour shouldn't stall the whole run.
          if (ms > 0) retryAfterMs = Math.min(ms, 60_000);
        }
        lastErr = new Error(`HTTP ${res.status} for ${target}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${target}`);

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
