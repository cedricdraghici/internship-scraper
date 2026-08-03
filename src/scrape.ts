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
import { notifyNewJobs } from './lib/notify.js';
import { githubAdapter } from './adapters/github-md.js';
import { greenhouseAdapter, leverAdapter } from './adapters/ats.js';
import { jobBankAdapter } from './adapters/jobbank.js';
import { workdayAdapter } from './adapters/workday.js';
import { ashbyAdapter } from './adapters/ashby.js';
import { simplifyAdapter } from './adapters/simplify.js';

/**
 * Sources cheap enough to poll often, the whole group finishes in ~10 seconds and
 * supplies almost every posting (GitHub alone is 236 of 292).
 */
export function fastAdapters(): Adapter[] {
  return [
    githubAdapter(),
    simplifyAdapter(),
    greenhouseAdapter(),
    leverAdapter(),
    ashbyAdapter(),
  ];
}

/**
 * Sources worth polling rarely. Workday takes ~106s uncached, 90% of a full run -
 * because it searches 16 tenants for 7 terms apiece, and yields ~11 jobs. Employer
 * boards also change far more slowly than the curated lists do.
 */
export function slowAdapters(): Adapter[] {
  return [workdayAdapter()];
}

/** Sources that run by default, fastest first. */
export function allAdapters(): Adapter[] {
  return [...fastAdapters(), ...slowAdapters()];
}

/**
 * Opt-in sources, `npm run scrape -- jobbank`.
 *
 * Job Bank costs ~100s per run (robots.txt `Crawl-delay: 5` × 15 requests) and, since
 * the tracker went internships-only, contributes nothing: its listings are titled with
 * NOC occupation names, so no title ever says "intern". Kept working and reachable by
 * name in case that changes, but off the default path.
 */
export function optionalAdapters(): Adapter[] {
  return [jobBankAdapter()];
}

export async function runScrape(adapters: Adapter[]): Promise<SourceResult[]> {
  const db = openDb();
  const results: SourceResult[] = [];

  for (const adapter of adapters) {
    const started = Date.now();
    try {
      const raw = await adapter.fetch();
      const { keptJobs, droppedNotCanada, droppedNotRole, droppedNotStudent } = normalize(raw);
      const { inserted, updated, newJobs } = upsertJobs(db, keptJobs);
      // Push before the next adapter runs, so an alert lands as soon as its posting does.
      await notifyNewJobs(newJobs);
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
        `(dropped: ${droppedNotStudent} non-intern, ${droppedNotCanada} non-CA, ${droppedNotRole} off-role)  ${r.ms}ms`,
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
    `\n${okCount}/${results.length} sources ok, ${total.n} jobs in db, ${fresh.n} unreviewed`,
  );
  db.close();
  return results;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '');
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (process.argv.includes('--no-cache')) process.env.JT_NO_CACHE = '1';
  // Named sources may include the opt-in ones; a bare run uses the defaults.
  const adapters = args.length
    ? [...allAdapters(), ...optionalAdapters()].filter((a) => args.includes(a.name))
    : allAdapters();

  if (adapters.length === 0) {
    const names = [...allAdapters(), ...optionalAdapters()].map((a) => a.name).join(', ');
    console.error(`No matching sources. Available: ${names}`);
    process.exit(1);
  }
  await runScrape(adapters);
}
