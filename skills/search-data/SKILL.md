---
name: search-data
description: Use when working on MongoDB data behavior, Meilisearch indexing, ResearchEntity search, pathway search, browse ranking, search rebuild scripts, data migrations, search-related environment variables, or default /research ordering.
---

# Search and Data

MongoDB uses Mongoose 8.
All environments use `MONGODBURL`; the connection string determines whether the app uses Development, Beta, or Production.
`API_MODE=productionMigration` enables a secondary `MONGODBURL_MIGRATION` connection for dual-DB migrations.

Search runs on Meilisearch.
The old client-side `embeddingService.ts` path was removed.
Do not reintroduce client-side embedding calls for Research search.

## Meilisearch indexes

| Index              | Service                               | Purpose                                                                           |
| ------------------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| `researchentities` | `researchEntitySearchIndexService.ts` | Yale Labs / Research search on `/research`.                                       |
| `pathways`         | `pathwaySearchIndexService.ts`        | Internal ways-in enrichment, saved planning, parity testing, and admin workflows. |

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
Rebuild scripts do full repopulation.

## Rebuild commands

| Command                                                                            | Effect                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `yarn --cwd server meili:rebuild-research-entities`                                | Rebuild the ResearchEntity index.                                            |
| `yarn --cwd server meili:rebuild-pathways`                                         | Rebuild the Pathway index.                                                   |
| `npm --prefix data-migration run migrate:meilisearch`                              | Dry-run validation for the legacy `listings` Meilisearch index payload only. |
| `npm --prefix data-migration run migrate:meilisearch:execute -- --target <target>` | Execute the legacy `listings` Meilisearch refresh after target validation.   |
| `yarn --cwd server research-entity:migrate`                                        | Run the ResearchEntity physical migration.                                   |
| `yarn --cwd server research-homes:backfill-browse-rank`                            | Recompute `browseRankScore`; apply requires `--confirm-browse-rank`.         |

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

- Prefer first-class collections for pathways, opportunities, access signals, and contact routes.
- If a schema change affects Research or Pathways search, update the relevant index config and rebuild path.
- Add a migration script in `data-migration/` when existing data needs transformation.
- Prefer `data-migration/package.json` scripts over raw `tsx` commands when present.
- Guarded data-migration scripts default to dry-run, accept `--summary ./tmp/<name>.json` or a system-temp JSON path, and require `--execute --target local|test|dev|beta|prod` before writes.
- Execute mode validates the target against the resolved MongoDB database and, for Meilisearch writes, the index prefix.
- Verify index settings and sortable/filterable attributes when adding fields used for search, filtering, or ordering.
