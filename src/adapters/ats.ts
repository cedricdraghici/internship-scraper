/**
 * ATS adapters: Greenhouse and Lever.
 *
 * Both expose free public JSON endpoints per company board, no auth, no scraping.
 * The catch is that board tokens are per-company and unguessable, so COMPANIES below
 * is a hand-verified list. Add to it with `npm run check-board <token>`.
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export interface Board {
  token: string;
  /** Display name; falls back to the API's own company_name. */
  name?: string;
}

/** Verified live Greenhouse boards (checked against the API, not guessed). */
export const GREENHOUSE_BOARDS: Board[] = [
  { token: 'hootsuite', name: 'Hootsuite' },
  { token: 'thinkific', name: 'Thinkific' },
  { token: 'dialpad', name: 'Dialpad' },
  { token: 'unbounce', name: 'Unbounce' },
  { token: 'pagerduty', name: 'PagerDuty' },
  { token: 'datadog', name: 'Datadog' },
  { token: 'cloudflare', name: 'Cloudflare' },
  { token: 'databricks', name: 'Databricks' },
  { token: 'affirm', name: 'Affirm' },
  { token: 'robinhood', name: 'Robinhood' },
  { token: 'coinbase', name: 'Coinbase' },
  { token: 'reddit', name: 'Reddit' },
  { token: 'instacart', name: 'Instacart' },
  { token: 'figma', name: 'Figma' },
  { token: 'airtable', name: 'Airtable' },
  { token: 'asana', name: 'Asana' },
  { token: 'stripe', name: 'Stripe' },
  { token: 'faire', name: 'Faire' },
  { token: 'scaleai', name: 'Scale AI' },
  { token: 'anthropic', name: 'Anthropic' },
  // Canadian-headquartered.
  { token: 'd2l', name: 'D2L' },
  { token: 'ritual', name: 'Ritual' },
  // US companies with real Canadian engineering offices / Canada-remote roles.
  { token: 'mongodb', name: 'MongoDB' },
  { token: 'gitlab', name: 'GitLab' },
  { token: 'elastic', name: 'Elastic' },
  { token: 'lyft', name: 'Lyft' },
  { token: 'samsara', name: 'Samsara' },
  { token: 'brex', name: 'Brex' },
  { token: 'twilio', name: 'Twilio' },
  { token: 'pinterest', name: 'Pinterest' },
  { token: 'airbnb', name: 'Airbnb' },
  { token: 'dropbox', name: 'Dropbox' },
  { token: 'flipp', name: 'Flipp' },
  { token: 'tulip', name: 'Tulip' },
  // Canadian tech, verified live. Geotab and Later are the strongest intern sources here.
  { token: 'geotab', name: 'Geotab' },
  { token: 'later', name: 'Later' },
  { token: 'leagueinc', name: 'League' },
  { token: 'konradgroup', name: 'Konrad Group' },
  { token: 'tenstorrent', name: 'Tenstorrent' },
  { token: 'knak', name: 'Knak' },
  { token: 'mejuri', name: 'Mejuri' },
];

/**
 * Verified live Lever boards.
 * Note: companies migrate between ATS platforms, so a token that returns `[]` has
 * usually moved rather than broken. Re-check with `npm run check-board`.
 */
export const LEVER_BOARDS: Board[] = [
  { token: 'matchgroup', name: 'Match Group' },
  // Canadian, verified live. Telesat is the best intern source on this platform.
  { token: 'telesat', name: 'Telesat' },
  { token: 'waabi', name: 'Waabi' },
  { token: 'wattpad', name: 'Wattpad' },
  { token: 'achievers', name: 'Achievers' },
  { token: 'zensurance', name: 'Zensurance' },
  { token: 'mistplay', name: 'Mistplay' },
];

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  company_name?: string;
  location?: { name?: string };
  updated_at?: string;
  first_published?: string;
  offices?: Array<{ location?: string; name?: string }>;
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: { location?: string; allLocations?: string[]; commitment?: string; team?: string };
  salaryRange?: { min?: number; max?: number; currency?: string };
}

async function fetchGreenhouseBoard(board: Board): Promise<RawJob[]> {
  const data = await fetchJson<{ jobs?: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=false`,
  );
  return (data.jobs ?? []).map((j) => {
    // Some boards put the real location in offices[] rather than location.name.
    const offices = (j.offices ?? []).map((o) => o.location || o.name).filter(Boolean).join(', ');
    const location = j.location?.name || offices || '';
    return {
      title: j.title,
      company: board.name ?? j.company_name ?? board.token,
      location,
      remote: /remote/i.test(location),
      url: j.absolute_url,
      source: 'greenhouse',
      postedAt: j.first_published ?? j.updated_at ?? null,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: null,
      sponsorship: null,
      description: null,
    } satisfies RawJob;
  });
}

async function fetchLeverBoard(board: Board): Promise<RawJob[]> {
  const data = await fetchJson<LeverJob[]>(`https://api.lever.co/v0/postings/${board.token}?mode=json`);
  return (data ?? []).map((j) => {
    const location = j.categories?.allLocations?.join(', ') || j.categories?.location || '';
    return {
      title: j.text,
      company: board.name ?? board.token,
      location,
      remote: /remote/i.test(location),
      url: j.hostedUrl,
      source: 'lever',
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      salaryRaw: null,
      salaryMin: j.salaryRange?.min ?? null,
      salaryMax: j.salaryRange?.max ?? null,
      salaryCurrency: j.salaryRange?.currency ?? null,
      type: null,
      sponsorship: null,
      description: j.categories?.team ?? null,
    } satisfies RawJob;
  });
}

/** Fetch boards with bounded concurrency; a dead board is skipped, not fatal. */
async function fetchBoards(
  boards: Board[],
  fetcher: (b: Board) => Promise<RawJob[]>,
  concurrency = 4,
): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        out.push(...(await fetcher(board)));
      } catch (err) {
        failures.push(`${board.token}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (out.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return out;
}

export function greenhouseAdapter(boards: Board[] = GREENHOUSE_BOARDS): Adapter {
  return {
    name: 'greenhouse',
    fetch: () => fetchBoards(boards, fetchGreenhouseBoard),
  };
}

export function leverAdapter(boards: Board[] = LEVER_BOARDS): Adapter {
  return {
    name: 'lever',
    fetch: () => fetchBoards(boards, fetchLeverBoard),
  };
}
