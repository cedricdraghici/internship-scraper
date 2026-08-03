/** Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownTables } from './github-md.js';
import { parseWorkdayUrl, parseWorkdayPostedOn } from './workday.js';
import { parseSimplifyListings } from './simplify.js';
import { collectLocations, mapEmploymentType } from './ashby.js';

test('github: angle-bracket markdown links yield a clean URL', () => {
  // hanzili's lists escape URLs as [Apply](<https://…>). Keeping the ">" produced
  // 144 dead apply links in the db.
  const md = [
    '| Title | Company | Location | Apply |',
    '|---|---|---|---|',
    '| Software Developer Intern | RemoteFront | Markham, Ontario | [Apply](<https://ca.linkedin.com/jobs/view/x-4444669950>) |',
  ].join('\n');
  const [job] = parseMarkdownTables(md, 'test');
  assert.ok(job);
  assert.equal(job.url, 'https://ca.linkedin.com/jobs/view/x-4444669950');
  assert.ok(!job.url.endsWith('>'));
});

test('github: column order comes from the header row', () => {
  // Title-first with extra columns (hanzili) vs company-first (speedyapply).
  const titleFirst = [
    '| Title | Company | Role | Location | Apply |',
    '|---|---|---|---|---|',
    '| Backend Intern | Acme Corp | Build things | Toronto, ON | [Apply](https://example.com/1) |',
  ].join('\n');
  const [a] = parseMarkdownTables(titleFirst, 'test');
  assert.ok(a);
  assert.equal(a.company, 'Acme Corp');
  assert.equal(a.title, 'Backend Intern');
  assert.equal(a.location, 'Toronto, ON');

  const companyFirst = [
    '| Company | Role | Location | Age |',
    '|---|---|---|---|',
    '| Acme Corp | Backend Intern | Toronto, ON | [Apply](https://example.com/2) |',
  ].join('\n');
  const [b] = parseMarkdownTables(companyFirst, 'test');
  assert.ok(b);
  assert.equal(b.company, 'Acme Corp');
  assert.equal(b.title, 'Backend Intern');
});

test('github: legend tables are not parsed as jobs', () => {
  // hanzili's README opens with an emoji legend; it must not become a posting.
  const md = [
    '| Emoji | Meaning |',
    '|:---:|---|',
    '| 🔥 | Hot Opportunity - Big Tech |',
  ].join('\n');
  assert.equal(parseMarkdownTables(md, 'test').length, 0);
});

test('workday: careers URL decomposes into CXS API parts', () => {
  const p = parseWorkdayUrl('https://harriscomputer.wd3.myworkdayjobs.com/en-US/1/job/Montreal-Quebec/x_R0044820-1');
  assert.ok(p);
  assert.equal(p.host, 'harriscomputer');
  assert.equal(p.tenant, 'harriscomputer');
  assert.equal(p.site, '1');
  assert.equal(p.origin, 'https://harriscomputer.wd3.myworkdayjobs.com');

  // Locale segment is optional.
  assert.equal(parseWorkdayUrl('https://td.wd3.myworkdayjobs.com/TD_Bank_Careers')?.site, 'TD_Bank_Careers');
  assert.equal(parseWorkdayUrl('https://example.com/careers'), null);
});

test('workday: relative postedOn becomes a date', () => {
  const now = new Date('2026-08-03T00:00:00.000Z');
  assert.equal(parseWorkdayPostedOn('Posted Today', now), now.toISOString());
  assert.equal(parseWorkdayPostedOn('Posted 11 Days Ago', now)?.slice(0, 10), '2026-07-23');
  assert.equal(parseWorkdayPostedOn('Posted 30+ Days Ago', now)?.slice(0, 10), '2026-07-04');
  assert.equal(parseWorkdayPostedOn(undefined), null);
});

test('ashby: secondary locations are kept so Canada-remote roles survive', () => {
  // A New York job open to "Remote (Canada)" is a Canadian job; keeping only
  // `location` would drop it.
  const loc = collectLocations({
    id: 'x',
    title: 'Security Engineer',
    location: 'New York, NY (HQ)',
    secondaryLocations: [
      { location: 'Remote (Canada)', address: { postalAddress: { addressCountry: 'Canada' } } },
      { location: 'Miami, FL', address: { postalAddress: { addressCountry: 'USA' } } },
    ],
  });
  assert.match(loc, /Canada/);
  assert.match(loc, /New York/);

  assert.equal(mapEmploymentType('Intern'), 'intern');
  assert.equal(mapEmploymentType('FullTime'), 'full-time');
  assert.equal(mapEmploymentType(undefined), null);
});

test('simplify: closed listings are dropped', () => {
  const jobs = parseSimplifyListings([
    { company_name: 'A', title: 'SWE Intern', url: 'https://x/1', locations: ['Toronto, ON, Canada'], active: true },
    { company_name: 'B', title: 'SWE Intern', url: 'https://x/2', locations: ['Toronto, ON, Canada'], active: false },
    { company_name: 'C', title: 'SWE Intern', url: 'https://x/3', locations: ['Toronto, ON'], is_visible: false },
  ]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.company, 'A');
  assert.equal(jobs[0]?.location, 'Toronto, ON, Canada');
});
