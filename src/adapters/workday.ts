/**
 * Workday adapter.
 *
 * Workday powers the careers site of most large Canadian employers (banks, telecoms,
 * enterprises), the segment Greenhouse/Lever barely cover. Every tenant exposes the
 * same undocumented-but-public JSON endpoint that the careers SPA itself calls:
 *
 *   POST https://<host>.<dc>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs
 *   { "appliedFacets": {}, "limit": 20, "offset": 0, "searchText": "intern" }
 *
 * No auth, no HTML parsing. The response gives title, locationsText, externalPath and
 * a relative postedOn ("Posted 11 Days Ago").
 *
 * The (host, dc, tenant, site) tuple is NOT guessable, `rbc`/`telus`/`cgi` all 404 or
 * 422, and Loblaw lives under host `myview`, not `loblaw`. So boards are configured by
 * pasting a real careers URL, which `parseWorkdayUrl` decomposes. Verify a new one with
 * `npm run check-board -- <url>`.
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';
import { matchRole } from '../lib/roles.js';

export interface WorkdayBoard {
  /** A real careers URL, e.g. https://harriscomputer.wd3.myworkdayjobs.com/en-US/1 */
  url: string;
  name: string;
}

/**
 * Verified live Workday boards (each checked against the CXS API, not guessed).
 * Canadian employers and Canada-hiring enterprises.
 */
export const WORKDAY_BOARDS: WorkdayBoard[] = [
  { url: 'https://harriscomputer.wd3.myworkdayjobs.com/en-US/1', name: 'Harris Computer' },
  { url: 'https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers', name: 'TD Bank' },
  { url: 'https://cibc.wd3.myworkdayjobs.com/en-US/search', name: 'CIBC' },
  { url: 'https://bmo.wd3.myworkdayjobs.com/en-US/External', name: 'BMO' },
  { url: 'https://cae.wd3.myworkdayjobs.com/en-US/career', name: 'CAE' },
  { url: 'https://lifeworks.wd3.myworkdayjobs.com/en-US/External', name: 'TELUS Health' },
  { url: 'https://sunlife.wd3.myworkdayjobs.com/en-US/Experienced-Jobs', name: 'Sun Life' },
  // Sun Life's student stream. Empty off-cycle, populated in campus recruiting season.
  { url: 'https://sunlife.wd3.myworkdayjobs.com/en-US/Campus', name: 'Sun Life (Campus)' },
  { url: 'https://mcgill.wd3.myworkdayjobs.com/en-US/mcgill_careers', name: 'McGill University' },
  { url: 'https://myview.wd3.myworkdayjobs.com/en-US/loblaw_careers', name: 'Loblaw' },
  { url: 'https://workday.wd5.myworkdayjobs.com/en-US/Workday', name: 'Workday' },
  { url: 'https://mlse.wd3.myworkdayjobs.com/en-US/MLSE', name: 'MLSE' },
  // RBC's early-talent site is student recruiting specifically, a better bet than a
  // general careers board, where interns are a rounding error.
  { url: 'https://rbc.wd3.myworkdayjobs.com/en-US/RBCEARLYTALENT1', name: 'RBC (Early Talent)' },
  { url: 'https://ciena.wd5.myworkdayjobs.com/en-US/Careers', name: 'Ciena' },
  { url: 'https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site', name: 'Salesforce' },
  { url: 'https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers', name: 'PwC' },
];

interface WorkdayPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WorkdayResponse {
  total?: number;
  jobPostings?: WorkdayPosting[];
}

interface WorkdayJobDetail {
  jobPostingInfo?: {
    title?: string;
    location?: string;
    additionalLocations?: string[];
    timeType?: string;
    jobRequisitionId?: string;
    startDate?: string;
    postedOn?: string;
  };
}

export interface ParsedWorkdayUrl {
  host: string;
  dc: string;
  tenant: string;
  site: string;
  /** Base for building apply links back to the human-facing page. */
  origin: string;
}

/**
 * Decompose a Workday careers URL into the pieces the CXS API needs.
 * Handles both `/en-US/<site>` and bare `/<site>` forms, plus deep job links.
 */
export function parseWorkdayUrl(url: string): ParsedWorkdayUrl | null {
  const m = url.match(/^https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(.+)$/i);
  if (!m) return null;
  const [, host, dc, rest] = m;
  if (!host || !dc || !rest) return null;

  // Strip a locale segment (en-US, fr-CA, …) if present, then take the site id.
  const segments = rest.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  const site = /^[a-z]{2}-[A-Z]{2}$/.test(first) ? segments[1] : first;
  if (!site) return null;

  // The tenant is the subdomain for every tenant checked (incl. host≠company cases
  // like Loblaw's `myview`), so derive it rather than asking for it separately.
  return { host, dc, tenant: host, site, origin: `https://${host}.${dc}.myworkdayjobs.com` };
}

/** "Posted 11 Days Ago" / "Posted 30+ Days Ago" / "Posted Today" → ISO date. */
export function parseWorkdayPostedOn(postedOn: string | undefined, now = new Date()): string | null {
  if (!postedOn) return null;
  const s = postedOn.toLowerCase();
  if (/today/.test(s)) return now.toISOString();
  if (/yesterday/.test(s)) return new Date(now.getTime() - 86_400_000).toISOString();
  const days = s.match(/(\d+)\+?\s*day/)?.[1];
  if (days) return new Date(now.getTime() - Number(days) * 86_400_000).toISOString();
  const months = s.match(/(\d+)\+?\s*month/)?.[1];
  if (months) return new Date(now.getTime() - Number(months) * 30 * 86_400_000).toISOString();
  return null;
}

async function postJobs(
  p: ParsedWorkdayUrl,
  searchText: string,
  offset: number,
  limit: number,
): Promise<WorkdayResponse> {
  const endpoint = `${p.origin}/wday/cxs/${p.tenant}/${p.site}/jobs`;
  // fetchText caches by URL; fold the POST body into the cache key so different
  // search terms and pages don't collide on one cached response.
  const cacheKey = `${endpoint}#${searchText}@${offset}`;
  const body = JSON.stringify({ appliedFacets: {}, limit, offset, searchText });
  const text = await fetchText(cacheKey, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    realUrl: endpoint,
  });
  return JSON.parse(text) as WorkdayResponse;
}

/**
 * Search terms run against every board. Workday's searchText matches the employer's
 * real title, so unlike Job Bank these actually surface internships.
 */
const SEARCH_TERMS = (process.env.JT_WD_TERMS
  ?? 'intern,co-op,stagiaire,software,developer,new grad,data scientist')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

/**
 * Terms that describe the *role* rather than the student track. On a big tenant these
 * match thousands of rows ("developer" hits 1401 at TD), almost all of them senior -
 * so page deeply into the student terms and only skim these. Measured: skimming costs
 * nothing in kept jobs and removes ~40% of this adapter's requests.
 */
const BROAD_TERMS = new Set(['software', 'developer', 'new grad', 'engineer']);
const BROAD_TERM_MAX_PAGES = 2;

const PAGE_SIZE = 20;
const MAX_PAGES = 5;

/** Workday shows "23 Locations" instead of place names on multi-site postings. */
const LOCATION_COUNT = /^\s*\d+\s+locations\s*$/i;

/** Cap on detail lookups per board, so a huge multi-site board can't stall a run. */
const MAX_DETAIL_LOOKUPS = 40;

/**
 * Resolve a "N Locations" posting to its real location list.
 *
 * The list endpoint only gives a count, which hides Canadian roles inside otherwise
 * US-looking postings (a real case: "(Remote) GIS Developer" / "23 Locations" is open
 * to BC, ON, MB, AB and SK). The detail endpoint returns every location, so ask for it
 * rather than dropping the posting.
 */
async function fetchLocations(p: ParsedWorkdayUrl, path: string): Promise<{
  location: string | null;
  timeType: string | null;
}> {
  const text = await fetchText(`${p.origin}/wday/cxs/${p.tenant}/${p.site}${path}`, {
    headers: { accept: 'application/json' },
  });
  const info = (JSON.parse(text) as WorkdayJobDetail).jobPostingInfo ?? {};
  const all = [info.location, ...(info.additionalLocations ?? [])].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  return {
    location: all.length ? all.join('; ') : null,
    timeType: info.timeType ?? null,
  };
}

async function fetchWorkdayBoard(board: WorkdayBoard): Promise<RawJob[]> {
  const p = parseWorkdayUrl(board.url);
  if (!p) throw new Error(`unparseable Workday URL: ${board.url}`);

  const out: RawJob[] = [];
  const seen = new Set<string>();

  for (const term of SEARCH_TERMS) {
    // The first response reports `total`, so we know how many pages exist rather than
    // paging blindly to MAX_PAGES. Terms like "stagiaire" often match a handful of
    // jobs, asking for five pages of them was ~30% of this adapter's requests.
    const cap = BROAD_TERMS.has(term.toLowerCase()) ? BROAD_TERM_MAX_PAGES : MAX_PAGES;
    let pagesForTerm = cap;

    for (let page = 0; page < pagesForTerm; page++) {
      const data = await postJobs(p, term, page * PAGE_SIZE, PAGE_SIZE);
      const postings = data.jobPostings ?? [];
      if (postings.length === 0) break;

      if (page === 0 && typeof data.total === 'number') {
        pagesForTerm = Math.min(cap, Math.max(1, Math.ceil(data.total / PAGE_SIZE)));
      }

      for (const j of postings) {
        const path = j.externalPath ?? '';
        if (!path || seen.has(path)) continue;
        seen.add(path);
        const location = j.locationsText ?? '';
        out.push({
          title: j.title,
          company: board.name,
          location,
          remote: /remote/i.test(location) || /remote/i.test(j.title),
          url: `${p.origin}/en-US/${p.site}${path}`,
          source: 'workday',
          postedAt: parseWorkdayPostedOn(j.postedOn),
          salaryRaw: null,
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          type: null,
          sponsorship: null,
          description: null,
        });
      }

      // Last page for this term.
      if (postings.length < PAGE_SIZE) break;
    }
  }

  // Second pass: resolve "N Locations" placeholders to real place names. Only for
  // postings that already pass the role filter, the lookup costs one request each,
  // and a location we can't read is worthless on a job we don't want anyway.
  let lookups = 0;
  for (const job of out) {
    if (lookups >= MAX_DETAIL_LOOKUPS) break;
    if (!LOCATION_COUNT.test(job.location)) continue;
    if (!matchRole(job.title).matches) continue;

    lookups++;
    const path = job.url.slice(`${p.origin}/en-US/${p.site}`.length);
    try {
      const detail = await fetchLocations(p, path);
      if (detail.location) {
        job.location = detail.location;
        job.remote = job.remote || /remote/i.test(detail.location);
      }
      // "Intern"/"Part time" here is a stronger type signal than the title alone.
      if (detail.timeType && /intern/i.test(detail.timeType)) job.type = 'intern';
    } catch {
      // Leave the placeholder; normalize() will flag it as ambiguous rather than drop it.
    }
  }

  return out;
}

/** Fetch boards with bounded concurrency; a dead board is skipped, not fatal. */
async function fetchBoards(boards: WorkdayBoard[], concurrency = 3): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const failures: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < boards.length) {
      const board = boards[cursor++];
      if (!board) return;
      try {
        out.push(...(await fetchWorkdayBoard(board)));
      } catch (err) {
        failures.push(`${board.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  if (out.length === 0 && failures.length > 0) throw new Error(failures.join('; '));
  return out;
}

export function workdayAdapter(boards: WorkdayBoard[] = WORKDAY_BOARDS): Adapter {
  return {
    name: 'workday',
    fetch: () => fetchBoards(boards),
  };
}
