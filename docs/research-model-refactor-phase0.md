# Research Model Refactor - Phase 0 Runbook

Status: tooling in place, production measurement pending.

Phase 0 of [`research-model-refactor.md`](./research-model-refactor.md) resolves integration state and measures production before any target collection is written or any legacy storage is dropped.
This runbook covers the inventory, search-baseline, and MongoDB query-cost tools, how to read their output, and the export and rollback steps that must exist before later phases run destructive cleanup.
The tooling PR does not complete Phase 0: reviewed Beta and ProductionCopy inventory, search-baseline, and query-cost evidence, plus verified rollback evidence, remain operational exit work.

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
Inventory output creation is exclusive and mode `0600`.
The runner refuses to overwrite an existing report.

Run the inventory against a restored, immutable copy whenever possible.
If an immutable copy is unavailable, use a declared low-write or quiescent window and prevent migration or scraper writes for the duration of the export and inventory.
Record the JSON report alongside the export from the same window so its collection counts, schema-version buckets, and reference checks describe a meaningful point in time.
The runner intentionally does not add transaction or snapshot read-concern behavior.

Implementation:

- [`server/src/scripts/researchModelInventory.ts`](../server/src/scripts/researchModelInventory.ts) gathers the facts from MongoDB.
- [`server/src/scripts/researchModelInventoryCore.ts`](../server/src/scripts/researchModelInventoryCore.ts) holds the collection spec, field probes, reference edges, and report shaping, and is unit tested without a database.

## Read-only Beta and ProductionCopy profiles

Preserved Phase 0 evidence must use the root profile commands instead of editing `server/.env`.
The commands accept no arbitrary child command and always invoke the inventory with `--sample-limit 0`.
They load only `MONGODBURL` from a current-user-owned external directory, skip `server/.env`, and pass a minimal child environment without migration, promotion, production-write, Meilisearch, OpenAI, or scraper credentials.

Create the operator directory outside every repository worktree.
The directory must be absolute, owned by the current operating-system user, contain no symlink path components, and grant no group or other permissions.
Each profile must be a regular current-user-owned file with mode `0600`.

```bash
YLABS_INVENTORY_PROFILE_DIRECTORY=/absolute/path/to/ylabs-inventory-profiles
install -d -m 700 "$YLABS_INVENTORY_PROFILE_DIRECTORY"

install -m 600 \
  server/.env.beta-inventory.example \
  "$YLABS_INVENTORY_PROFILE_DIRECTORY/beta-inventory.env"

install -m 600 \
  server/.env.production-copy-inventory.example \
  "$YLABS_INVENTORY_PROFILE_DIRECTORY/production-copy-inventory.env"
```

Replace every placeholder before use.
Each file may contain only `MONGODBURL`.
Provision a separate Atlas user with the `read` role scoped only to the named database.
The launcher requires a remote `mongodb+srv` Atlas URL with credentials and the exact `Beta` or `ProductionCopy` database name.
It rejects local hosts, placeholders, insecure connection options, database mismatches, and the primary `Production` database before the inventory process can connect.

Run Beta inventory from a clean Beta worktree:

```bash
umask 077

yarn model-refactor:inventory:beta \
  --profile-dir "$YLABS_INVENTORY_PROFILE_DIRECTORY" \
  --output /tmp/ylabs-model-inventory-beta.json
```

Run ProductionCopy only after the Production restore has completed and an independent operator has verified the restored database:

```bash
umask 077

yarn model-refactor:inventory:production-copy \
  --profile-dir "$YLABS_INVENTORY_PROFILE_DIRECTORY" \
  --output /tmp/ylabs-model-inventory-production-copy.json
```

Every output path must be a new absolute `.json` file below the system temp directory.
Protected profile runs require that output and print only credential-free completion metadata to stdout, never the report body or private counts.
Move no real profile into a worktree.
Named environment files are ignored as a final defense, while placeholder-only examples remain tracked.

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

### Aggregate-only Development evidence

Run these commands from the repository root after confirming `server/.env` points to the `Development` database.
They retain aggregate collision, repair, category, reference-impact, and coverage counts without emitting record-level rows, identifiers, names, contact identities, slugs, URLs, or samples.

```bash
umask 077

SCRAPER_ENV=development yarn --cwd server users:dedupe-by-identity \
  --summary-only \
  --environment=development \
  --limit=10000 \
  --output /tmp/ylabs-development-user-identity-summary.json

SCRAPER_ENV=development yarn --cwd server research-entity-members:audit-user-refs \
  --summary-only \
  --environment=development \
  --limit=10000 \
  --output /tmp/ylabs-development-member-reference-summary.json

SCRAPER_ENV=development yarn --cwd server research-entity:duplicate-name-review \
  --summary-only \
  --environment=development \
  --limit=10000 \
  --plan-limit=10000 \
  --output /tmp/ylabs-development-duplicate-name-summary.json

SCRAPER_ENV=development yarn --cwd server research-entity:coverage-audit \
  --summary-only \
  --environment=development \
  --output /tmp/ylabs-development-coverage-summary.json
```

`--summary-only` is incompatible with `--apply`.
It requires an explicit `--environment` of `development`, `beta`, or `production-copy`, rejects primary production, and verifies both the configured and connected database names before any audit query.
The duplicate-name audit also rejects accepted-decision and decision-template options in summary-only mode.
The coverage audit rejects `--slug` because a slug-targeted report is record-specific.
User-identity collision limits apply per identity field, and duplicate-name limits apply to normalized-name clusters.
Their summary reports include explicit possible-truncation indicators and label limit-reached counts as bounded lower-bound evidence rather than full coverage.
The member-reference summary preserves full orphan and archived-entity-member totals, while its proposed repair classifications remain detail-limit bounded and carry a separate possible-plan-truncation indicator.
Coverage `totalEntitiesScanned` is computed over all entities selected by the aggregate filters.
`flaggedEntities` and `issueCounts` are computed from entities whose issue score meets `--min-score`.
`--all` controls detailed row inclusion only and is unnecessary in summary-only mode.
The row limit does not cap summary-only counts.
Use the default detailed dry-run modes only inside an approved private review workflow.

## Private ResearchEntity search baseline

The search baseline is read-only and exercises the current public ResearchEntity search service.
That means each case includes Meilisearch candidate retrieval, MongoDB visibility verification, and the current access and planning enrichment reads.
The bounded suite covers blank browse, keyword search, a short alias, a semantic phrase, department and research-area filters, and a deep allowed page.

The artifact contains query labels and inputs, deployed settings and salt fingerprints, safe settings field names, index document count, latency samples, degradation state, estimated totals, and ordered HMAC result fingerprints.
It never contains entity IDs, names, slugs, URLs, contact data, or the HMAC salt.
The artifact is still private operational evidence because counts and stable cross-run fingerprints can reveal internal state.
Do not attach it to an issue or pull request.

Use the same high-entropy salt for every environment that will be compared.
Store the salt in the team secret manager and inject it through `PHASE0_SEARCH_BASELINE_SALT`.
Never pass the salt as a command-line argument or write it into a worktree.
Every output must be a new `.json` path under the system temporary directory.
The writer creates the file with mode `0600`, refuses symlink outputs, and refuses overwrite.

Load the exact target credentials from an approved operator secret store before each command.
Set `YLABS_SKIP_LOCAL_DOTENV=true` so a checkout-local `server/.env` cannot replace an omitted target setting.
The command verifies the configured and connected MongoDB database name before search.
It rejects primary Production and a Production Meilisearch prefix.
Beta requires `MEILISEARCH_INDEX_PREFIX=beta`.
ProductionCopy requires a dedicated prefix such as `production-copy-july`; it must never point at `prod_researchentities`.

Run the Development baseline from a clean Beta worktree with `MONGODBURL` targeting `Development` and local Meilisearch:

```bash
umask 077

export YLABS_SKIP_LOCAL_DOTENV=true
export PHASE0_SEARCH_BASELINE_SALT
export MONGODBURL
export MEILISEARCH_HOST=http://localhost:7700
unset MEILISEARCH_INDEX_PREFIX

yarn model-refactor:search-baseline \
  --environment=development \
  --iterations=3 \
  --top-k=10 \
  --strict \
  --output=/tmp/ylabs-phase0-search-development.json
```

Run the Beta baseline from the same source commit with the read-only Beta MongoDB user and private Beta Meilisearch credentials:

```bash
umask 077

export YLABS_SKIP_LOCAL_DOTENV=true
export PHASE0_SEARCH_BASELINE_SALT
export MONGODBURL
export MEILISEARCH_HOST
export MEILISEARCH_API_KEY
export MEILISEARCH_INDEX_PREFIX=beta

yarn model-refactor:search-baseline \
  --environment=beta \
  --iterations=3 \
  --top-k=10 \
  --strict \
  --output=/tmp/ylabs-phase0-search-beta.json
```

Run ProductionCopy only after the approved MongoDB restore and a dedicated non-production Meilisearch index copy exist:

```bash
umask 077

export YLABS_SKIP_LOCAL_DOTENV=true
export PHASE0_SEARCH_BASELINE_SALT
export MONGODBURL
export MEILISEARCH_HOST
export MEILISEARCH_API_KEY
export MEILISEARCH_INDEX_PREFIX=production-copy-july

yarn model-refactor:search-baseline \
  --environment=production-copy \
  --iterations=3 \
  --top-k=10 \
  --strict \
  --output=/tmp/ylabs-phase0-search-production-copy.json
```

Unset the injected credentials and salt after each run.
Preserve the source commit, salt fingerprint, query suite, iteration count, top-K, and settings fingerprint with the comparison.
Compare estimated totals and ordered result fingerprints per case.
Treat any degraded sample, unstable ordered result set, unexpected count change, or ranking change as review-required evidence rather than silently accepting it.
`--strict` writes the artifact and then exits nonzero when a degraded or unstable sample requires review.
Latency is diagnostic only unless the environments use comparable network and compute conditions.

## Private MongoDB hot-path query-cost evidence

The query-cost audit measures deployed MongoDB indexes and redacted `executionStats` for every representative query shape in the [Phase 0 hot-path audit](./research-model-refactor-phase0-hot-paths.md).
It covers Research browse and detail, opportunity detail, account planning, and admin access review.
It does not call HTTP routes, execute application writes, retain fixture identifiers, or replace the separate Meilisearch baseline.

The runner uses a native MongoDB client with `secondaryPreferred` read preference, disables retryable writes, limits the pool to two connections, applies a `maxTimeMS` ceiling to every fixture and diagnostic query, and adds a `ylabs-phase0-hotpath:*` query comment.
It rejects primary Production before connecting by requiring `development`, `beta`, or `production-copy` and verifies the connected database name again after connecting.
Beta and ProductionCopy runs are accepted only through the hardened external inventory-profile contract documented above.
The profile launcher accepts no arbitrary child command and fixes the per-query ceiling at 5 seconds.

The private artifact contains credential-free index definitions, index fingerprints, fixture availability classes, and aggregate plan statistics.
It retains plan stages, rejected-plan stages, index names, returned rows, elapsed time, keys and documents examined, amplification ratios, blocking sorts, disk use, spills, and lookup subplan summaries.
It never retains IDs, names, slugs, netids, notes, contact details, evidence text, raw filters, raw pipelines, or raw explain output.
Account fixtures are aggregate-selected as zero-save, bounded typical-save, and highest-observed-save representatives, with the highest observed row serving as the nearest available near-limit shape.
Queries that depend on an empty fixture-ID set are omitted instead of measuring a synthetic empty `$in` shape.
Their expected labels are recorded as `fixture-unavailable`, which makes strict evidence fail closed.
Every output must be a new `.json` path under the system temporary directory or the invoking server working directory's `tmp/` directory.
The writer uses mode `0600`, refuses symlink outputs, and refuses overwrite.

Run Development from a clean Beta worktree with an explicitly injected Development database URL:

```bash
umask 077

export YLABS_SKIP_LOCAL_DOTENV=true
export MONGODBURL

yarn model-refactor:query-cost \
  --environment=development \
  --max-time-ms=5000 \
  --strict \
  --output=/tmp/ylabs-phase0-query-cost-development.json
```

Run Beta with the same external mode-`0600` profile used by the inventory:

```bash
umask 077

yarn model-refactor:query-cost:beta \
  --profile-dir "$YLABS_INVENTORY_PROFILE_DIRECTORY" \
  --output /tmp/ylabs-phase0-query-cost-beta.json
```

Run ProductionCopy only after the approved restore is available and its recovery evidence has been validated:

```bash
umask 077

yarn model-refactor:query-cost:production-copy \
  --profile-dir "$YLABS_INVENTORY_PROFILE_DIRECTORY" \
  --output /tmp/ylabs-phase0-query-cost-production-copy.json
```

Unset `MONGODBURL` and `YLABS_SKIP_LOCAL_DOTENV` after the Development run.
Do not attach any generated query-cost artifact to an issue or pull request.
Preserve it only in the approved access-controlled evidence location alongside the matching inventory, source commit, and recovery manifest.

Review every `collection-scan`, `blocking-sort`, `disk-spill`, `keys-amplification`, `documents-amplification`, measurement error, missing index collection, and unavailable fixture before Phase 0 closes.
The default amplification threshold is 100 keys or documents examined per returned row.
A zero-row plan is also flagged when it examines more than 100 keys or documents.
`--strict` writes the artifact first and then exits nonzero whenever any finding, missing fixture, measurement error, index-collection gap, or uncovered query label requires review.
An expected collection scan or blocking sort still needs a recorded owner and disposition instead of being silently accepted.
Compare the same query label and index fingerprint across Development, Beta, and ProductionCopy, and investigate plan-stage or amplification drift before later model phases redirect readers.

## Export and rollback prerequisites

No later phase may drop or overwrite a collection until these exist and are verified:

1. A recoverable export or Atlas point-in-time restore instruction for the target environment, captured immediately before the destructive step.
2. Recorded source and target document counts, so parity can be proven after a cutover.
3. A written rollback plan naming the exact collections touched and the restore command for each.

Record the inventory JSON alongside the export so the pre-change state is auditable.

### Versioned recovery manifest

The machine-readable contract is [`model-inventory-recovery-manifest.schema.json`](./model-inventory-recovery-manifest.schema.json).
Start from the tracked [`Beta example`](./model-inventory-recovery-manifest.beta.example.json) or [`ProductionCopy example`](./model-inventory-recovery-manifest.production-copy.example.json), copy it to a new mode-`0600` path under the system temp directory, and replace every placeholder.
It binds the exact inventory bytes to the source commit, credential-free target, capture window, Atlas recovery artifact, retention expiry, rollback owner and procedure, protected object versions, and independent review.
ProductionCopy evidence additionally binds the completed `Production` to `ProductionCopy` restore and requires the immutable-restored-copy capture posture.

The schema cannot itself prove that an Atlas user has only the declared role or that an external object store is immutable.
The manifest therefore requires separate pre-capture attestations from two different operators for the Atlas current-user read-only role and protected object-version immutability, including each verifier, verification time, and protected evidence reference.
The recovery artifact must be created and verified before inventory capture starts.
The rollback drill must be verified before acceptance, and the accepting reviewer must be different from the recorded recovery and rollback owners.
The validator fails closed on missing fields, placeholders, target mismatches, invalid time ordering, nonzero sample limits, identifier samples, digest or byte drift, public or local artifact references, and absent ProductionCopy restore verification.

Keep the inventory and manifest as mode-`0600` regular files under the system temp directory while validating them.
Upload the inventory, recovery record, manifest, and validation receipt to access-controlled storage with a retained version or write-once object identifier.
Do not post the artifacts, private counts, object references, restore identifiers, or document identifiers in a public issue or pull request.

```bash
yarn model-refactor:inventory:validate-evidence \
  --manifest /tmp/ylabs-model-inventory-production-copy-manifest.json \
  --inventory /tmp/ylabs-model-inventory-production-copy.json \
  --receipt-output /tmp/ylabs-model-inventory-production-copy-receipt.json
```

The validator refuses to overwrite a receipt.
Its stdout and receipt contain only the environment, database name, source commit, and SHA-256 plus byte counts for the inventory and manifest.
The complete protected object versions and recovery procedures remain inside the private manifest.

## Exit condition

Phase 0 exits on reviewed Development, Beta, and ProductionCopy inventory, search-baseline, and MongoDB query-cost evidence, plus an ownership map of which phase owns each collection and field and verified rollback evidence.
The collection spec in `researchModelInventoryCore.ts` is the machine-readable form of that ownership map, and should be extended whenever the report surfaces an unclassified collection.
