# Research Model Refactor

Status: ratified target model as of 2026-08-18.
This document is the single source of truth for the data model.
It supersedes the earlier phased contract; where older notes, issues, or code still describe `Person`, `EntryPathway`, `ContactRoute`, `PostedOpportunity`, `OrgUnit`-as-reference, `TaxonomyTerm`, or the evidence claim-graph as active, this document wins.

## What we are solving

The main problem is making Yale labs discoverable and improving the scraped data and the scraper.
The product is an evidence-driven research database, read-only scraped data plus private student planning, with no professor or student write or marketplace surfaces.
The student job-to-be-done is: discover a lab, then cold-email the professor via the official profile or lab page.
We help by surfacing, per lab, the PI, the official Yale profile and lab website, a clear description, exposed sources, and evidence tags (for example "has hosted undergrads before").
The model refactor is a means to that end, not a goal in itself.
Judge every change by whether it improves discoverability or data quality.

## Ratified target model (8 live collections)

### `Researcher` (`researchers`)

Public research identity, and a first-class findable entity in its own right (a grad or PhD student or researcher is findable even with no lab).
Renamed from `Person`.
Fields: `displayName`, `accountId?` (link to the private principal), `profileLinks[]` (`kind`: `YALE_OFFICIAL` | `LAB_ABOUT` | `PERSONAL_ACADEMIC` | `GOOGLE_SCHOLAR` | `ORCID`, plus `url`, `verifiedAt`, `healthStatus`), `identifiers.orcid?`, `profile` (`title`, `primaryDepartment`, `imageUrl`, `websiteUrl`), `status`, `archived`.
Created only from Yale-confirmed evidence; external identifiers alone never create a `Researcher`.

### `Account` (`accounts`)

Private login principal: the student or user who logs in.
Fields: `netid` (unique), `email`, `status`, `lastLoginAt?`, `archived`.
It is the login half of the retired `User`.
It is currently unwired because auth still runs on legacy `User`; wiring it is the act of retiring `User` (sequenced last).

### `ResearchEntity` (`research_entities`)

The lab, center, institute, or faculty project - the discovery center.
Declared as a clean schema (not the legacy `researchGroupSchema`).
Its roster is modeled as canonical `RoleAssignment` rows (see `RoleAssignment` below), joined to `Researcher` - not embedded.
Carries canonicalized `school` and `departments[]` and `researchAreas[]` strings (see Canonicalization).
Keeps `slug`, `name`, `entityType`, `shortDescription`, `fullDescription`, `websiteUrl`, `sourceUrls[]`, `studentVisibilityTier`.
Does not carry an embedded `discovery` projection blob, embedded access booleans, embedded contact, or paper caches.

### `RoleAssignment` (`role_assignments`)

The person-to-lab membership edge (the roster); replaces legacy `ResearchGroupMember`.
Fields: `researcherId`, `target` (`{ kind: RESEARCH_ENTITY, id }`), `role`, `state` (`CURRENT` | `HISTORICAL` | `UNKNOWN`), `reviewStatus`, `confidence`, and a bounded `rosterProvenance` subdoc (source name/url, profile url, section label, evidence status, membership key, observed and freshness-expiry timestamps) that feeds the roster-freshness disclosure. `evidenceClaimIds` stays empty while the evidence claim-graph is frozen.
Read via `getResearchEntityRoster` (joins `Researcher` + `Account`). This kept `RoleAssignment` as a first-class roster collection over an earlier "embed `members[]` on `ResearchEntity`" idea: the fork resolved to `RoleAssignment` because the write path and readers were built on it.

### `Signal` (`signals`)

One extensible, source-attributed, typed fact about a research entity.
Generalized from the logistics-claim shape and absorbs the old `AccessSignal` and `UndergraduateLogisticsClaim`.
Fields: `researchEntityId`, `type`, `value?`, `confidence?`/`status`, `expiresAt?`, `source` (`name`, `url`, `evidenceIds[]`, `excerpt`), `observedAt`, `review`, `archived`.
Access evidence keeps per-signal granularity: each former `AccessSignal` type (`POSTED_OPENING`, `CURRENT_UNDERGRADS`, `NOT_CURRENTLY_AVAILABLE`, and so on) is its own `Signal.type`, so the verified/likely confidence-gradient that drives the browse trust-filter is preserved per type rather than collapsed into one `undergrad_access` value.
Logistics are the former claim types (`STUDENT_LEVEL`, `COMPENSATION`, `TIME_COMMITMENT`, `MODALITY`, `CURRENT_AVAILABILITY`) carried as `Signal.type` with a `status` and a structured `value`.
Future metrics (wet or dry lab, safety level, and similar) are new `type` values, never new collections.
Signals stay independent and neutral when unknown; do not cross-infer one type from another (materializer logic).

### `ResearchEntityRelationship` (`research_entity_relationships`)

Source-backed affiliations between research entities (the "Affiliated with" surface).

### `Observation` (`observations`)

Raw, append-only scraped evidence; the substrate that feeds the confidence resolver and materializes into `Signal`.

### `ResearchPlan` (`research_plans`)

Private student saved planning, keyed on `accountId` plus target `ResearchEntity`.
The only student write surface.

## Removed, frozen, separate, retired

Removed (do not model): `EntryPathway`, `ContactRoute`, `PostedOpportunity`, `TaxonomyTerm`, the embedded `discovery` projection, and the old `AccessSignal` and `UndergraduateLogisticsClaim` (folded into `Signal`).

Frozen (exist, unwired, do-not-build-on): `EvidenceClaim`, `SourceDocument`, `ReviewDecision`.
Delete now (dead): `MaterializedProvenance`.
The heavy governed evidence claim-graph is deferred; the lightweight `Observation` to `Signal` pipeline covers the product.

Separate adjacent domain (not the lab model): `Fellowship` and `Grant` power the programs and funding page (their own Mongo `$text` search).
Note the "program" split-brain: a program can appear both as a `Fellowship` and as a `ResearchEntity`; keep this out of lab-model scope but track it.

Retired legacy: `User` splits into `Account` plus `Researcher`; `FacultyMember` folds into `Researcher`; `ResearchGroupMember` becomes `RoleAssignment`; `Paper` and `PaperAuthor` are retired.

## Derived, not stored

Contact action: there is no `ContactRoute` collection.
The PI action is the official profile link-out from `Researcher.profileLinks` (`YALE_OFFICIAL`) or `ResearchEntity.websiteUrl`.
Scraped emails are never surfaced in a public payload; outreach happens off-platform via the official page.
This redaction is a projection rule, not a stored policy.

Discovery projection: there is no persisted `discovery` blob.
Mongo `ResearchEntity` is the source of truth; the Meilisearch index is the discovery and browse projection (a rebuildable cache); the detail page derives its view live.
Keep at most a single computed `browseRankScore` if the index rebuild needs it, with one clear recompute trigger.

## Canonicalization

Departments and school: `OrgUnit` stays only as an ingest-time canonical lookup and seed (canonical `name`, `slug`, `aliases[]`, and `parentOrgUnitId` hierarchy).
`ResearchEntity` stores the resulting canonicalized `school` and `departments[]` strings, not `departmentIds` references.
Ingest maps a scraped department string to the canonical value by deterministic normalized-name plus alias match, and fails closed to the raw string plus review when there is no match.
Aliases grow from the review queue.
`OrgUnit` only escalates to full ID-normalization if a school-to-department-to-program tree-browse feature is wanted.

Research areas: canonicalized `researchAreas[]` strings, no `TaxonomyTerm`.
Synonym and related-topic matching is the job of semantic search, not a curated taxonomy.

## Sequencing rules

Model or read cutover first, fix the write path after.
Introduce the canonical model and cut runtime reads over, then cut the scraper and materializer write path to canonical.
Do not keep cutting more reads to canonical ahead of the write path, because each read cut over before the write path serves stale data until a batch runs.

When the write path becomes canonical, remove the destructive batch identity apply in the same change, or it will clobber continuously written canonical rows.

Rename `Person` to `Researcher` first, as a small isolated change, before the larger write-path and schema work, to avoid a double edit.

`Account` wiring is sequenced with `User` retirement (the long pole).

Prefer a hard cutover: fully replace the legacy reader or path and remove the legacy code, with no fallback, flag, or parity-shadow layer.
Keep destructive storage drops, production writes, and one-way product decisions human-gated.

## Out of scope

The heavy evidence claim-graph (frozen `EvidenceClaim`, `SourceDocument`, `ReviewDecision`, `MaterializedProvenance`).
Strict-validator flips and compatibility-storage removal (former Phase 6) until every prior step lands.
A public people directory; a person-search surface is deferred though `Researcher` supports it.
The programs, fellowships, grants, and funding page (separate adjacent domain).

## Migration status and open work

Search and browse ranking read the canonical roster (#331), and the scraper materializer writes canonical `Researcher`, `Account`, and `RoleAssignment` rows continuously on each materialize (#353), so freshly scraped PIs, members, and departures surface immediately without waiting for a batch.
The legacy `ResearchGroupMember` write path was retired in #361, so the continuous canonical write is now the sole roster write path.
Because the write path is canonical, the destructive batch identity apply (`phase2IdentityMigrationApply` and its `replaceCanonicalIdentityCollections`, which wiped and rebuilt the canonical identity collections from legacy sources) is retired in the same change (#353), per the sequencing rule: a batch that deletes and rebuilds from legacy would clobber continuously written canonical rows that legacy no longer explains.
The non-destructive dry-run identity planner (`model-refactor:identity-plan`) is kept for reconciliation analysis; a one-time reconciliation after deploy is a full idempotent re-materialize of the scraped sources, never a destructive replace.

The student-facing research-detail page (`getResearchGroupDetail`) also reads the canonical roster now (S4a, #360): it derives members from `getResearchEntityRoster` (`RoleAssignment` plus `Researcher` and `Account`) instead of legacy `ResearchGroupMember`/`FacultyMember`/`User`.
Because canonical `RoleAssignment.evidenceClaimIds` is empty (full `EvidenceClaim` canonicalization needs the frozen `SourceDocument` plus predicate-registry machinery), the roster-freshness disclosure is fed by a bounded `rosterProvenance` subdoc on `RoleAssignment` (source name/url, profile url, section label, evidence status, membership key, observed and freshness-expiry timestamps) populated at each materializer membership write-site.
This subdoc is a deliberate, pragmatic deviation from the ratified `EvidenceClaim` provenance model, scoped to keep the existing freshness logic working until the heavy claim-graph is built.
Most residual internal roster readers now read the canonical roster too (S4b, #360): `researchEntityEvidenceCoverage`, `researchEntityPublicDescriptionAuditService`, `studentVisibilityGateService`, `launchAcquisitionReportService`, and `accessMaterializer` derive lead and member display name and role from the canonical `Researcher` via `getResearchEntityRoster`/`getResearchEntityRosterByEntityId`, treat any non-`HISTORICAL` state as current, and key downstream on `personId` instead of legacy `userId`/`facultyMemberId`.
The final legacy-user-keyed readers now resolve to a canonical `Researcher` first via `resolveResearcherIdForLegacyUser` (netid to `Account` to `Researcher.accountId`, then `identifiers.orcid`, then a single name-only `displayName` match; fail-closed, never merging distinct identities) and read `RoleAssignment` (S4c, #360).
`listingService.hasListingEntityAuthority` checks a canonical author-role assignment (`RESEARCH_ENTITY` target, non-`HISTORICAL`, not archived), and an unresolved owner returns false so the caller falls back to creating its own entity as before.
`canonicalResearchHomeResolver.resolveCanonicalResearchHomeForUser` reads lead `RoleAssignment`s, mapping `HISTORICAL` state to the prior ineligibility and an unresolved user to a safe shell.
`visibilityRepairQueueService` was the last legacy `ResearchGroupMember` reader in the runtime read path and now reads the canonical roster too (S4d, #360): its `findResearchEntityMembers` default dep derives lead members from `getResearchEntityRoster` (name, role, netid, title, image, website; any non-`HISTORICAL` state is current), and `isLeadMember` now includes `co-pi` and `co-director` to match the canonical lead set the roster emits.
The canonical roster carries no bio, research-interest, or topic fields, so the lead-bio-derived entity-description candidates this service used to produce are intentionally dropped rather than canonicalizing bios onto `Researcher`; this follows the product decision to no longer show or keep professor bios, and entity descriptions continue to come from their other sources (`entity.description`, PI/profile scrapers).
`profileService.loadProfileResearchEntities` reads `RESEARCH_ENTITY` `RoleAssignment`s (non-`HISTORICAL`, not archived, matching the prior `isCurrentMember != false` semantics) and maps each canonical role back to the legacy role string the profile DTO still expects.
The two live scraper-source lead readers now read the canonical roster too, decoupling the scrape pipeline's lead reads ahead of the S5 write retirement (#361): `officialProfilePiBackfillScraper` derives current leads from `getResearchEntityRosterByEntityId` (lead roles, non-`HISTORICAL` state) and fetches the bio, profile-url, website, and first/last-name fields the roster does not carry via a targeted by-`netid` `User` lookup, degrading to `splitName(entry.name)` plus roster URLs when no `User` matches; `centerDirectorLLMExtractor`'s `missingLeadOnly` filter reads `RoleAssignment.distinct('target.id', ...)` for canonical lead roles (non-`HISTORICAL`, not archived).
The `User` lookup uses a `{ locale: 'en', strength: 2 }` collation and lowercased by-`netid` map keys because `Account.netid` is lowercase while `User.netid` is mixed-case; it stays an accepted transitional dependency until `User` is retired.
`FacultyMember` is now fully retired (#366, professor-mirror half of #207): the last runtime reader was `resolveResearcherIdForLegacyUser`, which now resolves a legacy `User` to a canonical `Researcher` by netid-to-`Account`-to-`Researcher`, then `User.orcid`, then a single `displayName` match, with no `FacultyMember` fallback; the materializer stopped threading `user.facultyMemberId` into membership writes and identity resolution; and the `facultyMember` model plus its collection writes (the `data-migration` v4 faculty backfill and the root-import faculty path) are removed.
The `faculty_members` collection is left in place for a gated drop; the `User.facultyMemberId` and `Grant.piFacultyMemberId`/`coPiFacultyMemberIds` fields keep their stored `ObjectId`s but no longer declare a `ref` to the removed model.
The `Paper` and `PaperAuthor` models carrying the analogous residue are now deleted outright (publication-mirror half of #207).
The field-retirement of the now-unused `User` bio, research-interest, and topic fields, and the eventual `User` retirement plus `Account` wiring (the long pole), remain the follow-ups.

Tracked issues:

- Discoverability now: search relevance #345, hybrid or embedder #346, browse filters #347, matched professor #341 area.
- Data quality now: website coverage #348, research-area coverage #349, dedupe duplicate labs #350, department canonicalization and `OrgUnit` seed #354.
- Model refactor: identity split #206, dangling `ResearchGroup` ref #352, remove legacy `description` #351; landed: clean `ResearchEntity` schema #208, retire legacy `ResearchGroupMember` writes #361, canonical continuous write path plus destructive batch-apply retirement #353, retire `FacultyMember` fold into `Researcher` #366 (professor-mirror half of #207).
- PR #344 (an early `RoleAssignment` read cutover) was superseded by #375 and closed.

Verification gates for any cutover: source and target counts with explained differences, no orphan references, no dual identities in public DTOs, no public contact leakage, source attribution for material claims, deterministic conflict handling, official-link validity with graceful failure, search relevance parity, correct visibility filtering, bounded detail payloads, private-plan isolation, no paper dependency, and rollback readiness before any collection drop.
