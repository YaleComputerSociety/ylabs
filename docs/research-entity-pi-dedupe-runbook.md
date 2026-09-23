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
The same write withdraws their student-visibility verdict, because the gate never re-gates an archived row and a stored tier on one over-reports every count by tier (#2896, see "Archived Rows Store No Student-Visibility Verdict" in `docs/research-model.md`).
Operator intent survives, so a recovered row is re-gated from evidence with its override and suppression reason intact.
`--delete-duplicates` is a separate, stricter mode that only removes a duplicate after every dependent reference has been relinked and no remaining references are found.

## What detection groups

Default detection groups active, non-archived research entities that share a `pi` role membership for the same user, using stored PI first and last names.
It also folds in exact faculty profile-area shells, such as `<First> <Last> Lab`, `<First> <Last> Laboratory`, and `<First> <Last> Research`, for the same PI.
Same-name clusters are only treated as duplicates when a single shared PI backs them or when the name is a full-person lab name, so unrelated same-surname labs are not merged.

Narrowing modes let an operator review one risk class at a time:

- `--reviewed-profile-area-only` limits the plan to profile-area shells that have a concrete same-PI home.
- `--funding-only` limits the plan to funding-only shells that merge into a stronger Yale-backed entity.
- `--official-lab-url-only` groups entities that share an exact `https://medicine.yale.edu/lab/<slug>` URL, without requiring PI membership.
- `--profile-lab-url-only` groups `LAB` and `FACULTY_RESEARCH_AREA` entities that share the same specific per-entity Yale page (a `/lab/<x>` or `/profile/<x>` path on `yale.edu` or a subdomain, normalized for scheme, `www.`, and trailing slash), so URL-duplicate entities stranded in suppressed collapse into one research home; it keys on any of `websiteUrl`, `website`, or `sourceUrls` rather than PI membership and prefers a concrete `LAB` as canonical.
It excludes funding shells and any other entity type, and it applies the same lead-name clustering the website-URL lane uses, which carries three refusals so a shared page never collapses distinct people: names must agree on a person lead-name, a cluster with conflicting explicit first names under a shared surname is rejected, and a lab member whose profile was minted under the lab's own name and slug (a person-derived slug whose surname disagrees with the cluster's) is dropped rather than folded into the namesake lab.
All three live inside `clusterEntitiesBySharedLeadPersonIdentity` rather than at either lane's call site, because the clustering is transitive union-find and a lane that took the raw components would collapse two same-surname people through a first-name-less bridge row.
Never-demote survivor selection shipped for this mode and now runs for every lane, so it is described once under [Lane-agnostic refusals](#lane-agnostic-refusals) below.
- `--website-url-only` groups entities whose served `websiteUrl` normalizes to the same identity key (host plus path, scheme-agnostic, `www.` and trailing slash and query stripped), so a lab that lives on its own domain is covered where the path-keyed lane cannot reach.
This is the lane for a duplicate revealed by a byte-identical custom lab domain: the key is the whole URL rather than a Yale `/lab/<x>` or `/profile/<x>` path, so `crewslab.example.edu/` and `examplelab.org/` are keys while the path lane produces nothing for either (#2581).
It keys on `websiteUrl` alone, never `sourceUrls`, because a cited source is evidence about a page rather than a claim to be that page, and it prefers the twin with an active PI `RoleAssignment` as canonical so a newer bio clone folds into the established lab.
A shared URL is not by itself a same-entity proof, so the lane refuses rather than merges in three cases: a group containing a low-trust `faculty-research-area-` shell is left to the profile-area lane, a group containing a funding shell merges only when the shared URL is a distinctive non-funding host (issue #1147), and a row whose entity type the `--org-name-only` lane owns (`CENTER`, `INSTITUTE`, `INITIATIVE`, `CORE_FACILITY`) is dropped from the cluster, because a facility sharing a person's URL is being cited by that person rather than named twice.
That last exclusion drops the organizational row rather than refusing the whole URL, because a centre's page is legitimately cited by several people and refusing the URL would also refuse the same-person duplicates citing it: on Development the two shapes appear on one key, a served centre plus several suppressed person rows, two of which are the same person.
It is keyed on the org lane's own constant so the two vocabularies cannot drift: without it the lane planned to archive a served `CORE_FACILITY` into a suppressed person row that had been minted under the facility's name (#2581).
The lead-name clustering is shared with the path-keyed lane, including all three of its person-identity refusals, so a group site hosting several distinct faculty is never collapsed (issue #1130) and a bare-surname row cannot bridge two same-surname people into one merge.
- `--org-name-only` deduplicates non-person organizational homes (`CENTER`, `INSTITUTE`, `INITIATIVE`, `CORE_FACILITY`) minted by two ingestion slug schemes, keyed on normalized display name plus entity type rather than a person id (issue #603).
A PI-attached entity may join a group only as a duplicate, never as the canonical survivor, and a group merges only when it also contains at least one PI-free organizational anchor entity to corroborate against, so a faculty-profile-derived entity that was renamed to an organization's name can be absorbed into the real organization while two independently PI-led entities that merely share a name still never merge into each other (issue #684).
A group merges only when the identity is corroborated by a shared distinctive Yale host (a dedicated research subdomain, excluding generic umbrella hosts such as `research.yale.edu` and department subdomains) or by a name with at least two significant non-organizational tokens, so distinct organizations that merely share a word are never merged.
The survivor is the more complete catalog entity (members, departments, description), and the real dedicated website is carried over a generic index URL, failing closed to no website when no dedicated home exists in evidence.
- `--shared-person-id` keys on the canonical person id across any PI `RoleAssignment` state, including historical or unknown, and treats each person's entities as one cluster, so a professor minted as several differently-named entities merges regardless of name; it also carries the fullest description across the group and reports a same-name/different-person quarantine so distinct people who happen to share a lab name are surfaced and never merged.
- `--slug=<slug>` restricts the plan to a single canonical or duplicate slug.

## Lane-agnostic refusals

Each applies to every lane, and each only ever refuses or reshapes a merge, so none can permit one that would not otherwise happen.

**Person-profile conflation.** A group whose merged evidence cites two or more distinct person profiles is refused and reported in `conflatedPersonProfileQuarantine`, because a site-wide identity key is not a person key: every member of a lab legitimately cites the lab's own URL, so a member's profile row otherwise clusters with the lab and is archived into it.
`personProfileIdentityFromUrl` compares people rather than URL strings, so a credential suffix (`-phd`), a reversed name order, a middle initial carried by only one directory, and a trailing birth-death lifespan all resolve to one person and never trigger the refusal.
A slug that yields a single name token is still a person, so a mononym profile URL cannot silently switch the refusal off.
The refusal is unconditional and runs before the plan the decision template is built from, so a quarantined group never reaches an `--accepted-decisions` file and no reviewed decision overrides it; merging one takes correcting the conflating evidence first.
How often the refusal fires is lane-dependent, so read it per run from `quarantinedConflatedPersonProfileGroups` in the dry-run report rather than from a figure recorded here: the only Development measurement taken (#2724) predates the identity function the guard now uses, so it is not quoted as current.
The refusal is deliberately independent of `multiPersonEntityQuarantine`, which keys on PI `RoleAssignment` links rather than on cited URLs, so a group carrying no multi-person role links can still be refused on its evidence alone.

**Never-demote survivor selection.** `resolveNonDemotingMerge` runs for every lane, not only the profile-lab-url one it shipped for, because nothing about a demotion is lane-specific: any lane that keeps a less-visible survivor drops a `student_ready` row out of student view (#2060).
Before committing each group it hydrates a candidate survivor with the best card (fullest useful descriptions, union of research areas, source URLs, departments, and leads across all twins) and simulates the served student-visibility tier with `computeResearchEntityStudentVisibility`, then accepts a candidate only when its simulated tier does not fall below the best input twin's tier.
It tries the preferred identity-consistent canonical first, then higher-tier twins, and if none holds the tier it defers the group (reported as `deferredAsWouldDemote`) rather than merging, so a merge is structurally incapable of dropping a `student_ready` lab out of student view.
Its description pick excludes low-trust area and funding shells the same way the plan builders do, so running it in `--funding-only` cannot promote a grant shell's generated blurb onto a real research home.
When holding the tier requires keeping a twin rather than the planned canonical, the swapped-in survivor keeps its own name and website, because the plan's `canonicalName`/`canonicalWebsiteUrl` carry was gated on the planned canonical and was never evaluated for it.
A swap is refused outright, and the group deferred as `deferredAsWouldSwapPinnedCanonical`, whenever the planned canonical is pinned: under `--accepted-decisions`, because the reviewer approved that survivor, and under `--delete-duplicates`, because the swap would hard-delete it.
`deferredAsWouldDemoteGroups`, `deferredAsWouldSwapPinnedCanonicalGroups`, and the deferral-adjusted `appliedGroups` are reported at the top level of every run, so a run that deferred every group cannot read as a run that merged them.

**Primary-appointment survivor selection.** A cross-listed professor is listed by two schools, so two rosters mint a research home for one person: a Statistics and Data Science professor with a Biological and Biomedical Sciences track listing gets both a department row and a School of Medicine row.
Only the appointment roster describes the research the person actually directs, so the row minted by that roster is the canonical and the cross-listing row is the duplicate.
The appointment is read from the person's own official profile link (`profileLinks` with purpose `PRIMARY_IDENTITY`), and a candidate is aligned when the host of `fieldProvenance.slug.sourceUrl`, the roster that minted the row, matches the host of that profile URL.
Alignment dominates the evidence score rather than adding to it, because the score's slug-prefix terms rank a `ysm-` row above a `dept-` row on shape alone, which is how an empty cross-listing stub used to archive the row that held the description.
The preference is skipped when it carries no information: when no candidate is aligned, when every candidate is, when the person has no profile-URL primary link (a personal lab site is not a roster), or when a row has no recorded minting source.
It is also skipped for the FRA-shadow merge, which has already chosen its survivor structurally, so appointment alignment can never promote a profile-area shell over a concrete research home.
It runs before never-demote, which still hydrates and re-checks the served tier, so an aligned but thin canonical is filled from its twins rather than merged as-is.

Canonical selection is scored, not arbitrary: Yale-backed, described, and richer entities win over funding-only, empty, or shell rows.
An entity that carries its own real (non-profile, non-funding) lab website is treated as a concrete research home, never as a profile-area shell, so it is preferred as canonical and is never archived into a PI-derived `<PI> Lab` grant shell that would discard its real name and site.
The canonical entity's slug is preserved; only the duplicate entities are archived by id.
The one exception is a never-demote swap, which archives the planned canonical and keeps a higher-tier twin instead; it is refused rather than performed whenever the planned canonical is pinned by `--accepted-decisions` or by `--delete-duplicates`, so no run ever deletes the entity the plan named as the survivor.

## Merge rematerialization

`--rematerialize-canonical` re-projects the survivor from its own observations after the relink, instead of trusting the carry list alone to move evidence.
The carry writes eleven fields, so every field outside it keeps the survivor's own value however thin, which is how a merge can leave a research home emptier than the twin it archived.
Because the relink repoints each duplicate's observations onto the survivor, the survivor's evidence set is already the union of the group's, and the materializer resolves it per field with the usual provenance and confidence rules.
The step is skipped when references were not relinked, because projecting from a survivor's own evidence alone would unset what the carry just wrote, and it is skipped in Beta and Production, where the promotion path copies materialized collections without the evidence store and every materialization reaches an empty observation set.

The re-projection is fill-only: it writes a field only when the survivor's value is stranded and the projection supplies a materializable one.
The Development measurement behind that choice is `research-entity:audit-merge-rematerialize-drift`, a read-only audit over every live survivor holding an archived twin, which classifies each field an unrestricted re-projection would touch as recovered, replaced, or emptied.
Across 1,259 survivors it found 910 with recoverable evidence (784 lead links, 188 undergraduate hosting quotes, 120 method lists) but also 1,436 replacements and 36 fields that would be emptied, and sampling the description replacements showed some are shorter than what the survivor holds or are prose about the source page rather than about the research.
Description arbitration already has length and trust gates in the plan builders, so the merge gains evidence and never trades it.

Run the audit before changing the fill-only rule, and read `entitiesWithEmptiedEvidence` first: a re-projection that empties a served field is the failure this whole lane exists to prevent.

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
No fixed group count is recorded here as the expectation, because the person-profile conflation refusal (#2724) withholds groups from the plan: compare against the previous dry-run report for the same lane rather than against a historical baseline.

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
It is exposed as the `research-entity:merge-eponymous-fra` stage, wired into the `development-full` post-run pipeline before `visibility-gate` and `search-rebuild`, so the student-visibility gate and the search index evaluate the merged canonical.
The sibling accountless-researcher-shell dedupe stage (`researchers:dedupe-accountless-shells`) runs by default immediately before this FRA merge so same-name researchers are unified before entities are merged; disable it with `SCRAPER_SWEEP_DEDUPE_RESEARCHERS=0`.
That stage ranks same-name researchers by identity strength (account-linked, then `identifiers.netid`-backed, then name-only) and folds each researcher into the single strongest same-name researcher that outranks it, so a netid-backed accountless researcher is itself a canonical merge target for name-only shells while still folding into an account-linked canonical.
A fold is refused when the two sides carry different ORCIDs or different netids (`ORCID_CONFLICT`, `NETID_CONFLICT`), when two equally strong candidates share the name (`AMBIGUOUS_MULTIPLE_CANONICAL`), or when nothing outranks the researcher (`NO_CANONICAL`).

The stage runs by default on the two exhaustive Development modes so the Dev pipeline auto-merges every run.
Disable it by setting `SCRAPER_SWEEP_AUTO_MERGE_FRA` to a falsey value (`0`, `false`, `no`, `n`, `off`, `disable`, or `disabled`) in the sweep environment; the post-run stages never run on Beta or Prod sweeps, so those paths are unaffected.

The stage is scoped and capped, not a full-corpus scan.
It merges only PIs whose entities were materialized during the current sweep (`--since <sweep start ISO>` resolves the affected entities via `lastObservedAt`, then their PI role assignments), and `--max-merges` (default 250) bounds the number of merges applied per run, deferring any overflow to a later sweep.
Each run emits a merge-delta summary into the sweep report (`postRun.stages[].mergeDelta`): the FRA-to-lab pairs merged, the planned, applied, and cap-deferred counts, and a center-guarded PI count.

The stage is idempotent.
The scope loader excludes archived entities, so a merged shell never re-enters the plan, and `materializeEntity` short-circuits (skipped `merged-into-canonical`) when it re-resolves an archived shell that carries a `canonicalGroupId`, so re-scraping the shell's source never re-activates it or re-indexes it into Meilisearch.
A second sweep pass over the same data therefore performs zero additional merges and leaves the archived shell archived.

## Automatic URL-identity dedupe in the sweep

The `--profile-lab-url-only` lane can also run automatically inside the scraper sweep as the `url-identity-dedupe` stage (`research-entity:dedupe-by-pi --profile-lab-url-only --apply --confirm-research-entity-pi-dedupe --limit=10000 --max-apply=<max>`), wired into the `development-full` post-run pipeline after `eponymous-fra-merge` and before `visibility-gate` so the gate and search index evaluate each surviving canonical.
It runs by default on the two exhaustive Development modes, like its sibling reconcile stages, and is disabled by setting `SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES` to a falsey value in the sweep environment (the accepted values are the ones shared by every sweep stage flag, see [`docs/research-data-pipeline.md`](./research-data-pipeline.md)).
Beta and Prod sweeps are unaffected regardless of the flag, because `resolveDevelopmentPostRunOptions` returns no options for any non-development mode, so the entire development post-run set is unreachable there.
`--max-apply` defaults to 500 (overridable per run) so the stage is capped rather than a full-corpus rewrite.
On this lane the cap trims rather than aborts: the plan is truncated at the first group that would exceed the budget, the remainder is reported as `deferredByCapGroups`, and the next run re-plans it.
Truncation is keyed on the lane rather than on the sweep, so a manual run of either unattended lane also trims to its `--max-apply` instead of refusing an over-budget batch, and it is computed for dry runs too, where `--max-apply` falls back to its parse default of 10.
Read `deferredByCapGroups` in a dry-run report as "would be deferred at this budget" rather than as work the run left behind, and pass the batch size you intend to apply when you want the cap counts to describe a real apply.
Every other lane keeps the hard stop, because an operator who names `--max-apply` for a one-off run wants to be told the batch is larger than expected rather than have it silently split.
Because every lane merges never-demote (see [Lane-agnostic refusals](#lane-agnostic-refusals) above), the sweep can collapse URL-duplicate homes without any risk of dropping a `student_ready` lab out of student view.

The stage declares a typed result contract, so its counts land in the sweep's `summary.json` as `urlIdentityDedupeDelta`, which owns the field list for every reader: candidate, planned, and deferral-adjusted applied groups, archived and deleted rows, groups deferred by the never-demote guard, groups deferred because a swap would move a pinned canonical, groups deferred by the cap, the same-name and multi-person quarantine counts, groups quarantined by the person-profile conflation refusal, the visibility and canonical-index resync counts, and the `--max-apply` budget the run used.
A run that exits 0 without writing a readable, valid `development-url-identity-dedupe.json` carrying that delta is recorded as failed rather than quietly succeeding.

### The websiteUrl key is a second stage, not a wider regex

A URL identifies an entity by two different shapes, so the sweep runs two stages rather than one lane with a looser key.
`url-identity-dedupe` keys on a Yale `/lab/<x>` or `/profile/<x>` PATH, which cannot express a lab that lives on its own domain, and `website-url-identity-dedupe` (`research-entity:dedupe-by-pi --website-url-only --apply --confirm-research-entity-pi-dedupe --limit=10000 --max-apply=<max>`) keys on the whole normalized `websiteUrl`.
Both are gated by the single `SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES` flag, both trim to `--max-apply` rather than failing the sweep, and both emit `urlIdentityDedupeDelta` under the same #2050 contract; the second writes `development-website-url-identity-dedupe.json`.
The second stage exists because the first could not reach the defect it was assumed to cover: #2581 reported researchers served twice under a byte-identical custom lab domain, and measurement found that none of the 18 `websiteUrl` identity keys shared by more than one served row matched the path lane's loader at all, so no plan-time refusal was ever consulted.
When a shared-URL duplicate is not being collapsed, check the loader's key before reading the refusal arms: a lane that never selects a row reports no refusal for it, and 0 candidates reads exactly like 0 defects.

It was opt-in from #2070 until #2699, pending Dev validation.
That validation measured 316 candidate groups on the `profile-lab-url` key, of which 70 planned and 68 merged (74 rows archived) with zero same-name-different-person and zero multi-person quarantines; the remaining 2 groups were deferred by the never-demote guard at best input tier `student_ready`.
Re-reading the served surface afterwards, Development `studentReadyNotArchived` rose from 3111 to 3116 and the stored 92-slug served baseline was identical before and after, so collapsing URL duplicates raised student-ready coverage and regressed no served row.
A deferred group re-plans on every subsequent run, because the plan builder does not exclude it, so a small planned-but-inert tail is expected rather than a sign the stage failed.

## Durable canonical redirect (permanent, delete-safe merge)

Every merge stamps the collapsed shell with `canonicalGroupId`, pointing at the survivor. That archived row IS the durable mapping (#3027): its slug keeps occupying the unique index so a re-scrape of the still-live source cannot re-mint the duplicate, and the materializer follows the tombstone to write that evidence into the survivor. The separate `research_entity_redirects` ledger it used to also write was retired.
Because this mapping lives in its own collection rather than on the shell row, it survives deletion of the shell.
The redirect is written from the shared merge primitive (`applyResearchEntityDedupeMergeGroup`), so both the pipeline stage and the manual `research-entity:dedupe-by-pi` CLI produce it, and re-recording the same merge upserts the same row (keyed on the globally unique `mergedSlug`), so it stays idempotent.

`materializeEntity` consults the redirect before minting: when a re-scrape resolves a source whose slug or original id has a redirect, it resolves straight to the live canonical entity, following `canonicalGroupId` and redirect chains, and materializes the observations into the canonical rather than re-creating the shell.
This resolution works whether or not the shell row still exists, which makes the merge permanent and lets the shell be deleted safely.
The redirect supersedes the archived-tombstone resurrection guard for the redirected case; the tombstone guard still covers pre-redirect merges whose shells are only archived.

Ambiguous, non-eponymous same-PI clusters are never auto-selected here and continue to rely on the manual review workflow and the gate's existing `duplicate_risk` suppress-in-place fallback.
That fallback is not unconditional suppression: when such a cluster is also joined by a shared-URL duplicate group and every member is held, the gate withdraws the duplicate reasons from one member so the cluster keeps a student-visible card - see [`student-ready-definition.md`](student-ready-definition.md) for the reconciliation rule.

## Deleting inert merge residue

`research-entity:cleanup-archived` physically deletes an archived row, and every arm of its plan is fail-closed.
A candidate that fails any arm is deferred with a reason rather than deleted, and the reasons are `has_live_references`, `merged_shell_is_canonical_mapping`, `retired_entity_type`, and `sole_surviving_record_of_slug`.

`has_live_references` defers a row still referenced across signals, `role_assignments` `target.id`, relationships, members, scholarly links, canonical children, or observations.

`merged_shell_is_canonical_mapping` defers a row carrying a `canonicalGroupId`, and it defers every candidate in `--merge-residue-only` mode (#3027).
A merged shell is the canonical mapping: its slug occupies the unique index so no re-scrape can re-mint the duplicate, and its `canonicalGroupId` routes that re-scraped evidence to the survivor.
A tombstoned shell is therefore never deletable, whatever a redirect row says, which also means `--merge-residue-only` deletes nothing at all.

`retired_entity_type` defers any archived row whose `entityType` is no longer in `researchEntityTypes`, in every mode rather than only `--merge-residue-only`, so this command cannot complete a hard deletion that a retirement operation deliberately declined (see the 2026-08-28 entry in [`decisions.md`](decisions.md)).

`sole_surviving_record_of_slug` defers a row carrying no `canonicalGroupId` (#2795, re-keyed by #3027).
This arm used to be the fail-open one, and it used to demand a `research_entity_redirects` row; that ledger is retired, so the condition is now the thing it was standing in for.
A row with no tombstone has nothing routing its slug, so it is the only surviving record of what that slug was, and its name, citations and description are the material anyone would need to work out where it should point. Deleting it converts a fixable 404 into a permanent one.

Taken together the two arms mean **no archived row is deletable**, and `eligibleCount` is 0 by construction rather than by corpus accident. #3062 already measured 0 on Development before this change. A future genuine deletion needs its own explicit safety argument, not a loosened arm.
Measured on Development over 3,948 archived rows, that arm was the whole default-mode blast radius: 194 rows were `eligible` before the fix and all 194 now defer under `no_surviving_redirect`, leaving `eligibleCount: 0`.
Nothing on Development is deletable today, because a row with a surviving redirect and no tombstone does not currently exist there.

The redirect row is preserved on delete, so a later re-scrape still resolves the source to the surviving canonical through `materializeEntity`.

The command is report-only by default; applying requires `--apply --confirm-archived-entity-cleanup`, an explicit `--limit`, and a `--max-apply` bound, and is env-gated Dev-first through the same `assertScriptApplyAllowed` guard.
In the sweep, the `archived-cleanup` stage (`research-entity:cleanup-archived --merge-residue-only --limit=5000`) runs after the FRA merge stage and, on the two exhaustive Development modes, switches to apply mode (`--apply --confirm-archived-entity-cleanup --max-apply=5000`) by default so the Dev pipeline deletes inert residue every run.
Disable the delete by setting `SCRAPER_SWEEP_DELETE_MERGE_RESIDUE` to a falsey value (`0`, `false`, `no`, `n`, `off`, `disable`, or `disabled`); the post-run stages never run on Beta or Prod sweeps, so those paths only ever report merge residue.

## Environment order and production

Development and Beta are the review environments.
A production run uses the same command under `SCRAPER_ENV=production` and `CONFIRM_PROD_SCRAPE=true`, and only inside a promotion lane that has recorded a fresh Atlas restore point.
Rollback for archive-mode dedupe is unarchiving the affected duplicates and clearing their `canonicalGroupId`, or restoring the target database from the pre-run backup for delete mode.

See the promotion lanes and copy-set details in [`scraper-deployment-runbook.md`](scraper-deployment-runbook.md) and the control-plane repair posture in [`research-data-pipeline.md`](research-data-pipeline.md).
