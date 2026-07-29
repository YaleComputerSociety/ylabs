# Phase 2 Account, Person, and Role Planning

This runbook covers the read-only repository foundation for [Phase 2](https://github.com/YaleComputerSociety/ylabs/issues/206).
It does not complete Phase 2, write canonical collections, redirect public readers, or authorize a migration.
Phase 0 and Phase 1 must exit before any target-collection write or runtime identity cutover.

## What The Planner Reads

The planner reads bounded snapshots from:

- `users`;
- `faculty_members`;
- `research_entity_members`.

It uses one MongoDB snapshot session with `secondaryPreferred`, `retryWrites=false`, a pool of two connections, a five-second default query ceiling, and the `ylabs-phase2:identity-migration-plan` query comment.
Each collection scan is sorted by `_id`, capped independently, and reports possible truncation.
Archived identity rows remain in the scan so an archived, explicitly historical membership can resolve its original person safely.
Unrelated archived identities remain outside person planning, and an archived membership without historical evidence enters quarantine.
The command never reads from or writes to `accounts`, `people`, or `role_assignments`.

## Planning Rules

The private report separates planned `Account`, `Person`, and `RoleAssignment` rows from quarantined source records.
An account plan requires a normalized netid, a Yale email, and legacy login or confirmation evidence.
Duplicate account netids or emails enter quarantine.

A person plan currently requires accepted Yale evidence through a netid or Yale email.
All User and FacultyMember Yale URLs remain private review hints and never merge identities or create a person.
Legacy `profileVerified`, scraper field provenance, and approved-looking embedded review objects cannot satisfy identity review.
Official profile evidence remains disabled until a governed `ReviewDecision` or `EvidenceClaim` can bind the exact source record and URL after the earlier phase gates exit.
Nested profile URL inspection has hard string, node, queue, child, and depth bounds.
Any traversal truncation quarantines the affected identity and marks the report incomplete.
ORCID and Google Scholar identifiers may remain external identity hints after a Yale identity exists.
They never act as identity merge keys and cannot bridge an external-only row or membership into a Yale-confirmed Person.
External identifiers alone never create a person.
Names never merge identity components.
Distinct identity components with the same normalized name enter quarantine.
Conflicting netids, emails, ORCIDs, Google Scholar identifiers, names, or explicit source references also enter quarantine.

A role assignment normally resolves through a canonical source `userId` or `facultyMemberId`.
An unresolved explicit reference never falls back to a same-name match.
A name-only membership may produce only an unreviewed plan when exactly one Yale-confirmed planned person has that normalized name.
Historical, alumni, ended, or explicitly non-current memberships remain `HISTORICAL`.
This includes materializer-produced historical memberships whose legacy row is archived.
Historical roles resolved through an archived identity remain unreviewed, while a current role that resolves only to archived identity evidence enters quarantine.
Unsupported roles, ambiguous identities, missing people, and missing research entities enter quarantine.

## Private Output Contract

The report contains raw source identifiers and account identity fields needed for operator review.
Treat it as private migration evidence.
The command requires a JSON output under the system temporary directory or repository-local `tmp/`, refuses to overwrite a file, and creates the artifact with mode `0600`.
Standard output contains only completion metadata and no plan counts or identities.
Do not paste the artifact, database-derived counts, or source identifiers into GitHub.

The report records:

- the clean source commit;
- the exact environment and database;
- collection scan bounds and truncation;
- planned account, person, and role-assignment rows;
- every quarantine reason within the configured bound;
- explicit policy assertions that no writes or runtime redirects occurred.

`--strict` preserves the private artifact but exits nonzero if any collection or quarantine section was truncated.

## Development Dry Run

Run from a clean committed worktree with `MONGODBURL` targeting the `Development` database.

```bash
yarn --cwd server model-refactor:identity-plan \
  --environment development \
  --document-limit 100000 \
  --quarantine-limit 25000 \
  --max-time-ms 5000 \
  --strict \
  --output /tmp/ylabs-phase2-identity-plan-development.json
```

The command rejects a mismatched database name.
It also rejects Production even when the caller labels the run as Development.

## Protected Beta And ProductionCopy Dry Runs

Beta and ProductionCopy reuse the external read-only inventory profiles from the [Phase 0 runbook](./research-model-refactor-phase0.md#protected-read-only-profiles).
The profile directory and files must satisfy the existing ownership, location, permission, Atlas URL, and database-name checks.

```bash
yarn model-refactor:identity-plan:beta \
  --output /tmp/ylabs-phase2-identity-plan-beta.json

yarn model-refactor:identity-plan:production-copy \
  --output /tmp/ylabs-phase2-identity-plan-production-copy.json
```

The fixed launchers do not accept arbitrary child arguments.
They bind the clean source commit and execute the same strict read-only planner.
There is intentionally no Production command or Production profile.

## Review Gate

Review all quarantine classes and planned mappings privately.
Accepting this dry run does not authorize writes.
After Phase 0 and Phase 1 exit, a separately reviewed apply design must bind an accepted artifact to the same environment and source state, support idempotent reconciliation and rollback, and require an explicit write confirmation.
Public leadership and Meilisearch professor-name projections must remain on compatibility readers until the later runtime parity gate passes.
