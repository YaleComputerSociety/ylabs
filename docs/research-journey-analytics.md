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
| `research_save`              | `research_entity` or `fellowship` | `operation`, `surface`                                            | A saved research-entity home, or a watched program on `/programs` (surface `search`) or the dashboard's Watched programs tab (surface `saved_plans`), was saved or removed successfully. |
| `research_compare`           | `research_entity` | `entityCountBucket`                                               | One entity participated in an explicit saved-home comparison or advising preview.               |
| `research_plan_update`       | `research_entity` | `field`                                                           | A saved plan field group persisted a changed value successfully.                                |

A result page is one row, never one row per entity.
`entityIds` holds the page's canonical entity identifiers in display order, so a position is the array index, and the server keeps only the identifiers that name a current `ResearchEntity`, validated in one query for the whole page.
A grid restored from the tab's snapshot on a return visit is a page already recorded, so it records nothing.
The retired `research_entity_impression` wrote one row per card, which put 56% of Production's rows into impressions, and a single query with one result could sit beside hundreds of rows from browse scrolling (#3628).
The batch route refuses it, and on 2026-10-11 its stored rows were deleted from Development and Production, because the three-year TTL would have kept them inflating every all-event total on the dashboard (#4985).
The enum value is gone, so no read can count it again.
Every all-event total (Avg Events Per User, Most Active Users, the per-user event counts, and the drilldown) matches only the current enum's types, so a stored row of a removed type adds nothing and is never relabelled as another event (#4985).
Active Users counts accounts, not raw event netids: a netid with events in the range counts only when it has a non-archived account that has logged in, the same population as Total Users, so Active Users can never exceed Total Users.
A netid whose account row was deleted keeps its events but is no longer an active user.
Avg Events Per User stays an all-event total over every netid with events in the range, so those events still count toward it.

The only access-conversion event was `research_qualified_action`, and it is retired.
It was qualified against a planning context that no source ever produced (#377), so none could be recorded, and the 2026-08-25 "Simple Directory First" decision retired the planning-context framing; #4581 removed the producer, the planning-context service and the qualification check.
No row of it was ever stored in any database, so #4985 removed the enum value, the funnel's qualified-route stage, the Official next-step rate, and the Official-route reach and Application opens tiles, which could only ever read as not recorded.
`pathway_save` went with it for the same reason: no emitter and zero stored rows.
`research_view` and `profile_update` had no emitter either, but carried historical rows, so #4989 kept them; on 2026-10-11 those rows were deleted from Development and Production and #4992 removed both enum values, so every stored event type now has a live emitter.

Source review, profile open, results view, filter, save, compare, and plan events never count as access conversion.
`outreach_outcome` remains a separate self-reported outcome and is not inferred from any click.

## Email Clicks

A click on an email address on the research detail page records `contact_route_click`, not a `research_source_review`.
It is one of the three legacy research events (`ways_in_click`, `contact_route_click`, `source_link_click`) the batch route still accepts beside the journey taxonomy, and `RESEARCH_EVENT_TYPES` in `server/src/services/researchAnalytics.ts` lists all of them.
Its allowlisted payload is `contactMethod` (one of `CONTACT_METHODS`, `email` for a `mailto:` link) and an optional `surface`, one of `CONTACT_ROUTE_SURFACES`.
The `surface` is `lead_card` for the email on a lead's card and `reach_out` for the email in the "How to get involved" reach-out line.
A click from anywhere else, including a program's contact on `/programs`, carries no `surface`, and a value outside the allowlist is dropped rather than stored.
The page records it from one capture-phase click handler on the whole detail page, which reads the surface from the anchor's `data-contact-route-surface` attribute, so a new email link is counted without any wiring and names its surface only if it sets that attribute.
The payload never carries the address, the `mailto:` href, or a host, only the method and the surface.
Before #3459 the detail page recorded nothing for an email click, and rows before the `surface` field have no `surface`, so a lead-card versus reach-out split starts when it shipped.
An email click is a contact attempt, not a source inspection, so it is not counted among the admin funnel's source inspections, and like every click it is never an access conversion.

## Privacy And Reliability

Everything in this section describes `analytics_events`, the first-party instrument.
PostHog, the one third-party instrument, runs only in Production for signed-in students and is described in Third-Party Measurement below; nothing in this section applies to it.

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
The student-facing statement of what is collected, who receives it and how long it is kept is the `/privacy` page (`client/src/pages/privacy.tsx`, #4157).
Changing what is recorded, its retention, who can read it, or which third party receives it also requires updating that page.
`server/src/middleware/__tests__/privacyNoticeDisclosures.test.ts` fails when the Content-Security-Policy allows a third-party origin that `PRIVACY_NOTICE_DISCLOSED_ORIGINS` in `client/src/utils/privacyNotice.ts` does not name.
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
The per-user Profile Opens column (the `researchViews` field) counts `research_profile_open`, because `research_view` was only ever emitted by the fellowship detail route and nothing emits it after #3766.
Top Research Entities ranks research and profiles by `research_profile_open` and programs by `fellowship_view`; before #3766 it counted `research_view` and so listed programs only.
Action needed and the top zero-result queries rank every query group with a zero-result search, not only the 100 most searched; action needed also requires at least 2 searches that reached the full search, and its zero-result rate divides by those searches, so a degraded search neither qualifies a group nor dilutes its rate (#4007).
Every action card is therefore a zero-result query group, so the Items to review tile counts distinct query groups, keyed by surface and query, across the action cards and the zero-result and low-result lists, and a query that appears in more than one of them counts once (#4006).
Before #4006 the tile summed the three list lengths, and on Development on 2026-09-30 it read 18 for 15 distinct queries.

The admin funnel's Saved research stage counts distinct students with a `research_save` whose `operation` is `save` and whose `entityType` is `research_entity` (#4005).
A removal is the opposite of the step the stage names, and a program watch is a `fellowship` row from a different journey, so neither counts.
Before #4005 the stage counted any `research_save`, and on Development it reported one saver where the only rows in range were program removals.

The admin funnel's journey metrics report source inspections only, as distinct students with a `research_source_review`.

Search engagement is defined in [Topic matching and search engagement](topic-matching-and-search-engagement.md#search-engagement), and counts a `research_profile_open` or a `research_save` that saved rather than removed as engagement.
`research_view` was only ever emitted by the fellowship detail route, so before #3632 a research-surface search could never read as engaged: on Production, 0 of 39 research searches with results counted, against 25 that were followed by a profile open.
`research_profile_open.source` is the surface the student came from, carried in router state by the card, saved-plan, or related-profile link they followed, and `direct` only when no such link was followed.
Links between profiles (related, affiliated, and similar research) record `related_research`.
Opens recorded before #3632 all read `direct` and cannot be recovered.
Server-side research `search` rows exist in Production only from 2026-09-26, so the search-query and zero-result tables hold no research-surface query text before that date.

## Third-Party Measurement

PostHog Cloud US records where signed-in students click and where they wait, in Production only (#5492, the 2026-11-10 entry in `docs/decisions.md`).
It is the only third-party analytics instrument, and no Google Analytics tag runs on any page in any environment.

### What runs, and where

`client/src/utils/productAnalytics.ts` is the only module that reaches `posthog-js`.
It imports the SDK lazily from the app bundle once the session check answers, so nothing loads before the app mounts and nothing loads for a logged-out visitor.
It imports the no-external build plus the recorder, dead-click and web-vitals extensions, so the SDK has no code path that loads a script from PostHog, and `script-src` stays `'self'`.
It starts only when all of these hold:

- the build is a production build with `VITE_POSTHOG_KEY` set to a `phc_` project key and `VITE_POSTHOG_HOST` set to exactly `https://us.i.posthog.com`;
- `GET /api/check` answers `productAnalytics: true`, which `isProductAnalyticsAllowedForSession` in `server/src/utils/posthogConfig.ts` gives only to a signed-in session without an active admin grant, on a deployed runtime whose `MONGODBURL` names the `Prod` database, whose `MEILISEARCH_INDEX_PREFIX` is `prod`, and whose `SCRAPER_ENV` is not `beta`.

The same server gate is the only way `connect-src` in `server/src/middleware/securityHeaders.ts` gains `https://us.i.posthog.com` and `https://us-assets.i.posthog.com`, so a Beta, Development or local page that somehow started the SDK would have every request refused by its own CSP.
A session that ends, or a request the server answers with an authentication failure, closes the instance: `before_send` drops every later event and replay stops.

### What it captures

- Pageviews on every history change, page leaves, clicks through autocapture, rage clicks, dead clicks, heatmaps, web vitals, and session replay with network timing.
- Every first-party journey event `trackResearchEvent` in `client/src/utils/researchAnalytics.ts` records is also sent to PostHog under the same name (`research_search`, `research_results_view`, `research_profile_open`, `research_source_review`, `contact_route_click`, `research_filter_change`, `research_save`, `research_compare`, `research_plan_update`, and the program events `fellowship_view`, `ways_in_click` and `source_link_click`), so search, profile open and outbound contact form named funnels.
`journeyEventProperties` in `client/src/utils/productAnalytics.ts` forwards only payload values that are short lowercase enum or bucket tokens, plus the entity type and the entity ids the first-party event already carries, so a query, address, URL, name or note cannot pass even if a caller put one in a payload.
An event emitted before the session check answers is held in memory and sent once PostHog starts, and discarded if it does not.
- Unhandled errors and promise rejections as `$exception` events, with the same query and netid redaction as every other event; console errors are not captured.
- Autocapture never captures an input value (`capture_value_css_selector_allowlist: []`), copied text, element text (`mask_all_text`), or a text-bearing attribute such as `aria-label`, `title`, `alt` or `placeholder`.
- Replay masks every input (`maskAllInputs: true`) and all text (`maskTextSelector: '*'`), replaces text-bearing attributes with `*`, records no request or response body or header, and records no console output, structured data or cross-origin frame.
- Every URL the SDK sends, in events, replay page metadata, element `href` attributes and network timing entries, loses its query string and fragment, so a search query or filter in `?q=` never leaves the page; the URL path is kept, so a recording shows which public research page was open.
- A URL-valued field (`href`, `src`, `action`, `$current_url`, the referrer and session-entry URLs, and the `href` entries of `$elements_chain`) loses its whole query and fragment even with no path, such as a relative `?q=` link (#5621).
- `$snapshot` replay events go through the same `createRedactor` in `before_send` as every other event, with the SDK's replay compression off (`compress_events: false`) so the redactor sees the recorded DOM; this is defence in depth over the SDK's own `maskCapturedNetworkRequestFn` and `maskAttributeFn` hooks (#5621).
- The search term posthog-js reads from a search-engine referrer (`ph_keyword`, `$session_entry_ph_keyword`) and the engine name (`$search_engine`, `$session_entry_search_engine`) are deleted from every event (#5621).
- The signed-in netid is redacted from every string the SDK sends, as a backstop for a path or attribute that carries one.
- Nothing is written to a cookie, `localStorage` or `sessionStorage` (`persistence: 'memory'`), so a page reload starts a new recording.
- A browser that sends Do Not Track is not measured (`respect_dnt: true`).
- Console logs, surveys, product tours, conversations, web experiments, site apps and feature flags are off, and their extensions are not bundled.

### Identity

PostHog receives `accounts.productAnalyticsId`, a random version 4 UUID that `ensureProductAnalyticsId` in `server/src/services/productAnalyticsIdentityService.ts` assigns on the account's first Production session check that PostHog may measure, and returns in `GET /api/check` as `productAnalyticsId`.
The client passes it as the bootstrapped, identified distinct ID and never calls `identify`, so person profiles exist only for these IDs.
A profile carries one person property, `user_type`, bucketed to `undergraduate`, `graduate`, `student`, `faculty`, `professor`, `staff` or `other`; `before_send` drops every other `$set`, every `$set_once`, and every identify, alias and group event.
An account the server cannot give an ID to is not measured at all: `GET /api/check` answers `productAnalytics: false` and the client starts PostHog only with a well-formed ID, so no session falls back to an SDK-assigned anonymous ID that account deletion could not find (#5621).
The ID is generated, not derived from the netid or the account `_id`, so it cannot be reversed outside the database, and accounts are environment-local, so it exists only in Production.
An admin resolves it to a netid with the "PostHog ID Lookup" on `/analytics`, backed by the admin-only `GET /api/analytics/product-analytics-ids/:productAnalyticsId`, so the netid itself never leaves y/labs.
No other system may receive the ID: error reports, logs and `analytics_events` carry none.

### Operating it

- The owner sets `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` on the Production web service only and redeploys, because the client reads them at build time; Beta and local `.env` files leave both unset.
- The PostHog project must have "Discard client IP data" on, because the SDK's `ip` option no longer has any effect, and its data retention must be no longer than the 1,095-day TTL on `analytics_events`.
- The `/privacy` page names PostHog, what it receives, the IP discard and the retention cap (#4157), so both project settings above must be on before the key is set, or the page is wrong.
- Automated browsers are not measured: the SDK drops events from a `navigator.webdriver` session, so the end-to-end smoke never reaches PostHog.

### Guards

- `client/src/utils/__tests__/productAnalyticsPayload.test.ts` runs the real SDK against a capturing transport and fails if a typed value, page text, query, accessible label or netid reaches an event or a recording, if a body or header is recorded, if anything reaches storage, or if events continue after the session ends.
- `client/src/__tests__/posthogUsageGuard.test.ts` fails if a `phc_` project key is committed.
- The payload test also fails if a person property other than the bucketed `user_type` is sent, if a journey event carries a value outside its bucketed enum, or if an identify event is sent.
- `client/src/__tests__/noGoogleAnalyticsGuard.test.ts` runs a real production `vite build` and fails on any Google tag loader, measurement host, `gtag` call or measurement id, on a third-party script tag in the entry document, and on a bundled PostHog external script loader.
- `client/src/__tests__/entryChunkGuard.test.ts` keeps `posthog-js` out of the entry chunk.
- `server/src/middleware/__tests__/securityHeaders.test.ts` pins every directive literally, including the exact PostHog `connect-src`, and refuses a non-US, look-alike, port or path host, Beta and local development.

### History

A Google Analytics 4 tag ran on every page load until #4754 removed it, as the 2026-10-04 entry in `docs/decisions.md` records.
It loaded from the initial document, before the application mounted and before any consent existed, so it sent every visitor's IP address, user agent and a persistent client-id cookie to Google, and nothing in this repository ever read what it collected.
The removal took out the `gtag/js` loader and the `/analytics.js` bootstrap from `client/index.html`, the inert copy of both in the Create React App leftover `client/public/index.html`, and `client/public/analytics.js` itself, which held nothing but the tag's configuration and the outgoing query redaction of #4158.
Google Fonts is a separate decision and is unchanged: `style-src` still names `https://fonts.googleapis.com` and `font-src` still names `https://fonts.gstatic.com`.
`analytics_events` still cannot record a logged-out visitor (#2333), and neither does PostHog, so a logged-out visitor is not measured by anything.

## Error Reporting

Error reports are telemetry too, so the posture is recorded here.

`server/src/utils/errorTracking.ts` reports a server error with the request method, the matched route template, whether the caller was authenticated, and the session's `userType`.
It sends no user identity.
The session principal (`AuthenticatedSessionUser` in `server/src/passport.ts`) carries a netid and nothing else that identifies the caller, so the report carries no identity rather than a reversible one.
The one non-reversible account handle, `accounts.productAnalyticsId`, is for PostHog alone (Third-Party Measurement above) and is never added to an error report.
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
