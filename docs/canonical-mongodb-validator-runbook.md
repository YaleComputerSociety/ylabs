# Canonical MongoDB Validator Runbook

This runbook covers the guarded operator workflow for canonical MongoDB collection validators.
The command defaults to a read-only dry run and applies only the reviewed plan for the connected database state.

## Scope and operating rules

Run this command locally from the repository root.
Do not add it to Render, application startup, scraper execution, scheduled jobs, or deployment hooks.
It uses the native MongoDB client and the `MONGODBURL` loaded from `server/.env`.
Before every run, verify that `MONGODBURL` names the intended database and does not contain a different environment's target.

The required `--environment` value must match both the configured database name and the database name reported after connection.
The primary environment mapping is `development` to `Development`, `beta` to `Beta`, and `production` to `Production`.
The command also accepts `production-copy` for `ProductionCopy` and `test` for an explicit test database.
It fails closed on a missing environment, a target mismatch, an invalid reviewed artifact, or database drift.

The desired registry is limited to the canonical collections explicitly declared in [`canonicalMongoValidatorRegistry.ts`](../server/src/scripts/canonicalMongoValidatorRegistry.ts).
Collections outside that registry are read only as part of MongoDB collection discovery and are never planned for modification.
During migration, desired validators default to `validationLevel: moderate` and `validationAction: error`.
This protects new and modified conforming writes without claiming that legacy documents have been backfilled or that references are valid.

## Per-collection strict flips

`moderate` grandfathers any pre-existing document that does not match its collection's `$jsonSchema` until that document is next written.
`strict` removes the grandfathering, so every future update to any document in the collection must conform immediately.
A collection may set `validationLevel: 'strict'` (still `validationAction: 'error'`) in its registry contract only after its own audit comes back clean.
Flip collections one at a time; never change the shared `CANONICAL_VALIDATION_LEVEL` default, because that would flip every collection at once.

Two read-only audits gate a safe flip and must both be clean for the target collection:

```bash
yarn --cwd server model-refactor:strict-readiness --environment development \
  --output /tmp/ylabs-strict-readiness-development.json
yarn --cwd server model-refactor:reference-integrity --environment development --include-samples \
  --output /tmp/ylabs-canonical-reference-integrity-development.json
```

`model-refactor:strict-readiness` counts documents that already fail the desired `$jsonSchema`; a collection with `nonConformingCount: 0` is `strictReady`.
`model-refactor:reference-integrity` counts dangling and missing-required references on the canonical relationship edges; a dangling ObjectId is bson-valid and therefore invisible to the readiness audit, so both audits are required.
`model-refactor:legacy-writer-scan` is the companion dual-write verification that no runtime code path still writes retired legacy storage.
After a clean readiness result, set `validationLevel: 'strict'` for that collection in the registry, review the fingerprint change, then apply through the standard dry-run and apply flow below.
Carrying a verified-clean Development flip forward to Beta or Production is a separate live-database change on those environments and requires its own review.

## Required review and recovery

Before any apply:

1. Create a recoverable database export, current Atlas backup, or verified point-in-time restore point for the exact target database.
2. Record the recovery artifact identifier, restore owner, and restore procedure in the change record.
3. Generate a fresh dry-run artifact against the target database.
4. Review the artifact's `environment`, `databaseName`, credential-free `target`, `desiredCollections`, `summary`, `plan`, `rollbackPlan`, and `planFingerprint`.
5. Confirm that every `createCollection` and `collMod` command is expected.
6. Preserve the reviewed dry-run artifact unchanged and use a different path for the apply report.

The fingerprint binds the reviewed environment, database, credential-free target, desired collection registry, current collection options, forward plan, and rollback plan.
Apply reconnects, reads the current database state, recomputes the fixed-registry commands, and refuses to write if the reviewed artifact was changed or the database state drifted.
The command never executes command objects supplied by the artifact.

## Development

Point `server/.env` at the `Development` database, then generate and review the dry-run artifact:

```bash
yarn model-refactor:validators \
  --environment development \
  --output /tmp/ylabs-canonical-validators-development-dry-run.json
```

After the recovery and review steps are complete, apply the exact reviewed state:

```bash
yarn model-refactor:validators \
  --environment development \
  --apply \
  --apply-from /tmp/ylabs-canonical-validators-development-dry-run.json \
  --confirm-canonical-validator-apply development \
  --output /tmp/ylabs-canonical-validators-development-apply.json
```

Review `postApplyPlan` in the apply report.
Every item must be a `noop`.
Run a new dry run and confirm that `summary.writesPlanned` is `0` before continuing to Beta.

## Beta

Point `server/.env` at the `Beta` database.
Create or verify the Beta recovery artifact, then generate and review a new Beta-specific artifact:

```bash
yarn model-refactor:validators \
  --environment beta \
  --output /tmp/ylabs-canonical-validators-beta-dry-run.json
```

Apply only that reviewed Beta artifact:

```bash
yarn model-refactor:validators \
  --environment beta \
  --apply \
  --apply-from /tmp/ylabs-canonical-validators-beta-dry-run.json \
  --confirm-canonical-validator-apply beta \
  --output /tmp/ylabs-canonical-validators-beta-apply.json
```

Review the apply report and rerun the Beta dry run.
Do not proceed until the second dry run reports `summary.writesPlanned` as `0` and Beta application behavior remains healthy.

## Production

Point `server/.env` at the `Production` database.
Create and record a fresh Production export, Atlas backup, or point-in-time restore point before generating the final plan.
Generate and review a new Production-specific artifact:

```bash
yarn model-refactor:validators \
  --environment production \
  --output /tmp/ylabs-canonical-validators-production-dry-run.json
```

Production apply requires the reviewed artifact, an environment-bound confirmation, and the separate production environment gate:

```bash
CONFIRM_PROD_MONGO_VALIDATORS=true \
yarn model-refactor:validators \
  --environment production \
  --apply \
  --apply-from /tmp/ylabs-canonical-validators-production-dry-run.json \
  --confirm-canonical-validator-apply production \
  --output /tmp/ylabs-canonical-validators-production-apply.json
```

Set `CONFIRM_PROD_MONGO_VALIDATORS=true` only for the apply process.
Do not leave the production gate enabled in a shared development environment.
Review `postApplyPlan`, then run a fresh Production dry run and require `summary.writesPlanned` to be `0`.

## Apply behavior and failure recovery

MongoDB collection commands are applied sequentially in deterministic collection-name order.
The multi-command apply is not transactional.
The runner stops at the first failed command and reports the successfully applied collection names, the failed collection, and the unattempted collections.

If apply stops partway:

1. Do not rerun the stale apply command.
2. Preserve the reviewed artifact and terminal output as the partial-apply record.
3. Inspect the named successful and failed collections in MongoDB.
4. Decide whether to roll back the successful commands or continue from the new state.
5. Generate a fresh dry-run artifact against the current database state.
6. Review the new plan before any retry.

A retry is safe only through a fresh dry run because already-current collections become `noop` and remaining drift produces a new bounded plan.

## Manual rollback

Every dry-run artifact contains a `rollbackPlan` built from the collection options observed before apply.
The operator command does not execute rollback automatically.
Inspect the rollback commands with:

```bash
jq '.rollbackPlan' /tmp/ylabs-canonical-validators-beta-dry-run.json
```

For a rejected complete apply, execute the matching `rollbackPlan[].command` entries manually with `db.runCommand(...)` against the exact database, preferably in reverse apply order.
For a partial apply, execute rollback commands only for collections confirmed in the runner's successfully applied list.
Record every command and result in the change record, then generate a fresh dry run to verify the resulting state.

A rollback entry for an existing collection restores its previously observed validator, validation level, and validation action.
A rollback entry for a collection created by the apply only disables its validator with `collMod`.
The workflow never automatically drops a created collection because it cannot prove that no later writer added data.
If a created collection must be removed, stop writers, inspect its contents, and use the recorded recovery procedure or a separately reviewed manual cleanup.

Use the recorded database export, Atlas backup, or point-in-time restore when validator rollback commands cannot safely recover a broad or uncertain failure.
