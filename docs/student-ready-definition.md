# Student-Ready Definition

This is the human-readable source of truth for what `student_ready` means.
The executable source of truth is `researchEntityMeetsStudentReadyDefinition` plus the `STUDENT_READY_HARD_BLOCKER_REASONS` and `STUDENT_READY_SOFT_SIGNAL_REASONS` constants in `server/src/services/studentVisibilityTier.ts`.
The two must stay in sync: change the definition in one place, then mirror it here.

## Definition

A research entity is `student_ready` if, and only if, what we show is CORRECT and COHERENT:

- (a) It has a real, coherent, non-boilerplate description that actually describes THIS entity.
- (b) The right, currently-active person or lead is attached.
- (c) It is not a duplicate or a suppressed shell, and it is in scope and active.
- (d) Its `name` identifies something rather than being placeholder filler.

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

- Description: `missing_description`, `missing_card_description`, `thin_description`, `blank_public_description`, `public_description_invariant_failed`. A card that renders no real prose, or prose about something else. Maps to `descriptionCoherent` (and `entityContentMatchesCard` for off-entity content, e.g. a "<Person> Lab" name typed as an org whose body describes a center).
`missing_card_description` is exempt for an organizational or program-like home, which is described by what it is and does rather than by a lab-style research focus (#1872).
That exemption has to reach the TIER as well as the recorded reason: `quality.cardState` applies it only to program-like rows, so reading it raw as a tier input held 7 organizational rows at `operator_review` with no blocker recorded anywhere (#2818).
`studentVisibilityTier`'s `hasRequiredResearchFocusCard`, its `missing_card_description` push, and `researchEntityPublicDescription`'s `cardIsOptional` must answer this question the same way.
The exemption covers card ABSENCE, never card quality: a stored card is served verbatim by `resolveServedShortDescription`, so an exclusion clause or administrative chrome sitting in `shortDescription` still holds an exempt row and still records `missing_card_description` (#1425/#1596).
`public_description_invariant_failed` is the recorded name of the OTHER half of `descriptionCoherent`, the public-description invariant, and it is pushed whenever that invariant fails rather than only when an override had pushed the row to `student_ready`.
The exemption is what makes it load-bearing: a program-like row whose body fails quality while its card short passes reads `source_backed`, its card blocker is exempt, and before this reason existed at compute time nothing recorded why the row was held (#2818).
- Identity / lead: `missing_lead`, `duplicate_name_risk`, `duplicate_risk`, `exact_url_duplicate_risk`, `pi_identity_conflict`, `profile_identity_risk`. Maps to `rightLeadAttached` and `notDuplicate`.
- Name: `unusable_name`. A `name` that is not an identity. Three arms, all mapping to `hasUsableName`: filler ("n/a", "none", "unknown", "TBD"); an external scholarly platform's link label, whether bare ("Google Scholar", "ORCID"), wearing a research-home head noun ("Google Scholar Lab"), or wearing page furniture ("Google Scholar Profile"), which titles the card with a place the work is indexed rather than a research home; and, on a person-scoped record only, a named professorship or a bare host name, from which nothing on the row can derive a research-record name.
A suffixed brand is not something a page emits: it is manufactured downstream of ingest, which is why the gate has to see a shape no source ever offered (see `skills/scrapers/SKILL.md` for the derivation that produces it, #2285).
Checked on `name` alone, because `displayName` is only ever a branded alias of it: filler stored on the alias is withheld at serve time by `sanitizeServedResearchEntityCopyFields`, so every surface falls back to `name` rather than titling the card with the filler.
Absence is deliberately not a blocker, since `name` is `required` on the schema and no record stores an empty one.
- Wrong-type / shell: `generic_directory_shell`, `profile_biography_shell`, `content_page_risk`, `non_research_entity`, `non_research_program`, `research_infrastructure_only`, `non_owner_grant_shell`, `lab_name_org_type_mismatch`. Removed at `suppressed` (a stronger form of the duplicate / suppressed-shell blocker).
- Inactive / out of scope: `inactive_at_yale`, `archive_review`, `not_undergraduate_relevant`.
- Citations: `all_citations_dead`, `citations_identify_no_person`. Maps to `citationIdentifiesSubject`: a row whose every citation is dead, or whose every citation is shared across person rows, has no live evidence about its own subject (#2464/#2635).
Both block, because both are the same question; leaving the second unclassified made it read as non-blocking while the field it maps to still held the row.

### Who counts as an attached lead

`rightLeadAttached` asks whether the named person can own the research home a student would be joining, not merely whether a person is named.
`hasStrongLead` in `server/src/services/researchEntityQuality.ts` is the authority, and it refuses two title classes through one shared predicate, `cannotOwnResearchHome` in `server/src/utils/researchHomeOwnership.ts`.
The retirement lane that acts on the gate's verdict (`role-assignments:retire-non-owner-pi-edges`) reads the same predicate, so a future refusal class added there reaches both.

A trainee cannot host (#2876): a postdoc, research assistant, student, candidate, intern or pre-doctoral fellow runs real research but has no standing to admit an undergraduate, who approaches the PI instead.
A non-research staff appointment owns no research home (#1897): a programme manager, a financial or data analyst, a biostatistician, a coordinator, a lab manager, a technician, a specialist or a courtesy research affiliate may be indispensable to a research home without being able to offer one.

Both classes exempt a supervisory title (`professor`, `lecturer`, `director`, `dean`, `chair`), because such a person can supervise whatever else their title says.
The non-research-staff class additionally exempts the whole Yale research-appointment ladder: research scientist, research scholar, and research associate, in the singular or the plural.
That ladder runs from Research Associate and Associate Research Scientist to Senior Research Scientist, and independence is not readable from the string: some run an independent programme and take undergraduates, and a title regex cannot tell which.
Measured on Development, the ladder accounts for 114 of the 122 served staff-led rows, and nothing else stored on those rows separates them from the professor-led population - lead-edge provenance, roster size and URL shape all match the control - so no gate is available for them today.
Refusing them would be a title denylist over an ambiguous class, which #1897 records as the wrong trade.

Either refusal yields `lead_weak` and the existing `missing_lead` reason rather than a new one, so the row routes to the PI-attachment lane and returns to the served surface as soon as a lead who can host is found.
The client mirrors both predicates in `client/src/utils/leadRoleDisplay.ts` so a member list never labels such a person a Principal Investigator; parity is pinned by behaviour in a test, per #2433.

### Which row is canonical when several cite one URL

`exact_url_duplicate_risk` does not judge a row on its own: it groups rows by normalized citation and flags everyone except the group's canonical, so the canonical choice decides which of the colliding rows a student can reach.
`exactDuplicateCanonicalScore` in `server/src/services/studentVisibilityGateService.ts` ranks candidates, and its dominant term is an 80-point bonus for already being public.
That term resolves a collision by publication order, which inverts ownership: measured on Development, a lab whose address Yale's own index publishes was suppressed while a row that borrowed the same address from a person's profile page served in its place (#2786).

`RESEARCH_HOME_URL_INDEX_AUTHORITY_SOURCE_NAMES` names the sources that have authority over a research home's address, and a row whose `websiteUrl` provenance is one of them outranks the score entirely.
Only an index of research homes qualifies: YSM's A-to-Z lab websites index is a table of lab name to lab website, so it asserts which row owns a URL.
A faculty directory or a department roster reads a person's page instead, where the YSM CMS uses one link slot for "my lab" and "a lab I work in" alike (#2234), so those sources cannot tell an owner from a member and must never be added to the set.
Every name in the set must be a source the coverage registry knows, because a name no scraper materializes matches no provenance and the authority it looks like it grants covers nothing.
The assertion is about a research home's own address, so a row that is not a concrete research home gets no authority however its `websiteUrl` was provenanced.

The authority also exempts such a row from being called a duplicate at all, the same rule `samePiDuplicateEntityIdsRestrictedToPiLed` applies to a non-PI-led home.
One pair of rows collides on several URLs at once, a lab address and its PI's profile page, so an authority scoped to a single group let the index-published row win where its own address was contested and lose on the profile page.
Both rows were then flagged and the lab left student view altogether, which is worse than the inversion it replaced.
The exemption stops where the authority is contested: when two index-published rows carry one address between them, the one that loses that group stays flagged, because exempting both would leave a student two cards for one lab, which is the collision the criterion exists to resolve.

### Recording a departure Yale's own pages do not show

A faculty member who relocated to another institution is the one departure class no Yale-derived signal can catch.
Yale's roster and profile pages go stale rather than disappearing, so link health stays HEALTHY/200, the roster keeps listing the person, and every detector built from Yale sources reports the row as fine.
`deriveResearchEntityYaleStatus` therefore has no relocation branch, and the authoritative evidence (an ORCID employment end date) is not ingested.

The supported way to record one is the `permanently_closed` marker in `studentVisibilitySuppressionReason` (#2284), which suppresses and outranks even an operator override to publish.
As of #1923 that marker is also a `departed` Yale-status signal: `deriveResearchEntityYaleStatus` re-derives it on every pass, so `activeAtYaleCache: false` survives re-materialization instead of being reset, and the two mechanisms can no longer disagree about whether the person is present.

Do not record a departure by setting `activeAtYaleCache: false` alone.
`hasEvidencelessInactiveYaleStatus` resets an inactive cache that no live evidence re-derives, and `yaleStatusReasonCache: 'departed'` - the flag that would exempt it - is written only by `facultyRosterDepartureReconciler`, which has written 0 rows corpus-wide.
That is how the one relocation repair ever attempted was lost: `holmes-ah724` came back to `activeAtYaleCache: true` and is now held out of the directory only by the unrelated grant-only rule from #2281, one added `yale.edu` url away from returning to `operator_review`.
An operator lock on `activeAtYaleCache`/`yaleStatusCache` also holds (4 rows use it), but it records no reason, so prefer the marker.

The marker stays fail-open by design.
Absence of closure evidence is not evidence of closure - roughly 4,500 live rows carry no evidence either way - so only a positively recorded marker suppresses.

A lead-requiring entity with no lead, an unusable name, an identity risk, or an off-entity/off-scope failure is never published even under an explicit operator override: an override may pass softer gates, but not these correctness floors.
The same floors also hold the record out of `limited_but_safe`, which the launch-trust report treats as publishable in `public-safe` mode.

## Soft signals (these NEVER gate `student_ready`)

These enrich ranking, badges, and the card's optional sub-payloads, and may hide their own sub-payload when absent, but they never hold a correct, coherent card out of `student_ready`.
They are the set `STUDENT_READY_SOFT_SIGNAL_REASONS`, and they are never repair blockers either - including the `missing_*` ones that a blanket `missing_` prefix rule would otherwise sweep in.

- `source_backed_description` - anti-fabrication signal; a coherent description is enough on its own, source-backing only strengthens ranking.
- `concrete_next_step` / `missing_action_evidence` - reaching out is already the next step and the action.
- `missing_facet_signal` - facets are query-scoped nice-to-haves, not a student-facing blocker.
- `missing_alternate_access_path` - an organizational home is reachable through its own official page even without a separate engagement path.
  It stays soft on purpose: per #1802 the card is never withheld for unknown access evidence.
  It used to gate whether the materializer minted the organizational `REACH_OUT_PLAUSIBLE` signal (#1359, #2559).
  That producer was retired entirely in #2578, so the reason is now purely a repair-queue and reporting signal.
- `missing_application_route` / `missing_source_route` - a program is still reachable and describable without a distinct apply/source route.
- `missing_source_url` / `missing_official_source` - **critical:** every discovered entity carries its source in observation provenance (`fieldProvenance[*].sourceUrl` and/or the entity's observations' `sourceUrl`). The gate only inspected `entity.sourceUrls` / `website` / `websiteUrl`, so a bare `sourceUrls` is a PROJECTION GAP, never a genuinely source-less entity. The materializer projects that provenance onto `entity.sourceUrls` at write time (`bestMaterializationProvenanceSourceUrl`), and the gate never blocks on it either way.

## Root cause: source-url projection

`missing_source_url` used to hard-block coherent, source-backed entities whose `sourceUrls` happened to be empty even though every observation that produced them recorded a `sourceUrl`.
The fix is at the source: when a materialized entity would otherwise expose no reachable http source, the materializer projects its best-confidence provenance `sourceUrl` onto `entity.sourceUrls` (scoped to the empty case so already-sourced entities do not accrue extra shared urls).
Source-backing is then recognized and `missing_source_url` clears legitimately for discovered entities.

## Tiers

- `student_ready` - the only publicly served tier; meets the definition above.
- `limited_but_safe` - a non-public fallback (for example a routed program with a source and apply link but no card prose).
- `operator_review` - held for a human because a hard blocker is unresolved, or because an operator override pins the row there.
Those are the only two reasons, and it is an invariant rather than a convention: `isUnexplainedHeldVisibilityPlan` is false for every RESEARCH plan, `runStudentVisibilityGateForPlans` reports `counts.unexplainedHeld`, and `studentVisibilityHeldRowsAreExplained.integration.test.ts` pins it against the real planner.
The invariant is scoped to the research collection because the program tier does not hold to it yet: `computeProgramStudentVisibility` gates on an audience (`undergraduateOnly`/`yaleCollegeOnly`, both optional with no default) that no reason records, and on `missing_official_source`/`missing_application_route`, which this taxonomy classifies as SOFT.
Counting a program row there would refuse every gate apply, research rows included, over a hole the function cannot describe; giving program holds recorded reasons is separate work.
A held row recording neither is a hole in the taxonomy, not a decision: it is invisible to the blocker histogram work is ranked from, and it reaches the release queue with an empty `blockerReasons` that no repair lane can act on.
The count is enforced rather than merely reported, on the same terms as the roster lead-resolution guard: `studentVisibilityGateUnexplainedHeldBlocker` warns on every run and refuses to `--apply`, because an unenforced invariant would let a future hole be written into the release queue unnoticed.
- `suppressed` - removed (off-scope, inactive, duplicate/shell).

## History

Realigned in issue #1802.
First, `source_backed_description`, `concrete_next_step` / `missing_action_evidence`, and `missing_facet_signal` were demoted from hard blockers to soft signals (superseding the `missing_facet_signal` gating from issue #1717).
The finalized realignment then moved the remaining enrichment/reachability signals - `missing_alternate_access_path`, `missing_application_route`, `missing_source_route`, `missing_source_url`, `missing_official_source` - out of blocking as well, codified the hard-vs-soft split as two named constants, and fixed the materializer to project discovery provenance onto `entity.sourceUrls` so `missing_source_url` stops firing as a projection gap.

Issue #2818 closed the gap that realignment left open.
With every enrichment signal soft, a row whose only reasons were soft could sit at `operator_review` saying nothing about why, and 7 organizational rows did.
The held-row invariant above now pins that the tier and the reasons array agree.
