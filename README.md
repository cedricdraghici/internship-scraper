# Job Tracker — Internships, Canada

Personal job aggregator. Pulls software/DevOps/AI **internship and co-op** postings in
Canada from ATS APIs, GitHub job-list repos, and Job Bank Canada into one filterable
dashboard. Full-time, new-grad and contract roles are dropped at scrape time and never
reach the database.

See [CLAUDE.md](CLAUDE.md) for the design rationale.

## Quick start

```bash
npm install
npm run scrape     # fetch from all sources into data/jobs.db (~2 min)
npm run web        # dashboard at http://localhost:4000
```

Everything in the dashboard is an internship or co-op. The type dropdown narrows
between the two, but employers label the same job either way, so the default
(both) is usually what you want.

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
adapters ──► normalize (intern + role + Canada filters) ──► dedupe ──► SQLite ──► web UI
```

A posting is kept only if it passes **all three** filters:

- **Student track** — intern or co-op only. Full-time, new-grad and contract roles are
  discarded. An adapter that states the type outright (Ashby's `employmentType`) beats
  the title guess.
- **Role** — software engineer/developer, DevOps/SRE/platform, AI/ML engineer.
  Excludes sales/solutions engineers, other engineering disciplines, and management.
  English and French titles.
  Intern titles often drop the head word ("Backend Intern", "Engineering Co-op",
  "Stagiaire en développement de logiciels"), so those shapes match too — while
  `Internal Audit` and `International Tax` deliberately do not.
- **Canada** — province names and codes (`Toronto, ON`, `Havelock (ON)`), major cities,
  "Canada", and remote postings open to Canada. Ambiguous cases (bare `Vancouver`,
  `Remote - North America`) are kept and flagged `location?` in the UI rather than dropped.

Every job records `matched_by` and `canada_matched_by` — the rules that let it through —
so the filters can be tuned against real results.

## Sources

| Source | Method | Notes |
| --- | --- | --- |
| GitHub repos | Raw markdown tables | Canada-specific intern lists + international lists |
| SimplifyJobs | Published `listings.json` | ~14.6k listings; the single best intern source |
| Greenhouse | Public JSON API | 32 verified boards |
| Lever | Public JSON API | Board tokens are per-company; verify before adding |
| Ashby | Public JSON API | Cohere, Wealthsimple, 1Password, Jobber — states `employmentType` |
| Workday | Public CXS JSON API | Banks/enterprises; boards configured by careers URL |
| Job Bank Canada | HTML search results | No API/RSS exists; honours `Crawl-delay: 5` |

### Where internships actually come from

The curated GitHub lists and SimplifyJobs supply the overwhelming majority. The ATS
adapters add employer-direct postings that never reach those lists, and are the only
sources that stay current between list updates.

**Job Bank is not an internship source.** Its listings are titled with normalized NOC
occupation names ("software developer"), never the employer's title, so "intern" and
"stagiaire" never appear in a title; the employment type exists only on each posting's
detail page, one `Crawl-delay: 5` request apiece. It's kept as a broad full-time source.

Workday internship yield is seasonal — in August most bank/insurer "intern" hits are
`Internal Audit` and finance roles. Campus postings land there from roughly September.

Adding a company: run `npm run check-board -- <token>` and, if live, add it to
`GREENHOUSE_BOARDS` or `LEVER_BOARDS` in [src/adapters/ats.ts](src/adapters/ats.ts),
or `ASHBY_BOARDS` in [src/adapters/ashby.ts](src/adapters/ashby.ts).
Tokens are unguessable and companies migrate between platforms, so an empty result
usually means "moved", not "broken".

Adding a Workday employer: paste their real careers URL into `WORKDAY_BOARDS` in
[src/adapters/workday.ts](src/adapters/workday.ts) — e.g.
`https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers`. The host/tenant/site triple
is not guessable (`rbc`, `telus` and `cgi` all 404 or 422, and Loblaw is under host
`myview`), so copy a URL that works in a browser rather than constructing one.

## Not implemented

LinkedIn, Indeed, and Glassdoor. All three block automated access and prohibit scraping
in their terms; a working adapter would need either paid API access or evasion. The
adapter interface is there if you get authorized access — see `Adapter` in
[src/types.ts](src/types.ts).

## Dedupe

Identity is `company + normalized-title + province`, so the same job from two sources
collapses into one row and the `sources` column lists both. Re-running a scrape is
idempotent. Your `status` and `notes` are never overwritten by a scrape.
