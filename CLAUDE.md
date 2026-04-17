# Y/Labs Codebase Reference

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
ylabs/
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
│       ├── services/         # Business logic (11 services)
│       ├── models/           # Mongoose schemas (user, listing, fellowship, analytics, department, researchArea)
│       ├── middleware/        # Auth guards, validation, error handling
│       ├── db/               # Multi-mode database connections
│       ├── utils/            # smartTitle, errors, permissions (legacy), environment, meiliClient
│       └── scripts/          # One-off import/cleanup scripts
└── data-migration/           # Standalone migration scripts (run with ts-node --transpile-only)
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

Migration scripts run from `data-migration/` with `npx ts-node --transpile-only <script>.ts`.

Dev login bypass: `GET http://localhost:4000/api/dev-login` creates a test session (`test123` / `student`) without CAS.

## TypeScript Configuration

**Server**: target ES2022, module NodeNext, moduleResolution NodeNext, strict true, output to `build/`.

**Client**: target ES5, module ESNext, jsx react-jsx, strict true, noEmit true.

## Database

MongoDB via Mongoose 8. All environments use `MONGODBURL` — the connection string determines which database (Production, Beta, or Development) is used. An optional `productionMigration` mode (via `API_MODE=productionMigration`) adds a second connection to `MONGODBURL_MIGRATION` for dual-DB migrations; `getListingModel()` returns the migration model in this mode.

## Search

Search has migrated from MongoDB Atlas Vector Search to **Meilisearch**. The old `embeddingService.ts` (OpenAI client-side embedding generation + in-memory LRU cache) has been removed.

Current search flow:
1. Client sends query + filters to `/api/listings/search`
2. Controller builds Meilisearch filter strings from query params (`departments`, `researchAreas`, `archived`, `confirmed`)
3. When a text query is present, hybrid search is enabled with `semanticRatio: 0.8` using the Meilisearch-configured OpenAI embedder
4. Results are returned with `estimatedTotalHits` for pagination

The Meilisearch client (`server/src/utils/meiliClient.ts`) lazy-loads and caches the connection. Configuration: `MEILISEARCH_HOST` (defaults to `http://localhost:7700`), `MEILISEARCH_API_KEY`, and `MEILISEARCH_INDEX_PREFIX` (optional, for multi-environment isolation on a shared instance). The module exports `getMeiliIndex(name)` which resolves prefixed index names and `resolveIndexName(name)` for use in migration scripts.

Listing mutations in `listingService.ts` sync to Meilisearch after MongoDB writes — create uses `addDocuments()`, update uses `updateDocuments()`, delete uses `deleteDocument()`. Documents are indexed with `primaryKey: 'id'` (string-cast `_id`), with `embedding`, `_id`, and `__v` fields stripped.

The migration script `data-migration/MigrateToMeilisearch.ts` configures the Meilisearch index with filterable attributes (`departments`, `researchAreas`, `archived`, `confirmed`), sortable attributes (`createdAt`, `updatedAt`, `searchScore`), and the OpenAI embedder. Run it with `MEILISEARCH_INDEX_PREFIX` set to populate the correct index per environment.

## Environments

Code flows Local → Beta → Prod. Beta is the staging gate where infrastructure and code changes are validated before production.

| Environment | Hosting | `MEILISEARCH_INDEX_PREFIX` | Data source |
|-------------|---------|---------------------------|-------------|
| Local | localhost | *(unset)* | Seed script / local MongoDB |
| Beta | Render (`ylabs-dev.onrender.com`) | `beta` | Seeded via `MigrateToMeilisearch.ts` |
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

Analytics events are logged by intercepting `res.send` or `res.json` in route-level middleware (`server/src/routes/listings.ts`). The original method is bound, replaced with a wrapper that fires a log event on 2xx responses, then calls the original. This keeps analytics logic out of controllers and services.

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

Listing creation uses the same pattern but intercepts `res.json` to extract the created listing's `_id` from the response body.

Analytics events have a 3-year TTL via MongoDB's `expireAfterSeconds` index.

## Testing

Client-side tests run under **Vitest 3** with a `jsdom` environment. Config lives in the `test` block of `client/vite.config.js`; tests are discovered from `client/src/**/*.{test,spec}.{ts,tsx}`. The server has no test framework configured.

Coverage focuses on pure reducer modules in `client/src/reducers/`, with matching test files in `client/src/reducers/__tests__/`. The pattern extracts state transitions out of providers/components (as `createInitial<Name>State()` + `<name>Reducer(state, action)`) so they can be tested without mounting React or mocking network. Side effects (axios, localStorage, timers) stay in the component that uses `useReducer`.

Current reducers with test coverage:

| Reducer | Consumer | What it models |
|---------|----------|----------------|
| `searchReducer` | `SearchContextProvider` | Listing search query, filters, sort, pagination, results lifecycle |
| `fellowshipSearchReducer` | `FellowshipSearchContextProvider` | Fellowship equivalent with filter-options fetch lifecycle |
| `configReducer` | `ConfigContextProvider` | Config fetch (idle → loading → loaded/error) |
| `listingFormReducer` | `components/accounts/ListingForm` | Form fields, errors, hydrate/reset, department add/remove |
| `accountTrackingReducer` | `pages/account.tsx` | Kanban stage + notes per lab/fellowship; includes `loadAccountTrackingFromStorage()` with legacy-key migration |

## CI

`.github/workflows/ci.yml` runs on PRs to `main` and `beta` (and via `workflow_dispatch`). Steps: checkout → Node 20 → Corepack → `yarn install:all` → `yarn --cwd client test:ci` → `yarn build`. The workflow enforces that tests pass and both server and client build successfully before merge.

`tsc --noEmit` is intentionally **not** in CI — the client has pre-existing type errors (shadow-variable spreads, `AdminListing` field drift, etc.) that predate the reducer work. Enforcing strict typecheck requires a dedicated cleanup pass first.

The only other workflow is `keep-alive.yml`, which pings the Beta Render service every 10 minutes to prevent cold starts.

## Rate Limiting

Two rate limiters in `app.ts`, both keyed by authenticated user's `netId` with IP fallback for unauthenticated requests:

| Limiter | Scope | Limit |
|---------|-------|-------|
| `apiLimiter` | All `/api` routes | 200 req / 15 min |
| `writeLimiter` | Non-GET requests to `/api/listings` and `/api/fellowships` | 50 req / 15 min |

Both limiters are skipped in CI, development, and test environments.

## Auth Middleware

Defined in `server/src/middleware/auth.ts`:

| Middleware | Check |
|------------|-------|
| `isAuthenticated` | `req.user` exists |
| `isAdmin` | `userType === 'admin'` |
| `isProfessor` | `userType` in `['professor', 'faculty', 'admin']` |
| `canCreateListing` | professor/faculty + `profileVerified` (admins bypass) |
| `isTrustworthy` | `userConfirmed` + admin/professor/faculty |
| `isConfirmed` | `userConfirmed === true` |

Client-side route guards: `PrivateRoute` (auth required, redirects unknown users when `unknownBlocked=true`), `AdminRoute` (admin only), `UnprivateRoute` (no auth required, for error pages).

## Validation Middleware

Exported from `server/src/middleware/`:
- `validateObjectId(paramName?)` — MongoDB ObjectId format check
- `requireBody()` — ensures request body exists
- `requireFields(fields[])` — specific field presence validation
- `validatePagination()` — page/pageSize within 1–500
- `validateSort(allowedFields[])` — sortBy/sortOrder validation
- `validateQuery(allowedParams[])` — query parameter whitelist

## Routes

All routes mount under `/api` in `app.ts`. Route files in `server/src/routes/`:

| Prefix | File | Auth |
|--------|------|------|
| `/listings` | `listings.ts` | Varies (search public, mutations require auth) |
| `/fellowships` | `fellowships.ts` | Varies |
| `/users` | `users.ts` | Yes |
| `/profiles` | `profiles.ts` | Varies |
| `/analytics` | `analytics.ts` | Admin |
| `/config` | `config.ts` | No |
| `/research-areas` | `researchAreas.ts` | Admin for writes |
| `/admin` | `admin.ts` | Admin |
| `/seed` | `seed.ts` | Dev mode only |

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
| `MEILISEARCH_INDEX_PREFIX` | No | Environment prefix for index names (e.g., `prod`, `beta`). When set, indexes become `{prefix}_listings`. Allows prod and beta to share one Meilisearch instance. |
| `PORT` | No (default: 4000) | Server port |

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
| `account.tsx` is ~65KB | `client/src/pages/account.tsx` | Deferred — splitting into ListingEditor, ProfileEditor, FavoritesManager is planned |
| Non-atomic view/favorite counters | `server/src/services/itemOperations.ts` | Uses read-then-update instead of `$inc`; race condition under load |
| No server-side tests | `server/` | No test framework configured server-side. Client uses Vitest; reducer modules in `client/src/reducers/` are covered. |
| ESLint/Prettier configured but not in CI | `eslint.config.js`, `.prettierrc` | Flat-config ESLint + Prettier set up at repo root. Currently reports ~15 errors / ~55 warnings across the codebase; not wired to CI until pre-existing violations are triaged. Run `yarn lint`, `yarn lint:fix`, `yarn format`. |
| Console-only logging | Server | No structured logging (Winston/Pino) |

## Adding a New Endpoint

1. Route in `server/src/routes/<resource>.ts` — define HTTP method, path, middleware chain
2. Controller in `server/src/controllers/<resource>Controller.ts` — extract request data, call service, format response
3. Service in `server/src/services/<resource>Service.ts` — business logic, DB operations
4. Apply auth middleware (`isAuthenticated`, `isProfessor`, `isAdmin`, etc.) and validation middleware in the route

## Adding a New Page

1. Page component in `client/src/pages/<page>.tsx`
2. Route in `client/src/App.tsx` wrapped with appropriate guard (`PrivateRoute`, `AdminRoute`)

## Modifying a Schema

1. Mongoose schema in `server/src/models/<model>.ts`
2. TypeScript interfaces in `client/src/types/`
3. Migration script in `data-migration/` if existing data needs transformation
4. If the model is `listing`, update the Meilisearch index configuration (filterable/sortable attributes) if new fields need to be searchable or filterable

## External Integrations

| Service | Purpose | Auth | Location |
|---------|---------|------|----------|
| Yale CAS SSO | Authentication | CAS server URL | `passport.ts` |
| Yalies API (`api.yalies.io`) | Student/grad data lookup | API key | `yaliesService.ts` |
| Yale Directory (`directory.yale.edu`) | Faculty data lookup | None | `directoryService.ts` |
| CourseTable (`coursetable.com/api/catalog/public`) | Professor course data | None | `courseTableService.ts` |
| Meilisearch | Hybrid search (keyword + semantic) | API key | `meiliClient.ts` |
| OpenAI | Embeddings via Meilisearch embedder | API key (in Meilisearch config) | Configured in migration script |

## Maintenance

DEVELOPER_GUIDE.md and CLAUDE.md are living documents. When making changes that affect architecture, services, models, routes, patterns, environment variables, or external integrations, both files are updated in the same commit as the code change. CLAUDE.md is updated to reflect new factual context. DEVELOPER_GUIDE.md is updated to keep the human-facing documentation accurate. Neither file is updated speculatively — only when something described in them has actually changed.
