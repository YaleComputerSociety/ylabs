# Scraper Deployment Runbook

Status: active runbook

Last updated: 2026-09-27

For the concise Development sweep -> Development-to-Beta mirror -> Beta re-gate and reindex -> Production promotion sequence, use [`docs/data-refresh-runbook.md`](./data-refresh-runbook.md).
Scrapers write only to Development; Beta and Production receive data only through promotion, and the scrape CLI refuses a `run` or `materialize` write against either (decision 2026-09-27 in `docs/decisions.md`).
This longer document remains the source-specific deployment and recovery reference.

## Goal

Move scraper data safely from Development sweeps to a mirrored Beta candidate and then a promoted Production dataset without overpaying for compute or creating unsupported student-facing access claims.

Web service security is part of the production gate. The currently deployed
site must pass the production security smoke before any Beta launch or
production-copy claim is accepted:

```bash
yarn security:smoke:production
```

The same check also runs automatically as the `Post-Promotion Verify` GitHub
Actions workflow on every push to `main`. It fails if the deployed app is stale, if `/api/config` is
missing CSP or Permissions-Policy, if current API routes are absent, or if
authenticated/private surfaces no longer enforce the expected boundary.
Override `SMOKE_API_BASE` or `SMOKE_APP_BASE` only when intentionally checking a
non-default host. The smoke does not verify which commit is deployed; read that
from the Render deploy log.

Use this with:

- [`docs/research-data-pipeline.md`](./research-data-pipeline.md) for the stable evidence-to-product data flow.
- [`docs/scraper-audit-guide.md`](./scraper-audit-guide.md) for per-source expectations and audit commands.
- [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md) for standing launch priorities and the operating baseline. Source readiness status, WorkPlanner follow-ups, and outstanding production tasks are tracked in GitHub issues, not there.

## Operating Model

Run scrapers as short-lived CLI jobs, not inside the web service process.

The web app can stay on Render while scraper execution remains separate:

- Every scraper run and sweep writes to the Development database, from a local machine.
- Beta receives the accepted Development dataset through `beta:refresh-from-development`, never through a scraper run.
- Production receives the accepted Beta dataset through `production:promote-beta-copy`, never through a scraper run.
- Recurring refresh is a Development incremental sweep followed by the same promotion, not a scheduled scraper against Beta or Production.

`MONGODBURL` decides the target database. Always read the CLI's printed Mongo target before accepting a run.

## Data Flow

```txt
Source metadata
  -> ScrapeJobLock for every writing run
  -> ScrapeRun
  -> append-only Observation rows
  -> entity materialization
  -> ResearchEntity/Researcher/RoleAssignment/etc.
  -> access materialization where evidence supports it
  -> Signal (access types)
  -> Meilisearch sync or later reindex
```

The current system avoids most duplicate materialized entities through stable slugs, identifiers, derivation keys, and upserts. Observation rows are append-only during a run; identical observations can be superseded, and old unreferenced superseded rows can be pruned by the compact-retention command after reports are captured. Use the WorkPlanner task before unattended recurring runs for expensive sources.

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
- Every non-`--release` CLI run already sends conditional requests through the disk-backed HTTP validator cache (`server/src/scrapers/utils/httpValidatorCache.ts`, #3557), so an unchanged page costs a `304` instead of a full download while the lane still parses and emits it.
  It writes nothing to Mongo, unlike `--use-cache`.
  Knobs: `SCRAPER_HTTP_CACHE=off` disables it, `SCRAPER_HTTP_CACHE_DIR` moves it (default under `$XDG_CACHE_HOME`, else `~/.cache`, at `ylabs/scraper-http-cache`), and `SCRAPER_HTTP_CACHE_MAX_MB` bounds it (default 512).
  Read `fetchMetrics.httpCache` on the `ScrapeRun` for `revalidations`, `notModified`, `bytesSaved`, and `bytesDownloaded`.
- Start with `--limit`, `--only`, `--since`, or source-specific caps.
- Use `--output <path>` on `yarn --cwd server scrape run` when a bounded dry-run or write should produce a saved report artifact. If a run was already completed without `--output`, use `yarn --cwd server scrape report --run <scrapeRunId> --output <path>`. Saved scraper CLI artifacts include command, target `environment`, `db`, parsed `options`, and the command-specific report payload.
- Use `yarn --cwd server scrape materialize --run <scrapeRunId> --dry-run --output <path>` for a saved materialization review artifact before any standalone materialization write. Standalone write materialization requires `--confirm-materialize` in addition to the existing environment write guards. The materialize artifact includes the materialization result, optional visibility-gate result, ScrapeRun report, command, target `environment`, `db`, and parsed `options`.
- Do not promote a source while materialization errors are nonzero or conflicts are unexplained.

### 2. Beta Staging

Purpose: stage the accepted Development dataset on Beta and validate UI/search behavior before touching production.
Beta is filled by the Development-to-Beta mirror in [`data-refresh-runbook.md`](./data-refresh-runbook.md), which copies `taxonomy_terms` along with the corpus; no scraper runs against Beta.

Precondition: confirm `taxonomy_terms` is seeded in Development before running a sweep there against a freshly reset database.
The only writer for that collection (`data-migration/seedTaxonomyTerms.ts`) was deleted in #2186, so an empty environment stays empty and nothing in the repository will fill it.
`research-area-source-extractor` is fail-closed against the approved registry and emits nothing when it is empty, and every other source's `researchAreas[]` then passes through raw and un-canonicalized.
Both failures are silent: the run reports success with degraded research-area data.
Check with `db.taxonomy_terms.countDocuments({ reviewStatus: 'APPROVED', status: 'ACTIVE', archived: false })` and treat zero as a stop.
Development held 5,291 terms with 638 approved as of 2026-08-29; Beta held none.

Preparation, from the Beta Render shell:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:readiness --confirm-beta-backup --output /tmp/ylabs-beta-readiness.json
```

The command is read-only: it reports the Mongo target, source metadata presence, and canonical migration residue, and it exits non-zero whenever any gate is blocked, so a script that runs it stops on a failed gate.
Pass `--confirm-beta-backup` only once a Beta backup or restore point exists; the backup gate reports `ready` because the operator said so.
Source metadata is not seeded on Beta: the Development-to-Beta refresh copies the `sources` collection with the rest of the corpus.

Once the refresh has landed, rebuild the Beta search index with the guarded reindex in [`meilisearch-reindex-runbook.md`](./meilisearch-reindex-runbook.md), which refuses an empty Mongo target or a mismatched index prefix before it clears anything:

```bash
node scripts/reindex-search-index.mjs beta
node scripts/reindex-search-index.mjs beta --apply
```

Then run `beta:readiness` again as the acceptance check.
The former `beta:seed`, `beta:seed-meili`, and `beta:seed-environment` wrapper was retired because its preflight could not block a clearing rebuild (#3723).

OpenAlex, arXiv, ORCID works, Europe PMC, PubMed, and Crossref ingestion are retired and are not valid sweep sources.
Researcher profiles may expose reviewed Google Scholar and ORCID links for outbound navigation, but those links do not rebuild a local publication corpus.
Ordinary scraper runs and standalone materialization never read or write paper data; paper materialization and the `Paper` and `PaperAuthor` models and their readers are retired with no rollback opt-in.
Historical `paper` observations are retained as read-only archived evidence and are never materialized.
Retain historical source rows and observations and the stored scholarly collections until the human-gated `papers`/`paper_authors` collection drop in issue #207.

For the mirrored Beta candidate:

- Record the mirror plan and result artifacts.
- Spot-check materialized records in MongoDB and the app.
- Confirm public surfaces do not expose non-public scraped contact data.
- Confirm expected access artifacts match the source's coverage metadata.

The undergraduate-logistics release audit is retired with the vertical (#3088); there is no logistics acquisition left to gate.

### 3. Production Seeding

Purpose: populate production only after Beta output is accepted.

This is a manual promotion gate. Do not run it from the Render web service process, do not mix copy and delta strategies in the same promotion, and do not enable recurring cron until the smoke checklist passes.
Production writes are off by default: no operator should run a production copy or retention apply unless this gate is explicitly recorded and the command includes the required production confirmations.
A Production scraper write is not an option at all: the CLI refuses it.

### Production Promotion Gate Checklist

Record each item in the promotion's GitHub issue before changing production data. These unchecked boxes are gate fields, not evidence of completed work. Leave them unchecked until a human operator provides the value and accepts the promotion window.

- [ ] **Backup and restore drill:** Create the fresh Atlas backup or restore point, name its identifier and rollback owner, and confirm the restore drill or exact restore procedure has been exercised for the target cluster.
- [ ] **Dataset versioning:** Assign a promotion dataset version such as `prod-promote-YYYY-MM-DD-<lane>` and attach it to the accepted Beta snapshot or per-source production run IDs, saved reports, and Meili rebuild outputs.
- [ ] **Promotion lane:** The accepted Beta copy is the only lane; the guarded production delta is retired.
- [ ] **Privacy payload gate:** Sample public API payloads before promotion and confirm they exclude non-public scraped contact data, suppressed/operator-review programs, raw observations, internal review notes, and production-only usage/session data.
- [ ] **Meili sync and rollback:** Rebuild the `researchentities` index after the Mongo copy and confirm the rebuilt document counts against the accepted Beta counts before opening production traffic.
- [ ] **Smoke routes:** Assign an owner for `/api/config`, `/api/research/search`, `/research/:slug`, `/programs` or `/fellowships`, unauthenticated admin `401`, and removed legacy route checks.
- [ ] **No recurring writes by default:** Keep compact-retention apply mode disabled until the manual promotion smoke checklist passes.

Required before any production copy or write:

- Atlas backup or restore point exists.
- The operator can name the exact restore point and the person who can restore it.
- Source readiness is recorded in the promotion's GitHub issue.
- The open Beta trust-audit caveats are either fixed or explicitly accepted for this release.
- Promotion lane is recorded: accepted Beta copy.
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
| Search index before gate      | `researchentities` at accepted Beta document counts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Search index after gate       | Rebuild `researchentities` and confirm document counts against the accepted Beta counts before opening traffic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Accepted warnings             | Sparse coverage and missing/weak descriptions are accepted as hidden-row or post-promotion backlog; the latest strict Beta audit reports 62 active research entities without access signals, 53 missing short descriptions, 186 weak short descriptions, and 2 synthetic/dev user emails that are excluded from Lane A copy; duplicate-name, source-health, launch-trust, and scraper-integrity promotion blockers are cleared in the latest Beta artifacts                                                                                                                                                                                                                                                                                                                                                  |
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
SCRAPER_ENV=beta yarn --cwd server research-entity:audit-public-descriptions --strict --include-samples --output /tmp/ylabs-public-description-audit.json
SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples
SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --strict
SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10
yarn --cwd client smoke:production-promotion --api-base https://<host>/api --app-base https://<host>
SMOKE_COOKIE='<operator-session-cookie>' yarn --cwd client smoke:production-promotion --api-base https://<host>/api --app-base https://<host> --ui=false
```

When `beta:data-quality --include-samples` reports `sourceHealthWarnings`, use each queue item's `nextCommand` to write the latest scraper report for that source. Those commands are read-only and point at `/tmp/ylabs-scraper-reports/<source>-<runId>.json`.

Do not run production copy commands or retention `--apply` until the packet is complete.

The guarded Lane A copy command is dry-run-first and allowlist-only. It requires separate Beta and Production Mongo URLs, excludes synthetic `devadmin`/`test123`/`@example.invalid` users, and does not copy sessions, analytics, usage logs, or other collections outside the runbook allowlist:

```bash
BETA_MONGODBURL='<beta-mongodb-url>' \
PRODUCTION_MONGODBURL='<production-mongodb-url>' \
PROMOTION_DATASET_VERSION='prod-promote-2026-05-28-lane-a-beta-copy' \
yarn --cwd server production:promote-beta-copy --output /tmp/ylabs-lane-a-promotion-dry-run.json
```

The `--output` artifact contains the same redacted dry-run summary printed to stdout, including collection category totals, excluded synthetic-user counts, excluded Beta-login account counts, and synthetic-user reference blockers. Saving the artifact does not verify readiness; the real Production dry-run still needs operator review before apply mode.
`docs/release-process.md` ("Promoting data, not just code") owns the rest of the `accounts` rule: which Beta logins the promotion leaves behind, and the allow-list every promoted account row is reduced to.

The Operator Board reads `/tmp/ylabs-lane-a-promotion-dry-run.json` by default, or `PROMOTION_COPY_DRY_RUN_REPORT_PATH` when set. A blocker-free dry-run appears as `review_required`, not ready, until the restore point, rollback test, and smoke gates are also recorded.

Apply mode is blocked unless both production confirmations are present.
It no longer requires or accepts a restore point; `docs/data-refresh-runbook.md` (Phase 4) owns why and how the script rolls back on its own:

```bash
BETA_MONGODBURL='<beta-mongodb-url>' \
PRODUCTION_MONGODBURL='<production-mongodb-url>' \
PROMOTION_DATASET_VERSION='prod-promote-2026-05-28-lane-a-beta-copy' \
CONFIRM_LANE_A_COPY=true \
CONFIRM_PROD_SCRAPE=true \
yarn --cwd server production:promote-beta-copy --apply
```

Integrity cleanup commands are dry-run first and Beta-only unless a production promotion lane explicitly records them:

```bash
SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000
```

Use `--apply` only after the dry-run output is reviewed and the target database is confirmed.
The full guarded dry-run, reviewer-decision, and apply workflow for same-PI entity dedupe is documented in [`research-entity-pi-dedupe-runbook.md`](research-entity-pi-dedupe-runbook.md).

### Production Promotion Lanes

The accepted Beta copy is the only lane.

#### Lane A: Accepted Beta Copy

Use this when Beta is the accepted production candidate and a fresh parity check confirms Beta already contains every production base record that must be preserved, such as accounts, departments, org units, research areas, and fellowships.

Gate:

1. Create a fresh Atlas backup or restore point for Production.
2. Confirm no new production-only base data appeared after the last Beta parity audit. If it did, bring the missing base data into Development, mirror to Beta again, and rerun parity.
3. Copy only the accepted research-discovery dataset and required base collections. Do not copy production usage logs, sessions, analytics events, or other live operational collections unless a separate decision says to.
4. Pause the Development sweep during the copy, so the mirrored candidate does not move under the review.
5. Rebuild or sync Meilisearch after Mongo copy completes.
6. Run the smoke checklist before declaring the gate complete.

The copy set is owned by `COPY_COLLECTIONS` in `server/src/scripts/promoteAcceptedBetaCopy.ts`, and the dry-run artifact lists it with per-collection counts, so read it there rather than from a second list that can drift.
[`data-refresh-runbook.md`](./data-refresh-runbook.md) explains why each collection is in or out and why `observations` is left behind unless `--include-observations` is passed.
Base and support collections are only safe to replace after parity is fresh.

Transitional note: until the human-gated `signalConsolidationMigration` is applied, the legacy `access_signals` and `undergraduate_logistics_claims` collections may still hold un-migrated rows and must also be copied and audited alongside `signals`.

Rollback for a bad copy is restoring Production from the pre-copy Atlas backup, then rebuilding or resyncing Meilisearch.

Dry-run rollback drill before using Lane A:

1. Record the Atlas backup or point-in-time restore timestamp that would be used if the copy is rejected.
2. Name the collections that would be restored: every copied research-discovery, source audit, and base/support collection in the accepted copy set above.
3. Confirm who has Atlas restore permission and how they will avoid restoring unrelated operational collections unless the incident requires a full database restore.
4. Record the Meilisearch recovery command: `yarn --cwd server meili:rebuild-research-entities --clear --confirm-meili-rebuild`.
5. Confirm the rebuilt `researchentities` index document count matches the restored dataset before opening traffic.

#### Retired: Guarded Production Delta

The former Lane B ran scrapers directly against Production, one source at a time, and scheduled `scrape cron` against it.
It was retired on 2026-09-27 together with the Beta sweep modes, because a second write path into Production produces evidence that Development, the only environment anyone measures, has never seen.
The scrape CLI now refuses any Production `run` or `materialize` write, so a delta is a Development sweep followed by a promotion.

### Meilisearch Gate

After an accepted production copy, run with production Mongo and Meili environment variables:

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn --cwd server meili:rebuild-research-entities --clear --confirm-meili-rebuild --output /tmp/ylabs-prod-meili-researchentities-rebuild.json
```

The rebuild is mandatory after promotion because the production `researchentities` index must
include the current filterable fields, including `entityStudentVisibilityTier`, before browse
traffic can use it. The rebuild command writes to Meili and therefore requires
`SCRAPER_ENV=production` plus `CONFIRM_PROD_SCRAPE=true`; its saved artifact includes
target `environment`, `db`, and parsed `options` metadata for promotion review.

If the Meili rebuild fails after Mongo writes succeeded, complete the Mongo smoke checklist and re-run the rebuild before opening browse traffic against the stale index.

### Smoke Checklist

Run these checks against the production app and production API after the copy plus Meili sync:

- `/api/config` returns `200` and points at the expected environment.
- Research search returns real `research_entities` results for broad terms such as `machine learning`, `biology`, and `history`.
- Research relevance smoke checks cover short/noisy student queries such as `AI`, `Professor Zhong`, and `computer vision for medical imaging` without substring-only matches dominating true topic or person matches.
- A known research detail page renders its simplified student-facing research summary, people, saved-plan action, and supported access context without legacy `/labs` or `/api/research-groups` dependencies.
- The research detail page shows evidence-backed planning context and the derived official-profile link-out without exposing raw non-public scraped contact data.
- Research and Programs/Fellowships search require authentication when unauthenticated, and authenticated operator smoke checks show payloads without `operator_review` or `suppressed` records.
- Unauthenticated admin/operator routes return `401`.
- Legacy `/api/research-groups/search`, `/labs`, and `/labs/:slug` remain unavailable.
- Source health is `0 error`; any warnings match the accepted warnings in the roadmap.
- Source-health warning reports have been generated from the `nextCommand` values in `beta:data-quality --include-samples` and reviewed or explicitly accepted.
- Meili document counts are plausible against the accepted Beta counts in the roadmap.

Reusable read-only helper:

```bash
yarn --cwd client smoke:production-promotion --api-base https://<host>/api --app-base https://<host>
SMOKE_COOKIE='<operator-session-cookie>' yarn --cwd client smoke:production-promotion --api-base https://<host>/api --app-base https://<host> --ui=false
```

The helper writes only local artifacts under `tmp/ui-smoke/` by default. It does not call `/api/dev-login` and does not send write-method requests. Public API checks use the configured API base directly, and optional authenticated Programs/Fellowships payload checks use `SMOKE_COOKIE` or `--cookie` without printing the cookie. Do not put credentials in `--api-base` or `--app-base`; the helper rejects credentialed target URLs before network calls and strips credentials from any validation-failure report. Browser UI checks use read-only route interception for `/api/check`, saved-item endpoints, program list fixtures, and the Operator Board payload so student and admin route guards can be checked without creating sessions or analytics events. If Playwright is not installed in the runner, the helper still runs the public API and unauthenticated admin API checks and records the browser limitation in the JSON report. Public `/api/config` exposes only a coarse `deployment.provider`. It deliberately omits the deployed commit and branch, which `scripts/security-preflight.test.mjs` enforces by source literal, so the smoke cannot and does not verify which revision is live. Confirm the deployed commit in the Render deploy log instead.

Current admin UI limitation: the client does not expose `/admin/operator-board` as a page route. The guarded API is `/api/admin/operator-board`, and the Operator Board UI renders inside the admin `/analytics` route. The smoke helper therefore checks unauthenticated access on `/api/admin/operator-board`, student denial on `/analytics`, and admin rendering on `/analytics` through route interception.

### Known Accepted Warnings To Recheck

These are not automatic blockers if still accurate and accepted in the roadmap, but the operator must re-read them before production promotion:

- `dept-faculty-roster` had reviewed non-fatal materialization conflicts.
- Eight logged-in placeholder accounts remain for account repair, not deletion.
- Many entities still lack public access signals; this is sparse coverage, not broken referential integrity.
- Local Meili may lack the semantic `default` embedder; production Meili must be checked independently.
- Browser smoke may require host libraries that are missing in some local workspaces; if Playwright cannot run locally, use production API smokes plus a browser from an environment with the required libraries.

### Local And Render Constraints

- Local operator runs can use local accepted-input files, local Meili, and browser tooling. Confirm `MONGODBURL`, Meili host, and `SCRAPER_ENV` before every run.
- Render web service should not run scraper backfills. Keep scraper execution in the local CLI against Development.
- Render shells re-gate and reindex Beta and Production after a copy, because their private Meilisearch services are reachable only inside Render. They never run a scraper.

### Post-Gate Documentation

After a successful gate, update the promotion's GitHub issue with:

- Promotion lane used.
- Backup or restore-point identifier, without secrets.
- Collections or sources promoted.
- Development sweep output directory and saved report locations.
- Meili rebuild/sync outcome and `researchentities` document count.
- Smoke checklist outcome.
- Rollback posture and any accepted warnings.

## Recurring Refresh

A recurring refresh is a Development incremental sweep, `yarn scrape:development:all:incremental`, followed by the mirror to Beta and the promotion to Production in [`data-refresh-runbook.md`](./data-refresh-runbook.md).
No scheduled job scrapes Beta or Production.
`scrape cron` is gone: it only ever targeted Production, and #3741 moved its one remaining duty, the inferred-PI lead reclaim, into the Development sweep as the `inferred-pi-lead-reclaim` post-run stage.

The `run` and `materialize` commands take a per-source `ScrapeJobLock` when they write (#2498), so a second writer on one source is refused rather than interleaved, and they exit nonzero because an operator asked for work that did not happen.
A `--dry-run` does not contend for the lock and instead warns when a live holder exists.
Interrupting a writing command releases its lock before the process dies, so a Ctrl-C does not block the retry that usually follows it.
A refusal names the current holder and when its lease expires, so the choice between waiting and investigating does not need a database query.
`skills/scrapers/SKILL.md` owns the concurrency contract, including why `scrape_runs.status` cannot be used as a liveness signal.

The former `fellowships:refresh` command wrote the fellowship catalog straight into Beta or Production and was removed on 2026-09-27; the `fellowship-development-full` sweep refreshes the catalog in Development and promotion carries it.

### Compact Observation Retention

The student data operator owns a manual retention review once per semester, after the full Development scrape and before Beta promotion.
Development is always cleaned first.
Record the Atlas restore boundary and keep scrapers and materializers paused for the dry-run and apply window.

Run the Development dry-run with an explicit target:

```bash
SCRAPER_ENV=development MONGODBURL=<development-url> \
  yarn --cwd server scrape prune-observations --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-development-observation-retention-dry-run.json
```

Review the eligible, reference-protected, and deletable candidate counts, recent-window cutoff, and retained run count before apply.
Development apply mode requires the non-production write guard and explicit confirmation:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true MONGODBURL=<development-url> \
  yarn --cwd server scrape prune-observations --apply --confirm-observation-prune --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-development-observation-retention-apply.json
```

Verify Atlas accepts a bounded write, then re-run integrity, claim, strict data-quality, and visibility gates.
Beta retention requires a new target-bound dry-run, the same restore-boundary record, and explicit operator approval after the Development rehearsal passes.
Never reuse Development candidate counts or an old Beta artifact.

The retention command deletes only old `superseded: true` observations that are not referenced by durable materialized records.
It always preserves active observations, recent observations inside the age window, observations attached to the latest retained runs per source, and observations referenced by provenance, access signals, or supersession links.
Retention is only projection-neutral while the materializer's read scope excludes superseded rows, so it refuses to apply under `C4_LOSSLESS_INGEST`, forces a dry-run when that flag is undeclared, and reports `projectionNeutral` in the artifact; `docs/research-data-pipeline.md` owns that contract and the reasoning behind it (#2944).
Read `projectionNeutral` before filing an artifact in a promotion packet: under lossless ingest the candidate count is a count of live evidence, not of dead storage.
Declare `C4_LOSSLESS_INGEST=false` (or `true`) in the environment the target materializes from, so the prune's view of the read scope is the materializer's view and not a blank shell's.
The artifact records the downgrade as `mode: dry-run` and `options.apply: false`, and `readScopeDeclared: false` names the cause, so a promotion packet whose apply run reports zero deletions can be read as an undeclared read scope rather than a clean corpus.
Use `--output <path>` on dry-runs and apply runs so the private promotion packet has eligible, protected, candidate, deleted, and retained-run counts plus command, target `environment`, `db`, and parsed `options`.

Production retention stays disabled.
A future reviewed issue must change the executable guard before any Production apply command can be prepared.

`observations:prune-dead` is a separate command, not part of this semester review: it drops the age floor to reclaim storage mid-run or on demand, keeps the last runs per source so claim-local rollback survives, and is blocked against production.
`docs/research-data-pipeline.md` owns its contract, guards, and sweep wiring.

### Repair orphaned Observation references in Development

Run this workflow only after a strict Development audit reports an Observation reference whose target no longer exists.
Keep scrapers and materializers paused for the classifier, review, apply, and verification window.
The command is Development-only and never creates replacement Observations.

Create a bounded, target-bound private classifier and decision template:

```bash
SCRAPER_ENV=development MONGODBURL=<development-url> \
  yarn --cwd server observations:repair-orphaned-references \
  --limit-per-reference=100 \
  --private-output=/tmp/ylabs-development-orphaned-observation-classifier.json \
  --decision-template-output=/tmp/ylabs-development-orphaned-observation-decisions.json
```

Review the private classifier locally.
For each decision, set `reviewedBy`, verify the recommended disposition against the owner and surviving evidence, and leave ambiguous rows as `defer_review` unless fail-closed archival has been explicitly accepted.
Do not paste identifiers, counts, samples, artifact hashes, or artifact paths into a public issue or pull request.

Apply only the reviewed bounded artifact to the same Development database:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true MONGODBURL=<development-url> \
  yarn --cwd server observations:repair-orphaned-references \
  --execute \
  --confirm-development-orphan-reference-repair \
  --max-apply=25 \
  --apply-from=/tmp/ylabs-development-orphaned-observation-classifier.json \
  --decisions=/tmp/ylabs-development-orphaned-observation-decisions.json \
  --private-output=/tmp/ylabs-development-orphaned-observation-apply.json
```

The apply pass rejects stale or target-mismatched artifacts, changed owners, recreated targets, non-deterministic replacements, and decisions outside the classifier contract.
It records each accepted repair in `observation_reference_repair_audits`.
Archived rollback records remain present with their surviving provenance metadata; only the dangling identifier is removed, and the unrecoverable loss receives an explicit audit.

After apply, rerun the classifier and the required gates:

```bash
SCRAPER_ENV=development MONGODBURL=<development-url> \
  yarn --cwd server observations:repair-orphaned-references \
  --limit-per-reference=100 \
  --private-output=/tmp/ylabs-development-orphaned-observation-postcheck.json

SCRAPER_ENV=development MONGODBURL=<development-url> \
  yarn --cwd server scraper:integrity-gate \
  --include-samples --include-claim-gate \
  --output=/tmp/ylabs-development-integrity-after-observation-repair.json

SCRAPER_ENV=development MONGODBURL=<development-url> \
  yarn --cwd server student-visibility:gate \
  --collection=all --mode=dry-run \
  --output=/tmp/ylabs-development-visibility-after-observation-repair.json

SCRAPER_ENV=development MONGODBURL=<development-url> \
  yarn --cwd server beta:data-quality \
  --strict --include-samples --progress \
  --output=/tmp/ylabs-development-quality-after-observation-repair.json
```

The repaired canonical collections must have no remaining active orphaned Observation references.
Any accepted exception needs a named owner and recovery plan in the private promotion packet.
Production writes remain out of scope.

## Cost Controls

Use these controls before spending cloud or API money:

- Run the initial backfill locally against Development; promotion carries it to Beta and Production at no fetch cost.
- Use `--limit`, `--only`, `--since`, and source-specific caps during the first pass.
- Keep LLM sources gated until the exact target list is accepted.
- Use `--use-cache` for development reruns only.
- Prefer the default HTTP validator cache over `--use-cache` for reruns: it saves transfer without consuming the Development database quota (#3536).
- Complete the tracked WorkPlanner cost-control work before unattended recurring paid/broad jobs.
- `lab-microsite-description-llm` and `lab-microsite-undergrad-llm` skip the paid LLM call when a per-entity `sourceContentHash` observation matches the fresh page input (page bytes for the undergrad lane, a digest of what the description lane reads for the description lane; [`research-data-pipeline.md`](./research-data-pipeline.md) owns why), so repeat runs (including `--exhaustive` sweeps that bypass WorkPlanner freshness) do not re-pay for unchanged pages.
  Pass `--force-llm` only when intentionally re-extracting a source whose hash is up to date.
  `lab-microsite-description-llm` also budgets for its research-page crawl: an entity whose page publishes a research anchor costs up to two extra HTTP fetches per run because the crawl feeds the hash input and therefore runs before that gate, and a crawled page that wins the description can add one LLM call for its own methods (#2176).
  One entity class never benefits from that gate: an entity where the extractor kept its stored description instead of an unopposed crawled one records no hash by design, so it re-fetches and re-extracts on every run until its pages or its stored description change ([`research-data-pipeline.md`](./research-data-pipeline.md) owns why).
  Treat that recurring per-entity cost as expected rather than a broken hash gate (#2180).

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

If a promoted dataset is bad:

1. Stop the rollout and do not promote again until the cause is classified.
2. Do not run more sources on top of questionable materialized data in Development.
3. For minor field-quality issues, fix the lane in Development, verify there, and promote again.
4. For a bad Beta copy or broad bad materialization, restore from the pre-run Atlas backup.
5. Rebuild or resync Meilisearch after restoring MongoDB.
6. Record the rollback and follow-up decision in the promotion's GitHub issue.

Claim-local rollback of a single run was only ever implemented for undergraduate logistics, which is retired (#3088), so there is no per-claim rollback path today: a bad run is handled by the steps above.

### Rolling back a written description

`fullDescription` and `shortDescription` are coupled, and treating either in isolation leaves the other wrong.
Never roll back or replace one without reverting or re-deriving the other in the same operation, then re-materializing.

The coupling is the `winnerFullUseful` guard in `server/src/scrapers/entityMaterializer.ts`: a resolved winner is accepted only when `fullDescriptionQuality(...).isUseful` holds, `isFullDescriptionRestatementOfShortDescription(...)` does not, **and** the serving check accepts it.
The serving check is `servingBarAcceptsFullDescription`, which calls the serving functions themselves: it requires `buildResearchEntityPublicDescriptionRepresentation(...).invariant.fullDescriptionUseful` **and** a non-empty `fullDescription` from `servedResearchEntityCopy` over the representation's entity, which is how the detail DTO derives the body, so the bar a body is adopted against is the bar that decides whether it serves, including the serve-time withhold of another organization's body (#3437).
Before that, a body could pass `fullDescriptionQuality` on its raw text, win the field, and then be refused at serve time as `missing_public_full_description` while a body that serves sat lower in the ranked list; measured on Development on 2026-10-01, 30 of the 178 live rows storing a refused body had a servable ranked candidate the walk now adopts.
A candidate the serving check refuses is still adopted where it was before, when the winner neither reads well nor serves, so a row with no servable candidate keeps what it had and is never blanked.
`adoptServableFullDescription`, which replaces an incumbent the serving check refuses or an incumbent that is a biography, asks the same check of each candidate after the projected-field sanitizer, so it judges the text the row would store.
`adoptServableShortDescription` is the card counterpart (#4392).
The write-time card check reads only the quality bar, and the serve sanitizer also blanks a first-person line, so a higher-confidence verbatim "we study ..." card outranked a servable card from another lane and the row served no card at all.
When the projected card would serve blank under `sanitizeResearchEntityShortDescription` and `servedCardClearsGateBar`, the first ranked candidate that would serve, and that also passes the write-time card check, is adopted; when none would, the stored card is left alone for the card re-derivation that follows.
Measured on Development on 2026-10-02, 21 of the 86 live rows storing a card the sanitizer blanks had a servable ranked card the walk adopts.
A biography is a fallback only (#4288, `docs/decisions.md` 2026-10-01).
An incumbent biography that serves yields to the first ranked candidate that serves, is research prose (not a biography, and its opening states research), and leaves the description pair passing the public-description invariant (`servingBarAcceptsDescriptionPair`), and to nothing else, so it is never traded for another biography, for a body that states no research, or for a body that restates the card and leaves the row with no card to serve.
An incumbent that serves nothing prefers a servable candidate that is not a biography and falls back to a servable biography, because refusing the biography took a served row off the surface (#4280).
Both arms judge a biography with `isBiographyRatherThanResearch` in `server/src/utils/biographyRatherThanResearch.ts`, which was calibrated by hand against served Development bodies: the career tests alone flagged research prose that opens on an orienting role, so a research statement in the opening two sentences withdraws the verdict.
The walk below refuses a biography under the union of that test and the two older ones, so it can never re-adopt what the pre-step displaced.
The serving check judges every candidate against the row's stored topics and as the stored-text normalization will leave it, because topic canonicalization and that normalization run after the description is chosen; judging the raw resolved topics refused a stored body the gate accepts.
A winner that restates the stored short is rejected, and the ranked walk can terminate having written nothing.
Since #2721 the materializer answers that pair by keeping the body and reopening the card for re-derivation instead of clearing `fullDescription`, so a stale short no longer costs a row its prose.
What it costs is the distinct body the walk refused: the row keeps a redundant pair until the stale short is unset, and card reconsideration writes a replacement only when one clears the card bar and beats the bare research-areas echo.
Nor does it trade a card that clears the bar for one that restates the body (#3866): a single-sentence body derives itself as its card, and served beside its own body that card reads as empty, so the replacement cost 9 Development rows their `student_ready` tier while each still had a live card observation.

The walk itself may not answer a pair rejection with a career biography, and until #2901 it did.
Both reasons a winner is rejected here are relationships to the CARD rather than judgements of the body, and a biography satisfies both by construction: a resume never restates a research card and is never thinner than one.
So the rows that served a resume under a research card were exactly the rows whose card was good, which is also why no count caught them: the card gate passes and `missing_card_description` never fires.
The walk now carries the same explicit biography rejection the access-signal lane's displacement bar carries, keyed on the same two predicates the confidence resolver's bio demotion selects on, so what the resolver demotes the walk cannot re-adopt.
Refusing every candidate leaves the resolver's winner in place, which is what the restatement branch above already wants.
Measured on Development: 4 rows served a biography under a clean research card and now serve their research body, and 67 live rows are in the state where the walk had an acceptable biography to take, split 34 restatement and 33 poorer-than-card.
A thinner research body under a richer card is the deliberate trade: the inversion is a redundant pair, while the biography is a data defect on the surface a student opened to look closer.

`fullDescriptionQuality(...).isUseful` is therefore not a recoverability verdict, and sizing a description repair pass on it overstates what the pass can recover.
The write path sanitizes a candidate before it judges it, so a body can clear every quality flag and still be reduced to nothing on the way in; that overcount is what sent a repair pass after rows the materializer was right to refuse while #2721 was being traced.
Use `fullDescriptionWouldMaterialize` in `server/src/utils/researchEntityDescriptionQuality.ts`, which composes the sanitizer, the quality bar, and (when the caller supplies the row's stored card) the restatement guard in the write path's own order.
Its doc comment owns the measured divergence and the reason the two verdicts disagree in both directions; do not restate those predicates here or in a repair script.

Program-like entities keep a narrower version of the old clear.
The materializer still empties a stored `fullDescription` that restates the card when no observation-backed body and no freshly derived card is in play, and that failure is invisible to the visibility gate: the short description survives, the record still looks complete, and the tier stays `student_ready` while the detail page drops to the surviving one-line card.
It is a loss of prose rather than a blank page, and that is why no gate catches it: the public-description gate fails closed only when both fields reduce to empty, so a body-less row that still has a card reads as healthy on every check.

Before #2721 the clear applied to every entity, and that is how 19 entities lost their description, 14 of them served, after 99 synthesized `fullDescription` observations were superseded without touching the `shortDescription` values that had been derived from them.
Marking the observations superseded and re-materializing was not enough, because the stale short was the thing causing the blank.
A perfectly good alternative was active and unused the entire time.

There is no standing command for this rollback.
`server/src/scripts/descriptionPairRollbackCore.ts` exports pure helpers (`descriptionPairObservationFilter`, `planDescriptionPairRollback`, `describeDescriptionPairRisk`) that encode the contract, and the operator still authors the one-off repair script that runs them.
Author it under the same guards as the sibling description repairs (`server/src/scripts/purgeMiskeyedProfileDescriptions.ts`): dry-run by default, writes only under `--apply` plus a named `--confirm-...` flag, with a `--max-apply` ceiling and a JSON `--output` plan.

Procedure:

- Check first whether the prior pair is a manufactured duplicate.
  Restoring both fields to their pre-rollback values is **not** automatically safe: the `studentReadyDescription` emit block in `server/src/scrapers/sources/labMicrositeUndergradLLMExtractor.ts` emits one string as `fullDescription` at 0.55 and, when it is card-length, the same string again as `shortDescription` at 0.55.
  What decides whether such a pair is stable is how its two members are attributed, not the duplication.
  Both of those pushes share one `...base`, so they carry the same `sourceName` and `sourceUrl`, the materializer treats the projected short as self-derived from the full, the guard is not applied, and the row keeps serving its prose.
  Re-attribute the same string across two URLs or two sources, which is what a hand repair does and what a second source writing the card produces, and the short reads as independent evidence, so the guard fires: the row keeps the duplicated body, the ranked walk writes nothing distinct, and the detail page has nothing the card does not already say.
- When the restored pair would be attributed that way, no data repair holds until the emitting source stops producing the duplicate.
  Fix the source, then repair the rows.
- Use `server/src/scripts/descriptionPairRollbackCore.ts` to build the observation filter, so the query cannot be scoped to one field by accident, and so rows stored under `entityId` rather than `entityKey` are matched too.
- Unset the projected `shortDescription` and `fieldProvenance.shortDescription` on the entity document in the same operation, before re-materializing.
  `shortDescription` is not in `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`, so the projected card outlives the observation that produced it and the guard keeps refusing every replacement full: the record settles on a body that restates the stale card however many times it is re-materialized, rather than on the distinct one the ranked walk was holding.
  `planDescriptionPairRollback` returns those paths in `entityFieldsToUnset`.
- Verify afterwards on the served record, not on the supersede count.
  `describeDescriptionPairRisk` reports the three failure states, using the same two predicates as the materializer guard: an empty full description, a full that restates the short and so serves the same sentence on the card and the detail page, and a full that is distinct but below the usefulness bar, which the ranked walk refuses to write.
  A restating pair no longer blanks on the next materialize, because the materializer keeps the body and reconsiders the card instead, so treat that verdict as "the emitting source still needs fixing" rather than as "this row is about to lose its description".
  The row serves that body however close the pair is: since #2721 the serve-time DTO no longer withholds a body that merely restates the card, so the detail page shows the stored body rather than falling back to the thinner card.
  Pass the whole served document, including `fieldProvenance`.
  It routes the short through the same self-derived exclusion the guard uses, so reading the raw stored short instead would report every re-derived card as a restatement and send an operator back to re-repair a healthy row.
- Include an empty-`fullDescription`-on-`student_ready` count in any post-run diff.
  This failure cannot be caught by tier checks, by construction.
