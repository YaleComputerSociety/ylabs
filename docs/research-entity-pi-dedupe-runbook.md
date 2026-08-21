# Research Entity PI Dedupe Runbook

This runbook covers the guarded operator workflow for deduplicating `ResearchEntity` records that surface the same lab more than once because they share a principal investigator.
It documents the existing `research-entity:dedupe-by-pi` command, which defaults to a read-only dry run and only writes after a reviewed decision artifact plus explicit confirmation flags.
It is the safe-execution procedure for [issue #350](https://github.com/YaleComputerSociety/ylabs/issues/350); the detection and merge logic already ship in [`dedupeResearchEntitiesByPi.ts`](../server/src/scripts/dedupeResearchEntitiesByPi.ts) and [`researchEntityPiDedupeCore.ts`](../server/src/scripts/researchEntityPiDedupeCore.ts).

## Scope and operating rules

Run this command locally from the repository root against the `MONGODBURL` loaded from `server/.env`.
Do not add it to Render, application startup, scraper execution, scheduled jobs, or deployment hooks.
Before every run, verify that `MONGODBURL` names the intended database and does not contain a different environment's target.

The command is dry-run by default and prints a JSON report to stdout.
Writes require `--apply`, and `--apply` is refused unless both `--confirm-research-entity-pi-dedupe` and an explicit `--limit` are present.
The `assertScriptApplyAllowed` guard additionally refuses a production-looking database target unless `SCRAPER_ENV=production`, and production writes require `CONFIRM_PROD_SCRAPE=true`.
Report and decision artifacts may only be written under the OS temp directory or `./tmp`, and every artifact path must end in `.json`.

The default duplicate disposition is archive, not delete.
Archived duplicates keep their documents, gain `archived: true` and a `canonicalGroupId` pointing at the surviving entity, and stay recoverable.
`--delete-duplicates` is a separate, stricter mode that only removes a duplicate after every dependent reference has been relinked and no remaining references are found.

## What detection groups

Default detection groups active, non-archived research entities that share a `pi` role membership for the same user, using stored PI first and last names.
It also folds in exact faculty profile-area shells, such as `<First> <Last> Lab`, `<First> <Last> Laboratory`, and `<First> <Last> Research`, for the same PI.
Same-name clusters are only treated as duplicates when a single shared PI backs them or when the name is a full-person lab name, so unrelated same-surname labs are not merged.

Narrowing modes let an operator review one risk class at a time:

- `--reviewed-profile-area-only` limits the plan to profile-area shells that have a concrete same-PI home.
- `--funding-only` limits the plan to funding-only shells that merge into a stronger Yale-backed entity.
- `--official-lab-url-only` groups entities that share an exact `https://medicine.yale.edu/lab/<slug>` URL, without requiring PI membership.
- `--slug=<slug>` restricts the plan to a single canonical or duplicate slug.

Canonical selection is scored, not arbitrary: Yale-backed, described, and richer entities win over funding-only, empty, or shell rows.
An entity that carries its own real (non-profile, non-funding) lab website is treated as a concrete research home, never as a profile-area shell, so it is preferred as canonical and is never archived into a PI-derived `<PI> Lab` grant shell that would discard its real name and site.
The canonical entity's slug is preserved; only the duplicate entities are archived by id.

## Data preserved on merge

A merge never discards evidence:

- The canonical entity gains the union of duplicate `departments`, `researchAreas`, and `sourceUrls` through `$addToSet`.
- Non-conflicting duplicate memberships are relinked to the canonical entity; a duplicate membership that would collide with an existing canonical membership is retired with `isCurrentMember: false` and an `endedAt` timestamp instead of being dropped.
- Relationships, entry pathways, access signals, contact routes, posted opportunities, and scholarly links are relinked to the canonical entity, or archived when relinking would violate a unique key.
- When the canonical entity lacks a concrete website but a merged duplicate carries one, the canonical inherits that concrete `websiteUrl`, and if its own name is only a PI-derived `<PI> Lab` placeholder it also inherits the donor's real `name`/`displayName`; the `reviewBreakdown` reports these as `groupsCarryingCanonicalWebsite` and `groupsCarryingCanonicalName`.
- After apply, the student visibility gate is recomputed for each affected canonical entity so reads never serve a stale tier.

## Review and apply workflow

Run every step in Development or Beta first, review the artifacts, then repeat against a higher environment only after a fresh restore point exists.

1. Generate a dry-run report and a reviewer decision template.

```bash
SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi \
  --limit=10000 \
  --full-plan \
  --output /tmp/ylabs-research-entity-dedupe-dry-run.json \
  --decision-template-output /tmp/ylabs-research-entity-dedupe-decisions.json
```

2. Review the report's `reviewBreakdown`, `plannedGroups`, and `plan`, and confirm the numbers match expectations.
The latest recorded Development baseline for #350 is 179 groups covering 186 duplicate entities.

3. Fill in the decision template.
Each row's `decision` must be one of `merge_into_canonical`, `mark_distinct_homes`, or `defer_review`, and each reviewed row must set `reviewedBy`.
A `merge_into_canonical` decision must keep the generated `canonicalEntityId`.

4. Re-run in dry-run mode with the accepted decisions to validate them against a freshly generated plan.

```bash
SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi \
  --limit=10000 \
  --accepted-decisions /tmp/ylabs-research-entity-dedupe-decisions.json \
  --output /tmp/ylabs-research-entity-dedupe-validated.json
```

Confirm the report's `reviewDecisionValidation` shows `invalidDecisionCount: 0` before applying.

5. Apply only the accepted merges, bounded by `--max-apply`.

```bash
SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi \
  --apply \
  --confirm-research-entity-pi-dedupe \
  --limit=10000 \
  --max-apply=<reviewedDuplicateCount> \
  --accepted-decisions /tmp/ylabs-research-entity-dedupe-decisions.json \
  --output /tmp/ylabs-research-entity-dedupe-apply.json
```

`--max-apply` must be at least the total planned duplicate entities plus planned duplicate current members, or apply is refused before any write.

6. After a Beta apply, rebuild or verify Meilisearch so browse stops surfacing the archived duplicates, then re-run the read-only launch and visibility audits.

## Environment order and production

Development and Beta are the review environments.
A production run uses the same command under `SCRAPER_ENV=production` and `CONFIRM_PROD_SCRAPE=true`, and only inside a promotion lane that has recorded a fresh Atlas restore point.
Rollback for archive-mode dedupe is unarchiving the affected duplicates and clearing their `canonicalGroupId`, or restoring the target database from the pre-run backup for delete mode.

See the promotion lanes and copy-set details in [`scraper-deployment-runbook.md`](scraper-deployment-runbook.md) and the control-plane repair posture in [`research-data-pipeline.md`](research-data-pipeline.md).
