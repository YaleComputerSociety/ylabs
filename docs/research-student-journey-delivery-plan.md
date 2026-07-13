# Research Student Journey Delivery Plan

Status: active delivery reference

Last verified: 2026-07-13 against Beta commit `4316b21` and GitHub PRs `#156` through `#171`.

This document is the durable execution map for the Yale Research student journey.
It complements [`product-context.md`](./product-context.md), [`research-model.md`](./research-model.md), [`decisions.md`](./decisions.md), and [`tasks/priority-roadmap.md`](./tasks/priority-roadmap.md).
It does not replace those documents or reproduce local feature-request scratch files.

## North-Star Student Job

Help a Yale student move from a topic, person, method, or question to a credible research home, understand why it may fit, compare and save realistic options, plan a private next step, and act only through a source-backed route whose meaning the product can defend.

Success is not the number of pathway cards, confidence labels, or outbound clicks.
Success is a student making a better-informed decision without the product overstating access, identity, availability, or institutional endorsement.

## Journey Stages

1. **Discover** - find relevant research homes through entity-first browse and search.
2. **Evaluate** - understand the entity, people, research activity, provenance, and any qualified planning context.
3. **Compare** - narrow credible alternatives and prepare a private or explicitly shared comparison.
4. **Plan** - save an option, record notes and stage, set deadlines, and identify what must be verified next.
5. **Act** - use a real application, program, or approved contact route when one is documented.

The stages are a delivery model, not five mandatory screens.
Progressive disclosure should keep early discovery quiet and move detail into the moment when the student needs it.

## Non-Negotiable Principles

### CAS And Authorization

- Preserve Yale CAS and the existing `PrivateRoute`, `AdminRoute`, and server authorization boundaries.
- Public research browse and detail may remain readable where the current product decision permits, but saved planning, account data, moderation, and writes require the existing authenticated routes.
- Never infer authorization from client state, a route label, or a claimed role.

### Privacy And Data Minimization

- Private notes, stages, deadlines, and advising selections remain owner-scoped and server-authorized.
- Advising exports exclude private notes unless the student opts in for each selected item.
- Public DTOs and analytics use bounded allowlists and must not expose internal IDs, raw contact data, query text on downstream actions, or operator metadata.

### Evidence Honesty

- Provenance proves where a claim came from.
It does not prove that a student can act through that source.
- A faculty profile, publication, directory page, or generic entity website is not a documented way in by itself.
- Unknown means the product lacks sufficient evidence.
It does not mean unavailable, closed, or unsuitable.
- Identity, research activity, access, and availability are separate claims with separate evidence.

### Progressive Disclosure

- The plain entity-first research list is the discovery baseline.
- Relevance remains primary.
Access context may only break close relevance ties within a bounded server-owned rule.
- Show at most one sparse, claim-specific, positive planning signal on an entity card.
- Do not add a parallel results stream, persistent access controls, generic scores, or negative unknown labels.
- Offer a `Documented way in` filter only when both states exist and the filter materially narrows the current result set.

## Status Definitions

- **Complete** - acceptance criteria are present in current Beta and supported by merged code and tests.
- **Active** - a useful portion is in Beta, but at least one acceptance criterion remains.
- **Blocked** - delivery requires a named human decision, external system, or unavailable evidence.
- **Not started** - no current Beta implementation satisfies the requirement.

An open or draft PR is evidence of work in progress, never evidence that a requirement is complete on Beta.

## Feature Requirements

### Entity-First Discovery

#### EF-01 - Canonical Entity-First Search

- **Status:** Complete.
- **Depends on:** canonical `ResearchEntity` search index and public visibility tiers.
- **Acceptance criteria:** `/research` presents one primary collection of research profiles; ordinary search does not issue a parallel pathway search; result copy does not expose generic evidence strengths or confidence percentages; professor-name search resolves through current trusted memberships to the canonical entity route; relevance remains the primary ordering signal.
- **Validation evidence:** `client/src/pages/research.tsx`, `client/src/components/research/ResearchHomeCard.tsx`, `server/src/services/researchEntitySearchIndexService.ts`, and their focused tests.
- **PRs:** [#170](https://github.com/YaleComputerSociety/ylabs/pull/170), [#171](https://github.com/YaleComputerSociety/ylabs/pull/171).

#### EF-02 - Adaptive Discovery Filters

- **Status:** Active.
- **Depends on:** accurate query-scoped facet distributions.
- **Acceptance criteria:** school and department controls appear only when their positive buckets can narrow the current results; selected filters remain visible and clearable; missing facet counts never fall back to the total result count; mobile controls do not overflow; a future documented-way-in control follows EF-03 rather than reviving the retired undergraduate-evidence filter.
- **Validation evidence:** PR `#171` hides school and department controls when current distributions cannot narrow and removes the unsupported inactive undergraduate-evidence control.
The count-fallback and final adaptive documented-way-in distribution contract remain to be completed.
- **PRs:** [#171](https://github.com/YaleComputerSociety/ylabs/pull/171).

#### EF-03 - Sparse Documented-Way-In Signal

- **Status:** Not started.
- **Depends on:** QA-01 qualifying-action policy and a bounded server summary plus distribution.
- **Acceptance criteria:** the server returns at most one allowlisted positive signal per entity; the client renders no access label when the signal is absent; PI profiles, publications, provenance URLs, generic participation, and exploratory outreach never create the signal; a filter appears only when documented and undocumented homes both exist and the split is materially useful; no client-side access inference or reranking occurs.
- **Validation evidence:** current Beta deliberately removed the prior parallel `Verified ways in` presentation in PR `#171`.
No replacement summary is present yet.
- **PRs:** [#171](https://github.com/YaleComputerSociety/ylabs/pull/171) establishes the baseline only.

#### EF-04 - Stable And Efficient Discovery Requests

- **Status:** Complete.
- **Depends on:** URL-hydrated search state and abort-safe request ownership.
- **Acceptance criteria:** equivalent initial and URL-hydrated searches deduplicate at dispatch; Strict Mode replay does not duplicate requests or apply stale results; pagination remains usable; changes preserve canonical query URLs.
- **Validation evidence:** research and dashboard request-deduplication tests merged with PR `#165`.
- **PRs:** [#165](https://github.com/YaleComputerSociety/ylabs/pull/165).

### Evidence-Backed Profile

#### EP-01 - Trustworthy Entity And Lead Identity

- **Status:** Complete.
- **Depends on:** current non-archived memberships, stable user/faculty identifiers, and public visibility gates.
- **Acceptance criteria:** profile pages use the canonical entity; trusted stable identifiers establish lead identity; a conflict suppresses the untrusted pairing and renders an honest under-review state; names alone do not reconcile identity; professor-name discovery uses the same trusted membership boundary.
- **Validation evidence:** lead-identity audit/service tests and professor-name index tests.
- **PRs:** [#159](https://github.com/YaleComputerSociety/ylabs/pull/159), [#170](https://github.com/YaleComputerSociety/ylabs/pull/170).

#### EP-02 - Claim-Specific Evidence And Provenance

- **Status:** Active.
- **Depends on:** source-safe DTO shaping, publication attribution, and QA-01.
- **Acceptance criteria:** research description, identity, research activity, undergraduate participation, and action availability remain distinct claims; source labels explain provenance without implying access; duplicate or identity-conflicting publications do not appear as current entity activity; no generic confidence score substitutes for claim language.
- **Validation evidence:** detail source ledger and evidence components exist; PR `#158` separates current, earlier, conflicting, and duplicate research activity; PR `#171` removes generic discovery evidence/confidence labels.
Action-specific provenance still depends on QA-01.
- **PRs:** [#158](https://github.com/YaleComputerSociety/ylabs/pull/158), [#171](https://github.com/YaleComputerSociety/ylabs/pull/171).

#### EP-03 - Bounded Related-Entity Detail Payload

- **Status:** Complete.
- **Depends on:** public visibility tiers and card-only related-entity projection.
- **Acceptance criteria:** related and affiliated entities use a strict summary allowlist; each direction is bounded with truncation metadata; private/operator fields and direct contact information are absent; navigation fetches the full profile only when opened.
- **Validation evidence:** representative 99-related-hub regression reduced the bounded payload from 1,938,003 bytes to 22,049 bytes, with projection and redaction tests.
- **PRs:** [#167](https://github.com/YaleComputerSociety/ylabs/pull/167).

### Comparison And Planning

#### CP-01 - Saved Research Plans

- **Status:** Complete.
- **Depends on:** CAS-authenticated user routes and publishable pathway IDs.
- **Acceptance criteria:** a student can save and remove a research plan; reads and writes are owner-scoped; saved-plan details hydrate from the server; malformed or oversized values are bounded; optimistic UI failures remain recoverable.
- **Validation evidence:** authenticated `/api/users/savedResearchPlans` and `/api/users/savedResearchPlanDetails` routes, `SavedPathwaysSection`, user-service sanitization, and focused route/service/client tests.
- **PRs:** capability predates the reconciled `#156`-`#171` tranche; [#164](https://github.com/YaleComputerSociety/ylabs/pull/164) extends its persisted planning contract.

#### CP-02 - Private Notes, Stage, Deadlines, And Follow-Up

- **Status:** Complete.
- **Depends on:** CP-01 and owner-scoped revision-safe persistence.
- **Acceptance criteria:** research-plan details persist bounded notes and stage; optional target deadlines, acted-on dates, and follow-up intervals use sanitized date-only values; save status and failures are honest; due cues derive deterministically; removal clears associated detail.
- **Validation evidence:** `server/src/services/userService.ts`, `/api/users/savedResearchPlanDetails/:pathwayId`, `SavedPathwaysSection`, and deadline/follow-up tests.
- **PRs:** [#164](https://github.com/YaleComputerSociety/ylabs/pull/164).

#### CP-03 - Private-By-Default Comparison And Advising Export

- **Status:** Complete.
- **Depends on:** CP-01 and explicit student selection.
- **Acceptance criteria:** exports require selected finalists; a preview shows exactly what will be shared; private notes are excluded by default and require per-item opt-in; print/PDF and Markdown contain source-backed planning context without inventing advisor identity.
- **Validation evidence:** advising-export tests in `SavedPathwaysSection` cover selection, preview, note exclusion, and Markdown output.
- **PRs:** [#163](https://github.com/YaleComputerSociety/ylabs/pull/163).

#### CP-04 - Program And Fellowship Planning Context

- **Status:** Active.
- **Depends on:** canonical `/programs`, program metadata quality, and recurring source refresh.
- **Acceptance criteria:** saved program notes and application stage persist with revision conflict handling; matches respect known student level and timeline while leaving missing metadata unknown; recurring refresh is bounded, dry-run-first, environment-guarded, and enabled only after human production acceptance.
- **Validation evidence:** persistence and matcher behavior are merged; refresh CLI is merged but recurring production scheduling remains deliberately disabled pending rollout acceptance.
- **PRs:** [#156](https://github.com/YaleComputerSociety/ylabs/pull/156), [#157](https://github.com/YaleComputerSociety/ylabs/pull/157), [#162](https://github.com/YaleComputerSociety/ylabs/pull/162).

### Qualified Action

#### QA-01 - Defensible Application, Program, Or Contact Action

- **Status:** Blocked.
- **Depends on:** approved product contract, reviewed public contact routes, actionable source evidence, and EF-03.
- **Acceptance criteria:** a positive action requires a current/recurring non-formalization record and explicit proof such as an open application, recurring official program, or approved non-PI public contact route; PI profiles and generic source pages remain source review only; the card shows at most one claim-specific action; absence renders no negative label; server policy and client analytics share the same qualifying enum.
- **Validation evidence:** current publication policy and access-review infrastructure exist, but Beta still permits broader publishable pathways than this action contract.
PR `#171` removed the misleading student-facing stream while the replacement policy is designed.
- **PRs:** [#161](https://github.com/YaleComputerSociety/ylabs/pull/161), [#171](https://github.com/YaleComputerSociety/ylabs/pull/171).
- **Blocker:** a human must accept the qualifying-action enum and evidence threshold, then operators must review routes that will be represented as actionable.

#### QA-02 - Accessible And Honest Account Onboarding

- **Status:** Complete.
- **Depends on:** Yale CAS session, unknown-user route guard, and authenticated current-user update.
- **Acceptance criteria:** validation errors are announced and associated with fields; focus moves to the first invalid field; the role control has native keyboard and screen-reader semantics; loading and failure states are honest; completion renders only after the server returns the persisted submitted identity and allowed role; client input cannot elevate confirmation or authorization.
- **Validation evidence:** focused onboarding accessibility/persistence tests plus full client/server and security suites.
- **PRs:** [#169](https://github.com/YaleComputerSociety/ylabs/pull/169).

### Supply And Moderation

#### SM-01 - Lead Identity Consistency

- **Status:** Complete.
- **Depends on:** stable faculty/user keys and official profile URLs.
- **Acceptance criteria:** see EP-01; audits expose aggregate repair posture without leaking person identifiers by default.
- **Validation evidence:** deterministic identity validation and bounded audit merged in PR `#159`.
- **PRs:** [#159](https://github.com/YaleComputerSociety/ylabs/pull/159).

#### SM-02 - Faculty Claim And Correction Review

- **Status:** Active.
- **Depends on:** confirmed faculty/staff authorization and admin review.
- **Acceptance criteria:** eligible users can submit a claim or correction from a linked research profile; duplicate pending requests are prevented; students, unknown users, and unconfirmed accounts are denied; admins can review with rationale and audit history; an approved decision hands off to a separately guarded mutation rather than silently changing data.
- **Validation evidence:** listing-linked claim/correction and non-mutating admin review are merged.
Entity-wide correction coverage beyond linked listings remains future work.
- **PRs:** [#160](https://github.com/YaleComputerSociety/ylabs/pull/160).

#### SM-03 - Scalable Human Review Without Bulk Approval

- **Status:** Complete.
- **Depends on:** access-review indexes and explicit per-record decisions.
- **Acceptance criteria:** operators can filter and sort by unreviewed volume and official-application priority; queues expose progress and pagination; keyboard focus advances after a decision; every decision remains one-record-at-a-time with rationale; raw contact destinations are redacted.
- **Validation evidence:** server/client access-review tests and compound indexes merged in PR `#161`.
- **PRs:** [#161](https://github.com/YaleComputerSociety/ylabs/pull/161).

#### SM-04 - Publication And Source Trust Guards

- **Status:** Complete.
- **Depends on:** canonical scholarly identifiers, current memberships, and evidence-first materialization.
- **Acceptance criteria:** duplicate scholarly works collapse; identity conflicts do not publish; earlier work is distinguished from current work; recurring scrapers remain bounded and guarded; obsolete unreferenced modules do not remain implied runtime owners.
- **Validation evidence:** research-activity integrity audit and current/earlier payload tests; maintenance deletion verified routes/imports before removal.
- **PRs:** [#158](https://github.com/YaleComputerSociety/ylabs/pull/158), [#168](https://github.com/YaleComputerSociety/ylabs/pull/168).

#### SM-05 - Deliberate Admin Authority

- **Status:** Complete.
- **Depends on:** existing admin authority model and audit storage.
- **Acceptance criteria:** admin grants require bounded reviewer notes and typed NetID confirmation; self and duplicate grants fail atomically; profile-derived authority remains distinguishable; authorization cache invalidates correctly; no legacy NetID appears in student-facing copy.
- **Validation evidence:** server/client grant tests and security preflight merged in PR `#166`.
- **PRs:** [#166](https://github.com/YaleComputerSociety/ylabs/pull/166).

### Invisible Measurement

#### IM-01 - Claim-Specific Journey Analytics

- **Status:** Not started.
- **Depends on:** QA-01 server-owned qualifying signal and an accepted privacy-safe analytics taxonomy.
- **Acceptance criteria:** invisible events distinguish search, research-profile open, source review, qualified action, filter-panel open/close, filter apply/remove, and save/unsave; only a qualified action counts as access conversion; faculty profile, website, ORCID, publication, filter, and save events never count as action; analytics does not delay navigation or alter UI; payloads exclude raw URLs, queries on downstream events, and free-text notes.
- **Validation evidence:** current analytics distinguishes generic source, contact, pathway, save, and research-view events but canonical research browse/detail lacks the required complete taxonomy.
One existing program filter-navigation event is still classified too broadly as `ways_in_click`.
- **PRs:** none.

#### IM-02 - Search Quality, Zero Results, And Funnel Integrity

- **Status:** Active.
- **Depends on:** IM-01 and stable entity-first search result semantics.
- **Acceptance criteria:** one submitted search records one results, zero-results, or error outcome; result counts are bucketed; action attribution stops at the next search; dashboards keep source review separate from qualified action; monitoring detects relevance degradation without storing query text on action events.
- **Validation evidence:** existing search-quality analytics includes zero-result and engagement concepts, but canonical entity-first client emissions and the new conversion boundary are incomplete.
- **PRs:** [#171](https://github.com/YaleComputerSociety/ylabs/pull/171) stabilizes the result model that measurement must follow.

## Delivery Phases

### Phase 1 - Preserve The Entity-First Baseline

- Keep EF-01 and EF-04 green while completing EF-02.
- Add regression coverage that ordinary discovery makes one entity search and renders one primary profile collection.
- Do not reintroduce pathway cards, generic evidence labels, confidence percentages, or persistent access controls.

### Phase 2 - Define Qualified Action Once

- Resolve the QA-01 human decision.
- Implement one server-owned qualifier and enum used by detail, search summary, filters, and analytics.
- Audit existing exploratory and PI-profile-derived records before any action signal is public.

### Phase 3 - Add Sparse Planning Context

- Deliver EF-03 through a bounded summary, query-scoped distribution, and at most one quiet positive card signal.
- Complete adaptive filters and mobile overflow/accessibility tests.
- Preserve relevance-primary ordering and server-owned bounded tie behavior.

### Phase 4 - Measure Invisibly

- Deliver IM-01 and IM-02 after the action enum is stable.
- Backfill no historical conversions from generic source or pathway clicks.
- Validate dashboards against zero results, source review, save, and qualified action as separate outcomes.

### Phase 5 - Expand Supply With Review Capacity

- Extend SM-02 beyond listing-linked claims only when the mutation and review owner are explicit.
- Enable recurring production refresh only after restore, rollback, smoke, and operator acceptance are recorded.
- Use queue throughput and evidence quality, not raw record volume, as the supply health measure.

## Decision Log

### 2026-07-13 - Plain Entity List Is The Discovery Baseline

Research profiles are the single primary result collection.
Planning context is sparse and optional, and never a competing stream.

### 2026-07-13 - Provenance Is Not Action

A source URL can support a research, identity, or history claim without supporting an application or contact action.
Only QA-01 may establish the action boundary.

### 2026-07-13 - Unknown Is Not Unavailable

Missing qualifying evidence produces no positive signal and no negative label.
It must not be translated into closed, unavailable, no opportunities, or unsuitable.

### 2026-07-13 - Relevance Remains Primary

Any planning-context boost is server-owned, bounded to close relevance ties, and unable to promote a weak match over a materially stronger research match.

### 2026-07-13 - Analytics Is Invisible

Measurement must not add UI, delay navigation, expose private data, or redefine a generic source click as conversion.

## Human And External Blockers

1. **Qualified-action contract:** product and trust owners must accept the positive signal enum, required proof, and confidence/evidence threshold for QA-01.
2. **Route review:** operators must review application and contact routes before those records become a public positive action signal.
3. **Production refresh:** fellowship refresh remains disabled until Atlas restore evidence, rollback ownership, database target checks, and smoke acceptance are complete.
4. **Deployment topology:** Render web-service settings are managed outside `render.yaml`; compression, durable scorecard storage, and deployment fingerprints require control-plane verification.
5. **Authenticated browser evidence:** CAS-preserving end-to-end checks require a valid test session and supported browser runner; never bypass CAS to manufacture evidence.

## Maintenance Protocol

Every PR that implements or changes a requirement in this document must update this file in the same PR.

The update must:

1. reference the stable requirement ID in the PR title or body;
2. change status only when the acceptance criteria justify it on the PR target branch;
3. add or update concrete code, test, route, data, or operator evidence;
4. add the PR link, while keeping an unmerged PR described as pending rather than complete on Beta;
5. record new human or external blockers explicitly;
6. update the decision log only for durable product or architecture decisions;
7. avoid copying transient run logs, screenshots, local plans, or private data into tracked documentation;
8. reconcile this plan after merges, closes, superseding work, or rollback.

Reviewers should reject an implementing PR that changes journey behavior without updating its requirement row.
Periodic maintenance should verify links, route names, command names, PR states, and statuses against current Beta rather than trusting historical prose.
