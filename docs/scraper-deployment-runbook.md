# Scraper Deployment Runbook

Status: active runbook

Last updated: 2026-05-25

## Goal

Move scraper data safely from development testing to Beta seeding and then production refresh jobs without overpaying for compute or creating unsupported student-facing access claims.

Use this with:

- [`docs/research-data-pipeline.md`](./research-data-pipeline.md) for the stable evidence-to-product data flow.
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
  -> ResearchGroup/User/Paper/etc.
  -> access materialization where evidence supports it
  -> EntryPathway / AccessSignal / ContactRoute / PostedOpportunity
  -> Meilisearch sync or later reindex
```

The current system avoids most duplicate materialized entities through stable slugs, identifiers, derivation keys, and upserts. Observation rows are append-only during a run; identical observations can be superseded, and old superseded rows can be pruned by the compact-retention command after reports are captured. Use the WorkPlanner task before unattended recurring runs for expensive sources.

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

This is a manual promotion gate. Do not run it from the Render web service process, do not mix copy and delta strategies in the same promotion, and do not enable recurring cron until the smoke checklist passes.
Production writes are off by default: no operator should run a production copy, scraper write, retention apply, or recurring job unless this gate is explicitly recorded and the command includes the required production confirmations.

### Production Promotion Gate Checklist

Record each item in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md) before changing production data:

- [ ] **Backup and restore drill:** Create the fresh Atlas backup or restore point, name its identifier and rollback owner, and confirm the restore drill or exact restore procedure has been exercised for the target cluster.
- [ ] **Dataset versioning:** Assign a promotion dataset version such as `prod-promote-YYYY-MM-DD-<lane>` and attach it to the accepted Beta snapshot or per-source production run IDs, saved reports, and Meili rebuild outputs.
- [ ] **Copy-vs-delta decision:** Choose exactly one lane: accepted Beta copy or guarded production delta. Do not mix the lanes in one promotion window.
- [ ] **Privacy payload gate:** Sample public API payloads before promotion and confirm they exclude non-public scraped contact data, suppressed/operator-review programs, raw observations, internal review notes, and production-only usage/session data.
- [ ] **Meili sync and rollback:** Decide whether production traffic stays on Mongo or switches to Meili after rebuild; keep `PATHWAY_SEARCH_BACKEND=mongo` as the rollback posture until production relevance review and document counts are accepted.
- [ ] **Smoke routes:** Assign an owner for `/api/config`, `/api/research/search`, `/research/:slug`, `/api/pathways/search`, `/opportunities/:id`, `/programs` or `/fellowships`, unauthenticated admin `401`, and removed legacy route checks.
- [ ] **No recurring writes by default:** Keep production cron, compact-retention apply mode, and broad/paid source reruns disabled until the manual promotion smoke checklist passes.

Required before any production copy or write:

- Atlas backup or restore point exists.
- The operator can name the exact restore point and the person who can restore it.
- Source readiness is recorded in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md).
- The Beta trust-audit caveats in the roadmap are either fixed or explicitly accepted for this release.
- Production storage posture is decided: provision enough Atlas storage for raw OpenAlex observations, or keep compact retention after saved reports.
- Promotion lane is chosen and recorded: accepted Beta copy or guarded production delta.
- Promotion dataset version is recorded and tied to accepted reports or source run IDs.
- Privacy payload gate is accepted for public student routes.
- Meilisearch sync or reindex plan is ready.
- Smoke checklist owner and rollback owner are known.

### Operator Decision Packet

Fill this packet before any production copy, guarded production write, Meilisearch backend switch, or recurring cron enablement. The current default strategy is Lane A: keep Beta as the production-candidate dataset and copy the accepted seeded data only after the gate is complete. Leave operational items blank until the operator explicitly accepts them.

| Field | Operator value |
| --- | --- |
| Promotion lane | Lane A: accepted Beta copy |
| Dataset version | `beta-production-candidate-2026-05-25` |
| Atlas backup / restore point | |
| Rollback owner | |
| Smoke owner | |
| Meili backend before gate | Mongo rollback posture for Pathways until production Meili relevance is accepted |
| Meili backend after gate | Rebuild `pathways` and `researchentities`; keep Pathways on Mongo unless production relevance review is accepted |
| Accepted warnings | Missing/weak descriptions and sparse pathway/contact coverage may be release warnings only after must-fix warnings are closed or explicitly accepted |
| Run IDs | Accepted Beta source runs recorded in the roadmap; rerun read-only Beta gates before copy |
| Rollback tested | Not complete; record fresh Atlas restore point and restore owner before production copy |

### Production Promotion Lanes

Choose one lane before touching production.

#### Lane A: Accepted Beta Copy

Use this when Beta is the accepted production candidate and a fresh parity check confirms Beta already contains every production base record that must be preserved, such as users, listings, departments, fellowships, and research areas.

Gate:

1. Create a fresh Atlas backup or restore point for Production.
2. Confirm no new production-only base data appeared after the last Beta parity audit. If it did, copy the missing base data into Beta and rerun parity, or use Lane B.
3. Copy only the accepted research-discovery dataset and required base collections. Do not copy production usage logs, sessions, analytics events, or other live operational collections unless a separate decision says to.
4. Keep recurring scraper jobs disabled during the copy.
5. Rebuild or sync Meilisearch after Mongo copy completes.
6. Run the smoke checklist before declaring the gate complete.

Minimum copy set for the accepted full Beta posture:

- Research discovery: `research_entities`, `research_entity_members`, `research_entity_stats`, `entry_pathways`, `access_signals`, `contact_routes`, `posted_opportunities`, `papers`, `paper_authors`, `paper_entity_links`, and `grants`.
- Source audit trail: `sources`, `scrape_runs`, and retained `observations`.
- Base/support collections only after parity is fresh: `users`, `listings`, `departments`, `research_areas`, and `fellowships`.

Rollback for a bad copy is restoring Production from the pre-copy Atlas backup, then rebuilding or resyncing Meilisearch.

Dry-run rollback drill before using Lane A:

1. Record the Atlas backup or point-in-time restore timestamp that would be used if the copy is rejected.
2. Name the collections that would be restored: every copied research-discovery, source audit, and base/support collection in the accepted copy set above.
3. Confirm who has Atlas restore permission and how they will avoid restoring unrelated operational collections unless the incident requires a full database restore.
4. Record the Meilisearch recovery command sequence: `yarn --cwd server meili:rebuild-pathways`, `yarn --cwd server meili:rebuild-research-entities --clear`, then `yarn --cwd server pathway:relevance-review`.
5. Confirm `PATHWAY_SEARCH_BACKEND=mongo` is the live rollback posture until the rebuilt Meili indexes pass review.

#### Lane B: Guarded Production Delta

Use this when live Production data must remain in place or Beta parity cannot be re-established safely.

Gate:

1. Create a fresh Atlas backup or restore point for Production.
2. Run one source at a time with production guardrails.
3. Save the run ID and report before moving to the next source.
4. Stop on materialization errors, unexpected access artifacts, unexplained conflicts, or source-health errors.
5. Rebuild or sync Meilisearch after accepted writes.
6. Run the smoke checklist before enabling any recurrence.

Production command shape:

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn scrape run --source <source-name> --release --auto-materialize
```

Cron command shape after manual acceptance:

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn scrape cron --source <source-name> --release
```

Rules:

- Do not use `--use-cache` with `--release`; production guardrails disable it.
- Run one source at a time.
- Prefer a bounded first production pass for expensive or broad sources.
- Run `report` immediately and inspect warnings before moving to the next source.
- Treat Meilisearch failures as non-blocking for Mongo correctness, then reindex or batch-sync after accepted writes.
- Keep `PATHWAY_SEARCH_BACKEND=mongo` as the Pathways rollback posture until Meili production relevance and parity are accepted.

Dry-run rollback drill before using Lane B:

1. For each source in the delta, record the source name, planned command, expected materialized collections, and source-health warning posture before the run.
2. Confirm the source can be stopped by disabling `Source.enabled` for cron or by stopping the manual rollout; do not start additional source runs until the incident is classified.
3. Record the pre-run Atlas backup or restore point for broad bad materialization.
4. Confirm minor field-quality issues will use manual locks or a fixed rerun only after inspection, while broad materialization problems restore from the pre-run backup.
5. Confirm `PATHWAY_SEARCH_BACKEND=mongo` is set or remains set if Meili behavior is questionable after the delta.
6. Record the Meilisearch recovery command sequence after any accepted restore or fixed rerun.

### Meilisearch Gate

After accepted production copy or writes, run with production Mongo and Meili environment variables:

```bash
yarn --cwd server meili:rebuild-pathways
yarn --cwd server meili:rebuild-research-entities --clear
yarn --cwd server pathway:relevance-review
```

The pathway rebuild is mandatory after promotion because the production index must include
the current filterable fields, including `entityStudentVisibilityTier`, before traffic can
use Meili. Keep `PATHWAY_SEARCH_BACKEND=mongo` until the rebuild completes and
`yarn --cwd server pathway:relevance-review` has been accepted against that production
index.

If Meili rebuild fails after Mongo writes succeeded, keep production traffic on Mongo-backed Pathways and complete the Mongo smoke checklist. Do not switch `PATHWAY_SEARCH_BACKEND=meili` until relevance review is accepted for the production index.

### Smoke Checklist

Run these checks against the production app and production API after copy/delta plus Meili sync:

- `/api/config` returns `200` and points at the expected environment.
- Research search returns real `research_entities` results for broad terms such as `machine learning`, `biology`, and `history`.
- A known research detail page renders sources, evidence, people, and pathways without legacy `/labs` or `/api/research-groups` dependencies.
- Pathways search returns evidence-backed cards and does not expose raw non-public scraped contact data.
- Opportunity detail renders a listing-bridged open posting and a scraper-derived closed or historical posting.
- Programs/Fellowships surface hides `operator_review` and `suppressed` records from public student routes.
- Unauthenticated admin/operator routes return `401`.
- Legacy `/api/research-groups/search`, `/labs`, and `/labs/:slug` remain unavailable.
- Source health is `0 error`; any warnings match the accepted warnings in the roadmap.
- Meili document counts are plausible against the accepted Beta counts in the roadmap or the chosen delta scope.

Reusable read-only helper:

```bash
yarn --cwd client smoke:production-promotion --api-base https://<host>/api --app-base https://<host>
```

The helper writes only local artifacts under `tmp/ui-smoke/` by default. It does not call `/api/dev-login`, does not require secrets, and does not send write-method requests. Public API checks use the configured API base directly. Browser UI checks use read-only route interception for `/api/check`, saved-item endpoints, program list fixtures, and the Operator Board payload so student and admin route guards can be checked without creating sessions or analytics events. If Playwright is not installed in the runner, the helper still runs the public API and unauthenticated admin API checks and records the browser limitation in the JSON report.

Current admin UI limitation: the client does not expose `/admin/operator-board` as a page route. The guarded API is `/api/admin/operator-board`, and the Operator Board UI renders inside the admin `/analytics` route. The smoke helper therefore checks unauthenticated access on `/api/admin/operator-board`, student denial on `/analytics`, and admin rendering on `/analytics` through route interception.

### Known Accepted Warnings To Recheck

These are not automatic blockers if still accurate and accepted in the roadmap, but the operator must re-read them before production promotion:

- OpenAlex raw observations were pruned in Beta after report capture to stay inside the 5GB Atlas tier.
- `dept-faculty-roster` and `arxiv` had reviewed non-fatal materialization conflicts.
- The final accepted `arxiv` run hit rate limits/timeouts and should not be rerun immediately without backoff.
- Some papers have missing `year` values or duplicate DOI groups, while identifier duplicates and unsupported name-only faculty links are cleared.
- Eight logged-in placeholder accounts remain for account repair, not deletion.
- Many entities still lack public contact routes or pathways; this is sparse coverage, not broken referential integrity.
- Local Meili may lack the semantic `default` embedder; production Meili must be checked independently.
- Browser smoke may require host libraries that are missing in some local workspaces; if Playwright cannot run locally, use production API smokes plus a browser from an environment with the required libraries.

### Local, VPN, And Render Constraints

- Local operator runs can use Yale VPN, local accepted-input files, local Meili, and browser tooling. Confirm `MONGODBURL`, Meili host, and `SCRAPER_ENV` before every run.
- Render web service should not run scraper backfills. Keep scraper execution in local CLI, one-off jobs, or source-specific cron.
- Render cron should run only public/network-reachable sources with all required environment variables configured. It cannot assume Yale VPN, local files under `/tmp/ylabs-accepted-inputs`, local Meili, or interactive browser dependencies.
- For sources that need Yale network access, private credentials, or manual accepted-input files, run a guarded local or one-off job instead of Render cron.

### Post-Gate Documentation

After a successful gate, update [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md) with:

- Promotion lane used.
- Backup or restore-point identifier, without secrets.
- Collections or sources promoted.
- Production run IDs and saved report locations.
- Meili rebuild/sync outcome and active Pathways backend.
- Smoke checklist outcome.
- Rollback posture and any accepted warnings.

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

### Source-Specific Cron Acceptance Matrix

Do not enable recurring cron for a source until its row is accepted. A source may be accepted for manual guarded runs while remaining unaccepted for unattended cron.

| Source | Cron acceptance prerequisites | First cron posture | Hold if |
| --- | --- | --- | --- |
| `ysm-atoz-index` | Manual production or accepted Beta evidence shows entity discovery is stable, `materialization.errors = 0`, and source health has no unexplained errors. | Weekly, one source-specific cron, report saved with run ID. | Selector/fetch failures, duplicate entity churn, or unexpected access artifacts. |
| `department-undergrad-research` | Source metadata exists, output is verified as undergraduate-access evidence rather than generic department discovery, and public contact policy is reviewed. | Manual or low-frequency cron after one accepted guarded run. | It emits unsupported access claims, non-public contact data, or department pages require Yale-network-only access. |
| `yale-college-fellowships-office` | Fellowship program mapping and public application/contact routes are reviewed; no private recipient or applicant data is required. | Monthly or term-bound cron, aligned to public deadline cycles. | The run depends on manual/private files, creates person-level scraped data, or deadline state cannot be verified. |
| `lab-microsite-undergrad-llm` | WorkPlanner target list is accepted, paid/LLM cost cap is set, stale-only or bounded scope is enforced, and contact redaction is smoke-tested. | Weekly after WorkPlanner, with saved report and sampled public UI smoke. | Cost cap is missing, source emits raw non-public emails, or materialization conflicts are unexplained. |
| `openalex` | Production storage posture is accepted, compact-retention/report-save policy is recorded, and identifier-backed candidate rules are confirmed. | Weekly or monthly, bounded by identifiers/offsets; save reports before pruning observations. | Name-only discovery is enabled unintentionally, Atlas storage is insufficient, or materialization creates unsupported authorship links. |
| `arxiv` | Accepted ORCID/input target list is current, backoff window has cleared, and metadata-only behavior does not create name-only Yale author links. | Weekly with `--since` or bounded accepted targets. | Rate limits/timeouts recur, ORCID input is stale, or the source attempts unsupported faculty links. |

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

Before production seeding, prefer an Atlas backup over clever cleanup. The rollback owner must know whether the gate used Lane A or Lane B.

If a production run is bad:

1. Disable the scheduled job or stop the manual rollout.
2. Do not run more sources on top of questionable materialized data.
3. Set `PATHWAY_SEARCH_BACKEND=mongo` if Pathways Meili behavior is questionable.
4. For minor field-quality issues, use manual locks or a fixed rerun after inspection.
5. For a bad Beta copy or broad bad materialization, restore from the pre-run Atlas backup.
6. Rebuild or resync Meilisearch after restoring MongoDB.
7. Record the rollback and follow-up decision in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md).

`Source.enabled=false` blocks cron execution by default. Use `--force-disabled` only for an explicit manual recovery run after checking the source-health report.
