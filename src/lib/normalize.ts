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
}

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
  const now = new Date().toISOString();

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

  return { total: raw.length, keptJobs, droppedNotCanada, droppedNotRole, droppedNotStudent };
}
