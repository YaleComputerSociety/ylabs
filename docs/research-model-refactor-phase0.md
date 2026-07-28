# Research Model Refactor - Phase 0 Runbook

Status: tooling in place, production measurement pending.

Phase 0 of [`research-model-refactor.md`](./research-model-refactor.md) resolves integration state and measures production before any target collection is written or any legacy storage is dropped.
This runbook covers the inventory tool, how to read its output, and the export and rollback steps that must exist before later phases run destructive cleanup.
The tooling PR does not complete Phase 0: reviewed Beta and production-copy inventory evidence, plus verified rollback evidence, remain operational exit work.

## Inventory tool

The inventory is read-only.
It writes nothing to MongoDB.

```bash
# Print the report to stdout
yarn --cwd server model-refactor:inventory --environment beta

# Also write a JSON report under an allowed tmp root
yarn --cwd server model-refactor:inventory --environment beta --output /tmp/model-inventory.json

# Keep more orphan sample ids per reference edge (default 20)
yarn --cwd server model-refactor:inventory --environment beta --sample-limit 100
```

The tool uses a dedicated native MongoDB client with the standard `MONGODBURL` from `server/.env`, so point it at the environment you want to measure.
It does not load Mongoose models, create collections, build indexes, or open the migration database configured by `MONGODBURL_MIGRATION`.
The client is closed after success or failure.
Collection scans are capped at four concurrent groups.
Retirement-field probes reuse the collection census totals and count all tracked fields in one aggregation per collection.
Reference checks scan all tracked fields from each source collection once and resolve references in batches of 1,000 source documents.
Client memory remains bounded by the scan concurrency, batch size, tracked edges, and configured orphan sample limit rather than collection cardinality.
The required `--environment` accepts `development`, `beta`, `production-copy`, `production`, or `test`.
The runner fails before connecting unless the database named in `MONGODBURL` matches the declared environment, and it validates the database name resolved by MongoDB again after connecting.
The deployed database names are `Development`, `Beta`, `ProductionCopy`, and `Production`; explicit test fixtures may use `Test` or a database name ending in `-test` or `_test`.
Run it against beta first, then against a production copy once access and rollback artifacts are in place.
Errors go to stderr, so stdout contains only the JSON report.
The optional output path must end in `.json`, must resolve under the operating-system temp directory or `./tmp` from the runner's working directory, and must have an existing parent directory.

Run the inventory against a restored, immutable copy whenever possible.
If an immutable copy is unavailable, use a declared low-write or quiescent window and prevent migration or scraper writes for the duration of the export and inventory.
Record the JSON report alongside the export from the same window so its collection counts, schema-version buckets, and reference checks describe a meaningful point in time.
The runner intentionally does not add transaction or snapshot read-concern behavior.

Implementation:

- [`server/src/scripts/researchModelInventory.ts`](../server/src/scripts/researchModelInventory.ts) gathers the facts from MongoDB.
- [`server/src/scripts/researchModelInventoryCore.ts`](../server/src/scripts/researchModelInventoryCore.ts) holds the collection spec, field probes, reference edges, and report shaping, and is unit tested without a database.

## What the report contains

### `summary`

Headline counts for a quick read:

- `collectionsPresent` out of `collectionsClassified`.
- `totalDocuments`: the sum of document counts across classified collections.
- `legacyResidueCollections`: expected-gone collections that still hold documents, such as `research_groups` or `applications`.
- `unclassifiedCollections`: live collections the refactor spec does not yet name.
  Investigate each one before trusting a cutover.
- `retirementFieldsStillPresent`: how many legacy fields still appear on live documents.
- `referenceEdgesChecked` and `referenceEdgesSkipped`: how many reference edges were measurable and how many had no source collection to inspect.
- `referenceEdgesWithOrphans` and `totalOrphans`: reference-integrity health.
- `coverageScope`: the explicit boundary for interpreting the headline counts.

The collection, retirement-field, and scalar reference-edge sets are curated for this refactor and are not an exhaustive database-integrity proof.
In particular, `totalOrphans: 0` means no orphans were found among the tracked edges, not that every reference in the database is valid.

### `collections`

One row per refactor-relevant collection with its group, owning migration phase, target mapping, document count, and `schemaVersion` distribution.
The `present` flag distinguishes a missing collection from an empty one, while `residue` is true only when an expected-gone collection still contains documents.
Each `schemaVersions` bucket records `bsonType`, `value` when present, and `count`.
The `missing` BSON type distinguishes documents without `schemaVersion` from documents whose value is explicitly `null`, and numeric and string values remain separate.

#### Collection classification

The collection spec in `researchModelInventoryCore.ts` is the authoritative map of each collection to its current runtime owner, classification group, owning cutover phase, and target or retirement posture.
It includes every collection surfaced by the Development census and the empty canonical storage contracts introduced in Phase 1.
Counts remain environment-specific evidence and do not belong in source or this runbook.

Interpret operational queues and leases as environment-local state rather than canonical domain data.
Treat regenerable caches and independently retained analytics according to their recorded posture rather than as canonical research evidence.
Interpret expected-gone collections as residue even when an environment still contains documents.
Schema introduction does not make an empty canonical collection a completed migration.
The inventory preserves the durable `research_entity_relationships` and `student_engagement_events` names instead of inventing parallel storage.

### `retirementFields`

Prevalence of each legacy field slated for removal, for example `research_entities.acceptingUndergrads` or `users.publications`.
A field at zero prevalence is safe to drop once no reader references it.
A field with high prevalence gates its retirement phase until the canonical replacement is materialized.

### `referenceIntegrity`

Orphan counts for the access, membership, and private student-record graph, for example membership rows whose `researchEntityId` does not resolve to a research entity.
The check is type-agnostic, so it stays correct whether references are stored as ObjectId or string.
Each row has a `status`: `checked`, `target-missing`, `source-missing`, or `not-gathered`.
Each row also records the local field and whether the current Mongoose schema requires it.
A missing source is skipped with `clean: null`.
A present source with a missing target is scanned, and every non-null reference is reported as orphaned with `clean: false`.
If that scan finds no references, the row remains explicitly `target-missing` with `clean: null` instead of becoming a cutover blocker.
For a required edge, a source document with a missing or null local reference is also reported as orphaned.
For an optional edge, a missing or null local reference is skipped.
The `checked`, `orphaned`, and `orphanRate` fields quantify each edge, and `sampleOrphanIds` contains bounded source-document IDs for investigation.
Any edge with `clean: false` must be resolved or explained before the referenced collection is migrated.

The top-level `generatedAt` records report creation time, while `options` preserves the parsed CLI settings.
The top-level `environment` is the required label verified against the configured and connected database names.
The `db` field records the connected database name, and `target` records a credential-free host/database label derived from `MONGODBURL`.
Review all three before preserving an inventory as migration evidence.

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
