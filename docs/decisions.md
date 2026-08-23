# Decisions

This file records durable product and architecture decisions only.
Do not append continuation logs, security hardening transcripts, or task progress here.
Put tactical work in `docs/tasks/priority-roadmap.md` and keep transient artifacts outside `docs/`.

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
The Development refresh mirrors every approved Beta product, scraper-audit, support, compatibility, and user document.
It never reads Beta operational or student-workflow collections, clears Atlas Development non-mirror collections, preserves public faculty identities, pseudonymizes other users, removes account activity fields, and rebuilds local Meilisearch separately.
Unclassified Beta collections block apply until their mirror policy is reviewed.
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
Listings remain a compatibility path for older posted-role workflows until they are fully replaced or removed.
