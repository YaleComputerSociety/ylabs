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
It strips low-value words such as `professor`, `lab`, and `research` when meaningful terms remain, expands curated aliases for `ai`, `ml`, `nlp`, `cv`, `neuro`, and `psych`, and treats an alias query whose expansion still carries the typed shorthand as a keyword-only search over topic-oriented fields.
Filler stripping is decided per token by `isStudentQueryFiller`, not by a flat word list, because a question-frame verb and a real field name can be the same word: `studies`, `work`, and `working` name fields the corpus carries (192 `researchAreas` and 11 `departments` contain "studies"; also "Sex Work" and "Working Memory"), so `work` and `working` are dropped only where they govern a preposition (currently `on` or `with`, per `QUESTION_FRAME_VERB_PREPOSITIONS`) and `studies` is never dropped.
Adding such a word to `STUDENT_QUERY_STOP_WORDS` silently narrows every query that names the field to its remaining tokens; the regression tests for both directions live in `researchGroupService.test.ts`.
Department shorthands resolve through the `department` clusters in `searchTopicAliases.ts`, which expand to the canonical term and drop the shorthand itself, so a query-only abbreviation no document carries (`orgo`, `ochem`) belongs there rather than in a `topical` cluster and stays out of the corpus-side Meili synonyms.
Dropping the shorthand is what decides how widely the query then searches, so the cluster kind is a retrieval decision and not only a vocabulary one: see "An alias query is only as narrow as its own shorthand" below.

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
An alias query that keeps its shorthand restricts `attributesToSearchOn` to topic fields that actually exist in `searchableAttributes`; a missing attribute now degrades in place on the Meili path instead of falling back to the slow Mongo scan.

### An alias query is only as narrow as its own shorthand (#2733)

`TOPIC_ALIAS_QUERY_ATTRIBUTES` exists because a two-letter alias matching inside prose returns noise: `ml` is also millilitres and `cv` is also a curriculum vitae, which is why `freeTextGuarded` and the `disableOnWords` typo guard exist.
That reasoning holds only while the alias itself is still part of the query text, and the two cluster kinds differ exactly there.
A `topical` expansion keeps the shorthand (`ai` searches `artificial intelligence machine learning deep learning ai`), so it stays restricted to topic fields and keyword-only.
A `department` expansion replaces the shorthand with canonical vocabulary (`orgo` searches `organic chemistry`), so it is the phrase the student meant and takes the same path the typed phrase takes: every searchable attribute, the hybrid embedder, and `matchingStrategy: 'all'` when the expansion is a single canonical term.
`normalizeResearchSearchQuery` reports both facts as `aliasExpansionKeepsShorthand` and `aliasExpandsToSingleCanonicalPhrase`; read those rather than `isTopicAliasQuery` when deciding retrieval breadth.
A `department` cluster whose canonical term is a short common word would therefore search prose, so keep canonical terms specific.

Measured through `POST /api/research/search` on Development, reachable rows before and after: `orgo` 13 to 73, `ochem` 13 to 73, `econ` 176 to 205, `bio` 389 to 532, `math` 47 to 107, `cs` 111 to 130, each now equal to its typed expansion.
A canonical name that contains a filler word (`ecology and evolutionary biology`, `molecular cellular and developmental biology`) still reaches more rows than the typed phrase, because the typed path drops `and` as filler and the expansion does not, so the two texts embed differently.

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
| `yarn --cwd server departments:align-display-catalog` | Apply the same official names to the `departments` display table (label, colour, abbreviation, and the strings `research.tsx` uses as department search-target filters), add a display row for a served department that has none (an index-cited name is spell-checked against `departments.txt`, a `served-facet` name against the student-facing department facet at run time), and drop aliases the row should not own; apply requires `--confirm-department-display`. Run it whenever the org-unit renames run; it writes the served config, so no Meili rebuild. |
| `yarn --cwd server org-units:department-facet-audit` | Read-only: rank canonical department facet values and the uncataloged labels sources presented as departments, by served-row count. |
| `yarn --cwd server research-homes:backfill-school-host-mismatch` | Correct a stale `school` when a disjoint school (Law, Divinity, Drama, Music, Architecture, Art) sits on a `medicine.yale.edu`/`ysph.yale.edu` host with biomedical content on record (#1093); dry-run default, apply requires `--apply --confirm` and is blocked against production unless `CONFIRM_PROD_SCRAPE=true`, resyncs Meili for changed docs. |
| `yarn --cwd server researchers:repair-person-name-noise` | Strip scraped furniture from `researchers.displayName` (image-caption wrapper, trailing post-nominal credential run, former-name annotation, shouty casing) and re-gate the entities the repaired people lead (Development-gated, dry-run default); apply requires `--apply --confirm-repair-person-name-noise`, and `--limit=N` caps how many rewrites one run may write. Person names ARE indexed, as `leadProfessorNames` and `professorNames`, so a repaired name reaches search only after `meili:rebuild-research-entities`. |

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
The marker is read from each hit's index document rather than from the served card, because the list DTO trims `fullDescription` and never carries `orgAffiliationLabels`, `studentSearchTerms`, `leadProfessorNames`, or `professorNames`, all of which are `searchableAttributes` Meilisearch may have matched on.
Judging a hit on the card alone would score a correct match irrelevant, which is worst for the sampled person-name cases whose evidence is usually a roster name field.
The report counts any hit whose slug had no index document in `unresolvedIndexDocuments`, so a gap in that resolution is visible rather than silently scored as irrelevant.

**Perturbation invariance** re-runs each query with one deterministic single-character edit (transposition, deletion, doubling, keyboard-neighbour substitution) plus an all-caps variant, and reports average overlap at depth k between the clean and perturbed result sets, along with whether the top hit survived.
Average overlap is the `p -> 1` limit of rank-biased overlap, chosen because it needs no persistence parameter, so a reported number cannot be argued away by retuning `p`.
Averaging stops at the longer of the two result lists rather than at the requested depth, so a query that legitimately returns two rows and still returns the same two rows scores 1 instead of 0.486.
A perturbed list that lost rows is still penalized, because the longer clean list sets the averaging depth.
This family needs no relevance labels at all, which is why it exists: it measures typo handling directly.

A case may also declare `realMisspellings`, which are compared the same way and reported under the `real-misspelling` kind.
Declare them rather than relying on the synthetic kinds alone: a real error is often phonetic, or a doubled or omitted letter at a position the deterministic mid-word edit never picks, and before #2732 real misspellings scored *worse* than every synthetic kind (0.275 against 0.32 to 0.35).
"The keyword leg runs as its own query" below owns where that number sits now.
Two of them, `immunolgy` and `epidemialogy`, were returning zero rows in common with their correctly spelled form and no synthetic perturbation surfaced that.
Because a case may declare several of them, a `typo-collapse` finding carries the `perturbedQuery` that collapsed, and it is omitted for a redacted person-name case exactly as it is on the case result.
`suite.perturbationKinds` is derived from the kinds the run actually attempted rather than from the synthetic kind list, so read it before comparing a headline `meanAverageOverlap` across two runs: adding a kind changes the population that mean averages over.

Read `jaccard` alongside `averageOverlap` when judging a retrieval change.
`averageOverlap` is order-sensitive, so a change that recovers the right rows but reorders them can look flat or negative; `jaccard` shows the set-level movement.
Both are per-perturbation in the report.

Each report also carries `sourceCommit`, `sourceWorktreeDirty`, and an `indexConfiguration` block with the settings fingerprint, `rankingRules`, `minWordSizeForTypos`, the synonym term count, and the configured embedders.
Compare two runs on those fields first; a number measured under different index settings is not a comparison.

A query whose longest token is shorter than `minWordSizeForTypos.oneTypo` is *skipped* rather than failed, because Meilisearch grants it no typo tolerance by design.
That is why the short-alias cases report skipped perturbations instead of zeros.

The case file `researchSearchRelevanceCases.ts` stores a query, topical markers, and optional `realMisspellings` only.
It must never store expected-result slugs.
This repository is public and a faculty entity slug is person-bearing, so a committed file pairing one with a relevance judgement is the pairing `docs/person-identifier-convention.md` forbids.
Person-name coverage comes from surnames the CLI samples from the index at run time, and those cases report a `queryShape` such as `token(len=7)` instead of the query.

The harness is confined to a local Development target.
A full sweep issues roughly one hybrid query per case per perturbation, and each hybrid query costs an embedder call, so pointing it at Beta or Production would load student-facing search in order to measure it.

### Baseline on Development, 2026-09-14, synthetic kinds only

This measurement predates `realMisspellings` and the `topic-epidemiology` case, so every figure in this section covers the five synthetic kinds over 16 committed cases and there is no `real-misspelling` row.
The suite now runs 19 committed cases and reports a sixth kind, so re-run the harness rather than comparing a current number against anything below.
Two of those cases, `short-alias-orgo` and `short-alias-eeb`, cover the department-shorthand path #2733 widened, because the suite had no case for it and so could not have caught the narrowing.

Measured on 4,904 indexed documents at `--top-k 10`, over 16 committed cases plus 3 resolved sampled name cases, with `semanticRatio: 0.8` and the `default` embedder configured.
Index settings fingerprint `a4e0fd501dd8`, `rankingRules` `words > proximity > exactness > typo > attribute > sort`, 76 synonym terms.

| Metric | Value |
| ------ | ----- |
| mean precision@10 | 1.0 |
| mean reciprocal rank | 0.947 |
| mean average overlap, all perturbations | 0.457 |
| mean average overlap, casing only | 1.0 |
| mean average overlap, transposition / deletion / doubling / substitution | 0.296 / 0.331 / 0.325 / 0.330 |
| perturbations compared / skipped | 75 / 15 |
| zero-result cases | 1 (`semantic-phrase-wet-lab-beginner`, see #2715) |

Read that as: **a correctly spelled query is answered essentially perfectly, and a single typo costs about two thirds of the result set.**
The top hit survived a typo in 1 of the 5 synthetic perturbations for most cases.
Casing scores exactly 1.0, which is both the expected result and the sanity check that the metric is calibrated: Meilisearch normalizes case, so only the embedder input changes and the ranking must not move.

On those synthetic kinds, two cases resist typos and are worth understanding before any fix: `topic-cancer-biology` at 0.883 and `topic-materials-science` at 0.772, against `topic-immunology` and `topic-economics` at 0.200.
The resistant terms are the ones with enough corpus text for the embedder to carry the query when the keyword leg fails, so typo robustness is partly a corpus-density property and not purely a query-path one.

Precision@10 of 1.0 means the marker oracle is now saturated and cannot detect an improvement, only a regression.
Tighten the markers or add adversarial cases before using precision to evaluate a ranking change; use the overlap number for typo work.

The likely cause is that every layer upstream of Meilisearch matches exactly.
In `normalizeResearchSearchQuery`, `isStudentQueryFiller`, `STUDENT_QUERY_ALIASES[token]`, and `resolveTopicAliasExpansion` are all exact key lookups, and the Meili `synonyms` map is exact-term keyed, so a misspelled topic term receives neither alias nor synonym expansion and survives only on Meilisearch's own fuzzy match over raw tokens.
`rankingRules` compounds it by placing `typo` below `proximity` and `exactness`, so a correctly spelled weak match outranks a typo-corrected strong match.

Changing `semanticRatio`, the ranking rules, `minWordSizeForTypos`, or adding fuzzy alias resolution are the candidate fixes.
Re-run the harness before and after any of them, and move the overlap number rather than arguing about the mechanism.

### The keyword leg runs as its own query (#2732)

`exactness` scores a match that needed a typo corrected at 1/6, and a hybrid hit's blended score gives the keyword leg only 0.2 weight, so a typo-corrected keyword match tops out near 0.02 blended and `HYBRID_RANKING_SCORE_THRESHOLD` (0.15) excludes every one of them.
Lowering that threshold does not recover them: measured on a local copy of the Development index, `immunolgy`'s first keyword hit sits at rank 585 of a 0.02-threshold result set, far past the 200-row `HYBRID_CANDIDATE_POOL_SIZE` the service requests, while the newly admitted weak semantic neighbours fill that window and are then dropped again locally.
So `searchResearchGroupsViaMeili` issues a third companion query with no `hybrid` block and no threshold.
The keyword leg needs no noise floor of its own, because a keyword search returns nothing at all for a query the corpus does not contain, where hybrid k-NN returns the nearest vectors however dissimilar (#823).

`orderCandidatesByKeywordLeg` then orders the candidate set by that leg's own ranking and appends the pool rows it did not return.
The first round of this fix merged the other way round, pool order first with the keyword rows appended, and that re-imported the defect the separate leg exists to avoid: the pool is ordered by the blended score, so the keyword matches inside it were still ranked by an embedding similarity a typo moves wholesale, and a keyword row the pool did not hold sat behind every pooled row whatever its keyword relevance.
The leg is queried precisely because the blended score cannot represent it, so the blended score must not order its rows either.

`dropCoincidentalTypoOnlyHits` (#1015) runs on each leg's own retrieval before the merge, which is what keeps this a reordering: a row the pool admitted on semantics stays served, in its pool position, when only its keyword-leg copy is typo garbage.
Filter the merged set alone and the keyword-leg copy of such a row decides its fate, which turns a reordering into a silent removal of matches the search had already recovered.
The invariant is pinned by the `searchResearchGroupsViaMeili` case named "keeps a pool row the semantic leg admitted when only its keyword-leg copy is a coincidental typo" in `server/src/services/__tests__/researchGroupService.test.ts`.

This is a narrow change to the keyword/semantic split rather than a rewrite of it.
`floorWeakSemanticOnlyHits` (#929) already floors a semantic-only hit beneath every keyword match unless its similarity clears `WEAK_SEMANTIC_ONLY_SIMILARITY_FLOOR`, and over the harness queries against Development only 117 of 13,806 pooled rows, 0.85%, were semantic-only above that floor.
Read that number before assuming the served page is semantically ranked: for a topical query it is already almost entirely keyword-matched rows, and what this fix changes is the order within that block.
The accepted cost falls on that 0.85%: a semantic-only hit above the floor, which #929 let outrank a keyword match, now sits behind every keyword-leg row, and the measurements below show precision@10 and reciprocal rank flat across the change.

Measured with the harness on the Development corpus, `--top-k 10 --name-samples 0`, over 88 comparable perturbations: mean average overlap 0.479 to 0.588, and mean Jaccard at depth 10 0.463 to 0.685 with 52 pairs improved against 11 regressed.
Pairs sharing 2 or fewer of 10 rows fell from 46 of 88 to 22 of 88.
Every kind rose: transposition 0.364 to 0.537, deletion 0.380 to 0.516, doubling 0.400 to 0.537, substitution 0.395 to 0.537, `real-misspelling` 0.320 to 0.386.
Casing stayed at exactly 1.0, precision@10 at 1.0 and reciprocal rank at 0.947, with no per-pair precision regression.

Two residuals are upstream of the service and are the next levers, not this one.
A perturbation that damages an alias key loses the whole expansion, because `resolveTopicAliasExpansion` is an exact lookup, which is why `clmiate change` searches 2 query terms where `climate change` searches 7.
And `rankingRules` places `exactness` above `typo`, so a term the corpus contains verbatim partitions its clean query's matches from its misspelling's corrected ones: that is the whole of the `topic-neuroscience` regression in the numbers above, where both pages stay on topic at precision 1.0 but share almost no row.

A reported total is floored at the locally reachable pool length: the companion count only counts what cleared the blended cutoff, so on its own it would end the client's pagination walk before the keyword-leg rows.

## Data shape rules

- Prefer first-class collections for access signals and other product-model records.
- If a schema change affects Research search, update the relevant index config and rebuild path.
- Add a backfill script in `server/src/scripts/` when existing data needs transformation.
- Migration scripts run with `npx tsx --transpile-only <script>.ts`.
- Verify index settings and sortable/filterable attributes when adding fields used for search, filtering, or ordering.
