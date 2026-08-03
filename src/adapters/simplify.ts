/**
 * SimplifyJobs adapter (structured JSON, not markdown).
 *
 * These repos stopped rendering their README as a markdown table — the table is now
 * generated from a JSON file that the repo publishes directly:
 *
 *   .github/scripts/listings.json
 *
 * That file is a much better source than the rendered table ever was: ~14.6k listings
 * with an `active` flag, real posted/updated timestamps, sponsorship notes, and an
 * array of locations rather than one truncated "+3" string. Roughly 2k of them are
 * Canadian.
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchJson } from '../lib/fetch.js';

export const SIMPLIFY_SOURCES = [
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json',
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json',
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json',
  // vanshb03's repos publish the same schema. Their rendered READMEs parse to ~126
  // rows; the JSON behind them carries 332, with real dates and location arrays.
  'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json',
  'https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/dev/.github/scripts/listings.json',
];

interface SimplifyListing {
  company_name?: string;
  title?: string;
  url?: string;
  locations?: string[];
  active?: boolean;
  is_visible?: boolean;
  date_posted?: number;
  date_updated?: number;
  sponsorship?: string;
  terms?: string[];
  category?: string;
}

/** Unix seconds → ISO, tolerating the odd millisecond timestamp. */
function toIso(ts: number | undefined): string | null {
  if (!ts || !Number.isFinite(ts)) return null;
  const ms = ts > 1e11 ? ts : ts * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseSimplifyListings(listings: SimplifyListing[]): RawJob[] {
  const jobs: RawJob[] = [];

  for (const l of listings) {
    // `active: false` means the posting closed — the repo keeps the row for history.
    if (l.active === false || l.is_visible === false) continue;
    const title = (l.title ?? '').trim();
    const company = (l.company_name ?? '').trim();
    const url = l.url;
    if (!title || !company || !url) continue;

    const location = (l.locations ?? []).join('; ');
    jobs.push({
      title,
      company,
      location,
      remote: /remote/i.test(location) || /remote/i.test(title),
      url,
      source: 'simplify',
      postedAt: toIso(l.date_posted) ?? toIso(l.date_updated),
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      // These repos are internship/new-grad lists by construction, but the title still
      // decides: New-Grad-Positions carries plain full-time roles too.
      type: null,
      // "Does Not Offer Sponsorship" / "U.S. Citizenship Required" live here.
      sponsorship: l.sponsorship && l.sponsorship !== 'Other' ? l.sponsorship : null,
      description: l.terms?.length ? `Terms: ${l.terms.join(', ')}` : null,
    });
  }
  return jobs;
}

export function simplifyAdapter(urls: string[] = SIMPLIFY_SOURCES): Adapter {
  return {
    name: 'simplify',
    async fetch(): Promise<RawJob[]> {
      const all: RawJob[] = [];
      const errors: string[] = [];

      for (const url of urls) {
        try {
          all.push(...parseSimplifyListings(await fetchJson<SimplifyListing[]>(url)));
        } catch (err) {
          errors.push(`${url.split('/')[4]}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (all.length === 0 && errors.length > 0) throw new Error(errors.join('; '));
      return all;
    },
  };
}
