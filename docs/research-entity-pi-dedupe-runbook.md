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
- `--org-name-only` deduplicates non-person organizational homes (`CENTER`, `INSTITUTE`, `INITIATIVE`, `CORE_FACILITY`) minted by two ingestion slug schemes, keyed on normalized display name plus entity type rather than a person id (issue #603).
A PI-attached entity may join a group only as a duplicate, never as the canonical survivor, and a group merges only when it also contains at least one PI-free organizational anchor entity to corroborate against, so a faculty-profile-derived entity that was renamed to an organization's name can be absorbed into the real organization while two independently PI-led entities that merely share a name still never merge into each other (issue #684).
A group merges only when the identity is corroborated by a shared distinctive Yale host (a dedicated research subdomain, excluding generic umbrella hosts such as `research.yale.edu` and department subdomains) or by a name with at least two significant non-organizational tokens, so distinct organizations that merely share a word are never merged.
The survivor is the more complete catalog entity (members, departments, description), and the real dedicated website is carried over a generic index URL, failing closed to no website when no dedicated home exists in evidence.
- `--shared-person-id` keys on the canonical person id across any PI `RoleAssignment` state, including historical or unknown, and treats each person's entities as one cluster, so a professor minted as several differently-named entities merges regardless of name; it also carries the fullest description across the group and reports a same-name/different-person quarantine so distinct people who happen to share a lab name are surfaced and never merged.
- `--slug=<slug>` restricts the plan to a single canonical or duplicate slug.

Canonical selection is scored, not arbitrary: Yale-backed, described, and richer entities win over funding-only, empty, or shell rows.
An entity that carries its own real (non-profile, non-funding) lab website is treated as a concrete research home, never as a profile-area shell, so it is preferred as canonical and is never archived into a PI-derived `<PI> Lab` grant shell that would discard its real name and site.
The canonical entity's slug is preserved; only the duplicate entities are archived by id.

## Data preserved on merge

A merge never discards evidence:

- The canonical entity gains the union of duplicate `sourceUrls` through `$addToSet`, and the union of duplicate `departments` through `$addToSet` under one corroboration gate.
- The `departments` union drops the cross-cutting biomedical seed tuple (`Neuroscience` + `Psychology` + `Molecular, Cellular, and Developmental Biology`, whose derived `School of Medicine`/`FAS` schools follow) only when the full three-department signature co-occurs and neither the merged `researchAreas` (biomedical keyword match) nor a trusted non-shell entity in the cluster corroborates a biomedical affiliation, so a Wu-Tsai-style institute seed grafted onto an off-domain lab or scholar is not unioned in; a lone member of the tuple with no co-occurring siblings, and every other department, merge unconditionally (issue #734).
- The `researchAreas` union excludes low-trust `nsf-pi-*`, `nih-pi-*`, and `faculty-research-area-*` shell entities, so a wrong-domain grant-shell area is never grafted onto a real research home; it falls back to the full cluster only when every entity is such a shell (issue #604).
- The canonical `fullDescription`/`shortDescription` are repaired to the fullest correct sibling description across the cluster, using the same low-trust shell exclusion, so a thin or hallucinated canonical description is replaced when a fuller correct sibling exists (issue #604).
- Non-conflicting duplicate memberships are relinked to the canonical entity; a duplicate membership that would collide with an existing canonical membership is retired with `isCurrentMember: false` and an `endedAt` timestamp instead of being dropped.
- Relationships, entry pathways, access signals, contact routes, posted opportunities, scholarly links, and students' saved `ResearchPlan` targets are relinked to the canonical entity, or archived when relinking would violate a unique key (a saved plan already on the canonical target keeps its place and the redundant duplicate-targeted plan is archived rather than force-merged past the `(accountId, target.kind, target.id)` unique index).
- When the canonical entity lacks a concrete website but a merged duplicate carries one, the canonical inherits that concrete `websiteUrl`, and if its own name is only a PI-derived `<PI> Lab` placeholder it also inherits the donor's real `name`/`displayName`; the `reviewBreakdown` reports these as `groupsCarryingCanonicalWebsite` and `groupsCarryingCanonicalName`.
- After apply, the student visibility gate is recomputed for each affected canonical entity and those canonicals are force re-synced to Meilisearch, so reads never serve a stale tier and the surviving entity's search document reflects the relinked members/lead even when its tier did not change.
- Bookmarked or inbound requests to an archived duplicate's slug follow the tombstone's `canonicalGroupId` chain, hop by hop, until it reaches a live public canonical entity and `302`s there instead of returning a `404`, so saved links to a merged-away duplicate still land on the surviving research home even when an earlier dedupe pass left an intermediate hop pointing at another archived or suppressed shell; a cycle guard and a 10-hop cap bound the walk, and a chain that dead-ends at no live public entity still returns a `404`.

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

## Automatic eponymous FRA to lab merge in the sweep

The high-confidence eponymous subset of same-PI dedupe (a `faculty-research-area-*` shell that shadows the SAME PI's own concrete lab, guarded against CENTER/INSTITUTE canonicals) can run automatically inside the scraper sweep instead of the manual review workflow above.
It is exposed as the `research-entity:merge-eponymous-fra` stage, wired into the `development-full` post-run pipeline after `faculty-projection` (materialization) and before `search-rebuild`, so the student-visibility gate and the search index evaluate the merged canonical.
When the sibling accountless-researcher-shell dedupe stage is also enabled (`SCRAPER_SWEEP_DEDUPE_RESEARCHERS=1`, exposed as `researchers:dedupe-accountless-shells`), it runs between `faculty-projection` and this FRA merge so researchers are unified into their account-linked canonical before entities are merged.

The stage is flag-gated OFF by default.
It only runs when `SCRAPER_SWEEP_AUTO_MERGE_FRA=1` (or `=true`) is set in the sweep environment; with the flag unset the stage is not added, so Beta and Prod sweeps are unaffected until the flag is deliberately enabled after Dev validation.

The stage is scoped and capped, not a full-corpus scan.
It merges only PIs whose entities were materialized during the current sweep (`--since <sweep start ISO>` resolves the affected entities via `lastObservedAt`, then their PI role assignments), and `--max-merges` (default 250) bounds the number of merges applied per run, deferring any overflow to a later sweep.
Each run emits a merge-delta summary into the sweep report (`postRun.stages[].mergeDelta`): the FRA-to-lab pairs merged, the planned, applied, and cap-deferred counts, and a center-guarded PI count.

The stage is idempotent.
The scope loader excludes archived entities, so a merged shell never re-enters the plan, and `materializeEntity` short-circuits (skipped `merged-into-canonical`) when it re-resolves an archived shell that carries a `canonicalGroupId`, so re-scraping the shell's source never re-activates it or re-indexes it into Meilisearch.
A second sweep pass over the same data therefore performs zero additional merges and leaves the archived shell archived.

## Durable canonical redirect (permanent, delete-safe merge)

Every merge also records a durable redirect in the dedicated `research_entity_redirects` collection: one row per collapsed shell mapping the shell's stable source identifiers (`mergedSlug` and `mergedEntityId`) to the surviving `canonicalEntityId` (with `canonicalGroupId`, `mergedAt`, and a `reason` such as `eponymous_fra_lab_merge`).
Because this mapping lives in its own collection rather than on the shell row, it survives deletion of the shell.
The redirect is written from the shared merge primitive (`applyResearchEntityDedupeMergeGroup`), so both the pipeline stage and the manual `research-entity:dedupe-by-pi` CLI produce it, and re-recording the same merge upserts the same row (keyed on the globally unique `mergedSlug`), so it stays idempotent.

`materializeEntity` consults the redirect before minting: when a re-scrape resolves a source whose slug or original id has a redirect, it resolves straight to the live canonical entity, following `canonicalGroupId` and redirect chains, and materializes the observations into the canonical rather than re-creating the shell.
This resolution works whether or not the shell row still exists, which makes the merge permanent and lets the shell be deleted safely.
The redirect supersedes the archived-tombstone resurrection guard for the redirected case; the tombstone guard still covers pre-redirect merges whose shells are only archived.

Ambiguous, non-eponymous same-PI clusters are never auto-selected here and continue to rely on the manual review workflow and the gate's existing `duplicate_risk` suppress-in-place fallback.

## Environment order and production

Development and Beta are the review environments.
A production run uses the same command under `SCRAPER_ENV=production` and `CONFIRM_PROD_SCRAPE=true`, and only inside a promotion lane that has recorded a fresh Atlas restore point.
Rollback for archive-mode dedupe is unarchiving the affected duplicates, clearing their `canonicalGroupId`, and removing the matching `research_entity_redirects` rows, or restoring the target database from the pre-run backup for delete mode.

See the promotion lanes and copy-set details in [`scraper-deployment-runbook.md`](scraper-deployment-runbook.md) and the control-plane repair posture in [`research-data-pipeline.md`](research-data-pipeline.md).
