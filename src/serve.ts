/**
 * Deployment entrypoint: serves the dashboard and refreshes it on a schedule.
 *
 * Locally you run `npm run scrape` and `npm run web` separately. On a host there's no
 * one to run the scrape, so this does both in one process — a cron container would
 * cost a second machine for a job that takes seconds.
 *
 * Two schedules, because the sources differ by two orders of magnitude in cost:
 *
 *   JT_FAST_INTERVAL_MINUTES   GitHub/Simplify/Greenhouse/Lever/Ashby — ~10s per run,
 *                              and the source of nearly every posting (default 5,
 *                              matching GitHub's own 300s cache-control)
 *   JT_SLOW_INTERVAL_MINUTES   Workday — ~106s per run for ~11 jobs (default 30)
 *   JT_SCRAPE_ON_BOOT          run both once at startup (default yes)
 */

import { fastAdapters, slowAdapters, runScrape } from './scrape.js';
import type { Adapter } from './types.js';

const FAST_MINUTES = Number(process.env.JT_FAST_INTERVAL_MINUTES ?? 5);
const SLOW_MINUTES = Number(process.env.JT_SLOW_INTERVAL_MINUTES ?? 30);
const SCRAPE_ON_BOOT = process.env.JT_SCRAPE_ON_BOOT !== '0';

/** Guards per group, so a slow Workday run never blocks a fast one. */
const running = new Set<string>();

async function scrapeSafely(label: string, adapters: Adapter[]): Promise<void> {
  // Skip rather than stack: if a run is still going when the next tick fires,
  // overlapping runs would hammer the same endpoints concurrently.
  if (running.has(label)) {
    console.log(`${label} scrape already in progress — skipping this tick`);
    return;
  }
  running.add(label);
  try {
    await runScrape(adapters);
  } catch (err) {
    // Never let a failed scrape take down the web server — a stale board still
    // beats no board.
    console.error(`${label} scrape failed:`, err instanceof Error ? err.message : String(err));
  } finally {
    running.delete(label);
  }
}

// Start the server first so the dashboard answers immediately; the boot scrape then
// runs in the background rather than delaying startup past a health check.
await import('./web/server.js');

if (SCRAPE_ON_BOOT) {
  void scrapeSafely('fast', fastAdapters());
  void scrapeSafely('slow', slowAdapters());
}

if (FAST_MINUTES > 0) {
  setInterval(() => void scrapeSafely('fast', fastAdapters()), FAST_MINUTES * 60_000);
  console.log(`scheduler → fast sources every ${FAST_MINUTES}m`);
}

if (SLOW_MINUTES > 0) {
  setInterval(() => void scrapeSafely('slow', slowAdapters()), SLOW_MINUTES * 60_000);
  console.log(`scheduler → workday every ${SLOW_MINUTES}m`);
}
