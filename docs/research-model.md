# Research Model

## Current Implementation Context

The current codebase still has some legacy-named files and client components, but
runtime research data is canonical `ResearchEntity` data. Related files include:

- [`server/src/models/researchGroup.ts`](../server/src/models/researchGroup.ts)
- [`server/src/models/entryPathway.ts`](../server/src/models/entryPathway.ts)
- [`server/src/models/accessSignal.ts`](../server/src/models/accessSignal.ts)
- [`server/src/models/contactRoute.ts`](../server/src/models/contactRoute.ts)
- [`server/src/models/postedOpportunity.ts`](../server/src/models/postedOpportunity.ts)
- [`server/src/models/researchGroupMember.ts`](../server/src/models/researchGroupMember.ts)
- [`server/src/models/observation.ts`](../server/src/models/observation.ts)
- [`server/src/models/source.ts`](../server/src/models/source.ts)
- [`server/src/scrapers/entityMaterializer.ts`](../server/src/scrapers/entityMaterializer.ts)
- [`server/src/scrapers/accessMaterializer.ts`](../server/src/scrapers/accessMaterializer.ts)
- [`server/src/services/accessSummaryService.ts`](../server/src/services/accessSummaryService.ts)
- [`server/src/services/pathwaySearchService.ts`](../server/src/services/pathwaySearchService.ts)
- [`server/src/routes/programs.ts`](../server/src/routes/programs.ts)
- [`docs/scraper-audit-guide.md`](./scraper-audit-guide.md)
- [`client/src/pages/research.tsx`](../client/src/pages/research.tsx)
- [`client/src/pages/labDetail.tsx`](../client/src/pages/labDetail.tsx)

`ResearchEntity` is now the canonical runtime model and uses the `research_entities` collection. `server/src/models/researchGroup.ts` retains a reusable legacy-shaped schema for the canonical model, but no runtime `ResearchGroup` model should register `research_groups`.

Public API migration note: `/api/research` is canonical. The hard-pivot migration copies `research_groups` into `research_entities` with stable ids, backfills `researchEntityId`, removes `/api/research-groups` plus `/labs` route compatibility from runtime routing, and supports canonical-only verification after the old source collection is dropped.

Dependent physical collections also use canonical names after migration. `research_entity_members`
is active; `research_entity_stats`, `paper_entity_links`, `faculty_members`, standalone `grants`,
and the unused `student_*` workflow collections were empty or superseded and are retired. The old
`research_group_members`, `research_group_stats`, `paper_group_links`, `applications`, and `listings`
collections should remain absent after cleanup.

Funding-source scrapers may still maintain compact embedded `recentGrants` data on `research_entities`
for evidence and topic enrichment, but they should not recreate a standalone `grants` collection.

Do not embed every pathway, signal, posted opportunity, and contact route directly inside `ResearchEntity` long term. That will become query-heavy as students filter across plausible homes, access evidence, funding or pay possibilities, summer timing, beginner-friendly paths, thesis fit, Python/coding, archival work, open deadlines, and similar constraints. Prefer first-class collections for `EntryPathway`, `PostedOpportunity`, `AccessSignal`, and `ContactRoute`. Treat course credit as a formalization option after a student has identified a research home, not as an entry pathway by itself.

External researcher identity note: accepted operator inputs should prefer ORCID over Yale netid. ORCID may enrich or disambiguate an existing Yale-confirmed `User`, including `User.orcid` and manually accepted `User.googleScholarId`, but ORCID must not create a Yale person record by itself. Netid remains an internal account/scraper compatibility key and should appear only as diagnostic or converted internal target data in accepted-input workflows.

Faculty profile department note: student-facing profile departments should use canonical `Department.displayName` labels such as `CPSC - Computer Science`. Raw Yale directory, roster, or school-unit labels such as `EASCPS Computer Science` and `EAS School of Engineering and Applied Science` remain in observations for auditability, but profile materialization, profile API output, and reviewed backfills should resolve them before they appear in badges, filters, or student-facing profile summaries. Broad school units should be ignored for department badges when a more specific canonical department is available. Reviewed source-unit families such as Nursing, Law, Architecture, Music, FAS departments, YSPH departments with active rows, and high-confidence Yale School of Medicine department prefixes may resolve through explicit aliases only when they map to active canonical `Department` rows. Source units without an active canonical department row, such as some centers, administrative units, Drama, Divinity, Laboratory Medicine, and Social and Behavioral Sciences, are ignored for student-facing department badges rather than guessed.

Program source metadata note: `Fellowship` rows are the current storage model for the student-facing Programs & Fellowships surface and may carry `programCategory`, `programKind`, `entryMode`, `studentFacingCategory`, mentor/eligibility flags, `bestNextStep`, `prepSteps`, `sourceName`, `sourceUrl`, `sourceKey`, `sourceFingerprint`, `sourceLastVerifiedAt`, and `sourceLastChangedAt`. Official Yale fellowship-office scraper rows upsert by source key, source/application links, then exact title. They should not be archived automatically when a source row disappears; disappearance is a review signal because expired or temporarily unavailable program pages can still be useful next-cycle planning data.

Student visibility note: `ResearchEntity` and `Fellowship` rows now share a Trust Tier projection through `studentVisibilityTier`, `studentVisibilityComputedTier`, optional `studentVisibilityOverrideTier`, `studentVisibilityReasons`, suppression/review metadata, and `studentVisibilityVersion`. The public tiers are `student_ready` and `limited_but_safe`; `operator_review` is for admin/operator review; `suppressed` is not student-visible. Research search and Program search default to the public tiers, while admin filters can inspect review and suppressed rows.

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
- Preserve source-backed expired fellowship cycles as planning evidence when the page looks recurring. They are not active applications, but they can be next-cycle signals for students, saved-pathway funding matches, and future scraper refresh targets.
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
  shortDescription?: string;
  fullDescription?: string;
  orgUnitIds: string[];
  people: PersonRole[];
  methods: string[];
  topics: string[];
  sourceEvidenceIds: string[];
  confidenceByField?: Record<string, unknown>;
  manuallyLockedFields?: string[];
}
```

Description fields use a two-field runtime model. `fullDescription` is the canonical source-backed explanation used first by detail pages and ResearchEntity search/indexing. `shortDescription` is a concise one- or two-sentence summary derived from the full description for cards and quick browsing. The legacy `description` field is deprecated compatibility state only; new scrapers and repair scripts should not emit or refill it.

## ResearchEntityRelationship

How one research home relates to another.

Use `ResearchEntityRelationship` for umbrella-to-specific-home relationships such as an institute pointing to affiliated labs, faculty research areas, hosted programs, or related research groups. This keeps an entity like Yale Quantum Institute useful as a hub without pretending it is itself the direct undergraduate entry point for every affiliated lab.

Initial runtime support lives in [`server/src/models/researchEntityRelationship.ts`](../server/src/models/researchEntityRelationship.ts), [`server/src/services/researchEntityRelationshipService.ts`](../server/src/services/researchEntityRelationshipService.ts), and the centers/institutes scraper. The first supported source family is conservative: YQI, Wu Tsai, and Yale Cancer Center member directories can create/reuse faculty-research-area targets and relate the umbrella entity to them as `MEMBER_RESEARCH_AREA` when no source-backed lab entity exists. Affiliation does not create a posted opportunity, access signal, or accepting-undergrads claim.

Suggested fields:

```ts
ResearchEntityRelationship {
  id: string;
  sourceResearchEntityId: string;
  targetResearchEntityId: string;
  relationshipType: 'AFFILIATED_LAB' | 'AFFILIATED_RESEARCH_GROUP' | 'MEMBER_RESEARCH_AREA' | 'HOSTED_PROGRAM';
  evidenceStrength: 'DIRECT' | 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  sourceUrl?: string;
  evidenceQuote?: string;
  confidence?: number;
  archived?: boolean;
}
```

## EntryPathway

How a student might find or enter a plausible research home.

Do not model "research for credit" as an `EntryPathway`. Credit is a university formalization step after a student has found a home, mentor, and project. The product may still show credit eligibility, credit instructions, or "ask about credit" as a best next step, but the entry problem is finding the right research home and contact/application route.

Examples:

- real posted opening
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

Initial implementation note: `PostedOpportunity` is a separate collection that belongs to an `EntryPathway`. Historical rows may have referenced an existing legacy `Listing` through optional `listingId`, but new posted opportunities should not carry listing-derived provenance and the Beta `listings` collection has been dropped.

Listing bridge note: legacy `Listing` rows were a transition bridge only. As of the 2026-05-15 Beta cleanup, the `listings` collection is absent, listing-backed `PostedOpportunity` rows have been deleted, listing-derived `EntryPathway` and `AccessSignal` rows have been archived, and user listing references have been cleared. Internal pathway search excludes `EntryPathway.derivationKey` values that begin with `listing:`, Meili pathway indexing excludes `postedOpportunityProvenance = LISTING_BRIDGED`, and access summaries ignore listing-derived signals/pathways/opportunities.

Scraper guidance note: legacy listings no longer guide current scraper runs after the table drop. Use source coverage, official profile URLs, reviewed accepted inputs, and admin/manual seeds for sparse-entity prioritization; scraper evidence quotes still come from fetched public pages.

Department roster fallback note: `dept-faculty-roster` official profile enrichment can backfill blank faculty-lab detail pages from the PI's official Yale profile, but faculty bios remain profile data and must not be copied verbatim into `ResearchEntity.fullDescription` or `ResearchEntity.shortDescription`. PI `researchInterests` and `topics` also remain profile data: materialization should not copy them into `ResearchEntity.researchAreas`. Detail APIs may expose them as a labeled `PI_PROFILE_FALLBACK` (`profileResearchAreas`) when no entity-specific topic evidence exists, and search indexing may use those derived terms for discoverability without treating them as independently sourced entity metadata. When no real entity description exists, detail APIs may expose a separate `profileSynthesisDescription` with `descriptionSource = PI_PROFILE_SYNTHESIS`, synthesized from PI profile topics and recent scholarly-work titles; this remains a faculty-research-area fallback and must not overwrite source-backed entity descriptions or imply undergraduate availability. Official lab-microsite evidence can still identify a real lab name, website, and source-backed homepage description; a sparse lab such as The Faboratory should remain labeled as a Lab, and its own official homepage metadata can populate `fullDescription` and derived `shortDescription` before PI-profile synthesis is used. When a lab has inferred PI ownership but no better public action route, materialization may add a guarded public `FACULTY_PI` route plus a weak `EXPLORATORY_CONTACT` pathway that points students to the official Yale profile rather than inventing an application opening. Use `yarn --cwd server research-entity:repair-copied-profile-descriptions` after profile/roster refreshes to audit and clear stale active observations or current fields where PI bios were previously copied into research-entity descriptions.

Department roster lab-vs-faculty-research note: a professor's personal homepage is not enough evidence for a `LAB` entity. `dept-faculty-roster` should classify personal faculty sites such as CS `/homes/<person>/` pages as `INDIVIDUAL_RESEARCH` / `Faculty Research` unless the link text, hostname, path, or source page explicitly indicates a lab, laboratory, or research group. This keeps discovery honest while still allowing profile-backed exploratory outreach. Use `yarn --cwd server research-entity:repair-personal-homepages` to dry-run existing false-lab rows from personal homepages; add `--apply` only after reviewing the JSON plan or providing an accepted input file.

Best-fit topic note: the detail-page `Best fit for` section is a student-facing decision aid backed by entity-level `ResearchEntity.researchAreas`. Raw PI profile `researchInterests`, `topics`, publication topics, and `PI_PROFILE_FALLBACK` values may support discoverability or profile-synthesis context, but they must not power `Best fit for` unless separately materialized from source-backed entity evidence or admin-reviewed enrichment. Use `yarn --cwd server research-entity:audit-best-fit` to audit active entities for missing, generic-only, or PI-fallback-only best-fit coverage.

Faculty profile bio resolution note: scraper observations should preserve competing professor bio candidates instead of choosing a whole-source winner during extraction. `User.bio` materialization uses field-specific scoring: richer research-area prose from faculty-controlled or lab/personal pages can beat thinner official profile prose, while official Yale/directory sources remain preferred for identity, contact, office, title, and department metadata. Generic career biographies should not displace concise research-interest text just because they are longer. Official profile bio extraction should preserve source paragraph breaks as plain-text blank lines, not collapse multi-paragraph bios into one blob or store raw HTML. Contact, office, address, directory-location text, clinical widgets, event blurbs, publication/citation snippets, and voluntary/adjunct faculty boilerplate must not materialize as a bio.

Student-facing source note: department roster/index URLs and faculty profile URLs remain useful scraper provenance, but public research detail pages should prefer action/research websites such as lab homepages, join pages, application pages, and contact pages. Roster/index pages such as `/people/faculty`, Engineering `load_faculty` roster endpoints, or YSM's lab-websites index are internal provenance only: public DTOs and detail-source builders must filter them from `sourceUrls` and must not use them as `websiteUrl`. Faculty profile URLs may remain public evidence, but they should not displace a real lab/research website as the primary website link.

Opportunity detail note: `/api/opportunities/:id` exposes explicit public state for posted opportunities: `deadlineState`, `applicationState`, `applicationLabel`, and source-derived provenance. Attached observation evidence may include a short public excerpt, but direct contact details are redacted before the payload reaches the student-facing page.

## Ways-In Enrichment

`EntryPathway` remains the internal route model for ways into a plausible research home, but public Pathways search is retired. `POST /api/research/search` is the client-facing search contract for Yale Research cards and returns research homes enriched with a small `waysIn` summary derived from `EntryPathway` data. The server may still call `pathwaySearchService` internally for research-card enrichment, research detail, saved planning, matching, admin review, and indexing workflows. Do not describe `/pathways` or `POST /api/pathways/search` as current public/student-facing contracts.

Current internal behavior:

- Live search can run through Mongo aggregation or the reviewed Meilisearch backend. Both paths must preserve the same public filters and listing-retirement guardrails.
- Filter across pathway type, compensation, status, evidence strength, entity type, departments, research areas, active posted opportunity, and computed best-next-step category.
- Research-card enrichment should prefer `ACTION_READY` pathway hits. `REFERENCE_ONLY` pathways may still support Research detail evidence, but should not populate standalone student results.
- Join host `ResearchGroup` data as the current physical `ResearchEntity` backing.
- Join active/rolling `PostedOpportunity` rows only when a real posted instance exists; listing-backed legacy artifacts should not satisfy the active posted-opportunity filter and active-opportunity joins exclude `listingId`.
- Join a small number of supporting `AccessSignal` rows as Evidence.
- Return only guarded public contact-route summaries in search cards; do not expose non-public scraped emails.
- Compute `bestNextStepCategory = apply` only for active posted opportunities or official application routes backed by application/opening/program evidence. Official routes without that evidence should fall back to `contact-program` or targeted outreach language.

`ACTION_READY` means the result has at least one concrete public route: an active/rolling `PostedOpportunity`, an official application route with application/opening/program evidence, a recurring or structured program/work-study/internship route with public source evidence, a program/department/fellowship/course contact route with source-backed instructions, or strong undergrad-participation evidence plus a public non-raw contact route. `REFERENCE_ONLY` covers weaker profile-fallback and possible-outreach records such as `FACULTY_PI` official-profile-only routes or `EXPLORATORY_CONTACT` rows backed only by `REACH_OUT_PLAUSIBLE`.

The same contact guardrail applies to public research detail payloads: unauthenticated/public detail responses should include only public route summaries and should not expose authenticated or admin-only scraped contact data.

Contact-route ordering should prefer official applications, program/department/fellowship/course routes, and lab-manager routes before faculty-direct routes. Public pathway cards may link to route URLs, but they should not expose raw scraped emails.

## Saved Research Plans

Student workflow depth starts with saved research plans. User accounts still store `favPathways` as references to `EntryPathway` records for compatibility, but `/account` now presents them as saved research plans and hydrates them through the same guarded pathway projection used by internal route search.

First-slice behavior:

- Yale Research and research-detail ways-in cards support save and unsave controls for pathway records.
- `/api/users/savedResearchPlanIds` returns saved ids for optimistic UI state.
- `/api/users/savedResearchPlans` returns hydrated saved research plans and prunes archived or otherwise hidden pathways from the saved list.
- `/api/users/savedResearchPlanDetails` stores per-plan intent, stage, notes, and checklist state.
- `/api/users/savedResearchPlanFundingMatches` exposes cautious source-backed program/fellowship matches, caveats, public source links, and deadline/application context.
- Saved research-plan cards link back to `/research/:slug` rather than introducing a dedicated pathway detail route.
- Authenticated saved research-plan export omits non-public contacts and private notes by default.

The older `/api/users/favPathway*` routes are deprecated compatibility aliases during the storage migration. Keep saved research-plan planning and matching separate from the legacy listing/program favorites board.

Planning note: saved research plans now support user-owned planning state for intent, stage, note, and checklist data, with best-effort migration from the earlier local browser record. Keep these notes private to the owning account unless a future advising-share flow adds explicit visibility controls.

Saved research-plan cards also include route-specific checklist templates keyed by planning intent. Checklist state uses stable item ids so copy edits do not erase checked state.

Saved research-plan program matching should stay source-cautious. The backend normalizes program/fellowship application-cycle evidence from `applicationLink`, official link rows, accepting status, dates, deadlines, and office contact context. Public match payloads may expose source URLs, application route flags, deadline status, next-cycle signal status, and contact office, but should not expose direct contact emails without a guarded contact-route policy. Standalone fellowship rows usually support funding/formalization matches, not entry pathways; structured mentor-matching fellowship programs can support pathways or posted opportunities when the source describes a hosted application into the program. Expired source-backed recurring cycles can remain useful matches with a "verify the next cycle" caveat, but should not be labeled as currently open.

## Programs API

`/api/programs` is canonical for the Programs & Fellowships surface. It uses program-facing route/controller/service wrappers over the current `Fellowship` storage model and supports legacy `programCategory` values plus journey fields such as `programKind`, `entryMode`, `studentFacingCategory`, `requiresMentorBeforeApply`, and `mentorMatching`. `/api/fellowships` remains a temporary compatibility alias with a deprecation header while clients migrate.

Saved program state uses `/api/users/savedProgramIds` and `/api/users/savedPrograms` as the client-facing account APIs, backed by the existing `favFellowships` storage field until a later user-data migration. Canonical client saved-state code should use `programs` and `researchPlans` names rather than fellowship/pathway favorite aliases.

## AccessSignal

Evidence-backed signal about undergraduate access.

Scrapers should not directly assert product conclusions as final truth. They should emit append-only observations/source evidence, then resolver/materializer logic should derive `AccessSignal`s. This keeps the raw evidence stable and lets signal logic evolve without rewriting scrape history. Avoid overconfident claims like `acceptingUndergrads: true`.

Operational retention note: observations remain append-only within a scraper run, but old superseded observations may be pruned by the compact-retention command after reports are captured. Active observations, recent observations, and observations from the latest retained runs per source should remain available for audit and materialization.

Initial implementation note: `accessMaterializer.ts` derives first-class access rows from legacy `Observation`s while preserving the old scalar `ResearchGroup` fields for `/labs` compatibility. It intentionally ignores YSM/YSE index-only `acceptingUndergrads=true` observations as undergraduate-access evidence unless a source provides explicit undergrad participation evidence.

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

Initial materialization in [`server/src/scrapers/accessMaterializer.ts`](../server/src/scrapers/accessMaterializer.ts) derives first-class access records from raw `Observation` rows using the original observation confidence and source metadata. Independent-study and course-credit evidence now supports `CREDIT_FORMALIZATION_POSSIBLE` signals or best-next-step hints after home/mentor fit, not standalone `EntryPathway` rows. Current undergraduate counts can support `CURRENT_UNDERGRADS` plus `EXPLORATORY_CONTACT`; past undergraduate advisees can support `PAST_UNDERGRADS`, `FELLOWSHIP_COMPATIBLE`, exploratory outreach, and thesis/advising fit. Fellowship funding remains a formalization/funding-planning cue unless a real hosted program or posted opportunity exists. Contact fields can support guarded `ContactRoute` records. Entity-discovery sources such as `ysm-atoz-index`, `yse-centers-index`, and `yale-research-official` should not emit undergraduate-access booleans; legacy observations from those sources are ignored for access derivation unless a more explicit undergraduate evidence observation exists.

Official `research.yale.edu` core facilities are `CORE_FACILITY` ResearchEntities because they represent durable Yale research infrastructure. Individual instruments, equipment, and services discovered from the cores directory remain method/topic context on the parent core in v1 rather than standalone research homes. Resource-directory rows are ingested only when they describe a durable center, institute, program, or initiative; policy/help pages remain source context and should not become pathways or posted opportunities.

Official `research.yale.edu` center/institute rows can overlap with existing official index sources such as YSE centers. The materializer should attach those observations to one unique active exact-name `ResearchEntity` when available, preserve that entity's canonical slug, and merge source provenance instead of creating a parallel `yale-research-center-*` shell.

Course-credit evidence is formalization-specific, not entry-specific. The CourseTable-backed `yale-course-catalog` scraper is no longer an active source. Course-specific evidence should not create a generic exploratory outreach pathway or a `COURSE_CREDIT` entry pathway by itself. Thesis evidence should usually support thesis-fit/advising signals, formalization options, or planning next steps after a plausible mentor/home exists.

Lab-microsite LLM evidence is now shaped as observations first. It may emit `undergradAccessEvidence`, `joinPageUrl`, `undergradRoleEvidenceQuote`, `contactInstructionsQuote`, and `undergradConstraintQuote`, while keeping legacy `acceptingUndergrads` only for compatibility. For official YSM lab microsites, the scraper may also emit source-backed `inferredPiUserId` observations when a page-level PI/director profile resolves to an existing Yale user; this is lead/ownership evidence, not an undergraduate-access claim. `accessMaterializer.ts` derives `REACH_OUT_PLAUSIBLE`, `APPLICATION_FORM_EXISTS`, `CONTACT_INSTRUCTIONS_EXIST`, `NOT_CURRENTLY_AVAILABLE`, and guarded official application routes from those evidence observations.

Reviewed lead mappings are allowed only as bounded repair artifacts for current data quality. `research-entity:coverage-repair --accepted-leads=<csv-or-json>` writes append-only `manual-admin-edit` observations for active lab-like Trust Tier missing-lead rows after resolving the supplied Yale netid to an existing `User`; the reviewed `sourceUrl` must be an official Yale page that supports the mapping. This is a current-state repair path, not a blind scraper shortcut.

Public access excerpts should redact direct contact details. The scraper may keep raw structured evidence for audit, but materialized public quote fields and `AccessSignal.excerpt` values should replace scraped emails and phone numbers before they reach student-facing payloads.

Publication and preprint evidence should enrich research activity, topics, methods, recency, and readable source context. OpenAlex, ORCID, Google Scholar, and arXiv paper observations should not create undergraduate-access signals by themselves. A paper or preprint supports "this research is active"; it supports access/pathway claims only when combined with separate evidence such as join instructions, course/project supervision, undergrad participation, or official application routes.

Student-facing research profiles now use compact `ResearchScholarlyLink` rows instead of treating full `Paper` records as the canonical public surface. OpenAlex is a queryable discovery index, not the cited source shown to students. Public cards should link to the real destination in this order when available: DOI or publisher page, PubMed/PMC, arXiv, ORCID work/profile, then OpenAlex only as a fallback pointer. Because the primary audience is Yale students with likely library subscription access, DOI/publisher links can remain primary; when a readable open-access full text/PDF is known, expose it as a secondary backup link on the same card. Errata, table-of-contents rows, retractions, and similar publication metadata chrome are not student-facing research activity. Store only compact link metadata such as title, URL, destination kind, year, venue, discovery source, confidence, optional free full-text URL/label, and minimal external ids. Do not store abstracts, citation counts, full author lists, embeddings, or paper-level search data unless a future paper-search feature explicitly reintroduces that scope.

Scholarly links are contextual evidence and can be attributed to a `User`, a `ResearchEntity`, or both through `ResearchScholarlyAttribution` rows. Person profiles should show links through `identity_authorship` or profile-publication attribution; research-detail APIs should expose one compact activity object with explicit relationship evidence instead of separate paper types. Direct entity evidence such as `explicit_entity_link` can render as `Related Research`; member-authorship evidence such as PI/profile publications should render as contextual `Recent work by <professor>` with a profile handoff. PI authorship alone is not proof that a paper is lab-specific. Runtime services should not derive public activity cards from legacy `Paper.yaleAuthorIds`, `Paper.researchEntityIds`, embedded `User.publications`, or `paper_entity_links`; those legacy stores have been removed from the active development database after compact-link migration.

Legacy-only migration anchors may exist in `research_scholarly_links` solely to preserve cleanup coverage when a historical paper row lacked a real public destination. Those anchors use low confidence, `discoveredVia = LEGACY`, and internal `legacy-paper:<sourcePaperId>` URLs; public scholarly-link services must keep filtering them out of student-facing research activity.

The active development database and codebase no longer keep Mongoose models or runtime fallbacks for `papers`, `paper_authors`, `paper_entity_links`, or embedded `User.publications`. New OpenAlex and ORCID works syncs should emit `scholarlyLink` observations that materialize into `research_scholarly_links` plus attribution rows; they should not create new canonical paper rows for the public research-profile experience. Crossref is a DOI-backed compact-link hydrator: it may improve title, venue, year, DOI destination, and readable full-text backup metadata for existing compact scholarly links, but it must not create authorship, access, pathway, contact, opportunity, or full local paper records. The legacy cleanup command is retained only as a raw Mongo readiness/drop gate for environments that have not yet completed the destructive legacy collection drop; it must not register Mongoose paper models.

## Source Coverage Metadata

`Source` rows can include optional `coverage` metadata seeded from [`server/src/scrapers/sourceCoverageRegistry.ts`](../server/src/scrapers/sourceCoverageRegistry.ts). Coverage records declare the source priority, source tier, artifact types a source can support, evidence categories it targets, default confidence stance, and planning notes.

This metadata is a planning and review contract, not a substitute for evidence. A source that can emit `Observation` rows should not be treated as access evidence unless the materializer maps specific observations into `EntryPathway`, `AccessSignal`, `ContactRoute`, or `PostedOpportunity` rows. Discovery-only sources such as YSM/YSE indexes and `research.yale.edu` official directories remain entity discovery inputs unless explicit undergraduate-access evidence is present.

## Researcher Identity Signals

ORCID should help resolve and enrich Yale researchers, not act as an account-creation shortcut. Treat ORCID as a high-confidence external researcher identifier that can improve paper, grant, Scholar, center-roster, and faculty-page matching when it is attached to a Yale-confirmed person.

Create or promote `User` records only from Yale-controlled or Yale-corroborated identity evidence such as netid, Yale email, Yalies/Directory records, or an official Yale profile. External sources such as ORCID, OpenAlex, Google Scholar, NIH, and NSF can strengthen confidence, add identifiers, and enrich research activity, but should not by themselves create a Yale user.

Scrapers should emit ORCID and related identifiers as observations with source provenance. Resolver/materializer logic can then persist fields such as `orcid` and `openAlexId`, derive confidence, and use those identifiers to reduce name-match ambiguity.

For faculty scholarly activity, use ORCID as the strongest person-identity anchor and OpenAlex as the activity/enrichment layer behind that anchor. When `User.orcid` exists, resolve the OpenAlex author by ORCID; if the resolved author differs from stored `User.openAlexId`, repair the stored author id; if ORCID does not resolve in OpenAlex, skip OpenAlex enrichment and flag review instead of falling back to a stale stored author or name match. Use stored `openAlexId` only when no ORCID exists. Name-based OpenAlex discovery is review-only and must not write `openAlexId` or authorship evidence. Prefer official Yale profile expertise for public profile topics when available; OpenAlex topics are secondary activity context.

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

### Lab Ownership vs Lab Membership

Professor/PI-like people can own or lead a `ResearchEntity`. Lab managers, PhD students, graduate students, postdocs, and administrative staff should not create standalone labs or `FACULTY_PI` contact routes by default.

Lab managers may be surfaced as `LAB_MANAGER` contact routes when attached to a professor-led lab and backed by source evidence. PhD students and postdocs may be attached as `research_entity_members`, but should not be treated as lab owners unless a future reviewed source explicitly establishes an independent PI role.

## Recommended Next Steps

CTA logic may be stored or computed. Start by computing when possible; store only when admins need editorial control.

Examples:

- `POSTED_ROLE` + real active posted opportunity/application URL -> Apply
- historical listing-derived evidence -> hidden from public Pathways; use source-backed routes or review the research profile
- credit formalization evidence -> Ask about credit after mentor/home fit
- fellowship funding formalization evidence -> Ask about funding after mentor/home fit
- structured mentor-matching fellowship -> Apply to structured research program
- `PLAUSIBLE` + lab manager route -> Contact lab manager
- `PLAUSIBLE` + faculty-only route -> Plan exploratory outreach
- `NO_EVIDENCE` -> Save or check back later

The student-facing vocabulary for this section should usually be "Best Next Step", not `RecommendedNextStep`.

Initial implementation note: `accessSummaryService.ts` computes a compatibility `accessSummary` for research-group search/detail payloads. This lets the UI migrate toward Pathways/Evidence/Best Next Step without removing legacy `acceptingUndergrads` fields yet.

2026-05-13 update: client API boundaries now normalize canonical `researchEntities`/`researchEntity` payloads before falling back to legacy `hits`/`group`, and Explore Research cards derive pathway summaries from `accessSummary`.

## Admin Review

Admins need a way to inspect derived access records before deeper editorial workflows are built.

Implementation note: `GET /api/admin/access-review` returns research entities with counts of related `EntryPathway`, `AccessSignal`, `ContactRoute`, and `PostedOpportunity` rows. `GET /api/admin/access-review/:id` returns the full derived access bundle for one entity. `PUT /api/admin/access-review/:id/manual-locks` updates manually locked entity fields, and record-level review endpoints update per-record status/notes/locks. The admin UI can inspect source evidence, update review state, manage locks, and filter records by review/evidence/contact/archive gaps before Beta.

## Product Vocabulary

Use precise internal names in code and schema docs, but use warmer labels in the UI:

- `EntryPathway` -> ways in / pathways toward a research home
- `AccessSignal` -> Evidence
- formalization metadata -> Ways to formalize
- computed CTA / `RecommendedNextStep` -> Best Next Step

Use "Pathways" as internal, advising, and route-comparison vocabulary, but do not make it a public student-facing route or navigation label. Student-facing surfaces should say "Ways in" on Yale Research cards and "saved research plans" in Account. Internally, keep the distinction: `EntryPathway` is a durable route toward a plausible research home, `PostedOpportunity` is a real active/time-bound posting, and course credit/fellowship funding/thesis advising are formalization outcomes after home/mentor fit unless they are attached to a real hosted program, mentor-matching program, or posted application instance.

## Migration Guidance

1. Treat `/research`, `/programs`, `/research/:slug`, `/opportunities/:id`, and `/account` as the canonical student-facing routes. `/pathways` is retired publicly, and `/fellowships` is a temporary redirect/compatibility alias.
2. Use `ResearchEntity`, `EntryPathway`, `AccessSignal`, `ContactRoute`, and `PostedOpportunity` for new runtime work.
3. Keep remaining `ResearchGroup` and `lab` naming as code-level migration residue unless a file is explicitly part of rollback or compatibility support; canonical runtime data should use `researchEntityId`, not `researchGroupId`.
4. Add explicit `PostedOpportunity` records only for real openings, deadlines, rolling applications, or archived postings.
5. Teach scrapers to emit source evidence first, then materialize access signals/pathways/routes only when evidence supports them.
6. Rename or drop legacy physical fields and lab-named files only after Beta proves the canonical model.

Current physical strategy: hard-pivot to physical `research_entities` and canonical dependent collections. Development has copied and dropped `research_groups`, `research_group_members`, `research_group_stats`, `paper_group_links`, leftover `applications`, legacy listing/paper collections, embedded user publication/listing references, and duplicate `research_entity_members.researchGroupId` fields after verified parity. Repeat the same backup, verify, drop, and smoke-test posture in Beta before production cleanup.

The remaining end-to-end work is tracked in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md), including Beta seed, Pathway Meili relevance review, source blocker resolution, production scraper rollout, opportunity detail polish, data-quality operations, post-Beta legacy cleanup, and saved/advising workflow expansion.
