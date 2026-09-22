---
name: auth-security
description: Use when touching authentication, authorization, Yale CAS, sessions, Passport, user creation, dev login, auth middleware, validation middleware, rate limiting, CORS, CSRF, security headers, SSRF protections, sensitive env vars, or outbound fetches derived from user or stored data.
---

# Auth and Security

Changes here affect login, permissions, request safety, and production exposure.
Prefer source verification before editing `passport.ts`, `app.ts`, security middleware, DB connections, or env handling.

## Authentication flow

```
User -> Yale CAS SSO -> passport.ts resolveLoginPrincipalForCas
     -> Yalies API for undergrad/grad classification
     -> Yale Directory for faculty classification
     -> Fallback: userType "unknown"
     -> accountService.recordAccountLogin: resolve-or-create Account (netid/email), stamp lastLoginAt
     -> cookie-session for 30 days, httpOnly, secure in prod, sameSite lax
```

Authentication runs on the canonical `Account` (the private login principal); the legacy `User` model has been retired (#2014).
Classification (undergrad/grad/faculty) is derived at login and carried in the signed session for authorization decisions; a descriptive copy of the Yalies/Directory profile (name, `userType`, title/department for faculty, college/year/major for students) is persisted onto `Account.profile` at login via `recordAccountLogin`, refreshed on each sign-in.
Accounts are created only at login (never by the scraper); the scraper's identity materialization enriches researchers that already exist but mints no Account or Researcher on its own.
`userType` is a classification/analytics dimension only; it does not authorize anything, whether read from the session or the persisted profile.
Admin authority is a separate signal: `buildAuthenticatedSessionUser` sets `isAdmin` from `hasActiveAdminGrant`, and that boolean is what guards and the client key off.
The classification cascade runs only at login time.
Per-request session restore in `deserializeUser` re-validates that the backing `Account` exists and is not archived, then recomputes `isAdmin` from the admin-grant check.
The admin-grant check is cached in memory for 60 seconds in `adminGrantService` and invalidated on grant or revoke.
A session whose `Account` no longer exists or is archived deserializes to unauthenticated.

Dev login bypass:

`GET http://localhost:4000/api/dev-login`

This creates a test session as `test123` with user type `undergraduate`.
Pass `?userType=admin|professor|faculty|graduate|unknown` for a different local account.
`?userType=admin` mints an idempotent local bootstrap `AdminGrant` (via `ensureBootstrapAdminGrant`), so dev admin authority comes from a real grant, not a `userType` shortcut.

## Auth middleware

Defined in `server/src/middleware/auth.ts`.

| Middleware | Check |
|------------|-------|
| `isAuthenticated` | `req.user` has a valid bounded NetID. |
| `isAdmin` | active `AdminGrant` for the NetID (`hasActiveAdminGrant`). |

There are no `userType`-based authorization guards.
Admin-review write surfaces (research-area creation) use `isAdmin`; correction-report and listing-claim submission use `isAuthenticated`.

Client route guards:

| Guard | Purpose |
|-------|---------|
| `PrivateRoute` | Auth required. |
| `AdminRoute` | Admin only, keyed off the server-provided `user.isAdmin`. |
| `PublicRoute` | Renders for logged-out and authenticated users alike. |
| `UnprivateRoute` | No auth required. |

## Validation middleware

Exported from `server/src/middleware/`:

- `validateObjectId(paramName?)`
- `validateNetid(paramName?)`
- `requireFields(fields[])`
- `validatePagination()`
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

The guard refuses first and reports second, so its refusal is the only signal a caller ever sees for a host it never reached.
`classifyHostnameResolution` returns which of `public`, `private-address`, `unresolvable`, or `resolver-failure` applies, and `assertPublicHttpUrl` carries the same value on `SsrfBlockedError.reason`.
`isPublicHostname` remains the yes/no wrapper and collapses every non-public kind to `false`.
Only `ENOTFOUND` and `ENODATA` count as `unresolvable`, because every other lookup failure is our resolver rather than the name, and even those two are confirmed by a second lookup before they are recorded.
Node reports `ENOTFOUND` for names that plainly exist when the resolver is under stress, so a single negative is a report about the lookup rather than a fact about the name (#2725).
One 250 ms re-ask was not enough: a resolver outage lasting seconds makes both attempts agree, and a pass run that way recorded 154 hosts dead of which 134 answered `200` from a healthy network (#2775).
`NAME_LOOKUP_RETRY_DELAYS_MS` now re-asks at 250 ms, 2 s and 10 s, so a genuinely absent name costs three cheap lookups while a transient failure gets more than ten seconds to recover (#2782).
`unresolvable` is the only verdict a caller acts on destructively, which is why it is the only one that is re-asked at all; an inconclusive failure returns immediately and spends no retry.
No retry interval is sufficient on its own, because any fixed interval is a guess about outage length.
A pass that probes many hosts has a better signal: `ResolverCircuitBreaker` in `server/src/scrapers/utils/resolverCircuitBreaker.ts` counts **distinct** hosts that fail to resolve inside a sliding window and throws `ResolverUnhealthyError` once they reach a threshold, halting the pass rather than recording further deaths.
It counts distinct hosts so one genuinely dead host retried in a loop never trips it, and it trips open and stays open so a caller cannot continue past it.
The failure mode is deliberate: a false halt costs a re-run, a false death hides a live page from a student, so halting wins when the two are indistinguishable.
This distinction is load-bearing rather than cosmetic: a bare `catch { return false }` made "this name has no record" indistinguishable from "this resolves somewhere we refuse to go", so `sourceLinkHealth` recorded a host that had stopped existing as `UNKNOWN` and `ENOTFOUND` in its `DEAD_LINK_ERROR_CODES` was unreachable (#2709).
When adding a refusal path, give it a reason and keep the security answer unchanged: a private or loopback address must still be refused and must still read as inconclusive, because that is a fact about our network position and not about whether the page exists.
Inconclusive is not the same as uninformative, though.
A `private-address` refusal is a durable fact about addressing, so `probeSourceLink` reports it as `privateAddressHost` alongside the inconclusive error code, and `sourceLinkHealth` stores it as a second axis beside `healthStatus`.
Discarding it made a host only Yale's network can route to indistinguishable from a throttled request, and because `UNKNOWN` fails open the visibility gate credited it as a way in for a student off campus (#2556).
Judge that question from the resolved IP and never from whether a fetch succeeded: a machine egressing from a Yale range fetches these hosts successfully, which is evidence about the machine rather than about the audience.
`docs/research-data-pipeline.md` owns what each axis licenses.

## Rate limits

The limiters live in `server/src/middleware/rateLimiters.ts`.
Request-scoped limiters (`globalLimiter`, `writeLimit`) are keyed by authenticated user's normalized `netId`, then by a server-generated high-entropy identifier in the signed cookie session, with IP fallback when no valid signed session is available.
The anonymous identifier is initialized only for `/api` requests.
This prevents shared proxy buckets, because the netid and session arms do not consult the network address at all.
`authLimiter` is keyed per IP so login cannot be brute-forced from one host regardless of session.
Every per-IP key is the client address the validated `trust proxy` predicate resolves, not the raw TCP peer: keying on the peer put the whole user base in one bucket behind a load balancer (#2318), and a forwarded address is accepted only when the connecting peer is inside `TRUSTED_PROXY_CIDRS`, so an ordinary client still cannot shift buckets by spoofing the header.
All limiters are skipped in CI, development, and test.
Responses with a `5x` status do not count against a caller's budget (`skipFailedRequests` with `requestWasSuccessful` = status under 500), so a transient backend outage (e.g. a MongoDB reconnect returning 503) cannot lock a user out for the rest of the window; `4xx` still counts.

### What the request-scoped limiters do and do not control

Read the key order above for its consequence, not just its shape (#2420).

The IP fallback is not a live control for `/api` traffic.
`cookie-session` always populates `req.session` and `ensureAnonymousRateLimitId` runs ahead of both request-scoped limiters, so the anonymous arm always matches first.

The anonymous identifier lives in the caller's own cookie, so a client that discards cookies is issued a fresh identifier, and therefore a fresh budget, on every request.
Measured on a limiter built from `globalLimiter`'s key function, window, and budget rather than on `globalLimiter` itself, because its own `skip` bypasses it under test: `ratelimit-remaining` decrements monotonically for a client holding a cookie jar and stays pinned at its first value for a client that discards cookies.

So for anonymous callers the request-scoped limiters are a politeness and accident guard - they stop a runaway client or a buggy loop - and not an abuse control.
They are a real abuse control only for `user:<netid>` traffic, where the caller cannot choose a different bucket.

This keying is deliberate and should not be "fixed" by moving anonymous traffic to IP keying.
Yale NATs a large student body behind few egress addresses, so an IP-keyed general limiter would put much of campus in one bucket, where a few active users could 429 everyone else.
That is a self-inflicted availability failure dressed as a security control.

The genuine abuse controls are the two `getPeerIpKey` limiters, `firstContactLimiter` and `authLimiter`, which cannot be reset by dropping cookies.
They carry the opposite exposure by construction: because they are IP-keyed, callers behind one Yale egress address do share a bucket.
`firstContactLimiter` is the one that answers the cookie-discarding caller, by metering the scarce thing (a new session) rather than the abundant one (a request); see the design note in `rateLimiters.ts`.

Write limiting is opt-in per route, not inferred from the HTTP method.
A route is billed as a write only if it lists the `writeLimit` middleware in its definition, so reads and telemetry (search, exports, `addView`, the `/analytics/research/batch` beacon) can never exhaust the mutation budget, and a new route defaults to read-safe.

| Limiter | Scope | Limit |
|---------|-------|-------|
| `globalLimiter` | All `/api` except `/api/cas`. Safety net across reads, telemetry, and writes. | 1000 per 15 minutes. |
| `writeLimit` | Opt-in per route on genuine mutations (favorites/saves, profile edits, claims, research outreach, admin writes). | 50 per 15 minutes. |
| `authLimiter` | `/api/cas` login callback, keyed per IP. | 20 per 15 minutes. |
| `firstContactLimiter` | Cookie-less `/api` requests only, keyed per IP. The abuse control for callers who discard cookies. | `FIRST_CONTACT_RATE_LIMIT_MAX` per 15 minutes, default 300, floored at 50. |

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
- `server/src/passport.ts` controls CAS auth and `Account` login (via `accountService`).
- `server/src/db/connections.ts` controls database connections and migration mode.
- `server/src/app.ts` controls CORS, rate limits, session settings, route mounting, and security middleware.
- Production scraper writes require explicit guardrails with `SCRAPER_ENV=production` and `CONFIRM_PROD_SCRAPE=true`.

## Environment variables

### Server

| Variable | Required | Purpose |
|----------|----------|---------|
| `MONGODBURL` | Yes | MongoDB connection string. |
| `SESSION_SECRET` | Yes | Cookie session signing key. |
| `AUTH_DEBUG` | No | Enables verbose auth tracing when `true`. |
| `SSOBASEURL` | Yes | Yale CAS URL. |
| `SERVER_BASE_URL` | Yes | Public server URL for CAS callbacks. |
| `TRUSTED_PROXY_CIDRS` | Deployed | Non-empty comma-separated proxy CIDRs trusted for forwarded visitor IP resolution; empty is allowed only in local development and tests. |
| `FIRST_CONTACT_RATE_LIMIT_MAX` | No | Per-IP cookie-less request ceiling per 15 minutes for `firstContactLimiter`; defaults to 300 and is floored at 50, so a too-small value cannot lock out a NATed cohort. |
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
