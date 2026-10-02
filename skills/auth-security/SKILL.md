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
     -> Yalies lookup (lookupYalieByNetid): student, employee, not_found, or unavailable
        student  -> undergraduate (school_code YC) or graduate
        employee -> professor when isFacultyTitle(title), otherwise staff
        unavailable -> the userType a previous login stored on Account.profile, else "unknown"
        not_found -> "unknown"
     -> accountService.recordAccountLogin: resolve-or-create Account (netid/email), stamp lastLoginAt
     -> cookie-session for 30 days, httpOnly, secure in prod, sameSite lax
```

Authentication runs on the canonical `Account` (the private login principal); the legacy `User` model has been retired (#2014).
Classification (undergraduate, graduate, professor, staff) is derived at login and carried in the signed session for authorization decisions; a descriptive copy of the Yalies profile (name and `userType`, plus title/department for faculty and staff) is persisted onto `Account.profile` at login via `recordAccountLogin`, refreshed on each sign-in that resolves a record.
A student's residential college, class year and major were persisted here until #4162 and are not any more: nothing read them, so every signed-in student carried three extra personal attributes against their netid for no product purpose.
A login that resolves a record replaces `profile` wholesale and so sheds them; a login whose Yalies lookup was unavailable writes no profile and unsets those three paths instead, so an account stops carrying them either way.
Accounts stored before the fix that never sign in again keep the values until a one-off cleanup runs, which is an operator decision rather than something a login may do for them.
`yarn --cwd server accounts:purge-retired-login-profile-fields --environment=<env>` is that cleanup: it is dry-run by default, and a dry run is read-only, so it is also how the population is counted before anyone decides to clear it.
Count it in Production rather than Development, because a Development login does not go through CAS and so never wrote these values: on 2026-10-01, 0 of 4,179 Development accounts held any of the three.
Accounts are created only at login (never by the scraper); the scraper's identity materialization enriches researchers that already exist but mints no Account or Researcher on its own.
`userType` is a classification/analytics dimension only; it does not authorize anything, whether read from the session or the persisted profile.
Admin authority is a separate signal: `buildAuthenticatedSessionUser` sets `isAdmin` from `hasActiveAdminGrant`, and that boolean is what guards and the client key off.
The classification cascade runs only at login time.
`unknown` means Yalies has no record of the person, or could not answer and no earlier login stored a type; a request failure is never read as "not in Yalies", because that typed returning students `unknown` (#4234).
Yalies lists faculty and staff with a `title` and an organization or unit (`unit_name`, `organization_name`) but no `year` or `school_code`, so the lookup reads such a record as an employee rather than discarding it.
There is no Yale Directory fallback: `directory.yale.edu` is behind a per-person CAS sign-in with no server-callable API, so the old `directory.yale.edu/api/people` call resolved nobody and was removed (#4287); Yalies employee records type faculty and staff instead.
Per-request session restore in `deserializeUser` re-validates that the backing `Account` exists and is not archived, then recomputes `isAdmin` from the admin-grant check.
The admin-grant check is cached in memory for 60 seconds in `adminGrantService` and invalidated on grant or revoke.
A session whose `Account` no longer exists or is archived deserializes to unauthenticated.

### The two legs of `GET /api/cas`

A login callback completes a login only for the browser that started it, so the route is two distinct legs rather than one handler.
Reached without a `ticket`, it is the start leg: it mints a single-use random value, appends it to `casLoginStates` in the signed cookie session, and carries it in the `service` URL it hands CAS, which is what makes CAS echo it back.
The session keeps only the five most recent pending values, so a login started in one tab still completes after a later start in another tab, and the oldest pending login is dropped once a sixth is started.
Reached with a `ticket`, it is the callback leg: the returned value must equal one of the pending values, which is then removed, so the same callback cannot be completed twice.
A missing or mismatched value is refused with `401` before the ticket is ever presented to CAS, and nothing about the caller's session is written, so an existing sign-in survives the refusal untouched.
The value has to ride inside the request URL rather than beside it, because `passport-cas` derives the CAS `service` parameter from `req.originalUrl` and recomputes it when it validates the ticket, and CAS refuses a ticket whose two service URLs differ.
That byte-level equality is the fragile part of the arrangement, so `server/src/__tests__/casLoginCallbackSessionState.test.ts` asserts it directly against a loopback CAS stand-in that, like CAS, issues a ticket for one service URL and validates it against no other.
The return path is unchanged: `safeRedirectTarget` still decides where a completed login lands.

The callback leg separates a CAS rejection from our own failure, because a student whose login broke on our side must not be told they are unauthorized (#3672).
`classifyCasCallbackError` in `server/src/utils/casCallbackFailure.ts` walks the error's cause chain, since `passport-cas` wraps every failure, ours included, in a `VError`.
Only CAS answering `no` to the ticket, or a CAS identity that is not a usable netid (`UnusableCasIdentityError`), is a rejection: it answers `401`, or the caller's `error` page when one is named.
A CAS that cannot be reached, answers with something malformed, or does not answer within `CAS_VALIDATION_TIMEOUT_MS` (ten seconds), and a database that cannot be reached, answer `503`; any other exception answers `500`.
Both carry the same student-facing message asking them to try again, never redirect to the `error` page, and are reported through `captureServerError`.
Unlike the error handler's database `503`, neither sets `Retry-After`, because the callback is a top-level browser navigation that ignores it.
The report is a fresh `CasLoginServerError` naming the failure and the error names and codes along the cause chain, never the original error, because a duplicate-key message quotes the netid and an axios error carries the validation URL with the ticket in it.
A verdict that arrives after the timeout has answered is dropped, so a slow CAS can never complete a login the student has already been told failed.
`server/src/__tests__/casLoginCallbackFailures.test.ts` drives all four outcomes through the mounted app against a stub CAS.

Dev login bypass:

`GET http://localhost:4000/api/dev-login`

This creates a test session as `test123` with user type `undergraduate`.
Pass `?userType=admin|professor|faculty|graduate|unknown` for a different local account.
`?userType=admin` mints an idempotent local bootstrap `AdminGrant` (via `ensureBootstrapAdminGrant`), so dev admin authority comes from a real grant, not a `userType` shortcut.

### Development affordances are scoped to the developer's own machine

The runtime label alone never licenses a development affordance, because "this process is a local development process" and "this request came from the developer" are different facts.
`isLoopbackRequest` in `server/src/utils/loopbackAccess.ts` answers the second one, and it requires both a loopback socket peer and a `Host` header in a localhost form.
It reads the socket peer rather than `req.ip`, because `req.ip` can be resolved from a forwarded header.

- `/api/dev-login` is registered only in a local development runtime (`isDevLoginAllowed`) and additionally answers `404 {"error":"Not found"}` to any caller that is not loopback (`isDevLoginRequestAllowed`).
The refusal reuses the ordinary not-found shape rather than announcing a disabled route.
- The `LOCAL_AUTH_BYPASS` user and its `x-dev-netid` / `x-dev-user-type` selection apply only to a loopback caller (`isLocalAuthBypassRequestAllowed`), so a request from elsewhere is simply unauthenticated.
- `serverListenHost` in `server/src/utils/environment.ts` binds a local run to `127.0.0.1` and a deployed run to `0.0.0.0`, keyed off `requiresDeployedRuntimeSecurity`, because the hosting platform reaches the process from outside its network namespace and a local run needs no interface beyond loopback.

## Auth middleware

Defined in `server/src/middleware/auth.ts`.

| Middleware | Check |
|------------|-------|
| `isAuthenticated` | `req.user` has a valid bounded NetID. |
| `isAdmin` | active `AdminGrant` for the NetID (`hasActiveAdminGrant`). |

There are no `userType`-based authorization guards.
Correction-report submission and the reporter's own report history use `isAuthenticated`.

### Responses to a non-admin caller are allowlists

A route that returns a stored document to a non-admin caller serializes it through an explicit allowlist of the fields that caller's UI reads, never the raw document and never a denylist.
A denylist leaks every field added to the model later, and a raw document leaks whatever the admin shape carries.
The correction-report routes are the worked example (#4011): `POST /api/research/:slug/report` and `GET /api/research/:slug/reports/mine` return `toReporterCorrectionReport` from `entityCorrectionReportService.ts`, which keeps only `_id`, `category`, `status`, `note`, `reviewerNote`, and `createdAt`.
The reviewer's netid (`reviewedBy`, `reviewHistory`), the reporter snapshot, and entity bookkeeping stay on the admin queue alone.
Adding a field to the reporter panel means adding it to that allowlist, and `server/src/__tests__/correctionReportReporterProjection.integration.test.ts` pins the exact key set through the mounted routes.

## Admin audit log

Every admin mutation lives on the admin router (`server/src/routes/admin.ts`, mounted at `/api/admin`), which runs `isAuthenticated`, `isAdmin`, and `adminAuditMutationLogger` ahead of every route.
Research-area creation moved there as `POST /api/admin/research-areas` so it is audited like the rest of topic management (#3648).
Do not guard a mutation with `isAdmin` on another router: it would bypass the logger.

`adminAuditMutationLogger` (`server/src/middleware/adminAuditLogger.ts`) records one `AdminAuditEvent` per successful (2xx) `POST`/`PUT`/`PATCH`/`DELETE`, using the action vocabulary in `ADMIN_AUDIT_ROUTES`, keyed by method and the path relative to the admin router.
A new admin mutation therefore needs an `ADMIN_AUDIT_ROUTES` entry, and a matching label in `client/src/components/analytics/analyticsPresentation.tsx` for the audit-log filter.
`server/src/middleware/__tests__/adminAuditCoverage.test.ts` walks the mounted Express app and fails when an `isAdmin` mutation is outside the admin router, runs without the logger, has no entry, or when an entry names a route that no longer exists.
At runtime a successful admin mutation with no entry logs a `console.warn` naming the method and route instead of passing silently.

Audit writes are fail-soft by design.
The event is written on `finish`, after the mutation has committed and the response has gone, so failing the request would report failure for a change that happened and invite a retry.
Failing closed would need the event written before the mutation, in the same transaction, which would also turn an audit-collection outage into an outage of every admin surface.
The most sensitive mutation, an admin grant or revoke, also keeps its own actor history on the `AdminGrant` document.
A failed insert logs `console.error` naming the action and target type, and an event refused for an invalid actor or action logs `console.warn`; neither log carries the actor netid or target id.

Client route guards:

| Guard | Purpose |
|-------|---------|
| `PrivateRoute` | Auth required. |
| `AdminRoute` | Admin only, keyed off the server-provided `user.isAdmin`. |
| `PublicRoute` | Renders for logged-out and authenticated users alike, without waiting for the `/api/check` session check, so a public page's first request starts at once. Auth-dependent UI on these pages reads `isLoading` itself and holds its slot invisible until the check resolves. |
| `UnprivateRoute` | No auth required. |

Because a public page now runs before the check answers, client research analytics has three states rather than two.
`setResearchAnalyticsEnabled` in `client/src/utils/researchAnalytics.ts` starts unknown: an event raised in that window buffers but is never flushed or beaconed, a logged-out answer discards the buffer, and a signed-in answer schedules its delivery.
Treating unknown as enabled would post a guest's first browse impression to `/analytics/research/batch`, which is behind `isAuthenticated`, and spend a first-contact unit on the 401.

`PrivateRoute` and `AdminRoute` share one signed-out contract: they redirect to `/login` with `state.from` set to the requested path, query, and hash, and they `replace` the guarded entry so Back does not loop through `/login`.
`AdminRoute` also replaces the entry when it sends a signed-in non-admin home.
`normalizeReturnPath` in `client/src/utils/returnPath.ts` reduces `state.from` to a same-origin path or an empty string.
`SignInButton` applies it before building the CAS `redirect` parameter, and the server's `safeRedirectTarget` in `passport.ts` validates it again, so the return path can never become an open redirect.
`/login` applies it too, and once a session check succeeds (for example after Retry connection) it sends the user to that path, falling back to the role default only when the path is empty.

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

The CORS policy is an allowlist in every runtime.
`allowList` in `app.ts` holds the deployed browser origins, and outside a deployed runtime `createCorsOriginHandler` additionally accepts an `http` origin whose hostname is a loopback form, which is what lets a client dev server on any port (`scripts/new-agent-worktree.sh` hands out `3000` upward) talk to the API with credentials.
Nothing reflects an arbitrary `Origin`, so an allowlist entry is the only way in from a browser.

### Static client files

`createClientStaticAssets` in `server/src/middleware/clientStaticAssets.ts` serves the client build, and `app.ts` mounts it after `securityHeaders` and CORS but ahead of `cookie-session` and Passport (#3950).
A static file therefore never reads or writes a session cookie and never runs `deserializeUser`, which is what lets the CDN cache it.
The router skips every `/api` path, so a file in the build can never shadow an API route, and it keeps the source-map block ahead of `express.static`.
Only content-hashed files directly under `/assets/` are served `public, max-age=31536000, immutable`; `index.html`, the SPA fallback, and unhashed files such as `/assets/developers/*` and `/brand/*` keep `max-age=0` so a deploy is seen on the next load.
The Passport `regenerate`/`save` shim defines its methods as non-enumerable, because cookie-session writes a new session that has any own enumerable key, and an enumerable shim issued an empty session cookie to every anonymous response.
`server/src/__tests__/appStaticAssetCaching.test.ts` pins all of this through the mounted app.

SSRF protection lives in `server/src/utils/ssrfGuard.ts`.
Any outbound fetch to a host derived from user input or stored data must go through it.
Use `assertPublicHttpUrl`, `ssrfSafeLookup`, and `ssrfSafeAgents` as appropriate.
Operator scripts and scrapers that need a status, a body, or a redirect location use `fetchPublicHttpUrl` in `server/src/scrapers/utils/httpFetch.ts`: it follows redirects by hand, asserts every hop with `assertPublicHttpUrl`, and connects through `ssrfSafeAgents`, so neither the first host nor any redirect target can be private (#4013).
`ssrfSafeAgents` also refuses a private IP-literal host before opening a socket, because Node connects to an IP literal without calling the agent's `lookup`, so a redirect to `http://127.0.0.1/` used to pass the connect-time check.
A headless render cannot use Node's agents, so every request the browser makes goes through a per-render forward proxy, `startSsrfGuardedForwardProxy` in `server/src/scrapers/utils/ssrfGuardedForwardProxy.ts`, which runs `ssrfSafeLookup` on each request, tunnel, and redirect hop and connects to the address it vetted.
Playwright forces loopback through a configured proxy unless `PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK` is set, so `scraplingBridge.py` removes that variable, and the renderer discards a page whose seed request never passed through the proxy.
`scripts/security-preflight.test.mjs` scans all of `server/src` with `scripts/unguardedOutboundFetchScan.mjs` and fails on a global `fetch`, an `axios` call without both agents, or a Node `http.get`/`request` without an `agent`, whenever the URL is not a constant; agents count only in a file that calls `ssrfSafeAgents()`.
A reviewed exemption, such as a constant host or the forward proxy's connection to the address it vetted, lists its file, its reason, and the exact number of calls it covers, so a further call in that file fails the scan, and the exemption is removed once it stops matching.
A guard refusal is inconclusive rather than evidence that a page is gone: on a machine inside Yale's split-horizon DNS a Yale host can resolve to `10.x` and be refused, so a script that clears data on a failed probe must treat a guard refusal, `isSsrfGuardRefusal` in `server/src/utils/ssrfGuard.ts`, as its own outcome, as `clearDeadLabResearchHomes` does with `address-refused`.

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
The resolved IP is equally a fact about the machine: Yale serves split-horizon DNS, so `probeSourceLink` records `privateAddressHost` only after public DNS over HTTPS confirms it (`server/src/utils/publicDnsResolution.ts`, #3903), and never widens what the guard will connect to.
`docs/research-data-pipeline.md` owns what each axis licenses.

## Rate limits

The limiters live in `server/src/middleware/rateLimiters.ts`.
Request-scoped limiters (`globalLimiter`, `writeLimit`) are keyed by authenticated user's normalized `netId`, then by a server-generated high-entropy identifier in the signed cookie session, with IP fallback when no valid signed session is available.
The anonymous identifier is initialized only for `/api` requests.
This prevents shared proxy buckets, because the netid and session arms do not consult the network address at all.
`authLimiter` is keyed per IP and meters rejected CAS ticket validation only, so repeated failures from one address stay bounded regardless of session.
The ticketless first leg of login is skipped, because it only redirects the caller to CAS, and a validation that succeeds is refunded, so a completed login spends nothing from a bucket that a whole NATed cohort shares.
A CAS ticket is minted and validated by CAS rather than supplied by the caller, so repeated failure is the only thing on this path the budget can usefully bound.
A caller that keeps its session cookie therefore reaches that ticketless start under no limiter at all, because `globalLimiter` skips `/api/cas` and `firstContactLimiter` meters cookie-less requests only.
That is accepted rather than overlooked: the start is a bare redirect to CAS with no outbound call and no database write, so there is no scarce resource on it to meter.
Every per-IP key is the client address the validated `trust proxy` predicate resolves, not the raw TCP peer: keying on the peer put the whole user base in one bucket behind a load balancer (#2318), and a forwarded address is accepted only when the connecting peer is inside `TRUSTED_PROXY_CIDRS`, so an ordinary client still cannot shift buckets by spoofing the header.
That only holds while the list is narrow, so `parseTrustedProxyCidrs` (`server/src/utils/trustedProxyCidrs.ts`) refuses at startup, in every runtime, any IPv4 range wider than `/8`, any IPv6 range wider than `/29`, and any IPv6 range that reaches into IPv4-mapped space (`::ffff:0:0/96`) wider than `/104`, naming the offending entry (#4015).
`0.0.0.0/0` and `::/0` fall under those floors, and the mapped arm matters because Node's `BlockList` matches an IPv4 peer against an IPv6 mapped rule, so `::ffff:0:0/96` or `::/80` trusts every IPv4 client.
The IPv4 floor is the widest private block a proxy fleet sits in (`10.0.0.0/8`), and the IPv6 floor is `/29` rather than `/32` because a major CDN publishes a `/29` proxy range.
All limiters are skipped in CI, development, and test.
Responses with a `5x` status do not count against a caller's budget (`skipFailedRequests` with `requestWasSuccessful` = status under 500), so a transient backend outage (e.g. a MongoDB reconnect returning 503) cannot lock a user out for the rest of the window; `4xx` still counts.
`globalLimiter` and `writeLimit` reach that exemption with `skipFailedRequests: true` and the shared predicate.
`authLimiter` reaches the same place from the other side: it sets `skipSuccessfulRequests: true` with its own predicate, which refunds a `5x` exactly as before and otherwise refunds only a request that `casLogin` recorded as accepted with `markCasValidationAccepted`, so a rejected validation is the only response it charges.
Acceptance is recorded rather than read from the status because `casLogin` answers a rejected validation with a redirect when the caller names an `error` target, and a redirect is also what an accepted one returns; an unrecorded outcome is charged, so a new response path fails closed.
Both flags together would refund every finished response and count nothing, so the two are alternatives rather than a pair.
`firstContactLimiter` is deliberately excluded and counts every response, a `5x` included (#2990).
It meters the session mint, and `ensureAnonymousRateLimitId` performs that mint before the limiter runs, so a request that ends `500` has already spent the resource; refunding it would turn an outage into a window for minting unlimited sessions, which is the bypass the limiter exists to close.
The cost is accepted rather than unnoticed: a `5x` storm spends a NATed cohort's first-contact budget, and their recovery is the one the exhaustion message already names, retrying with the cookie issued regardless of the failure.
Because express-rate-limit consults `requestWasSuccessful` only when a skip flag is set, declaring the predicate without the flag advertises an exemption that does not exist, so `scripts/security-preflight.test.mjs` pins that no limiter does.
`server/src/middleware/__tests__/firstContactMetering.test.ts` drives the exported limiter over a `500` and a `404` and asserts the counter keeps climbing, so the guarantee rests on measured counting rather than on how the options block is written.
`server/src/middleware/__tests__/authLimiterScope.test.ts` does the same for `authLimiter`, driving the exported limiter over a ticketless start, an accepted validation, a rejected one answering `401` or an error-page redirect, a `503`, and a server-side failure answering `500` even when the caller named an error page, and pinning that the two request-scoped limiters still charge a successful response.
It needs no CAS: one block uses a stand-in route, and another drives the real `/cas` route with the strategy's verdict stubbed, so the acceptance record is measured where `casLogin` writes it; `server/src/__tests__/appSecurityRuntime.test.ts` covers the route wiring by driving the mounted app's login start.
That second block drives both legs with one cookie jar, because a callback that does not return the single-use state its session minted is refused before validation (#4081), and it pins that such a callback is charged.

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
A new visitor's cost is the number of `/api` requests the client sends before the first response sets the cookie, so the cold-visit request order is part of this budget.
A cold visit to a public page sends `/api/check` and the first `/api/research/search` in parallel (#3952), and `ConfigContextProvider` requests `/api/config` only once the session check has answered, so it carries the cookie that answer issued (#4118).
Each new visitor therefore spends two first-contact units, and the default 300 admits about 150 cold visits per egress address per window.
Do not add another request that fires before the session check answers without counting it here: #4083 briefly made the cost three, about 100 cold visits, by sending `/api/config` alongside the other two.
Do not recover the unit on the server by exempting a route from the limiter instead, because a cookie-discarding caller would then reach that route unmetered.
`client/src/__tests__/coldVisitFirstContactCost.test.tsx` mounts the real session and config providers with the browse page and pins the requests sent before the check answers.
`authLimiter` narrows the same exposure by metering only what is worth metering, a rejected ticket validation, so the shared bucket is no longer spent by ordinary logging in.

Write limiting is opt-in per route, not inferred from the HTTP method.
A route is billed as a write only if it lists the `writeLimit` middleware in its definition, so reads and telemetry (search, exports, `addView`, the `/analytics/research/batch` beacon) can never exhaust the mutation budget, and a new route defaults to read-safe.

| Limiter | Scope | Limit |
|---------|-------|-------|
| `globalLimiter` | All `/api` except `/api/cas`. Safety net across reads, telemetry, and writes. | 1000 per 15 minutes. |
| `writeLimit` | Opt-in per route on genuine mutations (favorites/saves, profile edits, claims, research outreach, admin writes). | 50 per 15 minutes. |
| `authLimiter` | Rejected CAS ticket validation on `/api/cas`, keyed per IP. A ticketless login start is skipped and a successful validation is refunded. | 60 rejected validations per 15 minutes. |
| `firstContactLimiter` | Cookie-less `/api` requests only, keyed per IP. The abuse control for callers who discard cookies. | `FIRST_CONTACT_RATE_LIMIT_MAX` per 15 minutes, default 300, floored at 50. |

One paid dependency is metered separately, because a request budget does not bound it.
Each distinct search query text is one paid embedding call, and `server/src/services/researchSearchQueryEmbeddingBudget.ts` bounds those calls per one-minute window, globally and per client address, with a breaker for an upstream rejection.
It is not a rate limiter and never answers `429`: over budget the search drops its semantic leg, the keyword leg answers, and the response is marked `degraded`.
The client key is `getPeerIpKey(req)`, so it is the same bucket the limiters above meter, IPv6 masked to its subnet, and a new derivation must not be written for it.
The route supplies it unconditionally, so a request whose address does not resolve shares one bucket rather than reading as an in-process caller, which is the only case the ceilings exempt.
`skills/search-data/SKILL.md` owns the ceilings, the defaults, and why the window ceiling rather than the per-address one is the real bound.

`globalLimiter` is sized high because un-batched view and impression telemetry rides this budget; lower it once analytics beacons are batched client-side.
The limiters use express-rate-limit's in-process MemoryStore, which is correct only because the Render web service runs a single instance; if it is ever scaled beyond one instance, move to a shared store (e.g. Redis) first.

y/labs has no faculty lab or opportunity authoring routes.
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
The server test suite must never read them either, and `server/src/test/hermeticEnvironment.ts` is the fence that makes sure of it (#2966).
- Request-path logs name the action and the object, never the person (#4012).
A log line must not interpolate a netid, email, or name, because hosted logs sit outside the database and its access controls; log the document id and let an operator join to it.
Route any value that is not a literal through `sanitizeLogValue` in `server/src/utils/logSanitizer.ts`, which redacts credentials, emails, phone-shaped digits, and the values a MongoDB duplicate-key error quotes after `dup key:`, since a unique index keyed on `netid` or `reporter.netId` puts the identifier into the error message.
`server/src/__tests__/correctionReportSubmissionLogs.integration.test.ts` captures every console call while a report is filed, including one that loses the duplicate race, and asserts the reporter's netid appears in none of them.
- Error reports to Sentry carry no user identity, cookie, header beyond the client `User-Agent`, body, query value, or local variable.
`server/src/utils/errorTracking.ts` and `client/src/utils/errorTracking.ts` set every `dataCollection` category to off explicitly, because since Sentry 11 an unset category collects by default, and a category an upgrade adds or renames silently falls back to on.
Each side's `errorTrackingPayload.test.ts` asserts the SDK's resolved collection options against the full list, so a new or renamed category fails the suite rather than shipping.
The server's global error handler is the only capture path: `expressIntegration({ shouldHandleError: false })` turns off Express's automatic capture, which would otherwise fire first and win the dedupe over the route-template report (`server/src/utils/__tests__/errorTrackingExpressCapture.test.ts`).
- `server/src/passport.ts` controls CAS auth and `Account` login (via `accountService`).
- `server/src/db/connections.ts` controls database connections and migration mode.
- `server/src/app.ts` controls CORS, rate limits, session settings, route mounting, and security middleware.
- Scraper writes against Beta or Production are refused outright by `applyScraperEnvironmentGuards`; both environments receive data only through promotion. Promotion and other guarded Production scripts still require `SCRAPER_ENV=production` and `CONFIRM_PROD_SCRAPE=true`.

## Environment variables

### Server

| Variable | Required | Purpose |
|----------|----------|---------|
| `MONGODBURL` | Yes | MongoDB connection string. |
| `SESSION_SECRET` | Yes | Cookie session signing key. |
| `AUTH_DEBUG` | No | Enables verbose auth tracing when `true`. |
| `SSOBASEURL` | Yes | Yale CAS URL. |
| `SERVER_BASE_URL` | Yes | Public server URL for CAS callbacks. |
| `TRUSTED_PROXY_CIDRS` | Deployed | Non-empty comma-separated proxy CIDRs trusted for forwarded visitor IP resolution; empty is allowed only in local development and tests, and a range wider than IPv4 `/8`, IPv6 `/29`, or IPv4-mapped `/104` refuses startup. |
| `FIRST_CONTACT_RATE_LIMIT_MAX` | No | Per-IP cookie-less request ceiling per 15 minutes for `firstContactLimiter`; defaults to 300 and is floored at 50, so a too-small value cannot lock out a NATed cohort. |
| `YALIES_API_KEY` | No | API key for yalies.io. |
| `OPENAI_API_KEY` | No | OpenAI key for Meilisearch embedder config and LLM extractors. |
| `RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE` | No | Search query-embedding calls a one-minute window may hold across all callers; defaults to 600 and is floored at 60. |
| `RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE` | No | Same window, per client address; defaults to 120 and is floored at 10. |
| `RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS` | No | How long the query-embedding breaker stays open after an upstream rejection or repeated failures; defaults to 60000 and is floored at 1000. |
| `MEILISEARCH_HOST` | Deployed | Meilisearch host; defaults to `http://localhost:7700` only outside deployed runtimes, and the server refuses to start without it when deployed. |
| `MEILISEARCH_API_KEY` | No | Meilisearch API key. |
| `MEILISEARCH_INDEX_PREFIX` | Deployed | Environment index prefix (`beta`, `prod`); unset locally, and the server refuses to start without it when deployed. |
| `PORT` | No | Server port, default 4000. |
| `SCRAPER_ENV` | No | Scraper write guards. |
| `ALLOW_NON_PROD_SCRAPER_WRITES` | No | Enables scraper writes to non-prod DBs. |
| `CONFIRM_PROD_SCRAPE` | No | Confirms guarded Production writes such as the promotion and reindex; scraper writes against Production are refused regardless. |
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
