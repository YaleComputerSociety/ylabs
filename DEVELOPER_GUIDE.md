# Yale Research - Developer Guide

> **Live site:** [yalelabs.io](https://yalelabs.io/) · **Beta:** [ylabs-gr4v.onrender.com](https://ylabs-gr4v.onrender.com) · **Repo:** [YaleComputerSociety/ylabs](https://github.com/YaleComputerSociety/ylabs)

## What Is This?

Yale Research is a **Yale research discovery platform**. Students discover Yale research homes, source-backed evidence, planning context, structured programs/fellowships, and real posted opportunities when they exist. The product is not a listings board; the legacy Listings surface and public Pathways page are retired.

---

## Architecture

```
React (Vite) → Express (Passport.js) → MongoDB Atlas + Meilisearch
                    ↓
            External APIs: Yale CAS, Yalies, Yale Directory, CourseTable, OpenAI (via Meilisearch)
```

The server follows: **Routes → Middleware → Controllers → Services → Models**

### Tech Stack

| Layer           | Technology                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Client          | React 19, TypeScript, Vite 6, React Router v6, MUI v7, styled-components, TailwindCSS v3         |
| Server          | Express 4, TypeScript, Passport.js (CAS strategy), Mongoose 8                                    |
| Search          | Meilisearch (keyword plus semantic search via OpenAI `text-embedding-3-small` where appropriate) |
| Database        | MongoDB Atlas (single cluster, separate databases per environment)                               |
| Package Manager | Yarn 4 via Corepack                                                                              |

---

## Environments

Code flows **Local → Beta → Prod**. Beta is the staging gate.

| Environment | Hosting            | MongoDB Database | Meilisearch                   | `MEILISEARCH_INDEX_PREFIX`                         |
| ----------- | ------------------ | ---------------- | ----------------------------- | -------------------------------------------------- |
| Local       | localhost          | `Development`    | Docker (`localhost:7700`)     | _(unset)_ → bare `researchentities` / `pathways`   |
| Beta        | Render (free tier) | `Beta`           | Shared Render private service | `beta` → `beta_researchentities` / `beta_pathways` |
| Prod        | Render (starter)   | `Production`     | Shared Render private service | `prod` → `prod_researchentities` / `prod_pathways` |

- MongoDB: one Atlas cluster, three databases. `MONGODBURL` points to the right one per environment.
- Meilisearch: beta and prod share one Render private service, isolated by index prefixes. Local uses its own Docker container.

---

## Local Development Setup

These instructions assume a Unix-like shell. Mac developers can run them in Terminal. Windows developers should run them inside WSL, with the repo stored in the Linux filesystem rather than `/mnt/c/...`.

### Prerequisites

- Node.js >= 20.9.0
- Corepack, which ships with modern Node versions
- Yarn 4, activated through Corepack
- Docker Desktop (for local Meilisearch)

### 1. Fresh machine setup

On a brand new Unix/WSL environment, install the basic system packages first:

```bash
sudo apt update
sudo apt install -y curl git ca-certificates build-essential python3 make g++
```

Use `nvm` for Node. Avoid `apt install nodejs`, which often installs an older Node version than this repo supports.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
```

Restart your shell, then install and select Node 20:

```bash
nvm install 20
nvm use 20
nvm alias default 20
node -v
npm -v
```

Enable Corepack and activate the Yarn version pinned by this repo:

```bash
corepack enable
corepack prepare yarn@4.6.0 --activate
yarn -v
```

Expected versions:

- `node` should be `v20.x` or newer.
- `yarn` should be `4.6.0`.

### 2. Install dependencies

```bash
yarn install:all
```

### 3. Configure environment

Copy the example and fill in credentials:

```bash
cp server/.env.example server/.env
```

Your local `.env` should point to:

- `MONGODBURL` → the `Development` database on Atlas
- `MEILISEARCH_HOST` → `http://localhost:7700`
- `MEILISEARCH_API_KEY` → your local master key (e.g., `testkey`)
- No `MEILISEARCH_INDEX_PREFIX` (local uses bare `researchentities` and `pathways` indexes)

For the client:

```bash
# client/.env
VITE_APP_SERVER=http://localhost:4000
```

Ask a project maintainer for the development MongoDB and API credentials. Do not commit `server/.env` or `client/.env`.

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

This rebuilds local Research and Pathways indexes from MongoDB. Use `--strategy=swap` for beta/production rebuilds that serve live traffic. Semantic Research search is release-gated separately: Meilisearch must report embedded `researchentities` documents before `RESEARCH_SEARCH_SEMANTIC=true` should be used for Beta or production.
Research relevance also depends on `researchentities` settings and documents: topic/name/tag fields are searched before description text, student-topic aliases are indexed in `studentSearchTerms`, and short aliases such as `ai`, `ml`, `nlp`, and `cv` disable typo expansion and search only topic-oriented fields.

When a `/research` browse has no search query, results are ordered "best first" by a precomputed `browseRankScore` (completeness of the profile plus strength-weighted undergraduate access signals), falling back to recency. After importing or migrating data, populate the score with `yarn --cwd server research-homes:backfill-browse-rank --apply --confirm-browse-rank` (it runs in dry-run by default); ongoing scrape/materialize runs keep it fresh automatically.

Organizational research homes (centers, institutes, initiatives, core facilities) have no single PI, so their scraped rosters list everyone as core faculty and the public "Principal Investigator" panel shows nothing. The `center-director-llm` scraper reads each home's official site and leadership pages, extracts the single named **director**, and the materializer resolves that name to a Yale user before promoting them to a director (lead) member. New scrape/materialize runs apply this automatically; to fill in the existing corpus run `yarn --cwd server research-homes:backfill-center-directors --apply --confirm-center-directors --limit <n>` (dry-run by default, lists eligible homes without calling the LLM; apply needs `OPENAI_API_KEY`).

Non-lead current-team context comes only from the disabled-by-default `official-research-home-roster` source and its reviewed entity/page/section allowlist.
Run a bounded dry run with `yarn --cwd server scrape run --source official-research-home-roster --only <research-entity-key> --limit 1`, materialize only after reviewing the source output, and then run `yarn --cwd server research-homes:audit-rosters --strict`.
Broad enablement requires a clean structural audit plus an attributable sampled review using `--sampled-precision-reviewed-by=<reviewer>`.
The public detail API returns at most 24 fresh verified roster members, grouped by coarse role, along with a `roster` disclosure whose status is `current`, `partial`, `withheld`, `no-verified-data`, or `optional-source-failure`.
Failed, empty, stale, or ambiguous refreshes do not imply an empty team and do not archive the last verified roster.

### 6. Start dev servers

```bash
yarn dev:client    # Vite on port 3000
yarn dev:server    # Express with nodemon on port 4000
```

Run these in two separate terminals.

### 7. Verify setup

```bash
curl http://localhost:7700/health
npx tsc --noEmit -p server/tsconfig.json
yarn --cwd server test
yarn --cwd client test:ci
```

### Troubleshooting Yarn setup

If `yarn install:all` fails with an error like:

```txt
Usage Error: Couldn't find the node_modules state file - running an install might help (findPackageLocation)
```

or if `yarn`/`corepack` is not found, first confirm you are using the `nvm` Node install rather than a system `apt` Node:

```bash
which node
node -v
which corepack
```

If `which node` prints `/usr/bin/node`, switch to the `nvm` Node:

```bash
nvm install 20
nvm use 20
nvm alias default 20
corepack enable
corepack prepare yarn@4.6.0 --activate
yarn -v
```

Then run the root install before the all-workspaces helper:

```bash
yarn install
yarn install:all
```

### Dev login bypass

Visit `http://localhost:4000/api/dev-login` to log in as a test user (`test123` / `undergraduate`) without CAS - `undergraduate` (not the legacy generic `student`) since that's what every real account in the database actually is. Use `?userType=admin` for the `devadmin` account, `?userType=professor` (or `faculty`) for the `devprofessor` account, `?userType=graduate` for the `devgraduate` account, or `?userType=unknown` for the `devunknown` account - the only way to trigger the `/unknown` onboarding-form experience locally, since it otherwise only shows up when a real CAS login's Yalies/Directory lookup can't classify the user. The `unknown` dev account is created with `userConfirmed: false` and `profileVerified: false` to match that real state; every other dev role is pre-confirmed. Dev login is allowed only when `NODE_ENV=development` and `SERVER_BASE_URL` points at localhost or loopback; the Mongo database name does not control this local-runtime check.

For request-level local testing, set `LOCAL_AUTH_BYPASS=true` in `server/.env`. In `development` or `test` only, protected `/api` requests without a session receive a dev admin user by default:

```bash
LOCAL_AUTH_BYPASS_NETID=devadmin
LOCAL_AUTH_BYPASS_USER_TYPE=admin
```

Per-request overrides are available with `x-dev-netid` and `x-dev-user-type` headers. `/api/cas` and `/api/logout` are not bypassed, so leave `LOCAL_AUTH_BYPASS=false` or visit those routes directly when testing Yale CAS behavior.

The auth flow's verbose tracing (per-request deserialization, the find-or-create source cascade, analytics-event confirmations) is off by default - set `AUTH_DEBUG=true` in `server/.env` to turn it on when debugging an auth issue. Genuine auth errors and anomalies log regardless of the flag.

---

## Common Commands

| Command                                                           | Description                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `yarn install:all`                                                | Install deps in root + server + client                                             |
| `yarn dev:client`                                                 | Vite dev server (port 3000)                                                        |
| `yarn dev:server`                                                 | Express with nodemon (port 4000)                                                   |
| `yarn build`                                                      | Full production build                                                              |
| `yarn start`                                                      | Run both servers in production mode                                                |
| `yarn clean:all`                                                  | Remove all node_modules                                                            |
| `yarn --cwd client test`                                          | Run Vitest in watch mode                                                           |
| `yarn --cwd client test:ci`                                       | Run Vitest once (used by CI)                                                       |
| `yarn --cwd server test`                                          | Run server Vitest tests                                                            |
| `npx tsc --noEmit -p server/tsconfig.json`                        | Server typecheck                                                                   |
| `yarn --cwd server beta:readiness --confirm-beta-backup --strict` | Read-only Beta release gate                                                        |
| `yarn --cwd server beta:data-quality --include-samples`           | Read-only Beta data-quality scorecard                                              |
| `yarn --cwd server scraper:integrity-gate --include-samples`      | Read-only scraper materialization integrity gate                                   |
| `SCRAPER_ENV=beta yarn --cwd server gates:refresh`                | Regenerate every canonical gate scorecard the operator board reads (single writer) |

### Operator board Gate Status - keeping it honest and current

The admin operator board (the **Gate Status** panel at `/programs`) reads canonical gate scorecard
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

Historical `data-migration/` scripts remain for one-off migrations only.
Run them through the `data-migration` package scripts when available, so dry-run defaults, target validation, and JSON summaries stay in place:

```bash
npm --prefix data-migration run import:fellowships -- --csv ../web-scraper/fellowships/yale_fellowships.csv --summary ./tmp/fellowships-summary.json
npm --prefix data-migration run import:fellowships:execute -- --target dev --csv ../web-scraper/fellowships/yale_fellowships.csv --summary ./tmp/fellowships-import.json
npm --prefix data-migration run migrate:meilisearch -- --summary ./tmp/meili-listings-summary.json
MEILISEARCH_INDEX_PREFIX=dev npm --prefix data-migration run migrate:meilisearch:execute -- --target dev --summary ./tmp/meili-listings-execute.json
```

`import:fellowships` validates the CSV transform before MongoDB writes and refuses replacement unless execute mode also supplies `--replace-existing`.
`migrate:meilisearch` refreshes only the legacy `listings` Meilisearch index; do not use it for current Research or Pathways indexes.
Any write must use `--execute --target local|test|dev|beta|prod`, and production writes additionally require `--allow-production --confirm-production`.
Summary paths must be `.json` files under `data-migration/tmp` or the system temp directory.

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
└── data-migration/           # Standalone migration scripts
```

---

## Search

Search uses **Meilisearch** for Research, with internal pathway enrichment and Mongo fallback where rollout safety requires it.

1. Research discovery uses the `researchentities` index and should only run true semantic search when Meilisearch reports embedded ResearchEntity documents.
   Student queries are normalized before search: low-value words such as `professor`, `lab`, and `research` are stripped when other terms remain, curated aliases expand `ai`, `ml`, `nlp`, `cv`, `neuro`, and `psych`, and short alias queries stay keyword-only so substring noise does not outrank true topic matches.
2. `EntryPathway` data remains an internal action model for planning summaries, research detail, saved planning, admin review, and data-quality workflows. The public client should consume it through `/api/research/search`, not by calling a standalone Pathways endpoint.
3. Pathway Meilisearch rebuilds remain useful for parity testing and future internal enrichment work; rollback remains `PATHWAY_SEARCH_BACKEND=mongo` where that service is used.
4. Results carry evidence and next-step context rather than legacy listing claims.

Listing CRUD is retired and must not be used as the search sync path.

The Meilisearch client (`server/src/utils/meiliClient.ts`) exports:

- `getMeiliClient()` - lazy-loaded singleton
- `getMeiliIndex(name)` - returns a prefixed index (e.g., `prod_researchentities`)
- `resolveIndexName(name)` - pure function for prefix resolution

---

## Analytics

Analytics events are stored in MongoDB with a 3-year TTL.
Route-level middleware logs successful server-observed events by wrapping `res.send` or `res.json`, so analytics stay outside controller and service business logic.

The canonical research-student journey uses claim-specific events for terminal search outcomes, entity impressions, profile opens, source review, filter changes, entity save/removal, comparison, persisted plan updates, and qualified actions.
The complete event and payload contract is documented in [`docs/research-journey-analytics.md`](docs/research-journey-analytics.md).
Legacy `research_view`, `pathway_save`, `ways_in_click`, `contact_route_click`, and `source_link_click` events remain for older profile, listing, and fellowship instrumentation, but they are not access conversions.

Client interactions are sent to `POST /api/analytics/research` for authenticated users.
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
User → Yale CAS SSO → passport.ts findOrCreateUser
     → Check DB (refresh if stale >30 days)
     → Yalies API (student/grad detection)
     → Yale Directory (faculty detection)
     → Fallback: userType "unknown"
     → Create/Update User → cookie-session
```

The find-or-create cascade runs at login time only. Per-request session restore (`deserializeUser`) is a plain user read plus the admin-grant check - no user creation and no Yalies/Directory calls - so a hiccup in those external sources can't fail already-authenticated requests. The CAS login callback (`/api/cas`) is also exempt from the general API rate limiter: it's always unauthenticated, so it keys by IP, and many users behind one campus NAT egress IP could otherwise exhaust the shared budget and be locked out of login.

The public browse surfaces (`/api/research`, `/api/opportunities`) follow the same principle: they are exempt from both the general and the write limiter (`POST /api/research/search` is a pure read despite its method) and are governed solely by `publicDiscoveryLimiter` (300 req / 15 min), sized for anonymous IP-keyed traffic - debounced search-as-you-type, filters, infinite scroll, and detail views, potentially from several users behind one NAT egress IP. The `PUT .../addView` view-telemetry routes are likewise exempt from the write limiter so ordinary browsing can't 429 a user's real mutations. Sessions last 30 days; the per-request admin-grant check is cached in-memory for 60s (invalidated immediately on grant/revoke). Public detail endpoints (research entity by slug, opportunity by id) and `/api/config` allow brief HTTP caching instead of the global `/api` no-store.

### Auth Middleware (`server/src/middleware/auth.ts`)

| Middleware        | Check                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `localAuthBypass` | Optional local/test-only `req.user` injection when `LOCAL_AUTH_BYPASS=true`; skips CAS routes |
| `isAuthenticated` | `req.user` exists                                                                             |
| `isAdmin`         | `userType === 'admin'`                                                                        |
| `isProfessor`     | `userType` in `['professor', 'faculty', 'admin']`                                             |

---

## API Routes

All mount under `/api`.

| Prefix            | Description                                                                             | Auth                                                   |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/research`       | Yale Research search/detail, including profile evidence and planning-context enrichment | Varies                                                 |
| `/programs`       | Programs & Fellowships browse/search and saved-program support                          | Varies                                                 |
| `/opportunities`  | Real posted opportunity detail workflows                                                | Varies                                                 |
| `/listings`       | Retired legacy API, returns `410 Gone`                                                  | Varies                                                 |
| `/fellowships`    | Compatibility alias around program/fellowship storage during migration                  | Varies                                                 |
| `/users`          | User CRUD                                                                               | Yes                                                    |
| `/profiles`       | Faculty profiles                                                                        | Varies                                                 |
| `/analytics`      | Analytics dashboard + research event writes                                             | Admin for dashboard, authenticated for research writes |
| `/config`         | Departments + research areas                                                            | No                                                     |
| `/research-areas` | Research area CRUD                                                                      | Admin for writes                                       |
| `/admin`          | Admin operations                                                                        | Admin                                                  |
| `/seed`           | Dev seeding routes                                                                      | Dev mode only                                          |

---

## Testing

Client-side tests run under **Vitest 3** with a `jsdom` environment. Server-side tests also run under **Vitest**.

### Running tests

```bash
yarn --cwd client test        # watch mode - reruns on file changes
yarn --cwd client test:ci     # single run - used by CI
yarn --cwd server test        # server Vitest tests
npx tsc --noEmit -p server/tsconfig.json
```

Tests are discovered from `client/src/**/*.{test,spec}.{ts,tsx}`.

### What is tested

Pure reducer modules under [client/src/reducers/](client/src/reducers/) have unit-test coverage in [client/src/reducers/**tests**/](client/src/reducers/__tests__/). Each reducer file has a matching `*.test.ts`. The reducers back the search, fellowship-search, config, listing-form, and account-tracking (kanban/notes) flows - extracting state transitions from providers/components into pure functions makes them testable without mounting React or mocking network.

When adding a new reducer:

1. Place the reducer in [client/src/reducers/](client/src/reducers/) with an exported `createInitial<Name>State()` factory.
2. Add `client/src/reducers/__tests__/<name>.test.ts` covering each action type, the initial state, and a purity check (reducer does not mutate prior state).
3. Import the reducer in the provider/component via `useReducer`; keep side effects (network, localStorage, timers) in the component, not the reducer.

### CI

Pull requests into `main` or `beta` trigger [.github/workflows/ci.yml](.github/workflows/ci.yml), which runs:

1. `yarn install:all`
2. `npx tsc --noEmit -p server/tsconfig.json`
3. `yarn --cwd server test`
4. `yarn --cwd client test:ci`
5. `yarn npm audit --severity high`
6. `yarn build` (server + client)

The workflow also accepts `workflow_dispatch` so it can be run manually from the Actions tab. Branch protection (configured in GitHub repo settings → Branches) requires this check to pass before merging.

Client `tsc --noEmit` is still not part of CI; the client has known pre-existing type errors that need a cleanup pass before strict type-checking can be enforced.

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
3. Migration script in `data-migration/` if existing data needs transformation.
   Prefer an existing package script with dry-run defaults, target validation, and a `--summary ./tmp/<name>.json` artifact for operator review.
4. If the model affects Research or Pathways search, update the relevant Meilisearch rebuild/index config and release gate.

---

## Troubleshooting

| Issue                                          | Solution                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAS login not working locally                  | Use dev-login: `http://localhost:4000/api/dev-login`                                                                                                                                                                                                                                                                                                                                           |
| Search returns no results                      | Check Meilisearch is running: `curl http://localhost:7700/health`                                                                                                                                                                                                                                                                                                                              |
| Meilisearch connection refused                 | Start Docker container or check `MEILISEARCH_HOST` in `.env`                                                                                                                                                                                                                                                                                                                                   |
| CORS errors                                    | Add origin to `allowList` in `app.ts` or use dev mode                                                                                                                                                                                                                                                                                                                                          |
| `/api/listings` returns `410`                  | Expected; Listings is retired. Use Research, Programs, or PostedOpportunity workflows.                                                                                                                                                                                                                                                                                                         |
| Retired practical-routes URL returns not found | Expected; public Pathways search is retired. Planning context appears inside Yale Research, research detail, and Dashboard planning.                                                                                                                                                                                                                                                           |
| A client needs pathway data                    | Use `/api/research/search` or research detail. Saved planning uses entity-owned `/api/users/savedResearchEntities` and `/api/users/savedResearchEntityPlans`; legacy pathway-owned endpoints are compatibility support, not a new client contract. Fall back only when a canonical endpoint returns `404`, `405`, or `501`, and track saved-item and plan-detail endpoint modes independently. |
