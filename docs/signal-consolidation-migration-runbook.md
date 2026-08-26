# Signal Consolidation Migration Runbook

Status: canonical operator runbook

Last updated: 2026-08-19

## Purpose

Use this runbook to migrate legacy access data into the unified `Signal` model and to retire the removed pathway, contact, and opportunity collections.
It covers the human-gated data operations that finish the code cutover shipped in #374 (Signal consolidation) and #377 (EntryPathway, ContactRoute, and PostedOpportunity removal).
The application code already reads and writes only the `signals` collection; this runbook moves the data and then drops the legacy collections.

This runbook does not fetch or scrape data.
It only reshapes and removes existing MongoDB documents, so a recoverable backup or restore point is mandatory before any apply step.

## Scope and ordering

Run the migration per environment in this order, mirroring the [data refresh runbook](./data-refresh-runbook.md): Development first, then Beta, then Production.
Production is a separate live database; never point an apply step at Production without an explicit, reviewed decision and a fresh restore point.
Each environment is driven by its own `MONGODBURL` and `SCRAPER_ENV`.

The legacy collections in scope are `access_signals`, `undergraduate_logistics_claims`, `entry_pathways`, `contact_routes`, and `posted_opportunities`.
The `signals` collection is the single canonical target.

## Preconditions

The #374 and #377 code must already be deployed to the target environment, so live writes go to `signals` and no code reads the legacy collections.
A backup or restore point for the target database must exist and be verified before any apply step.
The operator must target exactly one environment per invocation and confirm the `MONGODBURL` host and database name before running.

## Step 1: dry-run the data copy

The migration is dry-run by default and writes a bounded JSON report under the system temp directory or `./tmp`.
It copies every `access_signals` and `undergraduate_logistics_claims` document into `signals` using the same document `_id`, so existing review references stay valid, and it is idempotent on re-run.

```bash
MONGODBURL="<target-db-url>" \
  yarn --cwd server migrate:signal-consolidation --dry-run --output /tmp/signal-migration-dry-run.json
```

Read the report and confirm the mapped and skipped counts are what you expect.
`accessSignalsSkipped` and `logisticsClaimsSkipped` count documents whose `signalType`/`claimType` is not a recognized type; investigate any non-zero skip before applying.
`signalsToWrite` should equal `accessSignalsMapped + logisticsClaimsMapped`.

## Step 2: apply the data copy

Applying requires both the non-production write guard and the explicit consolidation confirmation.
The guard refuses a Production target unless the operator has followed the standard production-write path for this repository.

```bash
SCRAPER_ENV=beta MONGODBURL="<target-db-url>" \
  yarn --cwd server migrate:signal-consolidation --apply --confirm-signal-consolidation --output /tmp/signal-migration-apply.json
```

Re-running apply is safe: the upsert keys on `_id`, so already-migrated documents are updated in place rather than duplicated.

## Step 3: verify parity

Confirm the target `signals` count accounts for every mapped legacy document before removing anything.

```bash
# In a mongosh session against the target database:
db.signals.countDocuments({})
db.access_signals.countDocuments({})
db.undergraduate_logistics_claims.countDocuments({})
```

`signals` should contain at least the sum of the two legacy collections' mapped documents, plus any rows written live since the dry-run.
Spot-check a few migrated documents: access rows carry `type`, `confidence`, `confidenceScore`, and nested `source`; logistics rows carry `type`, `status`, `value`, `expiresAt`, and `derivationKey` of the form `logistics:<type>`.
Confirm the student research-detail page and admin access review render correctly against the migrated data.

## Step 4: handle stranded saved-pathway account data

The favPathways feature was removed, but the `favPathways` field on `users` was intentionally left in place so no account data is destroyed by the code cutover.
The `savedPathwayPlans` declaration was later dropped from the User schema; clearing its stale stored values is owned by the Dev-only `retire:stale-saved-plan-fields` script, not this runbook.
Decide per environment whether to drop `favPathways` or backfill it into saved research entities before dropping the `entry_pathways` collection.
Dropping the field is the default when no product decision requires preserving legacy saved pathways.

```bash
# Optional, reviewed field cleanup in a mongosh session:
db.users.updateMany(
  { favPathways: { $exists: true } },
  { $unset: { favPathways: '' } },
)
```

## Step 5: drop the legacy collections (final, human-gated)

Only after parity is verified and a restore point exists, drop the legacy collections.
This is destructive and irreversible without the backup.
Do not drop any collection while code that reads it is still deployed; #374 and #377 removed those readers, so confirm the deployed build predates nothing that still references them.

```bash
# In a mongosh session against the target database, after parity + backup are confirmed:
db.access_signals.drop()
db.undergraduate_logistics_claims.drop()
db.entry_pathways.drop()
db.contact_routes.drop()
db.posted_opportunities.drop()
```

## Rollback

If verification fails before Step 5, no destructive action has occurred: the legacy collections are intact and `signals` can be re-derived by re-running Step 2 or by the live materializer.
If a drop in Step 5 was premature, restore the affected collections from the backup or restore point captured in the preconditions.
The `signals` documents share `_id` with their legacy sources, so a restored legacy collection and the migrated `signals` remain consistent.

## Related

- Migration script: [`server/src/scripts/signalConsolidationMigration.ts`](../server/src/scripts/signalConsolidationMigration.ts) and its pure core [`signalConsolidationMigrationCore.ts`](../server/src/scripts/signalConsolidationMigrationCore.ts).
- Target model: [`research-model-refactor.md`](./research-model-refactor.md).
- Environment targeting and promotion: [`data-refresh-runbook.md`](./data-refresh-runbook.md).
