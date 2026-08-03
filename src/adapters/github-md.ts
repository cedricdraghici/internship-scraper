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

export const GITHUB_SOURCES = [
  'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/INTERN_INTL.md',
  'https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/NEW_GRAD_INTL.md',
  'https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/INTERN_INTL.md',
  'https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/NEW_GRAD_INTL.md',
  'https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/main/README.md',
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/README.md',
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md',
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
  const md = cell.match(/\]\((https?:\/\/[^)]+)\)/);
  if (md?.[1]) return md[1];
  const bare = cell.match(/https?:\/\/\S+/);
  return bare?.[0]?.replace(/[),]+$/, '') ?? null;
}

/** "5d" / "2mo" / "3h" -> approximate ISO timestamp. */
function ageToIso(age: string): string | null {
  const m = age.trim().match(/^(\d+)\s*(h|d|w|mo|y)$/i);
  if (!m) return null;
  const n = parseInt(m[1] ?? '0', 10);
  const unit = (m[2] ?? '').toLowerCase();
  const hours = unit === 'h' ? n
    : unit === 'd' ? n * 24
    : unit === 'w' ? n * 24 * 7
    : unit === 'mo' ? n * 24 * 30
    : n * 24 * 365;
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
}

export function parseMarkdownTables(md: string, sourceUrl: string): RawJob[] {
  const jobs: RawJob[] = [];
  const lines = md.split('\n');
  let lastCompany = '';

  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitRow(line);
    if (cells.length < 3) continue;

    // Skip header and separator rows.
    const first = cellText(cells[0] ?? '').toLowerCase();
    if (!first && !cells.some((c) => cellUrl(c))) continue;
    if (/^-{2,}$/.test((cells[0] ?? '').replace(/[\s:]/g, ''))) continue;
    if (first === 'company' || first === 'name') continue;

    let company = cellText(cells[0] ?? '');
    const title = cellText(cells[1] ?? '');
    const location = cellText(cells[2] ?? '');

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

    const ageCell = cells.length > 3 ? cellText(cells[cells.length - 1] ?? '') : '';

    jobs.push({
      title,
      company,
      location: location.replace(/\s*\+\d+\s*$/, ''), // drop "+1" multi-location marker
      remote: /remote/i.test(location),
      url,
      source: 'github',
      postedAt: ageToIso(ageCell),
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
