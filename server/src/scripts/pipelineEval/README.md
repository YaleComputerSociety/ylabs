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
