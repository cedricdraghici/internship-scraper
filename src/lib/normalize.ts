/** Applies all three filters (student + Canada + role) and fills in bookkeeping fields. */

import type { JobPosting, RawJob } from '../types.js';
import { matchCanada } from './canada.js';
import { matchRole, isStudentType } from './roles.js';
import { jobId } from './db.js';

export interface NormalizeStats {
  total: number;
  keptJobs: JobPosting[];
  droppedNotCanada: number;
  droppedNotRole: number;
  droppedNotStudent: number;
  droppedStale: number;
}

/**
 * Postings older than this never enter the database.
 *
 * This has to happen here, not after insertion. The curated lists keep serving months
 * of history, so deleting old rows post-insert made every scrape re-add the same
 * postings as "new", fire a notification for each, and delete them again on the next
 * run: a loop that produced ~110 false alerts per cycle.
 */
const MAX_AGE_DAYS = Number(process.env.JT_MAX_AGE_DAYS ?? 30);

/** Parse a salary string like "$120,000 - $150,000 CAD" into a range. */
export function parseSalary(raw: string | null): {
  min: number | null; max: number | null; currency: string | null;
} {
  if (!raw) return { min: null, max: null, currency: null };
  const currency = /\bcad\b|c\$/i.test(raw) ? 'CAD' : /\busd\b/i.test(raw) ? 'USD' : raw.includes('$') ? 'USD' : null;

  const nums = [...raw.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/gi)]
    .map((m) => {
      const n = parseFloat((m[1] ?? '').replace(/,/g, ''));
      return m[2] ? n * 1000 : n;
    })
    .filter((n) => Number.isFinite(n) && n >= 1000);

  if (nums.length === 0) return { min: null, max: null, currency };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min: Math.round(min), max: Math.round(max), currency };
}

export function normalize(raw: RawJob[]): NormalizeStats {
  const keptJobs: JobPosting[] = [];
  const seen = new Set<string>();
  let droppedNotCanada = 0;
  let droppedNotRole = 0;
  let droppedNotStudent = 0;
  let droppedStale = 0;
  const now = new Date().toISOString();
  const cutoff = MAX_AGE_DAYS > 0 ? Date.now() - MAX_AGE_DAYS * 86_400_000 : null;

  for (const j of raw) {
    const role = matchRole(j.title);
    if (!role.matches) {
      droppedNotRole++;
      continue;
    }

    // This tracker is internships-only: full-time, new-grad and contract roles are
    // dropped here rather than filtered in the UI, so they never reach the database.
    // An adapter-supplied type (Ashby's explicit "Intern") wins over the title guess.
    const type = j.type ?? role.type;
    if (!isStudentType(type)) {
      droppedNotStudent++;
      continue;
    }

    // Postings with no date are kept: about a third of rows come from lists with no
    // date column, and dropping them would discard current jobs alongside stale ones.
    if (cutoff !== null && j.postedAt) {
      const posted = Date.parse(j.postedAt);
      if (Number.isFinite(posted) && posted < cutoff) {
        droppedStale++;
        continue;
      }
    }

    const ca = matchCanada(j.location);
    if (!ca.isCanada) {
      droppedNotCanada++;
      continue;
    }

    const id = jobId(j.company, j.title, ca.province);
    if (seen.has(id)) continue; // dedupe within a single source's batch
    seen.add(id);

    const salary = parseSalary(j.salaryRaw);

    keptJobs.push({
      ...j,
      id,
      province: ca.province,
      remote: j.remote || ca.remote,
      firstSeenAt: now,
      salaryMin: j.salaryMin ?? salary.min,
      salaryMax: j.salaryMax ?? salary.max,
      salaryCurrency: j.salaryCurrency ?? salary.currency,
      type,
      roleCategory: role.category,
      matchedBy: role.matchedBy,
      canadaConfidence: ca.confidence,
      canadaMatchedBy: ca.matchedBy,
      status: 'new',
    });
  }

  return {
    total: raw.length, keptJobs, droppedNotCanada, droppedNotRole, droppedNotStudent, droppedStale,
  };
}
