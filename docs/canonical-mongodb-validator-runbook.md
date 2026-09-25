# Canonical MongoDB Validator Runbook

This runbook covers the guarded operator workflow for canonical MongoDB collection validators.
The command defaults to a read-only dry run and applies only the reviewed plan for the connected database state.

## Current state: declared, not applied

No environment carries any of these validators.
Measured on Development on 2026-09-25: of 27 collections, zero store a `$jsonSchema`, and `model-refactor:validators-assert` reports all six declared collections as `validator-absent`.

That is a decision rather than a backlog item.
#752 was closed as declined on the measurement that zero of 33,051 documents across the six collections fail their own declared schema, so applying the validators would refuse nothing today, while `strict`/`error` would turn a future malformed bulk write into a mid-sweep hard failure.
The declaration stays reviewed and pre-flighted so the path remains available.

Read the consequence carefully, because the gating around this registry is easy to over-read.
`canonicalMongoValidatorRegistry.test.ts` fails on any drift in the declared contracts and demands a written review, and that gate governs the declaration in the repository only.
A green suite is not evidence that a collection is validated, and no storage-level rule proposed against one of these collections can fire.
`CANONICAL_MONGO_VALIDATOR_ENFORCEMENT` in the registry records the decision, the registry test asserts its value, and `model-refactor:strict-readiness` prints it beside what the connected database actually carries, so applying the validators means restating the decision rather than silently changing what a green run means.

## Scope and operating rules

Run this command locally from the repository root.
Do not add it to Render, application startup, scraper execution, scheduled jobs, or deployment hooks.
It uses the native MongoDB client and the `MONGODBURL` loaded from `server/.env`.
Before every run, verify that `MONGODBURL` names the intended database and does not contain a different environment's target.

The required `--environment` value must match both the configured database name and the database name reported after connection.
The primary environment mapping is `development` to `Development`, `beta` to `Beta`, and `production` to `Prod` (the deployed production database name; `Production` is also accepted).
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
It leads with `declaredVersusApplied`, whose `statement` says in words how many declared validators the connected database carries, because every readiness number after it describes an apply that has not happened.
A row reading `appliedState: "no-validator-applied"` with `currentValidationLevel: "not-applied"` is the plain form of that; it replaced a `currentValidationLevel: "unknown"` that a reader had to decode.
`model-refactor:reference-integrity` counts dangling and missing-required references on the canonical relationship edges; a dangling ObjectId is bson-valid and therefore invisible to the readiness audit, so both audits are required.
`model-refactor:legacy-writer-scan` is the companion dual-write verification that no runtime code path still writes retired legacy storage.
After a clean readiness result, set `validationLevel: 'strict'` for that collection in the registry, review the fingerprint change, then apply through the standard dry-run and apply flow below.
Apply the flip to Development only.
Beta and Production then receive it through the ordinary whole-collection copies, as the next section describes.

## A whole-collection copy carries the validator with it

A validator is collection metadata, and `rename` carries no collection options, so a staged swap replaces its target's validator with whatever its staging collection was created with.
Both copy paths therefore create staging through the shared `mirroredValidationOptions` in [`stagedCollectionSwap.ts`](../server/src/scripts/stagedCollectionSwap.ts): the source database's validation options win, and the target's own options are the fallback so a copy never downgrades a validated collection to unvalidated.

That makes a Development flip reach the other environments by construction rather than by a separate apply.
`beta:refresh-from-development` carries it from Development onto Beta, and `production:promote-beta-copy` carries it from Beta onto Production, for the five canonical collections on the promotion manifest (`accounts`, `researchers`, `role_assignments`, `org_units`, `taxonomy_terms`; only `research_plans` is not promoted).
Until #754 this was true of the sync path alone, and every promotion silently left those five Production collections unvalidated no matter what had been applied to Production beforehand.

One consequence is load-bearing.
A copy now writes source documents into a validated staging collection, so a source document the canonical `$jsonSchema` rejects fails the copy and rolls the whole cutover back with the target untouched.
That is the intended fail-closed behavior, and `model-refactor:strict-readiness` against the source environment is the pre-flight that tells you before the copy does.

A direct apply against Beta or Production remains a live-database change on those environments that needs its own review, and is now needed only to fix a collection a copy cannot reach.

## Required MongoDB grant

`collMod` is the one privilege this workflow cannot work around, and the application credentials in `server/.env` do not carry it.
Measured on 2026-09-23 against Development, the configured user holds `readWriteAnyDatabase@admin` only: 25 granted actions including `createCollection` but **not** `collMod`.
Every planned `collMod` is therefore refused with `user is not allowed to do action [collMod] on [<Database>.<collection>]`, and no canonical validator can be applied by anyone but a user the repository owner grants.

Confirm the gap before blaming the plan:

```bash
yarn --cwd server model-refactor:validators --environment development \
  --output /tmp/ylabs-canonical-validators-development-dry-run.json
jq '.summary' /tmp/ylabs-canonical-validators-development-dry-run.json
```

A non-zero `writesPlanned` with an apply that fails on the first collection is the privilege gap, not drift in the registry.

The owner makes the grant once, on the Atlas project that hosts the target database.
`collMod` is not part of any built-in Atlas role, so it needs a custom role.
In the Atlas UI: **Database Access -> Custom Roles -> Add New Custom Role**, name it `canonicalValidatorAdmin`, inherit `readWriteAnyDatabase@admin`, and add the `collMod` action, then assign that role to the operator's database user.
The equivalent through the Atlas Admin API or a `mongosh` session with `userAdmin` on `admin` is:

```javascript
db.getSiblingDB('admin').createRole({
  role: 'canonicalValidatorAdmin',
  privileges: [{ resource: { db: 'Development', collection: '' }, actions: ['collMod'] }],
  roles: [{ role: 'readWriteAnyDatabase', db: 'admin' }],
});

db.getSiblingDB('admin').grantRolesToUser('<operator-database-user>', [
  { role: 'canonicalValidatorAdmin', db: 'admin' },
]);
```

Scope the `resource.db` to the one database being changed, grant it for the apply, and revoke it afterwards:

```javascript
db.getSiblingDB('admin').revokeRolesFromUser('<operator-database-user>', [
  { role: 'canonicalValidatorAdmin', db: 'admin' },
]);
```

Do not widen the shared application credential.
`collMod` on a student-facing database is a schema-level privilege that the running server never needs.

## Detecting drift without a hand-run

A declaration is not presence.
Two recorded traps make this the rule rather than a caution: a whole-collection copy carries no collection options, so a promotion can strip a `$jsonSchema` from a canonical collection that the registry still declares; and a declared unique index whose `sparse` and `partialFilterExpression` combination MongoDB rejects is never created at all.
Neither shows up in a code review of the declaration, so assert against the database:

```bash
yarn --cwd server model-refactor:validators-assert --environment development
```

This is read-only and refuses to combine with `--apply`.
It exits non-zero when any declared validator is not present as declared, and it separates three states so the report distinguishes a stripped validator from ordinary drift:

- `validator-absent`: the collection exists and stores no `$jsonSchema` at all. This is the promotion-stripping and never-applied signature, and it is the state every declared collection is in today, so on a database that never had an apply this command exits non-zero by design. The finding to act on is a collection that carried a validator and no longer does.
- `validator-drifted`: a `$jsonSchema` is stored but does not match the declaration, or its level or action differs.
- `collection-missing`: the collection does not exist yet.

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

Read the copy section above first: `beta:refresh-from-development` already carries Development's validators onto Beta, so a Beta apply is needed only for a collection no refresh reaches.

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

Read the copy section above first: `production:promote-beta-copy` carries Beta's validators onto the five canonical collections on its manifest, so a Production apply is needed only for a collection the promotion does not copy.

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
The runner stops at the first failed command and reports the successfully applied collection names, the failed collection, the unattempted collections, and the collections it can prove were refused.

A missing `collMod` grant is a database-wide privilege gap rather than a per-collection one, so the runner reports every remaining planned `collMod` as refused rather than merely unattempted, and names the grant.
Any other rejection stays scoped to the single collection that failed.

Every run records its outcome at `--output`, failures included.
A failed run writes a report with `"mode": "failed"` carrying the refusal, and with no `applied` or `postApplyPlan` field, so a stale success artifact from an earlier run can never be reviewed as this run's result.
That artifact is not a reviewed plan and `--apply-from` rejects it.
#752 was closed as completed while its apply had been refused, because a failed apply used to write nothing at all.

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
