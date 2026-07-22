# Scraper Deployment Runbook

Status: active runbook

Last updated: 2026-07-21

## Goal

Move scraper data safely from development testing to Beta seeding and then production refresh jobs without overpaying for compute or creating unsupported student-facing access claims.

Web service security is part of the production gate. The currently deployed
site must pass the production security smoke before any Beta launch or
production-copy claim is accepted:

```bash
yarn security:smoke:production
```

The same check is also available as the `Production Security Smoke` GitHub
Actions workflow. It fails if the deployed app is stale, if `/api/config` is
missing CSP or Permissions-Policy, if current API routes are absent, or if
authenticated/private surfaces no longer enforce the expected boundary.
Scheduled and manually dispatched workflow runs default the expected deployment
fingerprint to `github.sha`; override `SMOKE_API_BASE`, `SMOKE_APP_BASE`, or
`--expect-commit <prefix>` only when intentionally checking a non-default host
or a known deployment revision.

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

### PFR-3 pathway evidence review

Resolve no more than 25 salted queue handles at a time with `pfr3:pathway-evidence-review`. The command defaults to dry-run, requires an explicit `--target=beta|prod`, and writes the minimum necessary record and lineage fields only to a mode-0600 JSON path under the system or project `tmp` directory. Never attach that PRIVATE artifact to a PR, ticket, chat, or log.

Decision files require a safe public HTTP source, quoted or summarized evidence, and operator rationale for each recency, source-repair, or new-source decision. Use an envelope containing the exact `artifactHash` from the private artifact and a `decisions` array. Execute mode rejects a stale or differently salted artifact and additionally requires a matching target confirmation, backup/restore token, and a separate production confirmation.

Only recency decisions have an automated application path. The workflow requires an existing `sourceEvidenceId` for the same research entity whose normalized source URL exactly matches the reviewed URL. It verifies the registered source provenance, creates an admin-triggered scrape-run lineage row, re-appends that existing observation through the observation store, and invokes normal access materialization. Replays are suppressed by an audit key derived from the target, artifact hash, handle, and URL. The audit stores only a hash of the restore token. The command never writes pathway status, evidence strength, confidence, or source fields directly.

Source repairs remain `manual_only` because there is no authoritative field-level repair service that can preserve provenance without guessing which observation claim the URL supports. New-source acquisition remains `manual_only` because there is no durable bounded scraper-job queue; run the approved source-specific scraper workflow after review instead. Dry-run is still the default, and stdout remains aggregate-only.

## Environment Progression

### 1. Development Testing

Purpose: prove scraper behavior, materialization, and reporting on bounded samples.

Typical dry-run:

```bash
SCRAPER_ENV=development \
  yarn --cwd server scrape run --source <source-name> --limit 10 --use-cache --output /tmp/ylabs-<source-name>-dry-run-report.json
```

Typical development write:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  yarn --cwd server scrape run --source <source-name> --limit 10 --use-cache --auto-materialize --output /tmp/ylabs-<source-name>-write-report.json
```

Rules:

- Use `--use-cache` only outside production.
- Start with `--limit`, `--only`, `--since`, or source-specific caps.
- Use `--output <path>` on `yarn --cwd server scrape run` when a bounded dry-run or write should produce a saved report artifact. If a run was already completed without `--output`, use `yarn --cwd server scrape report --run <scrapeRunId> --output <path>`. Saved scraper CLI artifacts include command, target `environment`, `db`, parsed `options`, and the command-specific report payload.
- Use `yarn --cwd server scrape materialize --run <scrapeRunId> --dry-run --output <path>` for a saved materialization review artifact before any standalone materialization write. Standalone write materialization requires `--confirm-materialize` in addition to the existing environment write guards. The materialize artifact includes the materialization result, optional visibility-gate result, ScrapeRun report, command, target `environment`, `db`, and parsed `options`.
- Do not promote a source while materialization errors are nonzero or conflicts are unexplained.

### 2. Beta Seeding

Purpose: seed a realistic staging dataset and validate UI/search behavior before touching production.

Preparation:

```bash
yarn --cwd server beta:readiness --confirm-beta-backup --strict
yarn --cwd server scrape:seed-sources --dry-run --output /tmp/ylabs-seed-sources-dry-run.json
yarn --cwd server scrape:seed-sources --apply --confirm-seed-apply --output /tmp/ylabs-seed-sources-apply.json
```

Use `yarn --cwd server beta:readiness` without `--strict` for a diagnostic report. The command is read-only: it reports the Mongo target, accepted-input readiness, gated source posture, source metadata presence, canonical migration residue, and Pathway backend posture.
Use the seed-source dry-run artifact to confirm the target database and source actions before applying source metadata updates. Apply mode requires `--confirm-seed-apply`; production source seeding also requires `SCRAPER_ENV=production` plus `CONFIRM_PROD_SCRAPE=true`.

The canonical Beta operator wrapper is:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:seed-meili
SCRAPER_ENV=beta yarn --cwd server beta:seed --output /tmp/ylabs-beta-seed-plan.json
SCRAPER_ENV=beta yarn --cwd server beta:seed --apply --confirm-beta-seed --output /tmp/ylabs-beta-seed-result.json
```

Use `beta:seed-meili` on the Beta server when Mongo is already populated and the launch task is to rebuild Meilisearch plus run the related checks. The broader `beta:seed` wrapper plans or runs Beta readiness, Source registry seeding, Meilisearch rebuilds, Pathway relevance review, and final Meili readiness acceptance. It does not run broad scrapers unless the operator explicitly names sources:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:seed --apply --confirm-beta-seed \
  --sources=ysm-atoz-index,yse-centers-index,centers-institutes-index \
  --output /tmp/ylabs-beta-seed-result.json
```

Use `--skip-meili`, `--skip-source-metadata`, `--skip-readiness`, or `--skip-pathway-relevance` only for a targeted recovery run after the omitted phase already has a fresh accepted artifact.

Then run accepted sources in rollout order:

1. Entity discovery: `ysm-atoz-index`, `yse-centers-index`, `centers-institutes-index`, selected `dept-faculty-roster` departments.
2. Profile metadata: `yale-directory`.
3. Enrichment: `openalex`, `nih-reporter`, `nsf-award-search`, `arxiv` where relevant.
4. Access evidence: bounded `lab-microsite-undergrad-llm` source lists.
5. Gated sources only after blockers clear: `undergrad-fellowships-recipients` and bounded `official-research-home-roster` allowlist entries.

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

Record each item in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md) before changing production data. These unchecked boxes are gate fields, not evidence of completed work. Leave them unchecked until a human operator provides the value and accepts the promotion window.

- [ ] **Backup and restore drill:** Create the fresh Atlas backup or restore point, name its identifier and rollback owner, and confirm the restore drill or exact restore procedure has been exercised for the target cluster.
- [ ] **Dataset versioning:** Assign a promotion dataset version such as `prod-promote-YYYY-MM-DD-<lane>` and attach it to the accepted Beta snapshot or per-source production run IDs, saved reports, and Meili rebuild outputs.
- [ ] **Copy-vs-delta decision:** Choose exactly one lane: accepted Beta copy or guarded production delta. Do not mix the lanes in one promotion window.
- [ ] **Privacy payload gate:** Sample public API payloads before promotion and confirm they exclude non-public scraped contact data, suppressed/operator-review programs, raw observations, internal review notes, and production-only usage/session data.
- [ ] **Meili sync and rollback:** Decide whether production traffic stays on Mongo or switches to Meili after rebuild; keep `PATHWAY_SEARCH_BACKEND=mongo` as the rollback posture until production relevance review and document counts are accepted.
- [ ] **Smoke routes:** Assign an owner for `/api/config`, `/api/research/search`, `/research/:slug`, `/opportunities/:id` when a known public id is available, `/programs` or `/fellowships`, unauthenticated admin `401`, and removed legacy route checks.
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

Fill this packet before any production copy, guarded production write, Meilisearch backend switch, or recurring cron enablement. The human operator delegated the lane/default posture decision to Codex on 2026-05-28; the defaults below are accepted, but blank owner/restore/copy fields still block production writes.

| Field                         | Operator value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Promotion lane                | Lane A accepted Beta copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Atlas backup / restore point  | BLOCKED: fresh Production restore point identifier not recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Rollback owner                | Codex autonomous operator for routine gate coordination; BLOCKED for actual Atlas restore execution until a fresh restore point and tested restore procedure are recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Smoke owner                   | Codex autonomous operator for routine smoke coordination; BLOCKED until the smoke commands are run against the real target and results are recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Guarded copy dry-run reviewer | Codex autonomous operator; BLOCKED because the 2026-06-11 dry-run attempt could not start without `BETA_MONGODBURL` and `PRODUCTION_MONGODBURL`; rerun `production:promote-beta-copy --output /tmp/ylabs-lane-a-promotion-dry-run.json` after those separate targets are configured, then review the artifact before apply mode                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Meili backend before gate     | Mongo-backed Pathways                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Meili backend after gate      | Keep Mongo-backed Pathways until production Meili rebuild counts and relevance review are accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Accepted warnings             | Sparse coverage and missing/weak descriptions are accepted as hidden-row or post-promotion backlog; the latest strict Beta audit reports 70 active research entities without pathways, 62 without access signals, 553 without contact routes, 53 missing short descriptions, 186 weak short descriptions, and 2 synthetic/dev user emails that are excluded from Lane A copy; duplicate-name, source-health, launch-trust, and scraper-integrity promotion blockers are cleared in the latest Beta artifacts                                                                                                                                                                                                                                                                                                 |
| Run IDs                       | Latest Beta preflight artifacts were refreshed on 2026-06-11: `launch:trust-contract --strict` wrote `/tmp/ylabs-launch-trust-final-after-dedupe.json` with `launchEligible=2291`, `limitedButSafe=0`, `held=0`, `suppressed=160`, and `publicVisibilityViolations=0`; `scraper:integrity-gate --include-samples` wrote `/tmp/ylabs-scraper-integrity-final-after-dedupe.json` with every hard count at 0; strict `beta:data-quality --include-samples` wrote `/tmp/ylabs-beta-data-quality-final-after-dedupe.json` with `promotionReady=true` and `promotionBlockerCount=0`; `student-visibility:gate --collection=all --mode=dry-run` wrote `/tmp/ylabs-student-visibility-gate-final-dryrun.json` with `changed=0`; dataset version should be `prod-promote-2026-06-11-lane-a-beta-copy` if copied today |
| Rollback tested               | BLOCKED: restore drill/procedure not recorded or exercised                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

True blockers before this packet can be accepted:

- What exact Atlas backup or point-in-time restore identifier is the rollback point?
- Has the guarded Lane A copy dry-run below been reviewed against the real Production target?
- Has the rollback restore procedure or drill been exercised and recorded?
- Have the production smoke commands been run against the real target and recorded?
- Has the latest strict launch-trust posture stayed green immediately before copy? The 2026-06-11 artifact has no held rows, no repair lanes, 0 public visibility violations, and passing data-quality/scraper-integrity gates; rerun the safe pre-gate commands below if Beta changes again.

Safe pre-gate commands are read-only or local-smoke only:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json
SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples
SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict
SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10
yarn --cwd client smoke:production-promotion --api-base https://<host>/api --app-base https://<host>
SMOKE_COOKIE='<operator-session-cookie>' yarn --cwd client smoke:production-promotion --api-base https://<host>/api --app-base https://<host> --ui=false
yarn --cwd client smoke:production-promotion --api-base https://<host>/api --app-base https://<host> --ui=false --expect-commit "$(git rev-parse --short HEAD)"
```

When `beta:data-quality --include-samples` reports `sourceHealthWarnings`, use each queue item's `nextCommand` to write the latest scraper report for that source. Those commands are read-only and point at `/tmp/ylabs-scraper-reports/<source>-<runId>.json`.

Do not run production copy commands, `SCRAPER_ENV=production` scraper writes, retention `--apply`, or production cron until the packet is complete.

The guarded Lane A copy command is dry-run-first and allowlist-only. It requires separate Beta and Production Mongo URLs, excludes synthetic `devadmin`/`test123`/`@example.invalid` users, and does not copy sessions, analytics, usage logs, or other collections outside the runbook allowlist:

```bash
BETA_MONGODBURL='<beta-mongodb-url>' \
PRODUCTION_MONGODBURL='<production-mongodb-url>' \
PROMOTION_DATASET_VERSION='prod-promote-2026-05-28-lane-a-beta-copy' \
yarn --cwd server production:promote-beta-copy --output /tmp/ylabs-lane-a-promotion-dry-run.json
```

The `--output` artifact contains the same redacted dry-run summary printed to stdout, including collection category totals, excluded synthetic-user counts, and synthetic-user reference blockers. Saving the artifact does not verify readiness; the real Production dry-run still needs operator review before apply mode.

The Operator Board reads `/tmp/ylabs-lane-a-promotion-dry-run.json` by default, or `PROMOTION_COPY_DRY_RUN_REPORT_PATH` when set. A blocker-free dry-run appears as `review_required`, not ready, until the restore point, rollback test, and smoke gates are also recorded.

Apply mode is blocked unless the restore point and both production confirmations are present:

```bash
BETA_MONGODBURL='<beta-mongodb-url>' \
PRODUCTION_MONGODBURL='<production-mongodb-url>' \
PROMOTION_DATASET_VERSION='prod-promote-2026-05-28-lane-a-beta-copy' \
ATLAS_RESTORE_POINT='<fresh-production-restore-point>' \
CONFIRM_LANE_A_COPY=true \
CONFIRM_PROD_SCRAPE=true \
yarn --cwd server production:promote-beta-copy --apply
```

Integrity cleanup commands are dry-run first and Beta-only unless a production promotion lane explicitly records them:

```bash
SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000
SCRAPER_ENV=beta yarn --cwd server pathways:dedupe-exploratory --limit=1000
```

Use `--apply` only after the dry-run output is reviewed and the target database is confirmed.

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

- Research discovery: `research_entities`, `research_entity_members`, `entry_pathways`, `access_signals`, `contact_routes`, `posted_opportunities`, `papers`, `paper_authors`, and `grants`.
- Source audit trail: `sources`, `scrape_runs`, and retained `observations`.
- Base/support collections only after parity is fresh: `users`, `listings`, `departments`, `research_areas`, and `fellowships`.

Rollback for a bad copy is restoring Production from the pre-copy Atlas backup, then rebuilding or resyncing Meilisearch.

Dry-run rollback drill before using Lane A:

1. Record the Atlas backup or point-in-time restore timestamp that would be used if the copy is rejected.
2. Name the collections that would be restored: every copied research-discovery, source audit, and base/support collection in the accepted copy set above.
3. Confirm who has Atlas restore permission and how they will avoid restoring unrelated operational collections unless the incident requires a full database restore.
4. Record the Meilisearch recovery command sequence: `yarn --cwd server meili:rebuild-pathways --confirm-meili-rebuild`, `yarn --cwd server meili:rebuild-research-entities --clear --confirm-meili-rebuild`, then `yarn --cwd server pathway:relevance-review`.
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
  yarn --cwd server scrape run --source <source-name> --release --auto-materialize --output /tmp/ylabs-<source-name>-production-report.json
```

Cron command shape after manual acceptance:

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn --cwd server scrape cron --source <source-name> --release
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
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn --cwd server meili:rebuild-pathways --confirm-meili-rebuild --output /tmp/ylabs-prod-meili-pathways-rebuild.json
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn --cwd server meili:rebuild-research-entities --clear --confirm-meili-rebuild --output /tmp/ylabs-prod-meili-researchentities-rebuild.json
SCRAPER_ENV=production \
  yarn --cwd server pathway:relevance-review --output /tmp/ylabs-prod-pathway-relevance-review.json
```

The pathway rebuild is mandatory after promotion because the production index must include
the current filterable fields, including `entityStudentVisibilityTier`, before traffic can
use Meili. Keep `PATHWAY_SEARCH_BACKEND=mongo` until the rebuild completes and
`yarn --cwd server pathway:relevance-review` has been accepted against that production
index. The rebuild commands write to Meili and therefore require
`SCRAPER_ENV=production` plus `CONFIRM_PROD_SCRAPE=true`; their saved artifacts include
target `environment`, `db`, and parsed `options` metadata for promotion review.

If Meili rebuild fails after Mongo writes succeeded, keep production traffic on Mongo-backed Pathways and complete the Mongo smoke checklist. Do not switch `PATHWAY_SEARCH_BACKEND=meili` until relevance review is accepted for the production index.

### Smoke Checklist

Run these checks against the production app and production API after copy/delta plus Meili sync:

- `/api/config` returns `200` and points at the expected environment.
- Research search returns real `research_entities` results for broad terms such as `machine learning`, `biology`, and `history`.
- Research relevance smoke checks cover short/noisy student queries such as `AI`, `Professor Zhong`, and `computer vision for medical imaging` without substring-only matches dominating true topic or person matches.
- A known research detail page renders sources, evidence, people, and pathways without legacy `/labs` or `/api/research-groups` dependencies.
- Research detail and opportunity pages show evidence-backed planning context without exposing raw non-public scraped contact data.
- Opportunity detail renders a listing-bridged open posting and a scraper-derived closed or historical posting.
- Pathways and Programs/Fellowships search require authentication when unauthenticated, and authenticated operator smoke checks show payloads without `operator_review` or `suppressed` records.
- Unauthenticated admin/operator routes return `401`.
- Legacy `/api/research-groups/search`, `/labs`, and `/labs/:slug` remain unavailable.
- Source health is `0 error`; any warnings match the accepted warnings in the roadmap.
- Source-health warning reports have been generated from the `nextCommand` values in `beta:data-quality --include-samples` and reviewed or explicitly accepted.
- Meili document counts are plausible against the accepted Beta counts in the roadmap or the chosen delta scope.

Reusable read-only helper:

```bash
yarn --cwd client smoke:production-promotion --api-base https://<host>/api --app-base https://<host>
SMOKE_COOKIE='<operator-session-cookie>' yarn --cwd client smoke:production-promotion --api-base https://<host>/api --app-base https://<host> --ui=false
yarn --cwd client smoke:production-promotion --api-base https://<host>/api --app-base https://<host> --ui=false --expect-commit "$(git rev-parse --short HEAD)"
```

The helper writes only local artifacts under `tmp/ui-smoke/` by default. It does not call `/api/dev-login` and does not send write-method requests. Public API checks use the configured API base directly, and optional authenticated Programs/Fellowships payload checks use `SMOKE_COOKIE` or `--cookie` without printing the cookie. Do not put credentials in `--api-base` or `--app-base`; the helper rejects credentialed target URLs before network calls and strips credentials from any validation-failure report. Browser UI checks use read-only route interception for `/api/check`, saved-item endpoints, program list fixtures, and the Operator Board payload so student and admin route guards can be checked without creating sessions or analytics events. If Playwright is not installed in the runner, the helper still runs the public API and unauthenticated admin API checks and records the browser limitation in the JSON report. Public `/api/config` includes a narrow deployment fingerprint (`deployment.provider`, `deployment.gitCommit`, and `deployment.gitBranch`) from safe provider metadata; pass `--expect-commit` during promotion smoke so stale or wrong-backend deployments fail before production promotion.

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
  yarn --cwd server scrape cron --source <source-name> --release
```

The cron command:

- Acquires a source-level `ScrapeJobLock` keyed by `production + sourceName`.
- Skips cleanly with exit code `0` if another cron already owns that source lock.
- Refuses disabled `Source` rows unless `--force-disabled` is passed for manual recovery.
- Runs the scraper with `triggeredBy=cron`, materializes immediately, prints a cron summary plus run report when no output file is requested, and exits nonzero if materialization errors are reported.
- Heartbeats the lock during long runs and releases it with the last `ScrapeRun` id on success or failure.

Use `--output <path>` to save the full cron result JSON from a cron run. The artifact includes lock-skip outcomes when a source lock is held, and completed runs include the scrape result, materialization result, optional visibility-gate result, and ScrapeRun report.

Suggested starting cadence:

| Source                             | Cadence                           | Notes                                                                                |
| ---------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| `ysm-atoz-index`                   | weekly                            | Entity discovery only.                                                               |
| `yse-centers-index`                | weekly                            | Entity discovery only.                                                               |
| `centers-institutes-index`         | weekly or biweekly                | Broad member extraction; stagger separately.                                         |
| `official-research-home-roster`    | weekly after audit                | Disabled by default; data operations owns refresh and sampled precision review.       |
| `dept-faculty-roster`              | weekly by department group        | Use source-specific `--only`/config where available.                                 |
| `yale-directory`                   | weekly                            | Broad directory paging; watch runtime.                                               |
| `nih-reporter`                     | weekly or monthly                 | Enrichment only; conflicts should remain understood aggregate churn.                 |
| `nsf-award-search`                 | weekly or monthly                 | Enrichment only.                                                                     |
| `openalex`                         | weekly after WorkPlanner          | Keep name-only discovery opt-in and page-capped.                                     |
| `arxiv`                            | weekly with `--since`             | Recent research activity only.                                                       |
| `lab-microsite-undergrad-llm`      | weekly after WorkPlanner          | Paid/LLM source; use stale-only work planning before recurring cron.                 |
| `student-decision-llm`             | manual after accepted target list | Paid/LLM display enrichment; run bounded after source-backed access evidence exists. |
| `undergrad-fellowships-recipients` | monthly/manual                    | Requires accepted real CSV/manual data.                                              |

Use separate Render Cron jobs per source or per source group and stagger start times. If a job needs more than the platform's cron runtime limits, split it into batches or use a background worker temporarily for that backfill only.

### Source-Specific Cron Acceptance Matrix

Do not enable recurring cron for a source until its row is accepted. A source may be accepted for manual guarded runs while remaining unaccepted for unattended cron.

| Source                            | Cron acceptance prerequisites                                                                                                                                | First cron posture                                             | Hold if                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ysm-atoz-index`                  | Manual production or accepted Beta evidence shows entity discovery is stable, `materialization.errors = 0`, and source health has no unexplained errors.     | Weekly, one source-specific cron, report saved with run ID.    | Selector/fetch failures, duplicate entity churn, or unexpected access artifacts.                                   |
| `department-undergrad-research`   | Source metadata exists, output is verified as undergraduate-access evidence rather than generic department discovery, and public contact policy is reviewed. | Manual or low-frequency cron after one accepted guarded run.   | It emits unsupported access claims, non-public contact data, or department pages require Yale-network-only access. |
| `yale-college-fellowships-office` | Fellowship program mapping and public application/contact routes are reviewed; no private recipient or applicant data is required.                           | Monthly or term-bound cron, aligned to public deadline cycles. | The run depends on manual/private files, creates person-level scraped data, or deadline state cannot be verified.  |

### Recurring fellowship refresh

`yarn --cwd server fellowships:refresh` is the deployable scheduler entrypoint for the official Yale fellowship catalog.
No recurring job is configured in the repository, so it is disabled by default.
Configure it as a separate monthly scheduled job, with additional runs six weeks before the usual fall and spring application cycles, only after the target-specific database name and restore workflow have been verified.

The command is dry-run by default and prints only aggregate, redacted counts.
It requires an explicit `--target=beta|prod`, a matching `SCRAPER_ENV`, and a connected database whose name exactly matches `FELLOWSHIP_REFRESH_BETA_DB` or `FELLOWSHIP_REFRESH_PROD_DB`.
Use an uncached bounded Beta dry-run first:

```bash
SCRAPER_ENV=beta \
FELLOWSHIP_REFRESH_BETA_DB=<beta-db-name> \
MONGODBURL=<beta-url> \
yarn --cwd server fellowships:refresh --target=beta --limit=50
```

Review the aggregate created, updated, unchanged, review-required, and reopened counts plus the private review queue before execute mode.
Execute mode additionally requires `--execute --confirm=execute-fellowship-refresh-beta --restore-token=<restore-id>`.
Production requires the corresponding `prod` target and confirmation, plus `--confirm-prod=confirm-production-fellowship-refresh`.
Never put a restore token in scheduler configuration committed to this repository.
Use the secret manager provided by the deployment platform and rotate the token after the verified rollback window closes.

Each run is bounded to at most 100 records, uses the existing distributed scraper lease, retries official page fetches with exponential backoff, and upserts by the authoritative source key.
Missing or invalid deadlines, duplicate source identities, junk titles, and non-authoritative URLs go to `fellowship_refresh_review_queue` instead of changing a fellowship.
Validated past-to-future transitions emit one idempotent `program_reopened` row in `program_watch_events` for downstream watchlist delivery.
No future deadline is synthesized.
Successful execute runs write aggregate freshness state to `fellowship_refresh_runs`; alert when no successful run exists within 45 days or when every discovered row requires review.
| `lab-microsite-undergrad-llm` | WorkPlanner target list is accepted, paid/LLM cost cap is set, stale-only or bounded scope is enforced, and contact redaction is smoke-tested. | Weekly after WorkPlanner, with saved report and sampled public UI smoke. | Cost cap is missing, source emits raw non-public emails, or materialization conflicts are unexplained. |
| `student-decision-llm` | Source-backed access evidence exists, target list excludes entities with existing explanations, paid/LLM cost cap is set, and rejected-output samples are reviewed for invented claims. | Manual bounded enrichment only; use `--use-cache` for cache-only replay when possible. | Cost cap is missing, outputs mention unsupported application routes/direct contacts, or validator rejection rate is unexplained. |
| `openalex` | Production storage posture is accepted, compact-retention/report-save policy is recorded, and identifier-backed candidate rules are confirmed. | Weekly or monthly, bounded by identifiers/offsets; save reports before pruning observations. | Name-only discovery is enabled unintentionally, Atlas storage is insufficient, or materialization creates unsupported authorship links. |
| `arxiv` | Accepted ORCID/input target list is current, backoff window has cleared, and metadata-only behavior does not create name-only Yale author links. | Weekly with `--since` or bounded accepted targets. | Rate limits/timeouts recur, ORCID input is stale, or the source attempts unsupported faculty links. |

### Compact Observation Retention

Run retention as its own scheduled job only after inspecting a dry-run:

```bash
yarn --cwd server scrape prune-observations --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-observation-retention-dry-run.json
```

Apply mode requires an explicit production confirmation:

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn --cwd server scrape prune-observations --apply --confirm-observation-prune --older-than-days 30 --keep-runs 3
```

The retention command deletes only old `superseded: true` observations. It always preserves active observations, recent observations inside the age window, and observations attached to the latest retained runs per source.
Use `--output <path>` on dry-runs and apply runs so the promotion packet has the exact candidate/deleted counts, retained run ids, command, target `environment`, `db`, and parsed `options`.

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
