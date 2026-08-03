# Personal Job Board Aggregator

## What this is

A personalized job-hunting site for one user (me). It continuously pulls software/tech
job postings targeting **Canada** from every source I care about, normalizes them into a
single schema, dedupes them, and presents them in one fast, filterable dashboard.

The goal is to replace the daily ritual of checking eight different sites and three
GitHub READMEs with a single page that already knows what I'm looking for.

## Core idea

```
   sources ──► scrapers/fetchers ──► normalizer ──► dedupe ──► database
                                                                  │
                                                                  ▼
                                                      web UI (search/filter/track)
```

Each source gets its own adapter that knows how to fetch that source and map it to the
shared `JobPosting` shape. Adding a new source should mean writing one adapter, not
touching the rest of the system. A scheduler runs the adapters on a recurring basis;
the UI only ever reads from the database, never live-scrapes.

## Sources to cover

**ATS / job board APIs** (structured, reliable — do these first)
- Greenhouse — public job board API per company (`boards-api.greenhouse.io`)
- Lever, Ashby, Workday, SmartRecruiters, Recruitee — same pattern, worth adding
- Maintain a list of Canadian-relevant companies to poll

**Aggregators** (harder, often anti-bot — treat as best-effort)
- LinkedIn Jobs
- Indeed (Canada)
- Glassdoor
- Job Bank Canada (`jobbank.gc.ca`) — government, has a public feed, very Canada-relevant

**GitHub repo listings** (markdown tables, easy to parse, high signal)
- https://github.com/speedyapply/2027-SWE-College-Jobs/blob/main/INTERN_INTL.md
- Other repos in the same family (new-grad lists, internship lists, Canada-specific lists)
- Fetch raw markdown, parse the table rows, extract company / role / location / link / date

## Roles to target

Three filters decide whether a posting is kept: **is it an internship**, **is it in
Canada** (below), and **is it a role I want** (here). All three must pass.

**Internships and co-ops only.** Full-time, new-grad and contract roles are dropped at
scrape time and never enter the database — this is a tracker for student positions, not
a general job board. Intern and co-op mean the same thing here; employers just word
them differently.

Titles to match:
- Software Developer / Software Engineer (and SDE, SWE)
- Developer — generically, including front-end, back-end, full-stack, mobile, web
- DevOps — plus the adjacent titles that mean the same job: SRE, Site Reliability,
  Platform Engineer, Infrastructure Engineer, Cloud Engineer
- AI Engineer / AI Developer — plus ML Engineer, Machine Learning Engineer,
  Applied Scientist when the role is engineering rather than pure research

Match on normalized titles (lowercase, strip punctuation) and allow seniority and
qualifier words around the core term — "Senior Software Engineer, Backend",
"Software Engineer Intern (Summer 2027)", and "Software Developer Co-op" all match.

Watch the false positives: "Sales Engineer", "Solutions Engineer", "Customer Engineer",
"Hardware Engineer", "Software Engineering Manager", and recruiter-spam listings are not
what I'm after. Keep an explicit exclusion list next to the match list, and prefer
flagging borderline titles over silently dropping them — the same principle as the
Canada filter.

Record on each posting **why** it matched (which rule fired) so the filter can be tuned
by looking at real results instead of guessing.

## Normalized job shape

Every adapter outputs this, whatever the source looks like:

- `id` — stable hash used for dedupe
- `title`, `company`, `location` (+ parsed province, `remote` flag)
- `url` (canonical application link), `source`, `posted_at`, `first_seen_at`
- `salary` (raw + parsed range/currency when available)
- `type` — intern / co-op (the other values exist in the classifier, but anything that
  isn't one of these two is filtered out before storage)
- `role_category` — swe / devops / ai-ml, derived from the title match rules
- `matched_by` — which title rule fired, for tuning the filter
- `sponsorship` / `citizenship` notes when the source states them
- `description` (raw text for keyword search)
- `status` — my own tracking: new / applied / interview / rejected / offer

## Canada filtering

This is the whole point, so be deliberate about it. Match on province names and
abbreviations, major cities, "Canada", "Remote (Canada)", and known Canadian office
locations. Handle the messy cases: multi-location postings, "Remote - North America",
and US-only roles that mention a Canadian HQ. When a posting is ambiguous, keep it but
flag it rather than silently dropping it.

## What the site should do

- One dashboard listing everything, newest first
- Filter by source, location/province, remote, job type (intern vs co-op),
  role category (swe / devops / ai-ml), salary, keyword, date posted
- Saved searches and a "new since last visit" view
- Per-job status tracking so I can mark applied/rejected and not see it again
- Show which source(s) a job came from, and link out to the original posting
- Ideally: a digest (email or just a page section) of new matches since yesterday

## Scraping principles

- Prefer official/public APIs and RSS over HTML scraping wherever one exists
- Respect `robots.txt` and rate limits; back off on errors, cache aggressively
- Expect aggregator scrapers to break — isolate failures so one dead adapter doesn't
  take down the run, and log which sources succeeded
- Never scrape behind a login or paywall
- Store raw responses so parsing can be re-run without re-fetching

## Stack

Not decided yet — pick something simple and self-hostable. Reasonable default:
a TypeScript/Python backend for the scrapers, SQLite or Postgres for storage, and a
lightweight web frontend. Optimize for "I can run this on a cron and forget about it."

## Build order

1. Shared `JobPosting` schema + storage + dedupe
2. GitHub markdown adapters (easiest, immediate value)
3. Greenhouse and other ATS adapters
4. Job Bank Canada
5. Minimal web UI over the database
6. Aggregator scrapers (LinkedIn / Indeed / Glassdoor) — hardest, do last
7. Scheduling, status tracking, digests
