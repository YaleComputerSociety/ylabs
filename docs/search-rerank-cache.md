# Search rerank cache

The search rerank cache reorders the top results of a research text search by relevance scores produced offline, one entry per past query (#5448).
No model is called while a search is answered; the optional live-miss job below scores a missed query in the background.
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
A new query falls back to the fused order, unless the live-miss job below is on, which scores it for the next search.

## Live-miss job (#5549)

A text search whose key has no entry can score itself in the background, so the next search for that key, by anyone, is a hit.
The request never waits for the model: the search is served in today's fused order and one in-process job is queued for the key.
It is off by default and has its own switch, independent of `SEARCH_RERANK_CACHE_ENABLED`.

### Flags

| Variable | Default | Effect |
| --- | --- | --- |
| `SEARCH_RERANK_LIVE_MISS_ENABLED` | unset (off) | Only `true` queues jobs and serves `live-miss` entries. Unset, search queues nothing and serves no `live-miss` entry, so turning it off withdraws what the job wrote; seeded entries are still served as the serve flag decides. |
| `SEARCH_RERANK_LIVE_MISS_MODE` | `shadow` | `shadow` writes entries with `source: 'shadow'`, which search never serves. Only `serve` writes `source: 'live-miss'`, which search serves when both `SEARCH_RERANK_CACHE_ENABLED=true` and `SEARCH_RERANK_LIVE_MISS_ENABLED=true`. |
| `SEARCH_RERANK_CACHE_COLLECTION` | `search_rerank_cache` | The collection the serve path, the seeder and the job all use. Only `search_rerank_cache` or `search_rerank_cache_<suffix>` is accepted; anything else fails at startup. A bench names its own, so it never reads or writes the environment's cache. |

With the job on and the serve flag off, search reads the entry only to learn whether it is a miss, and never reorders by it.
A shadow entry is never served under either flag, so a shadow week can run with the serve flag on or off.

### What queues a job

A job is queued only for a search the cache would serve today: a non-empty text query whose pool is paginated locally, with no explicit sort, from a request that reached the search route.
The served result decides the rest (`rerankLiveMissGate` in `searchResearchGroupsForQuery`), reusing the predicates search already has rather than a new lexical rule:

- a name query (`keywordLegTopHitIsNameMatch`) is never queued;
- a name-shaped query is never queued: the best keyword hit matched the query inside a lead, professor or member name, typo or prefix included, or in a row title that no topic field also matches (`keywordLegTopHitTouchesAPersonName`), which is looser than the serving name guard because skipping the job costs only its gain (#5549, where name-shaped queries whose person no row names were the largest losses);
- a query under 4 letters once normalized, such as a two-letter acronym, is never queued;
- a query whose normalized tokens are empty (`normalizeResearchSearchQuery`) is never queued;
- a query whose keyword leg served no row (`servesNoKeywordRow`) is never queued, which is the nonsense-query case;
- a pool with fewer than 2 candidates is never queued;
- a query over 100 characters or 10 words is never queued.

A request the rate limiter refused never reaches search, and a search whose semantic leg the embedding budget declined is paged by Meilisearch, so neither queues a job.
An in-process caller (`journey:eval`, the relevance scripts) passes no request client and never queues one.

An existing entry decides too.
A seeded entry, one whose `indexVersion` starts with `full-`, is never replaced.
A served entry is never replaced either, so a key is scored at most once.
Shadow mode fills only a missing entry, and serve mode fills a missing entry or replaces a shadow one.

### Limits

All of these are in-process, so they hold per server instance; the web service runs one instance.

- The queue holds 500 pending jobs and drops the oldest first.
- One job runs at a time, and a key already pending or running is not queued again, so ten searches for one new query cost one call.
- One address (`getPeerIpKey`) queues at most 20 jobs per hour, and one session (`getRateLimitKey`: the netid, else the cookie's anonymous id) at most 60 per UTC day.
  The anonymous id lives in the caller's cookie, so the address cap is the real bound for a caller who discards cookies.
  Over a cap the search is served normally and nothing is queued.
- Before each model call the job reads today's spend for its caller from `model_call_usages` (UTC day, priced by `modelPricing.ts`).
  At USD 1.00 the queue drops what is pending and queues nothing until the next UTC day.
  The ceiling counts this caller's spend only, not every caller's, so a scraper or description run that spends on the same day never stops the job.
  The check runs before each call against the spend recorded so far, and usage records are written without waiting, so the last call of the day can take the total past USD 1.00 by about one call's cost.
- A key whose job ends ineligible, with a failed model call, with a reply below the scoring bar, or with an error is not queued again until the next UTC day, so a query the model keeps failing costs one call a day rather than one per student who searches it.
  An unreadable log, or no database connection, skips the call rather than spending blind.

### The job

`runSearchRerankLiveMissJob` in `server/src/services/searchRerankLiveMissJob.ts` re-runs the same search for the key through `searchResearchGroupsForRerankCandidates`, public visibility scope, spelling correction and filter resolution as the route applies them, and no cached reorder.
It sends the top 30 to `gpt-5-mini` through the shared model client under caller `search-rerank-live-miss`, with the prompt in `server/src/scrapers/prompts/searchRerankLiveMiss.md` (the rerank prompt measured in the #5549 cost pilot).
The reply must give at least 27 of every 30 candidates (all but a tenth, rounded down) an integer score from 0 to 3; ids outside the candidate window and non-integer ids are ignored, and a reply below that bar writes nothing.
Only the scored candidates are stored, and an unscored candidate reads as the neutral 1.5 on the serve path, as any unscored row does.
The bar is measured: a strict every-candidate rule threw away 61 of 320 real answers in the review pilot, 46 of them for missing one id of 30 (#5549).
The entry is upserted with `source` `live-miss` or `shadow` and `indexVersion` `async-gpt-5-mini-<YYYY-MM-DD>`, and the upsert filter excludes a `full-` entry, so a seeded entry that lands while the model is scoring still wins.
Every outcome is logged as `[search-rerank-live-miss] job <status>`, never with the query text.

### Running it on a bench

The job is exported so a bench can run search, then the job, then search, with no timing race:

```ts
runSearchRerankLiveMissJob(
  { query, filters },
  { mode?: 'shadow' | 'serve', now?, model?, readSpendTodayUsd? },
): Promise<{ status, entry? }>
```

It returns the entry it scored and writes it to the configured collection.
Set `SEARCH_RERANK_CACHE_COLLECTION=search_rerank_cache_<bench>` before the server code is imported, so the bench never touches the environment's `search_rerank_cache`.
`setSearchRerankLiveMissRunner` in `searchRerankLiveMiss.ts` replaces the queued runner, and `searchRerankLiveMissIdle` resolves once the queue is empty.
Spend is read from `model_call_usages` for caller `search-rerank-live-miss`, so `yarn --cwd server model-usage:report` shows a bench's calls under that name.
