# Research Model Refactor

Status: ratified target model as of 2026-08-18.
This document is the single source of truth for the data model.
It supersedes the earlier phased contract; where older notes, issues, or code still describe `Person`, `RoleAssignment`, `EntryPathway`, `ContactRoute`, `PostedOpportunity`, `OrgUnit`-as-reference, `TaxonomyTerm`, or the evidence claim-graph as active, this document wins.

## What we are solving

The main problem is making Yale labs discoverable and improving the scraped data and the scraper.
The product is an evidence-driven research database, read-only scraped data plus private student planning, with no professor or student write or marketplace surfaces.
The student job-to-be-done is: discover a lab, then cold-email the professor via the official profile or lab page.
We help by surfacing, per lab, the PI, the official Yale profile and lab website, a clear description, exposed sources, and evidence tags (for example "has hosted undergrads before").
The model refactor is a means to that end, not a goal in itself.
Judge every change by whether it improves discoverability or data quality.

## Ratified target model (7 live collections)

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
Owns its roster inline: `members: [{ researcherId, role, state, confidence?, reviewStatus?, startedAt?, endedAt? }]` (join `Researcher` for names and links).
Carries canonicalized `school` and `departments[]` and `researchAreas[]` strings (see Canonicalization).
Keeps `slug`, `name`, `entityType`, `shortDescription`, `fullDescription`, `websiteUrl`, `sourceUrls[]`, `studentVisibilityTier`.
Does not carry an embedded `discovery` projection blob, embedded access booleans, embedded contact, or paper caches.

### `Signal` (`signals`)

One extensible, source-attributed, typed fact about a research entity.
Generalized from the logistics-claim shape and absorbs the old `AccessSignal` and `UndergraduateLogisticsClaim`.
Fields: `researchEntityId`, `type`, `value?`, `confidence?`/`status`, `expiresAt?`, `source` (`name`, `url`, `evidenceIds[]`, `excerpt`), `observedAt`, `review`, `archived`.
Access is `type: 'undergrad_access'` (its verified/likely confidence-gradient is preserved because it drives the browse trust-filter).
Logistics are `type: 'weekly_hours' | 'compensation' | ...`.
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

Removed (do not model): `RoleAssignment` (roster is embedded on `ResearchEntity.members`), `EntryPathway`, `ContactRoute`, `PostedOpportunity`, `TaxonomyTerm`, the embedded `discovery` projection, and the old `AccessSignal` and `UndergraduateLogisticsClaim` (folded into `Signal`).

Frozen (exist, unwired, do-not-build-on): `EvidenceClaim`, `SourceDocument`, `ReviewDecision`.
Delete now (dead): `MaterializedProvenance`.
The heavy governed evidence claim-graph is deferred; the lightweight `Observation` to `Signal` pipeline covers the product.

Separate adjacent domain (not the lab model): `Fellowship` and `Grant` power the programs and funding page (their own Mongo `$text` search).
Note the "program" split-brain: a program can appear both as a `Fellowship` and as a `ResearchEntity`; keep this out of lab-model scope but track it.

Retired legacy: `User` splits into `Account` plus `Researcher`; `FacultyMember` folds into `Researcher`; `ResearchGroupMember` becomes embedded `ResearchEntity.members`; `Paper` and `PaperAuthor` are retired.

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

The read path for lab membership and lead identity is canonical; the write path is not, which is a live staleness bug until the materializer writes canonical.

Tracked issues:

- Discoverability now: search relevance #345, hybrid or embedder #346, browse filters #347, matched professor #341 area.
- Data quality now: website coverage #348, research-area coverage #349, dedupe duplicate labs #350, department canonicalization and `OrgUnit` seed #354.
- Model refactor: identity split #206, clean `ResearchEntity` schema #208, dangling `ResearchGroup` ref #352, remove legacy `description` #351, write path to canonical #353.
- Superseded: PR #344 read canonical `RoleAssignment`, which is now removed in favor of embedded `members`; close it.

Verification gates for any cutover: source and target counts with explained differences, no orphan references, no dual identities in public DTOs, no public contact leakage, source attribution for material claims, deterministic conflict handling, official-link validity with graceful failure, search relevance parity, correct visibility filtering, bounded detail payloads, private-plan isolation, no paper dependency, and rollback readiness before any collection drop.
