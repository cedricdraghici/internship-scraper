# Job Tracker: Internships in Canada

A self-hosted job board for one person. It polls Greenhouse, Lever, Ashby, Workday,
curated GitHub internship lists and Job Bank on a schedule, keeps only Canadian
**software / DevOps / AI internships and co-ops**, dedupes them across sources, and
serves them as one filterable dashboard with per-job application tracking and push
notifications for new postings.

Full-time, new-grad and contract roles are dropped at scrape time and never reach the
database. Roughly 290 live postings at any time, from ~2,000 fetched per run.

**[Deploy your own](#deploy-your-own-247-with-phone-alerts)**, one script, about five
minutes, roughly $4/month on Fly (see [Cost](#cost)). Or run it locally for free:

```bash
npm install
npm run scrape     # fetch every source into data/jobs.db (~2 min)
npm run web        # dashboard at http://localhost:4000
```

Requires **Node 24+** (it uses the built-in `node:sqlite` module, no native deps, no
database server). See [CLAUDE.md](CLAUDE.md) for the design rationale.

Everything in the dashboard is an internship or co-op. The type dropdown narrows
between the two, but employers label the same job either way, so the default
(both) is usually what you want.

## Deploy your own (24/7, with phone alerts)

The result: a private URL that stays up whether or not your laptop is on, scrapes
itself every 5 minutes, and pushes a notification to your phone when a new internship
appears.

#### Cost

Fly removed its permanent free tier in 2024, so be clear-eyed about this. New accounts
get trial credit, and this app's footprint, one always-on shared-cpu-1x/512MB machine
plus a 1GB volume, runs roughly **$4/month** after the trial. Fly's stated policy is
not to bill accounts under about $5/month, but treat that as a courtesy rather than a
guarantee.

**With no card on file, you cannot be charged**: when the trial credit runs out Fly
suspends the app rather than billing you. The failure mode is your tracker going quiet,
not a surprise invoice, so back up the database before that happens (see the bottom of
this section), since the postings re-scrape in seconds but your applied/interview marks
don't.

Free alternatives, both with the same tradeoff, they only run while your machine is
awake, so overnight postings are missed:

- **Tailscale** (`tailscale serve 4000`), private to your devices, no account needed
  beyond Tailscale itself
- **Just run it locally**, `npm run serve` gives you the same scheduler and dashboard
  at `localhost:4000`; no notifications unless you set `JT_NTFY_TOPIC` yourself

ntfy itself is free and needs no account, wherever you host.

### 1. Install the Fly CLI and sign in

```bash
brew install flyctl                       # macOS
# curl -L https://fly.io/install.sh | sh  # Linux / WSL

fly auth signup                           # or: fly auth login
```

### 2. Run the setup script

```bash
git clone https://github.com/<you>/<this-repo>.git
cd <this-repo>
npm install
./setup.sh
```

It asks for an app name (Fly names are global, so pick something like
`yourname-job-tracker`), then creates the app, the volume, a random password, a random
ntfy topic, and deploys. Re-running it is safe: every step skips work already done.

When it finishes it prints your URL, password, and ntfy topic. **Save the password and
topic**, Fly stores secrets one-way and cannot show them again.

### 3. Get notifications on your phone

1. Install **ntfy**: [iOS](https://apps.apple.com/us/app/ntfy/id1625396347) ·
   [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)
2. Tap **+**, and enter the topic the script printed
3. Leave "Use another server" off, tap **Subscribe**

New postings arrive as a push with the job title and company; tapping one opens the
application page. Alerts are capped at 5 per scrape with a "+N more" summary, so the
first run on an empty database can't fire hundreds.

The topic name is the only thing protecting your alerts, anyone who knows it can read
them, so don't share it. That's why the script generates a random one.

### 4. Sign in

Open the URL. The browser asks for a username (anything, it's ignored) and the
password the script printed.

### Making it yours

Everything in [src/adapters/](src/adapters/) is a list you can edit:

| To change | Edit |
| --- | --- |
| Which companies are polled | `GREENHOUSE_BOARDS` / `LEVER_BOARDS` in [ats.ts](src/adapters/ats.ts), `ASHBY_BOARDS` in [ashby.ts](src/adapters/ashby.ts), `WORKDAY_BOARDS` in [workday.ts](src/adapters/workday.ts) |
| Which job titles count | `INCLUSIONS` / `EXCLUSIONS` in [roles.ts](src/lib/roles.ts) |
| Country / region filter | [canada.ts](src/lib/canada.ts), it's Canada-specific, so a different country means rewriting this |
| Internships vs all jobs | the student-track filter in [normalize.ts](src/lib/normalize.ts) |
| Scrape frequency | `JT_FAST_INTERVAL_MINUTES` / `JT_SLOW_INTERVAL_MINUTES` in [fly.toml](fly.toml) |

Run `npm test` after changing the filters, the tests cover the title rules with real
postings, including the false positives worth keeping out.

### Why the deploy looks the way it does

- **The volume** holds `jobs.db`. Without it every redeploy would wipe your
  applied/interview marks, the only data that can't be re-scraped.
- **`JT_PASSWORD`** gates the page *and* the API. Locally it's unset and the dashboard
  stays open; on a public URL it's the only thing keeping your application tracking
  private. Ten failed logins from one IP trigger a 15-minute lockout, though a correct
  password always gets through, a single-user board shouldn't lock out its owner.
- **`min_machines_running = 1`** keeps the scrape timer alive. Scaling to zero would
  suspend it between visits.
- **Two scrape schedules.** Workday takes ~106s for ~11 jobs; the other five sources
  take ~10s and supply nearly everything. Polling them together would mean either
  wasting two minutes a cycle or under-polling what matters. 5 minutes also matches
  GitHub's own `cache-control: max-age=300`, polling harder returns identical bytes.
- **A failed scrape is logged and skipped**, never fatal. A stale board beats no board.

To copy a local database up to the deployed volume (optional, a boot scrape fills an
empty one in ~15 seconds):

```bash
fly ssh sftp shell -C 'put data/jobs.db /data/jobs.db'
```

Backing it up the other way, worth doing once you've marked real applications:

```bash
fly ssh sftp get /data/jobs.db ./jobs-backup.db
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run scrape` | Fetch every default source (~30s) |
| `npm run scrape -- github simplify` | Fetch only named sources |
| `npm run scrape -- jobbank` | Job Bank is opt-in, see below |
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

- **Student track**, intern or co-op only. Full-time, new-grad and contract roles are
  discarded. An adapter that states the type outright (Ashby's `employmentType`) beats
  the title guess.
- **Role**, software engineer/developer, DevOps/SRE/platform, AI/ML engineer.
  Excludes sales/solutions engineers, other engineering disciplines, and management.
  English and French titles.
  Intern titles often drop the head word ("Backend Intern", "Engineering Co-op",
  "Stagiaire en développement de logiciels"), so those shapes match too, while
  `Internal Audit` and `International Tax` deliberately do not.
- **Canada**, province names and codes (`Toronto, ON`, `Havelock (ON)`), major cities,
  "Canada", and remote postings open to Canada. Ambiguous cases (bare `Vancouver`,
  `Remote - North America`) are kept and flagged `location?` in the UI rather than dropped.

Every job records `matched_by` and `canada_matched_by`, the rules that let it through -
so the filters can be tuned against real results.

## Sources

| Source | Method | Notes |
| --- | --- | --- |
| GitHub repos | Raw markdown tables | Canada-specific intern lists + international lists |
| SimplifyJobs / vanshb03 | Published `listings.json` | ~33k listings; the single best intern source |
| Greenhouse | Public JSON API | 34 verified boards |
| Lever | Public JSON API | Board tokens are per-company; verify before adding |
| Ashby | Public JSON API | Cohere, Wealthsimple, 1Password, Jobber, states `employmentType` |
| Workday | Public CXS JSON API | Banks/enterprises; boards configured by careers URL |
| Job Bank Canada | HTML search results | No API/RSS exists; honours `Crawl-delay: 5` |

### Where internships actually come from

The curated GitHub lists and SimplifyJobs supply the overwhelming majority. The ATS
adapters add employer-direct postings that never reach those lists, and are the only
sources that stay current between list updates.

**Job Bank is opt-in** (`npm run scrape -- jobbank`) and contributes nothing today. Its
listings are titled with normalized NOC occupation names ("software developer"), never
the employer's title, so "intern" and "stagiaire" never appear in a title; the
employment type exists only on each posting's detail page, one `Crawl-delay: 5` request
apiece. That cost it ~100s per run for zero internships once the tracker went
intern-only, so it's off the default path, still working, just not worth the wait.

Workday internship yield is seasonal, in August most bank/insurer "intern" hits are
`Internal Audit` and finance roles. Campus postings land there from roughly September.

Adding a company: run `npm run check-board -- <token>` and, if live, add it to
`GREENHOUSE_BOARDS` or `LEVER_BOARDS` in [src/adapters/ats.ts](src/adapters/ats.ts),
or `ASHBY_BOARDS` in [src/adapters/ashby.ts](src/adapters/ashby.ts).
Tokens are unguessable and companies migrate between platforms, so an empty result
usually means "moved", not "broken".

Adding a Workday employer: paste their real careers URL into `WORKDAY_BOARDS` in
[src/adapters/workday.ts](src/adapters/workday.ts), e.g.
`https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers`. The host/tenant/site triple
is not guessable (`rbc`, `telus` and `cgi` all 404 or 422, and Loblaw is under host
`myview`), so copy a URL that works in a browser rather than constructing one.

## Not implemented

LinkedIn, Indeed, and Glassdoor. All three block automated access and prohibit scraping
in their terms; a working adapter would need either paid API access or evasion. The
adapter interface is there if you get authorized access, see `Adapter` in
[src/types.ts](src/types.ts).

**Checked and rejected** (so they don't get re-tried):

| Source | Why not |
| --- | --- |
| SmartRecruiters | Has a cross-company search API (~20k postings, no token needed), but its relevance ranking ignores location entirely, 300 results sampled across `intern toronto`, `intern vancouver` and `stagiaire` returned **zero** Canadian rows. Finding them would mean paging the whole corpus. |
| Remotive, Himalayas | Remote-only boards, skewed senior and US. Two Canada-eligible rows between them, no internships. |
| Workable, Recruitee, Jobvite | Public endpoints respond but return no jobs for the Canadian companies checked. |

## Dedupe

Identity is `company + normalized-title + province`, so the same job from two sources
collapses into one row and the `sources` column lists both. Re-running a scrape is
idempotent. Your `status` and `notes` are never overwritten by a scrape.
