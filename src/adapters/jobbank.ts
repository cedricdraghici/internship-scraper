/**
 * Job Bank Canada (jobbank.gc.ca) — Government of Canada job board.
 *
 * No public API or RSS feed exists (the documented /jobsearch-rss path 404s), so this
 * parses the public search-results HTML. robots.txt allows this with `Crawl-delay: 5`,
 * which the adapter honours between requests.
 *
 * Result markup is stable and semantic: .noctitle / .business / .location / .salary / .date
 * inside <article id="article-NNN">.
 */

import type { Adapter, RawJob } from '../types.js';
import { fetchText } from '../lib/fetch.js';

const BASE = 'https://www.jobbank.gc.ca';
const CRAWL_DELAY_MS = 5000; // robots.txt: Crawl-delay: 5

/** Search terms covering the target roles from CLAUDE.md. */
export const JOBBANK_QUERIES = [
  'software developer',
  'software engineer',
  'devops engineer',
  'web developer',
  'machine learning engineer',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stripTags(s: string): string {
  return s
    .replace(/<span class="wb-inv">.*?<\/span>/gis, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

function field(block: string, cls: string): string {
  const m = block.match(new RegExp(`<li class="${cls}"[^>]*>([\\s\\S]*?)</li>`, 'i'));
  return m?.[1] ? stripTags(m[1]) : '';
}

export function parseJobBankHtml(html: string): RawJob[] {
  const jobs: RawJob[] = [];
  const blocks = html.split(/<article\s+id="article-/i).slice(1);

  for (const block of blocks) {
    const id = block.match(/^(\d+)/)?.[1];
    if (!id) continue;

    const titleMatch = block.match(/<span class="noctitle"[^>]*>([\s\S]*?)<\/span>/i);
    const title = titleMatch?.[1] ? stripTags(titleMatch[1]) : '';
    if (!title) continue;

    const company = field(block, 'business');
    const location = field(block, 'location');
    const salaryRaw = field(block, 'salary').replace(/^Salary\s*/i, '').trim() || null;
    const dateStr = field(block, 'date');

    let postedAt: string | null = null;
    if (dateStr) {
      const d = new Date(dateStr);
      if (!Number.isNaN(d.getTime())) postedAt = d.toISOString();
    }

    const href = block.match(/href="(\/jobsearch\/jobposting\/[^"]+)"/i)?.[1] ?? `/jobsearch/jobposting/${id}`;

    jobs.push({
      title,
      company: company || 'Unknown',
      location,
      remote: /remote|telework|t(é|e)l(é|e)travail/i.test(block),
      // Drop the jsessionid so the URL stays stable across runs (it affects dedupe).
      url: BASE + href.split(';')[0],
      source: 'jobbank',
      postedAt,
      salaryRaw,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: salaryRaw ? 'CAD' : null,
      type: null,
      sponsorship: null,
      description: null,
    });
  }
  return jobs;
}

export function jobBankAdapter(queries: string[] = JOBBANK_QUERIES): Adapter {
  return {
    name: 'jobbank',
    async fetch(): Promise<RawJob[]> {
      const all: RawJob[] = [];
      const errors: string[] = [];

      for (const [i, q] of queries.entries()) {
        if (i > 0) await sleep(CRAWL_DELAY_MS); // honour robots.txt
        const url = `${BASE}/jobsearch/jobsearch?searchstring=${encodeURIComponent(q)}&sort=M`;
        try {
          all.push(...parseJobBankHtml(await fetchText(url, {
            headers: { 'user-agent': 'Mozilla/5.0 (compatible; job-tracker/0.1; personal job search)' },
          })));
        } catch (err) {
          errors.push(`${q}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (all.length === 0 && errors.length > 0) throw new Error(errors.join('; '));
      return all;
    },
  };
}
