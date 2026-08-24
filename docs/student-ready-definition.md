# Student-Ready Definition

This is the human-readable source of truth for what `student_ready` means.
The executable source of truth is `researchEntityMeetsStudentReadyDefinition` in `server/src/services/studentVisibilityTier.ts`.
The two must stay in sync: change the definition in one place, then mirror it here.

## Definition

A research entity is `student_ready` if, and only if, what we show is CORRECT and COHERENT:

- (a) It has a real, coherent, non-boilerplate description that actually describes THIS entity.
- (b) The right person or lead is attached.
- (c) It is not a duplicate or a suppressed shell.

If all three hold, the entity is `student_ready`, full stop.
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
Each maps to one field of `ResearchEntityStudentReadyCorrectness`.

- Incoherent, boilerplate, off-entity, or serve-time-blank description (a card that renders no real prose, or prose about something else). `descriptionCoherent`.
- Content about a different entity than the card claims (for example a "<Person> Lab" name typed as an org whose body describes a center). `entityContentMatchesCard`.
- Wrong person or lead attached: identity mis-attribution, an identity conflict, or a lead-requiring entity with no resolved lead. `rightLeadAttached`.
- No reachable target: no usable link-out, or an organizational home that is a lead-less dead end with no way in. `reachable`.
- Duplicate of an already-known entity. `notDuplicate`.

Suppressed shells (generic directory-only profile-area shells, biography-only shells, non-owner grant shells, off-scope or inactive records) are removed one tier earlier, at `suppressed`, and are a stronger form of the "duplicate / suppressed shell" hard blocker.

A lead-requiring entity with no lead, an identity risk, or no link-out target is never published even under an explicit operator override: an override may pass softer gates, but not these correctness floors.

## Soft signals (these NEVER gate `student_ready`)

These enrich ranking, badges, and the card's optional sub-payloads, and may hide their own sub-payload when absent, but they never hold a correct, coherent card out of `student_ready`.
They are the set `STUDENT_READY_SOFT_SIGNAL_REASONS`.

- `source_backed_description` - anti-fabrication signal; a coherent description is enough on its own, source-backing only strengthens ranking.
- `concrete_next_step` - reaching out is already the next step.
- `missing_action_evidence` - reaching out is already the action.
- `missing_facet_signal` - facets are query-scoped nice-to-haves, not a student-facing blocker.

## Tiers

- `student_ready` - the only publicly served tier; meets the definition above.
- `limited_but_safe` - a non-public fallback (for example a routed program with a source and apply link but no card prose).
- `operator_review` - held for a human because a hard blocker is unresolved.
- `suppressed` - removed (off-scope, inactive, duplicate/shell).

## History

Realigned in issue #1802: `source_backed_description`, `concrete_next_step` / `missing_action_evidence`, and `missing_facet_signal` were demoted from hard blockers to soft signals, and the definition was codified as a single named function.
This supersedes the earlier `missing_facet_signal` gating from issue #1717.
