/**
 * GitHub markdown job-list adapter.
 *
 * These repos publish HTML-in-markdown tables:
 *   | <a href="..."><strong>Company</strong></a> | Role | Toronto, Canada +1 | <a href="apply"><img/></a> | 59d |
 *
 * Notes on the format:
 *  - The age column is relative ("59d", "2mo"), not a date — converted to an approximate
 *    ISO timestamp so sorting works.
 *  - "+1" after a location means additional locations the table doesn't list.
 *  - A leading "↳" in the company cell means "same company as the row above".
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

/**
 * Curated job-list repos. These are the single best internship source in this project:
 * they are maintained by students for students, so every row is already a real intern
 * posting with a company, a location and a link — no employment-type guesswork.
 *
 * The Canada-specific lists matter most; the international ones are mostly US rows that
 * the Canada filter discards, but they do carry Canadian offices of large employers.
 */
export const GITHUB_SOURCES = [
  // Canada-only lists.
  'https://raw.githubusercontent.com/negarprh/Canadian-Tech-Internships-2026/main/README.md',
  'https://raw.githubusercontent.com/negarprh/Canadian-Tech-Internships-2026/main/README-2027.md',
  'https://raw.githubusercontent.com/hanzili/canada_sde_intern_position/main/README.md',
  'https://raw.githubusercontent.com/hanzili/canada_sde_junior_new_grad_position/main/README.md',
  // International lists (filtered down to Canadian rows).
  'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/INTERN_INTL.md',
  'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/NEW_GRAD_INTL.md',
  'https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/INTERN_INTL.md',
  'https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/NEW_GRAD_INTL.md',
  'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/main/README.md',
  'https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/main/README.md',
  // Note: the SimplifyJobs repos are NOT listed here. They stopped rendering a
  // markdown table, so this parser found nothing in them; they're read from their
  // published listings.json instead — see adapters/simplify.ts.
];

/** Strip HTML tags/entities from a markdown table cell. */
function cellText(cell: string): string {
  return cell
    .replace(/<img[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // markdown links -> text
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First real application URL in a cell (skips image/badge sources). */
function cellUrl(cell: string): string | null {
  const href = cell.match(/href="([^"]+)"/i);
  if (href?.[1]) return href[1];
  // Markdown links, including the angle-bracket form `[Apply](<https://…>)` that some
  // repos use to escape URLs containing parentheses. Without the `<>` branch the bare
  // fallback below matched and kept a trailing ">", producing dead apply links.
  const md = cell.match(/\]\(<?(https?:\/\/[^)>]+)>?\)/);
  if (md?.[1]) return md[1];
  const bare = cell.match(/https?:\/\/\S+/);
  return bare?.[0]?.replace(/[)>,]+$/, '') ?? null;
}

/**
 * A date cell -> ISO timestamp.
 *
 * These repos use two conventions: a relative age ("5d", "2mo") or an absolute date
 * ("Jul 31, 2026", "2026-07-31"). Only handling the relative form left 173 of 282 rows
 * with no posted_at, which made "newest first" meaningless — they all fell back to the
 * scrape timestamp and tied for first place.
 */
export function dateCellToIso(cell: string, now = new Date()): string | null {
  const s = cell.trim();
  if (!s) return null;

  const rel = s.match(/^(\d+)\s*(h|d|w|mo|y)$/i);
  if (rel) {
    const n = parseInt(rel[1] ?? '0', 10);
    const unit = (rel[2] ?? '').toLowerCase();
    const hours = unit === 'h' ? n
      : unit === 'd' ? n * 24
      : unit === 'w' ? n * 24 * 7
      : unit === 'mo' ? n * 24 * 30
      : n * 24 * 365;
    return new Date(now.getTime() - hours * 3600_000).toISOString();
  }

  // Absolute dates. Parsed explicitly rather than via `new Date(s)`, which reads
  // "Jul 31, 2026" as *local* midnight (landing a day early in a UTC-negative zone)
  // and happily turns a bare "4" into a year-2001 timestamp.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isoFrom(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), now);

  // "Jul 31, 2026" / "July 31, 2026" / "31 Jul 2026".
  const named = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/)
    ?? s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (named) {
    const dayFirst = /^\d/.test(s);
    const monthName = ((dayFirst ? named[2] : named[1]) ?? '').slice(0, 3).toLowerCase();
    const day = Number(dayFirst ? named[1] : named[2]);
    const month = MONTHS.indexOf(monthName);
    if (month >= 0) return isoFrom(Number(named[3]), month, day, now);
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Build a UTC ISO date, rejecting years outside a plausible posting window. */
function isoFrom(year: number, month: number, day: number, now: Date): string | null {
  if (year < 2000 || year > now.getUTCFullYear() + 2) return null;
  const d = new Date(Date.UTC(year, month, day));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
}

/**
 * Column layout of the table currently being read.
 *
 * These repos don't agree on column order: most are company-first, but some put the
 * title first and add extra columns (hanzili: Title | Company | Role | … | Location).
 * Reading the header row instead of assuming positions lets one parser handle both.
 */
interface Columns {
  company: number;
  title: number;
  location: number;
}

const DEFAULT_COLUMNS: Columns = { company: 0, title: 1, location: 2 };

/** Read a header row like `| Title | Company | … | Location |` into column indices. */
function parseHeader(cells: string[]): Columns | null {
  const names = cells.map((c) => cellText(c).toLowerCase().trim());
  const find = (...want: string[]) => names.findIndex((n) => want.includes(n));

  const company = find('company', 'company name', 'employer', 'name');
  const title = find('title', 'role', 'position', 'job title', 'job');
  const location = find('location', 'locations', 'city', 'location(s)');
  // A real header names at least a company and a title; anything less is a data row
  // or a legend table ("| Emoji | Meaning |").
  if (company < 0 || title < 0 || company === title) return null;
  return { company, title, location: location < 0 ? DEFAULT_COLUMNS.location : location };
}

export function parseMarkdownTables(md: string, sourceUrl: string): RawJob[] {
  const jobs: RawJob[] = [];
  const lines = md.split('\n');
  let lastCompany = '';
  let cols: Columns = DEFAULT_COLUMNS;

  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitRow(line);
    if (cells.length < 3) continue;

    // A header row re-defines the layout for every row that follows it.
    const header = parseHeader(cells);
    if (header) {
      cols = header;
      continue;
    }

    // Skip header and separator rows.
    const first = cellText(cells[0] ?? '').toLowerCase();
    if (!first && !cells.some((c) => cellUrl(c))) continue;
    if (/^-{2,}$/.test((cells[0] ?? '').replace(/[\s:]/g, ''))) continue;
    if (first === 'company' || first === 'name') continue;

    let company = cellText(cells[cols.company] ?? '');
    const title = cellText(cells[cols.title] ?? '');
    const location = cellText(cells[cols.location] ?? '');

    // "↳" means "same company as previous row".
    if (/^[↳â†³>]+$/.test(company) || company === '') {
      company = lastCompany;
    } else {
      lastCompany = company;
    }
    if (!company || !title) continue;

    // Closed/expired markers used by these repos.
    if (/🔒|closed|no longer accepting/i.test(line)) continue;

    // Application URL: prefer a later cell (the Apply column) over the company link.
    let url: string | null = null;
    for (let i = cells.length - 1; i >= 1; i--) {
      const u = cellUrl(cells[i] ?? '');
      if (u && !/\.(png|jpg|svg|gif)$/i.test(u) && !u.includes('imgur')) {
        url = u;
        break;
      }
    }
    if (!url) url = cellUrl(cells[0] ?? '');
    if (!url) continue;

    // The date column isn't always last (some tables end with an Apply button), so
    // scan right-to-left for the first cell that parses as a date.
    let postedAt: string | null = null;
    for (let i = cells.length - 1; i >= 1 && !postedAt; i--) {
      if (i === cols.company || i === cols.title || i === cols.location) continue;
      postedAt = dateCellToIso(cellText(cells[i] ?? ''));
    }

    jobs.push({
      title,
      company,
      location: location.replace(/\s*\+\d+\s*$/, ''), // drop "+1" multi-location marker
      remote: /remote/i.test(location),
      url,
      source: 'github',
      postedAt,
      salaryRaw: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      type: null,
      sponsorship: null,
      description: `From ${sourceUrl}`,
    });
  }
  return jobs;
}

export function githubAdapter(urls: string[] = GITHUB_SOURCES): Adapter {
  return {
    name: 'github',
    async fetch(): Promise<RawJob[]> {
      const all: RawJob[] = [];
      const errors: string[] = [];
      for (const url of urls) {
        try {
          all.push(...parseMarkdownTables(await fetchText(url), url));
        } catch (err) {
          // One dead repo must not kill the whole source.
          errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (all.length === 0 && errors.length > 0) throw new Error(errors.join('; '));
      return all;
    },
  };
}
