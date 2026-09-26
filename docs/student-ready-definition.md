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
The exemption covers card ABSENCE, never card quality: a stored card inside the 200-character rendering preference is served verbatim by `resolveServedShortDescription`, so an exclusion clause or administrative chrome sitting in `shortDescription` still holds an exempt row and still records `missing_card_description` (#1425/#1596).
A stored card past that preference is the one band held to the card bar before it is served, so chrome there costs the row its own prose rather than its tier; `docs/decisions.md` owns why (#1878).
`public_description_invariant_failed` is the recorded name of the OTHER half of `descriptionCoherent`, the public-description invariant, and it is pushed whenever that invariant fails rather than only when an override had pushed the row to `student_ready`.
The exemption is what makes it load-bearing: a program-like row whose body fails quality while its card short passes reads `source_backed`, its card blocker is exempt, and before this reason existed at compute time nothing recorded why the row was held (#2818).
- Identity / lead: `missing_lead`, `duplicate_name_risk`, `duplicate_risk`, `exact_url_duplicate_risk`, `pi_identity_conflict`, `profile_identity_risk`. Maps to `rightLeadAttached` and `notDuplicate`.
A duplicate blocker only means something if it names a survivor.
Three relations independently pick a canonical - `selectExactUrlDuplicateRiskEntityIds` over a shared specific URL, the same-lead dedupe plan over a shared PI, and `hasProfileAreaShellDuplicateRisk` over a person's concrete research home - so when they disagree every member of a duplicate-URL group is the loser of one of them and the researcher or lab has zero student-visible card.
`selectDuplicateGroupSurvivorEntityIds` reconciles them over the duplicate CLUSTER, the rows joined transitively by any of those relations, and withdraws the duplicate reasons from exactly one member of a cluster in which every member is called a duplicate (#1890).
The cluster, rather than the single URL group, is the unit for two reasons: a row whose same-PI canonical is already serving must not be released, or a student reads one research home as two cards, and one release per cluster makes the pass independent of the order the corpus came back in.
That scope has a cost worth naming: when the member the cluster does not hold shares no URL with the group that went dark, every member of the dark group keeps its duplicate reason and the group serves no card, so a row can be the canonical of its own group and still be held as the loser of another one.
Nothing in the URL contest prevents that shape, and the index-authority exemption that hid it for one class of row left the count of shared-URL groups with no visible member unchanged when it was removed (#2970), so that population has to be addressed in the release scope rather than by exempting rows from the contest.
A cluster that no shared-URL group joins gets no release at all and is left to the relation that owns it, which is the condition that keeps the release scoped to #1890's duplicate-URL groups instead of widening it to every same-PI cluster in the corpus.
The release goes by preference to a member that could clear `missing_lead`, meaning a resolved lead or the program-like or organizational lead exemption, because spending it on a row nothing can promote leaves the cluster dark.
That is a preference and not a promise: the tier needs `lead_attached` rather than a lead row of any state, and an exempt row still reads `organizationalDeadEnd` without an alternate access path, so a released row can stay held on its own blockers.
Among members that can clear the lead requirement the release goes to the one a research-home index published as the owner of an address the cluster actually shares, ahead of `exactDuplicateCanonicalScore`, for the same reason the URL contest ranks that authority first: the score's dominant term is an already-public bonus, so letting it decide hands the surviving card to whichever row happened to be released first (#2786).
Withdrawal is scoped to the duplicate reasons alone; a released row still has to clear every other blocker on its own.
- Name: `unusable_name`. A `name` that is not an identity. Five arms, all mapping to `hasUsableName`: filler ("n/a", "none", "unknown", "TBD"); an external scholarly platform's link label, whether bare ("Google Scholar", "ORCID"), wearing a research-home head noun ("Google Scholar Lab"), or wearing page furniture ("Google Scholar Profile"), which titles the card with a place the work is indexed rather than a research home; and, on a person-scoped record only, either a named professorship or a bare host name, from which nothing on the row can derive a research-record name, or the name of a shared academic host the record cites, which is a real laboratory's name belonging to the organization that publishes `~user` pages for its members rather than to this one member (#2360), or a name that names something other than this record at all - another person's eponymous lab, or an umbrella organization the person merely belongs to - which is the whole name-identity authority (`personScopedResearchEntityNameNamesSomethingElse`) rather than its shared-host arm alone (#2351/#3499).
That last arm is the only one that needs a person to compare against, so it fires only when a lead resolves the record's own identity.
The authority also accepts the entity key's tokens, and it documents that reading as strictly weaker because a key spells the research rather than the person; on a leadless row it condemns a lab for its own eponym, and such a row is already held by `missing_lead` while the extra reason shuts the lead-attachment lanes, which refuse a row a second hard blocker also holds (#1930).
The shared-host arm needs no lead, because it asks whether the name belongs to an organization at all rather than to which person.
A suffixed brand is not something a page emits: it is manufactured downstream of ingest, which is why the gate has to see a shape no source ever offered (see `skills/scrapers/SKILL.md` for the derivation that produces it, #2285).
Checked on `name` alone, because `displayName` is only ever a branded alias of it: filler stored on the alias is withheld at serve time by `sanitizeServedResearchEntityCopyFields`, so every surface falls back to `name` rather than titling the card with the filler.
Absence is deliberately not a blocker, since `name` is `required` on the schema and no record stores an empty one.
- Wrong-type / shell: `generic_directory_shell`, `profile_biography_shell`, `content_page_risk`, `non_research_entity`, `non_research_program`, `research_infrastructure_only`, `non_owner_grant_shell`, `lab_name_org_type_mismatch`. Removed at `suppressed` (a stronger form of the duplicate / suppressed-shell blocker).
- Unbacked title: `unbacked_lab_name`. Maps to `entityContentMatchesCard`, the other half of `lab_name_org_type_mismatch`: a row typed `LAB` and titled "<X> Lab" or "<X> Laboratory", with no research website, no recorded source for `name`, and no cited URL that names a lab anywhere in its host or path. The title was composed at mint time from a person's profile page rather than read off a source, so what a student reads as a laboratory is one professor's directory entry. Held at `operator_review` rather than suppressed, on the same terms as the org-type mismatch: the person is real and the row becomes legitimate again once the name is reconciled. The durable remedy is #3350's substitution of the lead-derived person-scoped name, extended to the `LAB`-typed arm its shape filter excluded.
Measured on Development, 2026-09-25: 75 live rows, 57 of them `student_ready`, and 1 of the 75 carries a live `name` observation after all, so the row-local reading agrees with the observation log on 74 of 75.
The discriminator is the ABSENCE of a lab-named URL rather than the presence of a person-page one, because a paginated department listing (`/people-economics?page=4`) is the weakest evidence of a lab there is while no shared URL predicate recognises it as a person page.
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

The PI-attachment lanes are `data:materialize-inferred-pi-leads`, `research-entity:attach-fra-named-leads`, `research-entity:attach-directory-named-leads` and `research-entity:attach-lab-site-named-leads`.
The last of those covers the rows whose only evidence of their own lead is published on the research home itself: an eponymous `<Surname> Lab` that cites no person page is reached by none of the first three, and its `/people/` page is where the PI's official profile is linked (#1930).
See `skills/scrapers/SKILL.md` for its five fail-closed conditions.

A lane in this family must subtract by the gate's own lead question, `researchEntityIdsWithGateAttachedLead`, and never by a weaker "does a lead role assignment row exist".
`data:materialize-inferred-pi-leads` asked the weaker one and it differed in three ways at once: it counted archived assignments, assignments whose person record is archived, and leads the gate judges too weak to own a research home.
A row failing any of those read as already linked to the lane and leadless to the gate, so the lane never revisited it and the row could not leave `operator_review` however good the key resolver became (#2931).
Measured on Development before the fix, 52 of the 119 rows held by `missing_lead` alone were unreachable that way, and 48 of the 52 because every lead edge they hold is archived rather than because of the weak-lead threshold the issue was filed about.
The lane's own completion check has to ask the same question for the same reason: asking the weaker one would report a resolved lead for every row that still holds only the archived or weak edge the candidate filter now looks past, so the yield figure would restate the input instead of measuring the output.
Yield is small and worth quoting honestly: widening the filter took the candidate set from 279 to 438 rows and one apply run resolved 3 of them, 2 of which the gate then released to students.
The durable gain is reach rather than that run's count, because the lane now covers 126 of the 131 sole-`missing_lead` rows instead of leaving a permanent hole under them.

### Which row is canonical when several cite one URL

`exact_url_duplicate_risk` does not judge a row on its own: it groups rows by normalized citation and flags everyone except the group's canonical, so the canonical choice decides which of the colliding rows a student can reach.
`exactDuplicateCanonicalScore` in `server/src/services/studentVisibilityGateService.ts` ranks candidates, and its dominant term is an 80-point bonus for already being public.
That term resolves a collision by publication order, which inverts ownership: measured on Development, a lab whose address Yale's own index publishes was suppressed while a row that borrowed the same address from a person's profile page served in its place (#2786).

`RESEARCH_HOME_URL_INDEX_AUTHORITY_SOURCE_NAMES` names the sources that have authority over a research home's address, and a row whose `websiteUrl` provenance is one of them outranks the score entirely.
Only an index of research homes qualifies: YSM's A-to-Z lab websites index is a table of lab name to lab website, so it asserts which row owns a URL.
A faculty directory or a department roster reads a person's page instead, where the YSM CMS uses one link slot for "my lab" and "a lab I work in" alike (#2234), so those sources cannot tell an owner from a member and must never be added to the set.
Every name in the set must be a source the coverage registry knows, because a name no scraper materializes matches no provenance and the authority it looks like it grants covers nothing.
The assertion is about a research home's own address, so a row that is not a concrete research home gets no authority however its `websiteUrl` was provenanced.

Before the canonical is chosen at all, a member that merely READ the URL is dropped from the group (#1896).
A `sourceUrls` citation is usually good same-entity evidence and stays so: a row with no research home of its own that cites a site is a strong candidate to be that site, and several pinned cases depend on that reading.
The narrow exception is a row that already publishes a DIFFERENT research home and neither publishes this URL nor serves any field provenanced to it.
The home it publishes has to be a specific address by the same `isSpecificDuplicateSignalUrl` test the groups themselves use, because an index or roster page in `websiteUrl` is navigation furniture rather than a home of the row's own, and reading one as a home dropped a real duplicate from its group and let both rows serve.
Such a row read the page, which is what harvesting anything from it requires, and calling it a duplicate of the row that publishes the address suppresses the owner over a citation nothing else supports.
The citation also outlives every observation behind it, because the materializer carries `entityDoc.sourceUrls` forward unconditionally, so the collision never expires on its own.
The drop is applied after the group-size filter, so a group that shrinks past the limit is not thereby exposed to the signal for the first time; the oversized-group blind spot is a separate question.

Two further refusals keep the rule from dissolving a real collision, and both were found by acting on the rule and re-reading the result rather than by reasoning about it.
A row whose address an index of research homes published is never a mere reader, because it is a claimant in any collision touching its own site however the other row spells it: Yale's lab index carries a lab under one spelling while the row cites the other (`/lab/jun-liu/` against `/lab/jun_liu/`), which the URL normalizer does not fold, so reading the index-published owner as a reader of the variant dropped it and promoted the row that had borrowed its address.
Mutual citation is a contest rather than a reading: when the row publishing the URL also cites the reader's own home, each is claiming the other's address and exactly one can be right, so dropping either would dissolve both halves and serve a student two cards for one lab.

Measured on Development through the real exported selector over the real corpus: 416 rows held as shipped, 414 with the rule, 2 released and 0 newly held, and the gate converges in one pass.
Both released rows are the row that PUBLISHES the contested address, and that is the check that matters: a count of held rows cannot tell releasing the owner from releasing the borrower, and an earlier form of this rule released the borrower of another lab's address and briefly served it.
Neither released row reaches students, because both keep a blocker of their own; they leave hard suppression for `operator_review`, where what remains is repairable.
Read the count with the feedback in mind: `exactDuplicateCanonicalScore` awards 80 points for already being public, so promoting a row changes who wins canonical and therefore changes the held set on the next pass.
That measurement is recorded here and nowhere else, because a count restated beside the code drifts from the count in the doc and a reader cannot then tell which run produced it.
The specificity condition above can only keep more members in their groups, so it releases no row the measured set did not already contain.

The authority decides WHICH member of a group is the canonical and never exempts a row from being called a duplicate elsewhere.
A row holds authority over one address while colliding with different rows on other URLs, so an exemption keyed on the row rather than the group made it immune everywhere: two `LAB` pairs on one normalized URL each ended with no duplicate reason on either member and a student read one research home as two cards (#2970).
The case that exemption was written for, a pair colliding on two URLs at once where each row is the loser of one group, is resolved by `selectDuplicateGroupSurvivorEntityIds` instead: both rows sit in one cluster, every member is called a duplicate, so the cluster releases one, and `duplicateClusterByReleasePreference` spends that release on the index-published member once it can attach a lead.
One mechanism reconciles duplicate holds; a second one that does not check whether the group already has a survivor reintroduces the double-card failure the first one exists to prevent.

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

`yarn --cwd server research-entity:record-departure --slug <slug> --note "<evidence>"` is the command that records one, dry-run by default and `--apply` to write.
It exists because the procedure has more steps than the marker: the write, a re-gate so the tier actually moves, and a re-read of the served surface, and doing it by hand is what lost `holmes-ah724`.
The note is required and is the evidence, because a marker without one records that somebody decided rather than why, and a later reader cannot tell a relocation from a mistake.
It must not contain a comma: `studentVisibilitySuppressionReason` is a comma-joined list that other writers append to, so a comma inside a note splits it into entries that are not reasons.
The note rides on the marker, so the stored entry reads `permanently_closed: <evidence>` rather than the bare token: read the marker through `hasRecordedClosureEvidence`, which matches the token and the note-carrying form alike, never by comparing an entry to `permanently_closed` for equality.
The tier's own blocker reason stays the bare `permanently_closed` whichever form is stored, so the note never reaches the gate's reason vocabulary.
It takes exactly one slug, because a reported departure is a judgement about one row and the note is that row's evidence.
A row that already carries a closure marker is skipped rather than given a second one, and an operator lock on the reason field or on `activeAtYaleCache`/`yaleStatusCache` stops the write the way it stops every other lane.
Skipping the write does not skip the re-gate: an `--apply` run re-gates the row whenever it exists, so a marker left behind by an interrupted run or written by hand is finished by pointing the command at that slug again.
The command reports `stillServed`, which is the only line that answers the question: it re-reads `getResearchGroupDetail`, the same call the public detail route makes, so a `false` is the student's 404 rather than a write counter.
Applied on Development on 2026-09-25 for one relocated `FACULTY_RESEARCH_AREA` lead in Mechanical Engineering & Materials Science, reported by the repository owner: `student_ready` to `suppressed`, the detail route 404s, and the row is gone from the search route.
Every Yale-hosted page for that row still asserted the Yale appointment, including the PI's own `yale.edu` lab site, which is why the operator report was the only available evidence.

The reset has one owner, and it is not the materializer.
`hasEvidencelessInactiveYaleStatus` is evaluated inside `materializeEntity`, which is reached per observation key, so a row the corpus holds no observations for is never offered to it and its unevidenced cache is permanent (#2684).
Moving that branch outside the materialization early-return would not fix it, because nothing enumerates such a row at all; the owner has to be an entity-enumerating pass, which is `yarn --cwd server research:backfill-yale-status-cache`.
That command could not run at all until #2684: it sorted whole documents on an unindexed `name`, which exceeded Mongo's 32MB in-memory sort limit on a 4,756-row corpus, and its `--limit` bounded the scan rather than the writes, so a bounded apply planned only from the first rows by name and could never reach a row further down.
The plan is now always whole-corpus and `--limit` caps the writes, with `plannedWrites`, `writtenThisRun` and `deferredByWriteLimit` in the report.
Applied on Development on 2026-09-22: 1 evidenceless row healed and 5 caches brought in line with their own derivation, 0 rows flipped to suppressed.
Healing is not publication: the healed row lost `inactive_at_yale` and moved from `suppressed` to `operator_review`, and stays out of the directory on four description and lead blockers, so read the population as "no row is suppressed on a claim nothing supports" rather than as served coverage.

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
