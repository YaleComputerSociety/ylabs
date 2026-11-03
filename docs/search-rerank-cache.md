# Search rerank cache

The search rerank cache reorders the top results of a research text search by relevance scores produced offline, one entry per past query (#5448).
No model is called at query time.
The measurement that motivated it, and the decision to score in an agent session rather than through a per-search model API, are recorded on #5448.

## What it stores

`search_rerank_cache` (`server/src/models/searchRerankCache.ts`) holds one document per query key.
The key is `searchRerankCacheQueryKey(query, filters)` in `server/src/services/researchGroupService.ts`.
It reads the typed query the way search tokenizes it (lowercased, diacritics folded, punctuation and filler words dropped, whitespace collapsed), before spelling correction, so an entry for a logged query matches that query exactly as a student typed it.
It adds only the student-chosen filters (`kind`, `entityType`, `school`, `departments`, `researchAreas`, `hostsUndergrads`, `welcomesUndergrads`), in a fixed key order with each list sorted and lowercased, so the same choice made in any order is one entry.
The visibility tier is an operator scope and never splits an entry.

Each document carries `queryText`, the stored `filters`, `scores` as `[{ entityId, score }]` with `entityId` the string form of the research entity `_id` and `score` from 0 to 3, `scoredAt`, `indexVersion` (a free-form corpus or index marker the seeder supplies), and `source`.

## How search reads it

The serve path is off unless `SEARCH_RERANK_CACHE_ENABLED=true`, and with the flag unset search does not read the collection at all.
With the flag on, a non-empty text query whose candidate pool is paginated locally (a hybrid query with no explicit sort) looks up its key once, through an in-process memo of five minutes, so the pages of one search cost one read.
After the keyword and semantic legs are fused and the student filters narrow the pool, `applyCachedRerank` reorders the first 30 rows by cached score, highest first, with the fused order as the tiebreak.
A row the entry does not score takes the neutral score 1.5, and every row after the first 30 keeps its place.
The reorder runs before the page is sliced, so every page of one search reads the same order, and the total and the facet counts are unchanged.

These searches are served exactly as without the flag:

- A query with no entry, and a failed or slow cache read (the read is capped at 500 ms and a failure is not remembered).
- A name query, detected by the same `keywordLegTopHitIsNameMatch` check that withholds semantic-only rows, because a name search already ranks the right row first.
- A browse with no query, a search with an explicit sort, and a search Meilisearch pages itself (no configured embedder, the semantic leg unaffordable, or a whole-query shorthand searched keyword-only on topic fields).

## Seeding

`yarn --cwd server research-search:seed-rerank-cache --input=<path>` reads a JSON file of `[{ "query": "...", "filters": { ... }, "scores": { "<slug>": <0-3> } }]`.
The file must sit outside the repository, and the script refuses one inside it.
It resolves each slug to a live research row, keys each entry with `searchRerankCacheQueryKey`, and refuses two entries that share a key.
A dry run is the default and prints counts only: entries, scores, resolved scores, unresolved slugs, and entries left with no resolved score.
It never prints a query or a slug.
An apply needs `--apply --confirm-search-rerank-cache-seed --index-version=<marker>` and upserts one document per key, replacing that key's scores.
It writes Development, and refuses any other database, unless `--environment=beta` or `--environment=production` names the target, which then reads `BETA_MONGODBURL` or `PRODUCTION_MONGODBURL`; Production still needs `SCRAPER_ENV=production` and `CONFIRM_PROD_SCRAPE=true`.
`--source=<label>` records where the scores came from and defaults to `offline-scoring`.

## Environments and privacy

The cache is environment-local: it is in `NEVER_COPY_COLLECTIONS` and in the collections a Development refresh preserves (`server/src/scripts/mirrorCollectionPolicy.ts`).
Each environment is seeded separately, because its scores name that environment's row ids.
It is never committed to the repository, because it pairs real student queries with research profiles.

## Staleness

An entry records the `indexVersion` it was scored against.
Re-seed after a corpus-wide change, including the final description batch, because a stale entry scores rows as they were.
A stale entry can only reorder rows search already returned in its top 30: it never adds a row, hides a row, or changes a total.
A row that has since left the top 30 is simply not reordered, and a new row in the top 30 takes the neutral score.

## Coverage

A fixed cache covers past queries only.
A new query falls back to the fused order.
