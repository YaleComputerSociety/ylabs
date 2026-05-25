# Decisions

Use this file for concise, dated decisions that should outlive an individual chat or implementation session. Do not paste transcripts.

## 2026-05-07: North Star Is Research Navigation, Not Lab Openings

Yale Research should make the hidden undergraduate research ecosystem legible: where formal openings exist, where credible pathways exist, and how students can move from curiosity to a specific, evidence-based next step.

Consequences:

- Do not frame the product as a simple job board.
- Support exploratory discovery even when no active posting exists.
- Model labs, centers, institutes, faculty projects, fellowships, RA programs, thesis planning, and credit/funding/pay formalization after home fit.

## 2026-05-07: Separate EntryPathway From PostedOpportunity

An `EntryPathway` is a durable way a student might enter research. A `PostedOpportunity` is a specific active or time-bound instance. Older planning text may use `ResearchOpportunity`; prefer `PostedOpportunity` going forward.

Consequences:

- Not every pathway is an active opportunity.
- Tobin RA as a recurring route and Spring 2026 Tobin roles as specific posted opportunities can both be represented cleanly.
- Exploratory outreach should be modeled as a pathway, not as a fake open role.

Updated 2026-05-13: research for credit is not an entry pathway. Credit, paid RA work, fellowship funding, thesis advising, and similar arrangements are formalization outcomes after a student identifies a plausible research home and mentor unless they are attached to a real hosted program, mentor-matching program, or posted opportunity.

## 2026-05-07: Replace Binary Acceptance With Access Signals

Avoid binary fields such as `acceptingUndergrads`.

Consequences:

- Scrapers should produce evidence and observations that resolver/materializer logic can derive into access signals.
- Product language should say things like posted opening, recurring pathway, credit formalization possible, reach-out plausible, application-only, or no evidence yet.
- Evidence strength and source links matter more than overconfident yes/no claims.
- Absence of evidence should usually be computed, not stored as many negative records.

## 2026-05-07: Evolve Current ResearchGroup Conservatively

The existing code has `ResearchGroup` and `/labs` surfaces. The target concept is broader: `ResearchEntity`.

Consequences:

- Keep current behavior working while adding broader entity/pathway/signal concepts.
- Do not embed every pathway, signal, posted opportunity, and contact route directly inside `ResearchGroup` long term; filtering needs first-class collections.
- Rename collections/routes only after the product model is stable.
- Relevant current files include [`server/src/models/researchGroup.ts`](../server/src/models/researchGroup.ts), [`client/src/pages/labs.tsx`](../client/src/pages/labs.tsx), and [`client/src/pages/labDetail.tsx`](../client/src/pages/labDetail.tsx).

Superseded on 2026-05-13 by the hard-pivot ResearchEntity migration decision below.

## 2026-05-07: Use Two Main Product Surfaces

The app should support both exploration and practical entry.

Consequences:

- Explore Research: curiosity-first browsing of research structures.
- Pathways: practical filtering by participation mode, timing, methods, eligibility, and next step.
- Explicit posted opportunities should be highlighted when real, but the app should remain useful without active postings.

## 2026-05-07: Compute Recommended Next Steps First

Recommended next steps should be computed from pathway status, contact routes, deadlines, application URLs, and evidence strength unless admins need hand-editable CTAs.

Consequences:

- `POSTED_ROLE` plus open application URL maps to Apply.
- credit formalization evidence maps to Ask about credit after mentor/home fit.
- Plausible pathways with lab-manager routes map to Contact lab manager.
- Plausible pathways with only faculty routes map to Plan outreach.
- No evidence maps to Save or check back later.

## 2026-05-07: Add First-Class Access Model Collections

The first model-layer foundation keeps `ResearchGroup` as the physical research entity while adding `EntryPathway`, `AccessSignal`, `ContactRoute`, and `PostedOpportunity` collections.

Consequences:

- `ResearchGroup.kind` remains intact; `entityType` is added as a compatibility field for the broader product model.
- `PostedOpportunity` belongs to an `EntryPathway` and can link to an existing `Listing` with optional `listingId`.
- Derived access records can use stable derivation keys for idempotent materialization without changing scraper/controller behavior in this slice.

## 2026-05-07: Add Access Materializer Beside Legacy Materializer

The first access materializer derives `EntryPathway`, `AccessSignal`, and `ContactRoute` records from active `Observation`s after legacy `ResearchGroup` materialization.

Consequences:

- Legacy `/labs` fields such as `acceptingUndergrads`, `offersIndependentStudy`, and `currentUndergradCount` remain available during migration.
- Access-signal confidence uses original observation/source confidence, not only resolved scalar-field confidence.
- YSM/YSE index-only `acceptingUndergrads=true` observations are treated as entity-discovery evidence, not undergraduate-access evidence.

## 2026-05-07: Add Access Summary Compatibility Payload

Research-group search/detail payloads can include a computed `accessSummary` while preserving existing response fields.

Consequences:

- Future UI work can prefer `accessSummary`, `entryPathways`, `accessSignals`, `contactRoutes`, and `postedOpportunities`.
- Existing `/labs` components can continue using old fields until the acceptance-verdict utility is migrated.

## 2026-05-11: Use Pathways As The Student-Facing Surface

Use `Pathways` as the student-facing surface and navigation label instead of `/ways-in` or a broad `/opportunities` surface.

Consequences:

- `/pathways` is the practical browsing surface for durable routes toward plausible research homes.
- `/opportunities` is reserved for real active/time-bound posted opportunities.
- `EntryPathway` appears to students as Pathways, but course credit should appear as a later formalization option, not as the route itself.
- `PostedOpportunity` remains the internal name for real active/time-bound postings.
- `AccessSignal` appears to students as Evidence.
- Computed CTA logic appears to students as Best Next Step.

## 2026-05-11: Adopt Graphify As Shared Repo Memory

Use Graphify as an optional shared knowledge graph for Codex context on architecture, schema, scraper, product-model, and cross-surface tasks.

Consequences:

- `AGENTS.md` and `docs/*.md` remain canonical for rules and durable decisions.
- Graphify output is a navigation layer; verify claims against source files and tests before editing or summarizing.
- Keep `.graphifyignore` strict so secrets, dependencies, generated output, and noisy raw data do not enter the graph.
- Refresh Graphify after durable schema, scraper, architecture, or product-doc changes.

## 2026-05-11: Start Pathways With A Mongo-Backed Read API

Start the student-facing Pathways loop with `POST /api/pathways/search`, backed by Mongo aggregation over `EntryPathway` and related access collections.

Consequences:

- Do not switch live pathway traffic to Meilisearch until the response shape, filters, and card UI prove stable.
- Pathway search returns denormalized research entity, evidence, active posted opportunity, and guarded contact-route summaries.
- Search results should expose public/official route summaries, not raw non-public scraped contact data.
- `/pathways` can now be built against a stable backend contract while `/opportunities` remains reserved for real posted instances.

## 2026-05-11: Bridge Listings Into PostedOpportunity

Legacy `Listing` rows are the first source of real posted opportunities.

Consequences:

- Listing create/update/archive/delete flows sync a linked `POSTED_ROLE` pathway, `POSTED_OPENING` signal, and `PostedOpportunity` when `researchGroupId` is present.
- New listings attempt to attach to the owner research group so they can participate in the pathway model.
- Existing listing rows can be backfilled with [`data-migration/BackfillPostedOpportunitiesFromListings.ts`](../data-migration/BackfillPostedOpportunitiesFromListings.ts).
- Legacy listing APIs and Meilisearch behavior remain intact during migration.

## 2026-05-15: Deprecate Listings As The Primary UI Surface

The app should default authenticated users to `/research`, not to a listings board. Legacy listings remain useful as professor-created posted-role records and as source material for `PostedOpportunity`, but they are no longer the center of student navigation.

Consequences:

- `/` redirects to `/research`.
- `/listings` is a temporary compatibility route for the old browse board and `?listing=` deep links.
- Primary navigation should show Research, Pathways, Find Fellowships, and Dashboard, not Listings.
- Student-facing copy should prefer Posted Roles or Posted Opportunities over Listings.
- Backend listing APIs, admin listing tools, analytics, favorites, and professor posting workflows remain in place until a later posted-opportunity workflow fully replaces them.

## 2026-05-11: Make Lab Microsite Evidence More Granular

The lab-microsite LLM scraper should emit evidence-shaped observations before product conclusions.

Consequences:

- It may emit join page URLs, undergrad role quotes, contact-instruction quotes, explicit constraint quotes, and an `undergradAccessEvidence` object.
- `accessMaterializer.ts` derives signals and guarded routes from those observations.
- Legacy `acceptingUndergrads` remains as a compatibility observation for now, but new product surfaces should prefer AccessSignals and Pathways.

## 2026-05-11: Tighten Contact Route Guardrails

Public Pathways and research-detail surfaces should not expose non-public scraped emails.

Consequences:

- Public APIs return only public route summaries for contact routes.
- Route selection prefers official application, program, department, fellowship, course, and lab-manager routes before direct faculty routes.
- Client CTAs use route URLs where available and avoid falling back to member emails.

## 2026-05-11: Start Admin Access Review With API Foundation

Admin review for derived pathways/signals/routes/opportunities starts as a read-focused API plus manual-lock update endpoint.

Consequences:

- Admins can list entities with counts of derived access records through `/api/admin/access-review`.
- Admins can inspect one entity's derived access bundle through `/api/admin/access-review/:id`.
- Admins can update `ResearchGroup.manuallyLockedFields` through `/api/admin/access-review/:id/manual-locks`.
- A full admin UI/editor remains a later P3 task.

## 2026-05-25: PI Quality Is Part Of Lab Quality

Operator review must not stop at the lab/research-entity record. A lab that has a PI attached is only production-ready if the attached PI/person data is also source-backed and not obviously stale, duplicated, or name-only inferred.

Consequences:

- Production promotion must include PI identity quality in the Beta gate for promoted labs/entities.
- PI review should check official profile/source URL, title and department context, same-name ambiguity, accepted identifiers such as ORCID/Scholar/OpenAlex where present, and publication authorship proof.
- Name-only publication links are not acceptable PI quality evidence; professor/lab papers must remain backed by `paper_authors` or other identity-backed authorship evidence.
- Future operator UI should surface PI/person quality alongside lab/entity access review instead of treating it as a separate cleanup concern.

## 2026-05-12: Keep A Graphify-Grounded UI/UX Direction Doc

Use [`docs/ui-ux-direction.md`](./ui-ux-direction.md) as the durable home for student-facing UX direction.

Consequences:

- UI/UX ideas should be grounded first in `graphify-out/GRAPH_REPORT.md` and relevant `graphify explain` or `graphify query` output.
- Graphify remains a navigation layer; verify claims against source files and product docs before treating them as product direction.
- The UX grammar should stay centered on Research, Pathways, Evidence, and Best Next Step.

## 2026-05-12: Add Source Coverage Metadata Before Expanding Scrapers

Scraper sources should declare what they can discover or materialize before broad crawler expansion.

Consequences:

- `Source.coverage` stores priority, tier, artifact types, evidence categories, confidence stance, and planning notes.
- The runtime scraper registry remains separate from product/source coverage semantics.
- Coverage metadata helps admin review and future run reports distinguish raw observations from valid access evidence.
- Discovery-only sources should not be interpreted as undergraduate-access evidence without explicit materialized signals.

## 2026-05-13: Deploy Scrapers As Source-Specific Jobs

Initial scraper backfills should move from development testing to Beta seeding before production writes. Recurring refresh should use source-specific, staggered jobs rather than a single all-scraper cron or a permanently running scraper worker.

Consequences:

- Keep scraper execution outside the Render web service process.
- Use local or one-off CLI runs for long initial Beta backfills when practical.
- Production writes require the existing scraper guardrails: `SCRAPER_ENV=production`, `CONFIRM_PROD_SCRAPE=true`, and `--release`.
- Use [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md) as the operational reference.
- Complete WorkPlanner integration for paid or broad recurring sources before unattended weekly cron.

## 2026-05-13: Use Source Heartbeats For Expensive Scraper Freshness

WorkPlanner-enabled expensive scrapers can use source-level heartbeat observations such as `lastObservedAt` as the freshness marker when optional evidence fields may be absent.

Consequences:

- A valid "no undergraduate evidence found" or partial-evidence run can still make a fresh rerun skip fetches, paid APIs, and LLM calls.
- Optional fields such as join URLs or quote snippets should not be required for freshness when their absence is a legitimate scrape result.
- Run reports should treat all-planned WorkPlanner skips as intentional zero-observation runs rather than scraper failures.

## 2026-05-13: Accepted Researcher Inputs Are ORCID-First

Local accepted-input files should use ORCID as the operator-facing external researcher identifier instead of Yale netid. Netid remains an internal account key and scraper compatibility target, not the durable identifier that reviewers should curate.

Consequences:

- ORCID can enrich or disambiguate an existing Yale-confirmed `User`, but it must not create a Yale user by itself.
- Accepted rows are writable only when ORCID is already attached to one Yale user or can be unambiguously crosswalked to a Yale-confirmed person from Yale email, Yale Directory/profile evidence, Yalies, OpenAlex, or another official source-backed signal.
- Scholar accepted rows write `googleScholarId` by ORCID and manually lock that field on the matched `User`.
- arXiv accepted rows use ORCID lists first, then tooling converts validated rows to current internal scraper targets.
- Netid may appear in diagnostics or internal `--only` conversion output, but should not be the reviewer-facing accepted identifier.

## 2026-05-13: Hard-Pivot To Physical ResearchEntity

Use `research_entities` as the canonical runtime collection before development data population and Beta seeding. Copy existing `research_groups` documents into `research_entities` with stable `_id`s, backfill `researchEntityId` references, and remove `/labs` plus `/api/research-groups` runtime compatibility.

Consequences:

- `ResearchEntity` lives in `server/src/models/researchEntity.ts`; `server/src/models/researchGroup.ts` retains the shared legacy-shaped schema but should not register a runtime `ResearchGroup` model on `research_groups`.
- The migration command is `yarn --cwd server research-entity:migrate`.
- After verified copy parity, `research_groups` can be dropped in that environment; no app runtime path should require it.
- Dependent legacy collections should also be copied before deletion: `research_group_members` to `research_entity_members`, `research_group_stats` to `research_entity_stats`, and `paper_group_links` to `paper_entity_links`.
- Leftover legacy `applications` rows should be copied into `student_applications` with raw legacy payload retained before dropping `applications`; use `yarn --cwd server legacy:cleanup`.
- Runtime services should use `ResearchEntity` and `researchEntityId`.
- Legacy `researchGroupId` fields may stay in Mongo as inert residue until post-Beta cleanup.
- Data population should run only after development migration verification passes.

## 2026-05-12: Use ORCID To Resolve And Enrich Yale Researchers

ORCID helps resolve and enrich Yale researchers. It should not create Yale users by itself.

Consequences:

- Treat ORCID as a high-confidence external researcher identifier for disambiguating publications, grants, Scholar profiles, rosters, and faculty pages.
- Create or promote `User` records only from Yale-controlled or Yale-corroborated identity evidence such as netid, Yale email, Yalies/Directory records, or official Yale profiles.
- External researcher systems can add identifiers, confidence, provenance, and research-activity enrichment after a Yale identity is established.
- Scrapers should emit ORCID as evidence-backed observations, then let resolver/materializer logic persist and use it.
- Student-facing UI may show ORCID as a plain researcher profile link, but not as a verification badge or undergraduate-access signal.

## 2026-05-14: Accept Local Beta Meili After Product Review

Beta development validation can use the Beta MongoDB with local development Meili while production still uses the shared remote Meili prefix setup.

Consequences:

- `PATHWAY_SEARCH_BACKEND=meili` is accepted for the local Beta validation posture after reviewing real student-style query divergences.
- Rollback remains setting `PATHWAY_SEARCH_BACKEND=mongo`.
- `beta:readiness --strict` should block a Meili runtime unless the operator passes `--accept-pathway-meili` after product review.
- Local Meili may lack the semantic `default` embedder; ResearchEntity search retries keyword search when that embedder is missing so local Beta smoke tests remain usable.

## 2026-05-12: Start Student Workflow Depth With Saved Pathways

The first P3 student workflow slice is saved Pathways, not a full thesis/outreach planning system.

Consequences:

- User accounts store `favPathways` as references to `EntryPathway` records.
- `/pathways` can save and unsave evidence-backed routes toward research homes.
- `/account` hydrates saved pathways with guarded public pathway card data and links students back to `/research/:slug`.
- Planning notes, stages, outreach helpers, and fellowship matching should be modeled as later pathway-specific workflow fields instead of being folded into the existing listing/fellowship favorites board.

## 2026-05-12: Keep First Pathway Planning State Local

Saved Pathways can carry local intent, stage, and note state before the app adds durable planning schema.

Superseded by the later 2026-05-12 decision to store saved-pathway planning state as user-owned account data after the workflow proved useful enough for cross-device persistence.

Consequences:

- Students can triage saved pathways as thesis ideas, outreach routes, credit formalization candidates, funding paths, applications, or later items.
- Local notes and stages improve repeat use without creating cross-device or advising-share promises yet.
- Backend schema should wait until route-specific planning requirements are clearer.

## 2026-05-12: Add Route-Specific Checklists Locally First

Saved Pathways can show checklist templates based on planning intent before checklist state becomes durable backend data.

Superseded by the later 2026-05-12 saved-pathway planning persistence decision. Checklist state now persists with saved pathway plans.

## 2026-05-12: Promote Saved Pathway Planning To User-Owned State

Saved Pathway planning state is useful enough to persist beyond browser-local storage.

Consequences:

- User accounts can store saved pathway plans keyed by `EntryPathway` id, including intent, stage, notes, and checklist state.
- `/account` should opportunistically migrate earlier local browser plans into the authenticated user-owned plan store.
- Planning notes remain private account data unless a future advising-share workflow adds explicit visibility rules.
- Saved pathway planning stays separate from legacy listing and fellowship favorites.

## 2026-05-12: Normalize Fellowship Application-Cycle Evidence Before Materialization

Official fellowship rows are strong funding/application-cycle evidence, but they do not by themselves prove that a specific research entity or student pathway is eligible.

Consequences:

- Normalize fellowship `applicationLink`, official link rows, accepting status, open date, deadline, contact office, and contact email into a reusable backend evidence contract before using them in matching or materialization.
- Source-backed support flags require at least one valid official source URL.
- Saved-pathway fellowship matches may expose public application-cycle evidence such as source URLs, active-cycle status, official application route support, deadline status, and contact office.
- Do not expose direct contact email through saved-pathway match payloads; preserve it only for future guarded `ContactRoute` materialization.
- Do not create first-class `EntryPathway`, `AccessSignal`, `ContactRoute`, or `PostedOpportunity` records from standalone fellowship rows until they are tied to a research entity, program, saved pathway context, or structured mentor-matching application.

## 2026-05-12: Retire CourseTable As A Core Discovery Scraper

Yale Research should not use the Yale course catalog as a core "find me a lab" scraper. Students usually arrive before they know enrollment mechanics; they need to discover who does research they care about and how to enter that work.

Consequences:

- Retire the CourseTable-backed course catalog scraper from active scraper registration and source coverage.
- Keep course-credit and senior-thesis evidence as formalization/planning support for stronger future evidence sources such as department pages, program instructions, advisor guidance, posted roles, or admin review. Do not create new `COURSE_CREDIT` entry pathways.
- Source seeding may disable historical `yale-course-catalog` rows instead of deleting production history.
- Scraper audits should prioritize entity discovery, lab/faculty evidence, fellowship-compatible participation, and real posted roles before enrollment mechanics.

## 2026-05-12: Standardize Mongo/Mongoose Naming

Mongoose model registry names and `ref` values should be PascalCase singular. Mongo collection names should be lowercase plural, using `snake_case` for multi-word names. Mongoose document fields remain `camelCase` and should avoid literal `.` or `$` characters.

Consequences:

- New multi-word collections should pass an explicit third `mongoose.model` collection argument such as `mongoose.model('EntryPathway', schema, 'entry_pathways')`.
- New refs should point at PascalCase model names such as `ref: 'ResearchGroup'`, not physical collection names.
- Legacy compact names such as `researchgroups`, `entrypathways`, and `postedopportunities` should be migrated with [`server/src/scripts/migrateMongoNaming.ts`](../server/src/scripts/migrateMongoNaming.ts).
- Do not rename product-facing routes or model concepts just because the physical Mongo collection is renamed.

## 2026-05-13: Keep Discovery Indexes Separate From Access Evidence

Official indexes are strong evidence that an entity exists, but they are not by themselves evidence that undergraduates can join.

Consequences:

- `ysm-atoz-index` and `yse-centers-index` should not emit new `acceptingUndergrads` observations.
- Legacy YSM/YSE discovery-only acceptance observations are ignored by entity/access materialization unless explicit undergraduate evidence exists from another source.
- Public evidence excerpts from scraper-derived access records should redact direct emails and phone numbers while preserving raw structured evidence for audit.
- Source coverage should only list `ContactRoute` when a source intentionally emits guarded official route evidence.

## 2026-05-13: Normalize Public Research Payloads Before Physical Rename

Superseded on 2026-05-13 by the hard-pivot ResearchEntity migration decision above.

The app should expose ResearchEntity vocabulary before renaming the backing collection or compatibility routes.

Consequences:

- `ResearchGroup` remains the physical Mongoose model and Mongo collection for now.
- A `ResearchEntity` Mongoose alias can point at the existing `research_groups` collection while compatibility paths remain active.
- Public research search/detail payloads include `researchEntities` and `researchEntity` aliases while preserving legacy `hits` and `group`.
- New client code can type against `ResearchEntity` without forcing immediate file, route, or collection renames.
- `/api/research-groups` remains a compatibility alias mounted to the same router as canonical `/api/research`.

## 2026-05-13: Reserve Opportunity Detail Pages For PostedOpportunity

The `/opportunities/:id` route may exist, but it must represent a real `PostedOpportunity`, not a generic pathway or exploratory contact route.

Consequences:

- `GET /api/opportunities/:id` should return guarded posted-opportunity detail with host research entity, linked pathway, deadline/application context, and public source evidence.
- Missing, archived, or invalid opportunities should fail closed with a not-found response.
- Posted pathway cards may link to `/opportunities/:id` only when a real posted opportunity id exists.
- Exploratory routes and structured mentor-matching fellowship programs remain Pathways unless there is a specific posted instance. Course credit, ordinary fellowship funding, and thesis advising should be represented as formalization/planning outcomes after a plausible research home is identified.

## 2026-05-13: Course Credit Is Formalization, Not Entry

Research for credit is a formalization pathway after a student finds a research home, mentor, and project. Yale Research should help students discover plausible homes, understand evidence for undergraduate access, and choose the right next step; that next step may later become course credit, paid RA work, fellowship-funded research, thesis advising, or an active posted opportunity.

Consequences:

- Do not materialize course-credit evidence into a standalone `EntryPathway`.
- Show credit eligibility or instructions as a formalization option, evidence note, or best-next-step detail after home/mentor fit.
- Reclassify existing `COURSE_CREDIT`, `SENIOR_THESIS`, and `FELLOWSHIP_FUNDED_PROJECT` usage toward formalization metadata, thesis/advising fit, fellowship compatibility, or real posted opportunities.
- `accessMaterializer.ts` should emit `CREDIT_FORMALIZATION_POSSIBLE` for independent-study/course-credit evidence and should turn past-undergrad fellowship evidence into exploratory outreach plus `FELLOWSHIP_COMPATIBLE`, not a `FELLOWSHIP_FUNDED_PROJECT` entry pathway.
- Student-facing copy should emphasize finding the research home first, then formalizing the relationship through the appropriate Yale mechanism.

## 2026-05-13: Fellowships Default To Formalization, With Program Exceptions

Most fellowship records are funding or application-cycle mechanisms after a student has identified a mentor, lab, project, or research direction. They should support formalization metadata, funding matches, deadlines, and best-next-step guidance rather than automatically becoming entry pathways.

Some fellowships are different: structured programs that match students with mentors, run a cohort research experience, or invite students to apply into a hosted research program can be represented as discovery pathways, program entities, and posted opportunities when source evidence supports that treatment.

Consequences:

- Standalone fellowship rows should not create `EntryPathway` records just because funding exists.
- A fellowship can become a `ResearchEntity` when it is a durable program with its own profile, staff, cohorts, or program page.
- A fellowship can become an `EntryPathway` when it is a practical route into a mentor-matched or hosted research experience.
- A fellowship can become a `PostedOpportunity` when there is a concrete application cycle, deadline, eligibility, and application route.
- Examples: Women’s Health Research at Yale Undergraduate Fellowship and Wu Tsai Undergraduate Fellowships are structured discovery/program pathways; general fellowship databases are usually funding/formalization evidence.

## 2026-05-13: Prepare Pathway Meilisearch Before Switching Traffic

Pathways can have a Meilisearch document mapper and settings metadata before the live search API uses Meilisearch.

Consequences:

- Keep `POST /api/pathways/search` backed by Mongo aggregation until backfill, sync, relevance, parity tests, and rollback checks are ready.
- Index only public pathway/search fields; do not index raw non-public contact data.
- Use the mapper as the shared contract for future backfill and sync work so query switching does not reimplement projection logic.
- `yarn --cwd server meili:rebuild-pathways` is the repeatable rebuild command for parity testing and future cutover prep.

## 2026-05-13: Complete Pre-Beta Development Before Beta Seed

Beta seeding should wait until the Development ResearchEntity, scraper, admin-review, and search gates pass together.

Consequences:

- Course credit and thesis should stay out of standalone Pathway discovery and remain formalization/planning details after research-home fit.
- Development scraper blockers that affect core Research and Pathways quality must be fixed or explicitly deferred before Beta. CS/Psych roster coverage and canonical LLM website selection are now fixed in Development; fellowship CSVs, manual Scholar accepted inputs, and broader arXiv candidate coverage remain input-gated.
- `researchentities` and `pathways` Meilisearch indexes have repeatable rebuild commands; Pathways traffic remains on Mongo until real relevance review passes.
- Production scraper rollout remains per-source approval only; Development validation does not authorize Beta or production writes.

## 2026-05-13: Add WorkPlanner Policies Before Recurring Paid Scraper Runs

Broad and paid scrapers should share a WorkPlanner policy and metrics contract before any unattended cron relies on them.

Consequences:

- Source-level freshness windows and target fields live in one WorkPlanner policy registry.
- Scrapers should report WorkPlanner decisions through `ScraperResult.metrics.workPlanner` so run reports can show fetched versus skipped entities.
- `lab-microsite-undergrad-llm` and `openalex` now have initial policies.
- `lab-microsite-undergrad-llm` uses its source-level `lastObservedAt` heartbeat before external work and skips fresh entities before fetch/LLM calls.
- OpenAlex integration remains required before fresh observations skip those external API calls.

## 2026-05-14: Retire Broken Google Scholar Bootstrap Source

The `apify-google-scholar-bootstrap` source is retired from active scraping because repeated dry runs produced no reviewable Scholar IDs and the current actor output lacks author IDs. Scholar ID discovery stays manual-review only.

Consequences:

- `apify-google-scholar-bootstrap` is removed from the active scraper registry, seed metadata, readiness gates, source coverage, and WorkPlanner policies.
- Existing `Source` rows are marked retired by `yarn scrape:seed-sources`.
- Accepted-input/manual review is the supported path for Scholar ID discovery.

## 2026-05-14: Hard-Retire Apify Scholar Enrichment

The active `apify-google-scholar` source is also retired. Official Yale department rosters and profile pages are the identity backbone for faculty enrichment; Google Scholar links scraped from official pages are review candidates only, and accepted Scholar IDs remain a manual `scholar:apply` workflow.

Consequences:

- `apify-google-scholar` is removed from active scraper code, seed metadata, source coverage, WorkPlanner policies, readiness gates, and operator docs.
- Existing `apify-google-scholar` `Source` rows are marked retired by `yarn scrape:seed-sources`.
- `dept-faculty-roster` expands first to Math, Physics, Statistics & Data Science, and Astronomy, and official profile enrichment may emit ORCID, research interests, lab URLs, and review-only Scholar candidate URLs.

## 2026-05-13: Retire Legacy Python Web Scrapers

The tracked `web-scraper/` Python prototypes are retired. Active and future scraping should live in the evidence-first TypeScript pipeline under [`server/src/scrapers`](../server/src/scrapers).

Consequences:

- Use the registered scraper CLI (`yarn scrape ...`) for maintained source work.
- Keep YSM lab discovery in `ysm-atoz-index`; it replaces the old Medicine prototype.
- Add future Physics or History roster coverage as `DepartmentRosterScraper` configs or dedicated TypeScript sources, not as standalone JSON-writing scripts.

## 2026-05-13: Source Department Taxonomy From Official Yale Pages

The `departments` collection is an app taxonomy for research discovery filters, colors, smart titles, scraper cohorts, and department resolution. It should be generated from a curated overlay checked against official Yale sources, not from loose root text files.

Consequences:

- Yale College subject codes are checked against the 2026-2027 Yale College Subject Abbreviations page.
- Yale School of Medicine department names are checked against YSM Departments & Centers.
- Medical-school acronyms, including `YSPH` and `EPH`, are checked against YSM Common Abbreviations & Acronyms.
- Alternate official codes and historical/local labels live in `Department.aliases`; source evidence lives in `Department.sourceRecords`.
- `data-migration/seedDepartments.ts` is dry-run by default and only writes with `--apply`; stale active rows are marked inactive rather than deleted.
- The dry run fails if any official source parser returns zero rows, prints local-only app taxonomy rows, and audits unresolved department strings in `research_entities`, `listings`, current user profile fields, and legacy user profile field names.
- Legacy root files `departments.txt`, `abbreviations.txt`, and `valid_departments.txt` are removed so they cannot compete with the source-backed seed.

## 2026-05-14: Treat Full Beta Scraper Soak As Separate From Baseline Seed

The baseline Beta seed can prove schema, materialization, Meili indexing, accepted inputs, and smoke-test posture, but it is not the same as the requested full scraper test. A full Beta soak should not rely on arbitrary `--limit` caps unless a source has an explicit safety policy.

Consequences:

- Production promotion waits for an accepted full Beta soak, not merely a bounded baseline seed.
- Beta audits should use canonical collections such as `research_entities`; the absence of legacy `research_groups` is expected after the hard migration.
- `lab-microsite-undergrad-llm` may use an explicit `--ignore-work-planner` operator flag for deliberate full-audit Beta runs.
- OpenAlex no-discovery mode targets only identifier-backed users by default. Broad name discovery is high-risk and should remain deliberate, reviewed, and separate from normal full-safe Beta execution.
- Full OpenAlex execution needs chunking, resume/checkpoints, or another explicit source-specific safety policy before it can be accepted for production promotion.

Updated after the 2026-05-14 Beta soak: OpenAlex full execution is accepted for Beta using deterministic offset chunks, no name-only discovery, and no per-author page cap. The current production decision is no longer "can it run?" but "how much raw OpenAlex evidence should production retain?"

## 2026-05-14: Use Compact Retention For Full OpenAlex On Small Atlas Tiers

Full OpenAlex emits millions of per-field observations. On the current 5GB Beta Atlas tier, retaining every raw OpenAlex observation blocks writes before the full source can complete. For Beta, durable publication data is the materialized `papers` collection; run logs preserve per-chunk reports, and raw OpenAlex observations may be pruned after successful materialization.

Consequences:

- OpenAlex production rollout must choose between provisioning enough Atlas storage for raw observations or using the same compact-retention policy.
- The scraper supports resumable offsets so full runs can be retried without one long fragile process.
- Paper materialization uses a fast bulk path for OpenAlex-scale runs; it still records materialization conflicts and errors on `ScrapeRun`.
- Do not apply this pruning pattern casually to access-evidence sources. For student-facing access claims, raw observations remain the audit backbone unless a separate retention decision is made.

## 2026-05-14: Require Identity-Backed Authorship For Faculty Paper Links

Yale Research uses papers and preprints to help students understand what professors and labs work on, but automatic faculty-paper links must be trustworthy. Name-only arXiv/OpenAlex-style matching is not enough to attach a paper to a Yale professor.

Consequences:

- Yale-controlled sources prove the person; accepted external identifiers prove scholarly identity; identity-backed work feeds prove authorship.
- `paper_authors` is the durable proof layer. `Paper.yaleAuthorIds` and `Paper.yaleAuthorNetIds` remain denormalized runtime fields for fast student surfaces, but new writes derive them from `paperAuthorshipEvidence`.
- arXiv is metadata-only: it can upsert preprint metadata by `arxivId`, but it must not emit Yale author IDs or faculty authorship evidence from name search.
- OpenAlex can attach authorship only through accepted ORCID or accepted OpenAlex author ID. Name-only OpenAlex discovery is review-only and no longer writes `User.openAlexId`.
- ORCID public works and Europe PMC ORCID queries are accepted authorship sources for users with accepted `User.orcid`; Crossref hydrates DOI metadata without creating Yale author links by itself.
- Beta cleanup backfilled legacy OpenAlex links into `paper_authors`, superseded active arXiv author observations, and cleared arXiv-only faculty links while preserving arXiv paper metadata.

## 2026-05-25: Promote Program And Student Visibility Model On New Foundation

The newer fellowship work contains two separable ideas: URL hygiene for official Yale fellowship pages, and a broader program/student-visibility model. `new-foundation` now promotes both pieces, while keeping legacy `/api/fellowships` and `/fellowships` compatibility aliases during the transition.

Consequences:

- `yale-college-fellowships-office` canonicalizes moved Yale College financial-awards URLs, including Mellon Mays, to the current `college.yale.edu/life-at-yale/student-faculty-awards/...` page.
- CommunityForce URLs are preserved as official application links but are not fetched as scraper targets.
- `/api/programs` is the canonical public program contract backed by the existing Fellowship collection while storage is migrated incrementally.
- The Fellowship schema now carries program classification fields, source metadata, and shared student visibility fields.
- Student-facing program and research search should default to public visibility tiers only; admin/operator flows can include `operator_review` and `suppressed` when explicitly requested.
- The Operator Board is read-only and summarizes Trust Tier queues, source health, and gate commands. It does not execute writes or automatic approvals.
- Before relying on the public program surface after a data import, run dry-run classification and visibility backfills, inspect the report, then apply intentionally.

## 2026-05-25: Make Production Promotion A Single Explicit Gate

Production promotion must use one explicit lane: copy the accepted Beta research-discovery dataset after fresh parity and backup checks, or run guarded production deltas source by source. Mixing the two in one promotion makes rollback and smoke interpretation ambiguous.

Consequences:

- Production promotion requires a fresh Atlas backup or restore point before copy or writes.
- Accepted Beta copy is allowed only when fresh parity confirms Beta contains the production base records that must be preserved.
- Guarded production delta runs must be one source at a time with `SCRAPER_ENV=production`, `CONFIRM_PROD_SCRAPE=true`, and `--release`.
- Meilisearch rebuild or sync is a required post-Mongo step; Pathways rollback remains `PATHWAY_SEARCH_BACKEND=mongo`.
- Render cron is for accepted source-specific recurrence, not initial backfill, VPN-dependent sources, local accepted-input files, or interactive browser checks.
- `docs/tasks/priority-roadmap.md` records the lane, backup identifier, run IDs, Meili outcome, smoke outcome, rollback posture, and accepted warnings after the gate.

## 2026-05-25: Use Beta As The Production-Candidate Dataset

The current promotion strategy is Lane A: make Beta as close to production as possible, then copy the accepted seeded data into Production only after the promotion gate is complete. Guarded production deltas are deferred unless fresh Beta-vs-production parity cannot be re-established.

Consequences:

- Beta remains the source of truth for final data-quality, source-health, search-quality, and privacy payload review.
- The promotion dataset version is `beta-production-candidate-2026-05-25` until replaced by a newer accepted Beta snapshot.
- Production writes, production scraper deltas, compact-retention apply mode, and recurring cron remain blocked until the runbook packet has backup/restore ownership, smoke ownership, fresh parity, accepted warnings, and Meili rollback posture recorded.
- Pathways keep Mongo as the rollback posture until production Meili rebuild and relevance review are accepted.
