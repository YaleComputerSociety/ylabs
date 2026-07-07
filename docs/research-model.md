# Research Model

## Current Implementation Context

The current codebase still has some legacy-named files and client components, but
runtime research data is canonical `ResearchEntity` data. Related files include:

- [`server/src/models/researchGroup.ts`](../server/src/models/researchGroup.ts)
- [`server/src/models/entryPathway.ts`](../server/src/models/entryPathway.ts)
- [`server/src/models/accessSignal.ts`](../server/src/models/accessSignal.ts)
- [`server/src/models/contactRoute.ts`](../server/src/models/contactRoute.ts)
- [`server/src/models/postedOpportunity.ts`](../server/src/models/postedOpportunity.ts)
- [`server/src/models/adminGrant.ts`](../server/src/models/adminGrant.ts)
- [`server/src/models/researchGroupMember.ts`](../server/src/models/researchGroupMember.ts)
- [`server/src/models/observation.ts`](../server/src/models/observation.ts)
- [`server/src/models/source.ts`](../server/src/models/source.ts)
- [`server/src/scrapers/entityMaterializer.ts`](../server/src/scrapers/entityMaterializer.ts)
- [`server/src/scrapers/accessMaterializer.ts`](../server/src/scrapers/accessMaterializer.ts)
- [`server/src/services/accessSummaryService.ts`](../server/src/services/accessSummaryService.ts)
- [`server/src/services/pathwaySearchService.ts`](../server/src/services/pathwaySearchService.ts)
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

Umbrella affiliations use `research_entity_relationships` with
`sourceResearchEntityId` as the center, institute, or umbrella entity and
`targetResearchEntityId` as the member lab, faculty research area, or project.
Research detail payloads expose these as related or affiliated entities so
students can see source-backed center/institute context without embedding those
relationships directly inside `ResearchEntity`.

Legacy student application submissions are preserved in `student_applications`
before dropping the old `applications` collection. The first cleanup migration
keeps the raw legacy payload for audit while normalizing known student, listing,
posted-opportunity, and research-entity references when they can be resolved.

Admin authority is represented by explicit `admin_grants` records. The analytics
admin access section lists active grants as the source of truth and reports
legacy `User.userType = "admin"` rows separately for cleanup instead of counting
them as active admins. Runtime admin authorization and authenticated client
session state must derive admin status from active grants outside local
localhost development; legacy `User.userType = "admin"` alone is not production
admin authority.

Do not embed every pathway, signal, posted opportunity, and contact route directly inside `ResearchEntity` long term. That will become query-heavy as students filter across plausible homes, access evidence, funding or pay possibilities, summer timing, beginner-friendly paths, thesis fit, Python/coding, archival work, open deadlines, and similar constraints. Prefer first-class collections for `EntryPathway`, `PostedOpportunity`, `AccessSignal`, and `ContactRoute`. Treat course credit as a formalization option after a student has identified a research home, not as an entry pathway by itself.

External researcher identity note: accepted operator inputs should prefer ORCID over Yale netid. ORCID may enrich or disambiguate an existing Yale-confirmed `User`, including `User.orcid` and manually accepted `User.googleScholarId`, but ORCID must not create a Yale person record by itself. Netid remains an internal account/scraper compatibility key and should appear only as diagnostic or converted internal target data in accepted-input workflows.

User dedupe note: scraper-created same-person user shells should be merged by rewriting active references to the canonical `User` and marking the duplicate with `archived`, `dedupedIntoUserId`, `dedupedAt`, and identity-review metadata. Integrity scans should ignore archived user shells. Same-email rows with different names are a review queue, not automatic merge evidence, unless a reviewer confirms they are the same Yale person.

## Target Conceptual Model

```txt
ResearchEntity
  has many ResearchProjects
  has many EntryPathways
  has many AccessSignals
  has many ContactRoutes
  has many People / RoleAssignments
  has many SourceEvidence records

EntryPathway
  belongs to one ResearchEntity
  may have many PostedOpportunities
  has supporting AccessSignals
  may expose FormalizationOptions
  has RecommendedNextSteps or computed CTA logic

PostedOpportunity
  belongs to one EntryPathway
  is explicit, dated, and application-like

FormalizationOption
  describes how a research relationship can be formalized after home/mentor fit
  examples include course credit, paid RA work, fellowship funding, thesis advising, or volunteer arrangement
```

Important distinction: not every `EntryPathway` is an active `PostedOpportunity`.

Older planning text may use `ResearchOpportunity` for this concept. Prefer `PostedOpportunity` in new docs and product language because it makes the distinction from exploratory pathways harder to miss.

## 2026-05-13 Model Audit

Verdict: this is still the right direction for Yale Research. The model matches the product problem because it separates what exists, how students can identify and approach a plausible research home, what evidence supports the claim, what action route is safest, how the relationship might be formalized, and which roles are real posted instances.

Keep these guardrails as the migration continues:

- Use a "thing versus route" test. A durable browseable structure is a `ResearchEntity`; the way a student participates in it is an `EntryPathway`. A fellowship program, RA program, course sequence, or center internship can be a `ResearchEntity` when it owns a profile, staff, pages, or postings. The same words can describe an `EntryPathway` when they are simply a route into another host entity.
- Keep absence of evidence computed unless a source explicitly says access is unavailable, application-only, or no-direct-contact. Avoid bulk materializing `NO_EVIDENCE` pathways or signals.
- Add structured method, timing, and constraint facets before relying on Pathways filters such as Python, archival research, wet lab, social science data, beginner-friendly, summer, or hours/week. These facets may live on `ResearchEntity`, `EntryPathway`, or `PostedOpportunity` depending on what the evidence actually supports.
- Keep course credit out of `EntryPathway`. Research for credit is a formalization pathway after the student finds a research home and mentor. Store credit eligibility/instructions as a formalization option, best-next-step hint, or source-backed evidence, not as the route by which the student discovers the home.
- Treat fellowships similarly by default: most fellowship records are funding/application-cycle formalization after a student has a mentor, project, lab, or research direction. The exception is a structured fellowship program that itself matches students with mentors, supplies a cohort experience, or provides a real application into a hosted research program; those can be `ResearchEntity`, `EntryPathway`, and/or `PostedOpportunity` records depending on the source.
- Move Explore Research access filters onto first-class `EntryPathway`, `AccessSignal`, and `PostedOpportunity` data before retiring legacy scalar fields such as `acceptingUndergrads`, `openness`, and `acceptanceConfidence`.
- Keep contact routes fail-closed. Public payloads should prefer official/public URLs, redact direct contact details from excerpts, and withhold non-public scraped contact data unless an authenticated or admin workflow explicitly allows it.

## 2026-05-13 External Yale Validation

Official Yale pages support the broader Yale Research model rather than a lab-opening-only product:

- Yale Admissions frames undergraduate research as cross-disciplinary and points to labs, professional schools, centers, museums, libraries, and fellowship funding as research infrastructure: https://admissions.yale.edu/research
- Yale College Science & QR says undergraduates access labs across Yale College, FAS departments, and professional schools, and that research can happen during the academic year or summer: https://science.yalecollege.yale.edu/yale-undergraduate-research/research-opportunities
- Department pages describe multiple ways a research relationship may be structured after a student finds a home: academic credit, work-study/pay, volunteer roles, summer RA work, direct outreach, and course-based directed research. Examples include Psychology directed research and undergraduate research FAQs: https://psychology.yale.edu/what-directed-research-course and https://psychology.yale.edu/what-undergraduate-research-opportunities-are-available
- Formal programs such as Tobin Undergraduate Research Assistantships behave like recurring `EntryPathway` programs with term-specific project/application instances, pay, hours/week, faculty sponsors, and deadlines: https://economics.yale.edu/undergraduate/tobin-ra
- Fellowship programs are not merely posted jobs. Most fellowships fund or formalize student-designed or mentor-supervised research and require proposal, mentor, eligibility, deadline, and application evidence; examples include Yale College Dean's Research Fellowship and Office of Fellowships programs: https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/yale-college-deans-research-fellowship and https://funding.yale.edu/find-funding/yale-fellowships-offered-through
- Some fellowships are closer to discovery programs. Women’s Health Research at Yale says its Undergraduate Fellowship matches students with Yale faculty mentors, and Wu Tsai says undergraduates collaborate with Wu Tsai faculty members in a structured summer program: https://medicine.yale.edu/whr/training/fellowship/ and https://wti.yale.edu/initiatives/undergraduate
- Senior essay and thesis research is a formalization and planning route, especially in humanities and social sciences, with advisor choice, prospectus/deadline structure, course credit, funding, methods, and collection/archive support. Examples include Economics, History, Environmental Studies, and Yale Library's Senior Exhibit Program: https://economics.yale.edu/undergraduate/senior-essay, https://history.yale.edu/undergraduate/senior-essay, https://evst.yale.edu/evst-senior-essay, and https://library.yale.edu/senior-exhibit-program
- Museums, libraries, cores, and centers operate as research entities and access routes. Peabody internships, Yale Library undergraduate opportunities, Yale Center for Molecular Discovery internships, and the DHLab show collections, digital methods, curatorial work, consultations, and paid/mentored internships as legitimate research pathways: https://peabody.yale.edu/education/yale-community/internships, https://library.yale.edu/help-and-research-support/help/getting-started-yale-library/undergraduates, https://research.yale.edu/cores/ycmd/summer-internships-undergraduates, and https://library.yale.edu/digital-humanities-laboratory

Product implication: keep `ResearchEntity`, `EntryPathway`, `PostedOpportunity`, `AccessSignal`, `ContactRoute`, and formalization metadata separate. The same Yale page may describe a durable entity, a recurring pathway, a specific posted opportunity, a source-backed evidence signal, a safe contact/application route, and a later formalization option. The app should preserve those distinctions so students can discover plausible homes without losing exploratory, thesis, fellowship-funded, structured-fellowship, course-credit, library, museum, and center-based research.

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

## EntryPathway

How a student might find or enter a plausible research home.

Do not model "research for credit" as an `EntryPathway`. Credit is a university formalization step after a student has found a home, mentor, and project. The product may still show credit eligibility, credit instructions, or "ask about credit" as a best next step, but the entry problem is finding the right research home and contact/application route.

Examples:

- posted role
- recurring program
- work-study
- volunteer outreach
- exploratory contact
- center/institute internship
- structured mentor-matching fellowship
- faculty supervision
- program/lab-manager contact
- thesis-adviser fit

Suggested fields:

```ts
EntryPathway {
  id: string;
  researchEntityId: string;
  pathwayType: EntryPathwayType;
  status: 'ACTIVE' | 'RECURRING' | 'PLAUSIBLE' | 'HISTORICAL' | 'NOT_CURRENTLY_AVAILABLE' | 'NO_EVIDENCE';
  evidenceStrength: 'DIRECT' | 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  studentFacingLabel: string;
  explanation?: string;
  bestNextStep?: string;
  compensation?: 'PAID' | 'STIPEND' | 'VOLUNTEER' | 'WORK_STUDY' | 'UNKNOWN';
  formalizationOptions?: Array<'COURSE_CREDIT' | 'FELLOWSHIP_FUNDING' | 'THESIS_ADVISING' | 'PAID_RA' | 'VOLUNTEER'>;
  sourceEvidenceIds: string[];
}
```

`NO_EVIDENCE` is usually a computed state, not a fact to store, unless a source explicitly supports it.

Current implementation note: existing enum values such as `COURSE_CREDIT`, `SENIOR_THESIS`, and `FELLOWSHIP_FUNDED_PROJECT` are legacy transition values. Do not expand their use for standalone funding/formalization records. Reclassify future evidence toward formalization options, thesis-fit/faculty-supervision signals, fellowship-funding compatibility, structured mentor-matching program pathways, or real posted opportunities.

## PostedOpportunity

A specific active or time-bound instance.

Examples:

- Spring 2026 RA role
- summer fellowship
- lab-posted undergraduate job
- DHLab internship

Suggested fields:

```ts
PostedOpportunity {
  id: string;
  entryPathwayId: string;
  title: string;
  term?: string;
  deadline?: Date;
  applicationUrl?: string;
  status: 'OPEN' | 'CLOSED' | 'ROLLING' | 'ARCHIVED';
  hoursPerWeek?: number;
  payRate?: string;
  eligibility?: string;
  sourceEvidenceIds: string[];
}
```

Only use `PostedOpportunity` when there is a real active, rolling, or archived instance. Do not create fake posted opportunities for general exploratory outreach.

Initial implementation note: `PostedOpportunity` is a separate collection that belongs to an `EntryPathway` and may reference an existing legacy `Listing` through optional `listingId`. Legacy listing behavior remains unchanged during migration.

Listing bridge note: legacy `Listing` rows with a `researchGroupId` now materialize into a `POSTED_ROLE` `EntryPathway`, `POSTED_OPENING` `AccessSignal`, and linked `PostedOpportunity`. Open listings with future deadlines become `OPEN`, listings without deadlines become `ROLLING`, expired/unconfirmed listings become `CLOSED`, and archived/deleted listings become `ARCHIVED`. Existing rows can be backfilled with [`data-migration/BackfillPostedOpportunitiesFromListings.ts`](../data-migration/BackfillPostedOpportunitiesFromListings.ts).

Opportunity detail note: `/api/opportunities/:id` exposes explicit public state for posted opportunities: `deadlineState`, `applicationState`, `applicationLabel`, and listing-bridged versus scraper-derived provenance. Attached observation evidence may include a short public excerpt, but direct contact details are redacted before the payload reaches the student-facing page.

## Ways-In Projection

The separate public practical-routes search endpoint and page are retired. `EntryPathway` rows still matter as internal ways-in evidence, saved planning context, and research-detail support, but they should be projected through Yale Research surfaces rather than split into a second student product.

Current behavior:

- Research search and detail payloads can use pathway type, compensation, status, evidence strength, entity type, departments, research areas, active posted opportunity, and computed best-next-step category as enrichment.
- Join host `ResearchGroup` data as the current physical `ResearchEntity` backing.
- Join active/rolling `PostedOpportunity` rows only when a real posted instance exists.
- Join a small number of supporting `AccessSignal` rows as Evidence.
- Return only guarded public contact-route summaries; do not expose non-public scraped emails.

The same contact guardrail applies to public research detail payloads: unauthenticated/public detail responses should include only public route summaries and should not expose authenticated or admin-only scraped contact data.

Contact-route ordering should prefer official applications, program/department/fellowship/course routes, and lab-manager routes before faculty-direct routes. Public ways-in cards or detail sections may link to route URLs, but they should not expose raw scraped emails.

Legacy active listings may still appear inside public research detail payloads for backwards compatibility, but those embedded listing summaries must be field allowlisted. Do not expose listing owner ids, creator ids, owner emails, collaborator emails, view counts, favorite counts, audit flags, or other authenticated/admin-oriented fields through `/api/research/:slug`.

## Saved Pathways

Student workflow depth starts with saved ways in. User accounts can now store `favPathways` as references to `EntryPathway` records, and `/account` hydrates them through the same guarded pathway projection used by research surfaces.

First-slice behavior:

- `/api/users/favPathwayIds` returns saved ids for optimistic UI state.
- `/api/users/favPathways` returns hydrated saved pathways and prunes archived or otherwise hidden pathways from the saved list.
- Saved pathway cards link back to `/research/:slug` rather than introducing a dedicated pathway detail route.
- User-owned saved pathway plans store intent, stage, notes, and checklist state.
- Saved pathway fellowship matches expose cautious source-backed reasons, caveats, public source links, and deadline/application context.
- Authenticated saved pathway export omits non-public contacts and private notes by default.

Keep saved-pathway planning and matching separate from the legacy listing/fellowship favorites board.

Planning note: saved Pathways now support user-owned planning state for intent, stage, note, and checklist data, with best-effort migration from the earlier local browser record. Keep these notes private to the owning account unless a future advising-share flow adds explicit visibility controls.

Saved Pathway cards also include route-specific checklist templates keyed by planning intent. Checklist state uses stable item ids so copy edits do not erase checked state.

Saved-pathway fellowship matching should stay source-cautious. The backend normalizes fellowship application-cycle evidence from `applicationLink`, official link rows, accepting status, dates, deadlines, and office contact context. Public match payloads may expose source URLs, application route flags, deadline status, and contact office, but should not expose direct contact emails without a guarded contact-route policy. Standalone fellowship rows usually support funding/formalization matches, not entry pathways; structured mentor-matching fellowship programs can support pathways or posted opportunities when the source describes a hosted application into the program.

## AccessSignal

Evidence-backed signal about undergraduate access.

Scrapers should not directly assert product conclusions as final truth. They should emit append-only observations/source evidence, then resolver/materializer logic should derive `AccessSignal`s. This keeps the raw evidence stable and lets signal logic evolve without rewriting scrape history. Avoid overconfident claims like `acceptingUndergrads: true`.

Operational retention note: observations remain append-only within a scraper run, but old superseded observations may be pruned by the compact-retention command after reports are captured. Active observations, recent observations, and observations from the latest retained runs per source should remain available for audit and materialization.

Initial implementation note: `accessMaterializer.ts` derives first-class access rows from legacy `Observation`s while preserving transition-era scalar fields for canonical research payloads.
It intentionally ignores YSM/YSE index-only `acceptingUndergrads=true` observations as undergraduate-access evidence unless a source provides explicit undergrad participation evidence.

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

Suggested fields:

```ts
AccessSignal {
  id: string;
  researchEntityId: string;
  entryPathwayId?: string;
  signalType: AccessSignalType;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  sourceEvidenceId: string;
  observedAt: Date;
  excerpt?: string;
}
```

Absence of evidence should usually be computed from missing signals, not stored as many `NO_EVIDENCE` records. Store negative signals only when a source explicitly states a limitation, such as application-only, not accepting students, or not currently available.

Initial materialization in [`server/src/scrapers/accessMaterializer.ts`](../server/src/scrapers/accessMaterializer.ts) derives first-class access records from raw `Observation` rows using the original observation confidence and source metadata. Independent-study and course-credit evidence now supports `CREDIT_FORMALIZATION_POSSIBLE` signals or best-next-step hints after home/mentor fit, not standalone `EntryPathway` rows. Current undergraduate counts can support `CURRENT_UNDERGRADS` plus `EXPLORATORY_CONTACT`; past undergraduate advisees can support `PAST_UNDERGRADS`, `FELLOWSHIP_COMPATIBLE`, exploratory outreach, and thesis/advising fit. Fellowship funding remains a formalization/funding-planning cue unless a real hosted program or posted opportunity exists. Contact fields can support guarded `ContactRoute` records. Entity-discovery sources such as `ysm-atoz-index` and `yse-centers-index` should not emit undergraduate-access booleans; legacy observations from those sources are ignored for access derivation unless a more explicit undergraduate evidence observation exists.

Course-credit evidence is formalization-specific, not entry-specific. The CourseTable-backed `yale-course-catalog` scraper is no longer an active source. Course-specific evidence should not create a generic exploratory outreach pathway or a `COURSE_CREDIT` entry pathway by itself. Thesis evidence should usually support thesis-fit/advising signals, formalization options, or planning next steps after a plausible mentor/home exists.

Lab-microsite LLM evidence is now shaped as observations first. It may emit `undergradAccessEvidence`, `joinPageUrl`, `undergradRoleEvidenceQuote`, `contactInstructionsQuote`, and `undergradConstraintQuote`, while keeping legacy `acceptingUndergrads` only for compatibility. `accessMaterializer.ts` derives `REACH_OUT_PLAUSIBLE`, `APPLICATION_FORM_EXISTS`, `CONTACT_INSTRUCTIONS_EXIST`, `NOT_CURRENTLY_AVAILABLE`, and guarded official application routes from those evidence observations.

Public access excerpts should redact direct contact details. The scraper may keep raw structured evidence for audit, but materialized public quote fields and `AccessSignal.excerpt` values should replace scraped emails and phone numbers before they reach student-facing payloads.

Publication and preprint evidence should enrich research activity, topics, methods, recency, and readable source context. OpenAlex, Google Scholar, and arXiv paper observations should not create undergraduate-access signals by themselves. arXiv preprints are especially useful as early evidence of active research before journal publication, but a preprint only supports access/pathway claims when combined with separate evidence such as join instructions, course/project supervision, undergrad participation, or official application routes.

Professor/lab research activity lists read from `research_scholarly_links` plus `research_scholarly_attributions` at runtime. Attribution rows are the launch proof surface for connecting a scholarly link to a Yale faculty/PI profile; entity-linked scholarly links are valid for research-entity activity without a person target. Selected publications extracted from official faculty profile pages should materialize into `research_scholarly_links` with `discoveredVia: OFFICIAL_PROFILE` and are prioritized in profile activity lists. Empty legacy paper/authorship collections, `faculty_members`, or embedded `User.publications` should not be treated as evidence. arXiv name search, Crossref DOI hydration, and Semantic Scholar paper lookup by DOI/title are metadata-only unless a populated attribution row or accepted identity proof connects the work to the Yale person.

## Source Coverage Metadata

`Source` rows can include optional `coverage` metadata seeded from [`server/src/scrapers/sourceCoverageRegistry.ts`](../server/src/scrapers/sourceCoverageRegistry.ts). Coverage records declare the source priority, source tier, artifact types a source can support, evidence categories it targets, default confidence stance, and planning notes.

This metadata is a planning and review contract, not a substitute for evidence. A source that can emit `Observation` rows should not be treated as access evidence unless the materializer maps specific observations into `EntryPathway`, `AccessSignal`, `ContactRoute`, or `PostedOpportunity` rows. Discovery-only sources such as YSM/YSE indexes remain entity discovery inputs unless explicit undergraduate-access evidence is present.

## Researcher Identity Signals

ORCID should help resolve and enrich Yale researchers, not act as an account-creation shortcut. Treat ORCID as a high-confidence external researcher identifier that can improve paper, grant, Scholar, center-roster, and faculty-page matching when it is attached to a Yale-confirmed person.

Create or promote `User` records only from Yale-controlled or Yale-corroborated identity evidence such as netid, Yale email, Yalies/Directory records, or an official Yale profile. External sources such as ORCID, OpenAlex, Google Scholar, NIH, and NSF can strengthen confidence, add identifiers, and enrich research activity, but should not by themselves create a Yale user.

Scrapers should emit ORCID and related identifiers as observations with source provenance. Resolver/materializer logic can then persist fields such as `orcid` and `openAlexId`, derive confidence, and use those identifiers to reduce name-match ambiguity.

Student-facing UI may surface ORCID as a low-prominence researcher profile link labeled `ORCID`. Do not frame it as "Verified by ORCID", do not use it as undergraduate-access evidence, and do not promote raw ORCID identifiers on search or pathway cards.

## ContactRoute

The best known way for a student to act.

Suggested fields:

```ts
ContactRoute {
  id: string;
  researchEntityId: string;
  entryPathwayId?: string;
  routeType:
    | 'OFFICIAL_APPLICATION'
    | 'LAB_MANAGER'
    | 'PROGRAM_MANAGER'
    | 'FACULTY_PI'
    | 'DEPARTMENT_CONTACT'
    | 'FELLOWSHIP_OFFICE'
    | 'COURSE_INSTRUCTOR'
    | 'UNKNOWN';
  personId?: string;
  email?: string;
  url?: string;
  priority: number;
  rationale?: string;
  visibility?: 'PUBLIC' | 'AUTHENTICATED' | 'ADMIN_ONLY';
  contactPolicy?:
    | 'OFFICIAL_ROUTE_PREFERRED'
    | 'DIRECT_CONTACT_OK'
    | 'APPLICATION_ONLY'
    | 'NO_DIRECT_CONTACT'
    | 'UNKNOWN';
  sourceEvidenceId?: string;
}
```

Contact routes need safety and quality guardrails. Prefer official routes when available and avoid turning scraped contact details into spam infrastructure.

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

## Recommended Next Steps

CTA logic may be stored or computed. Start by computing when possible; store only when admins need editorial control.

Examples:

- `POSTED_ROLE` + open application URL -> Apply
- credit formalization evidence -> Ask about credit after mentor/home fit
- fellowship funding formalization evidence -> Ask about funding after mentor/home fit
- structured mentor-matching fellowship -> Apply to structured research program
- `PLAUSIBLE` + lab manager route -> Contact lab manager
- `PLAUSIBLE` + faculty-only route -> Plan exploratory outreach
- `NO_EVIDENCE` -> Save or check back later

The student-facing vocabulary for this section should usually be "Best Next Step", not `RecommendedNextStep`.

Initial implementation note: `accessSummaryService.ts` computes a compatibility `accessSummary` for research-group search/detail payloads. This lets the UI migrate toward Pathways/Evidence/Best Next Step without removing legacy `acceptingUndergrads` fields yet.

2026-05-13 update: client API boundaries now normalize canonical `researchEntities`/`researchEntity` payloads before falling back to legacy `hits`/`group`, and Explore Research cards derive pathway summaries from `accessSummary`.

2026-05-29 update: research detail payloads may include a precomputed `studentDecisionExplanation` generated from existing source-backed pathways, access signals, contact routes, posted opportunities, and source URLs. The explanation is display-only student guidance for "Best Next Step"; it must validate against existing public evidence and must not create opportunities, expose direct scraped contact details, or override canonical access artifacts.

## Admin Review

Admins need a way to inspect derived access records before deeper editorial workflows are built.

Implementation note: `GET /api/admin/access-review` returns research entities with counts of related `EntryPathway`, `AccessSignal`, `ContactRoute`, and `PostedOpportunity` rows. `GET /api/admin/access-review/:id` returns the full derived access bundle for one entity. `PUT /api/admin/access-review/:id/manual-locks` updates manually locked entity fields, and record-level review endpoints update per-record status/notes/locks. The admin UI can inspect source evidence, update review state, manage locks, and filter records by review/evidence/contact/archive gaps before Beta.

## Product Vocabulary

Use precise internal names in code and schema docs, but use warmer labels in the UI:

- `EntryPathway` -> Ways In / ways toward a research home
- `AccessSignal` -> Evidence
- formalization metadata -> Ways to formalize
- computed CTA / `RecommendedNextStep` -> Best Next Step

Use the unified Yale Research surface as the primary student-facing experience. Internally, keep the distinction: `EntryPathway` is a durable route toward a plausible research home, `PostedOpportunity` is a real active/time-bound posting, and course credit/fellowship funding/thesis advising are formalization outcomes after home/mentor fit unless they are attached to a real hosted program, mentor-matching program, or posted application instance.

## Migration Guidance

1. Treat `/research` and `/opportunities/:id` as the canonical student-facing research routes.
2. Use `ResearchEntity`, `EntryPathway`, `AccessSignal`, `ContactRoute`, and `PostedOpportunity` for new runtime work.
3. Keep remaining `ResearchGroup`, `lab`, and `researchGroupId` naming as migration residue unless a file is explicitly part of rollback or compatibility support.
4. Add explicit `PostedOpportunity` records only for real openings, deadlines, rolling applications, or archived postings.
5. Teach scrapers to emit source evidence first, then materialize access signals/pathways/routes only when evidence supports them.
6. Rename or drop legacy physical fields and lab-named files only after Beta proves the canonical model.

Current physical strategy: hard-pivot to physical `research_entities` and canonical dependent collections. Development has copied and dropped `research_groups`, `research_group_members`, `research_group_stats`, `paper_group_links`, and leftover `applications` after verified parity. Runtime paper activity now uses `research_scholarly_links` and `research_scholarly_attributions`; empty stats and paper-entity-link collections are not part of the launch copy set.

The remaining end-to-end work is tracked in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md), including Beta seed, Pathway Meili relevance review, source blocker resolution, production scraper rollout, opportunity detail polish, data-quality operations, post-Beta legacy cleanup, and saved/advising workflow expansion.
