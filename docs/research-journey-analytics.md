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
| `research_qualified_action`  | `research_entity` | `actionCategory`                                                  | The student opened a route that the server re-qualified against the current QA-01 projection.   |

A result page is one row, never one row per entity.
`entityIds` holds the page's canonical entity identifiers in display order, so a position is the array index, and the server keeps only the identifiers that name a current `ResearchEntity`, validated in one query for the whole page.
A grid restored from the tab's snapshot on a return visit is a page already recorded, so it records nothing.
The retired `research_entity_impression` wrote one row per card, which put 56% of Production's rows into impressions, and a single query with one result could sit beside hundreds of rows from browse scrolling (#3628).
The enum value stays so stored rows remain valid until the TTL expires them, but the batch route no longer accepts it.

The only access-conversion event is `research_qualified_action`.
Its `actionCategory` is the `PlanningContextCategory` enum from `server/src/services/planningContextService.ts`: `open_position`, `official_application`, `reviewed_route`, or `qualified_participation`.
The server rejects missing, stale, or mismatched qualifications and records the current server-owned category instead of trusting the client.

Source review, profile open, results view, filter, save, compare, and plan events never count as access conversion.
`outreach_outcome` remains a separate self-reported outcome and is not inferred from any click.

## Privacy And Reliability

Everything in this section describes `analytics_events`, the first-party instrument, and none of it describes the product as a whole.
A third-party tag also runs on every page load, under none of these constraints.
See Third-Party Measurement below before citing any sentence here as the product's telemetry posture.

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
The per-user table still lists every actor, maintainers included.

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
No `research_qualified_action` can be recorded while planning contexts have no source (#377), so when none was recorded in the range the funnel omits the qualified-route stage and the route tiles read as not recorded, the same treatment as the overall next-step rate.
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

A Google Analytics 4 tag is live on every page load, with measurement id `G-3SQLGT56ZM`.
This section records what it is and what it does, because until #3102 nothing in the repository acknowledged it and the careful first-party sentences above read as if they described the product.

Three files carry it.
`client/index.html` is the Vite entry document, and it loads `https://www.googletagmanager.com/gtag/js?id=G-3SQLGT56ZM` and then `/analytics.js`.
`client/public/analytics.js` defines `window.gtag`, then installs the outgoing redaction described under [What the tag may not send](#what-the-tag-may-not-send), and only then calls `gtag('js', new Date())` and `gtag('config', 'G-3SQLGT56ZM')`.
That order is load-bearing rather than cosmetic: `gtag/js` loads async, so it can already have replaced `dataLayer.push` with its command processor by the time this file runs, and the config push then initialises GA4 and sends its first hit synchronously through whatever transports exist at that moment.
The same two script tags also sit in `client/public/index.html`, a Create React App leftover whose `%PUBLIC_URL%` placeholders are never substituted, so that copy is inert rather than a second live tag.
It is inert because it never ships: Vite copies `client/public/` into `dist/` and then writes the built entry document over the copied one, so a build emits exactly one `dist/index.html` and it is the root document.
Nothing in `client/src` calls `gtag` or pushes to `dataLayer`, so this repository sends no custom events and no user properties.
Everything GA4 records here comes from the default `config` call plus whatever enhanced measurement the GA4 property has enabled, and the property is configured outside this repository, which is why the redaction below sits on the transport rather than in the configuration.

Every environment carries the tag, and all of them report to the same property.
The measurement id is a literal in `client/index.html` and in `client/public/analytics.js` with no condition of any kind around it: no `import.meta.env` check, no environment variable, and no server-side gate.
So `vite build` emits the same two script tags for Development, for Beta on `ylabs-gr4v.onrender.com`, and for Production on `yalelabs.onrender.com`, and a local `yarn dev` serves them too.
`G-3SQLGT56ZM` is the only measurement id in the repository, which means local development traffic and Beta traffic land in the same GA4 property as Production traffic, distinguishable inside GA4 only by hostname.
Any claim that the tag is production-only is therefore wrong, and switching it off for an environment is a change this repository does not currently have a mechanism for.

The tag loads on the initial document, before the application mounts and before anything a visitor could act on, so it runs for a logged-out visitor exactly as for a signed-in one and its collection precedes any consent that does not yet exist.
Verified by building rather than by reading: `yarn --cwd client build` emits one `dist/index.html`, carrying both script tags with `/analytics.js` resolved and none of the Create React App markers, and ships `dist/analytics.js` beside it.

The CSP allowlists the tag deliberately, not by accident.
`server/src/middleware/securityHeaders.ts` names `https://www.googletagmanager.com` in `script-src`; `https://www.google-analytics.com`, `https://analytics.google.com`, `https://region1.google-analytics.com` and `https://stats.g.doubleclick.net` in `connect-src`; and `https://www.google-analytics.com` and `https://stats.g.doubleclick.net` in `img-src`.
`server/src/middleware/__tests__/securityHeaders.test.ts` pins each of those directive strings literally, so dropping an origin is a test-visible change rather than a silent one.

The tag carries no anonymization and no consent flags today.
There is no `anonymize_ip`, no Consent Mode default, no cookie banner, and no opt-out anywhere in the repository.
A default GA4 configuration therefore collects the client IP, the user agent, the page path, and a persistent client-id cookie, cross-session, from every visitor.
`server/src/utils/logSanitizer.ts` does not redact IP addresses, and nothing currently requires it to.

### What the tag may not send

Until #4158 the tag also received every research search a visitor typed.
The research page writes the query into the address bar as `?q=`, `page_location` defaults to `location.href` and keeps the query string, and `q` is one of the five parameters GA4's site-search enhanced measurement lifts into a `search_term`.
Measured in a headless browser against a built client, a single landing on `/research?q=<term>&dept=<label>` produced a `view_search_results` hit carrying `ep.search_term=<term>`, and an in-page search produced a further `page_view` whose `dl` and `dr` both carried the raw query string.

Configuring the tag cannot fix that, and this is the load-bearing fact.
`send_page_view: false` suppresses only the tag's own initial page view; the enhanced-measurement features build their hits from `location.href` and from the query parameters themselves, and a `gtag('set', { page_location })` default is overridden by the explicit parameters those hits carry.
That was measured too, not reasoned: with a sanitized `page_location` default in place, `scroll` and `form_start` reported the redacted path while `view_search_results` still carried the term and the history-driven `page_view` still carried the full URL.

So `client/public/analytics.js` redacts on the way out instead, which is the one place this repository can hold the guarantee rather than delegating it to a property setting nobody here can see.
It wraps `fetch`, `navigator.sendBeacon` and `XMLHttpRequest`, acts only on requests to `google-analytics.com`, `analytics.google.com` and `doubleclick.net`, and leaves every other request, first-party telemetry included, byte-for-byte untouched.
On a measurement request it reduces every parameter whose value is an absolute http(s) URL to origin and path, which covers `dl`, `dr` and `ep.form_destination`, and deletes `ep.search_term`.
A measurement hit whose shape it cannot read, a non-string body or a `Request` object, is dropped rather than sent, so a transport change by Google costs measurement instead of leaking text.

What still reaches Google after that, from the same headless capture: the measurement id, a persistent client id and session id, the connection's IP address, the user agent and its client hints, screen size and language, the page title, `dl` and `dr` as origin and path only, and the events `page_view`, `view_search_results`, `scroll`, `form_start` and `user_engagement` with their non-text parameters (`epn.percent_scrolled`, `ep.form_id`, `ep.first_field_id`, `ep.first_field_type`, `epn.form_length`, `epn.first_field_position`, engagement time).
`view_search_results` survives deliberately: that a search happened is the non-identifying count the product wants, and the term is what it may not have.
No query string, no fragment, and no search term appear in any of it.

Verification is a capture rather than a reading.
Build the client, serve `dist`, and drive a headless browser through a landing on `/research?q=<synthetic>`, a second in-page search, and a navigation to another route, intercepting every request to Google's `collect` endpoints and asserting the synthetic terms appear in none of them.
Block those requests in the probe rather than letting them through: a probe that forwards them files a real page view from a developer's machine into the live property.
`client/src/__tests__/googleAnalyticsQueryRedaction.test.ts` holds the same contract as a unit test, executing the shipped `analytics.js` against recorded transports.

Anonymous-visitor measurement currently comes only from this tag.
`analytics_events` cannot record a logged-out visitor at all (#2333), so the two instruments do not overlap: the strict one sees only signed-in students, and the unconstrained one sees everybody, on a product that deliberately serves logged-out discovery (#1657).

Whether the tag should run with IP anonymization and consent signalling, or run at all, is open and undecided.
Adding `anonymize_ip`, adding Consent Mode, or removing the tag or its CSP entries is that decision being taken, not a cleanup, so none of it belongs in an incidental change.

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
A message the server writes itself must still not interpolate a netid, email, or slug, because no scrubber can recognise one.
The route template keeps its mount path even from the global error handler, where Express has already cleared `req.baseUrl`, by taking the leading request segments the template does not cover.
That is safe only while every router is mounted at a static path, so mounting one at a param path means changing that recovery first.

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
