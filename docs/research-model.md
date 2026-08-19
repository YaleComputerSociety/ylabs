# Research Model

The current runtime model is documented here.
The accepted target model, phased migration boundaries, and Phase 0 inventory runbook are documented in [`research-model-refactor.md`](./research-model-refactor.md) and [`research-model-refactor-phase0.md`](./research-model-refactor-phase0.md).
[`research-model-refactor.md`](./research-model-refactor.md), ratified 2026-08-18, is the single source of truth for the target model and supersedes the older phased framing.
Under the ratified model, `EntryPathway`, `ContactRoute`, and `PostedOpportunity` were removed (issue #363): access evidence is materialized only as typed `Signal` rows, contact is derived at read time rather than stored, and the separate pathway search index and `/pathways` and `/opportunities/:id` surfaces are gone.
This document still describes current runtime shapes such as `ResearchEntity`, `Signal`, the roster, undergraduate logistics, evidence attribution and redaction, and visibility that the ratified model renames or folds, so where this document and the refactor document disagree about the target, the refactor document wins.

## Current Implementation Context

The current codebase still has some legacy-named files and client components, but
runtime research data is canonical `ResearchEntity` data. Related files include:

- [`server/src/models/researchGroup.ts`](../server/src/models/researchGroup.ts)
- [`server/src/models/signal.ts`](../server/src/models/signal.ts)
- [`server/src/models/adminGrant.ts`](../server/src/models/adminGrant.ts)
- [`server/src/models/researchGroupMember.ts`](../server/src/models/researchGroupMember.ts)
- [`server/src/models/observation.ts`](../server/src/models/observation.ts)
- [`server/src/models/source.ts`](../server/src/models/source.ts)
- [`server/src/scrapers/entityMaterializer.ts`](../server/src/scrapers/entityMaterializer.ts)
- [`server/src/scrapers/accessMaterializer.ts`](../server/src/scrapers/accessMaterializer.ts)
- [`server/src/services/accessSummaryService.ts`](../server/src/services/accessSummaryService.ts)
- [`docs/scraper-audit-guide.md`](./scraper-audit-guide.md)
- [`client/src/pages/research.tsx`](../client/src/pages/research.tsx)
- [`client/src/pages/labDetail.tsx`](../client/src/pages/labDetail.tsx)

`ResearchEntity` is now the canonical runtime model and uses the `research_entities` collection. `server/src/models/researchGroup.ts` retains a reusable legacy-shaped schema for the canonical model, but no runtime `ResearchGroup` model should register `research_groups`.

Public API migration note: `/api/research` is canonical. The hard-pivot migration copies `research_groups` into `research_entities` with stable ids, backfills `researchEntityId`, removes `/api/research-groups` plus `/labs` route compatibility from runtime routing, and supports canonical-only verification after the old source collection is dropped.

Dependent physical membership data also uses a canonical name after migration:
`research_entity_members`. The old `research_group_members` collection can be
dropped after its data is copied and verified. Empty historical stats and
paper-entity link collections were removed from the runtime model to avoid
treating unused collections as launch evidence.

Current non-lead roster membership uses stable source identity fields on `research_entity_members`, including `identityKey`, role-specific `membershipKey`, source provenance, evidence status, and freshness expiry.
Official roster snapshots update current rows idempotently and archive disappeared rows with `endedAt` instead of deleting provenance.
Each entity retains the exact member keys, source URL, observation time, and freshness boundary of its last successful current or partial roster snapshot so a failed refresh can provide bounded grace without reviving older membership.
An unresolved name, ambiguous profile identity, stale source, missing explicitly current section, or failed optional fetch remains hidden and reviewable rather than becoming current membership.

Umbrella affiliations use `research_entity_relationships` with
`sourceResearchEntityId` as the center, institute, or umbrella entity and
`targetResearchEntityId` as the member lab, faculty research area, or project.
Research detail payloads expose these as related or affiliated entities so
students can see source-backed center/institute context without embedding those
relationships directly inside `ResearchEntity`.

Legacy student application submissions are preserved in `student_applications`
before dropping the old `applications` collection. The first cleanup migration
keeps the raw legacy payload for audit while normalizing known student, listing,
and research-entity references when they can be resolved.

Admin authority is represented by explicit `admin_grants` records. The analytics
admin access section lists active grants as the source of truth and reports
legacy `User.userType = "admin"` rows separately for cleanup instead of counting
them as active admins. Runtime admin authorization and authenticated client
session state must derive admin status from active grants outside local
localhost development; legacy `User.userType = "admin"` alone is not production
admin authority.

Do not embed every signal and logistics claim directly inside `ResearchEntity` long term.
That will become query-heavy as students filter across plausible homes, access evidence, funding or pay possibilities, summer timing, beginner-friendly paths, thesis fit, Python/coding, archival work, open deadlines, and similar constraints.
Keep access evidence in the first-class `Signal` collection instead.
Treat course credit as a formalization option after a student has identified a research home, not as access evidence by itself.

External researcher identity note: accepted operator inputs should prefer ORCID over Yale netid. ORCID may enrich or disambiguate an existing Yale-confirmed `User`, including `User.orcid` and manually accepted `User.googleScholarId`, but ORCID must not create a Yale person record by itself. Netid remains an internal account/scraper compatibility key and should appear only as diagnostic or converted internal target data in accepted-input workflows.

User dedupe note: scraper-created same-person user shells should be merged by rewriting active references to the canonical `User` and marking the duplicate with `archived`, `dedupedIntoUserId`, `dedupedAt`, and identity-review metadata. Integrity scans should ignore archived user shells. Same-email rows with different names are a review queue, not automatic merge evidence, unless a reviewer confirms they are the same Yale person.

## Conceptual Model

The ratified model in [`research-model-refactor.md`](./research-model-refactor.md) is authoritative for collection shapes.
In summary, `ResearchEntity` is the discovery center and owns its roster inline (`members`), source-backed affiliations live in `ResearchEntityRelationship`, and every source-attributed access or logistics fact is a typed `Signal` row anchored to `researchEntityId`.
There is no `EntryPathway`, `PostedOpportunity`, or `ContactRoute` collection: former pathway and posted-opportunity access evidence is expressed as `Signal` types, the contact action is derived at read time from the PI official profile link-out, and discovery and browse are the `researchentities` Meilisearch projection with `Signal` driving the trust-filter.

Durable modeling guardrails:

- Keep absence of evidence computed unless a source explicitly says access is unavailable, application-only, or no-direct-contact. Avoid bulk materializing `NO_EVIDENCE` signals.
- Treat course credit, fellowship funding, and thesis advising as formalization outcomes after a student finds a research home and mentor, not as access evidence by themselves. The exception is a structured fellowship or research program that itself matches students with mentors or hosts an application, which is its own `ResearchEntity`.
- Keep contact fail-closed and derived. Public payloads prefer official and public URLs, redact direct contact details from excerpts, and never surface scraped emails.

See [`docs/product-context.md`](./product-context.md) for the durable product framing of research-home breadth and formalization.

## 2026-05-13 External Yale Validation

Official Yale pages support the broader Yale Research model rather than a lab-opening-only product:

- Yale Admissions frames undergraduate research as cross-disciplinary and points to labs, professional schools, centers, museums, libraries, and fellowship funding as research infrastructure: https://admissions.yale.edu/research
- Yale College Science & QR says undergraduates access labs across Yale College, FAS departments, and professional schools, and that research can happen during the academic year or summer: https://science.yalecollege.yale.edu/yale-undergraduate-research/research-opportunities
- Department pages describe multiple ways a research relationship may be structured after a student finds a home: academic credit, work-study/pay, volunteer roles, summer RA work, direct outreach, and course-based directed research. Examples include Psychology directed research and undergraduate research FAQs: https://psychology.yale.edu/what-directed-research-course and https://psychology.yale.edu/what-undergraduate-research-opportunities-are-available
- Formal programs such as Tobin Undergraduate Research Assistantships behave like recurring programs with term-specific project/application instances, pay, hours/week, faculty sponsors, and deadlines: https://economics.yale.edu/undergraduate/tobin-ra
- Fellowship programs are not merely posted jobs. Most fellowships fund or formalize student-designed or mentor-supervised research and require proposal, mentor, eligibility, deadline, and application evidence; examples include Yale College Dean's Research Fellowship and Office of Fellowships programs: https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/yale-college-deans-research-fellowship and https://funding.yale.edu/find-funding/yale-fellowships-offered-through
- Some fellowships are closer to discovery programs. Women’s Health Research at Yale says its Undergraduate Fellowship matches students with Yale faculty mentors, and Wu Tsai says undergraduates collaborate with Wu Tsai faculty members in a structured summer program: https://medicine.yale.edu/whr/training/fellowship/ and https://wti.yale.edu/initiatives/undergraduate
- Senior essay and thesis research is a formalization and planning route, especially in humanities and social sciences, with advisor choice, prospectus/deadline structure, course credit, funding, methods, and collection/archive support. Examples include Economics, History, Environmental Studies, and Yale Library's Senior Exhibit Program: https://economics.yale.edu/undergraduate/senior-essay, https://history.yale.edu/undergraduate/senior-essay, https://evst.yale.edu/evst-senior-essay, and https://library.yale.edu/senior-exhibit-program
- Museums, libraries, cores, and centers operate as research entities and access routes. Peabody internships, Yale Library undergraduate opportunities, Yale Center for Molecular Discovery internships, and the DHLab show collections, digital methods, curatorial work, consultations, and paid/mentored internships as legitimate research access routes: https://peabody.yale.edu/education/yale-community/internships, https://library.yale.edu/help-and-research-support/help/getting-started-yale-library/undergraduates, https://research.yale.edu/cores/ycmd/summer-internships-undergraduates, and https://library.yale.edu/digital-humanities-laboratory

Product implication: a single Yale page may describe a durable research entity, source-backed access evidence, a safe official-application or contact route, and a later formalization option all at once. The current model expresses the entity as `ResearchEntity`, the access and logistics evidence as typed `Signal` rows, and the contact action as a derived official-profile link-out, so students can discover plausible homes without losing exploratory, thesis, fellowship-funded, structured-fellowship, course-credit, library, museum, and center-based research.

## ResearchEntity

What exists.

Examples:

- lab
- center
- institute
- faculty research area
- faculty project
- digital humanities initiative
- collections/archive project
- RA program
- fellowship program
- course sequence

Suggested fields:

```ts
ResearchEntity {
  id: string;
  name: string;
  slug: string;
  entityType: ResearchEntityType;
  description?: string;
  orgUnitIds: string[];
  people: PersonRole[];
  methods: string[];
  topics: string[];
  sourceEvidenceIds: string[];
  confidenceByField?: Record<string, unknown>;
  manuallyLockedFields?: string[];
}
```

## Access Evidence (formerly EntryPathway and PostedOpportunity)

`EntryPathway` and `PostedOpportunity` were removed (issue #363), along with the separate public practical-routes search endpoint and page and the `/api/opportunities/:id` detail surface.
Ways-in and posted-opening evidence is now expressed as typed access `Signal` rows (for example `POSTED_OPENING`, `CURRENT_UNDERGRADS`, `REACH_OUT_PLAUSIBLE`, `NOT_CURRENTLY_AVAILABLE`), anchored to `researchEntityId` and projected through the Yale Research surfaces as profile, evidence, and planning context rather than split into a second student product.
`NO_EVIDENCE` remains a computed state, not a stored fact, unless a source explicitly supports it.
Course credit, fellowship funding, and thesis advising remain formalization outcomes after home and mentor fit, not access evidence by themselves, unless a source describes a structured hosted or mentor-matching program that is its own `ResearchEntity`.

Yale Research does not host faculty-authored labs or opportunities.
Research homes and official application routes enter the product only through source-backed ingestion; there is no runtime faculty authoring surface.
Legacy `Listing` reads, outreach, claims, and view tracking remain as authenticated compatibility routes, but listing authoring is retired and the former Listing-to-`PostedOpportunity` bridge is gone; creating or updating a listing now only syncs its `ResearchEntity` profile.

## Research Detail Projection

Discovery and browse run on the `researchentities` Meilisearch index; the detail page derives its view live from canonical `ResearchEntity` data. There is no separate ways-in product surface.

Current behavior:

- Research search and detail payloads use entity type, departments, research areas, access `Signal`s, and a computed best-next-step category as enrichment.
- Student-facing browse status counts matching research homes and people.
- Detail payloads join a small number of supporting access `Signal` rows as Evidence.
- Contact is derived at read time, never stored: public payloads expose only the official-profile link-out and never non-public scraped emails.

Public research detail payloads derive `leadIdentityStatus` and the optional `leadProfessorPublicKey` on the server from canonical identity checks and a unique match between entity-owned official-profile evidence and a lead member.
These evidence fields do not select one person for display when an entity has multiple principal investigators.
The detail page shows exactly one verified principal investigator once as the full card in the decision summary, shows multiple principal investigators together in a dedicated plural section, and withholds the card while lead identity is under review.

The PI action is the official profile link-out. `resolveDecisionProfileUrl` derives it from profile-like `websiteUrl`/`sourceUrls`, excluding department-roster provenance URLs and the entity's own non-profile website, and returns nothing while lead identity is under review. Public cards or detail sections may link to that guarded official URL, but must not expose raw scraped emails or imply yLabs has verified a reachable official outreach channel.

Legacy active listings may still appear inside public research detail payloads for backwards compatibility, but those embedded listing summaries must be field allowlisted. Do not expose listing owner ids, creator ids, owner emails, collaborator emails, view counts, favorite counts, audit flags, or other authenticated/admin-oriented fields through `/api/research/:slug`.

## Saved Research Entities

Student workflow depth starts with saved research profiles.
User accounts store `savedResearchEntities` as references to first-class `ResearchEntity` records, so a student can save a research home even when it has no access evidence.
The `/account` planning workspace hydrates bounded entity summaries and treats access evidence as optional enrichment.

Current behavior:

- `/api/users/savedResearchEntityIds` returns canonical entity ids for optimistic UI state.
- `/api/users/savedResearchEntities` returns allowlisted entity summaries, bounds `shortDescription` to 300 characters and `description` to 1,000 characters, and prunes archived, hidden, or deleted entities.
- `PUT` and `DELETE /api/users/savedResearchEntities` add and remove entity-owned saves for the authenticated account.
- `/api/users/savedResearchEntityPlans` stores the owning student's sanitized planning details, keyed by entity id.
- `GET /api/users/savedResearchEntityPlans/export` exports saved entities without private notes.
- `POST /api/users/savedResearchEntityPlans/export` includes private notes only when `includePrivateNotes: true` is explicitly supplied.
- Private plan and export responses use private no-store handling, and exports never include non-public contact emails.
- Saved profile cards link back to `/research/:slug` rather than introducing a separate planning-detail route.

The `favPathways` saving feature was removed (issue #363): the `/users/favPathways*` endpoints and the client saved-pathways section are gone, and saving is covered entirely by saved research entities and their plans.
The `User.favPathways` and `User.savedPathwayPlans` schema fields are intentionally left in place so the legacy data survives a later human-gated migration, but no reader consumes them: `migrateSavedResearchEntitiesForUser` is now prune-only, hydrating and pruning `savedResearchEntities` plus `savedResearchEntityPlans` against current visibility without importing legacy pathway saves.

Keep saved-entity planning separate from the legacy listing favorites.
Entity plans support user-owned intent, stage, note, checklist state and history, target deadline, acted-on date, and follow-up interval.
Keep these notes private to the owning account unless a future advising-share flow adds explicit visibility controls.

Saved research cards include route-specific checklist templates keyed by planning intent.
Checklist state uses stable item ids so copy edits do not erase checked state.

Pathway-based fellowship matching was removed with `EntryPathway`; `fellowshipMatchingService` is now a stub returning no matches, and fellowship discovery lives on the programs and funding surface.

## Access Signals

Undergraduate-access evidence is now stored as `Signal` rows in the `signals` collection; the standalone `AccessSignal` model was folded into the unified `Signal` model.
Each former `AccessSignal` `signalType` (`POSTED_OPENING`, `CURRENT_UNDERGRADS`, `NOT_CURRENTLY_AVAILABLE`, and so on) is now its own `Signal.type`, and the `HIGH`/`MEDIUM`/`LOW` `confidence` plus `confidenceScore` gradient is preserved because it drives the browse trust-filter.
See the [`Signal`](./research-model-refactor.md#signal-signals) coverage in the ratified refactor document for the authoritative field shape.

Scrapers should not directly assert product conclusions as final truth. They should emit append-only observations/source evidence, then resolver/materializer logic should derive access `Signal`s. This keeps the raw evidence stable and lets signal logic evolve without rewriting scrape history. Avoid overconfident claims like `acceptingUndergrads: true`.

Operational retention note: observations remain append-only within a scraper run, but old unreferenced superseded observations may be pruned by the compact-retention command after reports are captured.
Active observations, recent observations, observations from the latest retained runs per source, supersession links, and observations referenced by durable materialized or rollback records remain available for audit and materialization.
The authoritative operator procedure and environment restrictions are in `docs/scraper-deployment-runbook.md`.

`accessMaterializer.ts` derives first-class access rows from legacy `Observation`s. It intentionally ignores YSM/YSE index-only `acceptingUndergrads=true` observations as undergraduate-access evidence unless a source provides explicit undergrad participation evidence.

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

Initial materialization in [`server/src/scrapers/accessMaterializer.ts`](../server/src/scrapers/accessMaterializer.ts) derives access `Signal` rows from raw `Observation` rows using the original observation confidence and source metadata. Independent-study and course-credit evidence supports `CREDIT_FORMALIZATION_POSSIBLE` signals or best-next-step hints after home/mentor fit. Current undergraduate counts can support `CURRENT_UNDERGRADS`; past undergraduate advisees can support `PAST_UNDERGRADS` and `FELLOWSHIP_COMPATIBLE`. Fellowship funding remains a formalization/funding-planning cue unless a real hosted program exists. Contact stays derived at read time, not materialized into stored routes. Entity-discovery sources such as `ysm-atoz-index` and `yse-centers-index` should not emit undergraduate-access booleans; legacy observations from those sources are ignored for access derivation unless a more explicit undergraduate evidence observation exists.

Course-credit evidence is formalization-specific, not entry-specific. The CourseTable-backed `yale-course-catalog` scraper is no longer an active source. Course-specific evidence should not by itself create a generic exploratory-outreach or course-credit access signal. Thesis evidence should usually support thesis-fit/advising signals, formalization options, or planning next steps after a plausible mentor/home exists.

Lab-microsite LLM evidence is now shaped as observations first. It may emit `undergradAccessEvidence`, `joinPageUrl`, `undergradRoleEvidenceQuote`, `contactInstructionsQuote`, and `undergradConstraintQuote`, while keeping legacy `acceptingUndergrads` only for compatibility. `accessMaterializer.ts` derives `REACH_OUT_PLAUSIBLE`, `APPLICATION_FORM_EXISTS`, `CONTACT_INSTRUCTIONS_EXIST`, and `NOT_CURRENTLY_AVAILABLE` signals from those evidence observations.

Public access excerpts should redact direct contact details. The scraper may keep raw structured evidence for audit, but materialized public quote fields and `Signal.source.excerpt` values should replace scraped emails and phone numbers before they reach student-facing payloads.

The bibliographic ingestion pipeline is retired, so OpenAlex, arXiv, ORCID works, Europe PMC, PubMed, and Crossref are not research-activity, access, or description inputs.
Reviewed Google Scholar and ORCID links remain outbound researcher navigation only.
Historical source rows and observations, the guarded materializer, rollback audits, and stored paper and scholarly collections remain temporarily available for an explicit rollback under issue #207.
See [Retire The Bibliographic Paper Pipeline](./decisions.md#2026-07-26-retire-the-bibliographic-paper-pipeline) for the authoritative product decision and [Publication and Professor-Profile Decision](./research-model-refactor.md#publication-and-professor-profile-decision) for the target model.

## Undergraduate Logistics

Logistics evidence is now stored as `Signal` rows in the `signals` collection; the standalone `UndergraduateLogisticsClaim` model was folded into the unified `Signal` model.
Each former claim type (`STUDENT_LEVEL`, `COMPENSATION`, `TIME_COMMITMENT`, `MODALITY`, `CURRENT_AVAILABILITY`) is now its own `Signal.type` carrying a `status` and a structured `value`.
See the [`Signal`](./research-model-refactor.md#signal-signals) coverage in the ratified refactor document for the authoritative field shape.

Each known logistics `Signal` requires a validated official public source URL, an exact supporting excerpt, observation time, expiry time, and source-run lineage.
The logistics materializer does not use confidence to choose a winner.
Matching fresh observations may reinforce a logistics signal, distinct fresh values produce `CONFLICTING_WITHHELD`, and evidence that has exceeded its type-specific freshness window produces `STALE_UNDER_REVIEW`.
Missing observations archive an old materialized row and the public DTO computes a neutral `unknown` state instead of a negative answer.
An explicit source-backed negative such as `NOT_CURRENTLY_AVAILABLE` remains a known value until its short availability freshness window expires.
Public payloads expose only the allowlisted value and public evidence for known logistics signals.
They never expose observation identifiers, scrape-run identifiers, internal source names, confidence, or direct contact data.

## Source Coverage Metadata

`Source` rows can include optional `coverage` metadata seeded from [`server/src/scrapers/sourceCoverageRegistry.ts`](../server/src/scrapers/sourceCoverageRegistry.ts). Coverage records declare the source priority, source tier, artifact types a source can support, evidence categories it targets, default confidence stance, and planning notes.

This metadata is a planning and review contract, not a substitute for evidence. A source that can emit `Observation` rows should not be treated as access evidence unless the materializer maps specific observations into `Signal` rows. Discovery-only sources such as YSM/YSE indexes remain entity discovery inputs unless explicit undergraduate-access evidence is present.

## Researcher Identity Signals

ORCID may disambiguate a Yale-confirmed researcher and support a reviewed outbound profile link, but it must not act as an account-creation shortcut or a works feed.

Create or promote `User` records only from Yale-controlled or Yale-corroborated identity evidence such as netid, Yale email, Yalies/Directory records, or an official Yale profile.
Reviewed ORCID and Google Scholar profiles may support disambiguation and outbound navigation, while NIH and NSF may enrich grant context, but none should create a Yale user by itself.

Official Yale sources may emit ORCID identity observations with source provenance.
The retired OpenAlex pipeline must not supply new researcher identity or activity data.

Student-facing UI may surface ORCID as a low-prominence researcher profile link labeled `ORCID`. Do not frame it as "Verified by ORCID", do not use it as undergraduate-access evidence, and do not promote raw ORCID identifiers on search cards.

## Contact

The `ContactRoute` collection was removed (issue #363). Contact is now derived, not stored: the PI action is the official profile link-out from the `Researcher` official profile (`YALE_OFFICIAL`) or `ResearchEntity.websiteUrl`, redaction is a projection rule, and scraped emails are never surfaced in a public payload. See the [`Derived, not stored`](./research-model-refactor.md#derived-not-stored) section of the ratified refactor document.

## Role Assignments

Use flexible roles instead of hard-coded STEM hierarchy.

Examples:

- PI
- faculty supervisor
- project lead
- graduate mentor
- postdoc mentor
- lab manager
- program manager
- librarian consultant
- curator
- undergraduate RA
- student intern
- thesis adviser
- collaborator

This supports STEM labs, social science centers, economics RA programs, digital humanities teams, library/museum projects, and fellowship-supervised independent research.

Student-facing roster groups are intentionally coarse: postdoctoral researchers, graduate students, undergraduate researchers, research staff, faculty, and other current members.
The exact official title remains visible as source context, and roster membership never becomes a contact recommendation or access claim.

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

The student-facing vocabulary for this section should usually be "Best Next Step", not `RecommendedNextStep`.

Initial implementation note: `accessSummaryService.ts` computes a compatibility `accessSummary` for research search/detail payloads. This lets the UI present Evidence and Best Next Step without removing legacy `acceptingUndergrads` fields yet.

2026-05-13 update: client API boundaries now normalize canonical `researchEntities`/`researchEntity` payloads before falling back to legacy `hits`/`group`, and Explore Research cards derive access summaries from `accessSummary`.

2026-05-29 update: research detail payloads may include a precomputed `studentDecisionExplanation` generated from existing source-backed access signals and source URLs. The explanation is display-only student guidance for "Best Next Step"; it must validate against existing public evidence and must not expose direct scraped contact details or override canonical access artifacts.

## Admin Review

Admins need a way to inspect derived access records before deeper editorial workflows are built.

Implementation note: `GET /api/admin/access-review` filters, sorts, and paginates the environment-local `AdminAccessReviewProjection` before it hydrates the selected parent `ResearchEntity` rows.
The projection stores only bounded normalized word suffixes that preserve case-insensitive substring search, sort keys, aggregate counts, the parent reference, and reconciliation state.
Canonical access-record services invalidate the affected generation in the same transaction as a write and recompute it afterward, so concurrent writes cannot clear a newer invalidation.
The list checks readiness and performs projection, progress-count, and parent-hydration reads sequentially in one snapshot transaction, so concurrent invalidation cannot produce a partially current response.
The list fails with a temporary unavailable response when the projection is uninitialized, rebuilding, or stale.
`GET /api/admin/access-review/:id` remains a separate full derived access bundle for one entity rather than reading through the list projection.
`PUT /api/admin/access-review/:id/manual-locks` updates manually locked entity fields, and record-level review endpoints update per-record status, notes, and locks.
The access-review records are now access `Signal` rows only.
The admin UI can inspect source evidence, update review state, manage locks, and filter records by review, evidence, and archive gaps before Beta.

## Product Vocabulary

Use precise internal names in code and schema docs, but use warmer labels in the UI:

- access `Signal`s (ways-in and logistics evidence) -> Evidence
- formalization metadata -> Ways to formalize
- computed CTA / `RecommendedNextStep` -> Best Next Step

Use the unified Yale Research surface as the primary student-facing experience. Course credit, fellowship funding, and thesis advising are formalization outcomes after home/mentor fit unless they are attached to a real hosted or mentor-matching program that is its own `ResearchEntity`.

## Migration Guidance

1. Treat `/research` and `/research/:slug` as the canonical student-facing research routes.
2. Use `ResearchEntity`, `Signal`, and `ResearchEntityRelationship` for new runtime work.
3. Keep remaining `ResearchGroup`, `lab`, and `researchGroupId` naming as migration residue unless a file is explicitly part of rollback or compatibility support.
4. Teach scrapers to emit source evidence first, then materialize access signals only when evidence supports them.
5. Rename or drop legacy physical fields and lab-named files only after Beta proves the canonical model.

### Canonical schema versions and database validators

Each new canonical collection owns an independent positive integer `schemaVersion`.
New documents default to that collection's current version, while explicitly supported older versions remain readable during a bounded migration.
Collections must not share one lockstep application-wide schema version.

The shared version field and BSON property builders live in [`server/src/models/canonicalSchemaVersion.ts`](../server/src/models/canonicalSchemaVersion.ts).
MongoDB validator definitions use `validationLevel: moderate` and `validationAction: error` during migration so new conforming writes are protected without pretending that legacy documents were backfilled.
Moderate validation does not prove reference integrity, backfill missing versions, or make an old document canonical.

Validator plans must be deterministic, dry-run reviewable, and limited to an explicit desired collection registry.
The pure planner in [`server/src/scripts/canonicalMongoValidatorsCore.ts`](../server/src/scripts/canonicalMongoValidatorsCore.ts) does not connect to MongoDB or apply commands.
The guarded operator command compares current collection options, requires a reviewed dry-run artifact plus environment-bound confirmation before writes, and never runs during application startup.
Use the exact environment workflow and rollback guidance in the [`Canonical MongoDB Validator Runbook`](./canonical-mongodb-validator-runbook.md).

### Phase 1 evidence and planning schema foundation

The versioned `ResearchPlan`, `SourceDocument`, `EvidenceClaim`, and `ReviewDecision` schemas establish storage contracts without adding runtime routes, scraper writers, materializers, Meilisearch documents, or migrations.
The existing `Source` and `StudentEngagementEvent` models remain the canonical source registry and analytics event model.

`ResearchPlan` is account-owned and private by default.
Notes, checklists, and deadlines are excluded from normal queries, and each export category requires an explicit opt-in preference.

`SourceDocument` stores a source-scoped normalized document key, a content hash, bounded metadata, and an optional protected snapshot pointer.
Its source metadata and snapshot pointer are excluded from normal queries.
It may record credential-free HTTP(S) URLs, but storing a URL neither trusts nor fetches it.
Any later outbound fetch from a stored URL must use [`server/src/utils/ssrfGuard.ts`](../server/src/utils/ssrfGuard.ts).
It does not embed raw fetched content and it has no automatic TTL because retention decisions depend on source policy.

`EvidenceClaim` accepts only predicates in the versioned registry in [`server/src/models/evidencePredicateRegistry.ts`](../server/src/models/evidencePredicateRegistry.ts).
Claim values are bounded, excluded from normal queries, and `ADMIN_ONLY` unless a later reviewed workflow explicitly lowers sensitivity.
Claims retain source evidence separately from the materialized domain records they may later support.

`ReviewDecision` is an append-only audit record with a protected account reviewer.
A later decision may point backward to one decision it supersedes, while the original decision remains unchanged.

These collections may coexist empty with the current runtime.
No current scraper or public read path should write or consume them until a later cutover phase adds reconciliation and explicit operational gates.
Per the ratified model in [`research-model-refactor.md`](./research-model-refactor.md), the heavy evidence claim-graph (`EvidenceClaim`, `SourceDocument`, `ReviewDecision`) is frozen as unwired do-not-build-on contracts, and the live evidence path is `Observation` to `Signal`, not `Observation` to `EvidenceClaim`.

### Phase 5 materialized provenance foundation

The `MaterializedProvenance` embedded schema was removed as dead code, because it was unattached and referenced only by its own test.
Per the ratified model in [`research-model-refactor.md`](./research-model-refactor.md), the heavy governed evidence claim-graph is deferred, and the lightweight `Observation` to `Signal` pipeline covers the product, so there is no live materializer that needs a provenance sidecar.
The frozen `EvidenceClaim`, `SourceDocument`, and `ReviewDecision` contracts remain in the repository as unwired do-not-build-on foundations; see the note in the Phase 1 evidence and planning schema foundation section above.

### Phase 1 bounded canonical read contracts

[`canonicalDomainLoaders.ts`](../server/src/services/canonicalDomainLoaders.ts) defines reusable, read-only loaders for public person identity, current approved roles, active organizations, approved taxonomy terms, public evidence metadata, and account-owned research plans.
Every batch is capped at 100 identifiers or results, accepts only primitive or real `ObjectId` identifiers, selects an explicit field list, and preserves the owning account boundary for research plans.
The default research-plan read excludes private notes, checklists, and deadlines, and selecting those fields requires an explicit owner-scoped request.

[`canonicalPublicProjections.ts`](../server/src/services/canonicalPublicProjections.ts) defines the only Phase 1 public `Person` projection, bounded public evidence metadata, and the bounded `ResearchEntity.discovery` projection.
The public person projection includes a selected reviewed primary profile and at most two reviewed researcher-profile links whose health is not known to be unavailable.
It omits account links, identifiers without reviewed public links, direct contact data, mirrored profile fields, and unavailable or future-verified candidates.
An `UNKNOWN` person requires a current approved role to render, while `DEPARTED` always fails closed even if a stale role remains current.
Public evidence projection omits claim values, excerpts, source-document references, raw source documents, review notes, rejected claims, and diagnostics.

`ResearchEntity.discovery` contains no more than eight deduplicated leads, 120-character summary fields, an active-opportunity count capped at 9,999, a bounded browse-rank score, a controlled visibility state, and `computedAt`.
It is a rebuildable cache, not canonical evidence.
`accessState` remains bounded text in Phase 1 because the accepted model has not established a governed access-summary vocabulary.
The later runtime cutover must govern it before using it as a filter or facet.
Every successful canonical materializer commit or moderated canonical write that changes an input must recompute affected entities after the authoritative write commits.
A reconciliation pass must run at least every six hours to repair missed invalidations, projection construction rejects future timestamps, and readers require recomputation for missing, previously persisted future-dated, or more-than-24-hour-old projections.

These loaders and projections are not wired to live REST routes, Meilisearch, materializer writes, or migration code in Phase 1.

### Phase 2 read-only identity planning foundation

[`phase2IdentityMigrationPlannerCore.ts`](../server/src/scripts/phase2IdentityMigrationPlannerCore.ts) deterministically separates planned `Account`, `Person`, and `RoleAssignment` rows from identity and membership quarantine cases.
The planner never creates a person from ORCID or Google Scholar alone, never merges people on name alone, preserves historical roles, and rejects unresolved explicit membership references instead of falling back to names.
[`phase2IdentityMigrationPlan.ts`](../server/src/scripts/phase2IdentityMigrationPlan.ts) reads bounded legacy snapshots and writes a private mode-`0600` dry-run artifact without writing canonical collections or redirecting runtime readers.
Use the exact environment and review workflow in the [`Phase 2 identity-plan runbook`](./research-model-refactor-phase2-identity-plan.md).
This repository foundation does not complete Phase 2 and remains operationally blocked on accepted Phase 0 and Phase 1 exits.

### Phase 4 reviewed legacy-record classification foundation

[`legacyResearchRecordClassification.ts`](../server/src/services/legacyResearchRecordClassification.ts) defines a bounded, deterministic planner for the one-time classification of legacy `Listing` and `Fellowship` records.
Operators must supply an explicit valid review timestamp so deadline-based classifications are reproducible and never depend on the process wall clock.
It distinguishes real research-role postings, research programs that provide an entry route, formalization-only funding or thesis records, non-research archives, and unresolved records that require manual review.
The planner adds a `PostedOpportunity` suggestion only when a program has a safe public application URL plus affirmative accepting evidence or a non-expired application deadline.
Every output remains a suggestion with required `PENDING` review, a null owner, and a null decision.
The private review output retains only the legacy source identifier and a syntactically valid candidate canonical target identifier when one exists.
It copies no free-form record content or contact fields and has no persistence capability.
Listing suggestions require the caller to affirm that the canonical `ResearchEntity` exists, and fellowship pathway suggestions require reviewed research relevance plus a direct program, project, or mentor-matching entry mode.
Mentor-first funding remains formalization-only, and an expired deadline accompanying a safe application URL or contradictory application-window evidence fails closed to manual review.
A later guarded Phase 4 migration must consume separately accepted review decisions rather than treating planner output as permission to write.
The planner does not authorize target-collection writes, runtime reader changes, saved-plan migration, or Meilisearch changes before the earlier phase gates exit.

Current physical strategy: hard-pivot to physical `research_entities` and canonical dependent collections. Development has copied and dropped `research_groups`, `research_group_members`, `research_group_stats`, `paper_group_links`, and leftover `applications` after verified parity. Runtime paper activity now uses `research_scholarly_links` and `research_scholarly_attributions`; empty stats and paper-entity-link collections are not part of the launch copy set.

The remaining end-to-end work is tracked in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md), including Beta seed, source blocker resolution, production scraper rollout, data-quality operations, post-Beta legacy cleanup, and saved/advising workflow expansion.
