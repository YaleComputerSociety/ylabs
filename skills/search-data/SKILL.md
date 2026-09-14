---
name: search-data
description: Use when working on MongoDB data behavior, Meilisearch indexing, ResearchEntity search, browse ranking, search rebuild scripts, data migrations, search-related environment variables, or default /research ordering.
---

# Search and Data

MongoDB uses Mongoose 8.
All environments use `MONGODBURL`; the connection string determines whether the app uses Development, Beta, or Production.
There is a single application connection: the `API_MODE=productionMigration` dual-DB path was removed with the Listing analytics lane, since the retired `listings` collection was its only reader.

Search runs on Meilisearch.
The old client-side `embeddingService.ts` path was removed.
Do not reintroduce client-side embedding calls for Research search.
Research search normalizes student queries in `researchGroupService.searchResearchGroupsViaMeili`.
It strips low-value words such as `professor`, `lab`, and `research` when meaningful terms remain, expands curated aliases for `ai`, `ml`, `nlp`, `cv`, `neuro`, and `psych`, and treats short alias queries as keyword-only searches over topic-oriented fields.

## Meilisearch indexes

| Index              | Service                               | Purpose                                                                           |
| ------------------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| `researchentities` | `researchEntitySearchIndexService.ts` | Yale Labs / Research search on `/research`; drives browse and discovery.           |

The Meilisearch client lives in `server/src/utils/meiliClient.ts`.
It lazy-loads and caches the connection.
Use `getMeiliIndex(name)` and `resolveIndexName(name)`.

Relevant config:

| Variable                   | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `MEILISEARCH_HOST`         | Defaults to `http://localhost:7700`.                       |
| `MEILISEARCH_API_KEY`      | Meilisearch API key.                                       |
| `MEILISEARCH_INDEX_PREFIX` | Optional environment prefix, e.g. `beta_researchentities`. |
| `OPENAI_API_KEY`           | Used by Meilisearch embedder config and LLM extractors.    |

Documents sync via `meiliSyncService.ts` after upserts.
`researchEntity` is the only syncable type; the legacy `listings` and `papers` indexes are retired.
After copying Mongo data into Beta or Prod, run `reindex:meili` inside that Render service to rebuild the prefixed `researchentities` index and delete any retired prefixed indexes.
Rebuild scripts do full repopulation.
The `researchentities` index prioritizes name, professor, research-area, and `studentSearchTerms` attributes before summary or description text.
`departments` is both searchable and filterable, so it is the browse department facet and only carries values that resolve to a canonical `DEPARTMENT`/`DIVISION` `OrgUnit`; the org names a source listed beside an appointment but that are not departments (centers, hospital systems, program tracks, societies) live in `orgAffiliationLabels`, which is searchable and deliberately **not** filterable so they stay findable without becoming facet values (#2194).
Its settings also include curated synonyms and typo guards for short aliases such as `ai`, `ml`, `nlp`, and `cv`, so rebuild or sync the index after changing alias or relevance settings.
The index sets `pagination.maxTotalHits` (see `RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS`) well above the Meilisearch default of 1,000 so the full student-visible directory stays reachable through browse and infinite scroll; the default cap would silently truncate the reachable set and the reported total.
Reachable pagination depth has a second, tighter ceiling: `RESEARCH_SEARCH_MAX_REACHABLE_RECORDS` in `server/src/services/researchSearchPagination.ts` bounds how deep browse and infinite scroll can page, in records rather than page number, so the reachable page number falls out of the requested page size.
A request past that depth is answered with an empty page flagged `depthLimited: true` rather than a clamp to the last reachable page, so a paging client terminates instead of re-appending the same rows; raise the constant when the served corpus approaches it, or deep browsing truncates silently.
That depth-limited page runs no search, so it reports no `estimatedTotalHits` at all instead of inventing one, and the client leaves the total it is already displaying untouched.
Facets are sent once per result set: page 1 (or an explicit `includeFacets: true`) includes `facetDistribution`, later pages omit the key entirely and skip the facet queries, and an absent key means "unchanged" to the client rather than "no facet values".
Because absence carries that meaning, every search path that was asked for facets must return the key, including the paths that run no Meilisearch query at all (unsearchable query, low-quality-first browse), which return an empty distribution.
It likewise sets `faceting.maxValuesPerFacet` (see `RESEARCH_ENTITY_SEARCH_MAX_VALUES_PER_FACET`) well above the Meilisearch default of 100 so long-tail department facet values stay selectable instead of being silently dropped.
Short-alias queries restrict `attributesToSearchOn` to topic fields that actually exist in `searchableAttributes`; a missing attribute now degrades in place on the Meili path instead of falling back to the slow Mongo scan.

## Data commands

| Command                                                 | Effect                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| `yarn --cwd server meili:rebuild-research-entities`     | Rebuild the ResearchEntity index.                                    |
| `yarn --cwd server research-search:relevance`           | Read-only: measure served search relevance and typo robustness against Development. See "Measuring search quality" below. |
| `yarn --cwd server reindex:meili`                       | Guarded post-copy rebuild for beta/production; verifies `SCRAPER_ENV`, `MEILISEARCH_HOST`, non-empty `MEILISEARCH_INDEX_PREFIX`, and a matching Mongo database with non-archived documents before clearing; dry-run default, apply requires `--confirm`. |
| `yarn --cwd server model-refactor:inventory --environment <env>` | Inventory refactor-relevant MongoDB state without writes. |
| `yarn --cwd server research-entity:migrate`             | Run the ResearchEntity physical migration.                           |
| `yarn --cwd server research-homes:backfill-browse-rank` | Recompute `browseRankScore`; apply requires `--confirm-browse-rank`. |
| `yarn --cwd server research-homes:backfill-org-units` | Re-canonicalize `school`/`departments[]` and rewrite `orgAffiliationLabels[]` (drops administrative units, denoises HR-coded values); apply requires `--confirm-org-units`, then rebuild Meili. |
| `yarn --cwd server org-units:seed-catalog-gaps` | Idempotently close the `org_units` department/alias gaps the curated roster map asserts, and adopt the names Yale's official department index publishes; apply requires `--confirm-org-unit-seed`, then run the org-unit backfill and rebuild Meili. |
| `yarn --cwd server departments:align-display-catalog` | Apply the same official names to the `departments` display table (label, colour, abbreviation, and the strings `research.tsx` uses as department search-target filters), add a display row for an index entry that has none, and drop comma-split alias fragments; apply requires `--confirm-department-display`. Run it whenever the org-unit renames run; it writes the served config, so no Meili rebuild. |
| `yarn --cwd server org-units:department-facet-audit` | Read-only: rank canonical department facet values and the uncataloged labels sources presented as departments, by served-row count. |
| `yarn --cwd server research-homes:backfill-school-host-mismatch` | Correct a stale `school` when a disjoint school (Law, Divinity, Drama, Music, Architecture, Art) sits on a `medicine.yale.edu`/`ysph.yale.edu` host with biomedical content on record (#1093); dry-run default, apply requires `--apply --confirm` and is blocked against production unless `CONFIRM_PROD_SCRAPE=true`, resyncs Meili for changed docs. |
| `yarn --cwd server research-entity:backfill-person-name-casing` | Heal raw ALL-CAPS `researchers.displayName` via `canonicalPersonName` (Development-gated, dry-run default); apply requires `--apply --confirm-person-name-casing --limit=N`, no Meili rebuild needed. |

## Default `/research` ordering

With no query, `/research` sorts by `browseRankScore:desc` then `lastObservedAt:desc`.
The path is `researchGroupService.searchResearchGroupsViaMeili`.

`browseRankScore` is precomputed on the ResearchEntity document and mirrored to Meilisearch as a sortable attribute.
The scorer lives in `researchEntityBrowseRank.ts`.
The join, persist, and resync logic lives in `researchEntityBrowseRankService.ts`.

The scorer rewards completeness plus strength-weighted undergrad access signals.
Strong `CURRENT_UNDERGRADS` and `PAST_UNDERGRADS` signals outweigh the `REACH_OUT_PLAUSIBLE` fallback.
`NOT_CURRENTLY_AVAILABLE` is negative.

`entityMaterializer` recomputes ranking live after access signals are derived.
Admin "weakest profiles first" with `browseQuality: 'low-first'` is a separate Mongo-side path.

## Measuring search quality

`yarn --cwd server research-search:relevance` is the instrument for "is search any good", and it is read-only.
Before it existed, the only search measurement in the repository was `phase0ResearchSearchBaseline`, which captures latency and result-set *stability* and says nothing about whether the returned rows are the right rows.
Do not answer a relevance question with a throwaway script when this harness already reports the number.

It reports two metric families per case.

**Predicate precision@k** counts how many of the top k hits carry a topical marker for the query.
This is a lexical proxy and a regression detector, not a relevance oracle: it catches gross retrieval failure, and it cannot judge ordering quality among rows that all match.
Do not tune ranking to maximize it.

**Perturbation invariance** re-runs each query with one deterministic single-character edit (transposition, deletion, doubling, keyboard-neighbour substitution) plus an all-caps variant, and reports average overlap at depth k between the clean and perturbed result sets, along with whether the top hit survived.
Average overlap is the `p -> 1` limit of rank-biased overlap, chosen because it needs no persistence parameter, so a reported number cannot be argued away by retuning `p`.
This family needs no relevance labels at all, which is why it exists: it measures typo handling directly.

A query whose longest token is shorter than `minWordSizeForTypos.oneTypo` is *skipped* rather than failed, because Meilisearch grants it no typo tolerance by design.
That is why the short-alias cases report skipped perturbations instead of zeros.

The case file `researchSearchRelevanceCases.ts` stores a query and topical markers only.
It must never store expected-result slugs.
This repository is public and a faculty entity slug is person-bearing, so a committed file pairing one with a relevance judgement is the pairing `docs/person-identifier-convention.md` forbids.
Person-name coverage comes from surnames the CLI samples from the index at run time, and those cases report a `queryShape` such as `token(len=7)` instead of the query.

The harness is confined to a local Development target.
A full sweep issues roughly one hybrid query per case per perturbation, and each hybrid query costs an embedder call, so pointing it at Beta or Production would load student-facing search in order to measure it.

### Baseline on Development, 2026-09-14

At `semanticRatio: 0.8` with the `default` embedder configured, over 16 committed cases plus 4 sampled name cases at `--top-k 10`:

| Metric | Value |
| ------ | ----- |
| mean precision@10 | 0.933 |
| mean reciprocal rank | 0.95 |
| mean average overlap, all perturbations | 0.379 |
| mean average overlap, casing only | 0.84 |
| mean average overlap, transposition / deletion / doubling / substitution | 0.237 / 0.276 / 0.256 / 0.288 |

Read that as: **a correctly spelled query is answered well, and a single typo usually destroys the result set.**
The top hit survived a typo in roughly one case in five.
Casing is close to harmless, as expected, since Meilisearch normalizes case and only the embedder input changes.

The likely cause is that every layer upstream of Meilisearch matches exactly.
In `normalizeResearchSearchQuery`, `STUDENT_QUERY_STOP_WORDS.has(token)`, `STUDENT_QUERY_ALIASES[token]`, and `resolveTopicAliasExpansion` are all exact key lookups, and the Meili `synonyms` map is exact-term keyed, so a misspelled topic term receives neither alias nor synonym expansion and survives only on Meilisearch's own fuzzy match over raw tokens.
`rankingRules` compounds it by placing `typo` below `proximity` and `exactness`, so a correctly spelled weak match outranks a typo-corrected strong match.

Changing `semanticRatio`, the ranking rules, `minWordSizeForTypos`, or adding fuzzy alias resolution are the candidate fixes.
Re-run the harness before and after any of them, and move the overlap number rather than arguing about the mechanism.

## Data shape rules

- Prefer first-class collections for access signals and other product-model records.
- If a schema change affects Research search, update the relevant index config and rebuild path.
- Add a backfill script in `server/src/scripts/` when existing data needs transformation.
- Migration scripts run with `npx tsx --transpile-only <script>.ts`.
- Verify index settings and sortable/filterable attributes when adding fields used for search, filtering, or ordering.
