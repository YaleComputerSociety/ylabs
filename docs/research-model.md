# Research Model

Status: current runtime model.
This document is the single source of truth for collection shapes and product-model state.
Design rationale, sequencing decisions, and the phased migration history that produced this model live in [`research-model-refactor.md`](./research-model-refactor.md) (historical decision record) and [`research-model-refactor-phase0.md`](./research-model-refactor-phase0.md) (Phase 0 inventory runbook).
Where an older note, issue, or skill still describes `Person`, `ResearchGroup`/`ResearchGroupMember`, `FacultyMember`, `Paper`/`PaperAuthor`, `EntryPathway`, `ContactRoute`, `PostedOpportunity`, an embedded roster or `discovery` blob, or the legacy access booleans (`acceptingUndergrads`/`openness`/`acceptanceConfidence`/`opennessSignals`) as active, this document wins.

Direction note (see [`decisions.md` 2026-08-25 "Simple Directory First"](./decisions.md#2026-08-25-simple-directory-first-signals-are-factual-enrichment-not-an-access-plausibility-tier)): the access-plausibility tier is being retired in favor of factual, non-gating signals shown as plain badges.
Slice 1 has landed: the `accessAcceptanceLevel` grade, the browse trust filter it fed, and access-based browse ranking are removed - signals no longer score or rank access, and visibility is unchanged.
The `REACH_OUT_PLAUSIBLE` style plausibility signals and the "Ways in" / "Evidence" / best-next-step framing still exist in runtime and are retired in later slices; update those sections only when their removal lands, not ahead of it.

## What This Solves

The main problem is making Yale labs and other research homes discoverable, and improving the scraped data and the scrapers that produce it.
The product is an evidence-driven research database: read-only scraped data plus private student planning, with no professor or student write or marketplace surfaces.
The student job-to-be-done is to discover a research home, then cold-email the professor via the official profile or lab page.
Yale Research surfaces, per research home, the PI, the official Yale profile and lab website, a clear description, exposed sources, and evidence tags (for example "has hosted undergrads before").
Judge every model change by whether it improves discoverability or data quality.

## Canonical Collections

Eight live collections carry runtime research data.

### `Researcher` (`researchers`)

Public research identity, and a first-class findable entity in its own right: a grad student, PhD student, or researcher is findable even with no lab.
[`server/src/models/researcher.ts`](../server/src/models/researcher.ts) defines `displayName`, an optional `accountId` link to the private login principal, `profileLinks[]` (`kind`: `YALE_OFFICIAL` | `LAB_ABOUT` | `PERSONAL_ACADEMIC` | `GOOGLE_SCHOLAR` | `ORCID`, each with `url`, `verifiedAt`, and `healthStatus`), an optional `identifiers.orcid` and `identifiers.netid` (the netid disambiguation spine), a `profile` display projection (`title`, `primaryDepartment`, `imageUrl`, `websiteUrl`), `status` (`ACTIVE` | `DEPARTED` | `UNKNOWN`), and `archived`.
`Researcher` rows are created only from Yale-confirmed evidence; an external identifier such as ORCID never creates one by itself.

`identifiers.netid` holds the account's own netid, not whatever a source called a netid (#2325).
A department roster publishes the friendly email alias (`corey.ohern`) rather than the netid (`co54`), and that alias passes the netid shape test, so `materializeUser` resolves identity by netid first, then by display name, then by the observed email, and last by the official profile page the observation cites.
The engine reports which of the four reached the person as `identityJoin` on its result, so a lane can select the rows one join is responsible for instead of restating this precedence; re-deriving the order outside the materializer is how a lane comes to disagree with the engine about who is reachable.
The email join runs last of the two account joins on purpose: it is a gap-filler, not an authority.
On Development it reaches 177 observation keys nothing else reaches, but it also disagrees with the name resolver on 12, and one of those (`patricia.ryan-krause@yale.edu`) points at an account belonging to a different person, so letting the email overrule a name would graft one researcher's evidence onto another's record.
Three guards keep it a gap-filler: it runs only when neither the netid nor the name reached anything, only when exactly one live (non-archived, non-`DISABLED`) account claims the address, and, when the observation carries a display name, only when that name agrees on surname and given name with the researcher the account already backs.
A nameless observation still joins, since the roster rows this reaches often publish an address and a title but no name, and an email-only join therefore enriches the profile but never renames the researcher.
`identifiers.netid` is stamped only from the account the researcher is actually linked to, so an accountless match stamps nothing rather than promoting an alias to a join key.
That rule bounds which value may be stamped, not which values exist: an `Account` upserted by `resolveOrCreateAccountId` from a scraped `netidFromEmail` value holds that email local part as its own netid, which is why 190 researchers hold a dotted one and why it is a live join key rather than a policy violation ([`research-data-pipeline.md`](research-data-pipeline.md) carries the #2831 measurement and the reason correcting it is net-negative).
The one addition (#2799) is a researcher minted from a PI attribution whose key carries a roster email alias: the stamp comes from the netid that a `yale-directory` `user` observation already used as its own entityKey for that email, resolved via `netidForRosterEmailAlias` and refused when one alias reaches two netids.
That is still not the alias becoming a join key, because the value stored is the person's own netid as the directory recorded it, and the mint would otherwise leave a person no lead lane can resolve back to.
Two corrections to that resolution came out of #2810, both of which had made the stamp useless rather than wrong.
A `user` observation is keyed `netid:<value>`, so the netid must be read from inside the key; taking the key verbatim stamped `netid:<alias>`, which every reader looks up as a bare netid and so matched nobody, on 192 Development rows.
And the directory publishes the alias in its own netid field for 9,628 of 18,397 live email observations, so an alias frequently reaches its own record: a candidate equal to the alias is dropped, which both stops the alias becoming a join key and lets one person's alias-keyed and netid-keyed records resolve instead of failing closed as two matches.
Equality with the alias is the test rather than the alias shape, because 170 accounts hold a netid containing a dot.
A malformed stored value is re-resolved and dropped when it resolves to nothing on the next materialization of that researcher, because these rows carry no account and nothing else would restamp them.
A mint over a netid another `Researcher` already holds is refused rather than adopted: that path runs only when the name resolver reached nobody, and it excludes archived rows while the unique index does not, so the claimant is one the name resolver deliberately passed over.
Like `identifiers.orcid`, `identifiers.netid` carries a unique sparse index, so a netid another `Researcher` already holds yields to that holder: the enriched researcher keeps the netid it already had, the rest of its profile still lands, and the collision is counted as a materialization conflict and logged instead of failing the key.
5,053 of the 11,949 person-observation keys carrying a live `profileUrls` observation still resolve to no researcher, measured by running the engine itself in dry run (#2325).
The largest prefix is `netid:` (3,575), not `dept:` (1,427), and the split by cause is what decides whether any of it is actionable: 2,868 are resolver-`absent`, so no researcher of that surname exists and the #2129 refusal to mint a bare directory identity is the whole answer; 2,062 are `ambiguous`; and 119 carry no display name for the resolver to read.
It is also largely not a served-row question. 4,954 of the 5,053 name a person who appears on no `student_ready` row at all, against 73% of the keys that do resolve, so this population sits off the student-facing surface rather than degrading it, and joining harder is not what shrinks it.
The official-profile-page join is the last resort, and it exists because most people the materializer sees have no `Account` at all: accounts are created only at login, so neither the netid lookup nor the email join can reach them and resolution falls to the name.
On Development the name resolver then returns `ambiguous` for 2,062 of the 5,053 keys it cannot resolve, meaning the corpus holds same-surname candidates and correctly refuses to guess.
#2927 measured what loosening the comparator would cost and closed as disproven, so the tie is broken with a per-person identifier rather than a looser name: a `yale.edu/people/…` or `/profile/…` page belongs to one person, and a live researcher already carrying it as a `YALE_OFFICIAL` link is usually the same person reached earlier under a different entityKey whose alias key stranded the rest of the evidence.
Only `YALE_OFFICIAL` counts. `LAB_ABOUT` names a lab a whole group shares and `profile.websiteUrl` can hold the same borrowed lab URL, so neither identifies an individual.
The join reaches 63 keys on Development, 48 of them ties the name resolver refused, and it fails closed on the two shapes that would graft: a page more than one live researcher carries, and an observed name that contradicts the page's owner (113 keys).
Like the email join it fills only, never overrules, and never renames the researcher, because the page vouched for which person this is rather than for what that person is called.
It matches the stored link on host and path rather than the literal string, so a scheme, a `www.` label, a trailing slash or a tracking query does not hide a researcher who already carries the same page.
`observations:materialize-profile-page-joined-users` re-offers stored evidence to the join, because the join otherwise fires only while a scrape ingests `user` observations.

`profileLinks[].healthStatus` is a probed fact, not a default (#2292).
`yarn --cwd server researchers:verify-official-profile-links` walks each `YALE_OFFICIAL` link grouped by department host, probes it through the SSRF-guarded `checkSourceLinkHealth`, and records `HEALTHY` or `UNAVAILABLE` with a fresh `verifiedAt`; [research-data-pipeline.md](research-data-pipeline.md) owns its invocation and apply guards.
Only 404 and 410 settle a link: a 403, 429, 5xx, or transport failure means the department site would not answer us, so the run stamps a fresh `verifiedAt` but writes no health status, leaving the stored verdict alone, because `UNKNOWN` is the absence of a probed fact and writing it would un-retire a page an earlier probe already proved gone.
When a link is proved gone the lane probes replacement candidates in trust order (an observed same-slug URL, then an observed same-host page whose slug names the same person, then the `/profile/<slug>` twin of the dead path, then its `/people/<slug>` twin, and last `/profile/` and `/people/` pages named after the person rather than after the dead slug) and adopts one only if it too probes live, which is how a department re-slug (`/people/douglas-stone` becoming `/profile/a-douglas-stone`) is followed.
The reverse-section and name-derived candidates carry the cases the dead slug alone cannot reach (#2307): a department that moved someone the opposite way to the usual migration (`ysph.yale.edu` moved a professor from `/profile/<slug>` to `/people/<slug>`), and a stored slug that never named the person (`politicalscience.yale.edu/ian-home`).
Both of those constructed candidates must still pass the same person-page name check an observed candidate passes, because a display name that leaked a roster label ("Primary Faculty") would otherwise mint a live `/people/primary-faculty` roster page and get it stamped `HEALTHY` on the researcher.
Matching a slug to a person needs surname equality plus a given-name token that is equal or an enumerated short form, so a nickname page (`philip-gorski` published as `phil-gorski`) is followed while a look-alike is refused (#2308, #468).
The short forms are a curated list rather than a rule, because every general rule also claims a same-surname colleague: a prefix rule reads `sara`/`sarah` and `alex`/`alexandra` as one person, and a first-letter rule lets `a` stand in for `alison`.
An unlisted short form therefore loses a repair, which is the safe direction for a lane that overwrites a served identity link.
Person pages are read from `/people/<slug>`, `/profile/<slug>`, `/person/<slug>`, section-nested `/people/<section>/<slug>`, and the nested CMS profile `/<section>/profile/<slug>` that `supersedesOfficialProfileUrl` already treats as canonical (#2310).
That wider reader is deliberately separate from `personProfileNameTokensFromUrl`, which gates a materializer check on whether a field came *only* from person-profile pages; widening the gate would change which fields that check suppresses.
A link left `UNAVAILABLE` is withheld at serve time, so an entity page falls back to the person's website rather than offering a 404.
This probe lane is the safety net behind the cheaper sweep-time rule in the materializer (#2290), which upgrades a stored link when the same host is *observed* publishing the person on its canonical `/profile/<slug>` page and needs no network call.

### `Account` (`accounts`)

The private login principal: the student or user who logs in.
[`server/src/models/account.ts`](../server/src/models/account.ts) defines `netid` (unique), `email`, `status`, an optional `lastLoginAt`, an optional descriptive `profile` (name, `userType`, faculty title/department or student college/year/major) persisted from the Yalies/Directory record at login, and `archived`.
Authentication is wired onto `Account` (#367): CAS, dev-login, and the local bypass resolve-or-create an `Account` by netid and stamp `lastLoginAt`.
The legacy `User` model has been retired (#2014): no runtime code reads or writes `User`, and identity lives entirely on `Account` (login) plus `Researcher` (public identity).
Dropping the now-orphaned `users` collection is a separate, human-gated database cleanup.
See [Legacy `User` Retirement](#legacy-user-retirement).

### `ResearchEntity` (`research_entities`)

The lab, center, institute, or faculty project: the discovery center.
[`server/src/models/researchEntity.ts`](../server/src/models/researchEntity.ts) is a clean schema (not the retired `researchGroupSchema`).
Its roster is **not** embedded: membership lives in canonical `RoleAssignment` rows joined to `Researcher` (see below).
Core fields include `slug`, `name`, `entityType` (see `researchEntityTypes` in [`researchAccessTypes.ts`](../server/src/models/researchAccessTypes.ts): `LAB`, `CENTER`, `INSTITUTE`, `FACULTY_RESEARCH_AREA`, `FACULTY_PROJECT`, `INITIATIVE`, `CORE_FACILITY`), `shortDescription`, `fullDescription`, `websiteUrl`, `sourceUrls[]`, canonicalized `school`/`schools[]`/`departments[]`/`researchAreas[]` strings, search-only `orgAffiliationLabels[]`, a computed `browseRankScore`, `rosterEnrichment` freshness/state metadata, `studentVisibilityTier` fields, and `archived`.
It does not carry an embedded `discovery` projection blob, embedded access booleans, embedded contact fields, or a paper cache.
Legacy `description` is retired (#351): `shortDescription`/`fullDescription` are the sole canonical prose pair.
The legacy `kind` field (migration residue from the retired `ResearchGroup` model) is no longer an independent taxonomy: the materializer deterministically derives it from the canonical `entityType` via `mapEntityTypeToResearchGroupKind` (#2144), and `research-entity:resync-kind` backfills historically drifted rows.
The derivation is lossy wherever two legacy kinds shared one entity type: a stored `program`, `group`, or `solo` row resolves to `initiative`, `initiative`, or `individual` respectively, and no surviving `entityType` derives `program` or `group`, so those two kinds are reachable only as stored legacy values.
The collapse is pinned in [`researchAccessModels.test.ts`](../server/src/models/__tests__/researchAccessModels.test.ts).
The derivation is enforced in the scraper projection rather than in the schema, so every other writer must set the pair together (`researchGroupService` and the entity-type consolidation script already do); a direct `$set: { entityType }` elsewhere would reintroduce drift.
Two escapes are deliberate: an operator lock on `kind` still wins over the derivation, and an entity with no recognizable `entityType` has no derivable kind, so `kind` observations still classify it at mint time.
Classify a research home by observing `entityType`: a source that observes only `kind` cannot correct an entity another source already minted under a different `entityType`.

### `RoleAssignment` (`role_assignments`)

The person-to-research-entity membership edge (the roster); replaces the retired `ResearchGroupMember`.
[`server/src/models/roleAssignment.ts`](../server/src/models/roleAssignment.ts) defines `personId` (a `Researcher` reference), `target` (`{ kind: 'RESEARCH_ENTITY' | 'ORG_UNIT', id }`), `role` (`PI` | `CO_PI` | `DIRECTOR` | `CO_DIRECTOR` | `CORE_FACULTY` | `AFFILIATED` | `STAFF` | `POSTDOC` | `GRADUATE_STUDENT` | `UNDERGRADUATE`), `state` (`CURRENT` | `HISTORICAL` | `UNKNOWN`), `reviewStatus`, `confidence`, and a bounded `rosterProvenance` subdoc (source name/url, profile url, section label, evidence status, membership key, observed and freshness-expiry timestamps) that feeds the roster-freshness disclosure.
`evidenceClaimIds` stays empty while the evidence claim-graph is frozen (see [Frozen Evidence-Claim Scaffolding](#frozen-evidence-claim-scaffolding)).
`reviewStatus` is `UNREVIEWED` on effectively every lead assignment, so `DISPUTED` is how an adjudication is recorded: `role-assignments:retire-surname-clash-lead-grafts` ([`retireSurnameClashLeadGrafts.ts`](../server/src/scripts/retireSurnameClashLeadGrafts.ts), decision in [`retireSurnameClashLeadGraftsCore.ts`](../server/src/scripts/retireSurnameClashLeadGraftsCore.ts)) archives a lead of one surname on an entity whose own identity tokens name a different person of that surname, and marks it `DISPUTED` rather than deleting it.
The arbiter there is the entity's identity, never `confidence` (anti-correlated on both rows with ground truth: 0.9 on a wrong lead against 0.78 on the right one) and never mere `rosterProvenance` presence (absent on 974 of 3,009 served sole PIs who are correct), and an entity whose identity names two of the clashing people is a name-variant merge rather than a graft, so it is left alone (#2768).
A candidate assignment whose own `rosterProvenance.evidenceStatus` is `verified` is also left alone, because the entity's own official roster page listed that person and a genuine same-surname co-lead is otherwise indistinguishable from a graft.
That corroboration is read per assignment rather than per person, because `rosterProvenance` is a property of the edge, so a second lead row for the same person is judged on its own evidence.
The mark is not yet durable against re-observation: `buildCanonicalRoleAssignmentUpsert` ([`canonicalMembershipMaterializer.ts`](../server/src/scrapers/canonicalMembershipMaterializer.ts)) keys on `personId` plus `target` plus `role` with no `archived` or `reviewStatus` term and unconditionally sets `archived: false` and a fresh `reviewStatus`, so a later scrape of the same edge reattaches it and leaves only the `reviewNotes` behind.
Re-read the served roster after a scrape before treating a detach as settled.
Read via `getResearchEntityRoster`/`getResearchEntityRosterByEntityId` in [`researchEntityMembershipAccessor.ts`](../server/src/services/researchEntityMembershipAccessor.ts) (joins `Researcher`).
The continuous canonical materializer write path (`entityMaterializer.ts`) is the sole roster write path (#353, #361): it resolves a scraped person name to a canonical `Researcher` via `resolveResearcherIdForPersonName` in [`researcherPersonNameResolver.ts`](../server/src/services/researcherPersonNameResolver.ts) (netid to `Researcher.identifiers.netid`, else netid to `Account` to `Researcher.accountId`, then a surname-plus-given-name match against `Researcher.displayName`, returning `absent`/`ambiguous`/`matched` and failing closed rather than merging distinct identities) before writing `RoleAssignment.personId`, so freshly scraped PIs, members, and departures surface immediately without waiting for a batch.

### `Signal` (`signals`)

One extensible, source-attributed, typed fact about a research entity.
[`server/src/models/signal.ts`](../server/src/models/signal.ts) generalizes and absorbs the retired `AccessSignal` and `UndergraduateLogisticsClaim` models.
Fields: `researchEntityId`, `type` (see `signalTypes` in [`researchAccessTypes.ts`](../server/src/models/researchAccessTypes.ts)), `value?`, `confidence?`/`confidenceScore?`/`status?`, `expiresAt?`, `source` (`name`, `url`, `evidenceIds[]` referencing `Observation`, `excerpt`), `observedAt`, `review`, and `archived`.
Access evidence keeps per-signal granularity: each former `AccessSignal` type (`POSTED_OPENING`, `CURRENT_UNDERGRADS`, `NOT_CURRENTLY_AVAILABLE`, and so on) is its own `Signal.type`, so the per-type confidence gradient is preserved rather than collapsed into one value.
The five undergraduate-logistics claim types that also lived here are retired (#3088), so `signalTypes` is now exactly `accessSignalTypes`.
Future metrics (wet or dry lab, safety level, and similar) are new `type` values, never new collections.
Signals stay independent and neutral when unknown; materializer logic must not cross-infer one type from another.

### `ResearchEntityRelationship` (`research_entity_relationships`)

Source-backed affiliations between research entities (the "Affiliated with" surface), keyed by `sourceResearchEntityId` (the center, institute, or umbrella entity) and `targetResearchEntityId` (the member lab, faculty research area, or project).

### `Observation` (`observations`)

Raw, append-only scraped evidence; the substrate that feeds the confidence resolver and materializes into `Signal` and `RoleAssignment`.

### `ResearchPlan` (`research_plans`)

Private student saved planning, keyed on `accountId` plus a target (`{ kind: 'RESEARCH_ENTITY' | 'PROGRAM', id }`).
The saved-research and program-watch routes read and write `ResearchPlan` through `researchPlanService` at runtime (PR #484 / commit `34b9fd7e`).
With the `User` model retired (#2014), no embedded planning fields remain in code; any legacy `savedResearchEntities`/`savedPrograms` values that survive only in the orphaned `users` collection are covered by the human-gated #725 data backfill onto `ResearchPlan` before that collection is dropped, not an open design question.

A plan outlives its target, and the target's visibility is not the plan's to decide, so `/users/savedResearchEntities` returns two lists: the servable summaries, and `unavailableSavedResearchEntities`, one `{ _id, reason }` row per saved plan the first list cannot show.
`REMOVED` means no `ResearchEntity` carries that id and the owner's only move is to remove the plan; `UNAVAILABLE` means the record exists and is archived, held by the visibility gate, or failing the public-description invariant, any of which a repair or a re-gate reverses, so the plan and its private notes are kept.
Only the id and the reason are reported, never the record's name or copy, because the gate exists to keep exactly that text away from a student, and the owner already holds the id.
Before #2174 both classes were dropped from the payload and from the saved count, so a student could not tell an item they had removed from one the corpus had stopped serving; 4,907 of 8,281 research-entity records sat in a state that would drop a saved plan that way when measured on 2026-09-22.
The dashboard count is the number of plans the owner has rather than the number the list can render, so `SavedResearchPlans` reports `savedSlugs.length + unavailable.length`: counting only the servable half is what let the dashboard read "0 research plans" beside a notice about a plan it was holding back.
The notice copy claims only that the student directory is not listing the row, never that the research home cannot be opened, because this gate is name-agnostic while `getResearchGroupDetail` resolves lead names, and #2597 measured 3 tier-admitted rows that fail here yet serve their own detail page.
`REMOVED` promises nothing about the note: the plan row survives until the owner removes it, but with the target gone `getSavedResearchEntityPlans` has no servable summary to key it to, so no surface can read that note back.
A dedupe merge is the one removal path that relinks plans itself (`applyResearchEntityDedupeMergeGroup`), which is why repointing through the merged shell's `canonicalGroupId` tombstone is not a second mechanism here.

## Removed, Retired, And Frozen

Removed (do not model): `EntryPathway`, `ContactRoute`, `PostedOpportunity`, and the separate pathway search index and `/pathways`/`/opportunities/:id` surfaces (#362, #363).
`AccessSignal` is folded into `Signal`; `UndergraduateLogisticsClaim` was folded in and then retired outright (#3088).
The embedded `discovery` projection blob is removed; there is no persisted discovery cache.

Retired legacy models: `ResearchGroup` and `ResearchGroupMember` (superseded by `ResearchEntity` and `RoleAssignment`); `FacultyMember` (#366, folded into `Researcher`/`RoleAssignment` identity resolution, with no remaining runtime reader); `Paper` and `PaperAuthor` and their readers (#207 publication-mirror half, no rollback opt-in).
`MaterializedProvenance` was deleted as dead code (unattached, referenced only by its own test).
The `faculty_members` and `papers`/`paper_authors` collections are left in place pending a gated, human-approved collection drop tracked under #210's collection-drop scope; this is not imminent and code should not treat their presence as launch evidence.
Historical `paper` observations and source rows are retained as read-only archived evidence and are never materialized.

`Fellowship` is its own adjacent domain (the programs and funding page), not classified into the removed `EntryPathway`/`PostedOpportunity` concepts.
[`server/src/models/fellowship.ts`](../server/src/models/fellowship.ts) uses `programCategory` (`FELLOWSHIP` | `CENTER_INTERNSHIP` | `RECURRING_PROGRAM` | `SUMMER_RESEARCH_PROGRAM`), `programKind`, and `entryMode` enums, not a stored reference to any removed model.
The "program" split-brain is resolved: programs and fellowships live only on the `/programs` surface.
The Fellowship to `ResearchEntity` projection that mirrored each `Fellowship` into `/research` as an `RA_PROGRAM`/`FELLOWSHIP_PROGRAM` entity was removed, along with those two `entityType` values, the `/research` "Related programs & fellowships" cross-surface module, and the now-dead funding-program topic derivation that only enriched projected programs.
The `PROGRAM` `entityType` was then removed entirely (see `docs/decisions.md` 2026-08-26), so no program is a `/research` citizen: every program lives only on `/programs` (backed by `Fellowship`), and department "undergraduate research" pages materialize as `Fellowship` records rather than research homes.
Residual rows that still carried the retired type were archived rather than hard-deleted, and `entityMaterializer` now refuses the retired type at its entry, so a re-scrape neither mints a new `PROGRAM` entity nor resurrects an archived one (see `docs/decisions.md` 2026-08-28).

## Canonicalization

Departments and school: `OrgUnit` ([`server/src/models/orgUnit.ts`](../server/src/models/orgUnit.ts)) stays only as an ingest-time canonical lookup and seed (`name`, `slug`, `aliases[]`, `kind`, and `parentOrgUnitId` hierarchy), never a stored reference on `ResearchEntity`.
`ResearchEntity` stores the resulting canonicalized `school` and `departments[]` strings.
The catalog carries three academic altitudes, `SCHOOL` (or `DIVISION`) then `DEPARTMENT` then `SECTION`, because the School of Medicine states appointments at the section ("Section of Digestive Diseases, Department of Internal Medicine") and storing a section at the department kind made it a facet peer of its own parent.
A `SECTION` is facet-eligible, and every resolved section additionally rolls its ancestor departments into `departments[]` through `buildDepartmentAncestorMap`, the same parent-chain derivation `schools[]` already uses for the school above it.
That is what makes the parent department a property of the catalog rather than of the source string: 388 served rows carried a YSM section and only 323 also carried "Internal Medicine", so narrowing to the department dropped the other 65.
The rollup only ever appends, so it is idempotent, and it heals a stored row on any later materialize pass, including one that touched only `school`.
`org-units:reclassify-sections` is the one-time catalog correction that moved the twelve `DEPARTMENT` rows parented to another department onto the new kind; `research-homes:backfill-org-units` is the served-data half that adds the rolled-up parent to existing rows.
`org-units:seed-catalog-gaps` grows the catalog itself, and its `create-department` gaps take a `kind`, so a School of Medicine section (Surgical Oncology under Surgery, General Internal Medicine under Internal Medicine) is seeded at the section altitude rather than as a peer of its own parent.
Yale HR strings are added as verbatim aliases rather than taught to the denoiser: #2500 measured that stripping a leading all-caps token by rule was wrong every time it fired, and a bare alias would be worse, because "Cardiology" names both an Internal Medicine section and a Pediatrics one, so only the coded string ("MEDINT Cardiology") says which.

A catalog row on its own changes nothing a student sees, because it alters what a scraped string resolves to rather than what any served row stores.
`research-homes:inherit-lead-department` is the delivery half: it walks every live row missing a school or a department and calls the same `inheritSchoolFromLeadPi` the roster materializer calls, so a row materialized before its lead's department was known, or before that department was in the catalog, picks it up.
It reports the materializer's own skip reasons rather than one total, because "nothing changed" has distinct and differently-fixable causes, measured on Development after the section work: 44 rows inherited, 603 `no-department` (the corpus does not know the lead's department), 309 `no-single-lead` (there is nobody to inherit from), 46 `multi-pi-kind` (a centre or institute, where one PI's department is not the entity's).
Ingest maps a scraped department string to the canonical value by deterministic normalized-name plus alias match.
`entityType` is also a browse facet, the student-facing Type axis, and it needs no catalog because its values are a stored enum rather than an assertion about Yale's org chart; a row with no school is attributed by what it is rather than by a minted school label (#2195).
The axis accepts only the canonical enum, so a row still carrying a retired type from #2219 is findable and labelled on its own page but is not offered as a filter value.
`departments[]` is a browse facet, so it fails closed against the catalog: a value with no `DEPARTMENT`/`DIVISION` match is not published as a department, and moves to the search-only `orgAffiliationLabels[]` instead (#2194).
That field is the honest home for the centers, hospital systems, graduate program tracks, and societies a source lists beside an appointment; it is indexed for search but never facetable or filterable, and it is not a substitute for a first-class `ResearchEntityRelationship` when the affiliation is to a real research entity.
`school`/`schools[]` fail closed on the same grounds, because the school facet is the same kind of assertion about Yale's org chart and a campus ("Yale West Campus") or a center ("MacMillan Center for International and Area Studies at Yale") is not a peer of the School of Medicine (#2277).
An unresolved value is not published: it is cleared from `school` and `schools[]`, kept as search text in `orgAffiliationLabels[]`, and replaced wherever a canonical department's parent chain names a school, so the 13 rows carrying one publish a real school rather than leaving the facet once `research-homes:backfill-org-units` has run against Development.
`skills/scrapers/SKILL.md` owns the detailed fail-closed rules the canonicalization pass and its repair scripts follow.
Aliases grow from the review queue, and `org-units:department-facet-audit` ranks the remaining uncataloged labels by served-row count so the debt is measurable rather than silent.

Research areas: `ResearchEntity` stores canonicalized `researchAreas[]` strings, never `topicIds`/`methodIds` references.
`TaxonomyTerm` (`taxonomy_terms`, [`server/src/models/taxonomyTerm.ts`](../server/src/models/taxonomyTerm.ts)) is kept only as an ingest-time governed research-area canonicalization registry, with `kind` (`TOPIC` | `METHOD`) and `reviewStatus` (`UNREVIEWED` | `APPROVED` | `DISPUTED`).
This is the owner-approved "option A" resolution of #208 (delivered via #457): ingest canonicalizes each scraped area string against an approved `TaxonomyTerm` by deterministic normalized-name plus governed-alias match, and fails closed to the raw string plus review when no approved term matches, so a guessed grouping can never collapse two distinct topics.
Only `reviewStatus: APPROVED` terms canonicalize; seeded-but-unratified groupings stay `UNREVIEWED` and are inert until a human approves them, and aliases grow from that review queue, the same fail-closed pattern as `OrgUnit`.
A scraper-label stop-list drops non-topic extraction artifacts (section headers like "Research Areas:"/"Fields of Interest", role labels like "YSM Researcher"/"Theorist"/"Experimentalist", and publication chrome) at this ingest step so they never become areas.
Synonym and broader related-topic matching beyond governed aliases remains the job of semantic search, not this curated registry.

## Derived, Not Stored

Contact action: there is no `ContactRoute` collection.
The PI action is the official profile link-out from `Researcher.profileLinks` (`YALE_OFFICIAL`) or `ResearchEntity.websiteUrl`.
Scraped emails are never surfaced in a public payload; outreach happens off-platform via the official page.
This redaction is a projection rule, not a stored policy.

Discovery projection: there is no persisted `discovery` blob.
Mongo `ResearchEntity` is the source of truth; the Meilisearch `researchentities` index is the discovery and browse projection (a rebuildable cache); the detail page derives its view live.
`browseRankScore` is the one computed field kept on `ResearchEntity` for the index rebuild, with `services/researchEntityBrowseRank.ts` as its single recompute trigger.

## Archived Rows Store No Student-Visibility Verdict

`archived` is the repository's soft delete, and the student-visibility gate scopes its planner to live rows, so an archived row is never re-gated.
That made the stored verdict on an archived row permanent: it kept whichever `studentVisibilityTier`, `studentVisibilityComputedTier`, `studentVisibilityReasons` and `studentVisibilityComputedAt` it held when it was last seen, and nothing could ever withdraw them.
Nothing a student sees was wrong, because every serve path and every product aggregation filters `archived`, but a direct query grouped by tier over-reported: on Development 632 archived rows stored `student_ready`, every tier-less row in the corpus was archived, and the zero-hard-blocker held population read 708 counting all rows against 9 counting live rows (#2896).

The invariant is now that those four fields exist only on a live row.
Three things hold it:

- `server/src/models/entityArchival.ts` owns the shapes.
`archivedEntityUpdate(extra?)` is the one update document that archives a research row: it sets `archived: true` alongside whatever the calling lane records, and unsets the four verdict fields in the same write.
`LIVE_ENTITY_FILTER` and `liveEntityFilter(match?)` own the spelling of "live" (`archived: { $ne: true }`).
Operator intent survives archiving: `studentVisibilityOverrideTier`, `studentVisibilitySuppressionReason` and the reviewer fields are deliberately not cleared.
- `clearArchivedResearchStudentVisibility` in `studentVisibilityGateService.ts` runs inside `applyStudentVisibilityGatePlans`, next to the archived-queue reconciliation it already did.
There are roughly twenty sites that set `archived: true`, several through the raw driver on a collection name, so the gate apply is the backstop that reconciles any lane which archives a row and never re-gates it.
It is idempotent: once the corpus is clean its filter matches nothing.
- `yarn --cwd server research-entity:archived-visibility-verdicts` is the measurement.
Its dry-run prints every tier both ways plus the zero-hard-blocker held population both ways, and `--assert-clean` exits non-zero while the two readings disagree.
`--apply --confirm-archived-visibility-verdict-repair` repairs stored rows and re-reads the census afterwards.

A cleared tier reads as absent, so an unset `studentVisibilityTier` now means "archived" rather than "never gated".
Read never-gated as a live row with no `studentVisibilityComputedAt`; the census reports that count directly.

## Legacy `User` Retirement

The identity split is complete (#2014): the former `User` document is fully replaced by `Account` (the private login principal, keyed on netid) plus `Researcher` (the public research identity).
The `User` model, `userService`, `facultyResearcherProjection`, and the one-time `User` backfill/dedupe/hygiene/audit scripts were deleted; no runtime code reads or writes `User`.
Roster reads and writes resolve identity to a canonical `Researcher` directly (netid to `Researcher.identifiers.netid`, else netid to `Account` to `Researcher.accountId`, then name matching via `resolveResearcherIdForPersonName`), so public payloads and `RoleAssignment` rows are canonical.
Dropping the now-orphaned `users` collection is the only remaining step and stays human-gated; do not treat the collection's continued existence as a live runtime dependency.

Accepted operator inputs should prefer ORCID over Yale netid.
ORCID may enrich or disambiguate an existing Yale-confirmed `Researcher` (`Researcher.identifiers.orcid`), but ORCID must not create a Yale person record by itself.
`identifiers.orcid` carries a unique sparse index, so an ORCID belongs to exactly one `Researcher` row: a scraped or directory-sourced ORCID that another `Researcher` already holds yields to that existing holder, and the enrichment target keeps the identity it already had instead of the write failing the whole source run.
An ORCID identifier and its `ORCID` `profileLinks[]` entry always move together, so a stored ORCID link never points at a different ORCID than `identifiers.orcid`.
Netid is the internal disambiguation spine (`Researcher.identifiers.netid`, plus `Account.netid` for login) and should appear only as diagnostic or converted internal target data in accepted-input workflows.

Researcher dedupe note: scraper-created same-person `Researcher` shells are merged by rewriting active references onto the canonical `Researcher` and marking the duplicate with `archived` and `dedupedIntoResearcherId`.
Integrity scans should ignore archived shells.
Same-email rows with different names are a review queue, not automatic merge evidence, unless a reviewer confirms they are the same Yale person.

## Frozen Evidence-Claim Scaffolding

The heavy governed evidence claim-graph is deferred; the lightweight `Observation` to `Signal` (and `Observation` to `RoleAssignment`) pipeline covers the product.
`EvidenceClaim`, `SourceDocument`, and `ReviewDecision` exist as versioned, unwired, do-not-build-on schema contracts (Phase 1 foundation work): no current scraper or public read path writes or consumes them.
[`phase2IdentityMigrationPlannerCore.ts`](../server/src/scripts/phase2IdentityMigrationPlannerCore.ts)/[`phase2IdentityMigrationPlan.ts`](../server/src/scripts/phase2IdentityMigrationPlan.ts) produce a read-only, dry-run identity-reconciliation artifact (`model-refactor:identity-plan`) and never write canonical collections or redirect runtime readers.
None of these unwire until a later, separately gated cutover; do not build new runtime behavior on top of them.

## Canonical Schema Versions And Database Validators

Each canonical collection owns an independent positive integer `schemaVersion`.
New documents default to that collection's current version, while explicitly supported older versions remain readable during a bounded migration.
Collections must not share one lockstep application-wide schema version.
The shared version field and BSON property builders live in [`server/src/models/canonicalSchemaVersion.ts`](../server/src/models/canonicalSchemaVersion.ts).

MongoDB validator definitions use `validationLevel: moderate` and `validationAction: error` during migration so new conforming writes are protected without pretending that legacy documents were backfilled.
Moderate validation does not prove reference integrity, backfill missing versions, or make an old document canonical.
Validator plans must be deterministic, dry-run reviewable, and limited to an explicit desired collection registry.
The pure planner in [`server/src/scripts/canonicalMongoValidatorsCore.ts`](../server/src/scripts/canonicalMongoValidatorsCore.ts) does not connect to MongoDB or apply commands.
The guarded operator command compares current collection options, requires a reviewed dry-run artifact plus environment-bound confirmation before writes, and never runs during application startup.
Use the exact environment workflow and rollback guidance in the [`Canonical MongoDB Validator Runbook`](./canonical-mongodb-validator-runbook.md).

## 2026-05-13 External Yale Validation

Official Yale pages support the broader Yale Research model rather than a lab-opening-only product:

- Yale Admissions frames undergraduate research as cross-disciplinary and points to labs, professional schools, centers, museums, libraries, and fellowship funding as research infrastructure: https://admissions.yale.edu/research
- Yale College Science & QR says undergraduates access labs across Yale College, FAS departments, and professional schools, and that research can happen during the academic year or summer: https://science.yalecollege.yale.edu/yale-undergraduate-research/research-opportunities
- Department pages describe multiple ways a research relationship may be structured after a student finds a home: academic credit, work-study/pay, volunteer roles, summer RA work, direct outreach, and course-based directed research. Examples include Psychology directed research and undergraduate research FAQs: https://psychology.yale.edu/what-directed-research-course and https://psychology.yale.edu/what-undergraduate-research-opportunities-are-available
- Formal programs such as Tobin Undergraduate Research Assistantships behave like recurring programs with term-specific project/application instances, pay, hours/week, faculty sponsors, and deadlines: https://economics.yale.edu/undergraduate/tobin-ra
- Fellowship programs are not merely posted jobs. Most fellowships fund or formalize student-designed or mentor-supervised research and require proposal, mentor, eligibility, deadline, and application evidence; examples include Yale College Dean's Research Fellowship and Office of Fellowships programs: https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/yale-college-deans-research-fellowship and https://funding.yale.edu/find-funding/yale-fellowships-offered-through
- Some fellowships are closer to discovery programs. Women's Health Research at Yale says its Undergraduate Fellowship matches students with Yale faculty mentors, and Wu Tsai says undergraduates collaborate with Wu Tsai faculty members in a structured summer program: https://medicine.yale.edu/whr/training/fellowship/ and https://wti.yale.edu/initiatives/undergraduate
- Senior essay and thesis research is a formalization and planning route, especially in humanities and social sciences, with advisor choice, prospectus/deadline structure, course credit, funding, methods, and collection/archive support. Examples include Economics, History, Environmental Studies, and Yale Library's Senior Exhibit Program: https://economics.yale.edu/undergraduate/senior-essay, https://history.yale.edu/undergraduate/senior-essay, https://evst.yale.edu/evst-senior-essay, and https://library.yale.edu/senior-exhibit-program
- Museums, libraries, cores, and centers operate as research entities and access routes. Peabody internships, Yale Library undergraduate opportunities, Yale Center for Molecular Discovery internships, and the DHLab show collections, digital methods, curatorial work, consultations, and paid/mentored internships as legitimate research access routes: https://peabody.yale.edu/education/yale-community/internships, https://library.yale.edu/help-and-research-support/help/getting-started-yale-library/undergraduates, https://research.yale.edu/cores/ycmd/summer-internships-undergraduates, and https://library.yale.edu/digital-humanities-laboratory

Product implication: a single Yale page may describe a durable research entity, source-backed access evidence, a safe official-application or contact route, and a later formalization option all at once.
The current model expresses the entity as `ResearchEntity`, the access evidence as typed `Signal` rows, and the contact action as a derived official-profile link-out, so students can discover plausible homes without losing exploratory, thesis, fellowship-funded, structured-fellowship, course-credit, library, museum, and center-based research.

### Retired Legacy Faculty-Research Duplicates (#2219)

`INDIVIDUAL_RESEARCH` and `FACULTY_RESEARCH` were duplicates of `FACULTY_RESEARCH_AREA`: nothing minted them, and every consumer already treated the set as one thing.
They are gone from `researchEntityTypes` and from `EntityTypeToResearchGroupKind`, and `research-entity:consolidate-faculty-type` converts stored rows to the canonical type.

Read paths stay deliberately tolerant of the stored values, because an environment that has not run the consolidation still holds rows.
This is safe rather than merely lenient: `derivedResearchGroupKind` returns `undefined` for an entity type it does not recognize, so such a row keeps its stored `kind: 'individual'` instead of being reclassified as a lab, and `isFacultyResearchEntity` matches on that kind.
Retiring the type therefore stops new writes without changing how an unmigrated row renders.

### Retired Dead-End Entity Types (#2202)

`COLLECTIONS_INITIATIVE`, `ARCHIVE_OR_MUSEUM_PROJECT`, `DIGITAL_HUMANITIES_PROJECT`, `COURSE_SEQUENCE`, and `GROUP` were retired, along with the eight single-type scrapers that produced them.
They were lead-exempt on the theory that the entity itself is institutionally contactable, but measurement showed the opposite: 157 student-ready rows across those five types carried no lead, no roster, no affiliated-lab edge, and no contact email, so a student who opened one got a single outbound link and no next step.
`CORE_FACILITY` was kept on the same measurement because it routes to labs on 38 of 57 rows via `AFFILIATED_LAB` edges.

For-credit pathways are the clearest case.
A senior essay is done *in a lab*, so "you can do your senior essay here" is an attribute of a lab engagement, not a research home.
All 13 `CREDIT_FORMALIZATION_POSSIBLE` signals sat on the 13 `COURSE_SEQUENCE` entities themselves and not one lab carried the fact, while `COURSE_CREDIT_PATHWAY` (already in `accessSignalTypes`) had zero rows.
The durable direction is to emit course-credit signals onto the department's labs rather than to mint a policy page as an entity.

The retirement archived those 13 rows rather than deleting them, and it did not touch their signals, so as of 2026-09-22 the fact is orphaned rather than moved (#2214).
All 13 `CREDIT_FORMALIZATION_POSSIBLE` signals are still `archived: false` on 13 `archived: true` `COURSE_SEQUENCE` hosts whose `studentVisibilityTier` is unset, and `COURSE_CREDIT_PATHWAY` is still 0 of 11,945 stored signals.
The surface is reachable rather than dead: `getResearchGroupDetail` serves every `archived: false` signal whose `type` is in `accessSignalTypes`, and `COURSE_CREDIT_PATHWAY` is in that enum, so a row minted on a live entity would render on the detail page.
What is missing is an honest attribution, and the cheap version of it does not exist: attaching the fact only where the lab's own page corroborates it recovers **0 of the 449** live entities in the 13 departments those rows covered, against a control pattern that matches 2,961, so the smallest option is not a smaller version of the feature but nothing at all.
See `docs/decisions.md` for the recorded decision.

Under the organizational/program dead-end gate (issue #1359), a lead-exempt entity with no attached lead and no reachable alternate access path (a linked related entity or a discovered people/get-involved/programs/undergraduate-research/directed-research page) is still held at `operator_review` with `missing_alternate_access_path` rather than auto-published.

## Access Evidence (Formerly EntryPathway And PostedOpportunity)

`EntryPathway` and `PostedOpportunity` were removed (#363), along with the separate public practical-routes search endpoint/page and the `/api/opportunities/:id` detail surface.
Ways-in and posted-opening evidence is now expressed as typed access `Signal` rows (for example `POSTED_OPENING`, `CURRENT_UNDERGRADS`, `REACH_OUT_PLAUSIBLE`, `NOT_CURRENTLY_AVAILABLE`), anchored to `researchEntityId` and projected through the Yale Research surfaces as profile, evidence, and planning context rather than split into a second student product.
`NO_EVIDENCE` remains a computed state, not a stored fact, unless a source explicitly supports it.
Course credit, fellowship funding, and thesis advising remain formalization outcomes after home and mentor fit, not access evidence by themselves, unless a source describes a structured hosted or mentor-matching program that is its own `ResearchEntity`.

Yale Research does not host faculty-authored labs or opportunities.
Research homes and official application routes enter the product only through source-backed ingestion; there is no runtime faculty authoring surface.
The `Listing` product surface is retired. The `/api/listings` routes, listing controllers and services, claim requests, admin claim review, the detail-page claim panel, and the `listings` and `listingclaimrequests` collections are all removed. `models/listing.ts` survives only as an internal read model for the admin analytics aggregations, which are tracked for removal separately.

## Research Detail Projection

Discovery and browse run on the `researchentities` Meilisearch index; the detail page derives its view live from canonical `ResearchEntity` data. There is no separate ways-in product surface.

Current behavior:

- Research search and detail payloads use entity type, departments, research areas, and access `Signal`s as enrichment.
- Student-facing browse status counts matching research homes and people.
- Detail payloads join a small number of supporting access `Signal` rows, rendered as plain factual signal badges.
- Contact is derived at read time, never stored: public payloads expose only the official-profile link-out and never non-public scraped emails.

Public research detail payloads derive `leadIdentityStatus` and the optional `leadProfessorPublicKey` on the server from canonical identity checks and a unique match between entity-owned official-profile evidence and a lead member.
These evidence fields do not select one person for display when an entity has multiple principal investigators.
The detail page shows exactly one verified principal investigator once as the full card in the decision summary, shows multiple principal investigators together in a dedicated plural section, and withholds the card while lead identity is under review.

The PI action is the official profile link-out.
`resolveDecisionProfileUrl` derives it from person-page `websiteUrl`/`sourceUrls`, excluding department-roster provenance URLs and the entity's own non-person-page website, and returns nothing while lead identity is under review.
A cited URL counts as a person page either because its path carries a profile token or because the citing host is recorded as publishing person pages under exactly that prefix; `yalePersonPagePrefix.ts` owns the per-host rule and `skills/product-model/SKILL.md` records why the token test alone is not enough.
The two arms are ordered rather than ranked together: the host-mapped arm is consulted only when the token arm yields nothing, so a personal site on a root-mapped host cannot displace a department's own `/profile/` page.
When the entity itself yields no person-page target (for example its own site is a lab or research-home page), the detail page falls back to the single unambiguous lead PI's own official Yale person-profile URL from `Researcher.profileLinks` (`YALE_OFFICIAL`), never a lab website, and this fallback is likewise gated off while lead identity is under review.
Public cards or detail sections may link to that guarded official URL, but must not expose raw scraped emails or imply yLabs has verified a reachable official outreach channel.

Public research detail payloads no longer carry `activeListings`, and browse payloads no longer carry `hasActiveListing`.

## Saved Research Entities

Student workflow depth starts with saved research profiles.
Saved planning is stored in the account-owned, private-by-default `ResearchPlan` collection, keyed on `accountId` plus target `ResearchEntity`, so a student can save a research home even when it has no access evidence.
The `/dashboard` planning workspace hydrates bounded entity summaries and treats access evidence as optional enrichment.

Current behavior:

- `/api/users/savedResearchEntityIds` returns canonical entity ids for optimistic UI state.
- `/api/users/savedResearchEntities` returns allowlisted entity summaries, bounds `shortDescription` to 300 characters, and reports an archived, hidden, or deleted target as an `unavailableSavedResearchEntities` row instead of pruning it (#2174); see [`ResearchPlan`](#researchplan-research_plans) for the two reasons and what each promises the owner.
- `PUT` and `DELETE /api/users/savedResearchEntities` add and remove entity-owned saves for the authenticated account.
- `/api/users/savedResearchEntityPlans` stores the owning student's sanitized planning details, keyed by entity id.
- `GET /api/users/savedResearchEntityPlans/export` exports saved entities without private notes.
- `POST /api/users/savedResearchEntityPlans/export` includes private notes only when `includePrivateNotes: true` is explicitly supplied.
- The saved-list, plan, and export responses all use private no-store handling, the saved list included because its unavailable ids are the reader's own plans, and exports never include non-public contact emails.
- Saved profile cards link back to `/research/:slug` rather than introducing a separate planning-detail route.

The `favPathways` saving feature was removed (#363): the `/users/favPathways*` endpoints and the client saved-pathways section are gone, and saving is covered entirely by saved research entities and their plans.
The embedded `User.favPathways` field declaration has since been dropped from the schema as well.
The `favListings` listing-favorites feature was likewise removed (#2010): its `/users/favListings*` endpoints, the generic favorite-objectid helper chain and `logFavoriteEvent` middleware, the client `useFavorites` listings kind and `favoritesReducer` listing state, and the `User.favListings` field are all gone; the `LISTING_*` analytics enums remain until the analytics listing surface is retired.
All of the saved-research and program-watch routes read and write the canonical `ResearchPlan` collection through `researchPlanService` at runtime; with the `User` model retired (#2014), no embedded planning fields remain in code (see [`ResearchPlan`](#researchplan-research_plans) for the human-gated #725 backfill of any legacy values in the orphaned `users` collection).

Program watching (the account Program Watch surface and the `/programs` watch affordance) is a second canonical `ResearchPlan` surface, keyed on `accountId` plus a `PROGRAM` target, exposed through the `/api/users/watchedPrograms`, `/api/users/watchedProgramIds`, and `/api/users/watchedProgramPlans` routes and reusing the visibility-filtered, contact-redacted program projection.

Entity plans support user-owned intent, stage, note, checklist state and history, target deadline, acted-on date, and follow-up interval.
Keep these notes private to the owning account unless a future advising-share flow adds explicit visibility controls.

Saved research cards include route-specific checklist templates keyed by planning intent.
Checklist state uses stable item ids so copy edits do not erase checked state.

Pathway-based fellowship matching was removed with `EntryPathway`, and fellowship discovery lives on the programs and funding surface.

## Access Signals

Undergraduate-access evidence is stored as `Signal` rows in the `signals` collection (see [`Signal`](#signal-signals) above for the authoritative field shape); the standalone `AccessSignal` model was folded into it.
Each former `AccessSignal` `signalType` (`POSTED_OPENING`, `CURRENT_UNDERGRADS`, `NOT_CURRENTLY_AVAILABLE`, and so on) is its own `Signal.type`, and the `HIGH`/`MEDIUM`/`LOW` `confidence` plus `confidenceScore` gradient is preserved as per-signal evidence granularity.

Scrapers should not directly assert product conclusions as final truth. They should emit append-only observations/source evidence, then resolver/materializer logic should derive access `Signal`s. This keeps the raw evidence stable and lets signal logic evolve without rewriting scrape history. Avoid overconfident claims like `acceptingUndergrads: true`.

Operational retention note: observations remain append-only within a scraper run, but old unreferenced superseded observations may be pruned by the compact-retention command after reports are captured.
Active observations, recent observations, observations from the latest retained runs per source, supersession links, and observations referenced by durable materialized or rollback records remain available for audit and materialization.
The authoritative operator procedure and environment restrictions are in `docs/scraper-deployment-runbook.md`.

`accessMaterializer.ts` derives first-class access rows from raw `Observation`s.
Undergraduate access is read only from `undergradAccessEvidence`, which carries a verdict, the quote that backs it, and the page the quote came from.
The bare `acceptingUndergrads` boolean was retired in #2055, so an index-only lane that asserts nothing but that boolean derives no access evidence at all.

Signal examples:

- posted opening
- recurring program
- past undergraduates
- current undergraduates
- faculty supervises student projects
- fellowship-compatible
- structured fellowship program
- credit formalization possible
- reach-out plausible
- application-only
- no evidence yet
- not currently available

Absence of evidence should usually be computed from missing signals, not stored as many `NO_EVIDENCE` records. Store negative signals only when a source explicitly states a limitation, such as application-only, not accepting students, or not currently available.

Initial materialization in [`server/src/scrapers/accessMaterializer.ts`](../server/src/scrapers/accessMaterializer.ts) derives access `Signal` rows from raw `Observation` rows using the original observation confidence and source metadata. Independent-study and course-credit evidence supports `CREDIT_FORMALIZATION_POSSIBLE` signals or best-next-step hints after home/mentor fit. Current undergraduate counts can support `CURRENT_UNDERGRADS`; past undergraduate advisees can support `PAST_UNDERGRADS` and `FELLOWSHIP_COMPATIBLE`. Fellowship funding remains a formalization/funding-planning cue unless a real hosted program exists. Contact stays derived at read time, not materialized into stored routes. Entity-discovery sources such as `ysm-atoz-index` and `yse-centers-index` should not emit undergraduate-access booleans; no source does, because the derivation reads only `undergradAccessEvidence`.

Course-credit evidence is formalization-specific, not entry-specific. The CourseTable-backed `yale-course-catalog` scraper is no longer an active source. Course-specific evidence should not by itself create a generic exploratory-outreach or course-credit access signal. Thesis evidence should usually support thesis-fit/advising signals, formalization options, or planning next steps after a plausible mentor/home exists.

Lab-microsite LLM evidence is now shaped as observations first.
It may emit `undergradAccessEvidence`, `joinPageUrl`, `undergradRoleEvidenceQuote`, `contactInstructionsQuote`, and `undergradConstraintQuote`.
It no longer emits the `acceptingUndergrads` companion boolean.
`accessMaterializer.ts` derives `REACH_OUT_PLAUSIBLE`, `APPLICATION_FORM_EXISTS`, `CONTACT_INSTRUCTIONS_EXIST`, and `NOT_CURRENTLY_AVAILABLE` signals from those evidence observations.

Public access excerpts should redact direct contact details. The scraper may keep raw structured evidence for audit, but materialized public quote fields and `Signal.source.excerpt` values should replace scraped emails and phone numbers before they reach student-facing payloads.

The bibliographic ingestion pipeline is retired, so OpenAlex, arXiv, ORCID works, Europe PMC, PubMed, and Crossref are not research-activity, access, or description inputs.
Reviewed Google Scholar and ORCID links remain outbound researcher navigation only.
The `Paper` and `PaperAuthor` models, their readers, and the paper materializer are fully retired with no rollback opt-in; historical `paper` source rows and observations are retained as read-only archived evidence and are never materialized.
Stored `papers`/`paper_authors` collections remain only until the human-gated collection drop under issue #207/#210.
See [Retire The Bibliographic Paper Pipeline](./decisions.md#2026-07-26-retire-the-bibliographic-paper-pipeline) for the authoritative product decision.

## Undergraduate Logistics (Retired)

The five claim types `STUDENT_LEVEL`, `COMPENSATION`, `TIME_COMMITMENT`, `MODALITY` and `CURRENT_AVAILABILITY` are retired (#3088), along with the Planning-context render, the producer lane's logistics arm, the materializer, the public serve projection, the release audit and the rollback script.
Nothing models or serves undergraduate logistics today, and a `Signal` now carries an access type and nothing else.
See [The Undergraduate-Logistics Vertical Is Retired Rather Than Acquired A Fourth Time](./decisions.md#2026-09-23-the-undergraduate-logistics-vertical-is-retired-rather-than-acquired-a-fourth-time-3088) for the measurement and the cost.
Stored residue is expected: dropping an enum value never rewrites a document, so a small number of `signals` rows and already-inactive `observations` rows keep a name nothing declares, and the materializer's ignore filter keeps those observation fields from being written onto an entity.

## Source Coverage Metadata

`Source` rows can include optional `coverage` metadata seeded from [`server/src/scrapers/sourceCoverageRegistry.ts`](../server/src/scrapers/sourceCoverageRegistry.ts). Coverage records declare the source priority, source tier, artifact types a source can support, evidence categories it targets, default confidence stance, and planning notes.

This metadata is a planning and review contract, not a substitute for evidence. A source that can emit `Observation` rows should not be treated as access evidence unless the materializer maps specific observations into `Signal` rows. Discovery-only sources such as YSM/YSE indexes remain entity discovery inputs unless explicit undergraduate-access evidence is present.

## Researcher Identity Signals

ORCID may disambiguate a Yale-confirmed researcher and support a reviewed outbound profile link, but it must not act as an account-creation shortcut or a works feed.

Create a `Researcher` only when a research signal attaches the person to the corpus (a roster or PI/director role on a research entity); bare directory identity (a Yalies/Directory record with a netid and a faculty-ish title) no longer mints a `Researcher` or `Account` on its own.
Directory identity instead enriches an already-existing researcher: it fills profile fields and stamps the linked account's own netid on `Researcher.identifiers.netid` (the disambiguation spine, replacing the retired scraper-minted `Account` lookup), but never creates the person record.
The [`Researcher`](#researcher-researchers) section owns how that identity is resolved and which netid may be stamped.
Accounts are created only at login; the pruned directory people become login-provisioned identities if and when they actually sign in.
Reviewed ORCID and Google Scholar profiles may support disambiguation and outbound navigation, while NIH and NSF may enrich grant context, but none should create a Yale person record by itself.

Official Yale sources may emit ORCID identity observations with source provenance.
The retired OpenAlex pipeline must not supply new researcher identity or activity data.

Student-facing UI may surface ORCID as a low-prominence researcher profile link labeled `ORCID`. Do not frame it as "Verified by ORCID", do not use it as undergraduate-access evidence, and do not promote raw ORCID identifiers on search cards.

## Contact

There is no `ContactRoute` collection (#363). Contact is derived, not stored: the PI action is the official profile link-out from the `Researcher` official profile (`YALE_OFFICIAL`) or `ResearchEntity.websiteUrl`, redaction is a projection rule, and scraped emails are never surfaced in a public payload.

## Role Assignments

`RoleAssignment.role` is one of `PI`, `CO_PI`, `DIRECTOR`, `CO_DIRECTOR`, `CORE_FACULTY`, `AFFILIATED`, `STAFF`, `POSTDOC`, `GRADUATE_STUDENT`, or `UNDERGRADUATE` (see [`roleAssignment.ts`](../server/src/models/roleAssignment.ts)).
This flexible role set (rather than a hard-coded STEM PI/lab-member hierarchy) supports STEM labs, social science centers, economics RA programs, digital humanities teams, library/museum projects, and fellowship-supervised independent research.

Student-facing roster groups are intentionally coarser than the stored role enum: postdoctoral researchers, graduate students, undergraduate researchers, research staff, faculty, and other current members.
The exact stored role and any scraped official title remain visible as source context, and roster membership never becomes a contact recommendation or access claim.

## Recommended Next Steps

CTA logic may be stored or computed. Start by computing when possible; store only when admins need editorial control.

Examples:

- `POSTED_OPENING` signal + open application URL -> Apply
- `CREDIT_FORMALIZATION_POSSIBLE` -> Ask about credit after mentor/home fit
- `FELLOWSHIP_COMPATIBLE` -> Ask about funding after mentor/home fit
- structured mentor-matching fellowship (its own `ResearchEntity`) -> Apply to structured research program
- `REACH_OUT_PLAUSIBLE` + official profile link-out -> Review the official profile
- lead identity under review -> Review source context
- no evidence -> Save or check back later

Following the Simple Directory First slice (see the direction note above), the read-time `accessSummary` payload, the graded "Evidence" chips, and the computed "Best Next Step" label are no longer produced or shown.
Reaching out by opening the official profile is the constant contact action, and the remaining factual `Signal` rows render as plain badges without confidence stamps or a plausibility verdict.
The legacy stored access fields (`acceptingUndergrads`, `openness`, `acceptanceConfidence`, and the openness caches) were retired in #420/#463 and no longer exist on `ResearchEntity`.
#2055 finished the job for `acceptingUndergrads`: no scraper emits it, no materializer reads it, it carries no served source-contribution label, and `yarn --cwd server observations:retire-accepting-undergrads` supersedes the stored observations and clears the `fieldProvenance` entries that credited a source for it.

The `accessAcceptanceLevel` grade was retired by the 2026-08-25 "Simple Directory First" pivot: access plausibility no longer feeds ranking, filtering, or a trust tier, and the read-time `accessSummary` payload is no longer produced.

Client API boundaries normalize canonical `researchEntities`/`researchEntity` payloads before falling back to legacy `hits`/`group`.

## Admin Review

Admins need a way to inspect derived access records before deeper editorial workflows are built.

Implementation note: `GET /api/admin/access-review` filters, sorts, and paginates the environment-local `AdminAccessReviewProjection` before it hydrates the selected parent `ResearchEntity` rows.
The projection stores only bounded normalized word suffixes that preserve case-insensitive substring search, sort keys, aggregate counts, the parent reference, and reconciliation state.
Canonical access-record services invalidate the affected generation in the same transaction as a write and recompute it afterward, so concurrent writes cannot clear a newer invalidation.
The list checks readiness and performs projection, progress-count, and parent-hydration reads sequentially in one snapshot transaction, so concurrent invalidation cannot produce a partially current response.
The list fails with a temporary unavailable response when the projection is uninitialized, rebuilding, or stale.
`GET /api/admin/access-review/:id` remains a separate full derived access bundle for one entity rather than reading through the list projection.
`PUT /api/admin/access-review/:id/manual-locks` updates manually locked entity fields, and record-level review endpoints update per-record status, notes, and locks.
The access-review records are access `Signal` rows only.
The admin UI can inspect source evidence, update review state, manage locks, and filter records by review, evidence, and archive gaps.

## Product Vocabulary

Use precise internal names in code and schema docs, but use warmer labels in the UI:

- access `Signal`s (ways-in evidence) -> plain factual signal badges (the graded "Evidence" display is retired; see the direction note above)
- formalization metadata -> Ways to formalize

Use the unified Yale Research surface as the primary student-facing experience. Course credit, fellowship funding, and thesis advising are formalization outcomes after home/mentor fit unless they are attached to a real hosted or mentor-matching program that is its own `ResearchEntity`.

## Naming Residue

1. `/research` and `/research/:slug` are the canonical student-facing research routes.
2. Use `ResearchEntity`, `RoleAssignment`, `Signal`, and `ResearchEntityRelationship` for new runtime work; do not add new code against `ResearchGroup`, `ResearchGroupMember`, `FacultyMember`, `Paper`/`PaperAuthor`, or embedded access booleans.
3. Keep remaining `ResearchGroup`, `lab`, and `researchGroupId` naming (for example the `researchGroups.ts` route file and `researchGroupService.ts`) as migration residue unless a file is explicitly part of rollback or compatibility support.
4. Teach scrapers to emit source evidence first, then materialize access signals and roster rows only when evidence supports them.
5. Rename or drop legacy physical fields and lab-named files only after a reviewed cleanup, per the human-gated collection-drop scope tracked under #210.

The remaining end-to-end work is tracked in GitHub issues, including data-quality operations, post-launch legacy cleanup (the human-gated `users`/`faculty_members`/`papers`/`paper_authors` collection drops and the #725 saved-plan data backfill), and saved/advising workflow expansion.
