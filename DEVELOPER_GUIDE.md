# Y/Labs — Developer Guide

> **Live site:** [yalelabs.io](https://yalelabs.io/) · **Beta:** [ylabs-dev.onrender.com](https://ylabs-dev.onrender.com)

---

## What Is This?

Y/Labs is a **Yale research lab discovery platform**. Visitors can browse public research listings, students find labs and fellowships, professors create and manage listings, and admins oversee everything.

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

This reads listings from your `Development` MongoDB and pushes them to the local Meilisearch with the OpenAI embedder configured.

### 5. Start dev servers

```bash
yarn dev:client    # Vite on port 3000
yarn dev:server    # Express with nodemon on port 4000
```

### Dev login bypass

Visit `http://localhost:4000/api/dev-login` to log in as a test user (`test123` / `student`) without CAS.

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
│       └── utils/            # Helpers, axios instance, MUI theme, error tracking
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
│       └── utils/            # smartTitle, errors, environment, meiliClient, error tracking
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
- The client sends public browse requests to `/api/research` and public detail requests to `/api/research/:slug`.
- Public responses include only confirmed, unarchived listings and redact contact/private fields such as owner email, additional emails, owner/professor IDs, view counts, favorites, and audit fields.
- Authenticated users opening a public detail modal also request `/api/research/:slug/contact` to load the full listing, including contact fields.
- Public research search only allows `createdAt` and `updatedAt` sort fields and searches a contact-redacted field set.

Listing CRUD in `listingService.ts` automatically syncs to Meilisearch after MongoDB writes.

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

### Auth Middleware (`server/src/middleware/auth.ts`)

| Middleware         | Check                                                 |
| ------------------ | ----------------------------------------------------- |
| `isAuthenticated`  | `req.user` exists                                     |
| `isAdmin`          | `userType === 'admin'`                                |
| `isProfessor`      | `userType` in `['professor', 'faculty', 'admin']`     |
| `canCreateListing` | professor/faculty + `profileVerified` (admins bypass) |

---

## Error Handling

The client root is wrapped in `ErrorBoundary`, which shows a recovery screen for unexpected render errors and reports them through `client/src/utils/errorTracking.ts` when `VITE_SENTRY_DSN` is configured.

The server initializes Sentry from `server/src/utils/errorTracking.ts` during startup when `SENTRY_DSN` is configured. Startup failures and 500-level errors handled by `server/src/middleware/errorHandler.ts` are captured with environment and release tags when provided.

---

## API Routes

All mount under `/api`.

| Prefix            | Description                                             | Auth                                            |
| ----------------- | ------------------------------------------------------- | ----------------------------------------------- |
| `/listings`       | Listing CRUD and authenticated search                   | Varies                                          |
| `/research`       | Public read-only listing discovery and shareable detail URLs | Public; `/research/:slug/contact` requires login |
| `/fellowships`    | Fellowship CRUD and search                              | Varies                                          |
| `/users`          | User CRUD                                               | Yes                                             |
| `/profiles`       | Faculty profiles                                        | Varies                                          |
| `/analytics`      | Analytics dashboards                                    | Admin                                           |
| `/config`         | Departments + research areas                            | No                                              |
| `/research-areas` | Research area CRUD                                      | Admin for writes                                |
| `/admin`          | Admin operations                                        | Admin                                           |
| `/seed`           | Dev seeding routes                                      | Dev mode only                                   |

---

## Testing

Client-side tests run under **Vitest 3** with a `jsdom` environment. Configuration lives in the `test` block of [client/vite.config.js](client/vite.config.js), and [client/src/setupTests.ts](client/src/setupTests.ts) loads shared Testing Library matchers. The server uses Vitest for focused middleware and utility tests, plus a focused Node test script for listing-search degradation, but no general server-side test suite is wired into CI.

### Running tests

```bash
cd client
yarn test        # watch mode — reruns on file changes
yarn test:ci     # single run — used by CI

cd ../server
yarn test                 # focused middleware and utility coverage
yarn test:search-degrade  # listing-search fallback coverage
```

Client tests are discovered from `client/src/**/*.{test,spec}.{ts,tsx}`. Server Vitest coverage currently includes error handling and error tracking utilities.

### What is tested

Pure reducer modules under [client/src/reducers/](client/src/reducers/) have unit-test coverage in [client/src/reducers/**tests**/](client/src/reducers/__tests__/). Each reducer file has a matching `*.test.ts`. The reducers back the search, fellowship-search, config, listing-form, and account-tracking (kanban/notes) flows — extracting state transitions from providers/components into pure functions makes them testable without mounting React or mocking network.

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

---

## Troubleshooting

| Issue                           | Solution                                                          |
| ------------------------------- | ----------------------------------------------------------------- |
| CAS login not working locally   | Use dev-login: `http://localhost:4000/api/dev-login`              |
| Search returns no results       | Check Meilisearch is running: `curl http://localhost:7700/health` |
| Meilisearch connection refused  | Start Docker container or check `MEILISEARCH_HOST` in `.env`      |
| CORS errors                     | Add origin to `allowList` in `app.ts` or use dev mode             |
| "Forbidden" on listing creation | Professor needs `profileVerified: true`                           |
