/**
 * Push notifications for new postings, via ntfy.sh.
 *
 * ntfy needs no account and no phone number: you subscribe the app to a topic name,
 * and anything POSTed to that topic arrives as a push notification. The topic name IS
 * the credential, anyone who knows it can read your alerts, so JT_NTFY_TOPIC should
 * be long and random, and it lives in fly secrets rather than in this repo.
 *
 * Disabled when JT_NTFY_TOPIC is unset, which is the default locally.
 */

import type { JobPosting } from '../types.js';

const NTFY_SERVER = process.env.JT_NTFY_SERVER ?? 'https://ntfy.sh';

/** Cap per run: a first scrape inserts hundreds of jobs and shouldn't blast hundreds of pushes. */
const MAX_NOTIFICATIONS = Number(process.env.JT_NTFY_MAX ?? 5);

function summarise(job: JobPosting): string {
  const bits = [job.company, job.location].filter(Boolean);
  return bits.join(' · ');
}

/**
 * Announce newly-inserted postings. Never throws, a failed notification must not
 * fail the scrape that produced it.
 */
export async function notifyNewJobs(jobs: JobPosting[]): Promise<void> {
  const topic = process.env.JT_NTFY_TOPIC;
  if (!topic || jobs.length === 0) return;

  const url = `${NTFY_SERVER}/${topic}`;
  const shown = jobs.slice(0, MAX_NOTIFICATIONS);

  try {
    for (const job of shown) {
      await fetch(url, {
        method: 'POST',
        headers: {
          Title: job.title.slice(0, 120),
          // Tapping the notification opens the actual application page.
          Click: job.url,
          Tags: 'briefcase',
        },
        body: summarise(job),
      });
    }

    // One summary line instead of 200 separate pushes.
    const rest = jobs.length - shown.length;
    if (rest > 0) {
      await fetch(url, {
        method: 'POST',
        headers: { Title: `+${rest} more new postings`, Tags: 'briefcase' },
        body: 'Open the dashboard to see them all.',
      });
    }
  } catch (err) {
    console.error('notify failed:', err instanceof Error ? err.message : String(err));
  }
}
