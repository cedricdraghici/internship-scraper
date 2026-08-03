/** Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.js';
import type { RawJob } from '../types.js';

function raw(over: Partial<RawJob>): RawJob {
  return {
    title: 'Software Engineer Intern',
    company: 'Acme',
    location: 'Toronto, ON',
    remote: false,
    url: 'https://example.com/1',
    source: 'test',
    postedAt: null,
    salaryRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    type: null,
    sponsorship: null,
    description: null,
    ...over,
  };
}

test('normalize: keeps only internships and co-ops', () => {
  const { keptJobs, droppedNotStudent } = normalize([
    raw({ title: 'Software Engineer Intern', url: 'https://x/1' }),
    raw({ title: 'Software Developer Co-op', url: 'https://x/2' }),
    raw({ title: 'Senior Software Engineer', url: 'https://x/3' }),
    raw({ title: 'Software Engineer, New Grad', url: 'https://x/4' }),
  ]);

  assert.equal(keptJobs.length, 2);
  assert.equal(droppedNotStudent, 2); // the senior and new-grad roles
  assert.deepEqual(
    keptJobs.map((j) => j.type).sort(),
    ['co-op', 'intern'],
  );
});

test('normalize: an adapter-supplied type outranks the title guess', () => {
  // Ashby states employmentType outright; a title with no intern wording still counts.
  const { keptJobs } = normalize([
    raw({ title: 'Software Engineer, Platform', type: 'intern', url: 'https://x/5' }),
  ]);
  assert.equal(keptJobs.length, 1);
  assert.equal(keptJobs[0]?.type, 'intern');
});

test('normalize: postings older than the cutoff never enter the database', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const { keptJobs, droppedStale } = normalize([
    raw({ title: 'Software Engineer Intern', postedAt: daysAgo(2), url: 'https://x/1' }),
    raw({ title: 'Software Engineer Intern', postedAt: daysAgo(29), url: 'https://x/2', company: 'B' }),
    raw({ title: 'Software Engineer Intern', postedAt: daysAgo(45), url: 'https://x/3', company: 'C' }),
    raw({ title: 'Software Engineer Intern', postedAt: daysAgo(400), url: 'https://x/4', company: 'D' }),
    // No date: kept, since a third of rows come from lists with no date column and
    // rejecting them would discard current postings too.
    raw({ title: 'Software Engineer Intern', postedAt: null, url: 'https://x/5', company: 'E' }),
  ]);

  assert.equal(droppedStale, 2);
  assert.deepEqual(keptJobs.map((j) => j.company).sort(), ['Acme', 'B', 'E']);
});

test('normalize: non-Canadian internships are still dropped', () => {
  const { keptJobs, droppedNotCanada } = normalize([
    raw({ title: 'Software Engineer Intern', location: 'Austin, TX', url: 'https://x/6' }),
  ]);
  assert.equal(keptJobs.length, 0);
  assert.equal(droppedNotCanada, 1);
});
