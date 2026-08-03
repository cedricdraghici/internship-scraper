/**
 * Deployment entrypoint: serves the dashboard and refreshes it on a schedule.
 *
 * Locally you run `npm run scrape` and `npm run web` separately. On a host there's no
 * one to run the scrape, so this does both in one process — a cron container would
 * cost a second machine for a job that takes ~30 seconds a day.
 *
 *   JT_SCRAPE_INTERVAL_HOURS   how often to refresh (default 12, 0 disables)
 *   JT_SCRAPE_ON_BOOT          run one scrape at startup (default yes)
 */

import { allAdapters, runScrape } from './scrape.js';

const INTERVAL_HOURS = Number(process.env.JT_SCRAPE_INTERVAL_HOURS ?? 12);
const SCRAPE_ON_BOOT = process.env.JT_SCRAPE_ON_BOOT !== '0';

async function scrapeSafely(): Promise<void> {
  try {
    await runScrape(allAdapters());
  } catch (err) {
    // Never let a failed scrape take down the web server — a stale board still
    // beats no board.
    console.error('scrape failed:', err instanceof Error ? err.message : String(err));
  }
}

// Start the server first so the dashboard answers immediately; the boot scrape then
// runs in the background rather than delaying startup past a health check.
await import('./web/server.js');

if (SCRAPE_ON_BOOT) void scrapeSafely();

if (INTERVAL_HOURS > 0) {
  const ms = INTERVAL_HOURS * 60 * 60 * 1000;
  setInterval(() => void scrapeSafely(), ms);
  console.log(`scheduler → scraping every ${INTERVAL_HOURS}h`);
}
