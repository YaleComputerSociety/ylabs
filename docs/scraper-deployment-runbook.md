# Scraper Deployment Runbook

Status: active runbook

Last updated: 2026-05-15

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

## Data Flow

```txt
Source metadata
  -> ScrapeJobLock for cron runs
  -> ScrapeRun
  -> append-only Observation rows
  -> entity materialization
  -> ResearchGroup/User/Paper/Fellowship/etc.
  -> access materialization where evidence supports it
  -> EntryPathway / AccessSignal / ContactRoute / PostedOpportunity
  -> Meilisearch sync or later reindex
```

The current system avoids most duplicate materialized entities through stable slugs, identifiers, derivation keys, and upserts. Observation rows are append-only during a run; identical observations can be superseded, and old superseded rows can be pruned by the compact-retention command after reports are captured. Use the WorkPlanner task before unattended recurring runs for expensive sources.

For program/fellowship sources, run dry-run parser checks first, review application/deadline/source metadata, then run non-production writes with auto-materialization. Confirm funding-only rows do not create access artifacts, and structured-entry rows create at most one pathway, one application signal, one official route, and one posted-opportunity instance per source-backed program cycle.

## Environment Progression

### 1. Development Testing

Purpose: prove scraper behavior, materialization, and reporting on bounded samples.

Typical dry-run:

```bash
SCRAPER_ENV=development \
  yarn scrape run --source <source-name> --limit 10 --use-cache
```

Typical development write:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  yarn scrape run --source <source-name> --limit 10 --use-cache --auto-materialize
```

Rules:

- Use `--use-cache` only outside production.
- Start with `--limit`, `--only`, `--since`, or source-specific caps.
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

Then run accepted sources in rollout order:

1. Entity discovery: `ysm-atoz-index`, `yse-centers-index`, `centers-institutes-index`, selected `dept-faculty-roster` departments.
2. Profile metadata: `yale-directory`.
3. Enrichment: `openalex`, `nih-reporter`, `nsf-award-search`, `arxiv` where relevant.
4. Access evidence: bounded `lab-microsite-undergrad-llm` source lists.
5. Gated sources only after blockers clear: `undergrad-fellowships-recipients`.

For each Beta source:

- Save the run ID.
- Inspect the report.
- Spot-check materialized records in MongoDB and the app.
- Confirm public surfaces do not expose non-public scraped contact data.
- Confirm expected access artifacts match the source's coverage metadata.

Before switching Pathway search traffic, run:

```bash
PATHWAY_SEARCH_BACKEND=mongo yarn --cwd server pathway:relevance-review
```

Keep runtime on Mongo until the review output is accepted. Rollback remains setting `PATHWAY_SEARCH_BACKEND=mongo`.

Beta can be seeded from a local machine pointed at the Beta database. This is usually cheaper than paying for long-lived cloud compute during initial backfill.

### 3. Production Seeding

Purpose: populate production only after Beta output is accepted.

Required before the first production write:

- Atlas backup or restore point exists.
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
| `openalex` | weekly after WorkPlanner | Keep name-only discovery opt-in and page-capped. |
| `arxiv` | weekly with `--since` | Recent research activity only. |
| `lab-microsite-undergrad-llm` | weekly after WorkPlanner | Paid/LLM source; use stale-only work planning before recurring cron. |
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
- Complete the WorkPlanner cost-control tasks in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md) before unattended recurring paid/broad jobs.

## Report Checklist

After every non-dry run:

- `run.status` is `success` or an understood `partial`.
- `materialization.errors` is `0`.
- Conflicts are expected and documented.
- Access artifact counts match the source's purpose.
- Discovery-only sources create no undergraduate-access claims.
- `observations.duplicateRate` is understood.
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
