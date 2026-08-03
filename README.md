# Job Tracker — Canada

Personal job aggregator. Pulls software/DevOps/AI postings in Canada from ATS APIs,
GitHub job-list repos, and Job Bank Canada into one filterable dashboard.

See [CLAUDE.md](CLAUDE.md) for the design rationale.

## Quick start

```bash
npm install
npm run scrape     # fetch from all sources into data/jobs.db
npm run web        # dashboard at http://localhost:4000
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run scrape` | Fetch every source |
| `npm run scrape -- github jobbank` | Fetch only named sources |
| `npm run scrape -- --no-cache` | Bypass the 30-min response cache |
| `npm run web` | Serve the dashboard (read-only over the db) |
| `npm run check-board -- <token>` | Check whether a company has a live Greenhouse/Lever board |
| `npm test` | Run the matcher tests |
| `npm run typecheck` | `tsc --noEmit` |

## How it works

```
adapters ──► normalize (role filter + Canada filter) ──► dedupe ──► SQLite ──► web UI
```

A posting is kept only if it passes **both** filters:

- **Role** — software engineer/developer, DevOps/SRE/platform, AI/ML engineer.
  Internships and co-ops included. Excludes sales/solutions engineers, other
  engineering disciplines, and management. English and French titles.
- **Canada** — province names and codes (`Toronto, ON`, `Havelock (ON)`), major cities,
  "Canada", and remote postings open to Canada. Ambiguous cases (bare `Vancouver`,
  `Remote - North America`) are kept and flagged `location?` in the UI rather than dropped.

Every job records `matched_by` and `canada_matched_by` — the rules that let it through —
so the filters can be tuned against real results.

## Sources

| Source | Method | Notes |
| --- | --- | --- |
| Greenhouse | Public JSON API | 20 verified boards |
| Lever | Public JSON API | Board tokens are per-company; verify before adding |
| GitHub repos | Raw markdown tables | speedyapply, SimplifyJobs, vanshb03 lists |
| Job Bank Canada | HTML search results | No API/RSS exists; honours `Crawl-delay: 5` |

Adding a company: run `npm run check-board -- <token>` and, if live, add it to
`GREENHOUSE_BOARDS` or `LEVER_BOARDS` in [src/adapters/ats.ts](src/adapters/ats.ts).
Tokens are unguessable and companies migrate between platforms, so an empty result
usually means "moved", not "broken".

## Not implemented

LinkedIn, Indeed, and Glassdoor. All three block automated access and prohibit scraping
in their terms; a working adapter would need either paid API access or evasion. The
adapter interface is there if you get authorized access — see `Adapter` in
[src/types.ts](src/types.ts).

## Dedupe

Identity is `company + normalized-title + province`, so the same job from two sources
collapses into one row and the `sources` column lists both. Re-running a scrape is
idempotent. Your `status` and `notes` are never overwritten by a scrape.
