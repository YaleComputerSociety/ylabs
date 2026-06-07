# Yale Research Codebase Reference

## Architecture

Monorepo with a React client and Express server communicating over REST. MongoDB Atlas is the primary data store. Meilisearch handles search (semantic + keyword) with an OpenAI embedder configured server-side. Yale CAS provides SSO authentication.

```
React (Vite) → Express (Passport.js) → MongoDB Atlas + Meilisearch
                    ↓
            External APIs: Yale CAS, Yalies, Yale Directory, CourseTable, OpenAI (via Meilisearch embedder)
```

The server follows a layered architecture: **Routes → Middleware → Controllers → Services → Models**. Routes define endpoints and compose middleware chains. Controllers extract request data, delegate to services, and format responses. Services contain all business logic, database operations, and external API calls. Models are Mongoose schemas with indexes.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Client | React 19, TypeScript 5.3, Vite 6.3, React Router v6, MUI v7, styled-components, TailwindCSS v3 |
| Server | Express 4, TypeScript 5.3, Passport.js 0.5 (CAS strategy), Mongoose 8 |
| Search | Meilisearch 0.57 (hybrid search with OpenAI `text-embedding-3-small` embedder) |
| Database | MongoDB Atlas (single cluster, separate databases per environment) |
| Package Manager | Yarn 4 via Corepack |
| Tooling | concurrently, nodemon, ts-node, cross-env |

## Monorepo Structure

```
yale-research/
├── package.json              # Root scripts: install:all, dev:client, dev:server, build, start
├── DEVELOPER_GUIDE.md                # Human-facing project documentation
├── CLAUDE.md                 # This file — agent-facing codebase context
├── client/                   # React frontend (Vite, port 3000)
│   └── src/
│       ├── pages/            # Route-level components (home, fellowships, account, profile, analytics, etc.)
│       ├── components/       # UI components organized by domain (admin/, accounts/, fellowship/, profile/, shared/)
│       ├── contexts/         # React Context definitions (UserContext, SearchContext, ConfigContext, etc.)
│       ├── providers/        # Context providers with data fetching logic
│       ├── hooks/            # Custom hooks (useConfig, useInfiniteScroll, useViewTracking)
│       ├── types/            # TypeScript interfaces (Listing, Fellowship, FacultyProfile, User)
│       └── utils/            # Helpers: axios instance, MUI theme, department names, research areas
├── server/                   # Express backend (port 4000)
│   └── src/
│       ├── index.ts          # Server startup entry point
│       ├── app.ts            # Express app: CORS, rate limiting, session, passport, route mounting
│       ├── passport.ts       # CAS auth strategy + user find-or-create cascade
│       ├── routes/           # Express routers aggregated in routes/index.ts
│       ├── controllers/      # Request handlers
│       ├── services/         # Business logic (40+ services)
│       ├── models/           # Mongoose schemas: user, listing, fellowship, analytics, department, researchArea, researchEntity, researchEntityRelationship, researchGroup, researchGroupMember, researchScholarlyAttribution, researchScholarlyLink, entryPathway, accessSignal, contactRoute, postedOpportunity, observation, source, scrapeRun, scrapeJobLock, scrapeSnapshot, facultyMember, grant, adminGrant, paper, paperAuthor, studentApplication, studentProfile, studentTracking, studentOutreach, studentEngagementEvent, visibilityReleaseQueueItem, and more (see models/index.ts for the canonical export list)
│       ├── scrapers/         # Scraper infrastructure: CLI, orchestrator, materializers, sources/, utils/
│       ├── middleware/        # Auth guards, validation, error handling
│       ├── db/               # Multi-mode database connections
│       ├── utils/            # smartTitle, errors, environment, meiliClient
│       └── scripts/          # One-off migration/rebuild scripts (research-entity migrate, meili rebuild, etc.)
└── data-migration/           # Standalone migration scripts (run with npx tsx --transpile-only)
```

## Commands

| Command | Effect |
|---------|--------|
| `yarn install:all` | Install deps in root, server, and client |
| `yarn dev:client` | Vite dev server on port 3000 |
| `yarn dev:server` | Express with nodemon on port 4000 |
| `yarn build` | Corepack enable + install all + build server + build client |
| `yarn start` | Run both servers in production (concurrently) |
| `yarn clean:all` | Remove all node_modules directories |
| `yarn --cwd client test` | Run Vitest in watch mode |
| `yarn --cwd client test:ci` | Run Vitest once (used by CI) |
| `yarn --cwd server test` | Run server-side Vitest suite |
| `yarn --cwd server scrape <cmd>` | Run the scraper CLI (see `yarn --cwd server scrape help`) |
| `yarn --cwd server meili:rebuild-research-entities` | Rebuild the ResearchEntity Meilisearch index |
| `yarn --cwd server meili:rebuild-pathways` | Rebuild the Pathway Meilisearch index |
| `yarn --cwd server research-entity:migrate` | Run the ResearchEntity physical migration |
| `yarn --cwd server research-homes:backfill-faculty-ways-in` | Backfill identified-faculty-lead ways-in for existing research homes (dry-run-first) |

Migration scripts run from `data-migration/` with `npx tsx --transpile-only <script>.ts`.

Dev login bypass: `GET http://localhost:4000/api/dev-login` creates a test session (`test123` / `student`) without CAS.

## TypeScript Configuration

**Server**: target ES2022, module NodeNext, moduleResolution NodeNext, strict true, output to `build/`. Built with `tsup`; dev mode uses `tsx watch`.

**Client**: target ES5, module ESNext, jsx react-jsx, strict true, noEmit true.

## Database

MongoDB via Mongoose 8. All environments use `MONGODBURL` — the connection string determines which database (Production, Beta, or Development) is used. An optional `productionMigration` mode (via `API_MODE=productionMigration`) adds a second connection to `MONGODBURL_MIGRATION` for dual-DB migrations.

## Search

Search has migrated from MongoDB Atlas Vector Search to **Meilisearch**. The old `embeddingService.ts` (OpenAI client-side embedding generation + in-memory LRU cache) has been removed.

Current Meilisearch indexes:

| Index | Service | Purpose |
|-------|---------|---------|
| `researchentities` | `researchEntitySearchIndexService.ts` | Yale Labs / Research search (`/research`) |
| `pathways` | `pathwaySearchIndexService.ts` | Internal ways-in enrichment, saved planning, parity testing, and future admin workflows |

The Meilisearch client (`server/src/utils/meiliClient.ts`) lazy-loads and caches the connection. Configuration: `MEILISEARCH_HOST` (defaults to `http://localhost:7700`), `MEILISEARCH_API_KEY`, and `MEILISEARCH_INDEX_PREFIX` (optional prefix applied to all index names, e.g. `beta_researchentities`). The module exports `getMeiliIndex(name)` and `resolveIndexName(name)`.

ResearchEntity and pathway index documents are synced via `meiliSyncService.ts` after upserts to their respective collections. Rebuild scripts (`meili:rebuild-research-entities`, `meili:rebuild-pathways`) do a full repopulation.

The legacy listing Meilisearch migration has been removed. Use the server rebuild scripts for current Research and Pathways indexes.

## Environments

Code flows Local → Beta → Prod. Beta is the staging gate where infrastructure and code changes are validated before production.

| Environment | Hosting | `MEILISEARCH_INDEX_PREFIX` | Data source |
|-------------|---------|---------------------------|-------------|
| Local | localhost | *(unset)* | Seed script / local MongoDB |
| Beta | Render (`ylabs-gr4v.onrender.com`) | `beta` | Rebuilt via server Meilisearch rebuild scripts |
| Prod | Render (`yalelabs.onrender.com`) | `prod` | Real data |

Meilisearch is a single Render Private Service shared by both beta and prod, isolated by index prefixes. MongoDB is a single Atlas cluster with separate databases per environment.

## Error Handling

Three custom error classes in `server/src/utils/errors.ts`:
- `NotFoundError` → 404
- `ObjectIdError` → 404
- `IncorrectPermissionsError` → 403

The error handler middleware (`server/src/middleware/errorHandler.ts`) also maps:
- Mongoose `ValidationError` → 400
- Mongoose `CastError` → 400
- MongoDB duplicate key (code 11000) → 409
- Everything else → 500

Full error details are exposed in development; production responses are generic.

The `asyncHandler` wrapper catches promise rejections in route handlers:
```typescript
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
```

## Analytics Interception

Analytics events are logged by intercepting `res.send` or `res.json` in route-level middleware. The original method is bound, replaced with a wrapper that fires a log event on 2xx responses, then calls the original. This keeps analytics logic out of controllers and services.

```typescript
const logListingEvent = (eventType: AnalyticsEventType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);
    res.send = function(data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // fire-and-forget event logging
      }
      return originalSend(data);
    };
    next();
  };
};
```

Event-specific wrappers can inspect the response body before forwarding it — e.g. `listings.ts` still fires `LISTING_CREATE`/`LISTING_UPDATE`/`LISTING_VIEW`/`SEARCH` events through this pattern on its (legacy but live) CRUD routes.

Analytics events have a 3-year TTL via MongoDB's `expireAfterSeconds` index.

## Testing

Client-side tests run under **Vitest 3** with a `jsdom` environment. Config lives in the `test` block of `client/vite.config.js`; tests are discovered from `client/src/**/*.{test,spec}.{ts,tsx}`.

Server-side tests also run under **Vitest** (`yarn --cwd server test`). Test files live in `server/src/services/__tests__/` and `server/src/scrapers/__tests__/`. Coverage spans services (accessSignal, accessSummary, fellowship matching, opportunity detail, pathway search, researchEntity DTO, Meilisearch sync, sourceHealth, userService, etc.) and scraper infrastructure (cronRunner, confidenceResolver, observationStore, observationRetention, runReport, scrapeJobLock, workPlanner, sourceCoverageRegistry, scraperEnvironment, renderedFetch, accessMaterializer, entityMaterializer) and individual scrapers (NSF, NIH, Yale Directory, Yale College Fellowships Office, OpenAlex, ORCID, undergrad fellowship recipient, YSE Centers, and more).

Coverage focuses on pure reducer modules in `client/src/reducers/`, with matching test files in `client/src/reducers/__tests__/`. The pattern extracts state transitions out of providers/components (as `createInitial<Name>State()` + `<name>Reducer(state, action)`) so they can be tested without mounting React or mocking network. Side effects (axios, localStorage, timers) stay in the component that uses `useReducer`.

Current reducers with test coverage (all in `client/src/reducers/`, tests in `client/src/reducers/__tests__/`):

| Reducer | Consumer | What it models |
|---------|----------|----------------|
| `searchReducer` | `SearchContextProvider` | Research search query, filters, sort, pagination, results lifecycle |
| `fellowshipSearchReducer` | `FellowshipSearchContextProvider` | Programs & Fellowships equivalent with filter-options fetch lifecycle |
| `browsePageReducer` | Legacy/common browse flows | Generic over `<T>`. Browse-page UI: favorites, detail-modal selection, admin-edit modal. Open/close modal flips `selectedItem` and `isDetailModalOpen` atomically. |
| `configReducer` | `ConfigContextProvider` | Config fetch (idle → loading → loaded/error) |
| `userReducer` | `UserContextProvider` | Auth-check lifecycle (loading → authenticated/unauthenticated) + explicit LOGOUT |
| `favoritesReducer` | Account saved-state compatibility flows | Favorited legacy rows plus programs, sort/filter/view state, optimistic add/remove |
| `ownListingsReducer` | Legacy compatibility only | Retired professor listing lifecycle residue |
| `unknownUserReducer` | Unknown-user flow | State for the "unknown user" verification path |
| `listingFormReducer` | Legacy compatibility only | Retired listing form state residue |
| `profileEditorReducer` | Profile editor | Profile form state |
| `publicationsTableReducer` | Publications table | Publication CRUD/table state |
| `inlineCrudReducer` | Inline CRUD components | Generic add/edit/delete row state |
| `accountTrackingReducer` | `components/accounts/FavoritesManager` | Kanban stage + notes per lab/fellowship; includes `loadAccountTrackingFromStorage()` with legacy-key migration |
| `adminTableReducer` | Admin tables | Generic admin table sort/filter/pagination |
| `adminListingsTableReducer` | Retired admin listings route | Listing-specific admin table state retained only for compatibility/regression cleanup |
| `adminFellowshipsTableReducer` | Admin fellowships table | Fellowship-specific admin table state |
| `adminFacultyProfilesTableReducer` | Admin faculty profiles table | Faculty profile admin table state |
| `adminListingEditReducer` | Retired admin listing edit | Edit form state retained only for compatibility/regression cleanup |
| `adminFellowshipEditReducer` | Admin fellowship edit | Edit form for an admin-managed fellowship |
| `adminFellowshipFormReducer` | Admin fellowship form | Fellowship create/edit form fields and errors |
| `adminProfileEditReducer` | Admin profile edit | Edit form for an admin-managed faculty profile |
| `analyticsReducer` | `pages/analytics` | Analytics dashboard fetch lifecycle (idle → loading → loaded/error) |
| `departmentInputReducer` | `DepartmentInput` combobox | Dropdown open/search/keyboard state for multi-select department input |
| `researchAreaInputReducer` | `ResearchAreaInput` combobox | Autocomplete open/filter/keyboard state for research area input |
| `labSearchReducer` | Research browse page (`/research`) | Research entity search query, filters, sort, pagination — mirrors `searchReducer` shape |
| `labDetailReducer` | Research detail page (`/research/:slug`) | Fetch lifecycle for a single research entity + Inquire modal toggle |
| `profilePageReducer` | Faculty profile page | Profile fetch lifecycle + `coursesAvailable` signal |

## CI

`.github/workflows/ci.yml` runs on PRs to `main` and `beta` (and via `workflow_dispatch`). Steps: checkout -> Node 20 -> Corepack -> `yarn install:all` -> server typecheck -> server tests -> client tests -> high-severity dependency audit -> `yarn build`. The workflow enforces that tests pass and both server and client build successfully before merge.

Client `tsc --noEmit` is intentionally **not** in CI because the client has pre-existing type errors (shadow-variable spreads, `AdminListing` field drift, etc.) that predate the reducer work. Server typecheck is in CI.

The only other workflow is `keep-alive.yml`, which pings the Beta Render service every 10 minutes to prevent cold starts.

## Rate Limiting

Two rate limiters in `app.ts`, both keyed by authenticated user's `netId` with IP fallback for unauthenticated requests:

| Limiter | Scope | Limit |
|---------|-------|-------|
| `apiLimiter` | All `/api` routes | 200 req / 15 min |
| `writeLimiter` | Non-GET API routes, including the legacy listing/fellowship CRUD routes | 50 req / 15 min |

Both limiters are skipped in CI, development, and test environments.

## Auth Middleware

Defined in `server/src/middleware/auth.ts`:

| Middleware | Check |
|------------|-------|
| `isAuthenticated` | `req.user` exists |
| `isAdmin` | `userType === 'admin'` |
| `isProfessor` | `userType` in `['professor', 'faculty', 'admin']` |
| `isTrustworthy` | `userConfirmed` + admin/professor/faculty |
| `isConfirmed` | `userConfirmed === true` |
| `canCreateListing` | professor/faculty/admin + `userConfirmed` + `profileVerified` (used by `POST /api/listings`) |

Client-side route guards: `PrivateRoute` (auth required, redirects unknown users when `unknownBlocked=true`), `AdminRoute` (admin only), `UnprivateRoute` (no auth required, for error pages).

## Validation Middleware

Exported from `server/src/middleware/`:
- `validateObjectId(paramName?)` — MongoDB ObjectId format check
- `validateNetid(paramName?)` — Yale-style netId path-parameter validation
- `requireBody()` — ensures request body exists
- `requireFields(fields[])` — specific field presence validation
- `validatePagination()` — page/pageSize within 1–500
- `validateSort(allowedFields[])` — sortBy/sortOrder validation
- `validateQuery(allowedParams[])` — query parameter whitelist

## Security Middleware

Applied globally / to `/api` in `app.ts` (in addition to CORS, session, passport, and the rate limiters):

| Middleware | File | Purpose |
|------------|------|---------|
| `securityHeaders` | `securityHeaders.ts` | Sets CSP (`connect-src` allowlist), permissions policy, and `X-*` security headers globally. Relaxed in non-production via the environment bypass. |
| `csrfOriginGuard(allowList)` | `csrfOriginGuard.ts` | Rejects unsafe-method `/api` requests whose `Origin`/`Referer` is not in the allowlist (safe methods GET/HEAD/OPTIONS exempt). |
| `sanitizeMongo` | `sanitizeMongo.ts` | Strips MongoDB operator (`$`/`.`) and prototype-pollution keys from `/api` request body/query to block injection. |
| `createCorsOriginHandler` | `corsOrigin.ts` | Builds the dynamic CORS origin handler; throws `CorsOriginError` (403) for disallowed origins. |
| `errorHandler` / `notFoundHandler` | `errorHandler.ts` | Terminal error + 404 handlers (see Error Handling). |

## Routes

All routes mount under `/api` in `app.ts`. Route files in `server/src/routes/`:

| Prefix | File | Auth |
|--------|------|------|
| `/research` | `researchGroups.ts` | Varies (search/detail public) |
| `/programs` | `programs.ts` | Varies — current Programs & Fellowships surface |
| `/opportunities` | `opportunities.ts` | Public |
| `/pathways` | `pathways.ts` | Auth required — internal pathway data |
| `/listings` | `listings.ts` | Auth required. **Legacy** listing CRUD/search still mounted and functional (search, create, get, update, archive/unarchive, addView, delete). The client `/listings` *path* redirects, but the API is not 410'd. |
| `/fellowships` | `fellowships.ts` | Auth required. **Legacy** fellowship CRUD/search; the mount sets `Deprecation: true` + `Link: </api/programs>; rel="successor-version"`. Prefer `/programs`. |
| `/users` | `users.ts` | Yes |
| `/profiles` | `profiles.ts` | Varies |
| `/analytics` | `analytics.ts` | Admin |
| `/config` | `config.ts` | No |
| `/research-areas` | `researchAreas.ts` | Admin for writes |
| `/admin` | `admin.ts` | Admin |
| `/seed` | `seed.ts` | Local development runtime only (`isLocalDevelopmentRuntime()`) |

Passport auth routes (CAS login/logout, dev-login) are mounted separately via `passportRoutes` before the main routes.

## Authentication Flow

```
User → Yale CAS SSO → passport.ts findOrCreateUser
     → Check DB (refresh if stale >30 days)
     → Yalies API (student/grad detection)
     → Yale Directory (faculty detection)
     → Fallback: fname "NA", userType "unknown"
     → Create/Update User → cookie-session (1 year, httpOnly, secure in production, sameSite lax)
```

## Key Services

`server/src/services/` holds 40+ services (all `*Service.ts` plus helper modules). Beyond the obvious CRUD services (`listingService`, `fellowshipService`, `programService`, `profileService`, `userService`, `researchGroupService`), the notable domains a new agent should know:

| Service | Responsibility |
|---------|----------------|
| `researchEntityDto.ts` / `researchEntityQuality.ts` | Public ResearchEntity DTO shaping and entity-quality scoring/gating |
| `researchEntitySearchIndexService.ts` / `pathwaySearchIndexService.ts` / `pathwaySearchService.ts` | Meilisearch index sync + query for research entities and pathways |
| `meiliSyncService.ts` | Syncs collection upserts into the Meilisearch indexes |
| `accessSignalService.ts` / `accessSummaryService.ts` / `entryPathwayService.ts` / `contactRouteService.ts` / `postedOpportunityService.ts` | The product-model access layer (signals, summaries, pathways, contact routes, postings) |
| `adminOperatorBoardService.ts` / `adminAccessReviewService.ts` / `adminGrantService.ts` | Admin operator board + access/grant review workflows |
| `sourceHealthService.ts` / `scholarlyActivityAuditService.ts` / `paperQualityService.ts` | Scraper/source health, scholarly-activity audit, paper-quality scoring |
| `studentVisibilityTier.ts` / `studentVisibilityGateService.ts` / `visibilityRepairQueueService.ts` / `studentDecisionExplanationService.ts` | Student visibility tiering, gating, repair queue, and decision explanations |
| `fellowshipMatchingService.ts` / `fellowshipApplicationCycleEvidenceService.ts` / `programClassifier.ts` | Fellowship matching, application-cycle evidence, program classification |
| `launchAcquisitionReportService.ts` / `launchTrustContractService.ts` | Launch-gate acquisition reporting and trust-contract checks |
| `listingResearchEntityProfile.ts` | Keeps legacy listings synced to their ResearchEntity profile |
| `directoryService.ts` / `yaliesService.ts` / `courseTableService.ts` | External integrations (Yale Directory, Yalies, CourseTable) |

## Naming Conventions

| Element | Convention | Examples |
|---------|-----------|----------|
| Services | camelCase + "Service" suffix | `listingService.ts`, `analyticsService.ts` |
| Models | PascalCase exports | `User`, `Listing`, `Fellowship` |
| Controllers | camelCase descriptive | `createListingForCurrentUser`, `searchListings` |
| Routes | Resource-based files | `listings.ts`, `users.ts` |
| DB fields | camelCase | `ownerPrimaryDepartment`, `primaryCategory` |
| Enums | PascalCase | `AnalyticsEventType`, `DepartmentCategory` |
| React components | PascalCase | `PrivateRoute`, `ListingForm` |
| React hooks | camelCase with `use` prefix | `useConfig`, `useInfiniteScroll` |
| Contexts | PascalCase + "Context" suffix | `UserContext`, `SearchContext` |

## Environment Variables

### `server/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODBURL` | Yes | MongoDB connection string. Points to Development locally, Beta on staging, Production on prod. |
| `MONGODBURL_MIGRATION` | For migration mode | Secondary DB for dual-DB migrations |
| `SESSION_SECRET` | Yes | Cookie session signing key |
| `API_MODE` | No | Set to `productionMigration` for dual-DB migration mode. Otherwise leave unset. |
| `SSOBASEURL` | Yes | Yale CAS URL |
| `SERVER_BASE_URL` | Yes | Public server URL for CAS callbacks |
| `YALIES_API_KEY` | No | API key for yalies.io |
| `OPENAI_API_KEY` | No | OpenAI API key (used by Meilisearch embedder config) |
| `MEILISEARCH_HOST` | No (default: `http://localhost:7700`) | Meilisearch instance URL |
| `MEILISEARCH_API_KEY` | No | Meilisearch API key |
| `MEILISEARCH_INDEX_PREFIX` | No | Environment prefix for index names (e.g., `prod`, `beta`). When set, indexes become `{prefix}_researchentities`, `{prefix}_pathways`, etc. Allows prod and beta to share one Meilisearch instance. |
| `PORT` | No (default: 4000) | Server port |
| `SCRAPER_ENV` | No (default: `development`) | Controls scraper write guards. `production` requires `CONFIRM_PROD_SCRAPE=true`. Non-production defaults to dry-run unless `ALLOW_NON_PROD_SCRAPER_WRITES=true`. |
| `ALLOW_NON_PROD_SCRAPER_WRITES` | No | Set to `true` to allow scraper writes to a non-production database. |
| `CONFIRM_PROD_SCRAPE` | No | Set to `true` to allow scraper writes to production. Required when `SCRAPER_ENV=production`. |

### `client/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_APP_SERVER` | Yes | Backend API URL (e.g., `http://localhost:4000`) |

## Sensitive Files

- `server/.env` and `client/.env` — credentials, API keys, database URLs. Never committed.
- `server/src/passport.ts` — CAS auth logic with user creation cascade. Changes here affect all authentication.
- `server/src/db/connections.ts` — database connection management. The `productionMigration` mode connects to two databases simultaneously.
- `server/src/app.ts` — CORS allowlist, rate limiter configuration, session settings. Security surface.

## Known Technical Debt

| Issue | Location | Status |
|-------|----------|--------|
| Pre-existing client type errors | `client/` | `tsc --noEmit` on the client is not clean (shadow-variable spreads, `AdminListing` field drift, etc.) and is not in CI. Requires a dedicated cleanup pass. |
| ESLint/Prettier configured but not in CI | `eslint.config.js`, `.prettierrc` | Flat-config ESLint + Prettier set up at repo root. Not wired to CI until pre-existing violations are triaged. Run `yarn lint`, `yarn lint:fix`, `yarn format`. |
| Console-only logging | Server | No structured logging (Winston/Pino) |
| Legacy naming residue | `server/src/` | Files and fields using `researchGroup`/`lab`/`researchGroupId` naming are migration residue. Canonical names are `ResearchEntity`, `research_entities`, `/api/research`. Do not expand legacy naming. |

## Product Model

The canonical runtime model for Yale Research (not a simple job board):

| Concept | Collection | Purpose |
|---------|-----------|---------|
| `ResearchEntity` | `research_entities` | What exists: lab, center, institute, faculty project, RA program, fellowship program, etc. |
| `EntryPathway` | `entry_pathways` | How a student might approach a plausible research home (posted role, recurring program, outreach, etc.) |
| `PostedOpportunity` | `posted_opportunities` | A real active/time-bound posting (Spring 2026 RA role, DHLab internship, etc.) |
| `AccessSignal` | `access_signals` | Evidence-backed signal about undergraduate access (past undergrads, posted opening, fellowship-compatible, etc.) |
| `ContactRoute` | `contact_routes` | The best known way to act (official application, lab manager, faculty PI, etc.) |

Important distinctions:
- Course credit and fellowship funding are **formalization outcomes** after a student finds a research home — not entry pathways.
- `EntryPathway` is durable; `PostedOpportunity` is a specific active/time-bound instance of one.
- Scrapers emit append-only `Observation` rows; `accessMaterializer.ts` and `entityMaterializer.ts` derive first-class access records from them.
- Avoid binary fields like `acceptingUndergrads`. Use `AccessSignal` with evidence strength instead.
- Contact routes are fail-closed: prefer official/public URLs; redact scraped emails from public payloads.

See `docs/research-model.md` for full schema and migration guidance.

## Scrapers

The scraper system lives in `server/src/scrapers/`. Run via `yarn --cwd server scrape <command>` (uses `server/src/scrapers/cli.ts`).

**Infrastructure files:**
- `cli.ts` — CLI entrypoint (`scrape run`, `scrape materialize`, `scrape report`, etc.)
- `orchestrator.ts` — `ScraperOrchestrator` runs registered scrapers sequentially
- `registry.ts` — registers all source scrapers
- `observationStore.ts` — writes `Observation` rows to MongoDB
- `entityMaterializer.ts` — derives `ResearchEntity`/`ResearchGroupMember` from observations
- `accessMaterializer.ts` — derives `AccessSignal`, `EntryPathway`, `ContactRoute` from observations. When the observation pipeline yields no source-backed (http-URL) entry pathway, it falls back to an evidence-based ways-in: for a concrete faculty/lab home with an attached PI/director lead and an official non-grant source page, a low-confidence `EXPLORATORY_CONTACT` pathway + `FACULTY_PI` route + `REACH_OUT_PLAUSIBLE` signal; for an **organizational home** (CENTER/INSTITUTE/INITIATIVE/CORE_FACILITY) with an official page but no named director, a center-level "Explore this center" `EXPLORATORY_CONTACT` pathway + `DEPARTMENT_CONTACT` route + signal. Both skip duplicates, grant/ORCID-only sources, and programs, and require a supporting source observation (matched by `entityId` or `entityKey`) so the claim gate keeps them. This removes the dominant `missing_action_evidence` blocker for real research homes without manufacturing undergrad-access claims. Backfill existing entities with `yarn --cwd server research-homes:backfill-faculty-ways-in` (dry-run-first; apply requires `--confirm-faculty-ways-in` + explicit `--limit`).
- `workPlanner.ts` — per-entity field-level work planning (what sources to run, what to skip)
- `snapshotCache.ts` — caches fetched pages to avoid redundant HTTP requests
- `scraperEnvironment.ts` — enforces `SCRAPER_ENV` write guards
- `sourceCoverageRegistry.ts` — declares source priority, tier, and artifact types
- `cronRunner.ts` — cron-aware runner with distributed job locking (`ScrapeJobLock`) to prevent overlapping runs
- `confidenceResolver.ts` — pure-function aggregator that picks a winning observation value and computes a confidence score (no DB calls, fully testable)
- `observationRetention.ts` — TTL/cleanup logic for old observation rows
- `renderedFetch.ts` — headless-browser fetch helper for JS-rendered pages
- `runReport.ts` — generates a structured report for a completed scrape run
- `scrapeJobLock.ts` — acquire/heartbeat/release helpers wrapping the `ScrapeJobLock` model
- `seedSources.ts` — populates the `Source` collection from the coverage registry
- `integrityGate.ts` — post-materialization integrity gate; detects duplicate entities/people/papers, current members on archived entities, duplicate contact routes/access signals, and active artifacts on archived entities, with recommended CLI repair commands
- `paperAuthorshipPolicy.ts` — policy logic governing which paper authorships are accepted/attributed
- `cliHelpers.ts` — CLI argument parsing and shared helpers for `cli.ts`
- `scraperCliOutput.ts` — formatting/styling for scraper CLI output
- `types.ts` — shared TypeScript types for scraper infrastructure
- `scraplingBridge.py` — Python bridge for scraper utilities requiring Python tooling

**Active source scrapers** (in `server/src/scrapers/sources/`):

| Scraper | Data |
|---------|------|
| `nsfAwardScraper.ts` | NSF grant awards |
| `nihReporterScraper.ts` | NIH Reporter grants |
| `centersInstitutesScraper.ts` | Yale centers and institutes index |
| `departmentRosterScraper.ts` | Department faculty roster pages |
| `ysmAtoZScraper.ts` | Yale School of Medicine A–Z index |
| `yseCentersScraper.ts` | Yale School of Engineering centers |
| `arxivPreprintScraper.ts` | arXiv preprints |
| `openAlexPaperScraper.ts` | OpenAlex paper metadata |
| `orcidWorksScraper.ts` | ORCID public works with identity-backed authorship |
| `europePmcPaperScraper.ts` | Europe PMC and PubMed ORCID-backed paper metadata |
| `crossrefPaperScraper.ts` | Crossref DOI metadata hydration |
| `departmentUndergradResearchScraper.ts` | Department-level undergraduate research opportunity/program pages |
| `undergradFellowshipRecipientScraper.ts` | Undergrad fellowship recipient lists |
| `labMicrositeUndergradLLMExtractor.ts` | LLM extraction of undergrad-access signals from lab microsites |
| `labMicrositeDescriptionLLMExtractor.ts` | LLM extraction of lab description text from microsites |
| `studentDecisionLLMExtractor.ts` | LLM extraction of student-decision signals from lab microsites |
| `officialProfilePiBackfillScraper.ts` | Backfill scraper for PI official-profile data |
| `yaleResearchOfficialScraper.ts` | Yale Research (provost/OVPR) official data |
| `yaleCollegeFellowshipsOfficeScraper.ts` | Yale College Fellowships Office public catalog |
| `yaleDirectoryScraper.ts` | Faculty roster via Yalies API (live equivalent of the static bootstrap import) |

**Scraper safety rules:**
- Non-production environments default to dry-run. Set `ALLOW_NON_PROD_SCRAPER_WRITES=true` to write to a dev DB.
- Production requires `SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true`.
- Scrapers emit observations first; materializers derive access records. Never hard-assert product conclusions directly from scraper output.

See `docs/scraper-audit-guide.md` and `docs/scraper-deployment-runbook.md` for audit and deployment details.

## Adding a New Endpoint

1. Route in `server/src/routes/<resource>.ts` — define HTTP method, path, middleware chain
2. Controller in `server/src/controllers/<resource>Controller.ts` — extract request data, call service, format response
3. Service in `server/src/services/<resource>Service.ts` — business logic, DB operations
4. Apply auth middleware (`isAuthenticated`, `isProfessor`, `isAdmin`, etc.) and validation middleware in the route

## Adding a New Page

1. Page component in `client/src/pages/<page>.tsx`
2. Route in `client/src/App.tsx` wrapped with appropriate guard (`PrivateRoute`, `AdminRoute`)

Current student-facing pages (files in `client/src/pages/`): `research.tsx` (Yale Labs browse, `/research`), `labDetail.tsx` (`/research/:slug`), `fellowships.tsx` (rendered at `/programs` — the Programs & Fellowships surface; there is no `programs.tsx`), `opportunityDetail.tsx` (`/opportunities/:id`), `account.tsx`, `profile.tsx` (`/profile/:netid`), `analytics.tsx` (admin), `about.tsx`, `login.tsx`, `loginError.tsx`, `notFound.tsx`, `unknown.tsx`, and `rootRedirect.tsx` (redirects `/` → `/research`). The `/listings` and `/fellowships` paths redirect (e.g. `RetiredListingsRedirect`) rather than define new product surfaces. `pathways.tsx` and `home.tsx` are no longer routed in `App.tsx` (`pathways.tsx` was removed; `home.tsx` is legacy residue).

## Modifying a Schema

1. Mongoose schema in `server/src/models/<model>.ts`
2. TypeScript interfaces in `client/src/types/`
3. Migration script in `data-migration/` if existing data needs transformation
4. If the model affects Research or Pathways search, update the relevant Meilisearch rebuild/index config and release gate.

## External Integrations

| Service | Purpose | Auth | Location |
|---------|---------|------|----------|
| Yale CAS SSO | Authentication | CAS server URL | `passport.ts` |
| Yalies API (`api.yalies.io`) | Student/grad data lookup | API key | `yaliesService.ts` |
| Yale Directory (`directory.yale.edu`) | Faculty data lookup | None | `directoryService.ts` |
| CourseTable (`coursetable.com/api/catalog/public`) | Professor course data | None | `courseTableService.ts` |
| Meilisearch | Hybrid search (keyword + semantic) | API key | `meiliClient.ts` |
| OpenAI | Embeddings via Meilisearch embedder | API key (in Meilisearch config) | Configured through Meilisearch/index setup and gated before semantic Research rollout |

## Maintenance

DEVELOPER_GUIDE.md and CLAUDE.md are living documents. When making changes that affect architecture, services, models, routes, patterns, environment variables, or external integrations, both files are updated in the same commit as the code change. CLAUDE.md is updated to reflect new factual context. DEVELOPER_GUIDE.md is updated to keep the human-facing documentation accurate. Neither file is updated speculatively — only when something described in them has actually changed.

## Graphify Repo Memory

Graphify is the shared knowledge graph and navigation layer for this repo. Output lives in `graphify-out/`.

**Before broad codebase exploration**, read `graphify-out/GRAPH_REPORT.md` — it maps the repo and is faster than grep for cross-module questions.

| Command | Effect |
|---------|--------|
| `graphify query "<question>"` | Ask cross-module architecture questions |
| `graphify explain "<concept>"` | Get definition and related nodes for a concept |
| `graphify path "<A>" "<B>"` | Trace relationship between two nodes |
| `graphify update .` | Rebuild graph from AST after code changes (no API cost) |
| `graphify extract .` | Optional: full semantic extraction (requires LLM key) |

**Refresh policy**: run `graphify update .` after durable changes to schema/models, scraper behavior, architecture, or product docs. If Graphify cannot be refreshed, note it in the final response.

**Source of truth**: Graphify is a navigation layer only. Verify important claims against source files, tests, and `docs/*.md` before editing or summarizing.

**Committed outputs** (in `graphify-out/`): `GRAPH_REPORT.md`, `graph.json`, and `graph.html` only when Graphify generates it. Large graphs may skip HTML output and rely on `graph.json` plus `GRAPH_REPORT.md`. Not committed: `cache/`, `cost.json`, `manifest.json`, `.graphify_root`, `.graphify_analysis.json`, `.graphify_labels.json`, `.rebuild.lock`, `memory/`.

**Installation**: `uv tool install graphifyy` (preferred) or `pipx install graphifyy`, then `graphify install --platform codex`.

`.graphifyignore` controls what enters the graph — keep it strict (no secrets, `node_modules`, build outputs, or raw scraped data).
