# Decisions

This file records durable product and architecture decisions only.
Do not append continuation logs, security hardening transcripts, or task progress here.
Put tactical work in `docs/tasks/priority-roadmap.md` and keep transient artifacts outside `docs/`.

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

## 2026-05-25: Launch Trust Contract Includes Research Activity

Launch trust is not only visibility and source health.
It also includes research activity, paper quality, source-backed access evidence, PI identity quality, and public visibility safety.

## 2026-05-14: Student-Facing Routes Should Not Use URL Versioning

Research route iteration should happen in place on canonical product routes or behind non-URL feature flags.
Do not add `/v1`, `/v2`, or similar student-facing route versions for normal product iteration.

## 2026-05-11: Use Pathways As The Student Action Layer

Student action should be modeled through source-backed pathways and access signals rather than a binary accepting-undergrads flag.
Compatibility labels can exist during migration, but product language should move toward Ways In, Evidence, and Best Next Step.

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
