# Scraper Deployment Runbook

Status: active runbook

Last updated: 2026-05-22

## Goal

Move scraper data safely from development testing to Beta seeding and then production refresh jobs without overpaying for compute or creating unsupported student-facing access claims.

Use this with:

- [`docs/scraper-audit-guide.md`](./scraper-audit-guide.md) for per-source expectations and audit commands.
- [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md) for source readiness status, WorkPlanner follow-ups, and ranked production tasks.

## Operating Model

Run scrapers as short-lived CLI jobs, not inside the web service process.

The web app can stay on Render while scraper execution remains separate:

- Development testing can run from a local machine against a development database.
- Beta seeding can run from a local machine or one-off job against the Beta MongoDB database.
- Production seeding should run source by source after Beta output is accepted and production backups exist.
- Recurring refresh should use source-specific staggered jobs, not one giant all-scraper cron.

`MONGODBURL` decides the target database. Always read the CLI's printed Mongo target before accepting a run.

Render environments should be stricter than local environments. The Beta Render service is tied to the `beta` branch and should use `MEILISEARCH_INDEX_PREFIX=beta`; the paid production Render service is tied to `main` and should use `MEILISEARCH_INDEX_PREFIX=prod`. Local development can intentionally differ, usually Docker Meilisearch on `localhost:7700` with no prefix or a test prefix. When adding CI/CD or deploy automation, validate dangerous deployed combinations instead of forcing local parity: Beta must not write prod-prefixed Meili indexes, production must not write beta-prefixed indexes, and production Meili rebuild/delete jobs should require explicit production confirmation.

Do not add a separate always-on scraper server yet. Cron and one-off CLI jobs are the right default while Beta is the live testing gate. Promote scraper execution to a worker service only if a real requirement appears: platform cron runtime limits, queueing/retry needs beyond `ScrapeJobLock`, concurrent operator-triggered jobs, or a persistent scheduler/admin UI.

Avoid the fix-scraper-then-backfill loop by treating backfill as promotion, not debugging. A source must pass the audit-first gate in [`docs/scraper-audit-guide.md`](./scraper-audit-guide.md): source health and integrity baseline, bounded dry run, small non-production write with materialization, report review, edge-case regression tests, then chunked scale-up. Broad backfills should continue only when the previous chunk passes the same acceptance bar.

## Data Flow

```txt
Source metadata
  -> ScrapeJobLock for cron runs
  -> ScrapeRun
  -> append-only Observation rows
  -> entity materialization
  -> ResearchEntity/User/research_scholarly_links/etc.
  -> access materialization where evidence supports it
  -> EntryPathway / AccessSignal / ContactRoute / PostedOpportunity
  -> Meilisearch sync or later reindex
```

The current system avoids most duplicate materialized entities through stable slugs, identifiers, derivation keys, and upserts. Observation rows are append-only during a run; identical observations can be superseded, and old superseded rows can be pruned by the compact-retention command after reports are captured. Use WorkPlanner before unattended recurring runs for expensive sources.

## Environment Progression

### 1. Development Testing

Purpose: prove scraper behavior, materialization, and reporting on bounded samples.

Typical dry-run:

```bash
SCRAPER_ENV=development \
  yarn scrape run --source <source-name> --limit 10 --dry-run
```

Typical development write:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  yarn scrape run --source <source-name> --limit 10 --use-cache --auto-materialize
```

Rules:

- Use `--use-cache` only outside production.
- Start with `--limit`, `--only`, `--since`, or source-specific caps.
- For dry-runs, the report's top-level observation/entity counters come from the `ScrapeRun`
  counters; field breakdowns stay empty until a non-dry write persists observations.
- Run `yarn scrape report --run <scrapeRunId>` after every meaningful write.
- Do not promote a source while materialization errors are nonzero or conflicts are unexplained.

### 2. Beta Seeding

Purpose: seed a realistic staging dataset and validate UI/search behavior before touching production.

Preparation:

```bash
yarn --cwd server beta:readiness --confirm-beta-backup --strict
yarn scrape:seed-sources
```

Use `yarn --cwd server beta:readiness` without `--strict` for a diagnostic report. The command is read-only: it reports the Mongo target, accepted-input readiness, gated source posture, source metadata presence, canonical migration residue, and Pathway backend posture.

If semantic Research search is enabled, run the stricter semantic gate before promotion:

```bash
RESEARCH_SEARCH_SEMANTIC=true \
  yarn --cwd server beta:readiness --confirm-beta-backup --strict
```

This blocks unless Meilisearch reports embedded documents in the `researchentities` index.

Then run accepted sources in rollout order:

1. Entity discovery: `ysm-atoz-index`, `yse-centers-index`, `centers-institutes-index`, selected `dept-faculty-roster` departments.
2. Profile metadata: `yale-directory` and `official-profile-enrichment`.
3. Funding enrichment: `nih-reporter` and `nsf-award-search`, as grant/research-entity enrichment only.
4. Compact publication enrichment: `orcid`, identity-backed `openalex`, `crossref`, `europe-pmc`, and `pubmed`.
5. Research-home context: bounded `lab-microsite-description-llm` source lists for missing/weak descriptions after sample review.
6. Access evidence: bounded `lab-microsite-undergrad-llm` source lists after quote review.
7. Gated sources only after blockers clear: broad arXiv, OpenAlex name discovery, and `undergrad-fellowships-recipients` rows without accepted real CSV/manual data.

The scraper CLI and cron runner enforce promotion guards for non-dry Beta/production apply. OpenAlex name discovery is blocked, arXiv must receive `--accepted-review-artifact` containing accepted identity targets, broad LLM chunks must receive `--accepted-review-artifact` unless the operator has already manually bounded the run to 25 targets or fewer, and `dept-faculty-roster` Engineering runs must stay bounded to reviewed `--only` chunks.

Engineering roster exception: the live Yale Engineering data endpoints are usable from Yale VPN. Non-dry Beta/production Engineering roster runs must stay manually chunked with `--only cs` or `--only seas`, `--limit <n>`, and `--offset <n>`; run a matching dry-run first and rerun `scraper:integrity-gate` after each write. The `seas` config uses the Engineering-wide faculty directory endpoint and infers canonical Engineering departments from each faculty title while excluding CS-only rows that belong to the dedicated CS config.

For each Beta source:

- Save the run ID.
- Inspect the report.
- Spot-check materialized records in MongoDB and the app.
- Confirm public surfaces do not expose non-public scraped contact data.
- Confirm expected access artifacts match the source's coverage metadata.
- Add or update focused edge-case tests for every scraper/materialization bug found before increasing scope.

Before switching Pathway search traffic, run:

```bash
PATHWAY_SEARCH_BACKEND=mongo yarn --cwd server pathway:relevance-review
```

Keep runtime on Mongo until the review output is accepted. Rollback remains setting `PATHWAY_SEARCH_BACKEND=mongo`.

Beta can be seeded from a local machine pointed at the Beta database. This is usually cheaper than paying for long-lived cloud compute during initial backfill.

### Beta Data Quality Scorecard

Use the read-only scorecard as the weekly pre-production baseline:

```bash
yarn --cwd server beta:data-quality --include-samples --output /tmp/yale-research-beta-quality.json
```

The scorecard reports the Mongo target, collection counts, canonical reference integrity, URL/email hygiene, expired open posted opportunities, paper-authorship integrity, source-health risk counts, pathway/access/contact coverage, short-description gaps, duplicate entity-name clusters, and compact-retention candidates. It does not mutate Beta data.

Useful flags:

- `--strict`: exits nonzero only when hard blockers are present.
- `--days=<n>`: sets the source-health window; default is `30`.
- `--live-links --link-sample-size=<n>`: runs a bounded sampled live-link check.
- `--include-samples`: includes small samples for warning and error categories.

Production-copy readiness requires `summary.errorCount = 0`. Warnings can remain only when they are documented, product-accepted, or queued for explicit cleanup. Future cleanup commands should stay dry-run-first and require `--apply`.

### 3. Production Seeding

Purpose: populate production only after Beta output is accepted.

Required before the first production write:

- Atlas backup or restore point exists.
- The latest `yarn --cwd server beta:data-quality --strict --include-samples` has no hard blockers, or the blocker deferral is explicitly accepted before copy.
- `yarn --cwd server scraper:integrity-gate --include-samples` exits 0, or the exact duplicate/current-state failures are resolved before promotion.
- If semantic Research search is enabled, `RESEARCH_SEARCH_SEMANTIC=true yarn --cwd server beta:readiness --confirm-beta-backup --strict` exits 0.
- Source readiness is recorded in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md).
- Meilisearch sync or reindex plan is ready.
- Production command includes `SCRAPER_ENV=production`, `CONFIRM_PROD_SCRAPE=true`, and `--release`.

Production command shape:

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn scrape run --source <source-name> --release --auto-materialize
```

Rules:

- Do not use `--use-cache` with `--release`; production guardrails disable it.
- Run one source at a time.
- Prefer a bounded first production pass for expensive or broad sources.
- Run `report` immediately and inspect warnings before moving to the next source.
- Treat Meilisearch failures as non-blocking for Mongo correctness, then reindex or batch-sync after accepted writes.

## Recurring Refresh

Recurring jobs should be source-specific and staggered. Do not schedule a single all-source weekly job.

Render Cron Jobs should use the cron-safe entrypoint:

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn scrape cron --source <source-name> --release
```

The cron command:

- Acquires a source-level `ScrapeJobLock` keyed by `production + sourceName`.
- Skips cleanly with exit code `0` if another cron already owns that source lock.
- Refuses disabled `Source` rows unless `--force-disabled` is passed for manual recovery.
- Runs the scraper with `triggeredBy=cron`, materializes immediately, prints the run report, and exits nonzero if materialization errors are reported.
- Heartbeats the lock during long runs and releases it with the last `ScrapeRun` id on success or failure.

Use `--output <path>` to save the run report JSON from a cron run.

Suggested starting cadence:

| Source | Cadence | Notes |
| --- | --- | --- |
| `ysm-atoz-index` | weekly | Entity discovery only. |
| `yse-centers-index` | weekly | Entity discovery only. |
| `centers-institutes-index` | weekly or biweekly | Broad member extraction; stagger separately. |
| `dept-faculty-roster` | weekly by department group | Use source-specific `--only`/config where available. |
| `yale-directory` | weekly | Broad directory paging; watch runtime. |
| `nih-reporter` | weekly or monthly | Enrichment only; conflicts should remain understood aggregate churn. |
| `nsf-award-search` | weekly or monthly | Enrichment only. |
| `openalex` | weekly after WorkPlanner | Identity-backed only; keep name-only discovery off for recurring jobs. |
| `crossref` | weekly or monthly | DOI-backed compact-link destination hydration; expect permanent 404s for non-Crossref DOI registrants. |
| `europe-pmc` | monthly/as-needed | Compact publication enrichment only; keep chunks bounded and report-reviewed. |
| `pubmed` | monthly/as-needed | MED-filtered compact publication enrichment only; keep chunks bounded and report-reviewed. |
| `arxiv` | gated/manual | Do not schedule broad arXiv until live 429/timeout behavior and accepted identity targets pass smoke tests; any non-dry run needs an accepted artifact. |
| `lab-microsite-description-llm` | weekly after WorkPlanner | Paid/LLM source for missing/weak ResearchEntity descriptions; must not emit access artifacts; broad runs need accepted reviewed slugs. |
| `lab-microsite-undergrad-llm` | weekly after WorkPlanner | Paid/LLM source; use stale-only work planning and accepted reviewed slugs before recurring cron. |
| `undergrad-fellowships-recipients` | monthly/manual | Requires accepted real CSV/manual data. |

Use separate Render Cron jobs per source or per source group and stagger start times. If a job needs more than the platform's cron runtime limits, split it into batches or use a background worker temporarily for that backfill only.

### Compact Observation Retention

Run retention as its own scheduled job only after inspecting a dry-run:

```bash
yarn scrape prune-observations --older-than-days 30 --keep-runs 3
```

Apply mode requires an explicit production confirmation:

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn scrape prune-observations --apply --older-than-days 30 --keep-runs 3
```

The retention command deletes only old `superseded: true` observations. It always preserves active observations, recent observations inside the age window, and observations attached to the latest retained runs per source.

## Cost Controls

Use these controls before spending cloud or API money:

- Run the initial backfill locally against Beta when practical.
- Use `--limit`, `--only`, `--since`, and source-specific caps during the first pass.
- Keep `--discover-openalex-authors` opt-in.
- Keep LLM sources gated until the exact target list is accepted.
- Use `--use-cache` for development reruns only.
- Verify WorkPlanner metrics for broad or paid recurring sources before unattended cron.

### Storage And Repeated-Work Policy

Recurring scrapers must not behave like full re-imports. Before a broad, paid, or recurring source fetches external pages, calls an API, or invokes an LLM, it should answer two questions:

1. Is the target fresh enough according to WorkPlanner?
2. If the target is fetched, did the emitted evidence actually change?

Use WorkPlanner to skip fresh targets before external work. Use `ScrapeSnapshot` only for development reruns with `--use-cache`; production release runs bypass that cache. Keep observation retention dry-run-first and delete only old `superseded: true` rows after reports are captured and reviewed.

Do not skip active changed evidence. If a value changes, insert the new observation and let supersession preserve the latest active value. If a full audit needs to ignore freshness, use the explicit `--ignore-work-planner` escape hatch and record why the extra cost is justified.

## Report Checklist

After every non-dry run:

- `run.status` is `success` or an understood `partial`.
- `materialization.errors` is `0`.
- Conflicts are expected and documented.
- Access artifact counts match the source's purpose.
- Discovery-only sources create no undergraduate-access claims.
- `observations.duplicateRate` is understood.
- WorkPlanner metrics show planned, fetched, skipped-fresh, and missing-identifier targets for broad/paid sources.
- Fetch metrics do not show systemic blocking or selector breakage.
- Student-facing pages render the new data correctly.

## Rollback

Before production seeding, prefer an Atlas backup over clever cleanup.

If a production run is bad:

1. Disable the scheduled job or stop the manual rollout.
2. Do not run more sources on top of questionable materialized data.
3. For minor field-quality issues, use manual locks or a fixed rerun after inspection.
4. For broad bad materialization, restore from the pre-run Atlas backup.
5. Rebuild or resync Meilisearch after restoring MongoDB.

`Source.enabled=false` blocks cron execution by default. Use `--force-disabled` only for an explicit manual recovery run after checking the source-health report.
