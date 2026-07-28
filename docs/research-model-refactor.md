# Research Model Refactor

Status: accepted product and architecture direction, implementation in progress

Decision date: 2026-07-24

This document records the target Yale Research data model and the migration boundaries agreed during the July 2026 model review.
It is a durable design contract, not a claim that the current runtime already implements the target.
Until the migration is complete, [`research-model.md`](./research-model.md) and the source code remain authoritative descriptions of current compatibility behavior.

## Executive Decision

Yale Research will remain a research-home-first discovery and planning product.
It will own the structured model that connects research homes, people, undergraduate-access evidence, pathways, postings, official action routes, and private student plans.
It will not maintain a competing professor-profile or scholarly-publication product.

The target model follows five principles:

1. Research discovery centers on `ResearchEntity`.
2. Public people are minimal identity anchors connected to research through dated role assignments.
3. Official Yale, Google Scholar, and ORCID profiles remain outbound sources rather than content feeds to mirror.
4. Scrapers preserve source evidence before materializers derive student-facing records.
5. Public APIs return bounded product projections over REST while keeping the model compatible with a possible future GraphQL read layer.

The intended product boundary is:

> Yale Research owns structured research navigation and evidence-backed next steps.
> Yale, Google Scholar, and ORCID own professor presentation and scholarly output.

## Product Experience

The target experience must be more than a directory of links.
Its value comes from making fragmented Yale research information searchable, comparable, attributable, and actionable.

A student should be able to:

1. Search by topic, method, professor, department, entity type, or practical constraint.
2. Find a plausible research home even when no opening is posted.
3. Understand what the research home studies and which methods it uses.
4. See who leads it and who might supervise undergraduates.
5. Review source-backed evidence about undergraduate participation or constraints.
6. Distinguish a durable pathway from a currently open opportunity.
7. Understand the safest supported next step.
8. Follow the official Yale source for deeper professor or research details.
9. Save the research home and maintain a private plan.

The primary public experience remains `/research` and `/research/:slug`.
Professor names should link to official Yale profiles when those links are verified.
Yale Research should not create a separate internal professor-profile mirror.

### Student questions and data ownership

| Student question                   | Yale Research record                          | Public attribution                              |
| ---------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| What is this research structure?   | `ResearchEntity`                              | Official entity, program, or department source  |
| What does it study?                | Entity description, topics, and methods       | Source link and verification date               |
| Who leads it?                      | `RoleAssignment` plus `Person`                | Official Yale person profile                    |
| Have undergraduates participated?  | `AccessSignal`                                | Evidence excerpt, source, and observation date  |
| Is there an active opening?        | `PostedOpportunity`                           | Official posting, status, and deadline source   |
| How might I approach it?           | `EntryPathway`                                | Supporting evidence and explanation             |
| What should I do next?             | Computed planning context plus `ContactRoute` | Supporting claims and source route              |
| What has this professor published? | Not stored by Yale Research                   | Official Yale, Google Scholar, or ORCID profile |

## Target Model Overview

```text
Account 0..1 ── Person ── RoleAssignment ── ResearchEntity
                                             │
                       ┌─────────────────────┼─────────────────────┐
                       │                     │                     │
                 EntryPathway          AccessSignal         ContactRoute
                       │
                PostedOpportunity

SourceDocument ── EvidenceClaim ── supports materialized domain records
ReviewDecision ──────────────────── records manual resolution and locks

Account ── StudentProfile
Account ── ResearchPlan ── ResearchEntity
```

The diagram is a domain graph.
It does not imply that the refactor must adopt GraphQL.

## Collection Responsibilities

### `accounts`

`Account` owns authentication and private account state.
It replaces the use of a single `User` document as both an authenticated principal and a public professor profile.

Suggested responsibilities:

- CAS identity and session linkage;
- account email and authorization state;
- private preferences;
- timestamps and account lifecycle state.

An account is not evidence that a public research person exists.
A public person may exist without an account, and most student accounts do not require public person records.
When a public person and account are the same individual, the indexed optional relationship is stored as `Person.accountId` rather than duplicated in both documents.

### `people`

`Person` is a minimal, role-neutral identity anchor for named people connected to research.
The model may represent faculty, directors, staff, postdoctoral researchers, graduate students, undergraduates, and other named supervisors when source and visibility policy permit.

Suggested shape:

```ts
type PersonProfileLink = {
  kind: 'YALE_OFFICIAL' | 'LAB_ABOUT' | 'PERSONAL_ACADEMIC' | 'GOOGLE_SCHOLAR' | 'ORCID';
  purpose: 'PRIMARY_IDENTITY' | 'SCHOLARLY';
  url: string;
  verifiedAt: Date;
  healthStatus: 'HEALTHY' | 'UNAVAILABLE' | 'UNKNOWN';
};

type Person = {
  id: string;
  schemaVersion: number;
  displayName: string;
  accountId?: string;
  profileLinks?: PersonProfileLink[];
  identifiers?: {
    orcid?: string;
  };
  status: 'ACTIVE' | 'DEPARTED' | 'UNKNOWN';
  archived: boolean;
};
```

`Person` must not become another full professor-profile document.
It should not store mirrored biographies, publication arrays, citation metrics, h-index values, paper-derived topics, or copied contact information.
Search may index a person's display name through related research-entity projections so a professor-name query can return the research homes they lead.
`profileLinks` is a small bounded set with at most one reviewed link of each kind.
Public projections expose one selected primary profile and a bounded `researchProfiles` array containing only secondary link kind, label, and canonical URL.

Google Scholar and ORCID may enrich or disambiguate a Yale-confirmed person.
Neither source may create a person record by itself.
Their verified profiles are optional outbound researcher links, not public verification badges or undergraduate-access signals.

### `role_assignments`

`RoleAssignment` connects a person to a research entity or Yale organizational unit.
It replaces the dual `User` and `FacultyMember` references and legacy `ResearchGroupMember` naming.

Suggested shape:

```ts
type RoleAssignment = {
  id: string;
  schemaVersion: number;
  personId: string;
  target: {
    kind: 'RESEARCH_ENTITY' | 'ORG_UNIT';
    id: string;
  };
  role:
    | 'PI'
    | 'CO_PI'
    | 'DIRECTOR'
    | 'CO_DIRECTOR'
    | 'CORE_FACULTY'
    | 'AFFILIATED'
    | 'STAFF'
    | 'POSTDOC'
    | 'GRADUATE_STUDENT'
    | 'UNDERGRADUATE';
  state: 'CURRENT' | 'HISTORICAL' | 'UNKNOWN';
  startedAt?: Date;
  endedAt?: Date;
  evidenceClaimIds: string[];
  confidence: number;
  reviewStatus: 'UNREVIEWED' | 'APPROVED' | 'DISPUTED';
  archived: boolean;
};
```

Roles are facts about a relationship, not permanent person types.
The model must preserve historical roles without presenting them as current.
Name-only role extraction must enter review unless it resolves to a unique Yale-confirmed person.

### `org_units`

`OrgUnit` provides canonical identity for Yale schools, departments, offices, and similar organizational structures.
Research entities and people should reference organization IDs rather than maintaining several independent arrays of department and school strings.

Frequently displayed organization labels may be copied into bounded search or DTO projections.
The ID remains the canonical relationship.

### `taxonomy_terms`

`TaxonomyTerm` provides stable identity for controlled research topics and methods.
It replaces the combination of research-area IDs, copied labels, scraper-generated strings, and search-only aliases acting as competing classifications.

Suggested fields include:

- term kind such as `TOPIC` or `METHOD`;
- canonical label;
- normalized aliases;
- optional parent term;
- review and lifecycle state.

Search-specific synonyms may extend this vocabulary in Meilisearch.
They must not silently create new canonical taxonomy terms.

#### Phase 1 identity and reference schema boundary

The versioned `Account`, `Person`, `RoleAssignment`, `OrgUnit`, and `TaxonomyTerm` schemas are registered in `server/src/models/` with explicit `accounts`, `people`, `role_assignments`, `org_units`, and `taxonomy_terms` collection names.
They currently coexist empty with legacy runtime collections and have no live route consumers, writers, migrations, startup hooks, or Meilisearch projections.
The isolated Phase 1 readers and projections are documented in [`research-model.md`](./research-model.md#phase-1-bounded-canonical-read-contracts).

`Account` contains CAS identity and lifecycle state but no person pointer or role array.
`AdminGrant` remains the source of admin authority, research roles belong to `RoleAssignment`, and `Person.accountId` is the only optional account-person relationship.
`Person.profileLinks` permits at most one verified outbound link for each of the five accepted kinds, with Google Scholar and ORCID restricted to scholarly-purpose links and kind-specific canonical URLs.
An ORCID identifier may remain non-public until its outbound profile link is reviewed, but any stored ORCID profile link must match the person's canonical ORCID identifier.

`RoleAssignment` stores dated person-to-target relationships and permits repeated historical terms.
`OrgUnit` and `TaxonomyTerm` are new canonical reference identities, but this phase does not copy from or cut readers over from `Department` or `ResearchArea`.
Taxonomy uniqueness is scoped by term kind and the normalized canonical label.

### `research_entities`

`ResearchEntity` remains the central browseable concept.
It covers labs, centers, institutes, faculty projects, faculty research areas, digital humanities initiatives, collections projects, archives, RA programs, mentor-matching fellowship programs, and similar durable research structures.

The clean target schema must be declared directly.
It must not continue to register `ResearchEntity` from the legacy `researchGroupSchema`.

Suggested shape:

```ts
type ResearchEntity = {
  id: string;
  schemaVersion: number;
  slug: string;
  name: string;
  entityType: ResearchEntityType;
  description?: string;
  officialWebsiteUrl?: string;
  orgUnitIds: string[];
  topicIds: string[];
  methodIds: string[];
  sourceEvidenceClaimIds: string[];
  discovery: {
    leads: Array<{
      personId: string;
      displayName: string;
      role: string;
      officialProfileUrl?: string;
    }>;
    accessState: string;
    bestNextStepCategory?: string;
    openOpportunityCount: number;
    browseRankScore: number;
    visibilityState: string;
    computedAt: Date;
  };
  archived: boolean;
};
```

The `discovery` object is a bounded computed projection for read-heavy research cards and search indexing.
It is not a second source of truth.
`accessState` remains bounded text in Phase 1 because the accepted target declares it as a string and no governed canonical access-summary vocabulary exists yet.
The later vertical cutover must govern that vocabulary before it becomes a public filter or search facet instead of introducing a competing classification here.
The authoritative bounds, invalidation triggers, reconciliation interval, and staleness behavior are documented in [`research-model.md`](./research-model.md#phase-1-bounded-canonical-read-contracts).
Full roles, pathways, signals, routes, and evidence remain first-class records.

Legacy fields such as `kind`, duplicate description fields, `acceptingUndergrads`, `openness`, `acceptanceConfidence`, embedded openness signals, and legacy research-group references must be retired after canonical reads cut over.

### `research_entity_relationships`

`ResearchEntityRelationship` represents source-backed relationships between research entities.
The existing model and `research_entity_relationships` physical collection remain canonical rather than being duplicated under a renamed model.
Examples include affiliation, hosting, membership, umbrella structure, and succession.

Relationships remain first-class because they are many-to-many, independently evidenced, and queried in both directions.
Public entity-detail DTOs should expose only bounded related-entity summaries.

### `entry_pathways`

`EntryPathway` describes a durable, evidence-backed way a student might approach a plausible research home.
It does not mean that a position is currently open.

Examples include:

- a recurring program;
- an official application process;
- a center internship;
- faculty supervision;
- a supported exploratory route;
- a mentor-matching program;
- a lab-manager or program-manager route.

Course credit is not an entry pathway.
Fellowship funding is normally not an entry pathway unless the fellowship itself provides mentor matching, project placement, or another genuine discovery route.

### `posted_opportunities`

`PostedOpportunity` represents a specific active, rolling, closed, or archived posting.
It belongs to an `EntryPathway`.

Term, deadline, application URL, compensation, eligibility, and status belong on the posted instance when the source supports them.
Legacy `Listing` records should migrate into pathways and posted opportunities before the listing model is retired.

### `access_signals`

`AccessSignal` represents source-backed evidence about undergraduate access.
Positive signals and explicit negative constraints are stored.
Absence of evidence is normally computed.

Examples include:

- current undergraduate participation;
- past undergraduate participation;
- official application form;
- recurring undergraduate program;
- faculty supervision of student projects;
- application-only policy;
- explicit current unavailability.

Papers, preprints, grants, citation counts, and general research activity do not prove undergraduate access.

### `contact_routes`

`ContactRoute` represents an actual reviewed route for action.
It remains fail-closed and visibility-scoped.

Examples include:

- official application;
- program application;
- lab-manager instructions;
- explicitly permitted faculty contact;
- official department inquiry route.

An official professor profile is not automatically a contact route.
The profile URL belongs on `Person` unless the page itself provides and permits a specific action route.
Public DTOs must not expose unreviewed scraped emails or phone numbers.

### Formalization options

Course credit, paid RA work, fellowship funding, thesis advising, and volunteer arrangements are ways a research relationship may be formalized after home and mentor fit.
This refactor does not create a separate `formalization_options` collection initially.

Materializers may derive a bounded formalization summary for Planning Context from source-backed claims and access signals.
A first-class collection should be introduced only if formalization options gain independent lifecycle, filtering, or editing requirements.

### `student_profiles`

`StudentProfile` stores bounded onboarding and discovery preferences.
It remains private account data and should not be mixed into public person identity.

### `research_plans`

`ResearchPlan` stores one private planning relationship between an account and a research entity or program.
It replaces loosely typed saved arrays and mixed plan maps on `User`.

Suggested responsibilities:

- saved state;
- planning stage;
- private notes;
- checklist state;
- relevant deadlines;
- explicit export preferences.

Private notes must remain excluded from exports unless the student explicitly opts in.

### `engagement_events`

`EngagementEvent` remains append-only product analytics with a retention policy separate from research evidence.
Analytics must not become canonical evidence that a research home accepts undergraduates.

## Publication and Professor-Profile Decision

The target model does not include `Paper`, `PaperAuthor`, `ScholarlyWork`, or scholarly-attribution collections.
It also does not retain an embedded publications array on `Account` or `Person`.

The following ingestion paths should be retired after their reads and launch gates are removed:

- OpenAlex paper ingestion;
- arXiv preprint ingestion;
- ORCID works ingestion;
- Europe PMC and PubMed paper ingestion;
- Crossref bibliographic hydration;
- paper-authorship materialization and audits;
- professor and research-detail publication DTO fallbacks.

Google Scholar and ORCID remain useful as:

- an external identity signal;
- a reviewed disambiguation aid;
- an optional outbound public researcher link.

Google Scholar and ORCID are not used as:

- a source that creates Yale people;
- a feed that rebuilds a publication corpus;
- input to ranking, visibility, search content, or research-home descriptions;
- evidence of undergraduate access;

Paper storage should be reconsidered only if Yale Research adopts an explicit product requirement for native publication search, paper-level filtering, offline scholarly browsing, or consistent in-app activity comparison.
Until then, the official Yale profile is the preferred destination for highlighted publications, while verified Google Scholar and ORCID profiles are optional outbound identity links.

## Evidence and Attribution Contract

Every material student-facing claim must be traceable to source evidence.
Attribution must operate at the claim level rather than only at the page level.

### `sources`

`Source` records source identity, trust posture, coverage, cadence, and policy.
Source coverage metadata is a planning contract, not evidence that a particular claim is true.

### `source_documents`

`SourceDocument` identifies the exact fetched page or API resource used as evidence.

Suggested fields include:

- canonical URL or external resource key;
- source ID;
- retrieval time;
- content hash;
- HTTP and link-health state;
- snapshot pointer when retention policy permits;
- sensitivity and retention classification.

Raw snapshots may contain contact details or other sensitive material.
Snapshot access and retention must follow source-specific policy and must not imply public visibility.

### `evidence_claims`

`EvidenceClaim` records what a source asserted using a stable domain predicate.
Predicates must not be current Mongoose field names.

Suggested shape:

```ts
type EvidenceClaim = {
  id: string;
  schemaVersion: number;
  subject: {
    kind:
      | 'PERSON'
      | 'ROLE_ASSIGNMENT'
      | 'RESEARCH_ENTITY'
      | 'ENTITY_RELATIONSHIP'
      | 'ENTRY_PATHWAY'
      | 'POSTED_OPPORTUNITY';
    id?: string;
    key?: string;
  };
  predicate: string;
  value: unknown;
  sourceDocumentId: string;
  observedAt: Date;
  confidence: number;
  sensitivity: 'PUBLIC' | 'AUTHENTICATED' | 'ADMIN_ONLY';
  status: 'ACTIVE' | 'SUPERSEDED' | 'REJECTED' | 'DISPUTED';
  supersededByClaimId?: string;
};
```

Example predicates include:

- `PERSON_HAS_OFFICIAL_PROFILE`;
- `PERSON_HAS_ORCID`;
- `PERSON_LEADS_ENTITY`;
- `ENTITY_HAS_DESCRIPTION`;
- `ENTITY_USES_METHOD`;
- `UNDERGRAD_PARTICIPATION_OBSERVED`;
- `OFFICIAL_APPLICATION_EXISTS`;
- `OPPORTUNITY_HAS_DEADLINE`;
- `DIRECT_CONTACT_NOT_PERMITTED`.

### Materialized provenance

Materialized records must retain the claims that support them.

```ts
type MaterializedProvenance = {
  evidenceClaimIds: string[];
  materializer: string;
  materializerVersion: number;
  computedAt: Date;
};
```

Computed values such as access summaries, browse ranking, and Best Next Step must identify themselves as Yale Research derivations.
They must not be presented as direct quotations from a source.

### `review_decisions`

`ReviewDecision` records manual merge, rejection, approval, lock, suppression, and identity-resolution actions.
Manual review must not erase the original claims or snapshots.
Public copy may say that a record was reviewed, while reviewer identity and internal notes remain protected.

### Public attribution behavior

The public UI should reveal enough attribution to establish trust without turning every card into an audit log.

- Descriptions link to the official research source.
- Leadership links to the official Yale person profile.
- Access evidence may show a short redacted excerpt, source, and observation date.
- Best Next Step includes a concise explanation of why it was selected.
- Posted opportunities link to the official posting and deadline source.
- Computed conclusions are labeled as Yale Research summaries derived from the displayed evidence.

When credible sources conflict, the product should show uncertainty or route the record to review.
It must not silently choose the most optimistic interpretation.

## Scraper Refactor

The scraper system remains evidence-first.
The refactor changes subject selection and output contracts rather than allowing source adapters to write final conclusions.

### Target pipeline

```text
Work planner
  -> guarded fetch and cache
  -> SourceDocument
  -> stable EvidenceClaim rows
  -> identity and claim validation
  -> domain materializers
  -> bounded discovery projection
  -> Meilisearch sync
  -> visibility gate
  -> public REST DTOs
```

### Professor and identity sources

Professor-profile ingestion should become official-link discovery, identity resolution, and link-health validation.
It should not mirror full biographies, publication lists, citation metrics, or contact details.

Roster, directory, entity-page, and official-profile sources may emit:

- person name;
- official Yale profile URL;
- verified ORCID when present;
- role or affiliation evidence;
- source-backed relationship evidence.

Ambiguous name matches must enter review.
External identifiers alone must not create Yale people.

### Research and access sources

Research-home, department, program, and undergraduate-access scrapers remain central to the product.
They may emit claims about:

- durable research entities;
- descriptions, topics, and methods;
- organizational and entity relationships;
- named leadership;
- undergraduate participation;
- official applications;
- timing, eligibility, and constraints;
- reviewed public action routes.

Discovery-only sources must not manufacture undergraduate-access claims.
Research activity, grants, and identifiers must not be treated as access evidence.

### Observation compatibility

The current `Observation` model uses runtime entity names and Mongoose field names.
The target `EvidenceClaim` contract uses stable subjects and domain predicates.

The migration may temporarily dual-emit `Observation` and `EvidenceClaim` rows.
No scraper should switch to claim-only writes until the corresponding materializer and reconciliation report are available.
Dual-write duration should be bounded by an explicit cutover phase.

## Search and Read Projections

Meilisearch remains the search engine.
The `researchentities` index should be rebuilt from canonical research entities, role assignments, organization references, access summaries, and bounded discovery projections.

The target search document may include:

- entity name and type;
- lead display names;
- organization labels;
- topics and methods;
- concise source-backed description;
- access state and evidence strength;
- active-opportunity state;
- planning facets;
- browse rank and visibility state.

The target index must not depend on a paper corpus.
Any paper count, paper result, or publication-derived ranking behavior must be removed or replaced before paper collections are retired.

MongoDB remains the source of truth.
Meilisearch documents are rebuildable projections.

## REST and GraphQL Boundary

This refactor does not adopt GraphQL.
The graph-shaped domain makes a future GraphQL read layer easier, but the data model and API protocol remain separate decisions.

REST remains appropriate for the current bounded student experiences:

- research search;
- research detail;
- opportunity detail;
- saved research plans;
- admin review workflows.

Services should expose reusable domain loaders and projection functions so a future GraphQL layer could call the same logic.
Public REST DTOs should remain purpose-built, bounded, contact-safe, and visibility-aware.
The Phase 1 implementation and cutover boundary are documented in [`research-model.md`](./research-model.md#phase-1-bounded-canonical-read-contracts).

GraphQL should be reconsidered only if clients need materially different combinations of the graph or operator tools require frequent ad hoc traversal.
A future GraphQL layer would require field-level authorization, query-cost limits, batching, persisted-query or caching policy, and strict protection against arbitrary evidence traversal.
Meilisearch would continue to power search even if GraphQL were introduced.

## Current-to-Target Mapping

| Current shape                                                       | Target                                                                          | Migration intent                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Auth, student state, and faculty profile fields on `User`           | `Account`, `StudentProfile`, `ResearchPlan`, optional `Person`                  | Split private account state from public research identity            |
| `FacultyMember` plus professor-shaped `User`                        | `Person`                                                                        | Deterministically merge accepted identities and quarantine conflicts |
| `ResearchGroupMember` with dual entity and person references        | `RoleAssignment`                                                                | Rewrite references to one entity ID and one person ID                |
| `ResearchEntity` registered from `researchGroupSchema`              | Clean `ResearchEntity` schema                                                   | Cut reads to canonical fields, then remove legacy fields             |
| `ResearchGroup` and `researchGroupId` residue                       | `ResearchEntity` and `researchEntityId`                                         | Remove compatibility references after verified parity                |
| `Listing`                                                           | `EntryPathway` plus `PostedOpportunity`                                         | Preserve real postings and remove legacy listing ownership fields    |
| `Fellowship`                                                        | `ResearchEntity`, `EntryPathway`, `PostedOpportunity`, or formalization summary | Classify by behavior rather than by legacy collection                |
| `acceptingUndergrads` and openness caches                           | `AccessSignal` plus computed access summary                                     | Remove binary and duplicated access state                            |
| Official person profile treated as contact                          | `Person.profileLinks` with `PRIMARY_IDENTITY` purpose                           | Keep navigation separate from permission to contact                  |
| `User.publications`, `Paper`, `PaperAuthor`, and scholarly sidecars | No target collection                                                            | Remove reads, stop ingestion, archive, then drop                     |
| ORCID works ingestion                                               | `Person.identifiers.orcid` plus a verified `PersonProfileLink`                  | Retain identity and outbound link only                               |
| `User.googleScholarId` and `FacultyMember.googleScholarId`          | Verified `PersonProfileLink` with kind `GOOGLE_SCHOLAR`                         | Migrate the reviewed profile URL, then remove the legacy identifiers |
| Field-name-based `Observation`                                      | Predicate-based `EvidenceClaim`                                                 | Dual-emit temporarily, reconcile, then cut over                      |
| Mixed saved-plan maps on `User`                                     | `ResearchPlan`                                                                  | Migrate one plan per account and target                              |

## Migration Strategy

The refactor must use vertical cutovers rather than a flag-day rewrite.
Each phase must remove a compatibility read before the corresponding legacy storage is dropped.

### Phase 0: resolve integration state and measure production

Use the [`Phase 0 runbook`](./research-model-refactor-phase0.md) for the read-only inventory command, report interpretation, and rollback prerequisites.

- Resolve the existing merge conflicts before implementation changes begin.
- Inventory collection counts, schema versions, tracked retirement-field prevalence, and reference integrity.
- Identify actual read paths, index use, and query cost.
- Record data collisions and unresolved identity conflicts.
- Produce recoverable export or Atlas restore instructions before destructive cleanup.

Exit condition: reviewed inventory, ownership map, and rollback plan.

### Phase 1: introduce versioned canonical schemas

- Add `schemaVersion` to new canonical documents.
- Add MongoDB validators initially in migration-safe mode.
- Introduce domain loaders and bounded DTO projections.
- Add target collections without removing current readers.

Exit condition: new collections and readers can coexist safely with current runtime data.

### Phase 2: split account and person identity

- Create canonical people from accepted Yale-confirmed identity evidence.
- Set `Person.accountId` when a deterministic account-person match exists.
- Quarantine same-name, conflicting-email, and conflicting-identifier cases.
- Introduce role assignments with canonical entity and person references.
- Switch public leadership and search-name projections to canonical roles.

Exit condition: student-facing research reads no longer require `FacultyMember` or professor-profile fields on `User`.

### Phase 3: retire professor and publication mirrors

- Switch professor navigation to verified official Yale profile URLs.
- Migrate reviewed legacy Google Scholar identifiers into canonical verified `PersonProfileLink` records with kind `GOOGLE_SCHOLAR`.
- Expose Google Scholar and ORCID only as optional outbound identity links.
- Remove professor and research-detail publication sections and compatibility DTO fields.
- Disable paper, preprint, ORCID-works, and bibliographic hydration scrapers.
- Remove paper-quality and authorship gates after replacement launch criteria are documented.
- Archive the existing scholarly corpus before dropping collections.

Exit condition: no runtime read, write, audit, search, or public payload depends on paper data.

### Phase 4: clean research and access records

- Declare the clean ResearchEntity schema directly.
- Move canonical organization, topic, and method references into place.
- Remove legacy access booleans and openness caches after search and DTO cutover.
- Finish classification of listings and fellowships.
- Migrate private saved planning into `ResearchPlan`.

Exit condition: canonical entity, access, opportunity, and planning reads require no legacy adapters.

### Phase 5: migrate evidence claims and projections

- Introduce stable claim predicates and source-document identity.
- Dual-emit observations and evidence claims for bounded source groups.
- Reconcile materialized outputs between old and new pipelines.
- Cut materializers to evidence claims.
- Rebuild bounded entity discovery projections and Meilisearch.

Exit condition: integrity, visibility, attribution, and search gates pass without field-name-based observation readers.

### Phase 6: remove compatibility storage

- Stop dual writes.
- Verify no code or index references legacy fields and collections.
- Run reference, orphan, uniqueness, visibility, and source-attribution audits.
- Drop or archive legacy collections only after reviewed parity and rollback evidence.
- Tighten MongoDB validation after all surviving documents conform.

Exit condition: one canonical read and write path exists for each target concept.

## Verification Gates

The migration is not complete merely because documents were copied.
Each vertical cutover should verify:

- source and target record counts with explained differences;
- no unresolved orphan references;
- no dual person or entity identities in public DTOs;
- no public contact information leakage;
- source attribution for every material access claim;
- deterministic handling of source conflicts;
- official-profile link validity and graceful failure behavior;
- search relevance and result parity for representative student queries;
- correct visibility filtering;
- bounded detail payload sizes;
- private research-plan isolation;
- no paper or publication dependency after the scholarly cutover;
- rollback readiness before any collection drop.

Focused tests and audit scripts should be added alongside each phase.
Graphify output should be refreshed only through the repository's dedicated maintenance workflow after the implementation settles.

## Non-Goals

This refactor does not:

- adopt GraphQL;
- create a public people directory;
- create an internal professor-profile product;
- create a publication search product;
- infer undergraduate access from research activity;
- expose scraped contact information;
- treat course credit or ordinary fellowship funding as an entry pathway;
- require every Yale researcher to have a public `Person` record;
- specify production deletion commands before inventory and rollback review.

## Deferred Decisions

Grant and external funding-award persistence is not redesigned by this document.
Grant data must not be used as undergraduate-access evidence, and its long-term storage should be justified by a separate product and query requirement before the final cleanup phase.

Exact evidence-snapshot retention windows remain environment and source-policy decisions.
They must be set after production volume, sensitivity, audit value, and restoration requirements are measured.

The model permits non-faculty people when they are necessary to explain research leadership or supervision.
The detailed public-visibility policy for staff, postdoctoral researchers, graduate students, and undergraduates remains subject to source quality and privacy review.

## Implementation Notes

The current runtime contains compatibility behavior that contradicts parts of this target by design.
Implementation work must update code, migrations, tests, launch gates, search settings, and durable docs together.

Likely implementation areas include:

- `server/src/models/`;
- `server/src/services/researchGroupService.ts`;
- `server/src/services/profileService.ts`;
- `server/src/services/researchEntitySearchIndexService.ts`;
- `server/src/scrapers/entityMaterializer.ts`;
- `server/src/scrapers/accessMaterializer.ts`;
- paper and person source scrapers under `server/src/scrapers/sources/`;
- public research and profile DTOs;
- `/research`, research detail, account planning, and admin review clients;
- data migrations and integrity audits;
- `docs/research-model.md`;
- `docs/research-data-pipeline.md`;
- `docs/product-context.md`;
- `docs/decisions.md`;
- scraper and architecture skills.

Keep this document linked from the canonical research-model documentation while the phased migration is active.
When the migration is complete, the stable decisions should be folded into [`research-model.md`](./research-model.md), and this document should either become the concise historical decision record or be removed to avoid maintaining duplicate truth.
