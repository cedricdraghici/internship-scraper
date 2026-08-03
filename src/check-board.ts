/**
 * Board token checker — board tokens are per-company and unguessable, so verify
 * before adding one to src/adapters/ats.ts.
 *
 *   npm run check-board -- shopify hootsuite cohere
 */

export {}; // make this a module so top-level await typechecks

interface Probe {
  platform: 'greenhouse' | 'lever';
  url: (t: string) => string;
  count: (body: string) => number;
}

const PROBES: Probe[] = [
  {
    platform: 'greenhouse',
    url: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=false`,
    count: (b) => (JSON.parse(b) as { jobs?: unknown[] }).jobs?.length ?? 0,
  },
  {
    platform: 'lever',
    url: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
    count: (b) => {
      const d = JSON.parse(b) as unknown;
      return Array.isArray(d) ? d.length : 0;
    },
  },
];

const tokens = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (tokens.length === 0) {
  console.error('Usage: npm run check-board -- <token> [token...]');
  process.exit(1);
}

for (const token of tokens) {
  const hits: string[] = [];
  for (const probe of PROBES) {
    try {
      const res = await fetch(probe.url(token), {
        headers: { 'user-agent': 'job-tracker/0.1', accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const n = probe.count(await res.text());
      // An empty array usually means the company migrated off that platform.
      if (n > 0) hits.push(`${probe.platform} (${n} postings)`);
      else hits.push(`${probe.platform} (empty — likely migrated away)`);
    } catch {
      /* not on this platform */
    }
  }
  console.log(hits.length ? `✓ ${token}: ${hits.join(', ')}` : `✗ ${token}: not found`);
}
