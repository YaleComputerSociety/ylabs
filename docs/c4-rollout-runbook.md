# C4 engine rollout runbook

Status: active operator reference

C4 is the consolidated data-pipeline engine tracked in issue #2063 ("one resolver plus one engine, not per-domain repair").
It replaces the decide-at-each-point, repair-after-the-fact shape with two levers: prevention-first identity resolution and decide-late projection over a lossless observation log.
Every behavior change ships behind an off-by-default flag, so `beta` behavior is unchanged until an operator flips a flag in a target environment.

This runbook is the go-live procedure and the map of what shipped.
It is validated Development-first; flipping a flag in Beta or production is an explicit operator launch decision, not an automatic step.

## What shipped

The engine was built and merged as a series of behavior-safe pull requests.

### Prevention lever (resolve-at-mint)

- Unified canonical-alias ledger and service (#2087): a delete-safe, multi-key, cycle-guarded `canonical_aliases` collection that generalizes `research_entity_redirects`.
- `resolveCanonical` orchestrator plus per-type key extractors (#2094): strength-ordered resolution that reuses the existing dedupe guards verbatim and never merges (it returns existing, mint, ambiguous, or blocked).
- Resolve-at-mint wiring for users (#2096) and for research entities and fellowships (#2098): the materializer consults `resolveCanonical` before minting, so a duplicate resolves to its canonical instead of being minted and merged later.

### Decide-late lever (lossless log, late projection)

- Pure `projectFromLog` (#2082): the materializer became load, project, diff, write, with the field projection extracted into a pure function.
- Unified sanitizer (#2104): one deterministic `sanitizeProjectedField` on the write side, so the serve-time sanitizer is a no-op on projected output.
- Read-time `collapseLatestWins` (#2106): latest-wins fields collapse to newest-per-source in the projection.
- Lossless ingest (#2108): write-time prose dropping and latest-wins supersession stop, the projection reads the full retained log, and the collapse plus a ranked quality preference decide late.
- Idempotent diff-skip (#2120): an unchanged re-projection skips the write and the search re-sync, so routine full re-projection is churn-free.

### Fuzzy residual matcher (break the 0.60 recall ceiling)

- Labeled-set and metrics backbone (#2110): positives from merge records, hard negatives from same-name quarantines, and pairwise, pair-completeness, and cluster B-cubed metrics.
- Feature library (#2112): Jaro-Winkler, token ratios, Soft-TF-IDF, Metaphone, first-name compatibility, Jaccard, PI-overlap, and cosine, implemented inline with no new dependency.
- Residual matcher (#2114): loose blocking including embedding-ANN candidates plus a Fellegi-Sunter-style scorer with two-band thresholds and hard vetoes, report-only.

### LLM leverage (gpt-5-mini)

- Prompts as `.md` files self-versioned by content hash (#2092, #2102): edit the prompt file to update the model; the content-hash gate re-extracts only the affected entities, with no manual version bump.
- Description-coverage synthesizer (#2116): a grounded gpt-5-mini synthesizer for entities blocked only on a thin or missing description, fail-closed on overlap, quality, and contact gates, writing low-confidence evidence-first observations.
- Disambiguation judge (#2118): a propose-only judge over the fuzzy review band with asymmetric authority (SAME only on high-confidence grounded evidence with no first-name conflict, DIFFERENT always).

### Measurement

- Replay eval harness (#2078): the read-only tool that scores C0 through C3 over the corpus and chose C4 on measured performance.

## Flags

All three are read from the environment and default OFF.
When unset, the pipeline behaves exactly as before each change.

| Flag | Enables | Notes |
| --- | --- | --- |
| `C4_RESOLVE_AT_MINT_USERS` | Resolve a user to its canonical (netid, email, ORCID) before minting | Closes the after-mint User email/ORCID dedupe gap |
| `C4_RESOLVE_AT_MINT_ENTITIES` | Resolve a research entity or fellowship to its canonical before minting | Honors the non-demoting invariant (defers to mint if resolving would demote a tier) |
| `C4_LOSSLESS_INGEST` | Stop write-time prose drop and latest-wins supersession; project over the full retained log | Store-changing; relies on `collapseLatestWins` plus the ranked quality preference |

Order to flip on a target environment: backfill the canonical aliases first, then enable the resolve-at-mint flags, then enable lossless ingest.

## New CLIs

Run from `server/`.
Data-writing CLIs are dry-run by default and require an explicit confirm flag plus a Development database guard to apply.

- `yarn data:backfill-canonical-aliases` (dry-run; `--apply --confirm-canonical-alias-backfill` on Development): seed the alias ledger from existing redirects and dedupe tombstones.
- `yarn research-entity:coverage-synthesis` (dry-run; `--apply --confirm-coverage-synthesis` on Development): grounded gpt-5-mini description synthesis for description-blocked entities; requires a seeded `coverage-synthesis-llm` source.
- `yarn fuzzy:labeled-set`: report the labeled positives and negatives and their counts.
- `yarn fuzzy:residual-report`: run the fuzzy matcher over a scope and report pair-completeness and precision and recall against the labeled set.
- `yarn eval:pipeline --sample=<N> [--llm] [--gate]`: score C0 through C3 (efficiency, accuracy, churn) over a random sample.

## Dev-first go-live sequence

1. Seed the `coverage-synthesis-llm` source in the Development database (the coverage CLI errors clearly if it is absent).
2. Backfill the canonical aliases: run `yarn data:backfill-canonical-aliases` dry-run, review, then `--apply --confirm-canonical-alias-backfill`.
3. Set `C4_RESOLVE_AT_MINT_USERS` and `C4_RESOLVE_AT_MINT_ENTITIES` in the Development environment.
4. Set `C4_LOSSLESS_INGEST` in the Development environment.
5. Run a full re-projection (`yarn research-entity:rematerialize` over the corpus, or the exhaustive Development sweep).
6. Run the student-visibility gate and let it sync Meilisearch.
7. Measure: `yarn eval:pipeline --sample=800 --llm --gate` and `yarn fuzzy:residual-report`, and compare against the C0 baseline below.
8. Only after the Development numbers hold, promote to Beta and then production by setting the same flags there; this is an explicit operator launch decision.

## Measured gains

The eval harness measured these on the Development corpus (1,144,695 observations projecting to 6,234 research entities; 4,596 live).

| Metric | C0 baseline | C4 (measured) |
| --- | --- | --- |
| Card-complete rate | 0.585 - 0.594 | ~0.70 (+10 points, LLM-enabled decide-late plus synthesis) |
| Student-ready rate | ~0.49 | improves with the description and duplicate levers |
| Avoided mints (churn prevented) | 0 (1,161 minted then merged) | 595 with basic keys, 700 with rich keys (of 1,158 known merges) |
| Dedupe recall | n/a | 0.514 basic, 0.605 rich keys |

Not-ready blocker breakdown (why the other ~50% is held), from the gate recompute (tier-match rate 0.965):

- Description-addressable: ~47 percent (C4 description-coverage synthesis lever).
- Duplicate-blocked: ~34 percent (C4 prevention and fuzzy dedup lever).
- Lead-blocked: ~13 percent (needs roster or lead resolution, outside C4).
- Other hard-blocked: ~6 percent (correctly suppressed shells).

The decide-late lever alone recovers cards with zero regressions across repeated random seeds; the description-coverage synthesizer supplies the larger card-completeness gain.
The two C4 levers together address roughly 80 percent of the not-ready backlog; the remaining ~20 percent needs lead resolution or is correctly suppressed.

## Rollback

Set the C4 flags OFF in the affected environment.
Because every change is off-by-default and the prior code paths are preserved, turning the flags off restores the previous behavior.
Lossless-ingest observations are additive and evidence-first, so a genuine scraped value always outranks a retained or synthesized one; no destructive cleanup is required to roll back.

## References

- Decision: issue #2063, one resolver plus one engine, not per-domain repair.
- Pull requests: #2078, #2082, #2087, #2092, #2094, #2096, #2098, #2102, #2104, #2106, #2108, #2110, #2112, #2114, #2116, #2118, #2120.
