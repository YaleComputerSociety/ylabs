# Pipeline orchestration eval harness

Read-only replay harness that scores competing pipeline-orchestration strategies over the current corpus so architecture choices are decided on measured efficiency, accuracy, and churn rather than intuition.
It never writes to live collections; description strategies draw text from the retained observation log and only synthesize where the materializer would, so the LLM is held as a fixed variable across strategies.

Run it against a data-profile DB (Development) from `server/`:

```bash
yarn eval:pipeline --sample=800 --llm --gate --trial=2 --output="$TMPDIR/pipeline-eval.json"
```

Flags:

- `--scope=all` or `--scope=school:<name>` scopes the accuracy sample; `--sample=<N>` draws a random sample; `--limit=<N>` takes the first N.
- `--llm` enables gpt-5-mini card synthesis in the decide-late strategies (same path as the materializer); omit for a fully deterministic run.
- `--gate` recomputes student visibility via the real gate (dry-run) and breaks the not-ready backlog down by which lever addresses it (description vs duplicate vs lead).
- `--concurrency=<N>` bounds synthesis concurrency; `--output=<path>` writes the JSON report under `$TMPDIR` or `./tmp`.

Strategies scored: C0 (status-quo baseline over the stored collection), C1 (prevention-first identity clustering, basic vs rich keys), C2 (decide-late quality-preferring resolution over the full retained log), and C3 (hybrid of C1 and C2).
Dedup accuracy is scored against the durable merge records (`research_entity_redirects`, `canonicalGroupId`) as labeled positives.

## Fuzzy-match labeled set

Read-only measurement backbone for the fuzzy matcher, scoring it on evidence rather than intuition.
It never writes to live collections.

```bash
yarn fuzzy:labeled-set
```

The CLI builds the ground-truth clusters from the durable merge records (redirects plus the `canonicalGroupId` transitive closure, with researcher-dedupe records kept in a separate namespace) and prints a JSON report of cluster counts, positive within-cluster pairs, and a cluster-size histogram.

`fuzzyMatchMetrics.ts` holds the pure, dependency-free primitives the report and the matcher share: `buildGroundTruthClusters` and `clusterPairs` for labeled positives, `buildLabeledNegatives` for same-name-different-person hard negatives drawn from the quarantines, and `pairwiseMetrics` (precision, recall, F1), `pairCompleteness`, and `clusterBcubed` for scoring predictions.

## Fuzzy residual matcher

Report-only matcher that breaks the 0.60 blocking-recall ceiling with loose candidate generation plus a Fellegi-Sunter-style scorer.
It is additive and never auto-merges; nothing is written to live collections.

```bash
yarn fuzzy:residual-report --sample=800
```

Flags: `--sample=<N>` draws a random sample, `--limit=<N>` takes the first N, and `--include-archived` includes archived entities for a truer recall estimate since merge losers are often archived.

`fuzzyResidualMatcher.ts` generates candidate pairs by blocking on surname metaphone, significant org tokens, department, and research area, plus embedding cosine ANN, then scores each pair.
The scorer sums per-feature Fellegi-Sunter weights only for comparable features (both sides carry the data), applies hard vetoes for conflicting first names and incompatible entity types, and assigns each pair an `auto`, `review`, or `discard` band via two probability thresholds.
The CLI prints a JSON report of candidate/auto/review counts and measures blocking recall and auto-band precision against the labeled positives and same-name-different-PI hard negatives.
