/**
 * Ashby adapter.
 *
 * Ashby is the ATS of choice for a lot of newer Canadian tech companies (Cohere,
 * Wealthsimple, 1Password, Jobber), none of which are reachable through Greenhouse
 * or Lever. The public job-board API needs no auth:
 *
 *   GET https://api.ashbyhq.com/posting-api/job-board/<token>?includeCompensation=true
 *
 * It is also the best-structured source in this project: `employmentType` states
 * "Intern" outright rather than leaving it to be guessed from the title, and
 * `secondaryLocations` carries per-location country codes, so multi-country postings
 * resolve exactly instead of heuristically.
 */

import type { Adapter, JobType, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface AshbyBoard {
  token: string;
  name?: string;
}

/** Verified live Ashby boards (checked against the API, not guessed). */
export const ASHBY_BOARDS: AshbyBoard[] = [
  { token: 'cohere', name: 'Cohere' },
  { token: 'wealthsimple', name: 'Wealthsimple' },
  { token: '1password', name: '1Password' },
  { token: 'jobber', name: 'Jobber' },
  { token: 'ramp', name: 'Ramp' },
  { token: 'notion', name: 'Notion' },
  { token: 'linear', name: 'Linear' },
];

interface AshbyAddress {
  postalAddress?: {
    addressCountry?: string;
    addressRegion?: string;
    addressLocality?: string;
  };
}

interface AshbyJob {
  id: string;
  title: string;
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string; address?: AshbyAddress }>;
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  address?: AshbyAddress;
  compensation?: {
    compensationTierSummary?: string;
    scrapeableCompensationSalarySummary?: string;
  };
}

/** Ashby's employmentType vocabulary → our JobType. */
export function mapEmploymentType(t: string | undefined): JobType | null {
  switch ((t ?? '').toLowerCase()) {
    case 'intern':
      return 'intern';
    case 'contract':
    case 'temporary':
      return 'contract';
    case 'fulltime':
      return 'full-time';
    default:
      return null; // let the title-based classifier decide
  }
}

/**
 * Build one location string covering every place the job is open to.
 *
 * A posting headquartered in New York with a "Remote (Canada)" secondary location is a
 * Canadian job; keeping only `location` would drop it. The Canada filter reads this
 * combined string, so every candidate location has to appear in it.
 */
export function collectLocations(j: AshbyJob): string {
  const parts: string[] = [];
  if (j.location) parts.push(j.location);
  for (const s of j.secondaryLocations ?? []) {
    if (s.location) parts.push(s.location);
    const country = s.address?.postalAddress?.addressCountry;
    // Surface the country so "Toronto" style names still read as Canadian.
    if (country && /canada/i.test(country) && s.location && !/canada/i.test(s.location)) {
      parts.push(`${s.location}, Canada`);
    }
  }
  const country = j.address?.postalAddress?.addressCountry;
  if (country && !parts.some((p) => p.includes(country))) parts.push(country);
  return [...new Set(parts)].join('; ');
}

async function fetchAshbyBoard(board: AshbyBoard): Promise<RawJob[]> {
  const data = await fetchJson<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${board.token}?includeCompensation=true`,
  );

  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const location = collectLocations(j);
      return {
        title: j.title.trim(),
        company: board.name ?? board.token,
        location,
        remote: Boolean(j.isRemote) || /remote/i.test(location),
        url: j.jobUrl ?? j.applyUrl ?? `https://jobs.ashbyhq.com/${board.token}/${j.id}`,
        source: 'ashby',
        postedAt: j.publishedAt ?? null,
        salaryRaw:
          j.compensation?.scrapeableCompensationSalarySummary ??
          j.compensation?.compensationTierSummary ??
          null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        // Ashby states this explicitly, which beats guessing from the title.
        type: mapEmploymentType(j.employmentType),
        sponsorship: null,
        description: j.descriptionPlain ?? null,
      } satisfies RawJob;
    });
}

/** Fetch boards with bounded concurrency; a dead board is skipped, not fatal. */
async function fetchBoards(boards: AshbyBoard[], concurrency = 4): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        out.push(...(await fetchAshbyBoard(board)));
      } catch (err) {
        failures.push(`${board.token}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (out.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return out;
}

export function ashbyAdapter(boards: AshbyBoard[] = ASHBY_BOARDS): Adapter {
  return {
    name: 'ashby',
    fetch: () => fetchBoards(boards),
  };
}
