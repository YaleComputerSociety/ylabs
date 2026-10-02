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
It strips low-value words such as `professor`, `lab`, and `research` when meaningful terms remain, expands curated abbreviations (`ai`, `ml`, `nlp`, `cv`, `neuro`, `psych`, `dna`, `ir`, the cluster's `shortAliases` and `abbreviations`) when one is the whole query, and treats such a query, whose expansion still carries the typed shorthand, as a keyword-only search over topic-oriented fields.
An alias expands only when it is the whole query: inside a phrase each expansion term counted as a query word in Meili's `words` rule, so `drug addiction` served drug-discovery rows, and the typed words now go through unexpanded while the index synonyms widen each one (#3797).
A `queryOnly` cluster's word (`drug`, `kids`, `climate`) is a one-way synonym: it widens to its canonical terms, but no canonical term widens to it, so a `cardiology` query never reaches prose that says "at the heart of" (#3940).
Filler stripping is decided per token by `isStudentQueryFiller`, not by a flat word list, because a question-frame verb and a real field name can be the same word: `studies`, `work`, and `working` name fields the corpus carries (192 `researchAreas` and 11 `departments` contain "studies"; also "Sex Work" and "Working Memory"), so `work` and `working` are dropped only where they govern a preposition (currently `on` or `with`, per `QUESTION_FRAME_VERB_PREPOSITIONS`) and `studies` is never dropped.
Adding such a word to `STUDENT_QUERY_STOP_WORDS` silently narrows every query that names the field to its remaining tokens; the regression tests for both directions live in `researchGroupService.test.ts`.
Department shorthands resolve through the `department` clusters in `searchTopicAliases.ts`, which expand to the canonical term and drop the shorthand itself, so a query-only abbreviation no document carries (`orgo`, `ochem`) belongs there rather than in a `topical` cluster and stays out of the corpus-side Meili synonyms.
Dropping the shorthand is what decides how widely the query then searches, so the cluster kind is a retrieval decision and not only a vocabulary one: see "An alias query is only as narrow as its own shorthand" below.
A working-style phrase (`wet lab`, `dry lab`, `wet bench`) resolves through `RESEARCH_WORKING_STYLE_PHRASE_CLUSTERS` in the same file, which is a phrase catalog rather than a per-token one and is also why `lab` survives filler stripping there: see "A student's working-style words are not the corpus's" below.

## MongoDB indexes

A declared `schema.index(...)` does not build itself; `skills/contributing/SKILL.md` ("Modifying a schema") owns how and where to build, narrow, widen, or remove one.

`observations` and `researchers` carry indexes whose trailing keys exist for a specific reader rather than as padding, so trimming a key silently restores a scan that nothing else reports (#3934).

| Index | Serves | Why the trailing keys |
|---|---|---|
| `observations` `{ sourceUrl: 1, observedAt: -1 }` | the repair queue's evidence lookup, a `sourceUrl` `$in` sorted newest-first under a limit | `observedAt` lets MongoDB merge the per-variant intervals already in sort order instead of buffering the whole match |
| `observations` `{ sourceName: 1, entityType: 1, superseded: 1, entityKey: 1, entityId: 1 }` | the gate's two source-scoped `distinct` calls and the roster lane's observed-key read | `entityKey` and `entityId` are what those callers read, so carrying them makes the roster read a covered `DISTINCT_SCAN` and lets the gate's `entityId` read answer from the index |
| `observations` `{ sourceName: 1, field: 1 }` | the controlled-vocabulary heading reload | the reload carries no `entityType`, so it cannot use the index above; on `sourceName` alone its two sources match 224,459 rows against 12,883 for the pair |
| `observations` `{ entityType: 1, field: 1, superseded: 1 }` | the host filter in `observationStore` | `field` sits second because the two older `entityType_1_..._field_1_observedAt_-1` indexes bury it behind `entityId` or `entityKey`, and an unconstrained middle key takes no bounds |
| `researchers` `{ 'profileLinks.url': 1 }` and `{ 'profile.websiteUrl': 1 }` | identity by profile URL, asked as one `$or` over both paths | an `$or` needs an index per clause, or the union degrades to the scan every such call used to pay |

Two conclusions worth keeping, because both invert the guess:

- A `sourceUrl` index cannot help the host filter in `observationStore`, even though that filter is on `sourceUrl`.
  Two independent properties of its regex each defeat index bounds, measured by forcing the index on Development: the regex is case-insensitive, and `https?` leaves it no fixed literal prefix.
  Either alone makes the bounds the interval covering every string, so the forced plan walks all 1,880,941 keys.
  What serves that read is an index on everything else it asks, which is why `{ entityType: 1, field: 1, superseded: 1 }` exists: 57,920 keys down to 12,284.
  Which plan the planner picks for such a regex is corpus-dependent rather than fixed, so assert the bounds and never the chosen plan; a test that pins the choice flips when the fixture changes.
- `{ sourceId: 1, observedAt: -1 }` was reported as serving no query and does serve one: the BBS research-track lane asks `Observation.exists({ sourceId, entityType, field, value })`, leading on `sourceId`.
  It stays declared.
  Retiring it is now a more open question than when #3934 was written, because `{ entityType: 1, field: 1, superseded: 1 }` also answers that read in one key on the row measured, but a removal is a reviewed migration with its own issue and this change does not settle it.

## Meilisearch indexes

| Index              | Service                               | Purpose                                                                           |
| ------------------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| `researchentities` | `researchEntitySearchIndexService.ts` | Yale Labs / Research search on `/research`; drives browse and discovery.           |

The Meilisearch client lives in `server/src/utils/meiliClient.ts`.
It lazy-loads and caches the connection.
Use `getMeiliIndex(name)` and `resolveIndexName(name)`.
Every request is bounded by `MEILISEARCH_REQUEST_TIMEOUT_MS` (5 seconds), so a hung Meilisearch fails a search within that bound instead of holding the request for the runtime's default fetch timeout of several minutes.

### A Meilisearch outage answers 503, not a Mongo search (#4187)

When the primary Meilisearch query still throws after `searchWithFallbacks` has applied its recoverable degradations, `searchResearchGroupsViaMeili` throws `SearchUnavailableError`, and the error handler answers `503` with a `Retry-After` hint.
The client already renders any failed browse or search as the limited-search notice with its retry action (#4188, #4266), so no client change rides on this.
There used to be a Mongo fallback that read every public row and ran the public-description gate over each one in process, and it was removed rather than bounded, for these measured reasons, against Development with Meilisearch unreachable:

- The gate is synchronous CPU: 11.3 s for the 3,444 tier-admitted rows (about 2 ms a row), after a 2.9 s read of 37 MB of documents.
An empty browse took 16.8 s to 17.9 s and held the event loop for up to 14.6 s, so every other request on the instance, including detail pages and login, waited behind one student's search.
A two-filter browse took 13.2 s with a 7.4 s block, because each active facet re-read and re-gated the corpus.
- Yielding between chunks of rows removes the block, measured at under 0.4 s, but not the cost: one browse still took 14.2 s, three concurrent ones took 33 s to 38 s each, and the cost grows with every concurrent student until requests pass the hosting proxy's timeout.
Sharing one gated set across requests would keep those documents resident: the measuring process reached 196 MB of heap with one set loaded.
- Its answers were worse than Meilisearch's: `neuroscience` matched 233 rows against 594, with no relevance ranking.
- It was reached on 0 of 208 Development searches in 30 days, so it was an expensive path nothing exercised.

After the change the same three requests answer `503` in 1 ms to 3 ms with no measurable event-loop block, and healthy searches are unchanged.
The companion queries a search sends after the primary one still keep their own fallbacks and mark the response degraded, so only a failed primary query answers `503`.
Do not reintroduce an in-process corpus scan on the request path as a substitute for the index.
The bound is per HTTP request, so settings and document tasks are unaffected: those requests only enqueue, and `waitForTask` polls with its own overall timeout.
An enqueue is not an outcome: every index write that reports a result confirms its task through `assertMeiliTaskSucceeded` in `server/src/utils/meiliTask.ts`, with a bounded wait, and a failed or timed-out task counts as a failure, so `syncEntity`, `syncEntities`, `deleteFromIndex`, and the rebuild's `indexedDocumentCount` report what the index applied (#3720).
A pass that writes thousands of rows confirms at the end rather than per row: `withDeferredIndexConfirmation` in `meiliSyncService.ts` makes `syncEntity` enqueue only for the duration of the callback and then confirms the latest write per document, returning `failedDocumentIds`, which is the outcome to read instead of the per-call boolean.
`materializeFromRun` wraps its whole pass in it and unions those ids into `indexSyncFailures`.
Measured against a throwaway Meilisearch with a 300 ms embedder, 300 rows took 113.8 s confirmed per row versus 1.5 s confirmed at the end, so a 4,550-row pass falls from about 29 minutes to under a minute.
The server refuses to start in a deployed runtime (`requiresDeployedRuntimeSecurity()`) unless both `MEILISEARCH_HOST` and `MEILISEARCH_INDEX_PREFIX` are set, because the local defaults would silently point Beta or Production at `localhost` or at the unprefixed Development index.
The check runs in `app.ts` at startup rather than inside the client, so local scripts, which usually run with no `NODE_ENV`, keep the local defaults.
The embedder check behind hybrid search (`readResearchEntitySearchEmbedderState`) caches `configured` and `absent` for five minutes but never caches a failed check: a thrown `getEmbedders()` is logged, reported as `unknown`, and makes that search keyword-only with `degraded: true`.
The rebuild makes the index's embedder follow the environment on every run: a real `OPENAI_API_KEY` sets the `default` embedder, and an unset, blank, or `<...>` placeholder key resets it on the unprefixed local index, because an embedder left over from an earlier seed keeps calling OpenAI on every `addDocuments` and fails the whole seed (#4254).
A prefixed index (Beta, Production, any `MEILISEARCH_INDEX_PREFIX` target) keeps its stored embedder when the rebuilding shell has no usable key, so an operator reindex without the key cannot silently make a deployed search keyword-only.
The rebuild and the query-embedding path read the key through `usableOpenAiApiKey` in `server/src/utils/openAiApiKey.ts`, so neither sends a placeholder to OpenAI; the scraper LLM extractors still read `OPENAI_API_KEY` directly.
The companion queries a search sends after its primary one (the exhaustive hybrid count and facet query, each disjunctive facet query, the keyword-leg query, and the deep and semantic legs) each keep their fallback on failure and also mark the response `degraded: true`, so a search that lost part of its answer to a timeout is shown as limited and kept out of the zero-result analytics (#3751).

Relevant config:

| Variable                   | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `MEILISEARCH_HOST`         | Defaults to `http://localhost:7700` locally; required in deployed runtimes. |
| `MEILISEARCH_API_KEY`      | Meilisearch API key.                                       |
| `MEILISEARCH_INDEX_PREFIX` | Environment prefix (`beta`, `prod`), giving e.g. `beta_researchentities`; unset locally, required in deployed runtimes. |
| `OPENAI_API_KEY`           | Used by Meilisearch embedder config and LLM extractors.    |

Documents sync via `meiliSyncService.ts` after upserts.
`researchEntity` is the only syncable type; the `listings`, `papers`, `pathways`, and `researchers` indexes are retired and listed in `RETIRED_INDEX_BASE_NAMES` in `reindexMeiliForEnvironment.ts`.
A retired index base name must be added there when its surface is removed, or `reindex:meili` reports the prefixed copy as `unknown` and keeps it, as `researchers` survived the removal of person search (#3946).
Development has no index prefix, so `reindex:meili` does not reconcile it, and a retired unprefixed index there is deleted by hand.
After copying Mongo data into Beta or Prod, run `reindex:meili` inside that Render service to rebuild the prefixed `researchentities` index and delete any retired prefixed indexes.
Rebuild scripts do full repopulation.
An index document is built from the whole Mongo row, because the sanitizer reads `fieldProvenance` and other stored fields while it builds, and is then projected to `RESEARCH_ENTITY_SEARCH_INDEX_DOCUMENT_FIELDS`: the primary key, `slug`, and every searchable, filterable, and sortable attribute, derived from the settings so the two cannot drift (#3944).
Provenance, operator bookkeeping, detail-only lists such as `recentGrants` and `sourceLinkHealth`, and retired or unmodelled fields therefore never reach the index, so retiring a stored field needs no index-side denylist entry.
A field a new index reader, filter, sort, or the embedder `documentTemplate` needs must be added to the settings, or listed in the allowlist, before it is indexed at all; the unit tests in `researchEntitySearchIndexService.test.ts` fail when a template field or a known reader's field falls outside it.
The allowlist changes the stored shape, so it takes effect only after a rebuild: measured on Development, the 4,544 documents fell from 43.7 MB of JSON over 79 top-level fields to 8.1 MB over 28.
The `researchentities` index prioritizes name, professor, research-area, and `studentSearchTerms` attributes before summary or description text.
`leadProfessorNames` and `professorNames` name exactly the members the detail page serves, through `publicResearchEntityDetailMemberNames` in `researchGroupService.ts`: every role edge that is not `HISTORICAL`, minus a stale official-roster row, an uncorroborated phantom lead, and a same-name duplicate.
The index used to require `state: 'CURRENT'`, but `UNKNOWN` is the materializer's normal state and the gate and the detail page both read it as current, so only 84 of 3,426 served rows were findable by their lead's name; under the detail-page rule 3,359 carry a lead name (#3745).
`departments` is both searchable and filterable, so it is the browse department facet and only carries values that resolve to a canonical `DEPARTMENT`/`DIVISION` `OrgUnit`; the org names a source listed beside an appointment but that are not departments (centers, hospital systems, program tracks, societies) live in `orgAffiliationLabels`, which is searchable and deliberately **not** filterable so they stay findable without becoming facet values (#2194).
`entityType` is filterable but not searchable, and it is the browse Type facet that separates facilities, centers, institutes, and initiatives from labs and faculty research; the axis accepts exactly the canonical `researchEntityTypes` enum and labels each value from `RESEARCH_ENTITY_TYPE_FILTER_LABELS` in `client/src/utils/researchEntityCopy.ts` rather than from `entityKindLabel`, for the reasons the 2026-09-22 entry in `docs/decisions.md` records (#2195).
No token a student never reads as text is searchable, the same rule #2875 applied to the synthesized "Faculty Research" title suffix.
`kind` and `entityType` are filterable only, because Meilisearch split `FACULTY_RESEARCH_AREA` into `faculty`, `research`, and `area`, so `faculty` and `area` each matched 2,585 served rows through the type value alone; the types whose label is a real search word (`lab`, `center`, `institute`, `initiative`, `core facility`) instead carry that word in `entityTypeSearchTerms`, the last searchable attribute, through `researchEntityTypeSearchTerms`, and faculty research and faculty project carry none (#3942).
It is a field of its own rather than a `studentSearchTerms` entry because `studentSearchTerms` is one of the topic fields whose match vetoes a title match, so a type word there would stop `<surname> center` from reading as a match on the center's own title.
`websiteUrl` and `sourceUrls` are not searchable and so are not on the index document at all: a URL tokenizes into host and path segments, so `profile` matched 2,413 served rows and `people` 553 through a URL segment alone (#3941).
Search reads every hit back from Mongo by id, so no search reader needs either field from the index.
Removing the URL fields exposed that the query tokenizer split a word at an accented letter (`pâtisserie` became `p tisserie`), which only a URL slug had been matching, so `tokenizeStudentResearchQuery` now folds Latin diacritics through `foldLatinDiacritics` before it drops non-alphanumerics.
The document side of the in-process name-match guard folds through the same helper, `normalizeNameMatchText`, so a query and the text it is compared against never fold differently.
Its settings also include curated synonyms and typo guards for short aliases such as `ai`, `ml`, `nlp`, and `cv`, so rebuild or sync the index after changing alias or relevance settings.
The index sets `pagination.maxTotalHits` (see `RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS`) well above the Meilisearch default of 1,000 so the full student-visible directory stays reachable through browse and infinite scroll; the default cap would silently truncate the reachable set and the reported total.
Reachable pagination depth has a second, tighter ceiling: `RESEARCH_SEARCH_MAX_REACHABLE_RECORDS` in `server/src/services/researchSearchPagination.ts` bounds how deep browse and infinite scroll can page, in records rather than page number, so the reachable page number falls out of the requested page size.
A request past that depth is answered with an empty page flagged `depthLimited: true` rather than a clamp to the last reachable page, so a paging client terminates instead of re-appending the same rows; raise the constant when the served corpus approaches it, or deep browsing truncates silently.
That depth-limited page runs no search, so it reports no `estimatedTotalHits` at all instead of inventing one, and the client leaves the total it is already displaying untouched.
Facets are sent once per result set: page 1 (or an explicit `includeFacets: true`) includes `facetDistribution`, later pages omit the key entirely and skip the facet queries, and an absent key means "unchanged" to the client rather than "no facet values".
Because absence carries that meaning, every search path that was asked for facets must return the key, including the paths that run no Meilisearch query at all (unsearchable query, low-quality-first browse), which return an empty distribution.
The distribution carries `school`, `departments`, and `entityType`, the three facets the filter rail reads.
`researchAreas` is still filterable, but its facet is computed only while a `researchAreas` filter is active: with no reader since the topic filter left the client (#1885), its roughly 6,000 values were most of every page-1 body, and measured on Development an empty-query page 1 of 24 fell from 285 KB raw (81 KB gzip) to 40 KB (8 KB gzip) once it and the two card fields below were dropped (#3951).
A browse card is the `forList` DTO, which omits the detail-only `fullDescription`, `recentGrants`, and `sourceLinkHealth`; `recentGrantCount` stays on the card, the detail page reads the other two from the detail payload, and the saved-research comparison reads only `sourceLinkHealth` from it.
`profileSynthesisDescription` and `descriptionSource` are on neither payload, because no lane writes either one (#3937); see `docs/research-model.md` under Research Detail Projection.
It likewise sets `faceting.maxValuesPerFacet` (see `RESEARCH_ENTITY_SEARCH_MAX_VALUES_PER_FACET`) well above the Meilisearch default of 100 so long-tail department facet values stay selectable instead of being silently dropped.
An alias query that keeps its shorthand restricts `attributesToSearchOn` to topic fields that actually exist in `searchableAttributes`; a missing attribute now degrades in place on the Meili path instead of falling back to the slow Mongo scan.

### An alias query is only as narrow as its own shorthand (#2733)

`TOPIC_ALIAS_QUERY_ATTRIBUTES` exists because a two-letter alias matching inside prose returns noise: `ml` is also millilitres and `cv` is also a curriculum vitae, which is why `freeTextGuarded` and the `disableOnWords` typo guard exist.
That reasoning holds only while the alias itself is still part of the query text, and the two cluster kinds differ exactly there.
A `topical` expansion keeps the shorthand (`ai` searches `artificial intelligence machine learning deep learning ai`), so it stays restricted to topic fields and keyword-only.
Only an abbreviation expands that way.
A full English word a topical cluster lists (`cancer`, `heart`, `aging`, `drug`, `mental health`) is searched as typed, over every searchable attribute and the hybrid embedder, and the index synonyms widen it, because the restricted expansion narrowed it instead: the expansion put the typed word last under Meilisearch's default `last` strategy, so every hit had to carry the first canonical term (#3940).
Measured in-process on Development before the change, page-1 totals for the alias path against the same word with the alias removed: `cancer` 229 against 694, `heart` 51 against 1,493, `aging` 33 against 160, `drug` 128 against 296, `genes` 196 against 960.
`kids` (136 against 3) and `mental health` (407 against 275) went the other way, because the corpus carries their canonical vocabulary and not the word, which is why a `queryOnly` word is now a one-way synonym rather than nothing.
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
| `yarn --cwd server research-entity:archived-visibility-verdicts` | Read the student-visibility tier histogram both with and without the `archived` filter, and the zero-hard-blocker held population both ways, so a count by tier is a command rather than an ad-hoc pipeline. Dry-run default; `--apply --confirm-archived-visibility-verdict-repair` withdraws the verdict from archived rows; `--assert-clean` exits non-zero while the two readings disagree. |

## Default `/research` ordering

With no query, `/research` sorts by `browseRankScore:desc` then `lastObservedAt:desc`.
The path is `researchGroupService.searchResearchGroupsViaMeili`.

`browseRankScore` is precomputed on the ResearchEntity document and mirrored to Meilisearch as a sortable attribute.
The scorer lives in `researchEntityBrowseRank.ts`.
The join, persist, and resync logic lives in `researchEntityBrowseRankService.ts`.

The scorer rewards completeness plus strength-weighted undergrad access signals.
Completeness is read from the copy a row serves, so the stored-only `profileSynthesisDescription` earns no rank: before #4120 it lifted a row with no served description from 0 or 2 description points to 8.
Strong `CURRENT_UNDERGRADS` and `PAST_UNDERGRADS` signals outweigh the `REACH_OUT_PLAUSIBLE` fallback.
`NOT_CURRENTLY_AVAILABLE` is negative.

`entityMaterializer` recomputes ranking live after access signals are derived.
Browse sorts on the indexed score, not the stored one, so a Mongo write whose resync failed still serves the old order.
`syncEntity` therefore returns whether the index applied the document (its task succeeded, #3720), and `recomputeBrowseRankForEntities`, the browse-rank backfills, and `materializeFromRun` (`indexSyncFailures`, persisted as `ScrapeRun.materializationIndexSyncFailures`) report those rows apart from `updated` (#3638).
A script that resyncs a batch goes through `syncResearchEntitiesWithOutcome` (`services/researchEntityIndexSyncOutcome.ts`), which returns `{ resynced, indexSyncFailures }` from what the index applied, and reports both next to its updated count (#3726).
`services/__tests__/indexSyncResultIsRead.test.ts` fails on any call to `syncEntity`, `syncEntities`, or that helper whose value is discarded, so a new caller cannot silently report a resync the index never received.
Admin "weakest profiles first" with `browseQuality: 'low-first'` is a separate Mongo-side path.

## A-Z ordering (#3945)

The public `name` sort does not sort on the stored `name`.
`researchGroupService` maps it to the indexed `sortTitle`, which `buildResearchEntitySearchIndexDocument` computes with `researchEntitySortTitle` from the same title rule the card heading uses (`servedResearchEntityTitle`, pinned to the client by `contracts/researchEntitySearchTitle.cases.json`).
The key is case-folded, accent-folded, whitespace-collapsed, and has leading punctuation removed; a leading article is kept, because the card shows it and a student scanning headings files "The ..." under T.
Before this, 46 of 3,425 served rows had a heading whose first letter differed from `name`, and 38 of them sat more than 500 places from where their heading would put them.
`sortTitle` is a sortable attribute and a stored field, so it is inert until the index is rebuilt; until then Meili rejects the sort, the service retries on `name`, and the result is marked degraded.
Rows sharing a title are served with a page-local "(Department)" suffix by `disambiguateCollidingResearchEntityNames`, which the index cannot store, so the sort breaks ties on `sortTitleQualifier`, the same department and school labels folded the same way (`researchEntitySortTitleQualifier`).
Each label keeps the suffix's closing parenthesis, so a department that prefixes another sorts the way the folded heading does.
The key cannot follow the school fallback: when any row in a same-titled group has no department, or two share one, the page suffixes the school, but the stored key still leads with the department, so that group can read out of order by heading.
Without it, Meili ordered same-titled rows arbitrarily and 4 of 3,429 served A-Z rows on Development read out of order by their suffixed heading.
`yarn --cwd server journey:eval --case=title-sorted-browse-follows-card-title` walks the A-Z browse and fails on an inversion by heading or on a degraded page.

## `/research` client search state

`client/src/pages/research.tsx` keeps three kinds of search: a text query, a filters-only search, and a department search (`dept` in the URL), which owns the department filter and composes with the school and type facets rather than turning into a free-text search of the department label.
A sort change re-runs the submitted search, never the unsubmitted draft in the box, and emptying the box falls back to the filters-only search when facets are active.
The in-memory page snapshot restores results on Back only when they had settled: a search still in flight when the student left is re-run from the URL with the chosen sort, and a page still loading more is fetched again.
Leaving a search returns to browse through the URL-sync effect, which reloads browse under the current sort and admin filters.
`client/src/pages/__tests__/research.searchState.test.tsx` pins each of these (#3653).

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
| zero-result cases | 1 (`semantic-phrase-wet-lab-beginner`, resolved by #2715; 0 since) |

Read that as: **a correctly spelled query is answered essentially perfectly, and a single typo costs about two thirds of the result set.**
The top hit survived a typo in 1 of the 5 synthetic perturbations for most cases.
Casing scores exactly 1.0, which is both the expected result and the sanity check that the metric is calibrated: Meilisearch normalizes case, so only the embedder input changes and the ranking must not move.

On those synthetic kinds, two cases resist typos and are worth understanding before any fix: `topic-cancer-biology` at 0.883 and `topic-materials-science` at 0.772, against `topic-immunology` and `topic-economics` at 0.200.
The resistant terms are the ones with enough corpus text for the embedder to carry the query when the keyword leg fails, so typo robustness is partly a corpus-density property and not purely a query-path one.

Precision@10 of 1.0 means the marker oracle is now saturated and cannot detect an improvement, only a regression.
Tighten the markers or add adversarial cases before using precision to evaluate a ranking change; use the overlap number for typo work.

The likely cause is that every layer upstream of Meilisearch matches exactly.
In `normalizeResearchSearchQuery`, `isStudentQueryFiller`, `STUDENT_QUERY_ALIASES[token]`, `resolveTopicAliasExpansion`, and the `WORKING_STYLE_PHRASE_ALIASES` phrase scan are all exact key lookups, and the Meili `synonyms` map is exact-term keyed, so a misspelled topic term receives neither alias nor synonym expansion and survives only on Meilisearch's own fuzzy match over raw tokens.
`rankingRules` compounds it by placing `typo` below `proximity` and `exactness`, so a correctly spelled weak match outranks a typo-corrected strong match.

Changing `semanticRatio`, the ranking rules, `minWordSizeForTypos`, or adding fuzzy alias resolution are the candidate fixes.
Re-run the harness before and after any of them, and move the overlap number rather than arguing about the mechanism.

### Every hybrid query in a request must carry the precomputed vector (#3149)

One search request issues several hybrid queries over the same text: the page query, the companion exhaustive threshold-aware count, and one disjunctive facet query per actively filtered facet.
Meilisearch 1.13 has no query-embedding cache, so left to itself it re-embeds that text through OpenAI once per query, and the embedding is the whole cost: timed against the Development index for `machine learning`, a hybrid query reports 227-373ms of which ~40ms is the search, while the same query with a `vector` supplied reports 44ms and a keyword-only query over the full 100,000-row window reports 41ms.
Paid two to four times, that is the difference between a 0.3s search and a 1.4s one.

So `getResearchSearchQueryVector` (`server/src/services/researchSearchQueryEmbedding.ts`) embeds the query once, caches it per query text, and `searchResearchGroupsViaMeili` passes the result as `vector` on every hybrid call.
Meilisearch skips its own embedder whenever `vector` is present, which is also why the missing-embedder degradation must delete `vector` alongside `hybrid`: a `vector` with no `hybrid` block is a pure semantic search, not the keyword fallback that degradation means.

`getResearchSearchQueryVector` returns `{ vector, semanticLegAffordable }` rather than a bare vector, and the two fields answer different questions.
`vector: null` with `semanticLegAffordable: true` means no `OPENAI_API_KEY` is configured (or the query is blank): the search omits `vector` and Meilisearch embeds the query with its own embedder, which is the intended path in that configuration.
`semanticLegAffordable: false` obliges the caller to delete `hybrid`, `rankingScoreThreshold` and `showRankingScoreDetails` rather than only omitting `vector`, and the search serves its keyword leg marked `degraded: true`.
It is returned for a budget or breaker refusal, described below, and for a failed call: a thrown request, a timeout, or a `200` with no usable vector, whether this request made the call or joined one already in flight.

### A failed query embedding costs the search almost nothing (#4192)

A failed call used to keep `hybrid`, so Meilisearch embedded the query itself through the same failing upstream and retried it up to its own deadline before degrading to keyword.
Measured in process against a throwaway Meilisearch v1.13 holding a copy of the Development index, with a stub embedder for both the query call and Meilisearch's own: with the upstream answering 500, each of the five text searches before the breaker opened took 8.3 s to 9.9 s, and Meilisearch made 19 to 25 embedder requests per search; with the upstream hanging, each took 18.2 s to 19.3 s, the 10 s query timeout plus a primary query that timed out inside Meilisearch, so it fell through to the Mongo fallback, which answers 503 since #4187.
Declining the semantic leg on failure brings those searches to 0.2 s to 1.0 s against a 500 and 2.3 s to 3.1 s against a hang, with one upstream call each, and once the breaker opens a search makes no call and answers in about 0.3 s.
Their hits, totals and facets were identical to the same eight queries served with no embedder configured, so the answer during an outage is exactly the keyword answer.

`EMBEDDING_REQUEST_TIMEOUT_MS` is 2 s, down from 10 s: 30 real calls measured 175 ms at p50, 455 ms at p90 and 1.1 s at worst, and a stalled upstream costs every search that is waiting on it the whole bound.

### The query embedding is a budgeted call, not a free one (`researchSearchQueryEmbeddingBudget.ts`)

`POST /api/research/search` is public and each distinct query text is one paid embedding call, so the number of calls a minute can hold has to be a number we choose rather than whatever the traffic happens to be.
The same account serves the LLM scraper lanes, so exhausting it degrades the pipeline and not only search.

`reserveResearchSearchQueryEmbedding` claims a call before it is made, because a call that fails has still spent the upstream capacity being rationed.
It refuses with `window-ceiling`, `client-ceiling`, or `cooling-down`, and a refusal never fails a request: the search drops the whole semantic leg, the keyword leg answers, and the response is marked `degraded: true`, which is the same reduction the missing-embedder degradation already serves.

Deleting only `vector` would not decline the call.
Meilisearch embeds the query itself for any `hybrid` block that arrives without one, through the same account, so omitting the vector alone moves the spend rather than bounding it.
That is the same reason the missing-embedder degradation deletes both.

The window ceiling is the real bound and the per-client ceiling is a secondary guard, in that order for a reason.
Yale NATs a large student body behind few egress addresses, so a tight per-address number would take the semantic leg away from a whole cohort for the traffic of one member of it.
The per-address number is therefore set well above what a cohort of genuine searchers produces, and the absolute bound on a window's spend comes from the window ceiling.

| Variable | Default | Floor | Meaning |
|----------|---------|-------|---------|
| `RESEARCH_SEARCH_EMBEDDING_MAX_PER_MINUTE` | 600 | 60 | Embedding calls a one-minute window may hold across all callers. |
| `RESEARCH_SEARCH_EMBEDDING_MAX_PER_CLIENT_PER_MINUTE` | 120 | 10 | Same window, per client address. |
| `RESEARCH_SEARCH_EMBEDDING_COOLDOWN_MS` | 60000 | 1000 | How long the breaker stays open. |

Each is floored the way `FIRST_CONTACT_RATE_LIMIT_MAX` is floored, so a mistyped or zeroed override cannot switch the semantic leg off for everyone.

The breaker opens for the cooldown on an upstream rejection, which is a direct instruction to stop, and on five consecutive failures of any other kind, because one timeout is not evidence that the next call will fail.
The first call after a cooldown is the exception: until a call succeeds, one failure there reopens the cooldown at once, because it is the same outage continuing, and otherwise each cooldown would let five more searches wait out the request timeout.
A success forgets the run of failures, and only a call that produced a usable vector counts as one.
A `200` carrying an unparseable body is a paid call that returned nothing, so it counts toward the failure run rather than resetting it; treating it as a success would let a gateway answering that way pay the whole window ceiling indefinitely with the breaker permanently reset.

Three things are deliberately free and must stay free.
A cache hit costs nothing upstream, so it is served even to a client that is over its ceiling.
Joining a call already in flight costs nothing either, so the request that joins is not charged.
A caller that supplies no client key is an in-process one rather than a network source, and it is exempt from both ceilings: `research-entity:search-relevance`, `journey:eval` and the other harnesses measure the served corpus, and a run that silently lost its semantic leg would report a lower score as if a lane or the corpus had changed, which is a worse failure than the spend it saves.
The breaker still applies to them, because that tracks upstream health rather than spend.

The route supplies `embeddingSpendKey` from `getPeerIpKey(req)`, the same key every other per-IP limiter meters, so the address is the client's and never the proxy's and an IPv6 caller is bucketed by subnet.
Both halves are load-bearing.
A per-address key would let one caller on a routed prefix source each request from a different address in it, never reach the per-client ceiling, and spend the whole window ceiling alone.
Supplying the key unconditionally is what keeps a request whose address does not resolve inside a bucket instead of reading as an in-process caller and escaping the ceilings.

The client bucket map cannot outgrow the window ceiling, because an entry is only added when a call is allowed, and the whole of its bookkeeping is the window reset.

The cache is keyed on the exact text sent upstream, and must stay that way.
Rank equivalence with Meilisearch's own embedder is only claimed for the exact text sent as `q`, so normalizing the key for case or whitespace would hand one `q` a vector computed from a different one: the non-Latin branch forwards `normalizedQuery.raw` with case and spacing intact, so two variants that a normalized key would merge really do reach Meilisearch as two different queries.
The blank-query guard is on the text rather than the key, so a whitespace-only query buys no paid call.

Adding a new hybrid query to the request means threading the same vector into it.
Supplying our own embedding is rank-equivalent as long as it uses `RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL` on the exact text sent as `q`: measured over six queries against the Development index, `totalHits` and the top-24 set were identical to Meilisearch's own embedding on 6 of 6, with the only order divergence past rank 60 of a 4,988-hit set.

### A candidate hit is an id, so only three fields are retrieved (#3185)

A pool hit is never served.
It is reduced to its id and the served row is re-read from Mongo by `_id`, so `attributesToRetrieve` on the candidate-pool and keyword-leg queries is `['id','departments','researchAreas']` rather than the whole document.
Measured against the Development index over three queries: 50-57 attributes per hit became 4, and a 200-row response body of 2.2-2.6MB became 59-137KB, a 16x to 44x reduction.
Retrieval order is unaffected, checked on the index documents' own ids rather than on the served DTO: the full 200-hit order was identical on 6 of 6 interleaved arms, and `totalHits` agreed on 6 of 6.

That list is exactly what the reorder helpers between retrieval and hydration read, so it is load-bearing.
`promoteExactAliasFieldMatches` reads `departments` and `researchAreas`; everything else keys on the id.
Adding a helper that reads another indexed field means adding it to `RESEARCH_ENTITY_SEARCH_CANDIDATE_ATTRIBUTES`, or that helper silently sees `undefined` rather than failing.
`_rankingScoreDetails` is response metadata rather than a document attribute, so `floorWeakSemanticOnlyHits` and `dropCoincidentalTypoOnlyHits` are unaffected, confirmed against the running index rather than assumed.

Treat the payload as the claim and do not quote a latency figure from it.
Per-query wall time against a local Meilisearch fell from 79-134ms to 39-54ms on the keyword leg, but a local socket is not the deployed path and the hybrid arm was noise-dominated.
End-to-end latency through `POST /api/research/search` is unverified here, because measuring it needs two servers on one corpus and one warm embedding cache; #3185 records an interleaved figure inside the noise band at p90.
The reduction matters more in the deployed environment, where Meilisearch is a separate host rather than a port on the same machine.

### The keyword leg runs as its own query (#2732)

`exactness` scores a match that needed a typo corrected at 1/6, and a hybrid hit's blended score gives the keyword leg only 0.2 weight, so a typo-corrected keyword match tops out near 0.02 blended and `HYBRID_RANKING_SCORE_THRESHOLD` (0.15) excludes every one of them.
Lowering that threshold does not recover them: measured on a local copy of the Development index, `immunolgy`'s first keyword hit sits at rank 585 of a 0.02-threshold result set, far past the 200-row `HYBRID_CANDIDATE_POOL_SIZE` the service requests, while the newly admitted weak semantic neighbours fill that window and are then dropped again locally.
So `searchResearchGroupsViaMeili` issues a third companion query with no `hybrid` block and no threshold.
The keyword leg needs no noise floor of its own, because a keyword search returns nothing at all for a query the corpus does not contain, where hybrid k-NN returns the nearest vectors however dissimilar (#823).

`orderCandidatesByKeywordLeg` then orders the candidate set by that leg's own ranking and appends the pool rows it did not return.
Since #3797 that keyword-first order is only the fallback for a failed semantic leg; the served order is the rank fusion described in "The two legs are merged by rank, not by score" below.
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
The pool is decided once per query, never by the requested page (#3943).
It used to be `max(200, offset + pageSize)` rows, so each page past the first 200 rows admitted more and the reported total rose while a student scrolled the same query: `cancers` read 242 on page 1 and 577 on its last page at page size 24.
Now the head keeps the fixed `HYBRID_CANDIDATE_POOL_SIZE` window for the pool and the keyword leg, so page 1 orders exactly as before, and when either head leg fills that window a deep pool and keyword leg to `RESEARCH_SEARCH_MAX_REACHABLE_RECORDS` supply every further row, appended after the head in their own order.
Only the head window's keyword rows are fused with the semantic leg; the deeper keyword rows follow the fused list, then the remaining pool rows.
Measured on Development, `people`, `cancers`, and `faculty development` each reported one total on every page, equal to the rows served, with no repeats; `research-search:relevance` precision and reciprocal rank were unchanged on all 19 cases and average overlap changed on 1 of 108 perturbations.
The two deep queries cost page latency as first merged, because they ran after every other leg and the deep keyword leg carried match positions on 5,000 rows: measured in-process on Development over 4 text queries, 10 warm runs each, the page-1 median rose from 673ms to 926ms and the p90 from 834ms to 1,230ms, with the same rise on a page past offset 200.
#3949 removed that cost, and the next section records the result.

### The legs of a text search run concurrently (#3949)

After the primary pool query settles its fallbacks, every other leg depends only on its final parameters or on the keyword leg, so each starts as soon as what it reads has returned rather than one after another.
The exhaustive count, each disjunctive facet query, the keyword leg, and, when the head pool filled its window, the deep pool start together.
When the keyword leg returns, after its `'last'` retry, the semantic leg, the top-row match-position re-read, the deep keyword leg, and a deep pool the keyword leg alone made necessary start together.
The semantic leg stays gated on a non-empty keyword leg, because the count query outlasts the keyword leg anyway, so the gate costs no wall time and saves a query on zero-keyword searches.
Each leg keeps its own fallback and its own `degraded` contribution, applied after all of them settle.
Measured in-process on Development against the same protocol (4 text queries, pages 1 and 11 at page size 24, 10 warm runs each, interleaved processes), the page-1 median went from 926ms to 564ms and the p90 from 1,230ms to 717ms, below the 673ms and 834ms before #3943, and page 11 from 992ms to 589ms median and 1,162ms to 699ms p90.
Ordered result ids, totals, facet distributions and `degraded` flags were identical to the sequential form on 118 of 120 query, filter and page combinations; the other 2 were one query whose unchanged count query also differed between processes, the variance a fresh query embedding brings.
Every measured request embedded its query at most once and Meilisearch embedded none, so repeated embedding is not where the remaining time goes: the last Meilisearch call now returns 220-320ms into the request, and the 220-390ms after it is spent per served row rather than on I/O, which the next section attributes.
`server/src/services/__tests__/researchGroupService.test.ts` pins the start order in the case named "starts every leg as soon as the legs it depends on have returned".
`yarn --cwd server journey:eval --case=text-query-total-is-stable` pages a text query and fails when its total changes, reporting inconclusive when the corpus moved during the walk.

### What a text search spends after its last Meilisearch leg (#4093)

The time after the legs settle is not the Mongo row load, and treating it as one sends a fix at the wrong layer.
Measured in-process on Development over five inputs at pages 1 and 11, page size 24, 30 warm runs per arm after a discarded warm-up with the two arms interleaved process by process: the one query that hydrates the page runs 29ms at p50 and 40ms at p90, returning 24 documents in about 310KB, and the whole request makes five Mongo commands.
Against that, the live serve gate over those 24 rows costs 123ms at p50, the list DTO over them 61ms, and the batched lead-name roster read 61ms.
So the dominant cost after search is per-row description derivation, and the reorder and fusion helpers over the candidate pool cost 0ms at p50 even where the deep legs return 5,000 rows.

Within that derivation the repeated work was field-quality scoring.
`shortDescriptionQuality` scores the body it judges a card against, and the card-synthesis templates score one candidate after another against that same body, so a row scored its own body once per candidate.
On a 24-row page that was 146 body scores covering 28 distinct inputs and 116 card scores covering 26, so four fifths of the scoring was a repeat.
`withMemoizedDescriptionQuality` in `researchEntityDescriptionQuality.ts` now scopes one map of verdicts to one synchronous derivation, and `buildResearchEntityPublicDescriptionRepresentation` and `toPublicResearchEntityDto` each install it around their own derivation.
The scope is a derivation rather than the process because a verdict must not outlive the inputs its research-area checks read, and an async callback memoizes nothing at all, because the scope closes at its first suspension point and so loses the reuse rather than sharing a verdict between requests.
Every call still receives a fresh verdict object with its own flag list, so a caller that mutates what it was handed cannot reach the verdict a later call is served, and the copy is a spread rather than a rebuilt literal because the gate representation serializes `quality` directly and a reordered field list is a changed payload.
`server/src/utils/__tests__/researchEntityDescriptionQuality.test.ts` pins the scope and the identity: a repeated body scores once inside one derivation and twice across two, an asynchronous derivation reuses nothing, two different bodies keep their own verdicts, a served verdict is byte-identical to the unmemoized one with its field order, and a caller that mutates the flag list it was handed cannot reach a later verdict.
`server/src/services/__tests__/researchEntityPublicDescription.test.ts` pins the serving side, that a page of rows derived inside one shared scope gets the same gate verdict and the same card and detail payloads each row gets alone.

Measured after the change on the same protocol: page-1 p50 399ms to 322ms and p90 503ms to 415ms, page-11 p50 383ms to 323ms and p90 479ms to 387ms, with the gate over the page falling from 123ms to 68ms and the DTO from 61ms to 55ms.
Served output was unchanged: 31,570 of 31,570 comparisons over 4,510 Development rows across the serve verdict, the browse card with and without lead names, the detail payload, the operator payload and the gate representation, and 72 of 72 route payloads byte-identical over 8 queries, 3 filter sets and 3 pages.

Three residuals are the next levers and none of them is this one.
The roster read is four sequential round trips, two `role_assignments` reads and then `researchers` and `accounts`, and browse discards the last of those because it serves lead names only.
The row query loads whole documents, where `fieldProvenance` is 37% and `recentGrants` 26% of a stored row's 14.9KB and the served card reads both, while the fields no served surface reads are 25% of the row, so a field allowlist there is worth about a quarter of its bytes rather than all of them.
And `listPlanningContextsForResearchEntities` returns an empty map for every input, so the planning-context enrichment every list path awaits is inert.

### The two legs are merged by rank, not by score (#3797)

When the keyword leg returns rows and no explicit sort is chosen, the served order is a reciprocal rank fusion of the keyword leg and a pure semantic leg (`semanticRatio: 1`, top `SEMANTIC_LEG_SIZE` = 100, no threshold), in `fuseKeywordAndSemanticRankings`, with k = `RANK_FUSION_K` (60) and equal weights.
Pool rows neither leg returned follow the fused list, so paging still reaches them.
Before this, the page was the keyword leg's order with semantic-only rows appended, so over 42 realistic queries 80% of top-10 slots came from a tag-field keyword match and 1% from meaning alone, and a single exact tag (`Robotics` on a surgeon) outranked every lab listing the topic among several.
Rank rather than score, because the scores are not on one scale: measured offline with the index's own embedding model, off-topic queries reach similarities real topics do not, and no absolute or relative cutoff separated them, while the semantic leg's order was right.
Every k and weight swept beat the keyword-first merge, and a semantic weight of 2 cost a person-name query its correct first result.

Two guards shape the fused list.
When the all-words keyword leg of a multi-word query is empty, it is re-run with `matchingStrategy: 'last'`, so a phrase no row carries in full (`immigration policy`, or a `queryOnly` alias word such as `kids` inside a phrase) still has keyword evidence to anchor the fusion.
It was measured as part of the design: without it, concept queries scored 0.74 rather than 0.80 and question-style queries 0.65 rather than 0.72 nDCG@10 on the development set.
A keyword leg still empty after that runs no semantic leg, so a query that matches nothing keeps the thresholded path and its #823 noise protection.
When the best keyword hit matches every query word at the start of a word in a name, with at least one whole-word match, semantic-only rows are withheld and the keyword leg's own order is served (`keywordLegTopHitIsNameMatch`), because the semantic neighbours of a name are other people with similar names and carry no signal about which same-named row is the person.
The names read are `leadProfessorNames`, `professorNames`, and the entity title (`name`, `displayName`), because many faculty rows are titled after their person, and when the guard was measured their lead names were often not indexed (#3745): with titles excluded, the guard fired on none of 10 held-out name queries and person-name nDCG@10 fell from 0.750 to 0.580 (#3853).
A title match counts only when the same row does not also match the query in a topic field (`researchAreas`, `departments`, `studentSearchTerms`, `methods`, `orgAffiliationLabels`, `school`), so `Statistics Lab` stays a topic answer to `statistics`; a query whose every word is matched in a lead or professor name always counts, while one that needs the title for any word, such as `green chemistry` under a lead named Green and a title "Green Chemistry Lab", still faces the topic check.
A lone prefix (`stone` inside Stoneman) and a typo never count, because the highlighted text is not the typed word, while a short first name beside an exact surname does.
Measured over 177 non-name queries, the topic veto cut false fires from 16 to 4 with every name query still firing; the remaining false fires are generic words that are whole words of a program title (`data`, `undergraduate`).
The check reads those four fields through `_matchesPosition` on the first surviving keyword row only, so the 200-row keyword leg asks for no match positions, and that one row is re-read alone, the same keyword query paged to its position with `hitsPerPage: 1`, with positions and the four fields (#3949).
Positions cover every searchable attribute, retrieved or not, which is why the topic veto cannot be computed locally from the hit.
Measured on Development, match positions took a 200-row keyword query from about 40ms to 130-160ms and a 5,000-row one from about 100ms to 410ms, while the one-row re-read costs about 45ms and runs beside the semantic leg.
A re-read that returns a different row, because the index changed between the two queries, gives the check no positions and so serves the fused order; a failed re-read on a fused search marks it degraded.
A withheld result reports only the rows it serves as its total, because the companion count still includes the withheld rows.
A failed semantic leg falls back to the keyword-first order and marks the search degraded; `floorWeakSemanticOnlyHits` and `promoteExactAliasFieldMatches` now run only on that fallback path.
A whole-query shorthand that keeps its typed alias (`ai`) still searches topic fields keyword-only and is unchanged.

Measured before merging, graded by gpt-5-mini (95% relevant-versus-not agreement with gpt-5 on a 30-query sample) and blind by Claude Opus.
On 157 development queries, nDCG@10 rose from about 0.77 to 0.89 and Opus preferred the new order 101 to 25.
On 52 held-out real student queries nobody tuned against, nDCG@10 rose from 0.723 to 0.812, top-1 accuracy from 0.712 to 0.865, junk rows per query fell from 1.83 to 1.42, and Opus preferred it 28 to 14, which puts the honest gain at about half the development-set figure.
Re-embedding with a description-first template helped the development set and lowered held-out top-1 accuracy, so the embedder template is unchanged.
The weakest remaining classes are ambiguous single words (`machine`, `trade`, `quant`) and access-style searches (`freshman`, `undergraduate internship`), which topic search cannot answer.

A free-text-guarded shorthand is a one-way synonym: `cv` expands to `computer vision`, and no topic expands to `cv`, because `computer vision -> cv` matched the "CV" link on unrelated profiles.
That is an index settings change, so it reaches search only after the settings are pushed and the index rebuilt.
The synonym was not the whole defect: index-time `studentSearchTerms` tagged rows with the computer-vision cluster from a bare "CV" in prose ("Download CV", "his CV lists over 100 publications"), 9 of the 12 such rows on Development.
A bare `cv` now triggers only when the same field also carries vision vocabulary (`CV_CORROBORATING_CONTEXT_PATTERN`), never a department or title elsewhere on the row and never a lone generic word such as `imaging`, `visual`, or `detection`, which none of those 9 did and a lab abbreviating its field ("Our CV group builds algorithms for object detection") does; the phrases `computer vision` and `computational vision` trigger on their own (#3853).

### A student's working-style words are not the corpus's (#2715)

`wet lab experience for a beginner` returned nothing, and the reason was not that the corpus cannot answer it.
Two separate query-path decisions combined.
`lab` is filler as a bare head noun because every entity is one, so the phrase normalized to `wet experience beginner`, and that text is also the embedder's input: a qualifier with its noun deleted has no research meaning, every k-NN neighbour landed below `HYBRID_RANKING_SCORE_THRESHOLD`, and the whole query returned zero rows.
Measured on the Development index, the best ranking score is 0.093 for `wet experience beginner` against 0.267 for `wet lab experience beginner`, where the cutoff is 0.15.
Keeping the noun therefore stops the query being empty, but on its own it only retrieves weak neighbours: precision@10 against the case's markers was 0.10.

The second decision is vocabulary.
The corpus does not use the student's words: over the index's relevance text, `wet lab` and `dry lab` appear in 0 documents and `wet bench` in 1, while `laboratory` appears in 390, `computational` in 336, `experiment` in 311, `modeling` in 282, `assay` in 120, `in vivo` in 106 and `in vitro` in 63.
So a working-style phrase is replaced by that vocabulary and the typed phrase is dropped, exactly as `orgo` is, and for the same reason: retaining a phrase no document carries narrows the query instead of widening it.
The expansion is an OR list, so `isAliasExpanded` is true and `matchingStrategy` stays permissive; the keyword leg then reaches rows carrying any one canonical term and #2732's ordering serves those first.
That ordering is load-bearing here: for the expanded text the hybrid pool alone scores 2 of 10 on the markers while the keyword leg scores 10 of 10.

`completesWorkingStylePhrase` and `expandWorkingStylePhrases` are both driven by `WORKING_STYLE_PHRASE_ALIASES`, so the filler exemption and the expansion cannot disagree about which phrases exist, and `WORKING_STYLE_PHRASE_MAX_TOKENS` is derived from the catalog so a longer phrase added later is actually scanned for.
This is a query-only catalog: it must stay out of the Meili `synonyms` map, both because a corpus-side synonym would expand recall on a term nothing carries and because changing index settings requires a rebuild, which this fix does not (settings fingerprint unchanged across the before and after runs).

Measured with the harness on Development, 5,565 indexed documents, `--top-k 10`, before to after:

| Metric | Before | After |
| ------ | ------ | ----- |
| `semantic-phrase-wet-lab-beginner` rows returned | 0 | 10 |
| that case, precision@10 / reciprocal rank | 0 / 0 | 1.0 / 1.0 |
| zero-result cases | 1 | 0 |
| mean precision@10 | 0.965 | 0.967 |
| mean reciprocal rank | 0.95 | 1.0 |
| mean average overlap | 0.595 | 0.620 |
| findings | 46 | 45 |

The blast radius is confined to queries containing a catalog phrase: `machine learning`, `cancer biology`, `orgo`, `mcdb`, `black hole` and `neuroscience lab` all normalize to exactly the text they did before.
`beginner friendly research` and `lab experience for a beginner` still return nothing, and no ranking change can fix them: `beginner`, `prior experience` and `no prior experience` appear in 0 documents, so the experience-level half of the question remains an acquisition gap.

## Data shape rules

- Prefer first-class collections for access signals and other product-model records.
- Spell "live" as `archived: { $ne: true }` by importing `LIVE_ENTITY_FILTER` or `liveEntityFilter` from `server/src/models/entityArchival.ts`, never as a local constant.
  An archived row stores no student-visibility verdict, so a count grouped by `studentVisibilityTier` must read the same with and without the `archived` filter; `research-entity:archived-visibility-verdicts --assert-clean` is the check.
- Archive a `Signal` or a `ResearchEntityRelationship` with `attributedArchiveSet(reason)` from `server/src/models/entityArchival.ts`, which stamps `archived`, `archivedReason` and `archivedAt` and refuses an empty reason; both schemas model the two fields, so a write through the model keeps them (#3935).
  Both schemas register `enforceArchiveAttribution`, so a model update that archives either one with no `archivedReason` throws, and a model update that sets `archived: false` unsets the old attribution.
  A raw collection write bypasses that guard, so it must build its `$set` with `attributedArchiveSet` too, and `models/__tests__/signalAndRelationshipArchivesAreAttributed.test.ts` fails on a raw or model update of either collection whose `$set` archives with no `archivedReason`.
  The archives that predate it are unattributed history and are never backfilled, because nothing records who made them: on Development on 2026-09-30, 3,659 of 7,776 signals and 601 of 612 relationship edges where `archived` is true have no `archivedReason`, absent or empty.
- If a schema change affects Research search, update the relevant index config and rebuild path.
- Add a backfill script in `server/src/scripts/` when existing data needs transformation.
- Migration scripts run with `npx tsx --transpile-only <script>.ts`.
- Verify index settings and sortable/filterable attributes when adding fields used for search, filtering, or ordering.
