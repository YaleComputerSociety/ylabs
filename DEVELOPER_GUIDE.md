# Y/Labs — Developer Guide

> **Live site:** [yalelabs.io](https://yalelabs.io/) · **Beta:** [ylabs-dev.onrender.com](https://ylabs-dev.onrender.com)

---

## What Is This?

Y/Labs is a **Yale research lab discovery platform**. Visitors can browse public research listings with supporting evidence/source metadata, students find labs and fellowships, trusted faculty/staff can submit listing claim or correction requests for admin review, professors create and manage listings, and admins oversee everything.

---

## Architecture

```
React (Vite) → Express (Passport.js) → MongoDB Atlas + Meilisearch
                    ↓
            External APIs: Yale CAS, Yalies, Yale Directory, CourseTable, OpenAI (via Meilisearch), Sentry
```

The server follows: **Routes → Middleware → Controllers → Services → Models**

### Tech Stack

| Layer           | Technology                                                                               |
| --------------- | ---------------------------------------------------------------------------------------- |
| Client          | React 19, TypeScript, Vite 6, React Router v6, MUI v7, styled-components, TailwindCSS v3 |
| Server          | Express 4, TypeScript, Passport.js (CAS strategy), Mongoose 8                            |
| Search          | Meilisearch (hybrid search: keyword + semantic via OpenAI `text-embedding-3-small`)      |
| Database        | MongoDB Atlas (single cluster, separate databases per environment)                       |
| Error Tracking  | Sentry for client and server runtime exception reporting                                 |
| Package Manager | Yarn 4 via Corepack                                                                      |

---

## Environments

Code flows **Local → Beta → Prod**. Beta is the staging gate.

| Environment | Hosting            | MongoDB Database | Meilisearch                   | `MEILISEARCH_INDEX_PREFIX`  |
| ----------- | ------------------ | ---------------- | ----------------------------- | --------------------------- |
| Local       | localhost          | `Development`    | Docker (`localhost:7700`)     | _(unset)_ → bare `listings` |
| Beta        | Render (free tier) | `Beta`           | Shared Render private service | `beta` → `beta_listings`    |
| Prod        | Render (starter)   | `Production`     | Shared Render private service | `prod` → `prod_listings`    |

- MongoDB: one Atlas cluster, three databases. `MONGODBURL` points to the right one per environment.
- Meilisearch: beta and prod share one Render private service, isolated by index prefixes. Local uses its own Docker container.

---

## Local Development Setup

### Prerequisites

- Node.js ≥ 20.9.0
- Corepack (ships with Node ≥ 16.9)
- Docker Desktop (for local Meilisearch)

### 1. Install dependencies

```bash
corepack enable
yarn install:all
```

### 2. Configure environment

Copy the example and fill in credentials:

```bash
cp server/.env.example server/.env
```

Your local `.env` should point to:

- `MONGODBURL` → the `Development` database on Atlas
- `MEILISEARCH_HOST` → `http://localhost:7700`
- `MEILISEARCH_API_KEY` → your local master key (e.g., `testkey`)
- No `MEILISEARCH_INDEX_PREFIX` (local uses bare `listings` index)
- Leave `SENTRY_DSN` unset unless you want to test server-side error reporting locally

For the client:

```bash
# client/.env
VITE_APP_SERVER=http://localhost:4000
# Optional: VITE_SENTRY_DSN=...
```

### 3. Start local Meilisearch

Pull the latest Meilisearch image and start a container:

```bash
docker pull getmeili/meilisearch:latest
docker run -d -p 7700:7700 \
  -e MEILI_MASTER_KEY=testkey \
  -v meili_data:/meili_data \
  getmeili/meilisearch:latest
```

Verify it's running:

```bash
curl http://localhost:7700/health
# Should return: {"status":"available"}
```

Data persists in the `meili_data` volume — you only need to seed once.

### 4. Seed Meilisearch

```bash
cd data-migration
npx ts-node --transpile-only MigrateToMeilisearch.ts
```

This reads listings from your `Development` MongoDB and pushes them to the local Meilisearch with the OpenAI embedder configured. Listing evidence is indexed with public-safe source metadata only; `evidence.internalNotes` is stripped before documents are sent to Meilisearch.

### 5. Start dev servers

```bash
yarn dev:client    # Vite on port 3000
yarn dev:server    # Express with nodemon on port 4000
```

### Dev login bypass

Visit `http://localhost:4000/api/dev-login` to log in as a test user (`test123` / `student`) without CAS.

If the client cannot reach the auth endpoint, `/login` shows an inline retry state and hides the Yale CAS sign-in link until the auth check succeeds.

---

## Common Commands

| Command                                 | Description                                      |
| --------------------------------------- | ------------------------------------------------ |
| `yarn install:all`                      | Install deps in root + server + client           |
| `yarn dev:client`                       | Vite dev server (port 3000)                      |
| `yarn dev:server`                       | Express with nodemon (port 4000)                 |
| `yarn build`                            | Full production build                            |
| `yarn start`                            | Run both servers in production mode              |
| `yarn clean:all`                        | Remove all node_modules                          |
| `yarn --cwd client test`                | Run Vitest in watch mode                         |
| `yarn --cwd client test:ci`             | Run Vitest once (used by CI)                     |
| `yarn --cwd server test`                | Run server Vitest tests once                     |
| `yarn --cwd server test:search-degrade` | Run the focused listing-search degradation tests |

### Migration Scripts

Run from `data-migration/`:

```bash
npx ts-node --transpile-only <script>.ts
```

| Script                    | Purpose                                 |
| ------------------------- | --------------------------------------- |
| `MigrateToMeilisearch.ts` | Populate Meilisearch index from MongoDB |
| `seedDepartments.ts`      | Seed department taxonomy                |
| `seedResearchAreas.ts`    | Seed research area taxonomy             |

---

## Project Structure

```
ylabs/
├── package.json              # Root scripts: install:all, dev:client, dev:server, build, start
├── DEVELOPER_GUIDE.md        # This file — developer guide
├── CLAUDE.md                 # Agent-facing codebase context
├── client/                   # React frontend (Vite, port 3000)
│   └── src/
│       ├── pages/            # Route-level components
│       ├── components/       # UI components (admin/, accounts/, fellowship/, profile/, shared/)
│       ├── contexts/         # React Context definitions
│       ├── providers/        # Context providers with data fetching
│       ├── hooks/            # Custom hooks
│       ├── types/            # TypeScript interfaces
│       └── utils/            # Helpers, axios instance, MUI theme, error tracking, SEO metadata
├── server/                   # Express backend (port 4000)
│   └── src/
│       ├── index.ts          # Server entry point
│       ├── app.ts            # Express app: CORS, rate limiting, session, routes
│       ├── passport.ts       # CAS auth + user find-or-create
│       ├── routes/           # Express routers
│       ├── controllers/      # Request handlers
│       ├── services/         # Business logic
│       ├── models/           # Mongoose schemas, including untrusted listing claim requests
│       ├── middleware/        # Auth guards, validation, error handling
│       ├── db/               # Database connections
│       └── utils/            # smartTitle, errors, environment, meiliClient, error tracking, public research SEO
└── data-migration/           # Standalone migration scripts
```

---

## Search

Search uses **Meilisearch** with keyword search and hybrid mode (80% semantic, 20% keyword) for multi-word queries.

1. Client sends query + filters to `/api/listings/search`
2. Controller builds Meilisearch filter strings from query params
3. Multi-word queries use hybrid search with the Meilisearch-configured OpenAI embedder; single-word queries use keyword search to avoid semantic drift
4. If hybrid search fails, the controller retries keyword-only Meilisearch; if Meilisearch is unavailable, it falls back to MongoDB filtering
5. Results are returned with `totalCount` for pagination and a `degraded` boolean indicating whether fallback behavior was used

Logged-out visitors use the public research discovery path instead:

- Client routes `/research` and `/research/:slug` render the listings browse page without the `PrivateRoute` guard.
- The client mirrors public research search state into shareable URLs and restores it on page load and browser back/forward navigation. URL-backed state includes `query`, `departments`, `academicDisciplines`, `researchAreas`, the three `*Mode` filter operators, `sortBy`, `sortOrder`, and the client-only `quickFilter`.
- Opening a public card preserves the current search params on `/research/:slug`; closing the modal returns to `/research` with the same params.
- The client sends public browse requests to `/api/research` and public detail requests to `/api/research/:slug`.
- Public responses include only confirmed, unarchived listings and redact contact/private fields such as owner email, additional emails, owner/professor IDs, view counts, favorites, and audit fields. They retain sanitized evidence metadata so the detail modal can show why a listing appears and which public sources support it.
- Authenticated users opening a public detail modal also request `/api/research/:slug/contact` to load the full listing, including contact fields. Evidence metadata on this response is still sanitized through the public evidence allowlist.
- Public research search only allows `createdAt` and `updatedAt` sort fields and searches a contact-redacted field set.

Public research share URLs also receive SEO/social metadata:

- The built client shell contains a generic metadata block in `client/index.html` bounded by `YL_SEO_META_START` and `YL_SEO_META_END`.
- In production-style server rendering, Express serves `/research` and `/research/:slug` outside `/api`, loads the built `index.html`, and replaces that block with canonical, description, Open Graph, and Twitter card metadata from `server/src/utils/publicResearchSeo.ts`.
- Listing metadata is built only from the confirmed, unarchived listing after `redactPublicListing()` has removed private fields. If a listing cannot be loaded, the server falls back to generic YaleLabs Research metadata.
- During Vite development or static-only hosting, `client/src/utils/seo.ts` applies the same metadata after React loads and restores the default site metadata when leaving public research routes.

Listing detail modals render an evidence rail for listings, including an empty state when source metadata is unavailable. The public evidence payload supports `status`, `summary`, `confidence`, `generatedAt`, `lastVerifiedAt`, and up to eight sources with `label`, `url`, `sourceType`, `description`, and `lastCheckedAt`. Loading and error states are handled in the same rail. Public source URLs are limited to `http`/`https`; credentials, query strings, and fragments are removed before they are returned by the API or rendered by the client.

Listing CRUD in `listingService.ts` automatically syncs to Meilisearch after MongoDB writes. Indexed listing documents strip `_id`, `__v`, legacy `embedding`, and private `evidence.internalNotes` fields.

On the authenticated Find Labs page, an empty unfiltered result set is treated as "no research labs are available right now" and includes a link to `/fellowships`; empty filtered/search results instead tell the user no labs match the current search or filters.

The Meilisearch client (`server/src/utils/meiliClient.ts`) exports:

- `getMeiliClient()` — lazy-loaded singleton
- `getMeiliIndex(name)` — returns a prefixed index (e.g., `prod_listings`)
- `resolveIndexName(name)` — pure function for prefix resolution

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

Client auth state is owned by `UserContextProvider` and `userReducer`. Failed auth refreshes set `authError` for inline UI, clear loading, and preserve any previously authenticated user so a transient outage does not blank the session; retrying `checkContext()` clears the stale error while the next auth check runs. The shared client in `client/src/utils/axios.ts` also emits an app-wide auth failure event for any API `401`; `UserContextProvider` handles it by clearing auth state without disturbing the login page's inline retry flow.

### Auth Middleware (`server/src/middleware/auth.ts`)

| Middleware         | Check                                                 |
| ------------------ | ----------------------------------------------------- |
| `isAuthenticated`  | `req.user` exists                                     |
| `isAdmin`          | `userType === 'admin'`                                |
| `isProfessor`      | `userType` in `['professor', 'faculty', 'admin']`     |
| `canCreateListing` | professor/faculty + `profileVerified` (admins bypass) |
| `canSubmitListingClaimRequest` | confirmed admin/professor/faculty/staff account |

Missing-session responses from auth guards use a stable JSON shape: `401` with `{ error: "Unauthorized", code: "AUTH_REQUIRED" }`.

---

## Error Handling

The client root is wrapped in `ErrorBoundary`, which shows a recovery screen for unexpected render errors and reports them through `client/src/utils/errorTracking.ts` when `VITE_SENTRY_DSN` is configured.

The shared client in `client/src/utils/axios.ts` centralizes API response handling. It dispatches browser events for `401` responses so auth state is cleared consistently, and for `429` responses so `HttpStatusNotifier` can show the server message plus retry guidance.

The server initializes Sentry from `server/src/utils/errorTracking.ts` during startup when `SENTRY_DSN` is configured. Startup failures and 500-level errors handled by `server/src/middleware/errorHandler.ts` are captured with environment and release tags when provided.

Rate-limit blocks use `server/src/middleware/rateLimitResponse.ts` to return `429` JSON with `{ error, code: "RATE_LIMITED", retryAfterSeconds }` and a `Retry-After` header when reset metadata is available.

---

## Rate Limiting

Three rate limiters in `app.ts` protect all `/api` routes, public `/api/research` browse/detail traffic, and write requests to `/api/listings` and `/api/fellowships`. They are keyed by authenticated user's `netId` with IP fallback for unauthenticated requests, and are skipped in CI, development, and test environments.

When a limiter blocks a request, the server returns `429` with `code: "RATE_LIMITED"`, the limiter-specific message, `retryAfterSeconds` when available, and a matching `Retry-After` header. The client displays those responses through the app-wide `HttpStatusNotifier` snackbar.

---

## Analytics

Listing events are logged through route-level response interception in `server/src/routes/listings.ts`. Public research contact events are logged from the contact controller paths: contact detail reveal, email click attempts, and reported outreach outcomes. The admin analytics dashboard includes an Outreach Loop section with reveal/click/outcome totals, outcome breakdowns, top contacted listings, and recent outreach events.

Outreach analytics intentionally avoid raw private contact data. Metadata is limited to channel, source, contact count, action, and the selected outcome.

---

## API Routes

All mount under `/api`.

| Prefix            | Description                                                  | Auth                                             |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `/listings`       | Listing CRUD, authenticated search, and listing claim/correction submission | Varies; `/:id/claim` requires a confirmed admin/professor/faculty/staff account |
| `/research`       | Public listing discovery, contact reveal, and outreach events | Public; `/research/:slug/contact` and `/research/:slug/outreach` require login |
| `/fellowships`    | Fellowship CRUD and search                                   | Varies                                           |
| `/users`          | User CRUD                                                    | Yes                                              |
| `/profiles`       | Faculty profiles                                             | Varies                                           |
| `/analytics`      | Analytics dashboards                                         | Admin                                            |
| `/config`         | Departments + research areas                                 | No                                               |
| `/research-areas` | Research area CRUD                                           | Admin for writes                                 |
| `/admin`          | Admin operations, including listing claim/correction request review | Admin                                            |
| `/seed`           | Dev seeding routes                                           | Dev mode only                                    |

The public HTML routes `/research` and `/research/:slug` are mounted separately in `server/src/app.ts` after static assets so shared research URLs can receive crawler-visible metadata before the SPA hydrates.

---

### Listing Claim Requests

Confirmed admin, professor, faculty, and staff accounts can submit untrusted claim/correction work items with `POST /api/listings/:id/claim`. The body accepts `requestType` (`claim` or `correction`, default `correction`), a required `message`, optional allowlisted `proposedChanges`, and optional `http`/`https` `evidenceUrls`; submissions are stored as `pending` records and do not mutate listings.

Admins review these records through `GET /api/admin/listing-claims`, `GET /api/admin/listing-claims/:id`, and `PUT /api/admin/listing-claims/:id`. The list route accepts `status`, `requestType`, `listingId`, `page`, and `pageSize`; the review route accepts `status` (`approved` or `rejected`) and optional `adminNotes`, then records `reviewedBy` and `reviewedAt`.

---

## Testing

Client-side tests run under **Vitest 3** with a `jsdom` environment. Configuration lives in the `test` block of [client/vite.config.js](client/vite.config.js), and [client/src/setupTests.ts](client/src/setupTests.ts) loads shared Testing Library matchers. The server uses Vitest for focused middleware, service, and utility tests, plus a focused Node test script for listing-search degradation, but no general server-side test suite is wired into CI.

### Running tests

```bash
cd client
yarn test        # watch mode — reruns on file changes
yarn test:ci     # single run — used by CI

cd ../server
yarn test                 # focused middleware, service, and utility coverage
yarn test:search-degrade  # listing-search fallback coverage
```

Client tests are discovered from `client/src/**/*.{test,spec}.{ts,tsx}`. Server Vitest coverage currently includes error handling, error tracking, and public research SEO utilities.

### What is tested

Pure reducer modules under [client/src/reducers/](client/src/reducers/) have unit-test coverage in [client/src/reducers/**tests**/](client/src/reducers/__tests__/). Each reducer file has a matching `*.test.ts`. The reducers back the auth, search, fellowship-search, config, listing-form, and account-tracking (kanban/notes) flows — extracting state transitions from providers/components into pure functions makes them testable without mounting React or mocking network.

Focused component accessibility coverage also exists for the research discovery/listing flows: [BrowseGrid.a11y.test.tsx](client/src/components/shared/__tests__/BrowseGrid.a11y.test.tsx) verifies keyboard-openable browse cards/list rows and separate favorite controls, [ListingDetailModal.public.test.tsx](client/src/components/shared/__tests__/ListingDetailModal.public.test.tsx) covers the public listing dialog name, Escape close behavior, focus trapping/restoration, and redacted contact actions, and [ResearchAreaInput.a11y.test.tsx](client/src/components/accounts/ListingForm/FormFields/__tests__/ResearchAreaInput.a11y.test.tsx) covers the listing-form research-area field selector dialog focus behavior. Focused HTTP handling tests cover rate-limit event parsing, the global rate-limit notifier, and auth-state clearing on app-wide `401` events.

Public research SEO coverage lives in [client/src/utils/__tests__/seo.test.ts](client/src/utils/__tests__/seo.test.ts), [client/src/pages/__tests__/home.publicResearch.test.tsx](client/src/pages/__tests__/home.publicResearch.test.tsx), and [server/src/utils/__tests__/publicResearchSeo.test.ts](server/src/utils/__tests__/publicResearchSeo.test.ts). These tests cover public-safe metadata construction, client head updates/restoration, and server injection into the built SPA shell.

When adding a new reducer:

1. Place the reducer in [client/src/reducers/](client/src/reducers/) with an exported `createInitial<Name>State()` factory.
2. Add `client/src/reducers/__tests__/<name>.test.ts` covering each action type, the initial state, and a purity check (reducer does not mutate prior state).
3. Import the reducer in the provider/component via `useReducer`; keep side effects (network, localStorage, timers) in the component, not the reducer.

### CI

Pull requests into `main` or `beta` trigger [.github/workflows/ci.yml](.github/workflows/ci.yml), which runs:

1. `yarn install:all`
2. `yarn --cwd client test:ci`
3. `yarn build` (server + client)

The workflow also accepts `workflow_dispatch` so it can be run manually from the Actions tab. Branch protection (configured in GitHub repo settings → Branches) requires this check to pass before merging.

`tsc --noEmit` is **not** part of CI yet — the client has known pre-existing type errors that need a cleanup pass before strict type-checking can be enforced.

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

Public pages that should work for logged-out visitors must not use `PrivateRoute`; protected actions from those pages should route users to `/login` and preserve the return path.

### Modifying a Schema

1. Mongoose schema in `server/src/models/<model>.ts`
2. TypeScript interfaces in `client/src/types/`
3. Migration script in `data-migration/` if existing data needs transformation
4. If the model is `listing`, update Meilisearch index config if new fields need filtering/sorting

Listing evidence metadata lives under `listing.evidence` in MongoDB. Keep any analyst-only notes in `evidence.internalNotes`; that field is excluded by default from Mongoose query results, stripped from Meilisearch indexing, and never returned by public research endpoints.

Listing claim/correction requests live in the `listingClaimRequests` collection. They snapshot requester and listing metadata, keep submitted proposed changes separate from canonical listings, and remain untrusted until an admin marks the request approved or rejected.

---

## Troubleshooting

| Issue                           | Solution                                                                    |
| ------------------------------- | --------------------------------------------------------------------------- |
| CAS login not working locally   | Use dev-login: `http://localhost:4000/api/dev-login`                        |
| Find Labs has no local results  | Seed Development listings or use the empty-state link to browse fellowships |
| Search is degraded or stale     | Check Meilisearch is running: `curl http://localhost:7700/health`           |
| Meilisearch connection refused  | Start Docker container or check `MEILISEARCH_HOST` in `.env`                |
| CORS errors                     | Add origin to `allowList` in `app.ts` or use dev mode                       |
| "Forbidden" on listing creation | Professor needs `profileVerified: true`                                     |
| "Forbidden" on listing claim/correction | User must be confirmed and have `admin`, `professor`, `faculty`, or `staff` type |
