# Student-Ready Definition

This is the human-readable source of truth for what `student_ready` means.
The executable source of truth is `researchEntityMeetsStudentReadyDefinition` plus the `STUDENT_READY_HARD_BLOCKER_REASONS` and `STUDENT_READY_SOFT_SIGNAL_REASONS` constants in `server/src/services/studentVisibilityTier.ts`.
The two must stay in sync: change the definition in one place, then mirror it here.

## Definition

A research entity is `student_ready` if, and only if, what we show is CORRECT and COHERENT:

- (a) It has a real, coherent, non-boilerplate description that actually describes THIS entity.
- (b) The right, currently-active person or lead is attached.
- (c) It is not a duplicate or a suppressed shell, and it is in scope and active.

If all of these hold, the entity is `student_ready`, full stop.
Missing enrichment does not change that.

## Why enrichment never gates

The site never blocks or discourages outreach (see `product-context.md`).
Reaching out to the professor is the universal next step: open the official profile, open an official source page, search the Yale Directory as a last resort, or email when a non-redacted address exists.
Because reach-out is always available, an under-enriched card is less specific, not wrong.
The litmus test is: "would showing this MISLEAD or confuse a student?"
If yes, it is a hard blocker.
If it is merely LESS ENRICHED, it stays `student_ready`.

## Hard blockers (these gate `student_ready`)

These are genuine correctness or quality failures - the entity as shown would be wrong or nonsensical to a student.
They are the set `STUDENT_READY_HARD_BLOCKER_REASONS`, and each maps to one field of `ResearchEntityStudentReadyCorrectness` (or is applied one tier earlier at `suppressed`).

- Description: `missing_description`, `missing_card_description`, `thin_description`, `blank_public_description`. A card that renders no real prose, or prose about something else. Maps to `descriptionCoherent` (and `entityContentMatchesCard` for off-entity content, e.g. a "<Person> Lab" name typed as an org whose body describes a center).
- Identity / lead: `missing_lead`, `duplicate_name_risk`, `duplicate_risk`, `exact_url_duplicate_risk`, `pi_identity_conflict`, `profile_identity_risk`. Maps to `rightLeadAttached` and `notDuplicate`.
- Name: `unusable_name`. A `name` that is filler rather than an identity ("n/a", "none", "unknown", "TBD"). Maps to `hasUsableName`.
Checked on `name` alone, because `displayName` is only ever a branded alias of it: filler stored on the alias is withheld at serve time by `sanitizeServedResearchEntityCopyFields`, so every surface falls back to `name` rather than titling the card with the filler.
Absence is deliberately not a blocker, since `name` is `required` on the schema and no record stores an empty one.
- Wrong-type / shell: `generic_directory_shell`, `profile_biography_shell`, `content_page_risk`, `non_research_entity`, `non_research_program`, `research_infrastructure_only`, `non_owner_grant_shell`, `lab_name_org_type_mismatch`. Removed at `suppressed` (a stronger form of the duplicate / suppressed-shell blocker).
- Inactive / out of scope: `inactive_at_yale`, `archive_review`, `not_undergraduate_relevant`.

A lead-requiring entity with no lead, an unusable name, an identity risk, or an off-entity/off-scope failure is never published even under an explicit operator override: an override may pass softer gates, but not these correctness floors.
The same floors also hold the record out of `limited_but_safe`, which the launch-trust report treats as publishable in `public-safe` mode.

## Soft signals (these NEVER gate `student_ready`)

These enrich ranking, badges, and the card's optional sub-payloads, and may hide their own sub-payload when absent, but they never hold a correct, coherent card out of `student_ready`.
They are the set `STUDENT_READY_SOFT_SIGNAL_REASONS`, and they are never repair blockers either - including the `missing_*` ones that a blanket `missing_` prefix rule would otherwise sweep in.

- `source_backed_description` - anti-fabrication signal; a coherent description is enough on its own, source-backing only strengthens ranking.
- `concrete_next_step` / `missing_action_evidence` - reaching out is already the next step and the action.
- `missing_facet_signal` - facets are query-scoped nice-to-haves, not a student-facing blocker.
- `missing_alternate_access_path` - an organizational home is reachable through its own official page even without a separate engagement path.
- `missing_application_route` / `missing_source_route` - a program is still reachable and describable without a distinct apply/source route.
- `missing_source_url` / `missing_official_source` - **critical:** every discovered entity carries its source in observation provenance (`fieldProvenance[*].sourceUrl` and/or the entity's observations' `sourceUrl`). The gate only inspected `entity.sourceUrls` / `website` / `websiteUrl`, so a bare `sourceUrls` is a PROJECTION GAP, never a genuinely source-less entity. The materializer projects that provenance onto `entity.sourceUrls` at write time (`bestMaterializationProvenanceSourceUrl`), and the gate never blocks on it either way.

## Root cause: source-url projection

`missing_source_url` used to hard-block coherent, source-backed entities whose `sourceUrls` happened to be empty even though every observation that produced them recorded a `sourceUrl`.
The fix is at the source: when a materialized entity would otherwise expose no reachable http source, the materializer projects its best-confidence provenance `sourceUrl` onto `entity.sourceUrls` (scoped to the empty case so already-sourced entities do not accrue extra shared urls).
Source-backing is then recognized and `missing_source_url` clears legitimately for discovered entities.

## Tiers

- `student_ready` - the only publicly served tier; meets the definition above.
- `limited_but_safe` - a non-public fallback (for example a routed program with a source and apply link but no card prose).
- `operator_review` - held for a human because a hard blocker is unresolved.
- `suppressed` - removed (off-scope, inactive, duplicate/shell).

## History

Realigned in issue #1802.
First, `source_backed_description`, `concrete_next_step` / `missing_action_evidence`, and `missing_facet_signal` were demoted from hard blockers to soft signals (superseding the `missing_facet_signal` gating from issue #1717).
The finalized realignment then moved the remaining enrichment/reachability signals - `missing_alternate_access_path`, `missing_application_route`, `missing_source_route`, `missing_source_url`, `missing_official_source` - out of blocking as well, codified the hard-vs-soft split as two named constants, and fixed the materializer to project discovery provenance onto `entity.sourceUrls` so `missing_source_url` stops firing as a projection gap.
