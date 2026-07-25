# Research Model Refactor - Phase 0 Runbook

Status: tooling in place, production measurement pending.

Phase 0 of [`research-model-refactor.md`](./research-model-refactor.md) resolves integration state and measures production before any target collection is written or any legacy storage is dropped.
This runbook covers the inventory tool, how to read its output, and the export and rollback steps that must exist before later phases run destructive cleanup.

## Inventory tool

The inventory is read-only.
It writes nothing to MongoDB.

```bash
# Print the report to stdout
yarn --cwd server model-refactor:inventory

# Also write a JSON report (guarded to a tmp root)
yarn --cwd server model-refactor:inventory --output /tmp/model-inventory.json

# Keep more orphan sample ids per reference edge (default 20)
yarn --cwd server model-refactor:inventory --sample-limit 100
```

The tool connects with the standard `MONGODBURL` from `server/.env`, so point it at the environment you want to measure.
Run it against beta first, then against a production copy once access and rollback artifacts are in place.

Implementation:

- [`server/src/scripts/researchModelInventory.ts`](../server/src/scripts/researchModelInventory.ts) gathers the facts from MongoDB.
- [`server/src/scripts/researchModelInventoryCore.ts`](../server/src/scripts/researchModelInventoryCore.ts) holds the collection spec, field probes, reference edges, and report shaping, and is unit tested without a database.

## What the report contains

### `summary`

Headline counts for a quick read:

- `collectionsPresent` out of `collectionsClassified`.
- `legacyResidueCollections`: expected-gone collections that still hold documents, such as `research_groups` or `applications`.
- `unclassifiedCollections`: live collections the refactor spec does not yet name.
Investigate each one before trusting a cutover.
- `retirementFieldsStillPresent`: how many legacy fields still appear on live documents.
- `referenceEdgesWithOrphans` and `totalOrphans`: reference-integrity health.

### `collections`

One row per refactor-relevant collection with its group, owning migration phase, target mapping, document count, and `schemaVersion` distribution.
The `schemaVersions` bucket labels documents with no `schemaVersion` as `unset`, which is expected before Phase 1 versioning lands.

### `retirementFields`

Prevalence of each legacy field slated for removal, for example `research_entities.acceptingUndergrads` or `users.publications`.
A field at zero prevalence is safe to drop once no reader references it.
A field with high prevalence gates its retirement phase until the canonical replacement is materialized.

### `referenceIntegrity`

Orphan counts for the access and membership graph, for example membership rows whose `researchEntityId` does not resolve to a research entity.
The check is type-agnostic, so it stays correct whether references are stored as ObjectId or string.
Any edge with `clean: false` must be resolved or explained before the referenced collection is migrated.

## Complementary audits

The inventory is a census.
Deeper collision and identity analysis already lives in dedicated scripts and should be run alongside it:

- `yarn --cwd server users:dedupe-by-identity` for same-person user shells.
- `yarn --cwd server research-entity-members:audit-user-refs` for membership reference integrity.
- `yarn --cwd server research-entity:duplicate-name-review` for duplicate entity identities.
- `yarn --cwd server research-entity:coverage-audit` for entity evidence coverage.

## Export and rollback prerequisites

No later phase may drop or overwrite a collection until these exist and are verified:

1. A recoverable export or Atlas point-in-time restore instruction for the target environment, captured immediately before the destructive step.
2. Recorded source and target document counts, so parity can be proven after a cutover.
3. A written rollback plan naming the exact collections touched and the restore command for each.

Record the inventory JSON alongside the export so the pre-change state is auditable.

## Exit condition

Phase 0 exits on a reviewed inventory, an ownership map of which phase owns each collection and field, and a rollback plan.
The collection spec in `researchModelInventoryCore.ts` is the machine-readable form of that ownership map, and should be extended whenever the report surfaces an unclassified collection.
