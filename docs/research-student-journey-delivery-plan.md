# Research Student Journey Delivery Plan

Status: active delivery reference

Last verified: 2026-07-15 against Beta commit `0dbf9206` and the pending IM-01 implementation.

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
- **Validation evidence:** PR `#171` removed the unsupported undergraduate-evidence control.
  The pending EF-02 change adds one adaptive Research filter disclosure, query-scoped positive school and department choices, persistent selected values without invented counts, URL-backed removable chips, clear-one and clear-all actions, independent facet-error handling, a non-modal desktop disclosure, and a focus-contained mobile sheet with focused responsive and accessibility tests.
  The documented-way-in distribution remains separate EF-03 work and is not exposed as a filter.
- **PRs:** [#171](https://github.com/YaleComputerSociety/ylabs/pull/171); issue [#184](https://github.com/YaleComputerSociety/ylabs/issues/184) change pending merge.

#### EF-03 - Sparse Documented-Way-In Signal

- **Status:** Active.
- **Depends on:** QA-01 qualifying-action policy and a bounded server summary plus distribution.
- **Acceptance criteria:** the server returns at most one allowlisted positive signal per entity; the client renders no access label when the signal is absent; PI profiles, publications, provenance URLs, generic participation, and exploratory outreach never create the signal; a filter appears only when documented and undocumented homes both exist and the split is materially useful; no client-side access inference or reranking occurs.
- **Validation evidence:** current Beta deliberately removed the prior parallel `Verified ways in` presentation in PR `#171`.
  The qualified-planning-context implementation adds a bounded, optional server projection with one deterministic signal per entity and deny-by-default policy tests; query-scoped distribution and client presentation remain separate work.
- **PRs:** [#171](https://github.com/YaleComputerSociety/ylabs/pull/171) establishes the baseline only.

#### EF-04 - Stable And Efficient Discovery Requests

- **Status:** Complete.
- **Depends on:** URL-hydrated search state and abort-safe request ownership.
- **Acceptance criteria:** equivalent initial and URL-hydrated searches deduplicate at dispatch; Strict Mode replay does not duplicate requests or apply stale results; pagination remains usable; changes preserve canonical query URLs.
- **Validation evidence:** research and dashboard request-deduplication tests merged with PR `#165`.
- **PRs:** [#165](https://github.com/YaleComputerSociety/ylabs/pull/165).

#### EF-05 - Quiet Research-Activity Ranking Input - FR-44

- **Status:** Active.
- **Depends on:** EP-06 / FR-42.2 activity rollups.
- **Acceptance criteria:** a bounded, freshness-aware activity signal may order otherwise comparable entity matches or choose quiet signal precedence; relevance remains primary; no publication count, activity score, or separate activity cluster competes with the entity result; missing activity is neutral rather than negative.
- **Validation evidence:** current Beta has attribution guards but does not have the required cached entity rollups.
- **PRs:** none.
- **Blocker:** FR-42.2 must define trustworthy cached activity before ranking consumes it.

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

#### EP-04 - Source-Backed Undergraduate Logistics - FR-16

- **Status:** Blocked.
- **Depends on:** new evidence acquisition and reviewed observation/materialization contracts.
- **Acceptance criteria:** profiles may show student level, compensation/formalization mode, research modality, or current availability only when a source supports that exact claim; unknown values remain absent or neutrally disclosed on detail, never inferred from department, methods, or a generic undergrad signal; any future facet uses the same claim-specific evidence.
- **Validation evidence:** model fields exist, but current corpus coverage is not sufficient to support a trustworthy student surface.
- **PRs:** none.
- **Blocker:** source acquisition and false-positive review are required before UI delivery.

#### EP-05 - Research-Home Member Roster Beyond The Lead - FR-18

- **Status:** Blocked.
- **Depends on:** official roster acquisition, identity matching, current-role evidence, and public-person policy.
- **Acceptance criteria:** detail pages may list graduate students, postdocs, staff, or other current members only from official, current, attributable roster evidence; roles and source context are explicit; stale or ambiguous people are withheld; the section does not turn names into unsolicited-contact recommendations.
- **Validation evidence:** the detail/member rendering path exists, but acquisition coverage is lead-heavy and does not satisfy the roster requirement.
- **PRs:** none.
- **Blocker:** new roster scraping and identity-quality review.

#### EP-06 - Trustworthy Activity Ordering And Rollups - FR-19 / FR-42.2

- **Status:** Active.
- **Depends on:** canonical scholarly identifiers, current membership attribution, and cache refresh ownership.
- **Acceptance criteria:** detail activity is newest-first; current and earlier work remain separate; duplicate and identity-conflicting work is excluded; entity rollups expose bounded recency/count facts with deterministic refresh and invalidation; missing activity is unknown, not inactive; rollups can support EF-05 without exposing generic scores.
- **Validation evidence:** PR `#158` completed contamination, duplicate, and current-versus-earlier guards.
  Cached rollups and their refresh path are not implemented on Beta.
- **PRs:** [#158](https://github.com/YaleComputerSociety/ylabs/pull/158) covers the completed portion only.

### Comparison And Planning

#### CP-01 - Saved Research Plans

- **Status:** Complete.
- **Depends on:** CAS-authenticated user routes and canonical ResearchEntity IDs.
- **Acceptance criteria:** a student can save and remove a research plan; reads and writes are owner-scoped; saved-plan details hydrate from the server; malformed or oversized values are bounded; optimistic UI failures remain recoverable.
- **Validation evidence:** authenticated `/api/users/savedResearchEntities` and `/api/users/savedResearchEntityPlans` routes, `SavedPathwaysSection`, user-service sanitization and migration guards, and focused route/service/client tests.
  Saved-item removal follows the successfully loaded saved-item API mode independently of plan-detail hydration, and legacy fallback is limited to canonical `404`, `405`, or `501` responses.
- **PRs:** capability predates the reconciled `#156`-`#171` tranche; [#164](https://github.com/YaleComputerSociety/ylabs/pull/164) extended its persisted planning contract, [#191](https://github.com/YaleComputerSociety/ylabs/pull/191) moved ownership to ResearchEntity, and [#194](https://github.com/YaleComputerSociety/ylabs/pull/194) preserves removal and transient-failure safety during compatibility fallback.

#### CP-02 - Private Notes, Stage, Deadlines, And Follow-Up

- **Status:** Complete.
- **Depends on:** CP-01 and owner-scoped revision-safe persistence.
- **Acceptance criteria:** research-plan details persist bounded notes and stage; optional target deadlines, acted-on dates, and follow-up intervals use sanitized date-only values; save status and failures are honest; due cues derive deterministically; removal clears associated detail.
- **Validation evidence:** `server/src/services/userService.ts`, `/api/users/savedResearchEntityPlans/:entityId`, `SavedPathwaysSection`, and deadline/follow-up tests.
- **PRs:** [#164](https://github.com/YaleComputerSociety/ylabs/pull/164), [#191](https://github.com/YaleComputerSociety/ylabs/pull/191).

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

#### CP-05 - Entity-Level Saving - FR-45

- **Status:** Complete.
- **Depends on:** canonical ResearchEntity identity and CAS-authenticated owner-scoped persistence.
- **Acceptance criteria:** a student can save a research entity even when it has no indexed pathway; save identity is the entity, not `entryPathways[0]`; existing pathway plans migrate or coexist without duplication; detail and search cards show server-confirmed state; authorization and privacy remain unchanged.
- **Validation evidence:** `savedResearchEntities` and `savedResearchEntityPlans` use canonical entity ids; `labDetail.tsx` saves the entity directly; the account workspace preserves owner-scoped browser plans during migration; and the server atomically claims one-time legacy migration while retaining collisions for private review.
- **PRs:** [#191](https://github.com/YaleComputerSociety/ylabs/pull/191), [#194](https://github.com/YaleComputerSociety/ylabs/pull/194).
- **Dependency note:** CP-06 / FR-17 and CP-07 / FR-24 can build on canonical entity identity.

#### CP-06 - Compare Shortlisted Research Homes - FR-17

- **Status:** Blocked.
- **Depends on:** CP-05 / FR-45.
- **Acceptance criteria:** an authenticated student can choose two to four saved entities and compare existing claim-specific fields without inventing missing facts; private notes remain private unless explicitly included; rows preserve unknown rather than unavailable; comparison links return to canonical entity profiles; no pathway identity or duplicate home columns.
- **Validation evidence:** advising selection/preview patterns exist in PR `#163`, but there is no entity-level shortlist to compare.
- **PRs:** none; FR-17 is actively assigned, but unmerged work is not Beta evidence.
- **CAS boundary:** the logged-in comparison can ship after FR-45; any logged-out variant remains blocked by CP-09 / FR-14 policy.

#### CP-07 - Dashboard Entity Names And Live Counts - FR-24

- **Status:** Complete.
- **Depends on:** CP-05 / FR-45.
- **Acceptance criteria:** dashboard cards lead with canonical research-home names; section and selected counts reflect hydrated server state; stale pathway aliases do not masquerade as entity names; loading, empty, and failure counts are honest; entity saves without pathways remain visible.
- **Validation evidence:** `SavedPathwaysSection` hydrates bounded ResearchEntity summaries, keys planning state and counts by entity id, and uses legacy pathways only as optional migration and fellowship context.
- **PRs:** [#165](https://github.com/YaleComputerSociety/ylabs/pull/165), [#191](https://github.com/YaleComputerSociety/ylabs/pull/191).

#### CP-08 - Shared Mobile Filter-Sheet Pattern - FR-37

- **Status:** Active.
- **Depends on:** surface-specific facet contracts and accessible focus management.
- **Acceptance criteria:** Research and Programs use one shared filter-sheet interaction pattern on small viewports while retaining their own facets; opening moves focus into a labelled modal/sheet; Escape, close, apply, and focus return work by keyboard and screen reader; selected-count and clear behavior are honest; desktop remains quiet; no horizontal overflow.
- **Validation evidence:** PR `#175` added the bounded, labelled Programs mobile sheet with focus entry, containment, Escape close, and focus restoration.
  The pending EF-02 change gives Research the same small-screen interaction contract while retaining a non-modal desktop disclosure, active count, clear actions, focus containment and restoration, and narrow-viewport overflow guards.
- **PRs:** [#175](https://github.com/YaleComputerSociety/ylabs/pull/175); issue [#184](https://github.com/YaleComputerSociety/ylabs/issues/184) Research change pending merge.

#### CP-09 - Honest Logged-Out Saving - FR-14

- **Status:** Active.
- **Depends on:** a human decision between sign-in gating and a real guest shortlist; CP-05 if guest entity saving is chosen.
- **Acceptance criteria:** an anonymous visitor never sees save success without a retrievable saved entity; the product either requests CAS before saving or persists and later migrates a bounded guest shortlist; copy does not promise dashboard, comparison, or funding behavior that did not occur.
- **Validation evidence:** CAS-authenticated saved planning is complete, but the anonymous save policy remains unresolved.
- **PRs:** none for the remaining anonymous scope.

### Qualified Action

#### QA-01 - Defensible Application, Program, Or Contact Action

- **Status:** Blocked.
- **Depends on:** approved product contract, reviewed public contact routes, actionable source evidence, and EF-03.
- **Acceptance criteria:** a positive action requires a current/recurring non-formalization record and explicit proof such as an open application, recurring official program, or approved non-PI public contact route; PI profiles and generic source pages remain source review only; the card shows at most one claim-specific action; absence renders no negative label; server policy and client analytics share the same qualifying enum.
- **Validation evidence:** current publication policy and access-review infrastructure exist, and PR `#171` removed the misleading student-facing stream.
  The qualified-planning-context implementation establishes a narrower public projection: reviewed current opportunities with safe application URLs, approved application or recurring-program instructions, and approved safe public non-PI routes qualify; profile provenance, generic source material, exploratory contact, formalization-only records, unsafe URLs, and unreviewed claims do not.
- **PRs:** [#161](https://github.com/YaleComputerSociety/ylabs/pull/161), [#171](https://github.com/YaleComputerSociety/ylabs/pull/171).
- **Blocker:** operators must review routes and source-backed claims before they can be represented as actionable; query-scoped distribution, client presentation, and analytics still depend on the stable projection.
  The operational program is named the **evidence and route review rollout**.
  Its acceptance measures are claim quality, reviewed-action precision, false-positive rate, and explainable rejection reasons, not a minimum number of published pathways.
  PI-profile provenance can never qualify as an action.

#### QA-02 - Accessible And Honest Account Onboarding

- **Status:** Complete.
- **Depends on:** Yale CAS session, unknown-user route guard, and authenticated current-user update.
- **Acceptance criteria:** validation errors are announced and associated with fields; focus moves to the first invalid field; the role control has native keyboard and screen-reader semantics; loading and failure states are honest; completion renders only after the server returns the persisted submitted identity and allowed role; client input cannot elevate confirmation or authorization.
- **Validation evidence:** focused onboarding accessibility/persistence tests plus full client/server and security suites.
- **PRs:** [#169](https://github.com/YaleComputerSociety/ylabs/pull/169).

#### QA-03 - Cross-Surface Accessibility Hygiene - FR-41

- **Status:** Active.
- **Depends on:** route-by-route keyboard, focus, error-association, landmark, and responsive validation.
- **Acceptance criteria:** canonical student flows have labelled controls, programmatically associated errors, announced async states, logical focus movement, unique landmarks/headings, 44-pixel primary targets, and no 320/375-pixel overflow; fixes use shared primitives where behavior is shared.
- **Validation evidence:** PRs `#154` and `#169` completed major Programs and onboarding slices, and `#171` simplified Research.
  The cross-surface audit remains incomplete.
- **PRs:** [#154](https://github.com/YaleComputerSociety/ylabs/pull/154), [#169](https://github.com/YaleComputerSociety/ylabs/pull/169), [#171](https://github.com/YaleComputerSociety/ylabs/pull/171).

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

#### SM-06 - Close The Admin Curation Loop - FR-29

- **Status:** Not started.
- **Depends on:** explicit mutation ownership, current review queues, and post-write re-gating.
- **Acceptance criteria:** an accepted review decision can invoke a separately authorized, audited, idempotent mutation or repair handoff; success and failure are visible; the record is re-gated and search synchronization is explicit; review approval alone never silently mutates canonical data.
- **Validation evidence:** PRs `#160` and `#161` provide reviewed handoff and queue throughput, intentionally without canonical mutation.
- **PRs:** [#160](https://github.com/YaleComputerSociety/ylabs/pull/160), [#161](https://github.com/YaleComputerSociety/ylabs/pull/161) are dependencies, not completion.

#### SM-07 - Faculty Posts A Real Opportunity - FR-32

- **Status:** Not started.
- **Depends on:** confirmed professor/faculty authorization, verified profile readiness, canonical entity ownership/claim resolution, and PostedOpportunity validation.
- **Acceptance criteria:** a CAS-authenticated, confirmed, authorized faculty user can create a bounded real posting linked to a canonical entity; students, unknown users, unconfirmed accounts, and unverified owners are denied server-side; preview, deadline/status, application route, archive, audit, and public visibility behavior are explicit; creation does not bypass evidence or moderation policy.
- **Validation evidence:** PR `#153` repaired faculty profile editing and PR `#160` added claim/correction handoff, but no canonical faculty opportunity-creation journey is complete.
- **PRs:** [#153](https://github.com/YaleComputerSociety/ylabs/pull/153), [#160](https://github.com/YaleComputerSociety/ylabs/pull/160) are dependencies only.
- **CAS boundary:** this is never an anonymous capability.

#### SM-08 - Pending-Confirmation Path Forward - FR-35

- **Status:** Not started.
- **Depends on:** a human-owned verification process, status source, and escalation/support route.
- **Acceptance criteria:** an authenticated pending user sees their actual status, permitted read-only capabilities, what evidence or human action is outstanding, and a safe support/escalation route; the UI does not imply automatic approval or grant premature authority; state changes come from server-confirmed verification.
- **Validation evidence:** PR `#169` makes unknown-user onboarding completion honest, but it does not provide the subsequent human confirmation workflow.
- **PRs:** [#169](https://github.com/YaleComputerSociety/ylabs/pull/169) is a prerequisite only.

### Invisible Measurement

#### IM-01 - Claim-Specific Journey Analytics

- **Status:** Active.
- **Depends on:** QA-01 server-owned qualifying signal and an accepted privacy-safe analytics taxonomy.
- **Acceptance criteria:** invisible events distinguish search, research-profile open, source review, qualified action, filter-panel open/close, filter apply/remove, and save/unsave; only a qualified action counts as access conversion; faculty profile, website, ORCID, publication, filter, and save events never count as action; analytics does not delay navigation or alter UI; payloads exclude raw URLs, queries on downstream events, and free-text notes.
- **Validation evidence:** the pending IM-01 implementation adds the canonical contract in [`research-journey-analytics.md`](./research-journey-analytics.md), terminal search outcomes, canonical entity impressions and profile opens, source and filter events, first-class save/compare/plan events, server-requalified QA-01 actions, per-actor idempotency, and separately auditable admin journey metrics.
  Legacy generic events remain for older surfaces but do not count as access conversion.
- **PRs:** [#198](https://github.com/YaleComputerSociety/ylabs/pull/198) is pending against Beta.

#### IM-02 - Search Quality, Zero Results, And Funnel Integrity

- **Status:** Active.
- **Depends on:** IM-01 and stable entity-first search result semantics.
- **Acceptance criteria:** one submitted search records one results, zero-results, or error outcome; result counts are bucketed; action attribution stops at the next search; dashboards keep source review separate from qualified action; monitoring detects relevance degradation without storing query text on action events.
- **Validation evidence:** the pending IM-01 implementation emits one idempotent terminal outcome per canonical search, uses bounded result-count buckets without raw query text, and keeps source inspections, qualified official-route attempts, application opens, and reported outcomes distinct in the admin funnel.
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
- Run the evidence and route review rollout with sampled claim-quality and false-positive metrics.
- Do not use a target such as `>=25 pathways` as evidence that the action contract is trustworthy.

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
2. **Evidence and route review rollout:** operators must review application and contact-route claims before those records become a public positive action signal, record false-positive and rejection-reason metrics, and explicitly exclude PI-profile provenance.
3. **Production refresh:** fellowship refresh remains disabled until Atlas restore evidence, rollback ownership, database target checks, and smoke acceptance are complete.
4. **Deployment topology:** Render web-service settings are managed outside `render.yaml`; compression, durable scorecard storage, and deployment fingerprints require control-plane verification.
5. **Authenticated browser evidence:** CAS-preserving end-to-end checks require a valid test session and supported browser runner; never bypass CAS to manufacture evidence.

## Validation Support And Dispute Matrix

This matrix separates current Beta evidence from older persona observations and unresolved product choices.
The 2026-07-13 validation lane could not retrieve the referenced historical Claude transcript and could not start the Chrome bridge.
Its evidence is therefore current Beta source, routes, tests, and merged history rather than a fresh authenticated browser replay.

| Claim                                                                                                  | Current support                                                                                                                                                                  | Delivery interpretation                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity-first discovery is the correct current baseline.                                                | **Supported.** PR `#171` removes the parallel pathway request and stream and keeps research profiles primary.                                                                    | Keep EF-01 Complete and protect it with regression tests.                                                                                                       |
| Discovery filters are fully adaptive and progressively disclosed.                                      | **Pending merge.** The EF-02 change gives Research its own compact desktop disclosure and mobile sheet, uses only positive query-scoped facet counts, preserves selected values without invented counts, and keeps base search usable when facet metadata fails. | Keep EF-02 Active until the change merges into Beta; keep the documented-way-in filter governed separately by EF-03.                                            |
| A server-qualified sparse planning summary exists.                                                     | **Not supported.** No bounded claim-specific summary or useful-state distribution exists.                                                                                        | Keep EF-03 Not started and dependent on QA-01.                                                                                                                  |
| Research homes can be saved independently of pathways.                                                 | **Supported.** Saves and private plan details are keyed by canonical ResearchEntity ID, including entities without an indexed pathway.                                           | Keep CP-05 / FR-45 Complete and preserve migration-continuity coverage as FR-17 and FR-24 build on entity identity.                                             |
| Canonical research analytics distinguish search, profile, source, filters, save, and qualified action. | **Supported in the pending IM-01 implementation.** The server owns the allowlisted taxonomy, entity validation, action re-qualification, and per-actor idempotency boundary.     | Keep IM-01 and IM-02 Active until the implementation merges into Beta; never reinterpret legacy generic events as conversion.                                   |
| Publishing a target number of pathways establishes trustworthy access coverage.                        | **Disputed.** Quantity does not establish claim or route quality and can reward false positives.                                                                                 | The evidence and route review rollout uses claim precision, false-positive rate, rejection reasons, and reviewed-action quality instead.                        |
| Historical persona findings describe current Beta behavior.                                            | **Validation pending.** Several cited defects were changed by merged PRs, while the referenced transcript and fresh browser replay were unavailable.                             | Use historical observations as discovery inputs only; require current code, test, data, or CAS-preserving browser evidence before changing status or rationale. |

Unresolved UX choices remain validation-pending even when engineering dependencies are known.
These include the anonymous-save policy, final qualified-action enum and thresholds, exact material-use threshold for a documented-way-in filter, and comparison layout.
An implementing PR must resolve only the choice in its accepted scope and update the corresponding requirement and decision evidence.

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
