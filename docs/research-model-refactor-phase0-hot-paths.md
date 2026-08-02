# Research Model Refactor - Phase 0 Hot-Path Audit

This audit records the source-backed ownership, read path, declared indexes, and boundedness of the five hot surfaces required by Phase 0.
It was refreshed from Beta commit `b016ad44` without connecting to MongoDB, Meilisearch, or any environment secrets.
All cost statements below are structural inferences from source.
They are not measured runtime results.

## How to read this audit

`Bounded` means that source applies a fixed request, result, or fan-out limit before application memory can grow without limit.
`Unbounded` means that no source-level limit constrains the matching collection fan-out, even when the number of parent IDs is bounded.
An index listed here is only declared in a Mongoose schema or Meilisearch settings.
Phase 0 still needs live `getIndexes()`, Meilisearch settings, and query-plan evidence because deployed index state can drift from source.

## Ownership summary

| Surface              | Client owner                                                                                 | HTTP and orchestration owner                                                                              | Runtime data owner                                                                                                                                                                       | Search owner                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/research`          | `client/src/pages/research.tsx`                                                              | `researchGroupController.searchResearchGroups` and `researchGroupService.searchResearchGroupsViaMeili`    | `research_entities` is authoritative after candidate retrieval, with access enrichment from `access_signals`, `entry_pathways`, `posted_opportunities`, `contact_routes`, and `listings` | The prefixed `researchentities` Meilisearch index owns candidate retrieval, ranking, filters, and facets during the normal path |
| `/research/:slug`    | `client/src/pages/labDetail.tsx`                                                             | `researchGroupController.getResearchGroupBySlug` and `researchGroupService.getResearchGroupDetail`        | `research_entities` owns identity and visibility, while member, access, activity, listing, and relationship collections own their respective sections                                    | No Meilisearch query runs on the detail path                                                                                    |
| `/opportunities/:id` | `client/src/pages/opportunityDetail.tsx`                                                     | `opportunityController.getOpportunityById` and `opportunityDetailService.getOpportunityDetail`            | `posted_opportunities` owns the posting, `entry_pathways` owns the durable route, `research_entities` owns the host, and `observations` owns evidence                                    | No Meilisearch query runs on the detail path                                                                                    |
| Account planning     | `client/src/pages/account.tsx` and `client/src/components/accounts/SavedPathwaysSection.tsx` | `userController` and `userService` saved-research handlers, plus pathway and fellowship matching services | Runtime ownership is still embedded in `users.savedResearchEntities`, `users.savedResearchEntityPlans`, `users.favPathways`, and `users.savedPathwayPlans`                               | Pathway hydration uses MongoDB aggregation, not the `pathways` Meilisearch index                                                |
| Admin access-review  | `client/src/pages/analytics.tsx`, `AdminPanel.tsx`, and `AdminAccessReview.tsx`              | Admin routes call `adminAccessReviewService` directly                                                     | `admin_access_review_projections` owns the rebuildable list projection, `research_entities` owns queue parents, the four access collections own review state, and `observations` owns evidence | Pathway Meilisearch sync can run after a faculty-opportunity review write, but list and detail reads are MongoDB-only           |

The first-class `research_plans` schema exists, but none of the account-planning endpoints traced here reads or writes it.
Phase 0 must therefore treat the embedded `users` planning fields as the current runtime owner until a later vertical cutover changes the endpoints.

## `/research`

### Read path

The public React route in `client/src/App.tsx` renders `Research`.
`Research` sends `POST /api/research/search` through the shared Axios client with a query, page, page size, filters, and operator-only options when applicable.
`server/src/routes/researchGroups.ts` dispatches the request to `researchGroupController.searchResearchGroups`.
The controller caps the page at 1,000, caps page size at 100, bounds query and filter inputs, resolves current admin authority, and enforces public visibility tiers for ordinary viewers.
`researchGroupService.searchResearchGroupsViaMeili` normalizes the student query and searches the environment-prefixed `researchentities` index.
Blank browse requests sort by `browseRankScore:desc` and then `lastObservedAt:desc`.
Non-empty ordinary queries use Meilisearch hybrid search with the `default` embedder, while short aliases such as `ai` and `ml` use keyword-only topic attributes.
The service then treats MongoDB as authoritative by loading the returned IDs from `research_entities` with visibility checks.
It enriches the bounded page with listing presence, access summaries, and planning context before returning public DTOs.

### Boundedness and cost drivers

- Normal Meilisearch result output is bounded to 100 hits, and the MongoDB verification query receives at most those 100 IDs.
- Listing presence is bounded by the page IDs and uses `Listing.distinct` with `researchEntityId` and `archived`.
- Access-summary and planning-context parent ID lists are capped at 100.
- Access-summary child queries do not cap the number of matching access signals, pathways, or opportunities for those parent IDs.
- Planning-context child queries do not cap the number of matching pathways, contact routes, or opportunities for those parent IDs.
- The access and planning enrichments reread overlapping collections for the same page.
- A Meilisearch failure falls back to `ResearchEntity.find(...).lean()` without a database limit, then performs text matching, facet counting, and sorting across all matching entities in application memory.
- The operator-only `low-first` branch also loads every matching research entity and computes quality and ordering in application memory before slicing the requested page.
- Meilisearch may retry once without hybrid search when the embedder is missing and may retry without `browseRankScore` when deployed sortable settings are stale.

### Declared indexes and settings

The Meilisearch settings in `researchEntitySearchIndexService.ts` declare the filterable attributes used here, including visibility, kind, school, departments, research areas, openness, and access fields.
They declare `browseRankScore`, `lastObservedAt`, `name`, `createdAt`, and `updatedAt` as sortable.
The `research_entities` schema declares single-field indexes for the common browse filters and a compound `{ studentVisibilityTier: 1, archived: 1 }` index.
It also declares `{ archived: 1, browseRankScore: -1 }`, which does not match the public visibility predicate plus the two-key browse order as one compound index.
The access collections declare indexes beginning with `researchEntityId`, and listings declare `{ researchEntityId: 1, archived: 1 }`.
Source declarations do not prove that Beta, ProductionCopy, or the prefixed Meilisearch indexes have these settings.

## `/research/:slug`

### Read path

The public React route renders `LabDetail`, which sends `GET /api/research/:slug`.
The route applies a 60-second public cache header and calls `researchGroupController.getResearchGroupBySlug`.
The controller validates and normalizes the slug, then calls `researchGroupService.getResearchGroupDetail`.
The service first loads one visible, non-archived `research_entities` document by slug.
It then loads current member rows, users and faculty members, shared-image guards, member scholarly attributions, papers, scholarly links, listings, access records, planning context, and bidirectional entity relationships.

### Boundedness and cost drivers

- The entity lookup returns at most one document because `slug` is declared unique.
- Member rows are limited to 100, and the public verified-roster disclosure is further limited to 24.
- The shared-image guard receives member image URLs but may scan up to 500 matching user documents.
- Member scholarly attributions are limited to 80, recent paper queries are limited to 10 each, entity scholarly links are limited to 10, and attributed scholarly links are limited to 20.
- Listings, entry pathways, access signals, contact routes, and posted opportunities are each limited to 50 on their direct detail queries.
- Each relationship direction requests 51 rows, returns at most 50, and then loads only the related entity IDs from those rows.
- Access-summary and planning-context helpers additionally reread access collections without per-child limits.
- The detail service therefore has bounded direct sections but an unbounded enrichment fan-out when one entity has many access records.
- Several independent reads run in parallel, which reduces sequential latency but does not reduce database work.

### Declared indexes and gaps

The unique slug declaration supports the initial entity lookup if the deployed unique index exists.
Member indexes begin with `researchEntityId`, including `{ researchEntityId: 1, role: 1 }`, but no declared compound index covers the full current-member filter and its `{ role: 1, updatedAt: -1 }` sort.
Paper has a `yaleAuthorIds` index and separate date indexes, but no declared compound index covers each author filter plus its date sort.
Listing has `{ researchEntityId: 1, archived: 1 }`.
Each access collection has a `researchEntityId` index, with review compounds where relevant.
Relationship indexes begin with the source or target entity and relationship type, but the detail queries omit relationship type and sort by confidence and update time.
`research_scholarly_links` and `research_scholarly_attributions` declare no indexes in their model files.
The attribution query by `targetUserId` and the scholarly-link query by `researchEntityId` therefore require particular live scrutiny.
The user schema declares a sparse `imageUrl` index matching the shared-image guard query shape.
Phase 0 still requires live Development, Beta, and ProductionCopy evidence that the deployed index exists and the query uses it.

## `/opportunities/:id`

### Read path

The React route is wrapped in `PrivateRoute`, although the Express `GET /api/opportunities/:id` endpoint itself is public.
`OpportunityDetail` fetches the ID, and the route plus controller reject malformed ObjectIds.
`opportunityDetailService.getOpportunityDetail` loads one visible `posted_opportunities` record by `_id`.
It then loads the linked `entry_pathways` and visible `research_entities` records in parallel.
Finally, it loads referenced `observations` by `_id` and returns bounded, redacted public fields.

### Boundedness and cost drivers

- Opportunity, pathway, and entity reads are each single-document `_id` lookups.
- Evidence collection is bounded by at most 50 IDs from each of the opportunity and pathway arrays, so the observation query receives at most 100 raw IDs.
- The observation result is not separately limited, but `_id` membership bounds it to the referenced set.
- No Meilisearch request or broad collection scan appears in the source path.
- The route-level client authentication and public server endpoint are an access-contract mismatch to resolve separately from query cost.

### Declared indexes

MongoDB's built-in `_id` indexes are the main selectors for all four collections on this path.
The posted-opportunity visibility predicates and observation sort are additional filters on already bounded `_id` sets.
Live evidence should still confirm that these queries remain `IXSCAN` plus bounded fetches rather than exposing an unexpected plan regression.

## Account planning

### Read path

The private `/account` route renders `Account`, which mounts `SavedPathwaysSection`.
Initial hydration starts four logical requests through `loadSavedPlanDashboard`: canonical saved research entities, canonical entity plans, funding matches, and legacy saved pathways.
Compatibility fallback can additionally request legacy plan details.
The canonical entity endpoints call `userService.migrateSavedResearchEntitiesForUser`.
That service reads the user, may hydrate entity-owned saves from legacy pathways, may claim the migration with `findOneAndUpdate`, rereads the user, verifies public entities, and may prune hidden entity IDs and their embedded plans.
The legacy saved-pathway endpoint reads the user and hydrates pathways through `pathwaySearchService.getPathwaysByIds`.
It then writes normalized pathway IDs and pruned plans back to the user even though the controller operation is a `GET`.
Funding matches repeat the legacy user and pathway normalization, write the user, then load every non-archived fellowship and score every loaded fellowship against each saved pathway in application memory.

### Boundedness and cost drivers

- Stored mutation and response helpers cap saved IDs and plan entries at 100.
- `getPathwaysByIds` passes at most 100 IDs through the full pathway aggregation, including research entity, opportunity, access-signal, and contact-route lookups.
- Canonical entity visibility is queried by a bounded `_id` set.
- The initial dashboard duplicates user reads, compatibility checks, pathway hydration, and potentially user writes across concurrent requests.
- Lazy migration can retry its compare-and-claim loop up to five times when concurrent planning state changes.
- Fellowship matching loads every non-archived fellowship without a result limit before performing an `O(saved pathways * fellowships)` in-memory scoring loop.
- The current path does not use the first-class `research_plans` collection or its account-target indexes.
- Account planning cannot be classified as a read-only surface because ordinary dashboard `GET` requests can mutate embedded compatibility state.

### Declared indexes and gaps

The user schema declares `netid` as unique, which creates an index under normal Mongoose index deployment.
Runtime lookups use an anchored case-insensitive regex on `netid`, so a live explain is required to determine whether the deployed index and collation avoid a broad index or collection scan.
Saved entity and plan fields are embedded under the selected user and do not need cross-user indexes for this path.
The pathway pipeline starts from bounded `_id` values but runs several correlated lookups for each selected pathway.
Fellowships declare an `{ archived: 1 }` index and a separate deadline index, but no declared compound index covers `{ archived: false }` with `{ deadline: 1, updatedAt: -1 }`.
The unused `research_plans` model declares unique `{ accountId: 1, target.kind: 1, target.id: 1 }` and list `{ accountId: 1, archived: 1, updatedAt: -1 }` indexes.

## Admin access-review

### Read path

The admin-only `/analytics` route renders `Analytics`, which mounts `AdminPanel`.
Selecting the Access Review tab mounts `AdminAccessReview`.
The list sends `GET /api/admin/access-review`, and selection sends `GET /api/admin/access-review/:id`.
Admin middleware applies authentication, active admin authority, and private no-store headers before these handlers.
The list service checks that the environment-local `admin_access_review_projections` collection is ready and has no stale rows.
It filters and sorts stored queue prefixes, counts, official-application state, and sort keys, applies page skip and limit, and then hydrates only the selected `research_entities` parents.
The list request also runs eight progress counts, consisting of remaining and reviewed-today counts across four access collections.
The detail service loads the entity and all matching pathways, signals, routes, and opportunities without result limits.
It then resolves bounded evidence IDs per record from `observations`.

### Boundedness and cost drivers

- Page and page-size inputs are capped at 1,000 and 100, and projection pagination occurs before parent hydration.
- `hasUnreviewed` and queue sorts use stored projection fields.
- Search preserves case-insensitive substring matching through a bounded set of normalized word suffixes stored in the projection.
- Each queue request adds eight collection counts to the main aggregate.
- Detail output has no source-level limit for any of the four access-record collections.
- Evidence IDs are capped at 100 per record, but the number of records is unbounded, so total evidence fan-out is also unbounded.
- The list and detail paths do not use Meilisearch.

### Declared indexes and gaps

Each access collection declares a `researchEntityId` index and a `{ researchEntityId: 1, review.status: 1, review.reviewedAt: -1 }` compound index.
Entry pathways and posted opportunities add exclusion predicates on `derivationKey` and `submissionStatus` that are not covered by those review compounds.
The projection declares indexes for its parent reference, stale-state checks, bounded search suffixes, and each supported queue sort.
Live explains must determine whether deployed projection indexes support each queue filter and sort without a collection scan or blocking sort.

## Live evidence required before Phase 0 closes

The following evidence must be collected read-only in Development, Beta, and the approved ProductionCopy or restore target.
Do not run these diagnostics against the primary Production database unless the operator runbook explicitly authorizes the environment and load window.
Reports must contain aggregate plan statistics and redacted query labels, not user IDs, entity names, notes, contact details, or raw evidence.

The private ResearchEntity search-baseline command is documented in the [Phase 0 runbook](./research-model-refactor-phase0.md#private-researchentity-search-baseline).
It covers the representative ResearchEntity query suite, deployed Meilisearch settings fingerprint, end-to-end latency samples, degradation state, estimated totals, and pseudonymous ordered result fingerprints.
It does not replace the MongoDB `executionStats` evidence below.

### Environment and index drift

1. Record MongoDB server version, collection document counts, and `getIndexes()` output for every collection named in this audit.
2. Record the resolved Meilisearch index name, index stats, searchable/filterable/sortable settings, embedder presence, and settings task status for `researchentities`.
3. Compare deployed definitions with the source declarations and classify every missing, extra, hidden, or stale index before measuring endpoint plans.

### Representative plan set

1. Capture `/research` for blank browse, keyword, short alias, semantic phrase, department filter, research-area filter, deep allowed page, and an operator low-quality request.
2. Capture `/research/:slug` for a typical entity and an aggregate-selected high-fan-out entity without disclosing either slug.
3. Capture `/opportunities/:id` for one ordinary visible record and the record with the largest aggregate evidence-ID count.
4. Capture account planning for a synthetic or approved test account with zero saves, typical saves, and near-limit saves, including the completed-migration and compatibility-migration states.
5. Capture admin access-review for default unreviewed sort, official-application sort, updated sort, a non-empty search, `hasUnreviewed=false`, and a high-fan-out detail entity.

### MongoDB evidence fields

For every distinct `find`, `distinct`, `countDocuments`, and aggregation shape above, retain `explain("executionStats")` fields for the winning plan, rejected plans, index names, keys examined, documents examined, rows returned, execution time, sort stages, disk use, and lookup subplans when the server exposes them.
Retain query-shape hashes or redacted labels so repeated plans can be compared without preserving identifiers.
Flag any collection scan, keys-to-results or documents-to-results amplification above the reviewed threshold, blocking sort, disk spill, or fan-out that grows with total collection size.

### End-to-end evidence fields

For Meilisearch requests, retain `processingTimeMs`, hit counts, estimated totals, request mode, retry or degradation state, and the resolved index prefix.
For each HTTP surface, retain server-side query count plus p50 and p95 latency over a reviewed representative sample.
For account planning, separately retain the number of writes triggered by dashboard `GET` requests and compatibility-claim retries.
For admin access-review, separately retain projection-page and parent-hydration latency, each of the eight progress-count latencies, and any sort spill.
For `/research/:slug`, separately retain per-collection returned counts so bounded direct sections are distinguishable from unbounded access-summary and planning-context reads.

## Phase 0 disposition

Source inspection is complete for these five surfaces.
The repeatable private ResearchEntity search-baseline tooling and protected Beta and ProductionCopy launchers are implemented, but reviewed Development, Beta, and ProductionCopy artifacts are still required.
The repeatable private MongoDB query-cost tooling is implemented, but reviewed Development, Beta, and ProductionCopy artifacts are still required.
The highest-priority live checks are the full-scan `/research` fallbacks, missing scholarly-link and attribution indexes, account planning's concurrent mutation-capable reads, fellowship all-record matching, and admin access-review's projection indexes and unbounded detail.
No later migration phase should remove compatibility fields or redirect these readers until the live evidence is reviewed and an owner accepts the resulting index and cutover work.
