# Development, Beta, and Production Data Refresh Runbook

Status: canonical operator runbook

Last updated: 2026-09-27

## Purpose

Use this runbook to refresh Yale research data without confusing Development, Beta, and Production targets.
Scraper sweeps run only against Development, from the local machine, and need no Yale VPN.
Beta receives the accepted Development dataset only through the guarded `beta:refresh-from-development` mirror.
Production receives data only through the guarded accepted-Beta promotion, `production:promote-beta-copy`.
Each promotion is followed by a re-gate and a search reindex on its target, run from that environment's Render shell.
The scrape CLI refuses any `run` or `materialize` write against Beta or Production, and `docs/decisions.md` records why (2026-09-27).

## Source Reachability Preflight

Scraper sources do not require Yale VPN or Yale wifi.
A paired on-campus and off-campus measurement established this, and the decision entry "2026-09-18: Scraper Fetches Do Not Require Yale VPN" in `docs/decisions.md` owns its figures.

Exactly one host in the corpus is reachable only from Yale network.
`ensemble.yale.edu` sits behind an internal load balancer on private addresses, and a DNS census of every host in the corpus confirms it is the only such host.
Private addressing rather than network policy is therefore the thing to check when a host is unreachable.

Run this preflight from any network to prove a specific source is reachable before a full fetch:

```bash
export SOURCE_NAME='ysm-atoz-index'
test -n "$SOURCE_NAME"

yarn scrape:development run \
  --source "$SOURCE_NAME" \
  --limit 1 \
  --dry-run \
  --output "/tmp/ylabs-reachability-preflight-${SOURCE_NAME}.json"
```

Open the artifact and stop on authentication errors, timeouts, or an unexpected zero-result response.

Do not read a burst of HTTP 403 responses as an address block.
Those responses track request rate per host rather than the network a request came from, so the remedy is the per-host pacing in `hostConcurrencyLimiter`, not a VPN.
The same decision entry records the paired run that separates rate limiting from address blocking.

Never share or store a NetID password, Duo approval mechanism, or other Yale login secret in this repository, an environment file, Render, or a scheduled job.

## Sustainable Ownership

Sources are reachable from any network, so an operator does not need a Yale identity, a VPN session, or campus wifi to run a fetch.
What remains worth owning as a team is the account and credential surface, because that is what actually breaks when an individual leaves.

Before relying on this runbook, the team must have:

- At least two trained operators, with no requirement that either be Yale-affiliated.
- A primary and backup operator assigned for each semester refresh.
- Organization-owned GitHub, Render, MongoDB Atlas, and Meilisearch administration with at least two current administrators.
- A team-owned Beta database user restricted to the `Beta` database and stored in the approved team secret manager.
- Production credentials kept out of local scraper profiles and available only to approved promotion operators.
- A shared record of the source list, expected observation ranges, artifact location, Beta backup, Production restore point, and final gate results for each refresh.

Before an operator leaves the team:

1. Transfer ownership of organization resources and confirm that two remaining administrators can access them.
2. Rotate any database, Render, Meilisearch, or other application credentials the departing operator knew.
3. Have a replacement operator complete the handoff rehearsal below using their own credentials.
4. Remove the departing operator's access after the transfer and credential rotation are verified.

The handoff rehearsal must not write to Production.
The replacement operator should:

1. Confirm their access to GitHub, Render, MongoDB Atlas, and Meilisearch.
2. Start Development infrastructure and complete the one-record reachability preflight.
3. Run a bounded Development scrape and verify the local application and local search.
4. Run the Development-to-Beta mirror dry-run, read its plan, and explain why Beta is never scraped directly.
5. Walk through the Production dry-run, restore-point, search, and smoke gates without applying the Production promotion.

Never store personal Yale credentials for a scheduled job.
Network access no longer argues against a hosted runner, because a runner off Yale network reaches the sources as well as a laptop on it does.
A hosted scraping runner still needs four things this runbook does not yet describe, so it is follow-up work rather than a step below:

- The `renderedFetch` toolchain, which shells out to `scraplingBridge.py` and needs python3, Scrapling, and a browser in the image. Five sources depend on it, including `dept-faculty-roster` and `centers-institutes-index`.
- A home for the one hand-placed input directory that `undergrad-fellowships-recipients` reads.
- MongoDB Atlas access-list entries for the runner's egress addresses, which means the runner needs stable outbound addressing.
- Development credentials only, because a hosted fetch writes to Development like every other sweep.

Until that runner exists, use a semester calendar reminder and this operator checklist rather than an unattended scraping cron.
Render automation remains appropriate for Beta and Production re-gating, Meilisearch reindexing, and read-only gates.

## The Model: Sweep Development, Promote Everything Else

Development is the only environment a scraper writes to.
Every sweep, bounded or exhaustive, runs there and materializes there, and every stored-data fix is applied and verified there.
Beta and Production never fetch anything: each receives whole-collection copies of an accepted upstream environment, then re-gates and reindexes.

Development responsibilities:

- Validate scraper and script logic with bounded runs such as `scrape:development:all:plan` and `scrape:development:all:sample`.
- Run the full or incremental exhaustive sweep that produces the release candidate, with its post-run gates.
- Hold the evidence log, because `observations` stay in Development.

Beta responsibilities:

- Receive the accepted Development dataset through `beta:refresh-from-development`, as described in Phase 2.
- Re-gate, reindex, audit, and serve the candidate for human review, as described in Phase 3.
- Serve as the accepted source for the guarded Beta to Production promotion.

Production responsibilities:

- Receive the accepted Beta dataset through `production:promote-beta-copy`, as described in Phase 4.
- Rebuild search and pass the smoke gate, as described in Phase 5.

The mirror and the promotion leave the evidence log behind, so each moves about 23,000 documents rather than 436,026.
See "Observations stay in Development" below for what that costs on the target.

A scrape against Beta or Production is refused by the CLI rather than documented as an alternative.
Two write paths into one environment overwrite each other, and a Beta that was scraped directly holds evidence that Development, the only environment anyone measures, has never seen.

## Fixed Environment Responsibilities

| Environment | MongoDB                      | Meilisearch                               | Responsibility                                                                |
| ----------- | ---------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| Development | Atlas `Development` database | Local Docker                              | Every scraper sweep, materialization, data repair, and disposable experiment |
| Beta        | Atlas `Beta` database        | Render private service with `beta` prefix | Mirrored staging candidate and human audit                                    |
| Production  | Atlas `Production` database  | Render private service with `prod` prefix | Accepted live data only                                                       |

Development data reaches Beta only through the guarded research-data mirror described below.
The mirror replaces approved research and evidence collections while preserving Beta operational collections and sanitizing copied account state.
Beta data reaches Production only through the guarded accepted-Beta promotion.

### Observations stay in Development

Every mirror leaves `observations` behind by default, in both directions and on the Beta to Production promotion.
Pass `--include-observations` to opt in; `--skip-observations` remains accepted and is now the default behavior.

The reason is storage, and it is not theoretical.
All three databases live on one Atlas cluster (`yalelabs0`), so Development, Beta, and Production share a single quota.
Development holds roughly 1.07 GB across 514,366 objects, and 412,997 of those objects are observations: about 95 percent of the volume is the evidence log rather than the product.
A mirror that carried observations would copy 436,026 documents and duplicate that footprint inside the same quota, which can exhaust the cluster and take the live site down to populate a staging environment.
Without them the same mirror copies about 23,000 documents across the reviewable corpus and the identity spine.

What the mirror does copy is the corpus a reviewer reads plus the identity that resolves it: `research_entities`, `research_entity_relationships`, `signals`, `researchers`, `role_assignments`, `accounts`, `sources`, `scrape_runs`, `departments`, `org_units`, `research_areas`, `taxonomy_terms`, and `fellowships`.
Identity is not optional in that list.
A mirrored environment holding `research_entities` without `researchers`, `role_assignments`, and `accounts` serves a corpus whose every lead is unresolvable, which fails as `missing_lead` across the whole dataset rather than in one place.
`canonical_aliases` is retired (#3027) and is listed as an excluded collection rather than dropped from the classification, because a collection still present on the source but classified neither way blocks apply.
Copying `taxonomy_terms` also carries the approved research-area vocabulary, which nothing else can currently seed into a fresh environment.

The frozen evidence claim-graph collections (`evidence_claims`, `source_documents`, `review_decisions`) are classified as excluded rather than copied: they are unwired do-not-build-on contracts, and the live evidence path is `observations` to `signals`.
Every whole-collection copy, mirror and Beta-to-Production promotion alike, carries each replaced collection's `$jsonSchema` validator onto its replacement, so a copied target keeps rejecting the writes the canonical validators reject and a Development strict flip needs no separate apply on Beta or Production.
See [the validator runbook](canonical-mongodb-validator-runbook.md) for the ordering that follows.

Two consequences follow, and both are load-bearing.

First, a target mirrored without observations must not be re-materialized.
The materializer derives fields from the observation trail, so running it against a target that has no trail replaces source-backed values with nothing.
Serve, re-gate, and reindex on such a target; run `scrape materialize` only where the observations actually live.

Second, `scrape_runs` and `signals.source.evidenceIds` arrive pointing at observation rows the target does not hold.
That is expected on a mirrored environment and is not a data-integrity finding.

`analytics_events` and `scrape_job_locks` are never copied by any mirror, in any mode.
Copied telemetry would attribute one environment's student behavior to another, and a copied lock lets a second environment's scraper believe a job is already held.

## Where Each Step Runs

| Step                                             | Execution location              | MongoDB target                            | Meilisearch target              |
| ------------------------------------------------ | ------------------------------- | ----------------------------------------- | ------------------------------- |
| Development sweep, repair, and gates             | Local machine, any network      | Atlas `Development`                       | Local Docker `researchentities` |
| Development-to-Beta mirror                       | Local approved operator machine | Atlas `Development` to Atlas `Beta`       | None                            |
| Beta re-gate, reindex, and audit                 | Beta Render shell               | Atlas `Beta`                              | `beta_researchentities`         |
| Beta-to-Production promotion                     | Local approved operator machine | Atlas `Beta` to Atlas `Production`        | None                            |
| Production re-gate, reindex, and smoke test      | Production Render shell         | Atlas `Production`                        | `prod_researchentities`         |

Finish the Development sweep and its gates before touching Beta.
Mirror to Beta once, after the whole Development candidate is accepted, and promote to Production once, after Beta is audited.
The two copies run locally and touch no Yale host, because they only connect to Atlas.
The Render shells re-gate and reindex after each copy, because the private Meilisearch services are reachable only from inside Render.

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
- Never run a scrape, sweep, or `scrape materialize` write against Beta or Production; the CLI refuses it, and the fix belongs in Development followed by promotion.
- Never copy Development into Beta outside the guarded research-data mirror.
- Never copy Development sessions, analytics, caches, locks, or experimental operational data into Beta.
- Never run the production copy without a reviewed dry-run.
- Never assume that changing MongoDB also updates a Render-private Meilisearch index.

## One-Time Local Setup

Create the two uncommitted environment profiles:

```bash
cp server/.env.example server/.env
```

Fill in the placeholders in `server/.env`.
Then create `server/.env.beta-operator` holding only a `MONGODBURL` for the Atlas `Beta` database.
The Development-to-Beta mirror reads its Beta target from that file, and `yarn profile:beta` uses it for read-only Beta audits; the profile refuses `--write`.
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
The target's own logins are never lost to the copy: every target account with login evidence (`lastLoginAt`, or an owned research plan) is carried from the pre-swap backup before verification, keeping its `_id` so the target's `research_plans` still resolve (#4130).
Where the source holds that `_id` as a `mirrored-<id>` pseudonym, which is what the opposite-direction mirror mints for the target's own login, the target row replaces the pseudonym.
Where the source also re-created that login's netid under a new `_id`, the source row is re-keyed onto the target `_id` over the pseudonym, so the netid stays unique.
Read `accountCarry` in the artifact: `restored` counts round-tripped logins, `merged` counts re-created ones, and `inserted` counts target-only ones.
A dry run reports the preview, and an apply reports the carry it actually ran after cutover.
Both mirror directions share this carry, as does `production:promote-beta-copy`.
An unclassified Beta collection blocks apply until its mirror or exclusion policy is reviewed.
Apply stages and validates every mirrored collection before cutover.
It retains the prior mirrored and non-mirror collections as temporary backups until the complete cutover passes post-sync verification, then restores the entire prior Development dataset if cutover or verification fails.
The local Development ResearchEntity Meilisearch index is rebuilt after the MongoDB sync.

This Atlas Beta-to-Atlas Development copy touches no Yale host at all.
A Development source fetch after the copy reaches Yale hosts, and needs no VPN to do so.

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

## Phase 1: Development Sweep - Run Locally

Complete the Source Reachability Preflight before running a full source.

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
  --output "/tmp/ylabs-reachability-preflight-${SOURCE_NAME}.json"
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
Then run the full Development sweep, which builds the release candidate that Phase 2 mirrors to Beta:

```bash
yarn scrape:development:all:full
```

The full command runs every source in the canonical sweep manifest with `--exhaustive`, fetches every page live without the `--use-cache` fetch cache, bypasses freshness skips for coverage measurement, and materializes each successful run into Atlas Development.
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

The incremental command runs the same sources exhaustively and live, materializes into Atlas Development, and runs the same post-run stages as the full command.
It differs by honoring WorkPlanner freshness skips instead of re-fetching every entity, so already-fresh entities are skipped and routine sweeps stay cheap.
Reserve the full sweep for periodic deep coverage refreshes where you intentionally re-fetch every eligible entity.

To refresh only the `/programs` fellowship catalog, run the fellowship engine instead of the research engine:

```bash
yarn scrape:development:fellowships:full
```

That command runs only the fellowship catalog sources and the fellowship post-run chain (the `programs:*` backfills plus the two report-only `programs:audit-*` stages), so it never touches `ResearchEntity` data.
Its one opt-in stage stays off unless you set `SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET=1` to replay the curated official-source change-set.
The fellowship catalog reaches Beta and Production through the same mirror and promotion as the research corpus.

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

Every post-run stage that ran writes one JSON artifact into the printed sweep directory, and `summary.json` records each stage's `artifactPath`, so read `summary.json` rather than a hand-kept filename list.
[research-data-pipeline.md](research-data-pipeline.md) owns which stages run and which of them are flag-gated; the artifact name each one writes is declared beside its command in `DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS` in `server/src/scripts/runScraperSweep.ts`.

Coverage is not a claim of absolute Yale ground truth.
Compare source discovery counts, eligible candidate counts, observations, materialized entities, field coverage, and quality failures with the last accepted Beta baseline.
Investigate unexpected decreases, unexpected zero-count sources, sharp changes in source yield, duplicate growth, unresolved references, unsafe contacts, and trust-contract failures before mirroring to Beta.

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

## Phase 2: Development-to-Beta Mirror - Run Locally

Run this phase only after the exhaustive Development sweep has succeeded and its data-quality review has been accepted.
It is the only way data enters Beta.
The command replaces only the approved research-discovery, identity-spine, source-audit, and base-support collections, with account state sanitized.
It preserves Beta operational collections such as sessions, analytics, admin grants, student workflows, locks, caches, and release queues.
It leaves `observations` in Development unless `--include-observations` is passed, so review the plan's `observationPolicy` line before applying.
It never writes to Meilisearch.
The mirror replaces whole documents rather than merging fields, so a mirrored row can serve a worse individual field than the row it replaced even when the mirror is newer; [research-data-pipeline.md](research-data-pipeline.md) owns the known `websiteUrl` case and the repair command for it.

Before changing Beta, record its backup or manual recovery artifact and run the Beta diagnostic from the Beta Render shell:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:readiness
```

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

## Phase 3: Beta Gate, Search, and Audit - Run in the Beta Render Shell

Run these commands from the Beta Render shell.
The Render environment must resolve MongoDB to `Beta`, Meilisearch to the private Beta service, and `MEILISEARCH_INDEX_PREFIX` to `beta`.

Verify the Beta Render environment without printing credentials:

```bash
test "$SCRAPER_ENV" = 'beta'
test "$MEILISEARCH_INDEX_PREFIX" = 'beta'
node --input-type=module --eval '
  const database = decodeURIComponent(new URL(process.env.MONGODBURL).pathname.slice(1));
  if (database !== "Beta") throw new Error(`Expected Beta MongoDB, received ${database}`);
  console.log("MongoDB target verified: Beta");
'
```

Do not run `scrape materialize` here.
The mirror left the observations in Development, so a materialize would derive fields from an empty trail, and the CLI refuses the write in any case.

Re-gate visibility first, because freshly copied rows do not carry a usable tier until a gate pass runs:

```bash
SCRAPER_ENV=beta   yarn --cwd server student-visibility:gate   --collection=all   --apply   --confirm-student-visibility-apply   --max-apply=100000
```

Run the Beta gates:

```bash
SCRAPER_ENV=beta   yarn --cwd server beta:data-quality   --strict   --include-samples   --progress   --output /tmp/ylabs-beta-data-quality.json

SCRAPER_ENV=beta   yarn --cwd server scraper:integrity-gate   --include-samples

SCRAPER_ENV=beta   yarn --cwd server launch:trust-contract   --collection=all   --mode=student-ready-only   --strict
```

Create and verify the required Beta Meilisearch restore point or export.
Then rebuild the Beta search index after the gate, never before it, because the gate writes the tiers the index carries.
Follow [the reindex runbook](meilisearch-reindex-runbook.md), which owns the command, the required variables, and how to confirm the rebuilt count:

```bash
node scripts/reindex-search-index.mjs beta
node scripts/reindex-search-index.mjs beta --apply
```

Then run the strict Beta readiness gate:

```bash
SCRAPER_ENV=beta   yarn --cwd server beta:readiness   --confirm-beta-backup   --strict   --output /tmp/ylabs-beta-readiness-final.json
```

Audit the Beta website after the gates pass.
Test broad search, known entity detail pages, access evidence, source links, and representative edge cases.

Stop before Production if any strict gate fails or the Beta UI does not match the accepted data.
A defect found on Beta is fixed in Development, verified there, and mirrored again, never patched on Beta.

## Phase 4: Beta-to-Production MongoDB Promotion - Run Locally

The current supported Production lane is an accepted Beta copy.
It is not continuous replication.
Run the promotion from a trusted operator environment with separate Beta and Production credentials.
This means the approved local operator machine, not either Render shell.
This phase touches no Yale host because it only copies Atlas data.

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
- `productionAccountCarry` accounts for every Production login: an `inserted` of 0 while Production has logged-in users is a stop.
  `docs/release-process.md` ("Promoting data, not just code") owns why the promotion carries them and how a same-netid Beta row is re-keyed.
- `includesObservations` is `false` unless the evidence log was deliberately requested with `--include-observations`.
- `includesScrapeRuns` is `false` unless `--include-scrape-runs` was passed, and leaving it off is the correct default.
  Production has never scraped anything - Development is the only environment that does - so a promoted `scrape_runs` is a copy of Development's history wearing Production's name.
  That is the fabricated audit trail #2513 filed, and it is why #2513 could not tell whether Production's crons had ever fired.
- `runEvidenceBlockersClear` is `false` when the run history would be promoted without the observations behind it.
  Opting both in does not necessarily clear it: Beta holds 0 observations, so promoting both still installs runs with no evidence and is still refused (#2589).
- Excluding `scrape_runs` stops Production accumulating more of that trail, but it does not remove the ~1,869 rows already there.
  Clearing those is a separate Production data operation and needs its own clearance.

#### Retiring Production's existing `scrape_runs`

Once that clearance is given, `--retire-scrape-runs=<operator-netid>` clears the collection as part of the promotion rather than through a separate destructive script.

The flag carries the operator netid as its value, because it deletes a Production collection and the audit marker it writes has to name someone.
It routes through the same staged swap as the copy: the collection is renamed to a backup during the cutover and dropped only after verification passes, so a failed promotion restores it.

It refuses in three cases:

- the netid is not a valid netid
- `--include-scrape-runs` is also passed, which would replace and clear the same collection
- Production holds any observations, because then those runs are the provenance for real evidence and clearing them would orphan it

Read `retiresProductionScrapeRuns` and `retireScrapeRunsBlockersClear` in the dry-run before applying.

After a successful retirement Production reads 0 runs and 0 observations, which is the honest state but is indistinguishable from never having scraped.
So the run writes an append-only `admin_audit_events` row with action `promotion.retire_production_scrape_runs`, recording the operator, the row count retired, the dataset version, and why.
That collection is not in the promotion manifest, so a later promotion does not overwrite the marker.
Check it before concluding from an empty `scrape_runs` that Production never ran anything: that ambiguity read from the other direction is what made #2513 hard to diagnose.

- Every source copy count is expected.

The promotion no longer requires an operator-supplied restore point, and no longer accepts one.
`ATLAS_RESTORE_POINT` was the script's only rollback story and it was unverifiable: any non-empty string satisfied the check, so it recorded an operator's intention rather than a recoverable state (#2347).

The rollback is now in the script.
`promoteAcceptedBetaCopy` stages every collection under `__prod_promote_staging_*`, renames the live collections to `__prod_promote_backup_*`, swaps staging into place, carries Production's logged-in accounts out of the `accounts` backup, verifies that each promoted collection holds the row count Beta offered plus those carried accounts, and only then drops the backups.
Any failure before that verification passes rolls every collection back to its pre-run state, which is asserted against a real mongod rather than a mocked driver.

An Atlas restore point is still worth having as defence against something outside this script, and Atlas Free provides no managed backups, so record one if your tier supports it.
It is no longer a gate the command enforces.

Two things the dry-run does not tell you, both of which reject an apply:

- `--dataset-version` is matched against a strict literal, `/^prod-promote-\d{4}-\d{2}-\d{2}-lane-a-beta-copy$/`.
  A descriptive name such as `prod-promote-2026-09-12-facet-and-url-repair` is refused, and the error names the required shape rather than what was wrong with yours.
- Apply also requires `CONFIRM_LANE_A_COPY=true` and `CONFIRM_PROD_SCRAPE=true` in the environment.
  The dry-run succeeds without them and does not mention them.

Apply only after the dry-run is accepted:

```bash
CONFIRM_LANE_A_COPY=true \
CONFIRM_PROD_SCRAPE=true \
  yarn --cwd server production:promote-beta-copy \
  --apply \
  --output /tmp/ylabs-production-promotion-apply.json
```

Stop if the command does not print `"status": "applied"` or if any post-copy count differs from the Beta source copy count, `accounts` excepted: it is expected to exceed Beta's count by the accounts carried from Production.

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

Re-gate visibility and then rebuild the Production search index from the newly promoted Production MongoDB, in that order.
`docs/release-process.md` ("Promoting data, not just code") owns the gate command and why the order matters, and [the reindex runbook](meilisearch-reindex-runbook.md) owns the reindex command:

```bash
node scripts/reindex-search-index.mjs production
node scripts/reindex-search-index.mjs production --apply
```

Confirm that the reindex reports the expected indexed count.
Run the Production smoke from the same Render shell:

```bash
yarn security:smoke:production
```

Do not declare the refresh complete until MongoDB promotion, the Meilisearch rebuild, and Production smoke all pass.

## Completion Record

Save the following references in the shared semester refresh record:

- The Development sweep output directory and its `summary.json`.
- The Development-to-Beta mirror plan and result artifacts.
- The Beta visibility-gate, data-quality, integrity, trust-contract, Meilisearch, and readiness artifacts.
- The Production promotion dataset version and plan.
- The Production Meilisearch restore point and reindex output.
- The Production smoke results.
- The operator name, reviewer name, date, and any accepted exceptions.

The refresh is incomplete if any required artifact, restore point, or independent reviewer is missing.

## Fast Decision Table

| Situation                                    | Action                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Need more data for debugging                 | Run a larger Development scrape locally                                             |
| Development looks correct                    | Mirror it to Beta with `beta:refresh-from-development`                              |
| Beta shows a data defect                     | Fix it in Development, verify there, and mirror again                               |
| Beta search is stale                         | Re-gate, then reindex Beta from the Beta Render shell                               |
| Beta gates fail                              | Stop, fix in Development, and mirror again                                          |
| Production Mongo succeeded but search failed | Keep the Mongo result, reindex Production, and do not claim completion              |

## Recovery

Local Development is disposable and can be reset from the accepted Beta snapshot or a new scrape.
Beta recovery uses the recorded Beta backup or a fresh mirror from an accepted Development dataset.
Production recovery restores the recorded pre-promotion Atlas restore point and then rebuilds Meilisearch.
Never use a Development database copy as a Production rollback.
