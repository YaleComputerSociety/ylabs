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
| `research_entity_impression` | `research_entity` | `surface`, `positionBucket`                                       | A canonical entity was returned in a visible result page.                                       |
| `research_profile_open`      | `research_entity` | `source`                                                          | A canonical research profile loaded successfully.                                               |
| `research_source_review`     | `research_entity` | `sourceCategory`                                                  | A student opened a profile, website, ORCID, publication, or evidence source.                    |
| `research_filter_change`     | none              | `operation`, `filter`                                             | A bounded research filter was applied, removed, cleared, opened, or closed.                     |
| `research_save`              | `research_entity` or `fellowship` | `operation`, `surface`                                            | A saved research-entity home, or a watched program on the account Program Watch surface, was saved or removed successfully. |
| `research_compare`           | `research_entity` | `entityCountBucket`                                               | One entity participated in an explicit saved-home comparison or advising preview.               |
| `research_plan_update`       | `research_entity` | `field`                                                           | A saved plan field group persisted successfully.                                                |
| `research_qualified_action`  | `research_entity` | `actionCategory`                                                  | The student opened a route that the server re-qualified against the current QA-01 projection.   |

The only access-conversion event is `research_qualified_action`.
Its `actionCategory` is the `PlanningContextCategory` enum from `server/src/services/planningContextService.ts`: `open_position`, `official_application`, `reviewed_route`, or `qualified_participation`.
The server rejects missing, stale, or mismatched qualifications and records the current server-owned category instead of trusting the client.

Source review, profile open, impression, filter, save, compare, and plan events never count as access conversion.
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

The analytics collection uses the existing 1,095-day TTL index in `server/src/models/analytics.ts`.
Beta continues to suppress real student analytics through `shouldSuppressBetaAnalyticsEvent`, while allowing fixture and admin validation.
The endpoint remains first-party, authenticated, private, and covered by the existing analytics access controls.

## Dashboard Semantics

The admin funnel reports source inspections, official-route attempts, application opens, and confirmed outcomes separately.
Application opens include only `open_position` and `official_application` qualified categories.
Official-route attempts include only the `open_position`, `official_application`, and `reviewed_route` categories, and exclude `qualified_participation`.
Confirmed outcomes remain `outreach_outcome` records and are never inferred from route attempts.

## Third-Party Measurement

A Google Analytics 4 tag is live on every page load, with measurement id `G-3SQLGT56ZM`.
This section records what it is and what it does, because until #3102 nothing in the repository acknowledged it and the careful first-party sentences above read as if they described the product.

Three files carry it.
`client/index.html` is the Vite entry document, and it loads `https://www.googletagmanager.com/gtag/js?id=G-3SQLGT56ZM` and then `/analytics.js`.
`client/public/analytics.js` defines `window.gtag`, then calls `gtag('js', new Date())` and `gtag('config', 'G-3SQLGT56ZM')`.
The same two script tags also sit in `client/public/index.html`, a Create React App leftover whose `%PUBLIC_URL%` placeholders are never substituted, so that copy is inert rather than a second live tag.
Nothing in `client/src` calls `gtag` or pushes to `dataLayer`, so this repository sends no custom events and no user properties.
Everything GA4 records here comes from the default `config` call plus whatever enhanced measurement the GA4 property has enabled, and the property is configured outside this repository.

The CSP allowlists the tag deliberately, not by accident.
`server/src/middleware/securityHeaders.ts` names `https://www.googletagmanager.com` in `script-src`; `https://www.google-analytics.com`, `https://analytics.google.com`, `https://region1.google-analytics.com` and `https://stats.g.doubleclick.net` in `connect-src`; and `https://www.google-analytics.com` and `https://stats.g.doubleclick.net` in `img-src`.
`server/src/middleware/__tests__/securityHeaders.test.ts` pins each of those directive strings literally, so dropping an origin is a test-visible change rather than a silent one.

The tag carries no anonymization and no consent flags today.
There is no `anonymize_ip`, no Consent Mode default, no cookie banner, and no opt-out anywhere in the repository.
A default GA4 configuration therefore collects the client IP, the user agent, the page path, and a persistent client-id cookie, cross-session, from every visitor.
`server/src/utils/logSanitizer.ts` does not redact IP addresses, and nothing currently requires it to.

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
`client/src/utils/errorTracking.ts` sets no user at all.

`Sentry.init` passes only the DSN, environment, and release, so the SDK's own defaults decide the rest.
`sendDefaultPii` is unset, which disables user info and request bodies and denies the SDK's PII header snippets, but it does not disable automatic request attachment, and what the default HTTP integration attaches to a server event has not been audited.

## Identity Joins Must Fail Closed

Most analytics netids have no `Account`, so every join from an analytics row to `Account` and then to `Researcher` runs with a possibly-absent key.
MongoDB coerces an absent `localField` to null, so an unguarded join matches every foreign document whose key is also null, which for `Researcher.accountId` is the whole accountless-shell population.
That multiplies one row into thousands, inflates every downstream count, and grafts an unrelated researcher name onto the row.

Join identity through `singleMatchLookupStages` in `server/src/services/analyticsService.ts`, which requires the foreign key to be present and correctly typed and takes `$first` rather than `$unwind`.
A guard written as a correlated `$expr` comparison against null does not work, because a `let` binding for a missing path is BSON undefined rather than null.
Substituting an empty-array key does not work either, because an empty array coerces to null in a join.
Absent identity must read as absent: a missing `Account` yields no `displayName`, never a borrowed one.
