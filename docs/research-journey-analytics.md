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
| `research_save`              | `research_entity` | `operation`, `surface`                                            | A first-class research-entity save or removal completed successfully.                           |
| `research_compare`           | `research_entity` | `entityCountBucket`                                               | One entity participated in an explicit saved-home comparison or advising preview.               |
| `research_plan_update`       | `research_entity` | `field`                                                           | A saved plan field group persisted successfully.                                                |
| `research_qualified_action`  | `research_entity` | `actionCategory`                                                  | The student opened a route that the server re-qualified against the current QA-01 projection.   |

The only access-conversion event is `research_qualified_action`.
Its `actionCategory` is the `PlanningContextCategory` enum from `server/src/services/planningContextService.ts`: `open_position`, `official_application`, `reviewed_route`, or `qualified_participation`.
The server rejects missing, stale, or mismatched qualifications and records the current server-owned category instead of trusting the client.

Source review, profile open, impression, filter, save, compare, and plan events never count as access conversion.
`outreach_outcome` remains a separate self-reported outcome and is not inferred from any click.

## Privacy And Reliability

Payloads are deny-by-default allowlists of short enums and count buckets.
They do not retain raw query text, URLs, hostnames, contact destinations, notes, plan contents, filter values, or cross-event search identifiers.
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
Official-route attempts include all currently qualified categories.
Confirmed outcomes remain `outreach_outcome` records and are never inferred from route attempts.
