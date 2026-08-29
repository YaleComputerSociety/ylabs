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
Its settings also include curated synonyms and typo guards for short aliases such as `ai`, `ml`, `nlp`, and `cv`, so rebuild or sync the index after changing alias or relevance settings.
The index sets `pagination.maxTotalHits` (see `RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS`) well above the Meilisearch default of 1,000 so the full student-visible directory stays reachable through browse and infinite scroll; the default cap would silently truncate the reachable set and the reported total.
It likewise sets `faceting.maxValuesPerFacet` (see `RESEARCH_ENTITY_SEARCH_MAX_VALUES_PER_FACET`) well above the Meilisearch default of 100 so long-tail department facet values stay selectable instead of being silently dropped.
Short-alias queries restrict `attributesToSearchOn` to topic fields that actually exist in `searchableAttributes`; a missing attribute now degrades in place on the Meili path instead of falling back to the slow Mongo scan.

## Data commands

| Command                                                 | Effect                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| `yarn --cwd server meili:rebuild-research-entities`     | Rebuild the ResearchEntity index.                                    |
| `yarn --cwd server reindex:meili`                       | Guarded post-copy rebuild for beta/production; verifies `SCRAPER_ENV`, `MEILISEARCH_HOST`, non-empty `MEILISEARCH_INDEX_PREFIX`, and a matching Mongo database with non-archived documents before clearing; dry-run default, apply requires `--confirm`. |
| `yarn --cwd server model-refactor:inventory --environment <env>` | Inventory refactor-relevant MongoDB state without writes. |
| `yarn --cwd server research-entity:migrate`             | Run the ResearchEntity physical migration.                           |
| `yarn --cwd server research-homes:backfill-browse-rank` | Recompute `browseRankScore`; apply requires `--confirm-browse-rank`. |
| `yarn --cwd server research-homes:backfill-org-units` | Re-canonicalize `school`/`departments[]` (drops administrative units, denoises HR-coded values); apply requires `--confirm-org-units`, then rebuild Meili. |
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

## Data shape rules

- Prefer first-class collections for access signals and other product-model records.
- If a schema change affects Research search, update the relevant index config and rebuild path.
- Add a backfill script in `server/src/scripts/` when existing data needs transformation.
- Migration scripts run with `npx tsx --transpile-only <script>.ts`.
- Verify index settings and sortable/filterable attributes when adding fields used for search, filtering, or ordering.
