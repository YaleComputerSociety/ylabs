# Research Data Pipeline

Last updated: 2026-05-25

This document is the durable architecture plan for turning Yale Research data work from one-off scripts and cron jobs into a full pipeline. It should be read with [`docs/scraper-audit-guide.md`](./scraper-audit-guide.md), [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md), [`docs/research-model.md`](./research-model.md), and [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md).

## Goal

Build the Yale Research data engine: a repeatable system that discovers, verifies, materializes, reviews, refreshes, and promotes research data for faculty, research homes, labs, centers, institutes, programs, fellowships, access evidence, contact routes, and research activity.

The pipeline should make the student experience trustworthy. Students should see specific, current, source-backed research homes and programs. Operators should see what is missing, stale, conflicting, suppressed, or ready to promote.

The immediate risk has two sides:

- **Current database quality:** the database already contains useful data plus sparse, stale, duplicated, weakly sourced, or over-derived records. The pipeline must audit and repair the current state without blind rewrites.
- **Future incoming quality:** every new source run, accepted input, repair script, and manual/admin change must pass enough gates that the same bad data classes do not re-enter.

## Product Thesis

The app direction is stable enough: `/research` is Yale Research discovery, `/research/:slug` is evaluation and next step, `/programs` is Programs & Fellowships, and `/account` is saved planning. The product risk is no longer route shape; it is data trust and coverage.

The data pipeline is therefore a product system, not just infrastructure. It must answer:

- Which Yale research homes exist?
- Which faculty, labs, centers, institutes, archives, cores, and programs are represented?
- What does each home actually study?
- Who leads it?
- What source verifies identity, description, people, methods, and access evidence?
- What ways in are credible for undergraduates?
- Which programs and fellowships are relevant to undergraduates, and which require mentor/home fit first?
- What is stale, weak, contradictory, suppressed, or waiting for review?

## Current Foundation

The repo already has the right primitives:

- `Source`: registry row for source metadata, trust weight, enabled state, cadence, and source coverage.
- `ScrapeRun`: one run record per CLI/cron/admin invocation, with counters, options, fetch metrics, materialization metrics, integrity results, and errors.
- `Observation`: append-only evidence rows from scrapers and accepted inputs.
- `ScraperOrchestrator`: source runner that opens a `ScrapeRun`, emits observations, and finalizes the run.
- `entityMaterializer.ts`: materializes observations into `ResearchEntity`, `User`, compact scholarly links, programs, and related canonical data.
- `accessMaterializer.ts`: derives `EntryPathway`, `AccessSignal`, and `ContactRoute` where evidence supports it.
- `sourceCoverageRegistry.ts`: declarative source capability map.
- `source:health`, `scraper:integrity-gate`, `beta:data-quality`, `beta:readiness`: read-only quality gates.
- WorkPlanner and `ScrapeJobLock`: freshness and concurrency primitives for broad or recurring jobs.
- Programs classification work on the `Fellowship` model and `programClassifier.ts`.

The missing layer is the control plane: a first-class way to plan, schedule, observe, review, retry, suppress, and promote work across those primitives.

## Target Architecture

```txt
Source Registry
  -> Pipeline Job Plan
  -> Fetch / Parse / Extract
  -> Observation Store
  -> Resolver / Materializer
  -> Quality Gates
  -> Review Queues
  -> Search Sync
  -> Beta / Production Promotion
  -> Student Surfaces
```

### 1. Source Registry

Extend the existing `Source` and source coverage metadata into the source-of-truth for pipeline ownership:

- source name, display name, base URL, tier, trust, coverage artifact types, evidence categories
- owner or review group
- cadence and freshness policy
- allowed environments
- expected artifacts and forbidden artifacts
- dry-run/write/materialization gate requirements
- cost class: free, API-limited, paid, LLM, manual
- promotion state: disabled, discovery, beta-ready, production-ready, recurring

`sourceCoverageRegistry.ts` remains the code-backed default. Seeded `Source` rows become the runtime view.

### 2. Pipeline Job Plan

Add a first-class plan layer before execution. This can initially be a model and admin/API projection over existing `Source`, `ScrapeRun`, and WorkPlanner data rather than a new worker system.

Each planned job should know:

- source
- target environment
- trigger: manual, scheduled, admin-requested, repair, promotion
- scope: `--limit`, `--offset`, `--only`, `--since`, accepted artifact
- expected artifact counts or acceptance bounds
- required preflight gates
- required post-run gates
- retry policy
- promotion blocker state

Do not jump immediately to a separate always-on service. Keep CLI/source jobs, but make them observable and controllable.

### 3. Evidence Store

Keep `Observation` as the raw truth layer. Scrapers should collect evidence; materializers should make product decisions.

Required evidence properties:

- source URL
- source title/domain when known
- field and entity target
- source quote or public excerpt where possible
- confidence and source weight
- fetch timestamp and source last verified timestamp
- run id
- extraction method: deterministic, LLM, accepted input, manual admin, replay cleanup

Pipeline rule: no public claim should depend only on a scraper's conclusion when the source evidence can be preserved.

### 4. Resolution And Materialization

Materialization should stay separated from scraping:

- `User`: identity, official profile, departments, title, bio, topics, photo, ORCID/Scholar when accepted
- `ResearchEntity`: labs, centers, institutes, faculty research areas, archives, collections, cores, programs
- `EntryPathway`: ways a student may approach or enter a research home
- `AccessSignal`: evidence-backed participation/access facts
- `ContactRoute`: guarded official action/contact route
- `PostedOpportunity`: real active/time-bound posting only
- `Fellowship` or future `Program`: structured programs and fellowship cycles
- `research_scholarly_links` and `research_scholarly_attributions`: compact research activity context

Resolvers must handle identity matching, duplicate prevention, source precedence, field locks, supersession, archived canonical targets, stale observations, and conflict reporting.

### 5. Quality Gates

The control plane should make gates visible and enforceable:

- `source:health`: source recency, status, materialization risk
- `scraper:integrity-gate`: duplicate/current-state integrity
- `beta:data-quality`: student-facing quality scorecard
- semantic Research readiness
- Programs visibility/classification quality
- source-specific acceptance bars
- Playwright smoke checks for student surfaces after meaningful data changes

Hard failures block promotion. Warnings become review queues, accepted risks, or scoped cleanup tasks.

Quality gates must be split by timing:

- **Current-state gates** inspect the database as it exists now: duplicate entities, weak descriptions, missing leads, stale source URLs, active artifacts on archived rows, invalid public contact/source fields, suspicious emails, missing pathway/access/contact coverage, and program records that should be suppressed or reviewed.
- **Incoming-write gates** inspect a proposed or just-finished run before it becomes trusted: expected artifact types, forbidden artifact types, materialization errors, integrity deltas, source quote quality, accepted LLM samples, source URL hygiene, identity matching risk, and Meili/search sync readiness.

Do not treat a clean run report as proof that the current database is clean. Do not treat a clean current-state scorecard as proof that a new source is safe.

Phase 0 now uses `studentVisibilityTier` as the current-state student trust gate on both Research homes and Programs:

- `student_ready`: safe for prominent browse/search.
- `limited_but_safe`: visible, but copy stays restrained.
- `operator_review`: hidden from normal student browse/search; available through admin review filters.
- `suppressed`: not student-visible.

The tier is computed by `student-visibility-v1` and may be operator-overridden with a review reason. The backfill command is dry-run by default: `yarn --cwd server student-visibility:backfill`. The first full dry-run against the Beta database scanned 2,628 research homes and 187 programs, producing 542 `student_ready`, 777 `limited_but_safe`, 1,487 `operator_review`, and 9 `suppressed` records.

As of 2026-05-25, Phase 0 has a live read-only operator-board slice at `GET /api/admin/operator-board`, surfaced in the Analytics admin panel. It reports Trust Tier counts, reason counts, sample rows, next repair actions, latest gate status, and source/run freshness. This is intentionally a control-plane view over existing data and gates, not a worker system. Worker architecture should be designed around the queues and repair actions observed there.

For Programs, CommunityForce application-detail pages count as official source metadata for current-state repair, but they are application routes first. Rows whose only official source is the application portal carry the `application_source_only` reason and should remain `limited_but_safe` unless a richer non-portal official source page supports promotion. This keeps `/programs` useful as a planning catalog without treating every application-page scrape as prominent student-ready content.

Reviewed exact-title source repairs may promote high-confidence Programs above this cap when they attach a richer official Yale source page. The first such repair pass promoted six undergraduate research/fellowship Programs and left the remaining queues explicit: `missing_official_source` for rows with no verified source page, and `application_source_only` for rows that should stay restrained until a non-portal source exists.

Suppression can also be a repair outcome. Graduate fellowship, dissertation, law-school, and postgraduate-study/Rhodes patterns should move to `Archive / review` with `undergraduateOnly: false` before any source-promotion work. This keeps the source queue focused on plausible undergraduate records instead of asking operators to enrich rows that should not be student-visible.

### 6. Review Queues

The current admin weak-profile triage is the right pattern. Generalize it into pipeline queues:

- weak or missing ResearchEntity descriptions
- missing lead professor or wrong lead
- duplicate or ambiguous entities
- source URL/public source problems
- missing pathway/access/contact evidence
- stale source rows
- conflicting profile identity
- program/fellowship suppression and review
- LLM sample acceptance
- accepted-input files and identity disambiguation

Review queues should produce accepted artifacts or locked decisions that jobs can consume. The student UI should not expose queue labels.

### 7. Search Sync

Meilisearch should be treated as a projection of accepted Mongo state:

- rebuild ResearchEntity and Pathway indexes after accepted chunks
- support swap strategy for production-sensitive rebuilds
- record which run or materialization batch caused a sync
- keep semantic readiness as a gate when semantic search is enabled
- keep search relevance review as a product-quality gate, not just an indexing check

### 8. Promotion

Beta is the data promotion gate. Production promotion is a data operation plus app smoke test:

1. accepted Beta data posture
2. backup/rollback point
3. quality gates
4. source-specific promotion report
5. Meili sync
6. Playwright smoke
7. production source scheduling only after manual promotion is boring

## Data Domains

### Faculty And People

Sources:

- Yale Directory
- department rosters
- official Yale profiles
- accepted ORCID/Scholar inputs
- official lab/team pages

Outputs:

- `User`
- profile bio/topics/departments/photo/websites
- current lead memberships
- compact scholarly attributions

Trust bar:

- official Yale profile and roster evidence for identity/contact/title
- ORCID preferred for external scholarly identity
- no name-only publication identity in public profile activity

### Research Homes

Sources:

- department rosters
- YSM A-Z
- YSE centers
- centers/institutes directories
- official `research.yale.edu`
- lab microsites
- funding sources as enrichment only

Outputs:

- `ResearchEntity`
- `ResearchEntityRelationship`
- source-backed descriptions, methods, topics, lead memberships, websites

Trust bar:

- preserve sparse rows honestly instead of inventing descriptions
- do not classify personal homepages as labs unless source evidence says lab/group
- do not infer undergraduate availability from entity existence

### Ways In And Access

Sources:

- join pages
- application pages
- lab/team pages with undergrad language
- official program routes
- current/past undergraduate evidence
- accepted fellowship-recipient evidence

Outputs:

- `EntryPathway`
- `AccessSignal`
- `ContactRoute`
- `PostedOpportunity` only for real posting/application instances

Trust bar:

- no fake opportunities
- course credit, paid RA work, fellowship funding, and thesis advising are formalization after home/mentor fit unless a hosted program or posting says otherwise
- public contact routes prefer official/public channels

### Research Activity

Sources:

- ORCID
- identity-backed OpenAlex
- DOI/Crossref
- PubMed/Europe PMC
- arXiv only after accepted identity targets

Outputs:

- `research_scholarly_links`
- `research_scholarly_attributions`

Trust bar:

- compact links only, not a full local paper archive
- papers are context, not access evidence
- DOI/publisher or official destinations before OpenAlex fallback

### Programs And Fellowships

Sources:

- Yale College Fellowships Office
- official program pages
- accepted/manual source files where public data is incomplete
- center internship/program pages

Outputs:

- `Fellowship` for now, future `Program` only when storage rename is worth it
- program category/kind/entry mode
- audience, visibility, review status, suppression reason
- best next step and prep steps
- source metadata and cycle freshness

Trust bar:

- normal students should see undergraduate-relevant, student-safe records
- distinguish mentor-first funding from mentor-matching or hosted programs
- keep suppressed/admin/catalog/graduate records out of the default student view

## Recommended Phases

### Phase 0: Stabilize Current Data Quality

Before broadening ingestion, establish a current-state quality board from the existing database:

- top sparse `/research` pages by student impact
- missing or weak `shortDescription` / `fullDescription`
- missing lead professor or lead membership mismatch
- duplicate or ambiguous `ResearchEntity` rows
- research homes without pathway/access/contact artifacts
- source URLs that are forbidden, stale, duplicated, or too generic
- profile identity conflicts and suspicious external scholarly IDs
- Programs/Fellowships rows needing suppression or audience review

This phase should use existing gates first: `beta:data-quality`, `scraper:integrity-gate`, `source:health`, `research-entity:audit-weak-profiles`, `research-entity:audit-description-quality`, `research-entity:audit-best-fit`, and Programs classification reports. Repairs remain dry-run-first and reviewed.

### Phase 1: Make The Existing Pipeline Visible

Do not change execution architecture yet. Add visibility around existing jobs.

- Add a pipeline status API and admin view over `Source`, latest `ScrapeRun`, source coverage, WorkPlanner status, and gate state.
- Normalize run report fields across scraper, repair, accepted-input, replay-cleanup, and backfill commands.
- Add a source readiness matrix to the admin view: disabled, needs dry-run, sample-write ready, beta-ready, production-ready, recurring-ready.
- Add review queue summaries for weak descriptions, missing leads, duplicate entities, missing pathways/contact routes, and program suppression.

### Phase 2: Standardize Job Planning And Acceptance

Create a `PipelineJob` or equivalent plan model before adding workers.

- Store requested scope, source, environment, trigger, gate requirements, accepted artifacts, and retry policy.
- Let CLI create a job record for each run.
- Let admin/operator create bounded jobs from review queues.
- Require accepted review artifacts for broad LLM/arXiv/high-risk jobs.
- Store acceptance decisions so reruns are reproducible.
- Record which current-state quality issue a job is intended to fix, so repairs can be measured against the original defect class.

### Phase 3: Programs And Fellowships Trust

Finish the Programs classification plan before broadening student exposure.

- Materialize `audience`, `visibility`, `reviewStatus`, `classificationConfidence`, `classificationEvidence`, and `suppressionReason`.
- Default `/programs` to student-visible undergraduate records.
- Give admins explicit review/suppressed filters.
- Add a program quality gate that reports suppressed, needs-review, missing source, stale-cycle, and deadline ambiguity counts.

### Phase 4: Research Coverage Expansion

Scale coverage domain by domain, not by running every source broadly.

- Faculty/profile coverage: departments, bios, official profiles, ORCID.
- Research homes: official Yale directories, department rosters, lab microsites, centers/institutes.
- Descriptions: reviewed `lab-microsite-description-llm` chunks only.
- Access evidence: reviewed `lab-microsite-undergrad-llm` chunks only.
- Programs/fellowships: official-cycle pages and accepted/manual source files.

Each domain gets preflight gates, accepted sample outputs, materialization checks, search sync, and Playwright spot checks.

### Phase 5: Workerization Only When Needed

Move from CLI/cron to workers only when the control plane demands it:

- jobs exceed platform cron runtime
- concurrent admin-triggered runs become common
- retries/backoff need durable queue semantics
- operators need pause/resume/cancel
- resource isolation or API rate limiting needs central scheduling

Candidate implementation options:

- Render cron plus CLI remains the default.
- A Render background worker can run `PipelineJob` records from Mongo when needed.
- BullMQ/Redis or Temporal should wait until Mongo-backed job records and operator workflows prove the need.

## Non-Goals

- Do not rebuild `/pathways` as a student destination.
- Do not create a full local publication archive.
- Do not expose all scraped data just because it exists.
- Do not infer access from faculty existence, center membership, funding, or publication activity alone.
- Do not replace the current materializers with an all-purpose generic resolver before the current domains are stable.
- Do not buy worker complexity before job planning and review workflows exist.

## First Implementation Slice

The first slice should be a pipeline visibility/control-plane slice:

1. Add a read-only pipeline status service that joins `Source`, latest `ScrapeRun`, source coverage, and known gate summaries.
2. Add admin API endpoints for pipeline source status and recent runs.
3. Add an admin Pipeline page or Analytics tab section.
4. Add a Programs classification quality panel.
5. Update the production gate so pipeline status is the operator entrypoint.

This gives operators a single place to see what is ready, stale, weak, suppressed, or blocked before changing execution architecture.
