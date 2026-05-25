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
- At the time, relevant files included `server/src/models/researchGroup.ts`, the old `/labs` page, and the research detail page.

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
- `PostedOpportunity` belongs to an `EntryPathway`; the historical optional `listingId` bridge is retired and should not be used for new rows.
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

Updated 2026-05-17: Pathways remains valid product vocabulary in advanced, saved, advising, and route-comparison workflows, but it is no longer a peer primary search destination in top navigation. The main student search loop starts on Search Research and uses pathway data as ways-in enrichment on research-home results.

Updated later 2026-05-17: public `/pathways` and `POST /api/pathways/search` are retired from the client contract. Keep `EntryPathway` internally, but expose it to students through research ways-in summaries, research detail, saved research plans, and admin/data-quality workflows.

Consequences:

- Pathway data is the practical route layer for durable ways into plausible research homes; it should surface inside Search Research, research detail, saved planning, and review workflows rather than as a peer public search destination.
- `/opportunities` is reserved for real active/time-bound posted opportunities.
- `EntryPathway` appears to students as Pathways, but course credit should appear as a later formalization option, not as the route itself.
- `PostedOpportunity` remains the internal name for real active/time-bound postings.
- `AccessSignal` appears to students as Evidence.
- Computed CTA logic appears to students as Best Next Step.

## 2026-05-17: Unified Research Search Is The Student Front Door

Students should not have to choose between entity discovery and pathway discovery before searching. The primary loop is search anything on `/research`, see ranked research homes, then open one.

Consequences:

- Primary navigation should show Yale Research, Programs & Fellowships, and Dashboard; Find Pathways is not a peer primary nav link.
- `/research` should render one research-home-first result stream. The client should not call `/api/pathways/search`; the server enriches research results with compact ways-in summaries from internal pathway services.
- Pathway data appears inline as "Ways in" badges, action chips, best next steps, and real posted-opportunity CTAs when evidence exists.
- Main Research results should not show "Pathway Preview", "Compare pathways", "View all matching pathways", or "No pathways indexed yet"; those expose implementation boundaries rather than the student's job.
- Do not treat `/pathways` as a current standalone student search surface. It redirects to `/research` during compatibility.
- Do not resurrect Listings to regain simple search UX; the canonical `ResearchEntity`, `EntryPathway`, `AccessSignal`, `ContactRoute`, and `PostedOpportunity` model stays intact.

## 2026-05-17: Retire Public Pathways And Canonicalize Programs

The public Pathways page and public Pathways search API should go away, while the internal `EntryPathway` model stays. Structured application discovery should use Programs & Fellowships as the student surface.

Consequences:

- `/pathways` redirects to `/research`; `/api/pathways/search` is not mounted as a public/client endpoint.
- `/api/research/search` is the client-facing source for Yale Research cards plus ways-in enrichment.
- `/programs` and `/api/programs` are canonical for structured programs and fellowships; program-facing API handlers wrap the current fellowship storage model during migration.
- `/fellowships` and `/api/fellowships` remain temporary compatibility aliases with deprecation/redirect behavior.
- Remove dead public Pathways route/controller code; keep `EntryPathway` services only where they support internal enrichment, saved plans, admin/data-quality review, or scraper/indexing workflows.
- Saved `EntryPathway` records should be presented as saved research plans. The `favPathways` user field remains storage residue until a later migration.

## 2026-05-24: Consolidate Around The Existing Product Loop

After reading the durable docs and rechecking the local app with Playwright, the focus is not another navigation or route redesign. The product loop is stable enough: `/research` for Yale Research discovery, `/research/:slug` for evidence-backed evaluation and next step, `/programs` for structured applications and recurring cycles, and `/account` for saved planning.

Consequences:

- New planning should prioritize data trust, semantic search quality, Programs classification/visibility, and the production gate.
- Do not reintroduce public Pathways, Listings, versioned Research routes, or separate exploratory surfaces to express existing model concepts. `/pathways` should remain only as a compatibility redirect while `EntryPathway` continues as internal infrastructure.
- Keep admin quality tools as operator lenses. Student-facing surfaces should stay calm and should not expose weak-profile repair language.
- Treat Playwright route checks as the evidence that IA is stable; future UX work should improve card/detail quality and saved planning within existing routes.

## 2026-05-25: Build A Pipeline Control Plane Before Workerization

The data-quality bottleneck should be solved by making the existing ingestion/materialization system visible and controllable before replacing scripts and cron jobs with a new worker architecture.

Consequences:

- Keep source-specific CLI/cron jobs for now; they already produce `ScrapeRun`, `Observation`, materialization, WorkPlanner, lock, and gate data.
- Add a pipeline control plane over existing primitives: source readiness, latest runs, expected artifacts, gate status, review queues, and next operator action.
- Treat workerization as a later scaling phase, triggered by runtime limits, concurrent admin-triggered jobs, durable retry/cancel requirements, or central rate-limit needs.
- Programs & Fellowships classification/visibility is part of the same pipeline, not a separate UI cleanup problem.
- The pipeline architecture lives in [`docs/research-data-pipeline.md`](./research-data-pipeline.md); the first implementation slice lives in [`docs/superpowers/plans/2026-05-25-research-data-pipeline-control-plane.md`](./superpowers/plans/2026-05-25-research-data-pipeline-control-plane.md).

## 2026-05-25: Gate Existing Data With Student Trust Tiers

Before expanding ingestion, current records need a student-visible trust gate. `ResearchEntity` and `Fellowship` rows now share `studentVisibilityTier` fields and the `student-visibility-v1` calculator.

Consequences:

- Public `/research` and `/programs` searches default to `student_ready` and `limited_but_safe`.
- `operator_review` and `suppressed` are admin/operator states, not normal student browse states.
- The backfill command is dry-run by default and must be reviewed before `--apply`; after applying, rebuild Meili `researchentities` so tier filtering is reflected in keyword/semantic search.

## 2026-05-25: Use A Warm Academic Shell With White Content Surfaces

The Yale Research UI should feel academic, archival, and calm without becoming beige-heavy. Use a very light warm page shell as a brand undertone, then keep content cards, panels, forms, and dense reading surfaces white for clarity.

Consequences:

- Global page tokens in `client/src/index.css` and MUI background tokens in `client/src/utils/muiTheme.ts` should stay aligned: warm off-white for page background, white for paper/panels.
- Avoid broad beige/parchment gradients and warm borders that make the whole app read tan.
- Yale blue, restrained gold accents, serif headings, and subtle cool-gray borders should carry brand and hierarchy without reducing perceived crispness.

## 2026-05-25: Admin Authority Comes From Admin Grants

Admin access is a first-class grant, not a mutable profile type. `users.userType = admin` is legacy profile residue and must not be treated as the source of truth for authorization.

Consequences:

- Active `admin_grants` rows are the admin source of truth for protected routes and session state.
- Local development and tests may keep the synthetic `devadmin` bypass, but that exception must not convert real accounts into admins.
- Admin profile editing must not grant admin authority by writing `userType`.
- The analytics admin dashboard should show active admin grants, flag legacy admin profile rows without active grants, and let admins grant or revoke manual admin access for existing users.
- Admins must not be able to revoke their own current-session admin grant from the dashboard.

## 2026-05-11: Adopt Graphify As Shared Repo Memory

Use Graphify as an optional shared knowledge graph for Codex context on architecture, schema, scraper, product-model, and cross-surface tasks.

Consequences:

- `AGENTS.md` and `docs/*.md` remain canonical for rules and durable decisions.
- Graphify output is a navigation layer; verify claims against source files and tests before editing or summarizing.
- Keep `.graphifyignore` strict so secrets, dependencies, generated output, and noisy raw data do not enter the graph.
- Refresh Graphify after durable schema, scraper, architecture, or product-doc changes.

## 2026-05-11: Start Pathways With A Mongo-Backed Read API

Start the student-facing Pathways loop with `POST /api/pathways/search`, backed by Mongo aggregation over `EntryPathway` and related access collections.

Superseded on 2026-05-17 by the public Pathways retirement decision: keep the Mongo-backed pathway services for internal enrichment and saved planning, but do not expose `POST /api/pathways/search` as a public/client contract.

Consequences:

- Do not switch internal pathway enrichment to Meilisearch until the response shape, filters, and projection prove stable.
- Internal pathway search returns denormalized research entity, evidence, active posted opportunity, and guarded contact-route summaries.
- Search results should expose public/official route summaries, not raw non-public scraped contact data.
- Historical public `/pathways` work was superseded; `/opportunities` remains reserved for real posted instances.

## 2026-05-11: Bridge Listings Into PostedOpportunity

Legacy `Listing` rows are bridged into opportunity-shaped records for compatibility, but they are legacy listing-derived signals rather than official scraper-derived posted openings.

Superseded by the 2026-05-15 listing retirement decisions below: legacy listing rows should no longer create active posted-opportunity artifacts, and the Beta `listings` collection has been dropped.

Consequences:

- Historical listing create/update/archive/delete flows synced a linked `POSTED_ROLE` pathway, `POSTED_OPENING` signal, and `PostedOpportunity` when `researchGroupId` was present.
- Do not use the old backfill to create active posted opportunities; use the newer deprecation migration for current data.
- Do not recreate the `listings` collection or use listing-derived rows for public Meilisearch Pathways documents.
- Historical listing-backed rows may remain archived for audit, but they are not a live product source.

## 2026-05-15: Retire Listings As A Public UI Surface

The app should default authenticated users to `/research`, not to a listings board. The legacy Beta `listings` collection has been dropped; listing-derived pathways/signals are archived, listing-backed posted opportunities are deleted, and Listings are no longer a student, faculty, admin, or scraper runtime surface.

Consequences:

- `/` redirects to `/research`.
- `/listings` redirects to `/research`, and old `?listing=` root links are not preserved.
- Primary navigation should show Yale Research, Programs & Fellowships, and Dashboard, not Listings or Pathways.
- Student-facing copy should prefer research homes, pathways, evidence, and posted openings only when a real `PostedOpportunity` exists.
- Backend listing APIs return `410 Gone`; analytics and historical audit notes should not imply a live Listing table.
- The `Listing` model, service, controller, and migration-only bridge scripts have been removed so Mongoose does not recreate an empty `listings` collection.
- Faculty profile/account pages should not expose legacy Listing CRUD or Posted Roles tabs; any future professor-posted opening flow must be a separate `PostedOpportunity` workflow.
- The 2026-05-15 Beta cleanup archived 1,419 listing-derived pathways, archived 1,419 listing-derived access signals, deleted 1,419 listing-backed posted opportunities, cleared 1,494 user listing references, dropped the `listings` collection, and rebuilt local Meili indexes.

## 2026-05-15: Keep Professor Posting Profile-First

Professors should still be able to add or update labs, groups, projects, and research areas on Yale Research. That contribution flow is profile-first: it creates or updates research-home evidence and plausible contact pathways, not an active opening.

Consequences:

- Do not implement future professor contributions by reusing `Listing` or recreating the `listings` collection.
- Listing-derived rows no longer create new `PostedOpportunity` records, `POSTED_ROLE` pathways, `POSTED_OPENING` signals, or public Pathways index documents.
- Existing listing-backed posted artifacts have been retired; the one-off drop/deprecation tooling was removed after the 2026-05-15 Beta cleanup verified no live listing runtime residue.
- A future professor-posted opening flow must be separate and require explicit opening fields such as role title, deadline or rolling status, application/contact route, compensation, eligibility, and owning research entity.

## 2026-05-17: Treat Beta As The Live Production Gate

Beta is the live testing environment and the only acceptable promotion source until production copy/smoke is complete.

Consequences:

- Production promotion requires server typecheck, server tests, high-severity dependency audit, Beta data-quality, scraper integrity, backup/rollback confirmation, Meilisearch sync, and smoke coverage.
- If `RESEARCH_SEARCH_SEMANTIC=true`, promotion also requires Meilisearch to report embedded `researchentities` documents through the Beta readiness gate.
- Canonical Research and admin surfaces must not query or resurrect retired Listings as compatibility behavior.
- New fallback ResearchEntity creation must stay evidence-neutral; do not assert undergraduate availability without source-backed access evidence.

## 2026-05-17: Keep Scrapers As Jobs, Not A Separate Server

Scrapers should run as short-lived CLI, one-off, or source-specific cron jobs outside the web service process.

Consequences:

- Do not create an always-on scraper server just because this is a monorepo.
- Promote to a worker service only when cron/CLI cannot satisfy runtime limits, queueing/retry behavior, concurrent operator-triggered jobs, or a persistent scheduler/admin UI.
- Production cron runs remain source-specific, guarded by `SCRAPER_ENV=production`, `CONFIRM_PROD_SCRAPE=true`, `--release`, `ScrapeJobLock`, and post-materialization integrity checks.

## 2026-05-15: Keep Fellowships Fresh From Public Official Yale Sources

The fellowship catalog should be maintained by a public-page-only Yale College Fellowships Office scraper, not by hand-editing the browse page.

Consequences:

- `yale-college-fellowships-office` fetches official public Yale pages and stores gated CommunityForce URLs only as application routes.
- Fellowship source metadata (`sourceName`, `sourceUrl`, `sourceKey`, source fingerprint, last verified, and last changed timestamps) supports idempotent upserts and next-cycle retention.
- Missing previously seen official source rows are operator-review warnings, not automatic archive/delete actions.
- `isAcceptingApplications` should only be true for exact future deadlines or explicit official active-application language; fuzzy recurring dates remain next-cycle planning signals.
- Backend admin/report endpoints expose scraper health and run QA, while the canonical `/programs` UI keeps program and fellowship cycle framing. `/fellowships` remains a temporary compatibility alias.

## 2026-05-11: Make Lab Microsite Evidence More Granular

The lab-microsite LLM scraper should emit evidence-shaped observations before product conclusions.

Consequences:

- It may emit join page URLs, undergrad role quotes, contact-instruction quotes, explicit constraint quotes, and an `undergradAccessEvidence` object.
- `accessMaterializer.ts` derives signals and guarded routes from those observations.
- Legacy `acceptingUndergrads` remains as a compatibility observation for now, but new product surfaces should prefer AccessSignals and Pathways.

## 2026-05-15: Keep Microsite Descriptions Separate From Access Extraction

Official lab microsites can improve sparse ResearchEntity descriptions, but "what the lab studies" should not be extracted by the same source that decides undergraduate-access evidence.

Consequences:

- `lab-microsite-description-llm` is a separate Beta-first source from `lab-microsite-undergrad-llm`.
- It emits only `researchEntity` observations for `description`, `fullDescription`, `shortDescription`, conservative `researchAreas`, and a source-level freshness heartbeat.
- Its source coverage is `ResearchEntity`/`Observation` with `LAB_WEBSITE`, `TOPICS`, and `METHODS`; it must not create pathways, access signals, contact routes, or posted opportunities.
- Manual description locks are respected, and the source targets missing or weak main descriptions rather than rewriting already-specific descriptions.

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
- Dependent legacy collections should also be copied before deletion where the target remains active: `research_group_members` to `research_entity_members`. The later May 22 cleanup retired empty/superseded `research_entity_stats`, `paper_entity_links`, and standalone student workflow collections instead of preserving them.
- Leftover legacy `applications` rows were removed with the legacy source cleanup; the unused `student_applications` preservation target was retired on May 22. Use `yarn --cwd server legacy:cleanup` to verify/drop empty legacy sources without recreating it.
- Runtime services should use `ResearchEntity` and `researchEntityId`.
- Legacy `researchGroupId` fields were temporary migration residue; active canonical collections should not retain or write them after cleanup.
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
- `/account` presents saved `EntryPathway` rows as saved research plans and hydrates them with guarded pathway projections.
- Saved research plans should link students back to `/research/:slug` or a real posted opportunity/program when one exists.
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

## 2026-05-15: Preserve Expired Fellowship Cycles As Next-Cycle Signals

Many official Yale fellowship pages close annually but reopen in a later term or year. A past deadline should not make source-backed recurring fellowship data disappear from the student or operator workflow.

Consequences:

- Closed source-backed rows that look recurring can be labeled `Likely Next Cycle` and shown separately from active and ordinary closed fellowships.
- These rows are not current applications; CTAs should open the source or help students track reopening, not imply that they can apply now.
- Saved-pathway fellowship matches may use a next-cycle signal as funding/planning evidence, with a caveat to verify the next cycle before applying.
- Unsourced inactive rows, ambiguous rows, and non-recurring rows remain closed, blocked, or manual-review items.
- Scraper planning should treat past official cycles as refresh targets for next year's scrape or accepted-input review.

## 2026-05-12: Retire CourseTable As A Core Discovery Scraper

Yale Research should not use the Yale course catalog as a core "find me a lab" scraper. Students usually arrive before they know enrollment mechanics; they need to discover who does research they care about and how to enter that work.

Consequences:

- Retire the CourseTable-backed course catalog scraper from active scraper registration and source coverage.
- Keep course-credit and senior-thesis evidence as formalization/planning support for stronger future evidence sources such as department pages, program instructions, advisor guidance, posted openings, or admin review. Do not create new `COURSE_CREDIT` entry pathways.
- Source seeding may disable historical `yale-course-catalog` rows instead of deleting production history.
- Scraper audits should prioritize entity discovery, lab/faculty evidence, fellowship-compatible participation, and real posted openings before enrollment mechanics.

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

Superseded on 2026-05-17 for public traffic: pathway indexing can remain useful for internal enrichment, review, and parity work, but public clients should consume ways-in summaries through `/api/research/search` rather than `POST /api/pathways/search`.

Consequences:

- Keep internal pathway search/enrichment backed by Mongo aggregation until backfill, sync, relevance, parity tests, and rollback checks justify another internal search path.
- Index only public pathway/search fields; do not index raw non-public contact data.
- Use the mapper as the shared contract for future backfill and sync work so query switching does not reimplement projection logic.
- `yarn --cwd server meili:rebuild-pathways` is the repeatable rebuild command for parity testing and future cutover prep.

## 2026-05-13: Complete Pre-Beta Development Before Beta Seed

Beta seeding should wait until the Development ResearchEntity, scraper, admin-review, and search gates pass together.

Consequences:

- Course credit and thesis should stay out of standalone Pathway discovery and remain formalization/planning details after research-home fit.
- Development scraper blockers that affect core Research and Pathways quality must be fixed or explicitly deferred before Beta. CS/Psych roster coverage and canonical LLM website selection are now fixed in Development; fellowship CSVs, manual Scholar accepted inputs, and broader arXiv candidate coverage remain input-gated.
- `researchentities` and `pathways` Meilisearch indexes have repeatable rebuild commands; public clients use Research search, while any future internal pathway Meili use still needs relevance/parity review.
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

## 2026-05-15: Use Guarded Official PI Profiles to Repair Sparse Faculty Labs

Sparse faculty-lab pages should not stay blank when official department profile enrichment already provides PI identity, profile URLs, bios, and topic strings. The materializer now reuses that source-backed PI profile evidence to backfill lab descriptions/research areas and, when no stronger public route exists and no negative availability signal blocks it, to materialize a weak `EXPLORATORY_CONTACT` pathway plus a public `FACULTY_PI` route that points to the official Yale profile.

Consequences:

- `dept-faculty-roster` remains an official-index source, but it can now support guarded fallback `EntryPathway` and `ContactRoute` artifacts in addition to `ResearchEntity` and membership repair.
- Negative microsite signals such as `NOT_CURRENTLY_AVAILABLE` still block fallback exploratory routes; the repair is fail-closed.
- The bounded operator command is `yarn --cwd server research-entity:coverage-repair -- --limit=<n> --min-score=<n> --apply`.

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
- The dry run fails if any official source parser returns zero rows, prints local-only app taxonomy rows, and audits unresolved department strings in `research_entities`, current user profile fields, and legacy user profile field names. Historical `listings` department strings are no longer runtime inputs after the listing table drop.
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
- OpenAlex can attach authorship only through accepted ORCID or accepted OpenAlex author ID. When ORCID exists, it is the identity anchor and OpenAlex author ids must be resolved through that ORCID before use; stored OpenAlex author ids are used only when no ORCID exists. Name-only OpenAlex discovery is review-only and no longer writes `User.openAlexId`.
- ORCID public works and Europe PMC ORCID queries are accepted authorship sources for users with accepted `User.orcid`; Crossref hydrates DOI metadata without creating Yale author links by itself.
- Beta cleanup backfilled legacy OpenAlex links into `paper_authors`, superseded active arXiv author observations, and cleared arXiv-only faculty links while preserving arXiv paper metadata.

## 2026-05-15: Treat Papers As Scholarly Links, Not Canonical Local Records

Yale Research should not become a local publication database. Papers are valuable to students because they signal that a lab, faculty project, or research profile is active in a topic area and because they provide credible external reading paths. The canonical student-facing profile should therefore store compact scholarly links, not full paper metadata.

Consequences:

- `research_scholarly_links` is the profile-facing surface for related papers and scholarly work.
- A scholarly link may belong to a person profile, a research entity profile, or both. Research profiles can also surface person-linked papers through current member ids, because the student value is contextual research activity rather than local paper ownership.
- OpenAlex remains an internal discovery index because it is queryable; public cards cite DOI, publisher, PubMed/PMC, arXiv, ORCID, or official publication destinations before falling back to OpenAlex.
- Research Activity links do not imply an undergraduate opening, pathway, or access claim.
- `papers`, `paper_authors`, and `paper_entity_links` are no longer runtime or model-backed collections in active development after compact-link migration; runtime profile services must not read them as fallback inputs, and future OpenAlex/ORCID works syncs materialize compact scholarly links instead of growing full paper records for profile display.

## 2026-05-19: Use Crossref As A Compact Scholarly-Link Hydrator

Crossref is promoted as a DOI-backed quality pass over existing `research_scholarly_links`, not as a source of Yale authorship or a local paper archive.

Consequences:

- Crossref hydrates compact scholarly links with DOI-of-record title, venue, year, DOI destination, and optional readable full-text backup metadata.
- Crossref observations materialize back into `research_scholarly_links` and preserve the original discovery source such as OpenAlex, ORCID, official profile, or manual input.
- Crossref must not create `Paper`, `paper_authors`, `EntryPathway`, `AccessSignal`, `ContactRoute`, or `PostedOpportunity` records.

## 2026-05-22: Treat MongoDB Cache As The Baseline Before Adding App Caching

MongoDB/Atlas already provides meaningful read caching through WiredTiger and the OS page cache, so Yale Research should not add Redis or broad application caching until production measurements show a real need.

Consequences:

- Start cache work with endpoint timing, query counts, and index checks on hot public reads such as `/api/research/search`, `/api/research/:slug`, `/api/research/suggestions`, `/api/programs`, and `/api/config`.
- Prefer correct Mongo indexes and Meilisearch read-model tuning before adding a new cache tier.
- Use short, targeted TTL or HTTP caching only for public, low-risk, mostly-static responses such as config, suggestions, entity detail, and default browse pages.
- Do not cache user-specific saved plans, profile state, admin views, evidence-review workflows, or deadline-sensitive posted opportunities unless the cache key and invalidation policy are explicit.
- Design invalidation around scraper/materializer/reindex events before introducing shared infrastructure like Redis.

## 2026-05-25: Keep Operator Visibility Approval Rule-Based And Auditable

Research records in `operator_review` should not be promoted just to increase browse counts. Operator approval is an explicit override with a rule id, review note, and reviewed timestamp; broad missing description, missing source URL, thin description, duplicate, inactive, or missing action-evidence queues remain hidden until repaired from source evidence.

Consequences:

- The first conservative rule promotes only records with a source-backed description and concrete next step where the remaining blocker is a missing lead attribution; these become `limited_but_safe`, not `student_ready`.
- Rule-based approvals write `studentVisibilityOverrideTier`, `studentVisibilityReviewRuleId`, and `studentVisibilityReviewNote` so future Trust Tier backfills preserve that the public tier came from a reviewed operator exception.
- Default student search still shows only `student_ready` and `limited_but_safe`; admins can inspect `operator_review` and `suppressed` through trust-tier filters and the operator board.
