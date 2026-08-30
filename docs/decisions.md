# Decisions

This file records durable product and architecture decisions only.
Do not append continuation logs, security hardening transcripts, or task progress here.
Put tactical work in `docs/tasks/priority-roadmap.md` and keep transient artifacts outside `docs/`.

## 2026-08-29: A `FACULTY_RESEARCH_AREA` Research Description Is Synthesized From The Professor's Own Profile Page, Not Extracted

The 2026-08-25 decision below prescribed "extract the research, not the bio" for the remaining `FACULTY_RESEARCH_AREA` description defects.
That mechanism cannot work for this cohort, so it is amended: the description is synthesized from the professor's own official Yale profile page instead.
A lab-less faculty member's only source is that profile page, which states the research but interleaves it with credentials, and the description prompt requires an exact contiguous substring, so the only copyable span is bio-shaped.
A probe of 27 such pages found research prose on 27 of 27 while the deterministic extractor produced prose on 0 of 27, so the 464 bio-shaped served descriptions are a structural limit of copying rather than a ranking bug.

The content contract is unchanged and the grounding requirement is not relaxed: the output must be grounded in that page's own research prose, must not read as a person biography, and the lane fails closed rather than writing a weaker value.
Only synthesis, not the source of authority, changes.

The cohort to rewrite is defined by career facts (degrees earned, appointments, honours), not by whether the served text reads as person prose.
Person-voice shape is the right test on the lane's output and the wrong test for choosing targets, because name-framed research prose is already good student-facing copy; selecting on it replaced 99 correct descriptions on Development.

A synthesis lane cannot displace a biography on confidence alone, because every such lane deliberately ranks below official-profile extraction so a genuine verbatim research statement still wins, while the bio it replaces is emitted by that same extraction at a higher weight and re-emitted weekly.
So `confidenceResolver` sorts biography `fullDescription` groups last once a bio-replacing lane has recorded a useful non-bio value for the entity, and that demotion is kept at least as wide as the predicate the lane selects on: a narrower demotion leaves the selected cohort undemotable and the lane reporting success while the biography stays served.
The bio is demoted, never dropped, so an entity with only a bio still serves it and the materializer keeps a last resort when its own content gates reject the winner.
Future work must not "fix" a losing synthesis lane by raising its confidence above official extraction; that trades away a real verbatim research statement.

The lane, its guards, and its operator contract live in [`research-data-pipeline.md`](./research-data-pipeline.md); the traps it already paid for and the measurement harness live in [`skills/scrapers/SKILL.md`](../skills/scrapers/SKILL.md).

## 2026-08-29: Retire The Listing And Outreach Analytics Lane

A data-model audit of the live databases established that the Listing product surface and the outreach-recording analytics built on top of it have no data and no writers anywhere, so they were removed rather than carried further.
`listings` holds zero documents on Development and on Production, `listingclaimrequests` is absent from both, and `analytics_events` contains zero `listing_*` and zero `outreach_*` documents in either database; Development's events resolve entirely to the twelve event types that still have emitters.
The only reader of the `Listing` model was `analyticsService`, which aggregated over the empty collection at six sites and looked up into it once, so its output was structurally zero rather than merely small.
Decision: delete `server/src/models/listing.ts`, the eight `LISTING_*` and four `OUTREACH_*` members of `AnalyticsEventType`, the `analytics_events.listingId` field, the `'listing'` member of `RESEARCH_ENTITY_TYPES`, and every aggregation, funnel stage, action card, user-summary column, and admin panel that existed only to report them.
An enum member is removed only when it has no emitter **and** zero rows in every database, which is why `profile_update` and `logout` stay: they have no emitter left but do carry historical rows, and dropping them would hide real data from the admin dashboard rather than remove dead code.
The `API_MODE=productionMigration` dual-connection path goes with it, because `MigrationListing` was the only model it ever bound - a second connection that binds nothing is dead by construction, and the startup banner said as much ("Listings from migration DB, everything else from primary").
Two smaller pieces of the same lane fell out: the `PUT /listing-claims/:id` admin-audit descriptor named a route that does not exist, and the `{ type: 'listing' }` variant of the client `BrowsableItem` union was never constructed, so its `BrowseCard` and `BrowseListItem` branches were unreachable UI.
Deliberately out of scope: the physical collection drop, which `legacy:cleanup` already owns and lists; and the audit and migration tooling (`researchModelInventoryCore`, `migrateResearchEntities`, `syncBetaToDevelopment`, the phase-0 hot-path shapes) that still names `listings` on purpose, since removing those specs would blind the residue reporting that found this in the first place.
Note for future audits: Production is a pre-refactor 2026-06-11 snapshot that still carries `users`, `research_entity_members`, `entry_pathways`, `access_signals`, and `contact_routes` and has no `accounts`/`researchers`/`role_assignments`/`signals`, so Development is the only database the current model runs against and the only one whose row counts describe live behavior.

## 2026-08-28: `department-undergrad-research` Is A `/programs` Evidence Source, And One Dead Page No Longer Aborts It

The Physics undergraduate-research page (`physics.yale.edu/academics/undergraduate-studies/undergraduate-research`) now returns 404, so it was retired from `DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES` (#2171).
It was the only configured page using the per-faculty `physics-project-list` parser, so every remaining configured page emits program records and this source no longer produces a `ResearchEntity`: its `sourceCoverageRegistry` declaration now reads `Fellowship` where it read `ResearchEntity`, which is what `seedSources` writes onto the `Source` row and what source health surfaces to admins as `expectedArtifactTypes`, so existing environments need a `scrape:seed-sources` apply to pick the change up.
This amends the 2026-08-26 decision below, which recorded that parser as a live `LAB` producer; the parser itself is kept and tested, so pointing a future live department project-list page at it stays a config change.
Already-materialized physics-derived `LAB` entities still cite the dead URL and are deliberately left alone here; retiring them is a separate guarded data operation.
A page whose fetch or parse fails is now skipped instead of aborting the whole source run, so one dead department site cannot cost the other pages their evidence.
To keep that resilience from being silent, every page attempt is recorded as a `fetchMetrics` attempt (failed attempts carry the HTTP status where the fetcher exposes one, and a parse failure is recorded as a selector breakage) and the run still throws when every attempted page fails, so a site-wide restructure keeps `status: 'failure'` and `risk: 'error'` instead of a green run with zero output.

## 2026-08-28: Archive Residual `PROGRAM` Research Entities And Guard The Materializer

A first force-llm development run surfaced 12 `research_entities` carrying the retired `entityType='PROGRAM'` (all `center-macmillan-*`/Jackson center sub-programs), residue that re-entered through the materializer's no-validator `updateOne`/create path after the 2026-08-26 retirement below.
Decision: archive this residue rather than hard-delete it, and stop it at the source.
The guarded, idempotent `research-entity:retire-program-entities` data operation (dry-run by default, `--apply` plus `--confirm-program-entity-retirement`, env-gated Dev-first through `assertScriptApplyAllowed` so a production target needs `SCRAPER_ENV=production` plus `CONFIRM_PROD_SCRAPE=true`, `--output` under `$TMPDIR`) sets `archived: true` on every non-archived `PROGRAM` research entity and removes its Meilisearch document, so no `PROGRAM` row is a live `/research` citizen or search hit.
Archiving was chosen over the hard-deleting `programs:migrate-program-entities-to-fellowships` op because it is lossless and reversible: only 5 of the 12 already had a `Fellowship` equivalent, and auto-minting classified `Fellowship` records for the other 7 center sub-programs is a curation decision, not a safe mechanical migration.
To keep that reversibility real, `research-entity:cleanup-archived` now defers any archived row whose `entityType` is no longer in `researchEntityTypes` with reason `retired_entity_type`, so a routine cleanup run cannot complete the hard deletion this op deliberately declined.
`entityMaterializer` now refuses the retired type at the entry: `materializeEntity` skips with reason `program-entity-type-retired` when the existing doc is `PROGRAM`, or - on the mint path only - when the winning resolved `entityType` observation is `PROGRAM`, so a re-scrape neither mints a new `PROGRAM` entity nor resurrects or re-syncs an archived one.
Why the guard keys on the resolved winner rather than on any retained observation is recorded on `winningObservedEntityTypeIsRetiredProgram` in `server/src/scrapers/entityMaterializer.ts`.
This was applied on Development only; Beta and Production were untouched.

## 2026-08-27: Remove The Dead StudentProfile / Follow-up / Outreach-recording Subsystem

The student-side personalization, follow-up, and outreach-recording subsystem was built but never wired end-to-end, so it was dead scaffolding carried at a maintenance cost for no product value.
No live path ever created a `StudentProfile` or set `User.studentProfileId` (only the `BackfillV4StudentProfiles` migration did), so `student_profiles` was empty in the running app; the outreach-recording endpoint (`POST /research/:slug/outreach` writing `StudentTracking`/`StudentOutreach`) required a session `studentProfileId` that was never populated and therefore always returned `403`; and `/savedResearchFollowUps` reads always resolved empty, so the follow-up nudge never fired.
`StudentApplication` and `StudentEngagementEvent` had no live consumers at all.
Decision: delete the subsystem - the `StudentProfile`, `StudentOutreach`, `StudentTracking`, `StudentApplication`, and `StudentEngagementEvent` models; the `studentFollowUpService` and `studentFollowUpEligibility` services; the `BackfillV4StudentProfiles` migration and `pfr3StudentOutreachReport` script; the `/users/savedResearchFollowUps*` and `/research-groups/:slug/outreach` routes; the client `FollowUpNudge` component, the follow-up integration in `SavedResearchPlans`, the `labDetail` outreach POST, and `composeStudentFollowUpEmailDraft`; the `User.studentProfileId` field; and the corresponding model-inventory specs and edges.
This supersedes the earlier model-refactor designation of `StudentProfile` as a retained target.
Explicitly retained: the student **visibility** system (`studentVisibility*`, the `student_ready` gate), the reach-out action itself (intro-email compose, mailto, official-profile links) and its `AnalyticsEvent`-backed `OUTREACH_CLICK`/`OUTREACH_OUTCOME` analytics, and `ResearchPlan` (saved planning for any authenticated account).
This is the same "do not carry scaffolding for unsupported features" principle as the [2026-08-27 userType authorization retirement](#2026-08-26-retire-usertype-as-an-authorization-mechanism); if student personalization or a follow-up nudge is revived later, it should be built end-to-end with a real write path rather than restored from this dead code.

## 2026-08-27: Retire Graphify

Graphify was kept as a local generated navigation cache (see the 2026-08-01 decision) but was not installed by default, not automated, and not used in practice; agents navigate with source search plus the durable `docs/` and `skills/` instead.
An evaluation found only its `explain`/`path` queries on a known symbol accurate and useful, while the natural-language `query`-before-search mode the task loop led with was noisy without an embeddings backend, and the deterministic-cache CI job ran on every pull request to protect a capability with no consumers.
Decision: remove Graphify entirely - the workflow, cache scripts, pinned version, ignore file, skill, and onboarding doc - and rewrite the agent task loop to lead with the relevant skill plus targeted source search.
This supersedes the 2026-08-01 decision.

## 2026-08-26: Retire userType As An Authorization Mechanism

`userType` (student/faculty/admin/unknown) is residue from the retired faculty-maintained job-board product, where it was the capability role that decided who could author listings, maintain a profile, and manage the site.
After the pivot to scraped official-source discovery nobody authors content in-app, so the faculty-vs-student capability distinction no longer gates anything real.
Decision: `userType` is a classification and analytics dimension only, and it authorizes nothing.
Admin authority is the separate `AdminGrant` signal exposed as a server-computed `isAdmin` boolean on the session principal and the `/auth/check` payload; guards and the client key off `isAdmin`, never `userType`.
The `isProfessor` and `isTrustworthy` middleware, the `isConfirmed`/`userConfirmed` gate, the `/unknown` onboarding wall (page, reducer, `unknownBlocked`/`knownBlocked` route guards, and the `updateCurrentUser` unknown-bootstrap), and the `allowsLegacyAdminUserType` / `persistedUserType === 'admin'` legacy admin path are all removed.
Local dev-login-as-admin now mints an idempotent bootstrap `AdminGrant` (`ensureBootstrapAdminGrant`) so even dev admin authority flows through the canonical grant mechanism.
Correction-report and listing-claim submission re-gate to `isAuthenticated`; admin-review write surfaces such as research-area creation use `isAdmin`.
Explicitly retained: the persisted `User.userType` field and every scraper and data-pipeline read of it (the faculty `Researcher` spine, department rosters, official-profile PI backfill, and data-quality scripts), plus the analytics `userType` dimension.
Tearing down the analytics `userType` dimension, and dropping the persisted `User.userType` once the faculty spine migrates off it, are separate follow-ups.

## 2026-08-26: Deduplicate Via One Resolver Plus One Engine, Not Per-Domain Repair

Deduplication today is spread across many after-the-fact repair lanes (`dedupeUsersByIdentity`, `dedupeAccountlessResearcherShells`, `dedupeResearchEntitiesByPi`, the in-flight URL-identity lane, program/fellowship dedup, `repairDuplicateAccessSignals`) plus per-domain canonical stores (`research_entity_redirects`, `canonicalGroupId`, `dedupedIntoUserId`, `dedupedIntoResearcherId`).
Each sweep re-runs these repair passes over the corpus, and the safety invariants (non-loss attribute union, reference relink, redirect permanence, fail-closed zero-live-reference delete) are re-implemented per lane and drift, and that drift is how merge losers were left carrying live signals in one lane but not another.
Decision: converge on two shared components.
The first is one before-mint resolver `resolveCanonical(type, observations)` consulted by the materializer before minting any record, folding every domain's identity and collision keys (user: netid, email, ORCID; researcher: account, ORCID, name; entity: slug, website-URL, lab-or-profile-URL), backed by a unified canonical-alias ledger that generalizes `research_entity_redirects` and survives deletion, which prevents duplicates by construction.
The second is one dedup engine that owns the merge, relink, redirect, and delete core once (non-loss union, reference relink, lineage, redirect, fail-closed zero-live-reference delete), parameterized by per-domain adapters (candidate matcher, canonical selector, reference specs), which handles the backlog and the cases resolution misses.
Rationale is performance and correctness: prevention-by-construction turns the repair, dedup, and delete post-run passes into idempotent no-ops that can be shrunk or retired, cutting per-sweep work and extending the #1945 "retire the fix\* repair genre" direction, and the safety invariants live in exactly one place instead of drifting across lanes.
Migration is phased, Development-first, and behavior-preserving.
P1 extracts the shared engine from the existing lanes once the in-flight URL-identity dedupe lane lands.
P2 builds the unified resolver plus canonical-alias ledger and wires it into the materializer before-mint, closing the known User email and ORCID resolution gap where duplicate Users are only reconciled after minting.
P3 demotes or retires the now-redundant repair passes and measures the sweep-time reduction.
Multiple sessions edit the sweep and dedup code, so land the in-flight dedup lanes first and give this refactor a single owner to avoid collisions.
This builds on current state: the eponymous FRA->lab merge segment (merge plus `research_entity_redirects` plus fail-closed delete) is built, validated end-to-end on Dev, and is the working prototype of both the alias ledger (resolver) and the shared merge and delete core (engine).
This direction is tracked in issue #2063.

## 2026-08-26: `PROGRAM` Is Not A Research Entity; Every Program Lives Only On `/programs`

The `PROGRAM` `entityType` is removed from `ResearchEntity`, so a program is never a `/research` citizen.
This amends the 2026-08-25 decision below, which had kept a scraped `PROGRAM` research home as a first-class `/research` entity.
A program is an apply-to-a-program surface concept, so it belongs on `/programs` (backed by the `Fellowship` collection), not in the find-a-person-and-reach-out directory.
Two populations motivated the change: generic department "undergraduate research" pages (`department-undergrad-research-*`), which are recruitment/DUS guidance rather than joinable research homes, and a tail of named programs that were mis-typed as `PROGRAM`.
All of them move to `/programs` uniformly rather than being re-typed, so the corpus carries no `PROGRAM` entity and no cross-surface duplicate.

Removed: the `PROGRAM` value from `researchEntityTypes` and the `researchGroupKinds.program` to entity-type mapping (the `program` group kind now derives to `INITIATIVE`).
The `departmentUndergradResearchScraper` program parsers now emit `entityType: 'fellowship'` observations that materialize into `Fellowship` records; its per-faculty physics parser still emits `LAB` research entities (no longer true in production as of the 2026-08-28 decision above, which retired the only page configured for that parser).
The name-keyword classifiers in `yaleResearchOfficialScraper` and `officialProfilePiBackfillScraper` no longer map a `"...Program"` name to `PROGRAM`; a genuine research structure named "Program" now classifies as `INITIATIVE` and stays in `/research`.
Existing `PROGRAM` entities were migrated by the guarded `programs:migrate-program-entities-to-fellowships` data operation, which mints a deduped `Fellowship` per entity, runs the program visibility gate, and hard-deletes the `ResearchEntity` plus its Meilisearch document, `Signal` rows, and `RoleAssignment` edges.
`researchPlanTargetKinds`'s `'PROGRAM'` is a research-plan target kind for saving a program and is unrelated to the removed entity type; it is unchanged.
Future work must not reintroduce a `PROGRAM` `entityType` or route programs into the `/research` corpus.

## 2026-08-25: Programs And Fellowships Live Only On `/programs`; The Split-Brain Projection Is Removed

The Fellowship to `ResearchEntity` projection is removed, resolving the long-tracked "program split-brain" where a program appeared both as a `Fellowship` on `/programs` and as a projected `RA_PROGRAM`/`FELLOWSHIP_PROGRAM` `ResearchEntity` on `/research`.
The projected entity was a pure derived duplicate of the authoritative `Fellowship` record, so mirroring it into the research corpus split one concept across two student surfaces with no added information.
Programs and fellowships now live only on `/programs`; `/research` surfaces research homes and entities.
Removed: the projection writer and its live materializer trigger, the batch projection script, the `/research` "Related programs & fellowships" cross-surface module (`POST /research/related-programs` and its client component, issue #1509), the `RA_PROGRAM` and `FELLOWSHIP_PROGRAM` `entityType` values, and the funding-program topic derivation that only enriched projected programs.
A scraped `PROGRAM` research home discovered on a Yale department or official page is a first-class `/research` citizen and is unaffected; `RA_PROGRAM` remains a `Fellowship` `programKind` on the `/programs` domain and is distinct from the removed `entityType`.
Existing projected entities are removed from the corpus by the guarded `programs:retire-projected-research-entities` data operation (dry-run first).
Future work must not reintroduce a Fellowship-to-research projection or those two entity types.

## 2026-08-25: Simple Directory First; Signals Are Factual Enrichment, Not An Access-Plausibility Tier

Yale Research is a simple, high-quality directory of Yale research whose two co-equal priorities are good data and good search.
The student job is to find a professor and their work and reach out; the directory's job is to make that fast and trustworthy, not to compute pathways or score access.
The durable core stays: `ResearchEntity` + `Researcher` + `RoleAssignment` (what exists, who it is, who leads it), official links, real descriptions, and Meilisearch discovery.

Enrichment versus gate is the organizing axis, and every entity field sorts into exactly one bucket.
A gate can hide a lab and covers correctness only: a real, coherent, research-focus description, the right lead attached, and not a duplicate or suppressed shell, in scope and active.
Enrichment never hides anything: funded, has mentored undergraduates before, wet or dry lab, paid or credit, active, size, topics, and methods.
Enrichment does not decide whether a student reaches out; it helps the student pick whom to email first and what to say.
This is the model `student-ready-definition.md` already encodes, so the visibility gate does not change.

Reaching out is the universal action and needs no plausibility score.
The next-step action is a function of entity type, not a computed access grade: a lab or faculty entity resolves to reaching out to the professor, and a course sequence resolves to enrolling or asking the DUS.
Applying is the action on the separate programs and fellowships board, not in the directory.

The access-plausibility tier is retired: the `Signal`-driven browse trust filter and ranking, the `REACH_OUT_PLAUSIBLE` style plausibility signals, the `accessAcceptanceLevel` grade, the `accessSummary` and best-next-step engine, and the "Ways in" and Planning Context pathway framing all go away.
Signals become factual, sourced, non-ranking badges.
Research-area topic chips are demoted from a first-class, gating field to a search-only enrichment signal, and the inert "Open now / Rolling" availability filter is removed.
The vocabulary "research home" and "research area" is deprecated in favor of plain directory language.

Faculty are represented once.
A professor is a `LAB` if they have a named lab and a `FACULTY_RESEARCH_AREA` (a lab of one) only if they do not; the two share one content contract, a research-focus description grounded in the professor's own official source, never a bio or CV.
A `FACULTY_RESEARCH_AREA` that duplicates a lab is evidence the professor has a lab, so it merges into the lab rather than being held for review; a standalone `FACULTY_RESEARCH_AREA` remains only for genuinely lab-less faculty.
The remaining `FACULTY_RESEARCH_AREA` description defects are a scraper and data-quality problem (extract the research, not the bio; do not graft a sibling entity's areas), not a schema problem.
The "extract the research" half of that is amended by the 2026-08-29 decision above, which records that extraction structurally cannot reach the research on a profile page and that the description is synthesized from that page instead.

The programs and fellowships board stays a separate surface, as it is today after the split-brain resolution (#1948 removed the `Fellowship`-to-`ResearchEntity` projection).
The directory is find a person and reach out; the board is apply to a program.

This decision states direction.
It supersedes the 2026-05-07 "North Star Is Research Navigation" and 2026-05-11 "Use Pathways As The Student Action Layer" framings and amends the 2026-08-19 trust-filter role of `Signal`.
The code removals (trust filter, `accessSummary`, `REACH_OUT_PLAUSIBLE`, ways-in) and the current-state runtime docs that still describe them are updated in follow-up work, not by this decision; until then those docs still describe live code.

## 2026-08-25: Researcher Person Page Is Retired; Discovery Ends At The Research Entity

The standalone researcher person page (`/research/person/:publicKey`) and the researcher people-search card on `/research` are removed.
Discovery now surfaces research homes and entities only; a person is reachable through the entity they lead, not through a dedicated person page.
The Principal Investigator section on `/research/*` entity pages is unaffected: a PI's name, photo, title, and official-profile link are served independently by the entity resolver (the embedded `members` array in `GET /research/:slug`), which never depended on the researcher-profile endpoint.
The two backend endpoints (`GET /research/person/:publicKey`, `POST /research/people/search`) and their services are removed; old person URLs redirect to `/research`.
Future work must not reintroduce a person page or cite a researcher-profile read path; treat any lingering reference to one as stale.

## 2026-08-24: Logged-Out Read-Only Discovery For Public Research And About Pages

Yale Research is a discovery product, so its top-of-funnel pages are readable without a Yale CAS login rather than gated behind it.
A logged-out visitor can browse and search `/research`, open any public `/research/:slug`, and read `/about`, seeing only the public student-visibility tiers already served to authenticated students.
Anonymous requests carry no authenticated principal, so the read controllers grant no operator authority and apply no personalization; logged-out browsing always uses the global Recommended order and never exposes non-public tiers or operator/admin fields.
Every write and account surface stays behind auth: saved plans, private notes, compare, outreach tracking and drafting, program watch, profiles, analytics, admin, and the seed routes.
On the public surfaces, save and outreach affordances are replaced with a Yale CAS login call to action, and journey analytics stays off for guests.
The read endpoints keep the existing global rate limit and unchanged SSRF, CORS, and CSRF posture.
This resolves the `Decide logged-out discovery` roadmap P0 in favor of public read-only discovery; the alternative of staying Yale-only was rejected because gating the entire corpus behind login is the largest limitation at the top of the discovery funnel.

## 2026-08-23: External/National Programs Are Out Of Scope For Discovery

Yale Research stays a Yale-focused directory: its north star is broad, accurate coverage of Yale research homes and Yale undergraduate access, not a national fellowship or REU aggregator.
External and non-Yale awards (NSF REU sites at peer institutions, NIH summer programs, Goldwater, Beckman, Churchill, and similar) are out of scope for `/fellowships` and `/programs`, resolving the Tier 3 deferral that closed issue #675 left open.
The only authoritative fellowship/program acquisition lane remains the Yale-internal `yale-college-fellowships-office` source.
The orphaned `external-fellowship-llm-scraper` seed (issue #1280) had no scraper class, no orchestrator registration, and no coverage-registry entry, so it produced dead config and dishonest coverage reporting; it is retired rather than implemented.
Coverage state is kept honest by an invariant test: every active seeded source must carry a `sourceCoverageRegistry` entry, so a future orphaned seed fails CI instead of silently accumulating.
Revisit only through a deliberate, separately tracked product decision that also defines a focused eligibility boundary so the Yale corpus is not diluted.

## 2026-08-22: Consolidate Research Model Documentation Into research-model.md

The landed decisions from `research-model-refactor.md` (access-boolean retirement, research-area canonicalization option A, `OrgUnit`/`TaxonomyTerm` scope, `FacultyMember`/`Paper`/`PaperAuthor` retirement, canonical `ResearchPlan`, and the continuous canonical materializer write path) are now current-state facts in [`research-model.md`](./research-model.md), which is the single source of truth for collection shapes going forward.
`research-model-refactor.md` is reduced to a historical decision record explaining why the model was shaped the way it was; it no longer restates current schema state.
Earlier entries in this file that call `research-model-refactor.md` "authoritative" describe what was true when they were written; read `research-model.md` for the current model.

## 2026-08-19: Remove EntryPathway, ContactRoute, And PostedOpportunity

The `EntryPathway`, `ContactRoute`, and `PostedOpportunity` models and the separate pathway search index were removed in issue #363, superseding the earlier 2026-05-11 and 2026-05-07 decisions.
Access evidence is now materialized only as typed `Signal` rows, browse/discovery runs on the `researchentities` Meilisearch index with `Signal` driving the trust filter, and contact is a derived official-profile link-out rather than a stored contact route.
See [`research-model.md`](./research-model.md) for the current model.

## 2026-08-02: Make Research Coverage Source-Driven

Yale Research does not host faculty-authored lab or opportunity submissions.
Research homes, access evidence, postings, and official application routes come from authoritative-source ingestion, with official application URLs rendered only as outbound links.
Missing professor coverage is repaired through bounded, targeted scraper runs against the professor's canonical research homes rather than by asking the professor to maintain a duplicate Yale Research record.
Archived `ResearchEntity` rows are migration residue rather than catalog inventory and should be physically removed only through fail-closed cleanup that preserves source observations and resolves dependent references.

## 2026-08-01: Treat Graphify As A Local Generated Cache

Superseded by the 2026-08-27 decision to retire Graphify.

Graphify output changes frequently during architecture refactors and created unrelated feature-branch diffs, rebase conflicts, and invalid generated JSON.
Generated files under `graphify-out/` are now ignored local cache data rather than committed source.
Agents refresh the cache when it is missing or stale, use it for scoped navigation, and verify important claims against source, tests, and durable docs.
CI installs the pinned Graphify version, generates twice to verify deterministic output, and publishes the graph and report as an artifact.

## 2026-07-26: Retire The Bibliographic Paper Pipeline

The bibliographic ingestion implementations for OpenAlex, arXiv, ORCID works, Europe PMC, PubMed, and Crossref are removed, along with their CLI, scheduling, active source metadata, and source-seeding paths, so they cannot run through ordinary scraper operations.
Historical `paper` source rows and observations are retained as read-only archived evidence and are never materialized, and the launch-trust release gate no longer enforces paper-quality or research-activity checks.
Yale Research navigates to verified official Yale profile URLs and keeps ORCID and Google Scholar only as optional outbound identity links, not as a works feed, verification badge, or activity signal.
The confirmed Phase 3 scope also retires the curated official-profile scholarly-activity surface.
Producers and consumers are retired as a hard cutover with no rollback opt-in: the `Paper` and `PaperAuthor` models and their readers are removed, and the stored `papers`/`paper_authors` collections remain only until a human-gated collection drop.

## 2026-07-25: Development Uses Atlas MongoDB And Local Meilisearch

Development uses the Atlas `Development` database and local Docker Meilisearch so operators share a disposable integration dataset while keeping search iteration local.
Development can be refreshed one way from accepted Beta through an allowlist-only, Atlas-Beta-to-Atlas-Development copy.
The refresh never reads Beta operational or student-workflow collections, clears Atlas Development non-mirror collections, sanitizes copied account state, and rebuilds local Meilisearch separately.
Unclassified Beta collections block apply until their mirror policy is reviewed.
See [`data-refresh-runbook.md`](./data-refresh-runbook.md) for the current copy set, the account sanitization rule, and the observation policy.
The VPN-connected local Beta operator fetches observations into the Atlas `Beta` database but does not materialize them locally.
The Beta Render service materializes accepted run IDs and updates its private Beta Meilisearch indexes.
Production receives data only through the guarded accepted-Beta promotion, followed by the Production search and smoke gates.
Environment-specific database users and exact database-name checks enforce the boundary.
Operators authenticate to Yale VPN with their own NetID and Duo, and the team maintains at least two trained Yale-affiliated operators.
Interactive Yale VPN credentials are never stored for cron.
The long-term automation target is an approved team-managed runner on the Yale network rather than a member's personal laptop.

## 2026-07-24: Refactor Around Research Navigation And Evidence

The accepted target separates accounts, public people, role assignments, research entities, evidence claims, and private research plans while retaining bounded REST projections.
Yale Research will own evidence-backed research navigation, not a mirrored professor-profile or publication product.
Migration proceeded through measured vertical cutovers, beginning with the read-only inventory in [`research-model-refactor.md`](./research-model-refactor.md).
See [`research-model.md`](./research-model.md) for the current, landed model.

## 2026-07-12: Bound Embedded Research Entity Summaries

Public research detail responses embed related entities as strict card summaries rather than full public profile DTOs.
The server projects only card fields, caps each relationship direction, reports truncation, and leaves full-profile retrieval to navigation.

Do not add application-level response compression without verifying the deployed web-service topology first.
The Render web service is managed outside `render.yaml`, so this repository cannot guarantee or configure its edge compression.
Blanket compression around cookie-backed API responses would also increase BREACH, caching, buffering, and streaming review scope while potentially duplicating the platform edge.
Prefer bounded public JSON DTOs, and configure compression at the deployment edge when its control-plane settings can be verified.

## 2026-07-04: Keep Durable Docs Compact

Stale execution plans, worktree plans, UX screenshots, scratch reports, and proposal docs should not live in durable documentation.
The durable docs are the product context, research model, decisions, roadmap, agent workflow, developer guide, and focused runbooks.
When historical notes stop changing future behavior, delete or summarize them.

## 2026-06-12: Public PI Links Prefer Official Faculty Profiles

Public PI navigation should prefer official Yale faculty profile URLs, then a safe public website when no official person-profile URL exists.
Public UI and research-detail DTOs must not synthesize internal professor profile routes from raw member NetIDs, emails, public keys, role-suffixed keys, names, or stored fallback paths.
Data cleanup should backfill official profile URLs from source-backed audits and keep missing-link rows in review when no safe public target exists.

## 2026-06-11: Public Surfaces Minimize Internal Metadata

Public research, pathway, opportunity, profile, program, fellowship, listing, and taxonomy payloads should expose student-facing fields only.
Persistent Mongo IDs, internal join IDs, workflow tiers, timestamps, direct contact fields, raw external IDs, and operator metadata stay server-side or admin-only unless a route has a specific product need.
Public counters and saved/favorite mutations must validate visibility before account persistence or side effects.

## 2026-06-11: User And Artifact Inputs Are Bounded Before Work

Route inputs, pagination, query filters, artifact paths, localStorage payloads, export payloads, and admin/operator fields must be bounded and validated before database, filesystem, analytics, or client-storage work.
Artifact reads and writes must stay under safe roots such as project `tmp/` or the OS temp directory unless a durable store is explicitly designed.

## 2026-06-11: IDs Avoid Arbitrary Object Coercion

Server DTOs, index documents, reports, maintenance scripts, scrapers, repair plans, and public payloads must not derive IDs through generic `String(value)`, arbitrary `.toString()`, or duck-typed object hooks.
Use strict ObjectId normalization for database-facing work and primitive/ObjectId-only serializers for report or DTO shaping.

## 2026-06-11: Logs And Errors Are Sanitized

Application, scraper, operator, and client logs must avoid raw caught-error objects, stack traces in deployed runtimes, credentials, direct contact details, NetIDs, source URLs with sensitive query data, and database identifiers unless explicitly safe.
Errors shown to users should be fixed or bounded client-safe messages.

## 2026-06-11: Outbound URLs Are SSRF-Guarded And Browser-Safe

Every user-derived outbound fetch or persisted/rendered public URL must pass shared URL guards.
Server fetches use SSRF-safe agents and reject private/local hosts, unsafe ports, redirects that leave the safe origin, control characters, whitespace, and malformed URLs.
Client links that open new tabs or CTAs should be HTTP(S)-only unless they are explicit email actions.

## 2026-06-11: Auth And Browser Responses Fail Closed

CAS/auth configuration in deployed environments must use valid public HTTPS base URLs.
Credentialed API responses default to private no-store headers.
Unsafe or write-like routes enforce origin checks and rate limits before mutation.
Session principals and auth-derived NetIDs must be bounded primitive values before authorization logic.

## 2026-06-11: Browser Storage Avoids Private Note Leakage

Saved research-plan and account tracking localStorage must be scoped to the authenticated user, bounded before parse/write, and must not persist private planning notes or checklist text unless a deliberate export flow is used.
Malformed or oversized stored payloads should be removed instead of repeatedly rehydrated.

## 2026-05-25: Beta Operator Review Is An Automatic Repair State

Beta repair and launch gates should distinguish automatic deterministic repair, human review, and blocked states.
Operator Board recommendations should expose concrete next commands but should not imply production readiness without true production evidence.

## 2026-05-25: Launch Trust Contract Included Research Activity

Superseded in part by [Retire The Bibliographic Paper Pipeline](#2026-07-26-retire-the-bibliographic-paper-pipeline).
At the time, launch trust included research activity, paper quality, source-backed access evidence, PI identity quality, and public visibility safety in addition to visibility and source health.

## 2026-05-14: Student-Facing Routes Should Not Use URL Versioning

Research route iteration should happen in place on canonical product routes or behind non-URL feature flags.
Do not add `/v1`, `/v2`, or similar student-facing route versions for normal product iteration.

## 2026-05-11: Use Pathways As The Student Action Layer

Student action should be modeled through source-backed pathways and access signals rather than a binary accepting-undergrads flag.
Compatibility labels can exist during migration, but product language should move toward Planning Context, Evidence, and Best Next Step.

## 2026-05-07: North Star Is Research Navigation

Yale Research is a research navigation product, not a simple lab-opening board.
Students should be able to move from curiosity to credible research homes, evidence, pathways, and next steps.

## 2026-05-07: Separate EntryPathway From PostedOpportunity

`EntryPathway` describes a credible way a student might engage with a research entity.
`PostedOpportunity` describes a concrete posted opening, deadline, or application.
The product should not treat every path into research as a job listing.

## 2026-05-07: Replace Binary Acceptance With Access Signals

Use `AccessSignal` and evidence strength instead of binary "accepting undergrads" claims.
Evidence can include source-observed undergraduate participation, official application routes, program structures, contact routes, and conservative fallback signals.

## 2026-05-07: Evolve Legacy ResearchGroup Conservatively

Canonical runtime should center on `ResearchEntity`, but legacy `ResearchGroup` naming may remain during migration where changing it would add risk.
Prefer adapters and compatibility layers over broad renames unless the rename removes real confusion or dead code.

## 2026-05-07: Use Two Main Product Surfaces

The primary student surfaces are research discovery/detail and saved/account planning.
Listings were the compatibility path for older posted-role workflows; they were removed on 2026-08-29 (see above).
