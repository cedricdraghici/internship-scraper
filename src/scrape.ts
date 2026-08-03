/**
 * Scrape runner. Runs every adapter, isolating failures so one dead source never
 * takes down the run, and records per-source outcomes in the `runs` table.
 *
 *   npm run scrape                 # all sources
 *   npm run scrape -- github       # only named sources
 *   npm run scrape -- --no-cache   # bypass the response cache
 */

import type { Adapter, SourceResult } from './types.js';
import { openDb, upsertJobs, recordRun } from './lib/db.js';
import { normalize } from './lib/normalize.js';
import { githubAdapter } from './adapters/github-md.js';
import { greenhouseAdapter, leverAdapter } from './adapters/ats.js';
import { jobBankAdapter } from './adapters/jobbank.js';

export function allAdapters(): Adapter[] {
  return [githubAdapter(), greenhouseAdapter(), leverAdapter(), jobBankAdapter()];
}

export async function runScrape(adapters: Adapter[]): Promise<SourceResult[]> {
  const db = openDb();
  const results: SourceResult[] = [];

  for (const adapter of adapters) {
    const started = Date.now();
    try {
      const raw = await adapter.fetch();
      const { keptJobs, droppedNotCanada, droppedNotRole } = normalize(raw);
      const { inserted, updated } = upsertJobs(db, keptJobs);
      const r: SourceResult = {
        source: adapter.name,
        ok: true,
        fetched: raw.length,
        kept: keptJobs.length,
        inserted,
        updated,
        ms: Date.now() - started,
      };
      results.push(r);
      recordRun(db, r);
      console.log(
        `✓ ${adapter.name.padEnd(11)} fetched ${String(raw.length).padStart(5)}  ` +
        `kept ${String(keptJobs.length).padStart(4)}  new ${String(inserted).padStart(4)}  ` +
        `seen-again ${String(updated).padStart(4)}  ` +
        `(dropped: ${droppedNotCanada} non-CA, ${droppedNotRole} off-role)  ${r.ms}ms`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const r: SourceResult = {
        source: adapter.name, ok: false, fetched: 0, kept: 0, inserted: 0, updated: 0,
        ms: Date.now() - started, error: msg,
      };
      results.push(r);
      recordRun(db, r);
      console.error(`✗ ${adapter.name.padEnd(11)} FAILED: ${msg.slice(0, 200)}`);
    }
  }

  const total = db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
  const fresh = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'new'").get() as { n: number };
  const okCount = results.filter((r) => r.ok).length;
  console.log(
    `\n${okCount}/${results.length} sources ok — ${total.n} jobs in db, ${fresh.n} unreviewed`,
  );
  db.close();
  return results;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '');
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (process.argv.includes('--no-cache')) process.env.JT_NO_CACHE = '1';
  const adapters = args.length
    ? allAdapters().filter((a) => args.includes(a.name))
    : allAdapters();

  if (adapters.length === 0) {
    console.error(`No matching sources. Available: ${allAdapters().map((a) => a.name).join(', ')}`);
    process.exit(1);
  }
  await runScrape(adapters);
}
