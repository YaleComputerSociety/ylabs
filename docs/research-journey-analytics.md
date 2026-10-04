# Research Journey Analytics Contract

Status: canonical contract for IM-01

The research journey taxonomy is claim-specific and invisible to students.
The canonical server enum is `AnalyticsEventType` in `server/src/models/analytics.ts`.
The client mirrors the journey subset in `client/src/utils/researchAnalytics.ts`.
Any enum or payload change must update both files and their focused contract tests in the same pull request.

## Events

| Event                        | Required entity   | Allowlisted payload                                               | Meaning                                                                                         |
| ---------------------------- | ----------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `research_search`            | none              | `outcome`, `resultCountBucket`, `searchKind`, `filterCountBucket` | One terminal result, zero-result, or error outcome for one submitted canonical research search. |
| `research_results_view`      | `research_entity` | `surface`, `pageBucket`, plus `entityIds`                         | One visible result page, carrying the canonical entities it showed in display order.            |
| `research_profile_open`      | `research_entity` | `source`                                                          | A canonical research profile loaded successfully.                                               |
| `research_source_review`     | `research_entity` | `sourceCategory`                                                  | A student opened a profile, website, ORCID, publication, or evidence source.                    |
| `research_filter_change`     | none              | `operation`, `filter`                                             | A bounded research filter was applied, removed, cleared, opened, or closed.                     |
| `research_save`              | `research_entity` or `fellowship` | `operation`, `surface`                                            | A saved research-entity home, or a watched program on `/programs` (surface `search`) or the Dashboard Program Watch (surface `saved_plans`), was saved or removed successfully. |
| `research_compare`           | `research_entity` | `entityCountBucket`                                               | One entity participated in an explicit saved-home comparison or advising preview.               |
| `research_plan_update`       | `research_entity` | `field`                                                           | A saved plan field group persisted a changed value successfully.                                |
| `research_qualified_action`  | `research_entity` | `actionCategory`                                                  | Retired (#4581): the batch route refuses it and no client emits it; stored rows still count.    |

A result page is one row, never one row per entity.
`entityIds` holds the page's canonical entity identifiers in display order, so a position is the array index, and the server keeps only the identifiers that name a current `ResearchEntity`, validated in one query for the whole page.
A grid restored from the tab's snapshot on a return visit is a page already recorded, so it records nothing.
The retired `research_entity_impression` wrote one row per card, which put 56% of Production's rows into impressions, and a single query with one result could sit beside hundreds of rows from browse scrolling (#3628).
The enum value stays so stored rows remain valid until the TTL expires them, but the batch route no longer accepts it.

The only access-conversion event was `research_qualified_action`, and it is retired.
It was qualified against a planning context that no source ever produced (#377), so none could be recorded, and the 2026-08-25 "Simple Directory First" decision retired the planning-context framing; #4581 removed the producer, the planning-context service and the qualification check.
The enum value and the funnel's read of it stay, so a stored row keeps counting until the TTL expires it, but the batch route no longer accepts the event.

Source review, profile open, results view, filter, save, compare, and plan events never count as access conversion.
`outreach_outcome` remains a separate self-reported outcome and is not inferred from any click.

## Privacy And Reliability

Everything in this section describes `analytics_events`, the first-party instrument.
No third-party analytics tag runs on any page; see Third-Party Measurement below for the GA4 tag that did until #4754.

Payloads are deny-by-default allowlists of short enums and count buckets.
They do not retain raw query text, URLs, hostnames, contact destinations, notes, plan contents, filter values, or cross-event search identifiers.
The separate `search` event does retain the query text, but only as the server observed it on the request, never as a client-supplied payload, and only for a signed-in student.
See `docs/topic-matching-and-search-engagement.md` for what counts as a recorded search.
Entity identifiers are bounded canonical `ResearchEntity` identifiers and are validated before persistence.
Action events never carry a query or search identifier, so raw-query and action records cannot be joined through a client-supplied key.

Every client interaction carries a bounded idempotency key.
The server enforces uniqueness per authenticated analytics actor, so Strict Mode replay and transport retries do not create duplicate events.
Analytics requests are fire-and-forget and swallow tracker, offline, navigation, and server failures.
They do not alter focus, copy, navigation, optimistic state, or completion feedback.
A public page renders before the session check answers, so the client tracker has a third state, unknown, in which an event buffers and is never delivered; `skills/auth-security/SKILL.md` owns that contract.
On the server, `logEvent` never throws either, so an analytics outage cannot block a login, logout, or search, but it reports what happened: `recorded`, `suppressed` (Beta), `invalid`, or `failed`.
`POST /analytics/research/batch` counts only `recorded` events in its `accepted` total, and logs event types and counts for rejected and `unstored` events, so a storage failure reads as a gap rather than as a delivered batch (#3638).

The analytics collection uses the existing 1,095-day TTL index in `server/src/models/analytics.ts`.
Beta continues to suppress real student analytics through `shouldSuppressBetaAnalyticsEvent`, while allowing fixture and admin validation.
The endpoint remains first-party, authenticated, private, and covered by the existing analytics access controls.

## Dashboard Semantics

Every usage aggregate leaves out maintainer traffic: rows from any netid that holds an `admin_grants` row, in any status, and legacy rows typed `admin`.
Admin authority is a grant rather than a user type, and an admin session records the persisted user type (usually `undergraduate`), so filtering on `userType` alone misses current maintainers.
Before #3673 nothing was excluded, and the 4 Production grant holders had written 48% of all Production rows.
The per-user table still lists every actor, maintainers included, though it is built over non-search events only (see `skills/auth-security/SKILL.md`, #4159).

A signed-in visitor is a distinct netid with any recorded event in the window, typed by that netid's most recent row.
The dashboard's `today` and `semester` ranges, and the "today" breakdown on every usage card, start at midnight `America/New_York`, the zone Yale's students and operators live in (#4008).
`ANALYTICS_TIME_ZONE` in `server/src/utils/analyticsRange.ts` declares it once and `parseAnalyticsRange` and `computeAnalytics` both read it, so the boundary no longer follows the host: before #4008 both used server-local midnight, which is UTC on Render and the laptop's zone in local development, so "Today" on a UTC host started at 20:00 or 19:00 New Haven time the previous evening.
The semester starts at New Haven midnight on 1 July or 1 January, the overview response carries the zone as `timeZone`, and the range picker names it.
The rolling `7d` and `30d` ranges are relative to the request time and need no zone.
A `visitor` row carries a `visitor:<UTC date>` dedupe key, so it is written at most once per student per UTC day, and counting only `login` and `visitor` rows missed a returning student whose first visit that day fell before the window.
Before #3692 the first burst of parallel requests in a session each wrote one, and a local auth-bypass session wrote one per request: 31 of 475 Production and 27,085 of 30,416 Development visitor rows followed the same student's previous row within 10 seconds.
Logins count `login` rows only.
Opening a program records one `fellowship_view`, whether from a card or a direct `?program=` link, and a click on its application link records one `ways_in_click` with kind `apply`; before #3766 each wrote a second row (`research_view` and `source_link_click`).
A research save or removal records the surface it came from, so a removal on the Dashboard reads `saved_plans`.
Before #3716 a watch made on `/programs` recorded no `research_save`, and the only `fellowship` rows came from the Dashboard toggle, which is almost always a removal, so stored `fellowship` saves before that change undercount watches.
A note field that is focused and left without a change sends no write and records no `research_plan_update`, and a typed edit records one; before #3716 every blur wrote and recorded one, so the Updated a plan stage overcounts before that change.
No `research_qualified_action` can be recorded (#4581), so when none was recorded in the range the funnel omits the qualified-route stage and the route tiles read as not recorded, the same treatment as the overall next-step rate.
The per-user Profile Opens column (the `researchViews` field) counts `research_profile_open`, because `research_view` was only ever emitted by the fellowship detail route and nothing emits it after #3766.
Top Research Entities ranks research and profiles by `research_profile_open` and programs by `fellowship_view`; before #3766 it counted `research_view` and so listed programs only.
Action needed and the top zero-result queries rank every query group with a zero-result search, not only the 100 most searched; action needed also requires at least 2 searches that reached the full search, and its zero-result rate divides by those searches, so a degraded search neither qualifies a group nor dilutes its rate (#4007).
Every action card is therefore a zero-result query group, so the Items to review tile counts distinct query groups, keyed by surface and query, across the action cards and the zero-result and low-result lists, and a query that appears in more than one of them counts once (#4006).
Before #4006 the tile summed the three list lengths, and on Development on 2026-09-30 it read 18 for 15 distinct queries.

The admin funnel's Saved research stage counts distinct students with a `research_save` whose `operation` is `save` and whose `entityType` is `research_entity` (#4005).
A removal is the opposite of the step the stage names, and a program watch is a `fellowship` row from a different journey, so neither counts.
Before #4005 the stage counted any `research_save`, and on Development it reported one saver where the only rows in range were program removals.

The admin funnel reports source inspections, official-route attempts, application opens, and confirmed outcomes separately.
Application opens include only `open_position` and `official_application` qualified categories.
Official-route attempts include only the `open_position`, `official_application`, and `reviewed_route` categories, and exclude `qualified_participation`.
Confirmed outcomes remain `outreach_outcome` records and are never inferred from route attempts.

Search engagement is defined in [Topic matching and search engagement](topic-matching-and-search-engagement.md#search-engagement), and counts a `research_profile_open` or a `research_save` that saved rather than removed as engagement.
`research_view` was only ever emitted by the fellowship detail route, so before #3632 a research-surface search could never read as engaged: on Production, 0 of 39 research searches with results counted, against 25 that were followed by a profile open.
`research_profile_open.source` is the surface the student came from, carried in router state by the card, saved-plan, or related-profile link they followed, and `direct` only when no such link was followed.
Links between profiles (related, affiliated, and similar research) record `related_research`.
Opens recorded before #3632 all read `direct` and cannot be recovered.
Server-side research `search` rows exist in Production only from 2026-09-26, so the search-query and zero-result tables hold no research-surface query text before that date.

## Third-Party Measurement

No third-party analytics tag runs on any page, in any environment.
A Google Analytics 4 tag ran on every page load until #4754 removed it, as the 2026-10-04 entry in `docs/decisions.md` records.
It loaded from the initial document, before the application mounted and before any consent existed, so it sent every visitor's IP address, user agent and a persistent client-id cookie to Google, and nothing in this repository ever read what it collected.

The removal took out the `gtag/js` loader and the `/analytics.js` bootstrap from `client/index.html`, the inert copy of both in the Create React App leftover `client/public/index.html`, and `client/public/analytics.js` itself, which held nothing but the tag's configuration and the outgoing query redaction of #4158.
That redaction went with it, because with no tag there is no measurement request left to redact.
The CSP in `server/src/middleware/securityHeaders.ts` now allows scripts from `'self'` only, and names no Google tag or measurement origin in `connect-src` or `img-src`.
Google Fonts is a separate decision and is unchanged: `style-src` still names `https://fonts.googleapis.com` and `font-src` still names `https://fonts.gstatic.com`.

Three tests keep the tag from coming back unnoticed.
`client/src/__tests__/noGoogleAnalyticsGuard.test.ts` scans the entry document, everything under `client/public/` and the application source for a Google tag loader, a measurement host, a `gtag` or `dataLayer` call, or a measurement id.
`server/src/middleware/__tests__/securityHeaders.test.ts` pins every directive string literally and asserts that neither the production nor the local-development CSP names a Google tag or measurement origin.
`scripts/security-preflight.test.mjs` pins `script-src 'self'` and the absence of those origins in the CSP source.

So `analytics_events` is the only analytics instrument.
It cannot record a logged-out visitor at all (#2333), and that is now the whole posture rather than half of it: a logged-out visitor is not measured by anything.

## Error Reporting

Error reports are telemetry too, so the posture is recorded here.

`server/src/utils/errorTracking.ts` reports a server error with the request method, the matched route template, whether the caller was authenticated, and the session's `userType`.
It sends no user identity.
The session principal (`AuthenticatedSessionUser` in `server/src/passport.ts`) carries a netid and nothing else that identifies the caller, and no stable non-reversible account handle exists to stand in for one, so the report carries no identity rather than a reversible or a newly invented one.
The report quotes the matched route template rather than the concrete request path, because routes such as `/admin-grants/:netid/revoke` and `/users/:netid` would otherwise put a netid into a tag.
`server/src/utils/__tests__/errorTracking.test.ts` fails if a netid reaches the payload, as identity or as a path segment.
The server SDK's defaults are not safe to inherit, and the audit that proved it is recorded in `server/src/utils/__tests__/errorTrackingPayload.test.ts`.
With only a DSN, environment, and release, a server error event carried the concrete request URL with its netid and query string, every request header, the session cookie, a transaction name quoting the concrete path, console lines as breadcrumbs, and local variable values in stack frames.
A session cookie with its signature is a credential, so that default hands the provider a way to act as the signed-in user.
`buildErrorTrackingOptions` in `server/src/utils/errorTracking.ts` therefore turns every `dataCollection` category off, including `stackFrameVariables`, and `scrubServerEvent` reduces `event.request` to its method, rebuilds the transaction from the route template, drops every breadcrumb, and removes credentials from any URL quoted in an exception message.
Every category is set off explicitly rather than left unset, because since Sentry 11 an unset category collects by default, so a category an upgrade adds or renames would silently fall back to on.
Each side's `errorTrackingPayload.test.ts` asserts the SDK's resolved collection options against the full list, so a new or renamed category fails the suite rather than shipping.
The global error handler is the only server capture path: `expressIntegration({ shouldHandleError: false })` turns off Express's automatic capture, which would otherwise fire first and win the dedupe over the route-template report, and `server/src/utils/__tests__/errorTrackingExpressCapture.test.ts` fails if a route error produces any other event.
Express 5 forwards a rejected async handler to that handler on its own, and the same test pins that such a rejection on a mounted router is reported once, under its route template rather than its concrete path.
A route template in Express 5 syntax that carries an optional `{...}` group or a `*name` wildcard is reported without its mount prefix, because its segment count no longer tells the mount apart from the matched path.
A message the server writes itself must still not interpolate a netid, email, or slug, because no scrubber can recognise one.
The route template keeps its mount path even from the global error handler, where Express has already cleared `req.baseUrl`, by taking the leading request segments the template does not cover.
That is safe only while every router is mounted at a static path, so mounting one at a param path means changing that recovery first.

A server report's release is `SENTRY_RELEASE` when it is set and otherwise `RENDER_GIT_COMMIT`, which the hosting platform sets on every deploy, so a report names the commit that produced it without anyone updating a variable (#4144).
The release stays inside error tracking: `GET /api/config` still carries no commit, and no public response does.
The server bundle is built with a source map beside it in `server/build/`, and `yarn --cwd server start` runs `node --enable-source-maps`, so a stack frame names a file under `server/src/` instead of a line in the bundle.
That map is never served, because the static asset server serves only `client/dist` and refuses every `.map` request; the client build still emits no source map.
A server report also carries the platform's `rndr-id` request header as an `rndrId` tag when it is present, and only when it is a short run of letters, digits and hyphens, so a caller cannot put arbitrary text into a tag (#4146).
The error handler writes one JSON line per error with `event: "server_error"`, the method, the same route template the report quotes, that `rndrId`, and the sanitized message, so a log line, the platform's request log, and the error report join on one id.
It never logs the concrete path, the query string, a header other than that id, or the session.

A dependency that fails gracefully is reported as a `warning` rather than an error, through `captureServerWarning` with a closed `DegradedSignal` name (#4145).
The four signals are `mongo_topology_lost` (a request answered `503` after the topology was lost), `embedding_breaker_open` (the query-embedding breaker opened), `corpus_snapshot_failed` (the corpus-snapshot scheduler's measurement threw), and `gate_refresh_failed` (a gate-refresh cycle exited non-zero or could not spawn).
A warning carries only the signal name as its message, a fingerprint equal to that name, and a `signal` tag, so one incident groups into one issue rather than one per request, and it passes through the same `scrubServerEvent` as every other event.
Each server process sends at most one event per signal per minute, so a signal that repeats on every request during an outage cannot exhaust the event quota and push real errors out.
The existing console lines stay, because the platform log is where a reader looks first.

The client reports no user, sets every `dataCollection` category off in `client/src/utils/errorTracking.ts` except the `User-Agent` request header, and scrubs every event before it leaves the browser, in `client/src/utils/errorReportScrubbing.ts`.
The browser SDK's defaults would otherwise attach the concrete page URL, the `Referer` header, navigation and request breadcrumbs with concrete paths and query strings, and console and click breadcrumbs with uncontrolled text.
On `/research/person/:publicKey` and `/research/:slug` that is a person-bearing value.
A path keeps only the segments on a fixed list of static route words and reports every other segment as `:param`, so the list fails closed: a route it does not know loses readability, never privacy.
Adding a client route or an API path with new static words means adding them to that list if the reports should name them.
A query string reports as `?[Filtered]`, a fragment is dropped, and request headers other than `User-Agent` are dropped.
Only navigation, fetch, and XHR breadcrumbs survive, reduced to their method, status, and scrubbed URLs.
Absolute URLs inside an exception message are scrubbed the same way, and a message the client writes itself must not interpolate a slug or key.
A stack frame's `filename` and `abs_path` are scrubbed too, because the SDK falls back to the full page URL for a window error with no usable stack; only a same-origin bundled asset under `/assets/` with no query or fragment is kept verbatim, so source maps still resolve.
`client/src/utils/__tests__/errorTrackingPayload.test.ts` runs the real SDK with its default integrations against a capturing transport and fails if a synthetic key or query value reaches the sent envelope.
The browser can only deliver a report if `connect-src` allows the ingest host, and `server/src/middleware/securityHeaders.ts` derives that host from `VITE_SENTRY_DSN` on the same service rather than naming it.
It accepts only an `https` DSN whose host has the `o<digits>.ingest[.<region>].sentry.io` shape and emits the bare origin, so the policy opens to Sentry exactly when a client DSN is configured and never carries the key, the project path, or a host of any other shape.
A DSN set after deploy needs a restart for the header to change, and a rebuild for the client to report, so a redeploy covers both.

## Identity Joins Must Fail Closed

Most analytics netids have no `Account`, so every join from an analytics row to `Account` and then to `Researcher` runs with a possibly-absent key.
MongoDB coerces an absent `localField` to null, so an unguarded join matches every foreign document whose key is also null, which for `Researcher.accountId` is the whole accountless-shell population.
That multiplies one row into thousands, inflates every downstream count, and grafts an unrelated researcher name onto the row.

Join identity through `singleMatchLookupStages` in `server/src/services/analyticsService.ts`, which requires the foreign key to be present and correctly typed and takes `$first` rather than `$unwind`.
A guard written as a correlated `$expr` comparison against null does not work, because a `let` binding for a missing path is BSON undefined rather than null.
Substituting an empty-array key does not work either, because an empty array coerces to null in a join.
Absent identity must read as absent: a missing `Account` yields no `displayName`, never a borrowed one.
