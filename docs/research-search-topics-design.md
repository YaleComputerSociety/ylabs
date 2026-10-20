# Research search: page-quoted topics and a judged relevance benchmark

Status: proposed, awaiting owner approval (2026-10-18).
Scope: student research search (`POST /api/research/search` through `searchResearchGroupsViaMeili`).
Nothing described here has been written to any environment.

## Goal

Make research search return the right labs for the short topic queries students actually type.
The goal is search quality, measured by a student-query benchmark, not description quality for its own sake.

## What students do

Read-only aggregate of Production `analytics_events`, data since 2026-07-06, logged-in searches only.

- 736 research searches in September and October 2026, about 115 students in October.
- 52% of searches are filter-only: departments, school, and entity type.
- 355 text queries: 59% are one word and 35% are two words, and none is phrased as a question.
- About 79% are topics or fields ("robotics", "machine learning", "rna", "psychology", "parkinsons"), and about 21% are a person's or lab's name.
- 8 of 355 text queries returned zero results, so the problem is ordering, not recall.
- A topic query matches a median of about 107 rows.
- 81% of text searches are followed by a profile open within 30 minutes.

The search box is a topic search, not a question box.

## How the measurements were made

A throwaway Meilisearch (the same version as Development, v1.13.3) was loaded with Development's 4,226 index documents and its exact live settings.
The real `searchResearchGroupsViaMeili` code ran against it with the host overridden, so every number below is the full production ranking path.
It reproduced live Development ranks on 175 of 180 queries.

Three query sets were used.

- Set A, 180 queries written per sampled row (three kinds plus two topic kinds); partly leaky, because its author saw the sampled rows' descriptions.
- Set B, 144 held-out queries written only from each row's own web pages, blind to every description.
- Set C, 63 distinct real Production topic queries, scored by graded relevance (0 to 3) of the pooled top 10 from seven rankings (1,259 judged pairs, judged blind to which ranking produced them).

Set C judge agreement: an independent second judge re-graded 200 random pairs and matched exactly on 84%, within one grade on 100%, and on relevant-versus-not on 95% (quadratic weighted kappa 0.92).
Both judges are the same model family with the same guide, so this establishes consistency, not agreement with a person.
An owner calibration on about 30 pairs is still required before the benchmark is trusted as ground truth.

## Findings

### Ranking changes do not move real queries

On Set C, today's search scores nDCG@10 0.819 and precision@10 0.69.

| Change | nDCG@10 delta | 95% CI |
| --- | --- | --- |
| Description-first embedding template, 4,000-byte cap | +0.009 | -0.004 to +0.024 |
| MeSH entry-term synonyms (19,498 keys) | +0.003 | 0.000 to +0.007 |
| Semantic leg always on, `frequency` fallback | -0.008 | -0.023 to 0.000 |
| Topics re-derived from the indexed description, 557 rows | 0.000 | -0.013 to +0.011 |
| Pure keyword ranking | -0.160 | -0.217 to -0.112 |
| Pure semantic ranking | -0.088 | -0.144 to -0.035 |

The application's own fusion of a keyword leg and a semantic leg beats either leg alone by a wide margin, so it stays.
`semanticRatio` on the primary hybrid query does not change what students see: setting it to 0, 0.5 or 1 left the top 10 identical on 62 or 63 of 63 queries, because the final order comes from the app-side fusion.

### Topics from a lab's own pages are the lever

On Sets A and B, the rank of one specific row is the measure, which matches the 21% of queries that look for a known lab and the case where a student types a subject only a few labs cover.
For the 36 sampled rows, with every other row unchanged:

| Topics on the 36 rows | Set B top-5 delta | Set A top-5 delta |
| --- | --- | --- |
| Derived blind from source pages, first run | +19 (CI +8 to +31, p = 0.0002) | +18 (p < 1e-7) |
| Derived blind from source pages, independent replication | +19 (CI +8 to +30, p < 1e-5) | +21 (p < 1e-7) |
| Same rules applied to the indexed description | +7 (not significant) | not run |

The gain is broad: 16 rows gain, 17 are flat, and 3 lose, and the top three rows contribute 7 of the 19.
Reformatting text the index already holds does nothing, because those words are already searchable.
The gain comes from bringing the subject the lab's own pages state into the highest-weight field.

Single-field ablations with hand-checked content (Set B) rank the fields: topics +24, card +11, description +10, methods +5; all four together equal topics alone, because each adds the same subject words.

### Why topics are wrong today

An audit of the 254 topics served on the 36 rows found 44% usable.
The recurring defects:

- MeSH headings copied from medical-school profiles (`Neoplasms, Prostatic`, `Frail Elderly`), on 11 of 36 rows.
- The main subject missing from the topic list on 28 of 36 rows.
- Phrases split by extraction into fragments (`central`, `autonomic`, `innate`).
- Methods, populations and course names stored as topics.

The resolver favours the sources producing the MeSH lists: `ysm-mesh-keyword` and `ysm-faculty-directory` carry `defaultWeight` 0.8, above `lab-microsite-description-llm` at 0.6.

### Coverage is a separate gap

8 of the 63 real queries have fewer than five relevant rows anywhere in the corpus (for example drones, VLSI, multi-agent systems, PCOS, food systems), and only one to five rows mention those terms at all.
No ranking or topic change fixes a lab the corpus does not describe; it needs a coverage audit.

### Retracted

An earlier note called the served methods dedupe a bug.
It is intentional (#1970): a term is served once, under topics, rather than in both lists, and the search index keeps every method.
The real defect is method words stored as topics, which rule T3 below addresses.

## Design

### 1. Page text stored by code, topics derived at materialization

The 2026-10-18 decision that every lane is deterministic (#5296) splits the work in three, so no lane calls a model.

- Lane `research-page-text` (`sources/researchPageTextScraper.ts`, manual-only): for research entities, fetches every page the row cites with code, in a fixed order: its lab site, up to two research subpages the lab site links, its official profile(s), then the other citations and the page its description is credited to, at most six, through the description lane's fetch path, URL refusals and person-page match.
  Reading only the first citation skipped the official profile on rows that also have a lab site, which held a median row to 4.0 KB against 12.4 KB and gold-topic word coverage to 0.80 against 0.93.
  It keeps each page's text (`utils/researchPageText.ts`) less site chrome, navigation, footers, contact blocks, publicity regions, other units' teaser cards and the sections headed as publications, a bibliography, a CV or contact details; research-headed sections go first, and publication, CV and contact lines are dropped wherever they sit.
  News, people and teaching sections stay, because a lab often states its subject there; an earlier version dropped them and kept a median 3.9 KB of a 12.4 KB page.
  Contact details are redacted as ingest redacts prose, and the text is capped at 16,000 characters per row, shared fairly across pages and cut at sentence ends.
  It stores one cited `researchPageText` observation (`[{ url, text }]`) plus a content hash; the same page yields the same observation, and an unchanged reading is skipped.
  The field is observation-only and generic, so #5296 step 4 (descriptions written from stored text) can read it too; it is never projected onto the row, served or indexed.
- Command `research-topics:derive` (`scripts/deriveResearchTopics.ts`): reads stored `researchPageText` observations only and never fetches.
  It keys each reading by an input hash of the text, the prompt hash and the model, and on a cache miss calls the model only on an apply that passes `--confirm-research-topics-derivation`, targets Development and carries `OPENAI_API_KEY`; a dry run makes no call and reports the planned calls.
  One model call per distinct text returns 6 to 8 short topics and one field-level topic under rules T1 to T7, each with a short verbatim quote and the URL of the page it came from.
  The raw reading is stored in `research_topics_derivations`, an environment-local cache with no row identifier, so a re-run makes no new paid call.
- Materializer: when resolving `researchAreas`, it reads the cached reading for the row's current page text (no model call) and judges it then, against that stored text.
  A quote must appear verbatim on the page it names (boundary-anchored matching); every content word of a topic must share an inflectional stem with some word of the row's stored pages, and the field topic needs only its quote.
  A topic that fails is dropped, not repaired, and the deterministic post-filters reject inverted index-heading forms, split fragments, acronym-only chips and bare generic words while keeping the main subject first.
  Because the filters run here, a filter change re-derives every row at no model cost; the derived provenance records the full input hash, the hash of the text alone and the filter contract.
  The list is added as a derived candidate labelled `research-page-topics-derived` in `fieldProvenance`, and never written as an observation.
  A stored list credited to a derivation is withdrawn only when the row's current page-text reading exists and its text hashes differently from the text the list was derived from.
  A prompt, model or filter change withdraws nothing: the stored list stands until a reading under the new inputs replaces it through normal resolution, so a routine prompt edit cannot empty the corpus before a re-derive.
  Without a reading or a cache entry, as on Beta and Production, it is kept unchanged.
  A derived reading reaches a row on its next resolve; `research-entity:rematerialize --only-fields=researchAreas` runs that on demand.

Rules:

- T1. Derive topics from the row's research statement on its own pages; MeSH and directory tags are hints only and are never copied as index headings.
- T2. The first topic names the main subject in words a student types: disease, organ, organism, phenomenon, place or period.
- T3. A topic is a research subject, not a method, population, cell type alone, setting, outcome, role, course, award or journal; a split phrase gets its head noun back or is dropped.
- T4. Only current research; finished or past-tense projects and biography are excluded.
- T5. Keep real research terms (glioma, primary cilium, pyruvate kinase, LiDAR); spell out acronyms unless students search by them (AI, COVID, DNA, MRI, OCD); no internal project or tool names; no person names.
- T6. Plain noun phrases, one per concept, no bare generic word when a specific topic covers it, ending with exactly one field-level topic.
- T7. A row whose pages state no research subject gets no topics.

### 2. Resolver precedence

A page-quoted list outranks `ysm-mesh-keyword` and `ysm-faculty-directory` lists for `researchAreas`, in the same way a graduate-track list already ranks below every other list (#4028).
The MeSH and directory lists stay stored as evidence and can corroborate a topic, but no longer win the field.
Topic canonicalization to `TaxonomyTerm` keeps working, and must not reorder the first topic.

### 3. A judged relevance benchmark

A read-only harness scores the real ranking path against a frozen judged set and reports nDCG@10 and precision@10 per query and overall.

- Queries: real Production topic queries, names and lab names removed.
- Judgements: graded 0 to 3 on the pooled top 10 of keyword-only, semantic-only and fused rankings, by a written guide; the owner calibrates the judge on a sample.
- Use: advisory, never a merge gate, compared against a stored baseline, in line with how `journey:eval` treats rates.
- Privacy: Production queries are student input, so the committed fixture holds only queries searched at least twice, after the person-identifier scan and owner review; anything else stays outside the repository.

A second instrument stays separate: the lane scorecard over frozen pages (`lane_benchmark_pages`) labelled with the sampled rows' topic lists, which moves only when lane code changes.

## Rollout

This is a stored-data change, so merging the code changes nothing a student sees.

1. Land the benchmark harness and the lane code behind the normal write guard.
2. Run `research-page-text` on Development scoped to the 557 rows that compete for the sampled rows' top five, with `ALLOW_NON_PROD_SCRAPER_WRITES=true` and `--exhaustive`.
3. Run `research-topics:derive` as a dry run, then apply it on the same rows, then rematerialize them for `researchAreas` and run `development:search:sync` (the index shape does not change, so no rebuild).
4. Measure Sets B and C through the real route on Development against today's baseline, and grade a random sample of the new topics by hand.
5. If the gain holds, run the lane corpus-wide, then add it to the weekly sweep.
6. Beta and Production receive the change through normal promotion.

The work is done when Development is measured and verified, not when the pull request merges.

## Cost

About 4,226 rows at roughly 3,000 input tokens per row (the stored text is capped at 16,000 characters, about 4,000 tokens) is about 12 to 17 million tokens per full pass, a few dollars on a small model.
A derivation is paid for once per distinct text; a re-run, a re-materialize or a promotion makes no call, and only rows whose stored text changed are read again.
Storage is at most about 16 KB of text per row in one live observation, about 68 MB for the whole corpus at the cap and about 45 to 50 MB at the bench's median page, plus superseded readings until `observations:prune-dead` runs and about 1 to 2 KB per cached derivation.
The scoped first run on 557 rows costs well under a dollar.

## Risks

- The model run is not repeatable call to call, so one pair of runs is not an instrument; the frozen lane scorecard is, and the cache makes a stored reading stable until its text changes.
- Page-derived topics share vocabulary with Set B, whose queries were also written from those pages; Set A, written from different material, shows the same gain.
- A lab with thin or stale pages gets few topics; T7 then leaves it empty rather than inventing topics.
- Judges are model graders until the owner calibration is done.

## Not in scope

The ranking-pipeline changes above, rerankers, fusion re-weighting and an embedding-model upgrade are deferred until topic content is fixed, because none moved real queries.
The coverage gap for niche engineering and computer science topics needs its own audit.

## Open decisions

1. The lane outranks topics currently won by `lab-microsite-description-llm`, whose runs are held by another session (#5020); confirm that this is acceptable or coordinate first.
2. Approve the scoped Development run (paid model calls, well under a dollar) after the code lands.
3. Approve committing the filtered real-query fixture, or keep it outside the repository.
