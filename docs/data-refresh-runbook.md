# Development, Beta, and Production Data Refresh Runbook

Status: canonical operator runbook

Last updated: 2026-07-25

## Purpose

Use this runbook to refresh Yale research data without confusing Development, Beta, and Production targets.
The local machine performs network fetches that require Yale VPN.
The Beta Render service performs Beta materialization and Beta Meilisearch synchronization.
Production receives data only through the guarded accepted-Beta promotion.

## Mandatory Yale VPN Preflight

**Stop: do not start a Yale-only fetch until the operator has turned on Yale VPN.**

Off-campus operators must connect to the Yale VPN profile `access.yale.edu` and complete NetID and Duo authentication.
Follow the [official Yale VPN instructions](https://docs.ycrc.yale.edu/clusters-at-yale/access/vpn/).
Each operator must authenticate with their own Yale identity.
Never share or store a NetID password, Duo approval mechanism, or other Yale login secret in this repository, an environment file, Render, or a scheduled job.

Keep the VPN connected for the entire fetch.
After local Development infrastructure is running, prove that the specific source is reachable with a one-record dry-run:

```bash
export SOURCE_NAME='ysm-atoz-index'
test -n "$SOURCE_NAME"

yarn scrape:development run \
  --source "$SOURCE_NAME" \
  --limit 1 \
  --dry-run \
  --output "/tmp/ylabs-vpn-preflight-${SOURCE_NAME}.json"
```

Open the artifact and stop on authentication errors, HTTP 401 or 403 responses, timeouts, or an unexpected zero-result response.
This source-specific dry-run is the VPN check because a generic internet or IP check does not prove that the Yale source is accessible.
If the VPN disconnects during a fetch, treat that run as partial.
Do not materialize its run ID.
Reconnect, repeat the preflight, and create a new run.

## Sustainable Ownership

This local-fetch model is the best near-term option while Yale-only sources require an interactive Yale identity and Duo.
It is maintainable after an individual leaves only when the workflow belongs to the team rather than to one laptop or one account.

Before relying on this runbook, the team must have:

- At least two trained Yale-affiliated operators who can connect with their own NetID and Duo.
- A primary and backup operator assigned for each semester refresh.
- Organization-owned GitHub, Render, MongoDB Atlas, and Meilisearch administration with at least two current administrators.
- A team-owned Beta database user restricted to the `Beta` database and stored in the approved team secret manager.
- Production credentials kept out of local scraper profiles and available only to approved promotion operators.
- A shared record of the source list, expected observation ranges, artifact location, Beta backup, Production restore point, and final gate results for each refresh.

Before an operator leaves the team:

1. Transfer ownership of organization resources and confirm that two remaining administrators can access them.
2. Rotate any database, Render, Meilisearch, or other application credentials the departing operator knew.
3. Have a replacement operator complete the handoff rehearsal below using their own Yale VPN login.
4. Remove the departing operator's access after the transfer and credential rotation are verified.

The handoff rehearsal must not write to Production.
The replacement operator should:

1. Connect to `access.yale.edu` with their own NetID and Duo.
2. Start Development infrastructure and complete the one-record VPN preflight.
3. Run a bounded Development scrape and verify the local application and local search.
4. Run a bounded Beta dry-run, identify the saved artifact and `run.id`, and explain where Beta materialization occurs.
5. Walk through the Production dry-run, restore-point, search, and smoke gates without applying the Production promotion.

Do not automate the interactive Yale VPN login or store personal Yale credentials for cron.
The durable long-term replacement is an approved team-managed runner on the Yale network that does not depend on a member's personal laptop.
Until that runner exists, use a semester calendar reminder and this operator checklist rather than an unattended scraping cron.
Render automation remains appropriate for work that does not need Yale network access, including materialization, Meilisearch synchronization, and gates.

## Environment Sizing and Where the Release Candidate Is Built

Development holds a representative sample for script and scraper testing and dry runs, not a full copy of the dataset.
The full release candidate is built and run at scale on Beta.
This keeps two full copies of the roughly one million document dataset out of Development and Beta at the same time, which matters on a constrained Atlas tier.

Under this model Development proves correctness and Beta is the single full-scale environment.

Development responsibilities:

- Validate scraper and script logic with bounded runs such as `scrape:development:all:plan` and `scrape:development:all:sample`.
- Keep every registered source and representative edge cases present so a dry run is trustworthy.
- Stay disposable and cheap to reset.

Beta responsibilities:

- Run the full exhaustive release-candidate fetch at scale with `scrape:beta:all:fetch`.
- Materialize, gate, and audit the accepted dataset as described in Phase 3.
- Serve as the accepted source for the guarded Beta to Production promotion.

Tradeoffs this model accepts:

- The Yale VPN fetch runs against Beta, so the expensive fetch is not reused from a prior Development sweep.
- Development validates correctness rather than scale, so scale and query-cost review happens on Beta and ProductionCopy.
- Development must stay representative enough that a passing dry run is trustworthy, so keep the full source list rather than trimming to a tiny subset.

The alternative model runs the full exhaustive sweep on Development and mirrors the accepted result up with `beta:refresh-from-development`.
Choose it when running the Yale fetch once and copying the result is worth keeping the swept dataset in Development.
The mirror no longer implies a second full copy: it leaves the evidence log behind, so it moves about 23,000 documents rather than 436,026.
See "Observations stay in Development" below for what that costs on the target.
Phase 1 below documents that optional full Development sweep, and Phase 2 documents the primary Beta release-candidate fetch.

## Fixed Environment Responsibilities

| Environment | MongoDB                      | Meilisearch                               | Responsibility                                                                         |
| ----------- | ---------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Development | Atlas `Development` database | Local Docker                              | Representative-sample script and scraper testing, dry runs, and disposable experiments |
| Beta        | Atlas `Beta` database        | Render private service with `beta` prefix | Clean staging candidate and human audit                                                |
| Production  | Atlas `Production` database  | Render private service with `prod` prefix | Accepted live data only                                                                |

Development data may be promoted into Beta only through the guarded research-data mirror described below.
The mirror replaces approved research and evidence collections while preserving Beta operational collections and sanitizing copied account state.
The tested scraper code may instead be rerun against Beta from the local VPN-connected machine when a source-level refresh is required.
The local Beta run writes observations only.
The Beta Render service materializes those observations by run ID and updates its private Meilisearch indexes.

### Observations stay in Development

Every mirror leaves `observations` behind by default, in both directions and on the Beta to Production promotion.
Pass `--include-observations` to opt in; `--skip-observations` remains accepted and is now the default behavior.

The reason is storage, and it is not theoretical.
All three databases live on one Atlas cluster (`yalelabs0`), so Development, Beta, and Production share a single quota.
Development holds roughly 1.07 GB across 514,366 objects, and 412,997 of those objects are observations: about 95 percent of the volume is the evidence log rather than the product.
A mirror that carried observations would copy 436,026 documents and duplicate that footprint inside the same quota, which can exhaust the cluster and take the live site down to populate a staging environment.
Without them the same mirror copies about 23,000 documents across the reviewable corpus and the identity spine.

What the mirror does copy is the corpus a reviewer reads plus the identity that resolves it: `research_entities`, `research_entity_relationships`, `research_entity_redirects`, `canonical_aliases`, `signals`, `researchers`, `role_assignments`, `accounts`, `sources`, `scrape_runs`, `departments`, `org_units`, `research_areas`, `taxonomy_terms`, and `fellowships`.
Identity is not optional in that list.
A mirrored environment holding `research_entities` without `researchers`, `role_assignments`, and `accounts` serves a corpus whose every lead is unresolvable, which fails as `missing_lead` across the whole dataset rather than in one place.
Copying `canonical_aliases` carries the resolve-at-mint alias ledger, so a scrape on the target resolves to the same canonical records instead of minting duplicates beside them.
Copying `taxonomy_terms` also carries the approved research-area vocabulary, which nothing else can currently seed into a fresh environment.

The frozen evidence claim-graph collections (`evidence_claims`, `source_documents`, `review_decisions`) are classified as excluded rather than copied: they are unwired do-not-build-on contracts, and the live evidence path is `observations` to `signals`.
The mirror carries each replaced collection's `$jsonSchema` validator onto its replacement, so a mirrored target keeps rejecting the writes the canonical validators reject.

Two consequences follow, and both are load-bearing.

First, a target mirrored without observations must not be re-materialized.
The materializer derives fields from the observation trail, so running it against a target that has no trail replaces source-backed values with nothing.
Serve, re-gate, and reindex on such a target; run `scrape materialize` only where the observations actually live.

Second, `scrape_runs` and `signals.source.evidenceIds` arrive pointing at observation rows the target does not hold.
That is expected on a mirrored environment and is not a data-integrity finding.

`analytics_events` and `scrape_job_locks` are never copied by any mirror, in any mode.
Copied telemetry would attribute one environment's student behavior to another, and a copied lock lets a second environment's scraper believe a job is already held.

## Where Each Step Runs

| Step                                     | Execution location              | MongoDB target                     | Meilisearch target              |
| ---------------------------------------- | ------------------------------- | ---------------------------------- | ------------------------------- |
| Development scrape and test              | Local machine on Yale VPN       | Atlas `Development`                | Local Docker `researchentities` |
| Beta fetch                               | Local machine on Yale VPN       | Atlas `Beta`                       | None                            |
| Beta materialization and search rebuild  | Beta Render shell               | Atlas `Beta`                       | `beta_researchentities`         |
| Beta-to-Production promotion             | Local approved operator machine | Atlas `Beta` to Atlas `Production` | None                            |
| Production search rebuild and smoke test | Production Render shell         | Atlas `Production`                 | `prod_researchentities`         |

Complete the Development and Beta steps for each source.
Promote to Production only once, after every accepted source has been materialized and audited in Beta.
Development is the local iteration environment.
Beta is the staging environment, but its Yale-only network fetch still runs locally through Yale VPN.
The local Beta fetch writes observations to Atlas Beta without touching Meilisearch.
The Beta Render shell materializes those observations and updates Beta Meilisearch.
The Beta-to-Production MongoDB promotion runs locally and does not require Yale VPN because it only connects to Atlas.
The Production Render shell rebuilds Production Meilisearch after the local promotion finishes.

In the Render dashboard, use the shell attached to the Beta web service for Phase 3 and the shell attached to the Production web service for Phase 5.
Never run a Beta Meilisearch command in the Production shell or a Production Meilisearch command in the Beta shell.
Run every command from the repository root.
At the start of each local or Render shell, verify the working directory:

```bash
test -f package.json
test -d server
```

## Never Do These Things

- Never point ordinary local development at the `Beta` or `Production` database.
- Never give the Development or Beta database user access to `Production`.
- Never add `--auto-materialize` to a local Beta operator run.
- Never copy Development into Beta outside the guarded research-data mirror.
- Never copy Development sessions, analytics, caches, locks, or experimental operational data into Beta.
- Never run the production copy without a reviewed dry-run and a real Production restore point.
- Never assume that changing MongoDB also updates a Render-private Meilisearch index.

## One-Time Local Setup

Create the two uncommitted environment profiles:

```bash
cp server/.env.example server/.env
cp server/.env.beta-operator.example server/.env.beta-operator
```

Fill in placeholders in both files.
The Development Atlas credential must have read/write roles for `Development` only.
The Beta Atlas credential must have read/write roles for `Beta` only.
Do not place a Production MongoDB URL in either file.

Start local Meilisearch:

```bash
yarn dev:infra:up
```

Start the application:

```bash
yarn dev:server
yarn dev:client
```

`yarn dev:server` loads `server/.env` and requires a remote MongoDB database named exactly `Development`.
It uses the local Docker Meilisearch service with no index prefix.

## Refresh Development From Accepted Beta

Use this one-way sync when Development should start from the current accepted Beta research dataset.
The command can read only from a remote database named `Beta` and can write only to a different remote database named `Development`.
It refuses local MongoDB and any Production database.

The sync mirrors every document in the approved Beta research-discovery, identity-spine, source-audit, and base-support collections, and leaves `observations` behind in Beta unless `--include-observations` is passed.
See ["Observations stay in Development"](#observations-stay-in-development) above for the exact copy set and why it is drawn that way.
The standard plan declares, and the standard apply clears, Atlas Development collections that are outside that approved mirror.
It never reads Beta analytics, admin grants, admin audit and access-review projections, job locks, scraper caches, student profiles, applications, tracking, outreach, claims, private research plans, or release queues; the plan artifact's `excludedOperationalCollections` is the authoritative list.
Every Beta account and role assignment has a Development counterpart so references and role distributions remain valid.
Accounts reachable from a `Researcher` keep the directory netid and email Yale already publishes, every other account is deterministically pseudonymized, and each copied account is reduced to an allow-list of identity fields so student profile and account-activity state never crosses.
An unclassified Beta collection blocks apply until its mirror or exclusion policy is reviewed.
Apply stages and validates every mirrored collection before cutover.
It retains the prior mirrored and non-mirror collections as temporary backups until the complete cutover passes post-sync verification, then restores the entire prior Development dataset if cutover or verification fails.
The local Development ResearchEntity Meilisearch index is rebuilt after the MongoDB sync.

Yale VPN is not required for this Atlas Beta-to-Atlas Development copy.
Yale VPN is still mandatory when Development performs a Yale-only source fetch after the copy.

Start the local Meilisearch service:

```bash
yarn dev:infra:up
```

Create and review the dry-run artifact:

```bash
yarn development:refresh-from-beta:plan
```

The artifact is `/tmp/ylabs-beta-to-development-plan.json`.
Confirm that the source ends in `/Beta`, the destination ends in `/Development`, every mirrored source count matches its copy count, `includesObservations` is `false` unless the evidence log was deliberately requested, and `unclassifiedBetaCollections` is empty.

Apply the reviewed sync:

```bash
yarn development:refresh-from-beta:apply
```

Rebuild local ResearchEntity search from the synchronized Atlas Development MongoDB:

```bash
yarn development:search:rebuild
```

This is a snapshot refresh rather than continuous replication.
Local scraping and materialization can intentionally change Development after the sync.
Running the standard sync again replaces the approved Atlas Development mirror with the latest accepted Beta snapshot and clears all non-mirror Development collections.

## Phase 1: Development Validation - Run Locally on Yale VPN

Turn on Yale VPN and complete the Mandatory Yale VPN Preflight before running Yale-only sources.

List the registered source names:

```bash
yarn scrape:development list
```

The `--source "$SOURCE_NAME"` form runs exactly one scraper.
Use it only while iterating on or repairing that specific scraper.
For example:

```bash
export SOURCE_NAME='ysm-atoz-index'
test -n "$SOURCE_NAME"
yarn scrape:development run \
  --source "$SOURCE_NAME" \
  --limit 1 \
  --dry-run \
  --output "/tmp/ylabs-vpn-preflight-${SOURCE_NAME}.json"
```

The normal coverage workflow runs every registered source.
The sweep manifest is dependency ordered and refuses to start if a registered scraper is missing from the manifest.

Seed source metadata when initializing a new Development database:

```bash
yarn profile:development yarn --cwd server scrape:seed-sources \
  --dry-run \
  --output /tmp/ylabs-development-seed-sources-plan.json
```

Review the plan.
Then apply the source metadata seed:

```bash
yarn profile:development:write yarn --cwd server scrape:seed-sources \
  --apply \
  --confirm-seed-apply \
  --output /tmp/ylabs-development-seed-sources-result.json
```

Run a bounded dry-run of every source.
This uses a 100-record limit per source and cache where supported:

```bash
yarn scrape:development:all:plan
```

Run a bounded Development write and materialization sweep after reviewing the plan:

```bash
yarn scrape:development:all:sample
```

Fix and rerun individual sources until the bounded sweep has no unexplained failures, conflicts, unsafe contact data, or missing credentials.
Under the primary model the release candidate is fetched at scale on Beta in Phase 2, so the bounded Development sample above is the normal stopping point.
Run the full Development sweep below only for the optional fetch-once-and-mirror model described in Environment Sizing:

```bash
yarn scrape:development:all:full
```

The full command runs every source in the canonical sweep manifest with `--exhaustive`, reuses the fetch cache with `--use-cache`, bypasses freshness skips for coverage measurement, and materializes each successful run into Atlas Development.
`--exhaustive` disables the default candidate caps inside the LLM and backfill scrapers as well as omitting the shared `--limit`.
This can take hours and can make many paid API calls.
Only run it after the bounded sample succeeds.
After the source sweep, the same command projects active faculty into the Account/Researcher model, runs a full-corpus student-visibility gate so gate-logic changes propagate before the index rebuild, rebuilds local Development Meilisearch, runs the coverage audit, strict data-quality audit, integrity gate, and strict student trust contract, and finishes with a report-only archived-cleanup stage that lists deletable dedup-residue archived entities without ever deleting them.
Every post-run stage executes even when an earlier quality gate fails, so the operator receives every report; `docs/research-data-pipeline.md` owns the authoritative stage list.
The overall command exits nonzero when a source or post-run stage fails.
The runner prints an output directory under `/tmp`.
That directory contains one JSON report per source, `summary.json`, the faculty projection report, the student-visibility gate report, the search rebuild report, all four coverage and quality reports, and the report-only archived-cleanup report.
Each summary row includes observation and entity yield, fetch successes and failures, blocked requests, selector breakages, warnings, and materialization counts.
Development continues after a source failure so the summary captures every problem, but it exits nonzero when any source failed.

A plain re-invocation of the same sweep mode resumes the previous run from its durable checkpoint instead of starting from scratch: it reuses that run's output directory, skips every step already marked done, and re-runs the rest.
Append `--restart` to the command (for example `yarn scrape:development:all:full --restart`) to abandon the checkpoint and force a fresh run.
Alongside the per-source reports the printed directory holds `runner.log`, `errors.log`, and one `.log` file per step, so a failed step's captured output is on disk without re-running it.
Step output goes to those log files rather than the terminal, so follow a long run with `tail -f` on the current step's `.log` path.
`docs/research-data-pipeline.md` owns the resume rules, the conditions under which the sweep refuses or narrows a resume, and the optional `--force-llm` and `--prune-between-phases` flags.

For routine recurring refreshes, run the incremental sweep instead of the full sweep:

```bash
yarn scrape:development:all:incremental
```

The incremental command runs the same sources exhaustively, reuses the fetch cache, materializes into Atlas Development, and runs the same post-run stages as the full command.
It differs by honoring WorkPlanner freshness skips instead of re-fetching every entity, so already-fresh entities are skipped and routine sweeps stay cheap.
Reserve the full sweep for periodic deep coverage refreshes where you intentionally re-fetch every eligible entity.

To refresh only the `/programs` fellowship catalog, run the fellowship engine instead of the research engine:

```bash
yarn scrape:development:fellowships:full
```

That command runs only the fellowship catalog sources and the fellowship post-run chain (the `programs:*` backfills plus the two report-only `programs:audit-*` stages), so it never touches `ResearchEntity` data.
Both of its opt-in stages stay off unless you set their flags: `SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET=1` to replay the curated official-source change-set, and `SCRAPER_SWEEP_REFRESH_FELLOWSHIPS=1` (plus a target and restore token) for `fellowships:refresh`, which no Development sweep can satisfy and which therefore stays skipped here.

Use targeted single-source commands while repairing a failed source:

```bash
export SOURCE_NAME='ysm-atoz-index'

yarn scrape:development:write run \
  --source "$SOURCE_NAME" \
  --ignore-work-planner \
  --exhaustive \
  --auto-materialize \
  --output "/tmp/ylabs-development-${SOURCE_NAME}-repair.json"
```

The post-run artifacts in the printed sweep directory are:

- `development-faculty-projection.json`
- `development-visibility-gate.json`
- `development-search-rebuild.json`
- `development-coverage.json`
- `development-data-quality.json`
- `development-integrity.json`
- `development-trust-contract.json`
- `development-archived-cleanup.json`

Coverage is not a claim of absolute Yale ground truth.
Compare source discovery counts, eligible candidate counts, observations, materialized entities, field coverage, and quality failures with the last accepted Beta baseline.
Investigate unexpected decreases, unexpected zero-count sources, sharp changes in source yield, duplicate growth, unresolved references, unsafe contacts, and trust-contract failures before moving to Beta.

With `yarn dev:server` running, verify the local search endpoint:

```bash
curl --fail-with-body \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"page":1,"pageSize":1}' \
  http://127.0.0.1:4000/api/research/search
```

Add `--ignore-work-planner` only when intentionally auditing every eligible entity instead of skipping fresh work.
Inspect the local application and local search after each materialized source.

Stop this phase if the report status is not `success`, materialization errors are nonzero, conflicts are unexplained, or public contact data is unsafe.

## Phase 2: Beta Staging Fetch - Run Locally on Yale VPN

### Fast path: mirror an accepted Development research dataset

Use this path when the complete Development dataset already passed the same release quality gates and rerunning every scraper against Beta would duplicate accepted work.
The command replaces only the approved research-discovery, identity-spine, source-audit, and base-support collections, with account state sanitized.
It preserves Beta operational collections such as sessions, analytics, admin grants, student workflows, locks, caches, and release queues.
It leaves `observations` in Development unless `--include-observations` is passed, so review the plan's `observationPolicy` line before applying.
It never writes to Meilisearch.
After the mirror, rebuild Beta Meilisearch and re-gate on Beta; do not run `scrape materialize` against a Beta that holds no observations.

Generate and review the plan locally:

```bash
yarn beta:refresh-from-development:plan
```

Confirm that the source is `Development`, the target is `Beta`, and every proposed source count is expected.
Apply the reviewed mirror with the explicit staging-overwrite confirmation:

```bash
yarn beta:refresh-from-development:apply
```

Stop if the result does not report `"status": "applied"` or any post-copy target count differs from its source copy count.
Continue with the Beta Meilisearch rebuild and strict readiness gate in Phase 3.

The source-level Beta fetch below remains the supported path when Development has not passed the release gates or the operator needs fresh Beta observations and exact Beta run IDs.

Beta Render does not perform the Yale-only fetch.
The local machine performs the fetch while targeting Atlas `Beta`.
Keep Yale VPN connected throughout this phase.
Run this phase only after the exhaustive all-source Development sweep has succeeded and its data-quality review has been accepted.

Before changing Beta, record its backup or manual recovery artifact and run the Beta diagnostic from the Beta Render shell:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:readiness
```

On the local VPN-connected machine, confirm that the Beta profile resolves correctly:

```bash
yarn scrape:beta list
```

Run a bounded dry-run of the complete, dependency-ordered source manifest:

```bash
yarn scrape:beta:all:plan
```

Run the exhaustive Beta release-candidate fetch after reviewing the bounded plan:

```bash
yarn scrape:beta:all:fetch
```

The Beta fetch uses the same canonical sweep manifest and exhaustive candidate behavior that passed in Development.
It bypasses freshness skips, stops at the first failed source, and never materializes locally.
The runner prints an output directory under `/tmp`.
Open its `summary.json`.
Each successful row contains the exact run ID and the Beta Render plan and apply commands for Phase 3.

Stop if the summary does not report every manifest source as successful with zero failed or not-run sources, a source unexpectedly returns zero observations, or any report contains unexplained errors.

## Phase 3: Beta Materialization and Search - Run in the Beta Render Shell

Run these commands from the Beta Render shell.
The Render environment must resolve MongoDB to `Beta`, Meilisearch to the private Beta service, and `MEILISEARCH_INDEX_PREFIX` to `beta`.

Before materializing, verify the Beta Render environment without printing credentials:

```bash
test "$SCRAPER_ENV" = 'beta'
test "$MEILISEARCH_INDEX_PREFIX" = 'beta'
node --input-type=module --eval '
  const database = decodeURIComponent(new URL(process.env.MONGODBURL).pathname.slice(1));
  if (database !== "Beta") throw new Error(`Expected Beta MongoDB, received ${database}`);
  console.log("MongoDB target verified: Beta");
'
```

For each successful source row in the local Beta `summary.json`, copy its source name and exact run ID into the Beta Render shell:

```bash
export SOURCE_NAME='<sourceName from summary.json>'
export RUN_ID='<runId from summary.json>'
test -n "$SOURCE_NAME"
test -n "$RUN_ID"
```

Preview materialization for the recorded run:

```bash
SCRAPER_ENV=beta \
  yarn --cwd server scrape materialize \
  --run "$RUN_ID" \
  --dry-run \
  --output "/tmp/ylabs-beta-${SOURCE_NAME}-materialize-plan.json"
```

Review the plan and then materialize the same run:

```bash
SCRAPER_ENV=beta \
ALLOW_NON_PROD_SCRAPER_WRITES=true \
  yarn --cwd server scrape materialize \
  --run "$RUN_ID" \
  --confirm-materialize \
  --output "/tmp/ylabs-beta-${SOURCE_NAME}-materialize-result.json"
```

This command updates Beta MongoDB and upserts the affected Beta ResearchEntity search documents.
It does not require another Yale network fetch.
Repeat the two materialization commands for every successful row in the Beta sweep summary.

Run the Beta gates after all accepted source runs are materialized:

```bash
SCRAPER_ENV=beta \
  yarn --cwd server beta:data-quality \
  --strict \
  --include-samples \
  --progress \
  --output /tmp/ylabs-beta-data-quality.json

SCRAPER_ENV=beta \
  yarn --cwd server scraper:integrity-gate \
  --include-samples

SCRAPER_ENV=beta \
  yarn --cwd server launch:trust-contract \
  --collection=all \
  --mode=student-ready-only \
  --strict
```

Create and verify the required Beta Meilisearch restore point or export.
Store its reference in the Beta Render environment as `PFR3_MEILI_RESTORE_POINT`.
Then fully rebuild the Beta ResearchEntity index so deleted or archived MongoDB records cannot remain as stale search documents:

```bash
test "$MEILISEARCH_INDEX_PREFIX" = 'beta'
test -n "$PFR3_MEILI_RESTORE_POINT"

SCRAPER_ENV=beta \
  yarn --cwd server meili:rebuild-research-entities \
  --clear \
  --confirm-meili-rebuild \
  --output /tmp/ylabs-beta-researchentities-rebuild.json
```

Confirm that the rebuild artifact reports the expected indexed count.
Then run the strict Beta readiness gate:

```bash
SCRAPER_ENV=beta \
  yarn --cwd server beta:readiness \
  --confirm-beta-backup \
  --strict \
  --output /tmp/ylabs-beta-readiness-final.json
```

Audit the Beta website after the gates pass.
Test broad search, known entity detail pages, access evidence, source links, and representative edge cases.

Stop before Production if any strict gate fails or the Beta UI does not match the accepted data.

## Phase 4: Beta-to-Production MongoDB Promotion - Run Locally

The current supported Production lane is an accepted Beta copy.
It is not continuous replication.
Run the promotion from a trusted operator environment with separate Beta and Production credentials.
This means the approved local operator machine, not either Render shell.
Yale VPN is not required for this phase because it only copies Atlas data.

Load the two MongoDB URLs from the approved team secret manager.
If the secret manager does not inject shell environment variables directly, enter them without saving them in shell history:

```bash
read -rsp 'Beta MongoDB URL: ' BETA_MONGODBURL
echo
read -rsp 'Production MongoDB URL: ' PRODUCTION_MONGODBURL
echo
export BETA_MONGODBURL
export PRODUCTION_MONGODBURL
```

Verify both database names without printing either credential:

```bash
node --input-type=module --eval '
  const beta = decodeURIComponent(new URL(process.env.BETA_MONGODBURL).pathname.slice(1));
  const production = decodeURIComponent(
    new URL(process.env.PRODUCTION_MONGODBURL).pathname.slice(1),
  );
  if (beta !== "Beta") throw new Error(`Expected Beta source, received ${beta}`);
  if (production !== "Production") {
    throw new Error(`Expected Production target, received ${production}`);
  }
  console.log("Promotion targets verified: Beta -> Production");
'
```

Create the required dataset version from the current date:

```bash
export PROMOTION_DATASET_VERSION="prod-promote-$(date +%F)-lane-a-beta-copy"
```

Run the promotion dry-run:

```bash
yarn --cwd server production:promote-beta-copy \
  --output /tmp/ylabs-production-promotion-plan.json
```

Review the artifact and confirm all of the following:

- `sourceEnvironment` is `beta`.
- `targetEnvironment` is `production`.
- `syntheticReferenceBlockersClear` is `true`.
- `applyBlockers` is empty.
- `includesObservations` is `false` unless the evidence log was deliberately requested with `--include-observations`.
- Every source copy count is expected.

Create and record a real Production Atlas restore point.
Atlas Free does not provide managed backups, so stop here if no valid restore path exists.

Set the exact restore-point reference:

```bash
export ATLAS_RESTORE_POINT='<fresh-production-restore-point>'
test -n "$ATLAS_RESTORE_POINT"
```

Apply only after the dry-run and restore point are accepted:

```bash
CONFIRM_LANE_A_COPY=true \
CONFIRM_PROD_SCRAPE=true \
  yarn --cwd server production:promote-beta-copy \
  --apply \
  --output /tmp/ylabs-production-promotion-apply.json
```

Stop if the command does not print `"status": "applied"` or if any post-copy count differs from the Beta source copy count.

## Phase 5: Production Search and Smoke Gate - Run in the Production Render Shell

The current accepted-Beta copy replaces complete allowlisted MongoDB collections.
Until a durable run-scoped search outbox exists, the safe supported Production search step is a full rebuild.

Run all commands in this phase from the Production Render shell.
First verify the Production environment without printing credentials:

```bash
test "$SCRAPER_ENV" = 'production'
test "$MEILISEARCH_INDEX_PREFIX" = 'prod'
node --input-type=module --eval '
  const database = decodeURIComponent(new URL(process.env.MONGODBURL).pathname.slice(1));
  if (database !== "Production") {
    throw new Error(`Expected Production MongoDB, received ${database}`);
  }
  console.log("MongoDB target verified: Production");
'
```

Create and verify the Production Meilisearch restore point or export.
Store its reference in the Production Render environment as `PFR3_MEILI_RESTORE_POINT`.
Stop if the reference is missing:

```bash
test -n "$PFR3_MEILI_RESTORE_POINT"
```

Rebuild the Production ResearchEntity index from the newly promoted Production MongoDB:

```bash
SCRAPER_ENV=production \
CONFIRM_PROD_SCRAPE=true \
  yarn --cwd server meili:rebuild-research-entities \
  --clear \
  --confirm-meili-rebuild \
  --output /tmp/ylabs-production-researchentities-rebuild.json
```

Confirm that the rebuild artifact reports the expected indexed count.
Run the Production smoke from the same Render shell:

```bash
yarn security:smoke:production
```

Do not declare the refresh complete until MongoDB promotion, the Meilisearch rebuild, and Production smoke all pass.

## Completion Record

Save the following references in the shared semester refresh record:

- The source names and Development sample and full artifacts.
- The Beta fetch artifacts and exact `run.id` values.
- The Beta materialization artifacts.
- The Beta data-quality, integrity, trust-contract, Meilisearch, and readiness artifacts.
- The Production Atlas restore point.
- The Production promotion dataset version and plan.
- The Production Meilisearch restore point and ResearchEntity rebuild artifact.
- The Production smoke results.
- The operator name, reviewer name, date, and any accepted exceptions.

The refresh is incomplete if any required artifact, restore point, or independent reviewer is missing.

## Fast Decision Table

| Situation                                    | Action                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Need more data for debugging                 | Run a larger Development scrape locally                                                        |
| Development looks correct                    | Rerun the source against Beta with `scrape:beta:write`                                         |
| Beta observations were fetched               | Materialize the exact run ID from the Beta Render shell                                        |
| Beta search is stale                         | Rerun Beta materialization for the accepted run ID or use the documented Beta rebuild recovery |
| Beta gates fail                              | Stop and repair Beta                                                                           |
| Production restore point is missing          | Stop before Production apply                                                                   |
| Production Mongo succeeded but search failed | Keep the Mongo result, repair/rebuild Meilisearch, and do not claim completion                 |

## Recovery

Local Development is disposable and can be reset from the accepted Beta snapshot or a new scrape.
Beta recovery uses the recorded Beta backup or a fresh controlled reseed.
Production recovery restores the recorded pre-promotion Atlas restore point and then rebuilds Meilisearch.
Never use a Development database copy as a Production rollback.
