---
name: auth-security
description: Use when touching authentication, authorization, Yale CAS, sessions, Passport, user creation, dev login, auth middleware, validation middleware, rate limiting, CORS, CSRF, security headers, SSRF protections, sensitive env vars, or outbound fetches derived from user or stored data.
---

# Auth and Security

Changes here affect login, permissions, request safety, and production exposure.
Prefer source verification before editing `passport.ts`, `app.ts`, security middleware, DB connections, or env handling.

## Authentication flow

```
User -> Yale CAS SSO -> passport.ts findOrCreateUser
     -> Check DB, refresh if stale over 30 days
     -> Yalies API for student/grad detection
     -> Yale Directory for faculty detection
     -> Fallback: fname "NA", userType "unknown"
     -> Create/update User
     -> cookie-session for 30 days, httpOnly, secure in prod, sameSite lax
```

The find-or-create cascade runs only at login time.
Per-request session restore in `deserializeUser` is a plain `validateUser` read plus the admin-grant check.
The admin-grant check is cached in memory for 60 seconds in `adminGrantService` and invalidated on grant or revoke.
A session whose user doc no longer exists deserializes to unauthenticated.

Dev login bypass:

`GET http://localhost:4000/api/dev-login`

This creates a test session as `test123` with user type `undergraduate`.
Pass `?userType=admin|professor|faculty|graduate|unknown` for a different local account.
`unknown` is the only way to reach `/unknown` onboarding locally.

## Auth middleware

Defined in `server/src/middleware/auth.ts`.

| Middleware | Check |
|------------|-------|
| `isAuthenticated` | `req.user` exists. |
| `isAdmin` | `userType === 'admin'`. |
| `isProfessor` | `userType` is `professor`, `faculty`, or `admin`. |
| `isTrustworthy` | confirmed admin, professor, or faculty. |
| `isConfirmed` | `userConfirmed === true`. |

Client route guards:

| Guard | Purpose |
|-------|---------|
| `PrivateRoute` | Auth required; redirects unknown users when `unknownBlocked=true`. |
| `AdminRoute` | Admin only. |
| `UnprivateRoute` | No auth required. |

## Validation middleware

Exported from `server/src/middleware/`:

- `validateObjectId(paramName?)`
- `validateNetid(paramName?)`
- `requireBody()`
- `requireFields(fields[])`
- `validatePagination()`
- `validateSort(allowedFields[])`
- `validateQuery(allowedParams[])`

## Security middleware

Applied globally or to `/api` in `app.ts`.

| Middleware | Purpose |
|------------|---------|
| `securityHeaders` | CSP, permissions policy, and `X-*` headers. |
| `csrfOriginGuard(allowList)` | Rejects unsafe-method `/api` requests from non-allowlisted origins or referrers. |
| `sanitizeMongo` | Strips Mongo operator and prototype-pollution keys from body/query. |
| `createCorsOriginHandler` | Dynamic CORS origin handler. |
| `errorHandler` / `notFoundHandler` | Terminal error and 404 handlers. |

SSRF protection lives in `server/src/utils/ssrfGuard.ts`.
Any outbound fetch to a host derived from user input or stored data must go through it.
Use `assertPublicHttpUrl`, `ssrfSafeLookup`, and `ssrfSafeAgents` as appropriate.

## Rate limits

The limiters live in `server/src/middleware/rateLimiters.ts`.
Request-scoped limiters (`globalLimiter`, `writeLimit`) are keyed by authenticated user's normalized `netId`, then by a server-generated high-entropy identifier in the signed cookie session, with IP fallback when no valid signed session is available.
The anonymous identifier is initialized only for `/api` requests.
This prevents shared proxy buckets without trusting forwarding headers.
`authLimiter` is keyed by the real TCP peer IP so login cannot be brute-forced from one host regardless of session.
All limiters are skipped in CI, development, and test.
Responses with a `5x` status do not count against a caller's budget (`skipFailedRequests` with `requestWasSuccessful` = status under 500), so a transient backend outage (e.g. a MongoDB reconnect returning 503) cannot lock a user out for the rest of the window; `4xx` still counts.

Write limiting is opt-in per route, not inferred from the HTTP method.
A route is billed as a write only if it lists the `writeLimit` middleware in its definition, so reads and telemetry (search, exports, `addView`, the `/analytics/research` beacon) can never exhaust the mutation budget, and a new route defaults to read-safe.

| Limiter | Scope | Limit |
|---------|-------|-------|
| `globalLimiter` | All `/api` except `/api/cas`. Safety net across reads, telemetry, and writes. | 1000 per 15 minutes. |
| `writeLimit` | Opt-in per route on genuine mutations (favorites/saves, profile edits, claims, research outreach, admin writes). | 50 per 15 minutes. |
| `authLimiter` | `/api/cas` login callback, keyed per IP. | 20 per 15 minutes. |

`globalLimiter` is sized high because un-batched view and impression telemetry rides this budget; lower it once analytics beacons are batched client-side.
The limiters use express-rate-limit's in-process MemoryStore, which is correct only because the Render web service runs a single instance; if it is ever scaled beyond one instance, move to a shared store (e.g. Redis) first.

Yale Research has no faculty lab or opportunity authoring routes.
Source-discovered opportunity detail is public and returns only the student-safe projection.

## Error handling

Custom errors in `server/src/utils/errors.ts`:

| Error | Status |
|-------|--------|
| `NotFoundError` | 404 |
| `ObjectIdError` | 404 |
| `IncorrectPermissionsError` | 403 |

The error handler maps Mongoose `ValidationError` to 400, `CastError` to 400, MongoDB duplicate key 11000 to 409, and everything else to 500.
Development responses include full details.
Production responses are generic.

## Sensitive areas

- `server/.env` and `client/.env` contain credentials, API keys, and database URLs.
Never commit them.
- `server/src/passport.ts` controls CAS auth and user creation.
- `server/src/db/connections.ts` controls database connections and migration mode.
- `server/src/app.ts` controls CORS, rate limits, session settings, route mounting, and security middleware.
- Production scraper writes require explicit guardrails with `SCRAPER_ENV=production` and `CONFIRM_PROD_SCRAPE=true`.

## Environment variables

### Server

| Variable | Required | Purpose |
|----------|----------|---------|
| `MONGODBURL` | Yes | MongoDB connection string. |
| `MONGODBURL_MIGRATION` | Migration mode | Secondary DB for dual-DB migrations. |
| `SESSION_SECRET` | Yes | Cookie session signing key. |
| `AUTH_DEBUG` | No | Enables verbose auth tracing when `true`. |
| `API_MODE` | No | `productionMigration` for dual-DB migration mode. |
| `SSOBASEURL` | Yes | Yale CAS URL. |
| `SERVER_BASE_URL` | Yes | Public server URL for CAS callbacks. |
| `TRUSTED_PROXY_CIDRS` | Deployed | Non-empty comma-separated proxy CIDRs trusted for forwarded visitor IP resolution; empty is allowed only in local development and tests. |
| `YALIES_API_KEY` | No | API key for yalies.io. |
| `OPENAI_API_KEY` | No | OpenAI key for Meilisearch embedder config and LLM extractors. |
| `MEILISEARCH_HOST` | No | Meilisearch host. |
| `MEILISEARCH_API_KEY` | No | Meilisearch API key. |
| `MEILISEARCH_INDEX_PREFIX` | No | Environment index prefix. |
| `PORT` | No | Server port, default 4000. |
| `SCRAPER_ENV` | No | Scraper write guards. |
| `ALLOW_NON_PROD_SCRAPER_WRITES` | No | Enables scraper writes to non-prod DBs. |
| `CONFIRM_PROD_SCRAPE` | No | Enables production scraper writes with production env. |
| `SCRAPER_DEVELOPMENT_DB_NAME` | No | Overrides the exact Development database name expected by scraper guards. |
| `SCRAPER_BETA_DB_NAME` | No | Overrides the exact Beta database name expected by scraper guards. |
| `SCRAPER_PRODUCTION_DB_NAME` | No | Overrides the exact Production database name expected by scraper guards. |
| `GATE_SCORECARD_MAX_AGE_HOURS` | No | Max age before a gate scorecard is stale. |
| `GATE_REFRESH_INTERVAL_MINUTES` | No | Positive value enables in-process gate refresh. |
| `GATE_REFRESH_SKIP_HEAVY` | No | Skips heavy gate refresh work when `true`. |

### Client

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_APP_SERVER` | Yes | Backend API URL. |
