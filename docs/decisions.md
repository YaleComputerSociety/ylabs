# Decisions

This file records durable product and architecture decisions only.
Do not append continuation logs, security hardening transcripts, or task progress here.
Track tactical work in GitHub issues and keep transient artifacts outside `docs/`.
`docs/tasks/priority-roadmap.md` holds standing launch priorities, not the outstanding-work list.

## 2026-09-22: `Fellowship` Owns The Program Card Bar (#2215)

`isProgramLikeResearchEntity` keys on `kind === 'program'` and matched 0 of 4,743 live Development entities.
No surviving `entityType` derives `program` after `COURSE_SEQUENCE` was retired (#2202), and the scraper records that do observe `kind: 'program'` are routed into the Fellowship lane rather than minting an entity, so only an operator lock on `kind` can produce a program-like `ResearchEntity`.
That zero is real rather than an instrument error: neutering the predicate to `kind === 'lab'` returns 1,362 on the same query.

Three options were open: delete the predicate and collapse the program branches, keep it as the operator-lock guard, or repoint it at `Fellowship`, where application-flow copy actually lives.
Deleting it was refused because a zero count is also the shape of a guard that cannot fire, and the branch it selects is a real card bar rather than dead code.
Decision: keep the `kind === 'program'` arm as the documented operator-lock entry point, and give the bar a live caller by having `Fellowship` apply it to its own browse-card line through `programLikeCardShortDescription`.

The bar had been scoring nothing a student reads, and it found 66 of 154 served fellowship card lines failing, dominated by a stored `summary` that is the entire body and so reaches the browse card clamped mid-sentence.
The lab bar is not a substitute: it fails 87 of the same 154, and 57 of those are `same-as-full`, which is legitimate program voice rather than a defect.
A fellowship conflates two roles in one field, card line on browse and body on detail when no separate `description` exists, so the card line is served as its own `cardSummary` and `summary` stays as stored.
A failing line is replaced by the first sentence of the program's own body that clears the bar and kept whole when none does, per the #1878 finding that dropping a card line lost more than keeping it.
After the change 16 of 154 still fail, and that residual is the honest one: 12 have no body at all, so the bar's grounding flag is asking a question that does not apply to a source-asserted summary, and 4 have no sentence that fits the card.
## 2026-09-22: The Description-Blocked Cohort Has No Code-Shaped Slice Left Above Six Rows (#1878)

The card-length entry below resolved the largest slice of this cohort and named four leads for whoever picked it up next.
All four were measured, and three of them have a deterministic ceiling of zero.
Every count is Development, the only environment that scrapes, read through `planStudentVisibilityGate` and `buildResearchEntityPublicDescriptionRepresentation` rather than any stored column.
The cohort is the rows the gate holds carrying `missing_card_description`, `thin_description` or `missing_description`, which read 787 on 2026-09-22.
"Releasable" means carrying no hard blocker outside the description family, and that column is far below the row column because `citations_identify_no_person` at 287, `missing_lead` at 264, `duplicate_risk` at 115 and `exact_url_duplicate_risk` at 104 co-occur across the cohort.

**The body that fails the quality bar is a chip echo we minted, so no re-ranking recovers it.**
172 rows store a body the bar refuses, 127 of them releasable, and the single dominant flag is `area-echo-fallback` on 76 of those releasable rows.
Read directly, those bodies are the row's own `researchAreas` chips restated as a sentence, and their `fieldProvenance.fullDescription` names the LLM lanes that wrote them: `lab-microsite-undergrad-llm` on 35, `lab-microsite-description-llm` on 24, `dept-faculty-roster` on 12.
Zero of the 76 carry a non-served `fullDescription` observation that passes the bar, so there is no better value in the ledger for a confidence change or a rematerialize to find.
The lead asked whether a body could be synthesized from the same source; the answer is that the same source is the chip list, so it cannot.
This also makes the existing rewrite lane's grounding check vacuous on these rows: `runResearchDescriptionBackfill` takes its source text from the stored body, so it would ask an LLM to ground a research description in our own synthetic echo.

**Deterministic extraction from the page a description-empty row already cites yields a curriculum vitae, not research prose.**
The 2026-08-29 entry below established this for `FACULTY_RESEARCH_AREA` on a probe of 27 pages, and it reproduces at cohort scale across kinds.
Of the 108 releasable rows storing no prose at all, 12 cite no URL and 7 fail to fetch; fetching the rest serially with a browser user agent and running the repository's own `extractOfficialResearchDescription` over them produces a body that passes the real serve invariant on 31.
20 of those 31 are flagged by the repository's own hygiene detectors as a career biography, a high-confidence person bio, or person-centric prose, and hand-reading the remaining 11 finds a bibliography entry, a leadership-programme marketing blurb, a pull quote, and a truncated question stem.
So the genuine deterministic yield is about 7 of 108, and a lane built on it would put a CV on the other two dozen cards, which is the refusal the 2026-09-22 entry above records for the profile JSON-LD `description`.
The pages do carry the prose: 26 of the 31 extractions came from `medicine.yale.edu`, the host this issue named in 2026-08.
What cannot be done is copy it, which is why synthesis rather than extraction is the sanctioned mechanism and why this cohort is an intake-and-synthesis cost rather than a ranking defect.

**The card deriver's own ceiling is six rows, and it is now taken.**
The standing-answer entry above measured deterministic card derivation at 12 of 100 and recorded the measurement rule that a deriver returning text overstated the gate's verdict fourfold.
Re-measured after the card-length fix landed, the ceiling is single digits: substituting a derived line wherever the served card fails the gate's own card bar and the derived line clears it changes the card the gate judges on 4 rows, and none of them was already `student_ready`.
Those are taken here, by `gateAcceptedDerivedCardSubstitute`.
A stored card line inside the 200-character rendering preference is served without a quality check on purpose, because checking it broadly drops fluent lines to nothing, and the entry below records that as the reason 200 stays a rendering preference.
That reason does not reach a substitution, which never returns empty for a non-empty line and never replaces a line the gate would have accepted, so the entry below should be read as unchanged in its refusal and narrowed in its "a line inside the preference is untouched" claim.
Both serving paths call it, for the same reason both already call `storedShortPastRenderingPreferenceIsServable`: the DTO card field resolves its own line, so substituting in only one place would clear a row on copy the other never serves.
Measured before and after through the real planner, back to back over the candidate rows with the two changed files swapped to their `beta` versions for the before run: 4 cards changed, `missing_card_description` fell from 4 to 0, 2 rows moved `operator_review` to `student_ready`, 0 moved the other way, and 0 lost the serve invariant.
The two invariants were checked over all 4,756 non-archived rows in a single read: the substitution never returns a blank card and never replaces a line the gate accepts.
A first reading of this diff said 6 and 3, and it was wrong because the two planner runs were ten minutes apart and a concurrent session rewrote descriptions in between, which put 5 unrelated rows in the diff including two whose card went blank.
Attributing each changed row to the substitution by re-reading it, and then re-running the planner back to back over the candidate rows only, is what separated the effect from the drift; a corpus-wide planner diff across two runs cannot, and the counts here move with the corpus either way.

One `#1832` fixture moved rather than broke, and the distinction matters because the recorded reason for keeping an ungrounded stored card over a derivable sentence was that the gate judged the stored card.
The gate now substitutes too, so there is no divergence left to protect, and the wrong-topic graft that fixture pinned is replaced by a sentence grounded in the row's own body.
`#1832`'s own protection is pinned by a new sibling case: when no derived sentence clears the bar, the ungrounded stored card is still kept rather than surrendered.

Consequences.
The remaining cohort is acquisition and synthesis work with a per-lead ceiling of zero for deterministic code, so the next bounded experiment is a cost-and-yield measurement of the grounded synthesis lanes on a sample, not another lane.
The two producers that mint an unservable body should stop: a synthesis lane that emits a chip restatement as a `fullDescription` is writing a value the gate can never accept, and the card-synthesis prompt still bounds a card by words rather than characters.
Neither releases a row on its own, so each needs its own measurement rather than a quiet edit, and the prompt change re-synthesizes gated rows on the next sweep because it moves `CARD_SYNTHESIS_PROMPT_HASH`.

## 2026-09-22: Connecting Is Not A Schema-Mutating Act (#2233)

`db/connections.ts` built one shared `mongoOptions` and never set `autoIndex`, which Mongoose defaults on, so a process that merely imported a model recreated that model's collection and built its full index set on connect.
No read, no write and no materialize were needed, which is why a guard at any materialize entry point could never have fired.
That mechanism produced three recorded incidents: a `data-migration` package recreating legacy collections whenever any of its scripts ran, an empty `listings` collection with two indexes on a model that was deleted for being empty everywhere, and an access-review projection reappearing with 0 documents and 9 indexes about an hour after it was deliberately dropped.
It also made a write freeze unable to express what anyone wanted: "no writes except the sanctioned writer" and "nothing changes except the sanctioned writer" were different guarantees, because starting a process mutated the database without writing a document.

The issue proposed `autoIndex: false`, and measuring it showed that alone does not fix it.
`autoCreate` is a separate Mongoose default, so with `autoIndex: false` the dropped collection still reappears carrying its `_id_` index; and with `autoIndex: true` and `autoCreate: false` it reappears with all three, because building an index creates the namespace.
Decision: set both to `false`.
The measurement is pinned as a test rather than described, because the one-option version looks correct and is not.

The tradeoff the issue framed as the real decision was that a deploy self-heals its own indexes today, so turning auto-build off converts a forgotten index into a silent performance cliff.
Measured on Development, that self-healing already does not work: 2 of 136 declared indexes were absent from a database that has run with `autoIndex: true` for its whole life, one a unique index that cannot build because a duplicate value exists and one a text index that cannot build because MongoDB allows only one per collection and the declared spec had widened.
Mongoose swallowed both failures.
So the honest comparison is not loud-today against silent-tomorrow, it is silent-today against reported-tomorrow, which reverses the tradeoff.
`reportMissingMongoIndexes` runs at boot and logs every declared index a live collection is missing.
It is deliberately non-fatal: an unbuilt index is a performance problem, and refusing to boot on one would turn a slow query into an outage on the very deploy meant to surface it.
It also skips any model whose collection is absent rather than probing it, because creating that collection is the behaviour being removed.

`yarn --cwd server db:build-indexes` replaces the auto-build, dry-run by default, `--apply` to build, behind the standard production write guard.
It is additive and never drops, and per the issue's naming hazard it must never be renamed to `syncIndexes`: two different things in this repository carry that name, the additive local index copies in `syncBetaToDevelopment.ts` and `promoteAcceptedBetaCopy.ts`, and Mongoose's `Model.syncIndexes()`, which drops any index the schema no longer declares.
Removing an index stays a reviewed migration, never a side effect of an operator running a build.
When a build fails, the command reports the failure, leaves the existing index alone, and exits non-zero.

Scope is the shared `mongoOptions`, which covers the server boot and every script that goes through `initializeConnections`, and that is the path all three incidents took.
Roughly fifteen scripts call `mongoose.connect` directly with their own options and still default `autoIndex` on; routing those through the shared options is a separate change.
Tests are untouched on purpose: they connect with their own options and several depend on a unique index existing, so a global `mongoose.set` would have broken them.
The change is a connection default, so it is inert until a process next connects; the two Development drifts it reports were not repaired here because a unique index blocked by a duplicate and a text index needing a drop are both reviewed migrations.

## 2026-09-22: One Reference-Edge Auditor, And No `isArray` Flag To Get Wrong (#2294)

The Beta launch scorecard and the canonical reference-integrity audit carried near-identical orphan counters plus a hand-passed `isArray` flag, and the flag drifted.
The scorecard declared `signals.source.evidenceIds` scalar, so its `$lookup` on the schema-default empty array matched nothing and every signal carrying no evidence at all was counted as a broken reference.
Measured on Development on 2026-09-22, that reported 1,826 of 1,830 reference failures, which is exactly the count of signals whose `source.evidenceIds` is `[]`, while the canonical audit read the same edge in the same database as 0.
An operator could not tell the 4 genuine broken references from the 1,826 absent ones, which is when a launch gate stops being used.

There is now one auditor, `server/src/scripts/referenceEdgeAudit.ts`, and both audits declare their edges against it.
Counting per unwound reference is correct for a scalar field as well, because `$unwind` treats a non-array value as a single element, so the flag is gone rather than merely corrected.
A missing field, a null, an empty string and an empty array all yield no reference, and therefore none of them can be read as a broken one.

## 2026-09-22: The Materializer Write Path Validates, So A Schema Enum Is A Constraint Again (#2137)

The scraper path writes the whole corpus through `Model.updateOne`, and Mongoose skips validators on updates unless asked, so every schema enum on every materialized field was documentation rather than a constraint.
Creates were never in scope: `Model.create` runs full document validators, so the asymmetry was precise, and it is why a retired enum member can only have reached storage through an update.

The 2026-08-28 entry below named the mechanism as "the materializer's no-validator `updateOne`/create path" and closed it for `PROGRAM` specifically, at the materialize entry, by skipping a row whose stored `entityType` is the retired type.
A per-value guard does not generalize: measured on Development on 2026-09-22, 190 `research_entities` rows hold an `entityType` outside `researchEntityTypes`, across six retired members rather than one, and every one of them is archived.
`PROGRAM` is 12 of the 190.

The writer was re-asserting those values rather than merely tolerating them.
`materializedFieldValue` fell back to the stored value whenever an observation carried an unrecognized `entityType`, and on these rows the stored value is itself retired, so a rematerialize planned a `$set` the model would reject.
Dry-run materializing all 190 measured 84 plans carrying a value the schema omits, so turning validators on without fixing the fallback first would have thrown on 84 rows.
That is the order the decision depends on: the fallback is now enum-aware and returns undefined rather than a value the schema rejects, which drops those 84 to 0, and only then does `runValidators: true` go on the projection write.
A legacy value on an archived row is left untouched rather than rewritten or cleared; what changes is that no write re-asserts it.

Scope is the projection write, not every write in the file.
The membership, access, and fold-shell updates touch non-enum fields and gain nothing from validation, and widening the blast radius without a measured reason is how a fail-closed change becomes an outage.
Update validators check only the paths present in the update, which is what keeps this bounded: the write asserts what the projection decided, never the whole stored document.

Verified before landing by running Mongoose's own update validators over every planned projection in the corpus with a filter that matches no document, so the real validator path runs and nothing is written.
The `ResearchEntity.kind` enum needs no reconciliation: it already reads the same `researchGroupKinds` constant the writer sanitizes against, and `kind` measured zero drift.

## 2026-09-22: The Card Box Is A Rendering Preference, Not The Card's Length Bar (#1878)

Card length had two owners that disagreed, and the disagreement deleted copy instead of shortening it.
`shortDescriptionQuality` accepted a card line up to 280 characters or 44 words, and `sanitizeResearchEntityShortDescription` clamped the served line to whole sentences inside 200 characters and returned an empty string when the leading sentence alone was longer.
Every card producer wrote to the looser bar, so the band between them was minted, stored, accepted by the gate, and then deleted at serve time.

The band is where the whole population lived.
Measured on Development, 651 non-archived rows carried a stored `shortDescription` over 200 characters and every one of them was at or under 280, which is the looser bar's fingerprint rather than a property of the prose.
None of those 651 rows served its own card sentence.
524 served their research-area chips restated as a sentence, the redundant headline #1680 exists to replace, and 391 of those were `student_ready`, so this was wrong copy in front of students rather than an opportunity cost.
The rest served nothing.

#2184's fail-closed arm said callers would fall back to a quality-checked derived card line.
That fallback does not exist.
The derived line is usually the same over-preference sentence taken from the same prose, so it arrives back at the same clamp and is deleted again, and the resolver lands on the chip summary or on nothing.
An arm whose stated fallback cannot fire is the shape `skills/finishing-work/SKILL.md` calls an owner whose inputs never arrive.

Resolution: 200 stays, as a rendering preference, and the 280 and 44 bounds move to `descriptionHygiene.ts` as `MAX_CARD_SHORT_DESCRIPTION_LENGTH`/`WORDS`, the single owner that `shortDescriptionQuality` now reads.
`clampShortDescriptionToWholeSentences` still prefers a run of whole sentences inside 200, and when none fits it keeps the run that fits the card ceiling instead of deleting the line.
Both ceilings bound that run rather than judging it afterwards: rejecting a whole run for the word count of its last sentence deletes a card line whose leading sentence fit both ceilings, which is the same failure in a new place.
Only a leading sentence that is itself past the ceiling, in characters or in words, is still refused.
A kept line past the preference is quality-checked because the fallbacks below are what it displaced, and without that check four Development rows that had been serving a passing chip summary were newly held on their own failing sentence.
A line inside the preference is untouched, so this cannot drop the fluent stored card lines #1680 and #2184 intentionally keep.

That check is `storedShortPastRenderingPreferenceIsServable`, and both serving paths run it.
The gate reads `resolveServedShortDescription` while the card and blurb fields read `sanitizeResearchEntityShortDescription` through the DTO, so a check in only one place would let the list serve a failing line while the gate cleared the row on a chip summary no surface renders.
It asks the bar the gate will use, which for a `kind: 'program'` row is `programCardShortDescriptionQuality` rather than the lab bar: the two carry different flags, not nested ones, so asking the lab bar about a program row both admits lines the gate then holds on and refuses lines it would accept.
`kind` decides rather than `entityType`, because `INITIATIVE` covers `program`, `initiative` and `group` alike and cannot recover the marker `isProgramLikeResearchEntity` reads.

The trade this accepts is a CSS one.
A sentence longer than roughly 219 characters clamps at the card's fourth line on a desktop column and around 190 on a narrow mobile one, so some of these cards now end in a browser ellipsis.
That is better than the alternative they replace: a chip echo of the chip row rendered beside it tells a student nothing, and the detail page carries the body in full either way.
The producers are not corrected here and should be: the card-synthesis prompt bounds a card by words rather than characters, which is what puts a line in the band in the first place.
Changing the prompt changes `CARD_SYNTHESIS_PROMPT_HASH` and re-synthesizes gated rows on the next sweep, so it is its own change with its own measurement.

Measured effect on Development, one fixed row set read through the real gate planner and the real description representation before and after.
588 rows moved from a chip summary or a blank card to their own prose, and none moved the other way.
61 rows moved from `operator_review` to `student_ready`, and the single row that moved the other way did so on a `duplicate_risk` reason a concurrent writer added.
Held rows carrying a description-family reason fell from 925 to 824.
Reproduce the tier counts with `yarn --cwd server student-visibility:gate --collection=research --mode=dry-run` and read the served copy with `yarn --cwd server research-entity:served-scoreboard`.

## 2026-09-22: Browse Separates Research Types On `entityType`, Not On A New Org Taxonomy (#2195)

The browse filter panel now carries a Type axis beside School and Department.
It reads the `entityType` facet the `researchentities` index and the `/research/search` route already served, and labels each value from `RESEARCH_ENTITY_TYPE_FILTER_LABELS`, one distinct label per canonical type.
It deliberately does not reuse `entityKindLabel` for this, because a kind label is not a type label: `FACULTY_RESEARCH_AREA` and `FACULTY_PROJECT` are both kind `individual`, so a kind label would put two options with identical visible text in one select, and `FACULTY_PROJECT` would read "Group" while its own cards read "Faculty Research".
The axis accepts exactly the canonical `researchEntityTypes` enum on the same grounds: a `?type=` value has to round-trip through the URL, so the retired `FACULTY_RESEARCH` and `INDIVIDUAL_RESEARCH` values that #2219 left stored in unmigrated environments are rejected as a filter value and dropped from the select, while the entity-page and card copy paths stay tolerant of them.
Nothing new was modelled to get it: `entityType` was already a `filterableAttributes` entry and already present in the served `facetDistribution`, so the axis was reachable by every client except the one students use, and no Meilisearch reindex is needed to deliver it.

The four-category non-academic taxonomy the issue asked for is refused, because three of its four types have no live rows.
`COLLECTIONS_INITIATIVE`, `ARCHIVE_OR_MUSEUM_PROJECT`, and `DIGITAL_HUMANITIES_PROJECT` were retired by #2202 on the measurement that a student who opened one got a single outbound link and no person, roster, or affiliated lab.
Only `CORE_FACILITY` survived, so there is no four-way distinction left to express.

Attributing the school-less rows to a synthetic `Library / University-wide` school is refused on the grounds #2409 and #2940 established for the department and school axes.
A facet value is an assertion about Yale's org chart, and no source says a core facility belongs to a school by that name, so minting one would re-import the category error those two changes removed.
A core facility legitimately has no school, and the Type axis says what the row is rather than filling the school slot with a label nobody asserts.

Whether the six types the corpus actually serves should collapse into coarser student-facing buckets, for example "Labs and faculty research" against "Facilities and shared resources", is left open.
It is a product judgement about where `CENTER`, `INSTITUTE`, and `INITIATIVE` belong, and it cannot be settled by the corpus, so it is not worth guessing while the raw axis already separates the rows.

Measurement, Development, read through the real search route rather than a reimplemented predicate.
The public browse result set is 3,625 indexed rows and 3,348 served cards.
Its served `entityType` distribution is `FACULTY_RESEARCH_AREA` 2,149, `LAB` 1,050, `CORE_FACILITY` 50, `CENTER` 45, `INITIATIVE` 40, `INSTITUTE` 14.
So 149 served cards are organizational entities rather than labs or faculty research, and before this change no browse control separated them from the other 3,199.
Walking every served card, 58 carry no school at all, and each of those 58 is a `CORE_FACILITY` (37), `CENTER` (10), `INSTITUTE` (9), or `INITIATIVE` (2).
No `LAB` and no `FACULTY_RESEARCH_AREA` card is school-less, which is why the school-less cohort is a property of the type axis rather than a school-axis gap to backfill.

## 2026-09-22: The Standing Answer For The Description-Blocked Population (#574, #1901)

This replaces two open issues that had become less accurate than the corpus they described: #574, a north-star tracker whose every named child is closed and whose "~600 entities" is now 903, and #1901, a policy question whose three options are each already closed by a decision or by shipped code.
The description-blocked population needs a standing answer rather than a tracker, because its size is a property of intake and of the gate rather than a goal anybody can drive to zero.
Every count below is Development, the only environment that scrapes, measured 2026-09-22.

The instrument is the real planner and never a stored column.
`planStudentVisibilityGate` over the research collection, with blockers filtered by `isBlockingVisibilityReason`, reads 4,744 live rows, 3,293 planning `student_ready` and 1,451 held.
The stored `studentVisibilityReasons` on the same rows read 814 description-held and 333 held by description alone against the planner's 903 and 387, so the stored column trails the gate's own fixes and understates the cohort by about a tenth.
Control on the predicate: neutered it selects 0 of the 1,451 held rows and restored it selects 903.

Description is the largest blocker family and the ranking is not close: 903 held rows carry a description blocker, against 515 for `duplicate_risk`, 425 for `missing_lead` and 305 for `citations_identify_no_person`.
387 of the 903 are held by a description blocker and nothing else, and that is the releasable cohort; the remaining 516 also carry a blocker no description work touches, so counting all 903 as description-addressable overstates the releasable cohort by a factor of 2.3.

Serve state partitions the 903 into three sub-populations, each with one owner, and a fourth cut runs across all three to record which rows no lane can work at all.

**Serves nothing at all, 563 rows.**
503 store nothing, 52 store a body the serve layer withholds, and 8 store a career biography that sanitizes to blank.
`research-entity:fra-profile-synthesis` is the only lane with reach here, and #2939 is what gave it that reach: it admits an empty served description into scope and offers the official profile pages a resolved lead carries that the row does not itself cite.
Its reach is a subset of the bucket rather than the whole of it, because the lane is `FACULTY_RESEARCH_AREA`-only by construction and rejects every other kind as out of scope.
It selects 249 of the description-held `FACULTY_RESEARCH_AREA` rows.

**Serves prose but the card fails, 319 rows.**
256 are `FACULTY_RESEARCH_AREA` rows the synthesis lane deliberately leaves alone, since rewriting a description a student can already read is the #2183 churn.
This is a card-derivation defect and not an evidence gap, which the 2026-09-21 entry below already states.
100 rows are held by `missing_card_description` and nothing else, and 99 of those 100 serve prose.
The ceiling on deterministic derivation for them is 12 rows: `deriveShortDescriptionFromFullDescription` emits a non-empty string on 51 of the 100, but substituting it makes the gate's own `cardDescriptionUseful` true on only 12.
Read that as the measurement rule it is, because a deriver returning text is a proxy that overstated the gate's verdict fourfold here.

**Serves a career biography, 21 rows.**
The synthesis lane's original cohort, unchanged.

563 plus 319 plus 21 is the 903, so the three buckets above are the whole cohort and nothing double-counts.

**No candidate person page at all, 241 rows, all `FACULTY_RESEARCH_AREA`.**
This is a cut across the three buckets rather than a fourth slice of the 903: 226 of the 241 serve and store nothing and therefore sit inside the 563, and the remaining 15 sit in the other two.
No lane owns these and none can, because there is no page to read, so a row counted here is unworkable by whichever lane nominally holds its serve-state bucket.
This is an intake gap rather than a conversion gap, it is tracked in #1878, and it is worked by naming the extractor for the hosts those rows cite rather than by any description lane.

Three remedies are refused, standing, so a row this list leaves unconverted is a measured coverage floor and not an open question.

A `researchAreas`-only card is refused, and not as a judgement call.
`sanitizeServedResearchEntityCopyFields`, the one canonical serve-time sanitizer, already blanks a stored area echo, so no scraper, materializer or repair can store its way to such a card unless that sanitizer is loosened.
The read path is the other half of the refusal, and there it is not automatic: `resolveServedShortDescription` mints `buildResearchAreasCardSummary` as its last fallback, on the already-sanitized record rather than before it, so a chip card can still reach a student without that sanitizer moving at all.
361 served cards were nothing but chips when #2299 measured, and it closed the larger part of them by narrowing the DTO's read-time surrender of a stored card, which removed 227; what still mints one is a row with no servable stored card and no derivable sentence.
That minted card is now grounding-checked on both halves (#2972): the chips are filtered to the ones the row's own body supports rather than taken in stored order, and when the body supports none the card is withheld rather than asserted, which the visibility gate reads as `missing_card_description`.
Withholding cost 13 of 3,551 promoted Development rows their visibility and removed an unsupportable topic assertion from 46, measured through `getResearchGroupDetail` and `student-visibility:gate --dry-run` before and after; the other 33 keep their visibility because the gate clears them on a stored card the DTO separately refuses.
So read this entry as a standing refusal to widen the chip card, on either side of the sanitizer, rather than as a claim that no student currently sees one.
Loosening either side for coverage is the same trade the 2026-09-22 entry below refuses for a different module, the person-kind hygiene selection in `server/src/utils/researchHomeDescriptionSelection.ts`, which that entry records as load-bearing: description coverage is not a reason to weaken a hygiene rule, in either place.

Suppressing a row for carrying no research prose is refused.
The 2026-09-21 entry makes a `FACULTY_RESEARCH_AREA` first-class and never demotes or suppresses one for lacking an independent website, and lacking harvestable prose is the same kind of absence.
The genuine exception is a row whose subject hosts no research at all, a teaching-only lecturer for instance, and that is a `classifyResearchEntityResearchScope` gap to close on the scope classifier rather than a description decision; it is unmeasured here.

Ingesting the Yale profile JSON-LD `description` is refused by the 2026-09-22 entry immediately below, which measured it as a curriculum vitae.

Consequences.
The north-star framing is retired as a tracker rather than restated.
The gate is correctness-only, so growth in intake dilutes description richness by construction, and a held-row count is therefore a reading rather than an aim; `corpus:snapshot` and `research-entity:served-scoreboard` are where that reading belongs, not a ranked blocker list in an issue body that is stale the week after it is written.
#1901's three options are all closed, two of them by the decisions above and the third by being built instead of chosen, in #1937 and #2939.
A count of this cohort is instrument-dependent and moves with the gate's own repairs, two of which landed the same day as this entry, so re-measure with the planner and name the instrument beside the number rather than quoting a figure from here.
That is why the 2026-09-22 entry immediately below reads the same "description blocker and nothing else" predicate at 619 where this entry reads 387: both are Development, and 387 is the later reading, taken with the planner after those two repairs.
Neither figure is load-bearing for the refusal that entry records, which holds at any cohort size.

## 2026-09-22: Two Signals We Deliberately Do Not Act On (#2670, #2704)

Both of these were investigated, measured, and refused.
They are recorded here because the opportunity they point at keeps growing, so the refusal has to be easier to find than the temptation.
Every count is Development, the only environment that scrapes.

**An emeritus appointment, and the word retired, are not suppression signals.**
146 rows carry an emeritus appointment and 33 of them describe active research work, so suppressing on the appointment would withhold about one row in five that a student should see.
The word retired is worse, because it appears in research prose about retirement as a subject.
`inactive_at_yale` therefore keeps exactly one producer, `entity.activeAtYaleCache === false`, and nothing derives it from a profile appointment string.
Where a departed person is genuinely unservable, the evidence is a dead profile page rather than a title, which is the source-link-health path instead.
Emeritus stays what it already is in the code, a description-quality signal, not a visibility one.

**The Yale profile JSON-LD `description` is a CV, not a research description.**
The `Person` block on a Yale profile page is real and machine-readable, and it is tempting because rows held by a description blocker and nothing else are the largest single-family cohort in the corpus, now 619 rows and still growing.
Hand-read, roughly 2 to 4 of 16 of those `description` values read as research; the median is about 978 characters of appointments, degrees, society memberships, and awards, with no HTML to strip.
Ingesting it would put a curriculum vitae on the order of 600 cards, which is the exact defect class the description hygiene rules exist to refuse.
The block's `name` and `jobTitle` are safe and are already read.
So is `description`, which is why the refusal is about adoption rather than about reading: `jsonLdDescriptions` in `server/src/utils/officialResearchDescription.ts` pushes it as a first-position entry in the shared candidate list, and `officialProfilePiBackfillScraper.ts` folds it into leadership-evidence text.
What keeps a CV off a card is therefore the person-kind hygiene selection in `server/src/utils/researchHomeDescriptionSelection.ts`, not an absence of reads, so that selection is load-bearing and its filters must not be loosened to raise description coverage.
Most of that weight sits one layer down, in `describesResearchFocus` in `server/src/utils/researchEntityDescriptionQuality.ts`, which the selection calls: a change to that shared predicate decides this refusal even though the refusal reads as belonging to the selection.
It is a narrow predicate rather than a CV classifier, and a CV of appointment lines carries no research-focus phrase at all, so a single noun reading of "studies" inside a degree-level program title was by itself enough to promote a whole CV (#2670).
`server/src/utils/__tests__/officialResearchDescription.test.ts` pins the refusal at the median CV shape, including that title.
A future lane that wants those 619 rows should synthesize from research prose rather than promote this field.

## 2026-09-21: `FACULTY_RESEARCH_AREA` Stays First-Class Alongside `LAB`, And Card Synthesis Precedes Crawl Scale-Out (#2881)

This reaffirms the "Faculty are represented once" rule in the 2026-08-25 entry below and adds the corpus measurements that verify it, the discriminator that separates the two kinds, and the order in which coverage work should be done.
Every count below is Development, the only environment that scrapes, measured 2026-09-21.

A `FACULTY_RESEARCH_AREA` is a first-class entity, not a degraded `LAB`.
It carries the same content contract and, measured, the same content: served `FACULTY_RESEARCH_AREA` rows average 805 characters of `fullDescription` and served `LAB` rows average 807, and both are non-empty on every served row.
An independent `websiteUrl` is enrichment and a ranking input, never an eligibility bar.
Gating on it would have withheld 1,559 of the 2,020 served `FACULTY_RESEARCH_AREA` rows whose prose reads as well as a lab's.

The two kinds are near-disjoint by person, which is what makes both first-class rather than redundant.
Across non-archived rows, 2,740 people lead a `FACULTY_RESEARCH_AREA` and 1,273 lead a `LAB`, and only 39 lead both; among served rows the overlap is zero.
`LAB` is the path for faculty who have a named lab and `FACULTY_RESEARCH_AREA` is the path for those who do not, so together they are the faculty research map rather than two views of one population.

The discriminator is organizational identity versus topical scope, and name shape already expresses it.
Among served rows, 970 of 1,036 `LAB` names carry an organizational token such as lab, laboratory, group, center, or institute, against 2 of 2,020 `FACULTY_RESEARCH_AREA` names.
An independent `websiteUrl` is a gradient rather than a boundary, at 72 percent against 23 percent, and roster size does not discriminate at all because 96 percent of served `LAB` rows are also lead-only.
The typing rule should therefore be explicit rather than emergent, so a mis-typed row is detectable; the audit population is the 2 `FACULTY_RESEARCH_AREA` rows carrying an organizational token, the 66 `LAB` rows carrying none, and the 39 people who lead both.

Coverage is intake multiplied by conversion, and conversion is the binding constraint.
598,939 observations over 43,469 keys yield 3,232 served rows, an end-to-end conversion of 7.4 percent, so doubling intake buys roughly 3,200 more served rows while doubling a ledger already growing about 265,000 documents a month.
Conversion by kind is 64 percent for `FACULTY_RESEARCH_AREA`, 75 percent for `LAB`, 81 percent for `CENTER`, 89 percent for `CORE_FACILITY`, and 93 percent for `INSTITUTE`.
Card synthesis and identity resolution therefore precede crawl scale-out for the faculty kinds.

Crawling is the right instrument only where conversion is already high and the row count is implausibly low.
That is `CENTER` at 57 served rows, `INSTITUTE` at 15, and `CORE_FACILITY` at 56, against a university with hundreds of each.
`PROGRAM` has zero live `ResearchEntity` rows because programs are served from `fellowships` through a service alias, so the programs model is settled before any crawl targets programs, not after.

Consequences.
No `FACULTY_RESEARCH_AREA` is demoted, merged, or suppressed for lacking an independent URL.
The gate's card-description expectations are the constraint to work on rather than the entity's right to exist, and `missing_card_description` on a row that already carries useful prose is a card-derivation defect rather than an evidence gap (#2276).
Distributed crawling is an efficiency investment for a later phase, and the parts of it worth building first are the ones that make materialization cheaper to iterate: a content-addressed snapshot store, and a fetch stage separated from an extract stage so an extractor change is a re-run rather than a re-crawl.

## 2026-09-18: Scraper Fetches Do Not Require Yale VPN (#2846)

This supersedes the Yale VPN requirement recorded in the 2026-07-25 entry "Development Uses Atlas MongoDB And Local Meilisearch" below.
That entry is left intact as the record of what was believed at the time.

The requirement was never enumerated or enforced.
No document listed which sources were Yale-only, no source carried a flag marking it as such, and no code detected VPN state, so the rule could not be checked in either direction.

A paired measurement settled it.
One fixed list of 525 served URLs spanning 373 `yale.edu` hosts was fetched from Yale network and from an off-campus cellular connection, minutes apart from the same machine, using the scraper User-Agent and its normal per-host pacing.
Yale network returned 479 of 525 as 2xx and the off-campus connection returned 480.
Both arms produced zero HTTP 429 responses and the same three HTTP 403 responses on the same hosts.
Comparing per URL, 478 succeeded on both arms, 44 failed on both because the URL or the host is dead, 2 succeeded only off-campus, and 1 succeeded only on Yale network.

That single host, `ensemble.yale.edu`, resolves to `10.9.65.60` and `10.9.65.107`.
It sits behind an internal load balancer on private addresses, and a DNS census of all 373 hosts confirms it is the only such host.
The Yale-network-dependent surface is therefore 1 host of 373, and the cause is private addressing rather than any policy that inspects the client.

Bursts of HTTP 403 responses are rate limiting rather than address blocking, and they are not network-dependent.
A full `dept-faculty-roster` run on Yale network produced 518 of them on the profile-enrichment path under concurrent load, while 60 profile pages fetched off-campus at the scraper's own pacing returned 60 of 60 as 2xx.
The remedy is the per-host pacing in `hostConcurrencyLimiter`, which already carries overrides for the two hosts that need them.

Consequences.
An operator needs no Yale identity, VPN session, or campus wifi to run a fetch, so the requirement for two Yale-affiliated operators is retired.
Network access no longer argues against a hosted scraping runner.
The remaining obstacles to one are toolchain, input-file, Atlas access-list, and target-environment questions rather than network ones, and `docs/data-refresh-runbook.md` enumerates them.

## 2026-09-15: Retire The Three Undergraduate Logistics Enums Entirely

`undergraduateCurrentAvailability`, `undergraduateCompensationModel` and `undergraduateEligibleStudentLevels` each backed a browse facet and, for availability, a saved-plan and dashboard claim.
No source publishes any of them.
Across the served corpus availability held 3 real values and the other two held none, so a student who applied the facet narrowed the entire corpus to three rows, and every other branch of the derived access status was unreachable in practice.

Decision: remove the vertical rather than keep the facets waiting for a producer, exactly as `#2527` did for `hasDocumentedWayIn`.
The schema fields and their indexes, the Signal re-derivations in the browse-rank sweep, the Meilisearch filterable attributes, the filter params, the facet visibility thresholds, and the client controls are all gone.
`hasUndergradHostingEvidence` is deliberately untouched: past hosting evidence is the one undergraduate access signal the corpus actually carries, and it still drives the saved-plan badge and its secondary ordering.

Removing the schema declaration does not remove what is already stored.
Mongoose ignores an undeclared field on read but never strips the value, and the public search hit spreads the raw Mongo row, so each environment keeps serving the frozen `"OPEN"`, `"UNKNOWN"` and `[]` values plus three physical indexes maintained on every write and used by nothing.
`retire:undergraduate-logistics-fields` completes the retirement: it unsets all three fields, asserts that zero documents still carry one, and only then drops the three stale indexes, refusing each drop while a field is still populated so that a resurrected writer surfaces as a failure instead of being quietly erased.
Until it has run against Development, `RETIRED_ACCESS_INDEX_FIELDS` keeps the stored values out of the Meilisearch documents.
Removing the three `filterableAttributes` entries likewise leaves them advertised in each already-built index; `docs/meilisearch-reindex-runbook.md` owns clearing that residue, as it does for `#2527`.

## 2026-09-12: Retire The Identified-Lead Ways-In Signal Producer (#2578)

`deriveIdentifiedLeadWaysIn` minted two `REACH_OUT_PLAUSIBLE` derivation keys, `IDENTIFIED_FACULTY_LEAD` and `ORGANIZATIONAL_HOME`, for any eligible research home with an official non-grant page and one supporting observation.
It exists because #530 and #1361 wanted a fallback that cleared the dominant `missing_action_evidence` blocker without manufacturing undergrad-access claims.

It has no reachable reader, measured at `2275702f`.
Beta and Production each hold 4183 live rows from it, all `confidence=LOW` with `confidenceScore` capped at 0.4 by `Math.min(0.4, ...)` in the derivation itself, so the confidence is structural rather than incidental.
`signalCountsTowardAcceptance`, `accessSignalCount` in the gate, `reachOutPlausibleSignalCreditsActionEvidence`, and `countResearchEntityAlternateAccessPaths` all exclude the two keys by denylist.
`researchEntityBrowseRankService` over-fetches every access signal but feeds only `hasUndergradHostingEvidenceFromSignals`, whose set is `PAST_UNDERGRADS`/`CURRENT_UNDERGRADS`/`FACULTY_SUPERVISES_STUDENT_PROJECTS`.
`researchEntitySearchIndexService` reads no signals.
On the client, `accessSignals` reach only `buildResearchDetailSources`, which drops anything `LOW` via `isCitableAccessSignal`, so 0 of 4183 contribute even a citation, and no code path renders a signal excerpt at all.
The one reader that does see them is `researchEntityEvidenceCoverage`, where `hasAccess = accessSignals.length > 0` has no derivation-key filter; that feeds a scrape-run diagnostic report, is not served and gates nothing, and losing these rows makes `missing_access_evidence` correct rather than wrong.

Decision: retire the producer rather than repair it.
The excerpt it wrote, "explore its programs and affiliated people for a way in", restates the documented default action - `research-model.md` puts the student job-to-be-done as "discover a research home, then cold-email the professor", and `student-ready-definition.md` records that "reaching out is already the next step and the action".
A fallback whose content is the default, and which every consumer denylists, is enrichment that enriches nothing.
Reintroducing an access fallback later remains possible; it would need a reader first.

The ordering matters and is not optional.
Every one of the 4183 stored rows carries a synthesized excerpt, and the #1343 rule admits any `REACH_OUT_PLAUSIBLE` that has one, so `IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS` in `accessAcceptanceLevel.ts` is the only thing stopping those rows from lifting acceptance on 4174 entities.
Deleting the denylist in the same change as the producer would therefore have promoted every retired row instead of retiring it.
So the denylist stays, annotated, until `retire:identified-lead-ways-in` has archived the data in every environment; `assertAcceptanceDenylistStillGuards` fails the run from the data side if that order is ever reversed.

The retirement archives rather than deletes, which is how every other signal withdrawal in this repo works and keeps readable what the corpus used to assert.
The two derivation-key constants stay exported from `accessAcceptanceLevel.ts` alongside the denylist, so `REPOINTABLE_SIGNAL_DERIVATION_KEYS` in the superseded-citation repair lane keeps working and the open #2525 repair run stays whole in environments that still carry the rows; that pass goes vacuous once retirement completes there, and the constants go with the denylist in the follow-up.
`officialNonGrantSourceUrl` is deliberately untouched: the visibility gate reads it directly as proof an entity has a way in.

## 2026-09-11: Retire The `hasDocumentedWayIn` Browse Projection Entirely

`#1519` derived `hasDocumentedWayIn` from `Signal`, stored it, indexed it, mirrored it to Meilisearch as a filterable attribute, and exposed a `documented=1` browse control over it, complete with a per-request disjunctive facet recompute so the client could see both the documented and undocumented buckets.
`#1884` then retired the control and deliberately kept the server projection, so that the split could be re-exposed later.
Nothing took it up.
The result was a full server vertical whose only entry point was a hand-written API param no client sent: the derivation ran on every browse-rank sweep, and the facet recompute ran on requests, for a filter a student could not apply.

Decision: remove the vertical rather than re-expose it, and treat the field as YAGNI rather than as a kept option.
`#2527` removed the derivation, the schema field and its index declaration, the filterable attribute, the filter param, the facet distribution, and the reserved `documented_way_in` analytics kind.
Re-exposing an access filter later remains possible; it would be a new product decision with its own evidence, not a revival of this field.

The sparse positive way-in card signal is unaffected, because it reads the entity access summary rather than this boolean.
`hasUndergradHostingEvidence` is deliberately untouched: it is still served in the saved-plan projection and drives student-facing copy.
`EF-03` in `docs/research-student-journey-delivery-plan.md` therefore stays Active on the card signal, with its filter acceptance criterion marked Superseded.

Removing the schema declaration does not remove what is already stored.
Mongoose ignores an undeclared field on read but never strips the value, and it never drops an index it has stopped declaring, so each environment kept the field on thousands of documents plus a physical `archived_1_hasDocumentedWayIn_1` index maintained on every write and used by nothing.
`retire:documented-way-in-field` completes the retirement per environment: it unsets the field, asserts that zero documents still carry it, and only then drops the stale index, refusing the drop while the field is still populated so that a resurrected writer surfaces as a failure instead of being quietly erased.
Meilisearch keeps advertising the retired filterable attribute until each environment is reindexed, which is tracked separately.

## 2026-09-10: The Admin Search-Query Report Counts Searches, Not Requests

A search request carries no notion of intent, so the report used to count whatever the surfaces happened to send: a keystroke pause on the debounced programs surface, every page of a walk through one result set, and an operator's visibility-tier sweep, while the research surface sent nothing at all and a filter-only search reported as `(empty search)`.

Decision: the server decides what a recorded search is, in one place, `server/src/services/siteSearchAnalytics.ts`.
A recorded search is one signed-in student asking for something on the first page of results; typing states of one query fold into the query they settled on, and an identical repeat of a search collapses into the row it repeats on every surface.
Whether an edit of the query folds is a declared property of the surface, because only a debounced surface mints keystroke snapshots.
`docs/topic-matching-and-search-engagement.md` owns the rules and the reasoning.

## 2026-09-05: Retire The `searchMatch` Per-Result Match Explanation

`searchMatch` was read in four places and written in none.
The server copied it off the Meilisearch hit in `researchGroupService`, allowlisted it onto the served DTO, and the client typed it, normalized it, and used it for the card's match reason, method labels, concept tags, and confidence value.
No model, no index builder, and no search path ever set it, so `hit.searchMatch` was always `undefined` and a served search response carried it on zero rows.
The field was inert rather than degraded: it never carried a wrong value, only no value, so there was nothing to tighten and the only two remedies were to add a producer or to remove the consumer.

Decision: remove the consumer.
A per-result "why did this match" affordance that resolves to the same constant for every result is not an explanation, and the honest state is to say nothing rather than to print `Yale research profile source.` under a "Why it might fit" heading.
Producing it from Meilisearch's matched attributes remains possible later; it is a new feature with its own product decision, not a repair of this field.

Two things this retirement is not.
It is not a change to served student-facing copy: `ResearchHomeCard` rendered the match reason only in its `default` variant, and both call sites on `/research` pass `variant="compact"`, so the placeholder was unreachable in the running app.
It is also not proof that the field was harmless: it kept a live path from the Meilisearch hit into the served DTO, and the DTO test that exercised it hand-constructed the object, so it verified the shape while the wiring was never connected.
Tests that build their own input for a field with no producer cannot detect that the producer is missing; the replacement test asserts that a `searchMatch` on the input is absent from the DTO.

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

Its Yale VPN requirement is superseded by the 2026-09-18 entry "Scraper Fetches Do Not Require Yale VPN" above, and the paragraph below is kept only as the record of what was believed at the time.

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
The Render web service is configured in the Render dashboard, not in this repository, so this repository cannot guarantee or configure its edge compression.
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
