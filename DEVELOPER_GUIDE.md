# y/labs - Developer Guide

> **Live site:** [yalelabs.io](https://yalelabs.io/) · **Beta:** [ylabs-gr4v.onrender.com](https://ylabs-gr4v.onrender.com) · **Repo:** [YaleComputerSociety/ylabs](https://github.com/YaleComputerSociety/ylabs)

> This guide covers setup, architecture, and reference.
> If you are new, start with [docs/onboarding.md](docs/onboarding.md), which sequences this guide into a first week.
> For how work gets picked up and landed, read [CONTRIBUTING.md](CONTRIBUTING.md).
> For the product and pipeline vocabulary used throughout this guide and the issue tracker, read [docs/glossary.md](docs/glossary.md).

## What Is This?

y/labs is a **Yale research discovery platform**. Students discover Yale research, source-backed evidence, planning context, and structured programs/fellowships. The product is not a listings board; the legacy Listings surface and public Pathways page are retired.

---

## Architecture

```
React (Vite) → Express (Passport.js) → MongoDB Atlas + Meilisearch
                    ↓
            External APIs: Yale CAS, Yalies, CourseTable, OpenAI (via Meilisearch)
```

The server follows: **Routes → Middleware → Controllers → Services → Models**

### Tech Stack

| Layer           | Technology                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Client          | React 19, TypeScript 6, Vite 8, React Router v7, MUI v9, TailwindCSS v4                          |
| Server          | Express 5, TypeScript 6, Passport.js (CAS strategy), Mongoose 9                                  |
| Search          | Meilisearch (keyword plus semantic search via OpenAI `text-embedding-3-small` where appropriate) |
| Database        | MongoDB Atlas (single cluster, separate databases per environment)                               |
| Package Manager | Yarn 4 via Corepack                                                                              |

---

## Environments

Code flows **Local → Beta → Prod**. Beta is the staging gate.

| Environment | Hosting            | MongoDB Database | Meilisearch                   | `MEILISEARCH_INDEX_PREFIX`                         |
| ----------- | ------------------ | ---------------- | ----------------------------- | -------------------------------------------------- |
| Local       | localhost          | `Development`    | Docker (`localhost:7700`)     | _(unset)_ → bare `researchentities`   |
| Beta        | Render (free tier) | `Beta`           | Shared Render private service | `beta` → `beta_researchentities` |
| Prod        | Render (starter)   | `Production`     | Shared Render private service | `prod` → `prod_researchentities` |

- MongoDB: one Atlas cluster, three databases. `MONGODBURL` points to the right one per environment.
- Meilisearch: beta and prod share one Render private service, isolated by index prefixes. Local uses its own Docker container.

---

## Local Development Setup

These instructions assume a Unix-like shell. Mac developers can run them in Terminal. Windows developers should run them inside WSL, with the repo stored in the Linux filesystem rather than `/mnt/c/...`.

### Prerequisites

- Node.js at the major in `.node-version`
- Corepack, installed separately because Node 25 and later no longer ship it
- Yarn 4, activated through Corepack
- Docker Desktop (for local Meilisearch)
- The GitHub CLI, `gh`, with the guard shim ahead of it on `PATH`: run `scripts/install-gh-identifier-guard.sh` once, and `command -v gh` must then print `~/.local/bin/gh`. The installer fails when another `gh` comes first, which is the default on macOS until `~/.local/bin` is put first in your shell profile.

### 1. Fresh machine setup

On a brand new Unix/WSL environment, install the basic system packages first:

```bash
sudo apt update
sudo apt install -y curl git ca-certificates build-essential python3 make g++
```

On macOS, install the Xcode command line tools instead, which provide `git`, `make`, and a compiler:

```bash
xcode-select --install
```

Use `nvm` for Node. Avoid `apt install nodejs`, which often installs an older Node version than this repo supports.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
```

Restart your shell, then install and select the major this repository runs on.
`.node-version` at the repository root is the single declaration of that major, read by CI's `setup-node` and by the hosting provider, so take the number from the file rather than from this page:

```bash
nvm install "$(cat .node-version)"
nvm use "$(cat .node-version)"
nvm alias default "$(cat .node-version)"
node -v
npm -v
```

Install and enable Corepack. Node 25 and later no longer ship it, so install the version CI pins in `.github/workflows/ci.yml` first.
Corepack reads the `packageManager` field in `package.json` and installs that exact Yarn version the first time you run a `yarn` command inside the repo, so you do not name a Yarn version yourself:

```bash
npm install -g corepack@0.36.0
corepack enable
yarn -v
```

Expected versions:

- `node` should match `.node-version`. CI tests that major only, so a different one is untested here (#3915).
An older major does not merely go untested: on Node 20 every client test file fails to start with `ReferenceError: Iterator is not defined`, because `jsdom` 30 needs the `Iterator` global from Node 22 and later.
If you see that error, your shell is on the wrong Node; rerun the `nvm use` and `nvm alias default` lines above and open a new shell.
- `yarn` should match the `packageManager` field in `package.json`, which is the only place the version is pinned. Read it with `node -p "require('./package.json').packageManager"` rather than trusting a number written here, because a number written here goes stale on the next bump.

### 2. Install dependencies

```bash
bash scripts/install-all.sh
```

The script runs the `yarn install` builtin in the root, `server`, and `client`.
Do not use `yarn install:all` for the first install: Yarn cannot run any `package.json` script before an install has created its state file, so on a fresh checkout every script, `install:all` included, fails before it installs anything.
Once the root is installed, `yarn install:all` calls the same script.

### 3. Configure environment

There are two data paths, and the local one is the default.

**Local MongoDB (no credentials).** One command starts a local MongoDB and Meilisearch in Docker, writes `server/.env.local`, and seeds both with the synthetic smoke rows:

```bash
yarn local:setup        # docker compose: mongodb + meilisearch, then yarn local:seed
yarn dev:server:local   # API on the ylabs_local database
cp client/.env.example client/.env
yarn dev:client         # http://localhost:3000/research shows synthetic cards
```

- `server/.env.local` is created from `server/.env.local.example` with mode 0600 and a generated `SESSION_SECRET`, and is gitignored.
- The `local` data profile (`scripts/run-data-profile.mjs`) accepts only a `localhost`, `127.0.0.1` or `::1` host and only the `ylabs_local` database, and refuses anything else, so it can never be pointed at Development.
- It blanks every other key `server/.env` declares, so a credentialed `server/.env` beside it cannot leak a Development URL into the local server.
- It sets `MEILISEARCH_INDEX_PREFIX=ylabs_local`, so the local index never replaces the bare `researchentities` index a Development-backed server reads.
- `yarn local:seed` re-runs `db:build-indexes --apply`, `e2e:seed-smoke` and the index rebuild through that profile. Data persists in the `mongo_data` volume.
- `yarn --cwd server e2e:seed-smoke` refuses any database named for an operator environment (Development, Beta, Production, production-copy), and any non-local host unless `ALLOW_REMOTE_E2E_SEED=true` names a disposable remote database.

Use the local path for serve-time work: DTOs, visibility, sanitizers and client rendering.

**Development (credentials from a maintainer).** Data work, and anything that needs the real corpus, runs against the shared Development database.
Copy the example and fill in credentials:

```bash
cp server/.env.example server/.env
```

Your local `.env` should point to:

- `MONGODBURL` → the `Development` database on Atlas. This is the one the server actually boots on: `initializeConnections` throws `MONGODBURL is required` without it. The `DEVELOPMENT_MONGODBURL`, `BETA_MONGODBURL`, and `PRODUCTION_MONGODBURL` entries in the same file name the two ends of a cross-environment copy or comparison and are read by no request path, so setting only those leaves you with a server that cannot start.
- `MEILISEARCH_HOST` → `http://localhost:7700`
- `MEILISEARCH_API_KEY` → `local_development_master_key`, the local Compose master key
- No `MEILISEARCH_INDEX_PREFIX` (local uses the bare `researchentities` index)

For the client, copy its example too:

```bash
cp client/.env.example client/.env
```

The default `VITE_APP_SERVER=http://localhost:4000` is correct for local work and is the only variable the client needs. The `VITE_SENTRY_*` entries are optional and commented out; with no DSN the client skips Sentry initialization rather than failing.

Ask a project maintainer for the development MongoDB and API credentials when you need real data. Do not commit `server/.env`, `server/.env.local` or `client/.env`.
A server booted against Development writes to it: a dev-login creates a user row, and the corpus snapshot scheduler records a `CorpusQualitySnapshot` row when the newest one is over a day old.

### 4. Start local Meilisearch

Start the local Docker Compose service:

```bash
yarn meili:up
```

Verify it's running:

```bash
yarn meili:health
# Should return: {"status":"available"}
```

Data persists in the `meili_data` volume - you only need to seed once.
The local Compose service uses `local_development_master_key`, matching `server/.env.example`.

On Windows, install Docker Desktop on Windows and enable WSL integration for your Linux distribution. Run the `docker` commands from inside WSL.

### 5. Seed Meilisearch

```bash
yarn meili:seed
```

This rebuilds the local Research index from MongoDB.
The rebuild builds every document into a fresh staging index, confirms its document count, and swaps it in, so search never serves an empty or partial index.
For Beta and Production follow `docs/meilisearch-reindex-runbook.md`; there a rebuild refuses to run without `OPENAI_API_KEY` when the live index has a stored embedder.

**`OPENAI_API_KEY` is optional for setup.** The rebuild configures a Meilisearch embedder only when that variable holds a real key; when it is unset, blank, or still a `<...>` placeholder, the rebuild removes any embedder already stored on the unprefixed local index and logs that search is keyword-only (a prefixed Beta or Production index keeps its stored embedder), so seeding succeeds either way and an index seeded earlier with a key follows the environment on the next seed. Without a key you get a fully working keyword index and no semantic search; with one you also get embeddings. Semantic search is not behind a boolean flag: `isResearchEntitySearchEmbedderConfigured` asks Meilisearch whether the embedder exists on the index, so the capability follows the seed rather than an environment setting. A newcomer can complete every step below without an OpenAI key.
Research relevance also depends on `researchentities` settings and documents: topic/name/tag fields are searched before description text, student-topic aliases are indexed in `studentSearchTerms`, and short aliases such as `ai`, `ml`, `nlp`, and `cv` disable typo expansion and search only topic-oriented fields.

When a `/research` browse has no search query, results are ordered "best first" by a precomputed `browseRankScore` (profile completeness plus served enrichment), with ties broken on a fixed per-row key; see [Search and data](skills/search-data/SKILL.md#default-research-ordering). After importing or migrating data, populate the score with `yarn --cwd server research-homes:backfill-browse-rank --apply --confirm-browse-rank` (it runs in dry-run by default); ongoing scrape/materialize runs keep it fresh automatically.

Organizational research entities (centers, institutes, initiatives, core facilities) have no single PI, so their scraped rosters initially list everyone as core faculty.
The `center-director-llm` scraper reads each home's official site and leadership pages, extracts the single named **director**, and the materializer resolves that name to a canonical `Researcher` before promoting them to a director (lead) member.
New scrape/materialize runs apply this automatically; to fill in the existing corpus run `yarn --cwd server research-homes:backfill-center-directors --apply --confirm-center-directors --limit <n>` (dry-run by default, lists eligible homes without calling the LLM; apply needs `OPENAI_API_KEY`).

Non-lead current-team context comes only from the disabled-by-default `official-research-home-roster` source and its reviewed entity/page/section allowlist.
Run a bounded dry run with `yarn --cwd server scrape run --source official-research-home-roster --only <research-entity-key> --limit 1` and materialize only after reviewing the source output.
Broad enablement requires the structural and sampled-precision audit: `yarn --cwd server research-homes:audit-rosters --strict --sampled-precision-reviewed-by="<reviewer>"`, which reports `broadEnablementReady` and exits non-zero until both halves are satisfied (#2412).
The public detail API returns at most 24 fresh verified roster members, grouped by coarse role, along with a `roster` disclosure whose status is `current`, `partial`, `withheld`, `no-verified-data`, or `optional-source-failure`.
Failed, empty, stale, or ambiguous refreshes do not imply an empty team and do not archive the last verified roster.

### 6. Start dev servers

```bash
yarn dev:client    # Vite on port 3000
yarn dev:server    # Express with tsx watch on port 4000
```

Run these in two separate terminals.

### 7. Verify setup

Cheap checks first, so a broken step is obvious before you spend twenty minutes on the suites:

```bash
yarn meili:health   # {"status":"available"}
yarn verify:fast    # format:check, lint, tsc on both projects
```

Then confirm the app actually serves data, which is the check that catches a wrong `MONGODBURL` or an unseeded index:

- `yarn dev:server` boots with `Connected to database` and no `MONGODBURL is required`.
- `yarn dev:client`, then `http://localhost:3000/research` renders cards with real descriptions rather than an empty list.
- `http://localhost:4000/api/dev-login` gives you a session. A direct visit carries no `Referer`, so it returns you to `http://localhost:3000`; add `?redirect=http://localhost:<client-port>/` to land on another client port, which is the URL `scripts/new-agent-worktree.sh` prints.

The full suites take a while and are the last step rather than the first:

```bash
yarn test           # both suites, server then client
```

### Troubleshooting Yarn setup

If an install fails with an error like:

```txt
Usage Error: Couldn't find the node_modules state file - running an install might help (findPackageLocation)
```

a `package.json` script ran before the root project was installed.
Yarn 4 cannot run any script, `yarn install:all`, `yarn build`, or `yarn serve:fresh` among them, until an install has created that state file, and a fresh checkout has none.
Run the builtin installs instead, which is what CI does:

```bash
bash scripts/install-all.sh
```

If `yarn` or `corepack` is not found, Corepack is missing, because Node 25 and later no longer ship it.
Install the pinned version and enable it, then rerun the install:

```bash
npm install -g corepack@0.36.0
corepack enable
yarn -v
```

### Dev login bypass

Visit `http://localhost:4000/api/dev-login` to log in as a test user (`test123` / `undergraduate`) without CAS - `undergraduate` (not the legacy generic `student`) since that's what every real account in the database actually is. Use `?userType=admin` for the `devadmin` account (which mints an idempotent local bootstrap `AdminGrant`, so dev admin authority comes from a real grant rather than a `userType` shortcut), `?userType=professor` (or `faculty`) for the `devprofessor` account, `?userType=graduate` for the `devgraduate` account, or `?userType=unknown` for the `devunknown` account. Dev login is allowed only when `NODE_ENV=development` and `SERVER_BASE_URL` points at localhost or loopback; the Mongo database name does not control this local-runtime check. It is also scoped to your own machine: the request must arrive over loopback and carry a localhost `Host` header, and any other caller gets the ordinary `404 {"error":"Not found"}`.

For request-level local testing, set `LOCAL_AUTH_BYPASS=true` in `server/.env`. In `development` or `test` only, protected `/api` requests without a session receive a dev admin user by default:

```bash
LOCAL_AUTH_BYPASS_NETID=devadmin
LOCAL_AUTH_BYPASS_USER_TYPE=admin
```

If the selected local bypass user does not exist, the first request creates a synthetic confirmed and verified user so authenticated services can resolve it from MongoDB.
Per-request overrides are available with `x-dev-netid` and `x-dev-user-type` headers, and like dev login the bypass and those headers apply only to a loopback caller with a localhost `Host` header. `/api/cas` and `/api/logout` are not bypassed, so leave `LOCAL_AUTH_BYPASS=false` or visit those routes directly when testing Yale CAS behavior.

The auth flow's verbose tracing (per-request deserialization, the find-or-create source cascade, analytics-event confirmations) is off by default - set `AUTH_DEBUG=true` in `server/.env` to turn it on when debugging an auth issue. Genuine auth errors and anomalies log regardless of the flag.

---

## Common Commands

| Command                                                                                                                                    | Description                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `bash scripts/install-all.sh`                                                                                                              | Install deps in root + server + client, also on a fresh checkout                      |
| `yarn dev:client`                                                                                                                          | Vite dev server (port 3000)                                                           |
| `yarn dev:server`                                                                                                                          | Express with tsx watch (port 4000)                                                    |
| `yarn build`                                                                                                                               | Full production build                                                                 |
| `yarn start`                                                                                                                               | Run both servers in production mode                                                   |
| `yarn clean:all`                                                                                                                           | Remove all node_modules                                                               |
| `yarn test`                                                                                                                                | Both test suites, server then client, sequentially                                    |
| `yarn test:server`                                                                                                                         | Server suite only                                                                     |
| `yarn test:client`                                                                                                                         | Client suite only                                                                     |
| `yarn serve:fresh`                                                                                                                         | Clean install, build, and serve (smoke check, not a test run)                          |
| `yarn --cwd client test`                                                                                                                   | Run Vitest in watch mode                                                              |
| `yarn --cwd client test:ci`                                                                                                                | Run Vitest once (used by CI)                                                          |
| `yarn --cwd server test`                                                                                                                   | Run server Vitest tests                                                               |
| `npx tsc --noEmit -p server/tsconfig.json`                                                                                                 | Server typecheck                                                                      |
| `yarn --cwd server beta:readiness --confirm-beta-backup`                                                                                   | Read-only Beta release gate; exits non-zero on any blocked gate                       |
| `yarn --cwd server beta:data-quality --include-samples`                                                                                    | Read-only Beta data-quality scorecard                                                 |
| `yarn --cwd server research-entity:audit-public-descriptions --strict --include-samples --output /tmp/ylabs-public-description-audit.json` | Audit the post-sanitization description invariant for student-ready research entities |
| `yarn --cwd server model-refactor:inventory --environment beta`                                                                            | Read-only research-model collection, field, and reference inventory                   |
| `yarn model-refactor:search-baseline:beta --profile-dir <dir> --output <new-tmp-json>`                                                     | Protected read-only Beta ResearchEntity search baseline                               |
| `yarn --cwd server scraper:integrity-gate --include-samples`                                                                               | Read-only scraper materialization integrity gate                                      |
| `SCRAPER_ENV=beta yarn --cwd server gates:refresh`                                                                                         | Regenerate every canonical gate scorecard the operator board reads (single writer)    |

### Operator board Gate Status - keeping it honest and current

The admin operator board (the **Gate Status** panel on the admin `/analytics` page) reads canonical gate scorecard
JSON from fixed `/tmp` paths. It does not compute gates live; it shows whatever was last written
there. Two rules keep it trustworthy:

- **Honesty:** every gate card shows provenance (which DB, how long ago it was generated). A
  scorecard older than `GATE_SCORECARD_MAX_AGE_HOURS` (default 3) is flagged **stale** and the gate
  reads "rerun" rather than presenting a possibly-moved-on verdict as live.
- **Freshness:** run `gates:refresh` to regenerate all canonical scorecards - it is the **only**
  sanctioned writer of those paths. Ad-hoc audits should write to suffixed scratch files (e.g.
  `--output /tmp/ylabs-...-scratch.json`), never the canonical paths, so the board never drifts.
  To keep the board current automatically on a single instance, set `GATE_REFRESH_INTERVAL_MINUTES`
  (the server then runs `gates:refresh` in-process on that cadence; `GATE_REFRESH_SKIP_HEAVY=true`
  skips the slow data-quality audit). For multi-instance/production, drive refresh from an external
  scheduler or persist scorecards to MongoDB.

### Scraper And Data Scripts

Use the server workspace scripts for current data flows:

```bash
yarn scrape help
yarn meili:seed
```

The research-model refactor inventory, search-baseline, and query-cost tools are read-only.
Follow [`docs/research-model-refactor-phase0.md`](docs/research-model-refactor-phase0.md) for protected Beta and ProductionCopy profiles, required environment labels, guarded JSON output, report interpretation, and rollback prerequisites.

One-off data work belongs in `server/src/scripts/`, wired as a `package.json`
command, dry-run by default, with apply gated behind an explicit confirm flag.
Write JSON reports through `resolveSafeJsonReportOutputPath` so artifacts stay
under a safe root. The standalone `data-migration/` package was retired.

---

## Project Structure

```
yale-research/
├── package.json              # Root scripts: install:all, dev:client, dev:server, build, start
├── DEVELOPER_GUIDE.md        # This file - developer guide
├── AGENTS.md                 # Compact agent-facing entry point
├── skills/                   # On-demand agent skills for product, architecture, search, auth, scrapers, and workflow
├── client/                   # React frontend (Vite, port 3000)
│   └── src/
│       ├── pages/            # Route-level components
│       ├── components/       # UI components (admin/, accounts/, fellowship/, profile/, shared/)
│       ├── contexts/         # React Context definitions
│       ├── providers/        # Context providers with data fetching
│       ├── hooks/            # Custom hooks
│       ├── types/            # TypeScript interfaces
│       └── utils/            # Helpers, axios instance, MUI theme
├── server/                   # Express backend (port 4000)
│   └── src/
│       ├── index.ts          # Server entry point
│       ├── app.ts            # Express app: CORS, rate limiting, session, routes
│       ├── passport.ts       # CAS auth + user find-or-create
│       ├── routes/           # Express routers
│       ├── controllers/      # Request handlers
│       ├── services/         # Business logic
│       ├── models/           # Mongoose schemas
│       ├── middleware/        # Auth guards, validation, error handling
│       ├── db/               # Database connections
│       └── utils/            # smartTitle, errors, environment, meiliClient
```

---

## Search

Search uses **Meilisearch** for Research. When Meilisearch cannot answer, research search responds `503` with a retry hint rather than scanning Mongo (#4187).

1. Research discovery uses the `researchentities` index and should only run true semantic search when Meilisearch reports embedded ResearchEntity documents.
   Student queries are normalized before search: low-value words such as `professor`, `lab`, and `research` are stripped when other terms remain, curated aliases expand `ai`, `ml`, `nlp`, `cv`, `neuro`, and `psych`, and short alias queries stay keyword-only so substring noise does not outrank true topic matches.
2. Browse and discovery run on the `researchentities` index, and `Signal` drives the access trust-filter. There is no separate pathways index or endpoint.
3. Results carry evidence and next-step context rather than legacy listing claims.

Listing CRUD is retired and must not be used as the search sync path.

The Meilisearch client (`server/src/utils/meiliClient.ts`) exports:

- `getMeiliClient()` / `getMeiliIndex(name)` - write-key client and prefixed index (e.g., `prod_researchentities`) for the reindex and scripts
- `getMeiliSearchClient()` / `getMeiliSearchIndex(name)` - search-key client and index for the request path; key roles are in `docs/meilisearch-reindex-runbook.md#meilisearch-keys`
- `resolveIndexName(name)` - pure function for prefix resolution

---

## Analytics

Analytics events are stored in MongoDB with a 3-year TTL.
Route-level middleware logs successful server-observed events by wrapping `res.send` or `res.json`, so analytics stay outside controller and service business logic.

The canonical research-student journey uses claim-specific events for terminal search outcomes, result-page views, profile opens, source review, filter changes, entity save/removal, comparison, persisted plan updates, and qualified actions.
The complete event and payload contract is documented in [`docs/research-journey-analytics.md`](docs/research-journey-analytics.md).
Legacy `research_view`, `pathway_save`, `ways_in_click`, `contact_route_click`, and `source_link_click` events remain for older profile, listing, and fellowship instrumentation, but they are not access conversions.

Client interactions are sent to `POST /api/analytics/research/batch` for authenticated users.
Journey payloads use event-specific allowlists of bounded enums and count buckets, and the server validates canonical entity identifiers before persistence.
They never retain raw query text, URLs, hostnames, direct contact destinations, private notes, plan contents, filter values, or client-supplied cross-event search identifiers.
Every interaction uses a bounded idempotency key with per-actor server uniqueness, and client tracking is fire-and-forget so analytics failures cannot change student behavior.

Only `research_qualified_action` counts as access conversion, and the server re-qualifies its category against the current QA-01 planning-context projection.
Source review, profile open, filters, saves, comparisons, plan updates, and legacy research events never count as action.
The admin funnel reports source inspections, official-route attempts, application opens, and self-reported outcomes separately.
Beta suppresses real student analytics while permitting fixture and admin validation.

---

## Authentication

```
User → Yale CAS SSO → passport.ts resolveLoginPrincipalForCas
     → Yalies lookup (classification cascade: skills/auth-security/SKILL.md)
     → accountService.recordAccountLogin: resolve-or-create Account (netid/email) → cookie-session
```

Authentication runs on the canonical `Account`; the legacy `User` model has been retired (#2014) and `userType` is derived per login and carried in the signed session rather than persisted. The classification cascade runs at login time only. Per-request session restore (`deserializeUser`) re-validates that the backing `Account` exists and is not archived plus the admin-grant check - no account creation and no Yalies calls - so a hiccup in those external sources can't fail already-authenticated requests. The CAS login callback (`/api/cas`) is exempt from the general API rate limiter so rate limiting cannot lock users out of login.

The public browse surface (`/api/research`) carries no discovery limiter of its own: it rides the general limiter like every other `/api` route (`globalLimiter`, 1000 req / 15 min), and is exempt only from the write limiter, because `writeLimit` is opt-in per route and `POST /api/research/search` is a pure read despite its method.
The general limiter is keyed per authenticated netid, then per anonymous identifier in the signed cookie session, so debounced search-as-you-type, filters, infinite scroll, and detail views all bill to the browsing session rather than to a shared address.
That anonymous identifier lives in the caller's own cookie and is therefore resettable by a caller who discards cookies, which makes the general limiter an accident guard rather than an abuse control for anonymous traffic; `firstContactLimiter` is the per-IP control that meters those callers.
See `skills/auth-security/SKILL.md` for what each limiter does and does not control (#2420).
Anonymous bucket identifiers are initialized only for `/api` requests.
For the per-IP limiters (`firstContactLimiter`, `authLimiter`), deployed runtimes require `TRUSTED_PROXY_CIDRS`; Express accepts forwarded visitor addresses only through peers in those explicitly validated address ranges.
An over-broad range refuses startup; `skills/auth-security/SKILL.md` owns the prefix floors (#4015).
The `PUT .../addView` view-telemetry routes are likewise exempt from the write limiter so ordinary browsing can't 429 a user's real mutations.
Sessions last 30 days; the per-request admin-grant check is cached in-memory for 60s (invalidated immediately on grant/revoke).
Public detail endpoints (research entity by slug, opportunity by id) and `/api/config` allow brief HTTP caching instead of the global `/api` no-store.

### Auth Middleware (`server/src/middleware/auth.ts`)

| Middleware                     | Check                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `isAuthenticated`              | `req.user` has a valid bounded NetID                                                                               |
| `isAdmin`                      | active `AdminGrant` for the NetID (`hasActiveAdminGrant`); `userType` does not authorize                          |

The optional local/test-only bypass is not middleware: `localAuthBypassUser` in `server/src/passport.ts` injects `req.user` when `LOCAL_AUTH_BYPASS=true` and skips the CAS routes.

---

## API Routes

All mount under `/api`.

| Prefix            | Description                                                                               | Auth                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/research`       | y/labs search/detail, including profile evidence and planning-context enrichment   | Varies                                                 |
| `/programs`       | Programs & Fellowships browse/search                                                      | Varies                                                 |
| `/fellowships`    | Compatibility alias around program/fellowship storage during migration                    | Varies                                                 |
| `/users`          | Account profile update and saved-research / program-watch planning                        | Yes                                                    |
| `/analytics`      | Analytics dashboard + research event writes                                               | Admin for dashboard, authenticated for research writes |
| `/config`         | Departments + research areas                                                              | No                                                     |
| `/admin`          | Admin operations                                                                          | Admin                                                  |

---

## Testing

Client-side tests run under **Vitest 5** with a `jsdom` 30 environment.
Server-side tests also run under **Vitest 5**.

### Running tests

From the repo root:

```bash
yarn test                     # both suites, server then client
yarn test:server              # server suite only
yarn test:client              # client suite only
```

`yarn test` runs the two suites sequentially on purpose.
Neither reaches a real database: the server suite is hermetic (`server/src/test/hermeticEnvironment.ts`) and the client suite runs under `jsdom`.
Run in parallel, though, they starve each other's in-memory MongoDB instances and Vitest workers and fabricate timeouts that are not real.

Per workspace, when you want watch mode or a single file:

```bash
yarn --cwd client test        # watch mode - reruns on file changes
yarn --cwd client test:ci     # single run - what CI invokes
yarn --cwd server test        # server Vitest tests
npx tsc --noEmit -p server/tsconfig.json
```

Tests are discovered from `client/src/**/*.{test,spec}.{ts,tsx}`.

The suites are large; `git ls-files 'server/*.test.ts' | wc -l` and `git ls-files 'client/*.test.ts' 'client/*.test.tsx' | wc -l` print the current file counts. On a loaded machine both produce timeout failures that are not real, against the in-memory MongoDB on the server side and vitest workers on the client side. Before believing a local failure, re-run the single file with `TMPDIR=/tmp npx vitest run <path>` from that workspace; if it passes alone it was resource starvation, and CI on Linux is the authority.

`yarn serve:fresh` (a clean install, build, and serve) is a smoke check, not a test run. It was previously named `yarn test`, which is why that name now runs the suites instead.

### What is tested

Pure reducer modules under [client/src/reducers/](client/src/reducers/) have unit-test coverage in [client/src/reducers/**tests**/](client/src/reducers/__tests__/). Each reducer file has a matching `*.test.ts`. The reducers back the search, fellowship-search, config, listing-form, and account-tracking (kanban/notes) flows - extracting state transitions from providers/components into pure functions makes them testable without mounting React or mocking network.

When adding a new reducer:

1. Place the reducer in [client/src/reducers/](client/src/reducers/) with an exported `createInitial<Name>State()` factory.
2. Add `client/src/reducers/__tests__/<name>.test.ts` covering each action type, the initial state, and a purity check (reducer does not mutate prior state).
3. Import the reducer in the provider/component via `useReducer`; keep side effects (network, localStorage, timers) in the component, not the reducer.

### CI

Pull requests into `main` or `beta`, and pushes to `beta`, trigger [.github/workflows/ci.yml](.github/workflows/ci.yml).
Its job layout (`checks`, the sharded `server-tests`, and the required `test-and-build` aggregate) and step order are recorded in [skills/finishing-work/SKILL.md](skills/finishing-work/SKILL.md), and the `beta` push run is described in [docs/release-process.md](docs/release-process.md#the-post-merge-signal-on-beta).

The workflow also accepts `workflow_dispatch` so it can be run manually from the Actions tab.
Which contexts must pass before merging is set by the repository rulesets, not classic branch protection; see the Merging section of [AGENTS.md](AGENTS.md).

---

## Adding Things

### New API Endpoint

1. Route in `server/src/routes/<resource>.ts`
2. Controller in `server/src/controllers/<resource>Controller.ts`
3. Service in `server/src/services/<resource>Service.ts`
4. Apply auth/validation middleware in the route

### New Page

1. Page component in `client/src/pages/<page>.tsx`
2. Route in `client/src/App.tsx` with appropriate guard (`PrivateRoute`, `AdminRoute`)

### Modifying a Schema

1. Mongoose schema in `server/src/models/<model>.ts`
2. TypeScript interfaces in `client/src/types/`
3. Backfill script in `server/src/scripts/` if existing data needs transformation.
   Prefer an existing package script with dry-run defaults, target validation, and a `--summary ./tmp/<name>.json` artifact for operator review.
4. If the model affects Research search, update the relevant Meilisearch rebuild/index config and release gate.

---

## Troubleshooting

| Issue                                          | Solution                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAS login not working locally                  | Use dev-login: `http://localhost:4000/api/dev-login`                                                                                                                                                                                                                                                                                                                                           |
| Search returns no results                      | Check Meilisearch is running: `curl http://localhost:7700/health`                                                                                                                                                                                                                                                                                                                              |
| Meilisearch connection refused                 | Start Docker container or check `MEILISEARCH_HOST` in `.env`                                                                                                                                                                                                                                                                                                                                   |
| CORS errors                                    | Add origin to `allowList` in `app.ts` or use dev mode                                                                                                                                                                                                                                                                                                                                          |
| Retired practical-routes URL returns not found | Expected; public Pathways search is retired. Planning context appears inside y/labs, research detail, and Dashboard planning.                                                                                                                                                                                                                                                           |
| A client needs planning/access data            | Use `/api/research/search` or research detail. Saved planning uses entity-owned `/api/users/savedResearchEntities` and `/api/users/savedResearchEntityPlans`. The legacy pathway-owned save endpoints and pathway search are removed; do not reintroduce them. |
