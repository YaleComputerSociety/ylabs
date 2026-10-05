# Decisions

This file records durable product and architecture decisions only.
Do not append continuation logs, security hardening transcripts, or task progress here.
Track tactical work in GitHub issues and keep transient artifacts outside `docs/`.
`docs/tasks/priority-roadmap.md` holds standing launch priorities, not the outstanding-work list.

## 2026-10-05: A Lab Whose Own Site Names A Namesake As Its Lead Is Held For Review (#4916)

This is the first reader of `leadVerification`, and it reads one narrow shape rather than the contradicted verdict the 2026-10-01 entry declined to act on.
A graded sample served a lab whose lead's given name differs from the lead its own cited page names: a profile's lab slot linked a same-surname colleague's lab, so the row carried the colleague's lab name, website and prose under the wrong person.
The verifier now records which shape contradicted a lead (`contradictedBy`): `NAMESAKE`, a same-surname person whose given name cannot be the lead's, or `NAMED_AS_LEAD`, a person named beside a lead-role phrase.
A namesake no longer contradicts when its given name could be the lead's through any existing alias rule: `givenNamesCouldNameOnePerson` (initials, short forms, the nickname index), a transliteration fold (same first letter, at least four letters, equal once `h` is dropped, `y`/`i`, `o`/`u` and `e`/`a` are folded and doubled consonants collapse), and every name a former-name annotation gives (`personNameAliases`).
The gate holds a row at `operator_review` with `lead_contradicted_by_namesake` only when a `NAMESAKE` judgement is about an attached lead and about the website the row still serves; `NAMED_AS_LEAD` stays unread, because #3750 measured that shape mostly wrong.
Measured on Development on 2026-10-05: 7 live rows carry a `contradicted` verification, and a hand-check of their cited sites found 2 namesake collisions (both right: a lab attached to a same-surname colleague, and a profile lab slot linking a namesake's lab), 1 namesake that is the lead under a nickname and initials (spared by the alias rules), and 4 that are lead-role mentions or verdicts on faculty research profiles, which the reader ignores.
No stored judgement carries `contradictedBy` yet, so the hold reaches no row until `lab-site-lead-verification` runs again and the gate is re-applied.

## 2026-10-05: A Card Or Body Names A Method Only When Its Evidence States It (#4914)

The graded sample after #4867 found overreach on 27 of 116 graded rows, mostly in the card line: listed interests, publication topics, emphases or a unit's name restated as "using X and Y", clinical or teaching interests served as research, a mission or vision sentence turned into an activity, separately listed topics joined into one claim, and past or one-off work stated as current research.
Decision: every prompt that writes a card or a body carries one shared rule text (`server/src/scrapers/prompts/synthesisFidelityRules.md`), composed into the card synthesis prompt, the written-description prompt and the backfill writers rather than copied.
A deterministic check backs the first rule: a "using", "via", "through", "by means of", "employing" or "leveraging" clause in a written body or a synthesized card is kept only when each listed item shares a word with a method-introducing context in the evidence the text was written from, and is otherwise stripped, or refused as `unsupported-method-clause` when nothing is left.
The other four rules are prompt rules only, because no deterministic shape separates them from correct prose.
Calibrated read-only over the 3,571 `student_ready` Development rows: of 1,636 cards with such a clause the check strips 532 and refuses 8, and of 867 bodies it strips 119 and refuses 1; a hand check of 20 hits found 18 correct, and of 20 non-hits found 18 correct.
The writer contract version and the card prompt hash change, so the next writer run re-judges every row and the next microsite extraction run re-derives its cards.

## 2026-10-04: A Description The Extractor Verified Against Its Fetched Page Is Page Text (#4867)

The strict #4867 rule left 2,074 of the 3,908 rows that carry writer evidence with no page evidence, because almost no durable page copies exist.
Decision (owner, 2026-10-04): admit the microsite extraction lane's `fullDescription` values that the lane verified against the fetched page at ingest, where every sentence of four or more words must be present in the page text (`groundDescriptionExtraction`, #528).
The admission depends on a per-observation marker rather than the source name: the observation's `scrapeRunId` names a recorded `scrape_runs` row of that lane that started after #528 reached beta (`PAGE_GROUNDING_VERIFIED_SINCE`).
The description backfill script writes rewrites and syntheses under the same source name with a fresh run id it never records, so its values match no recorded run and stay excluded; a lane run that predates the check is excluded too, and so is the lane's `shortDescription`, which can be a synthesized card.
Every other model-text value still needs a durable stored copy of its page, and none exists yet.
Measured read-only on Development before merge, 598 of the 4,193 live rows have no page evidence (272 of them `student_ready`) and 553 have no evidence even counting grants (232 `student_ready`), counting the row's own value refusals and excluding invalidated lane runs; an all-rows writer run makes about 3,635 model calls.
The 174 live values from lane runs before the check stay excluded; admitting them would recover roughly 90 rows, which is the cost of not admitting unverified text.

## 2026-10-04: A Written Description Is Grounded In Fetched Page Text, And Grants Help Only When They Must (#4867)

A 120-row graded sample after #4788 found 7 of 100 written bodies wrong, above the goal of fewer than 5% wrong.
Two of the seven re-asserted details an earlier model-written observation had invented, and three attributed another unit's content, a co-founder's personal agenda or a featured item to the row.
Decision: the writer is grounded only in text that is on a fetched page.
A value a language-model lane wrote (`producesModelText` in `sourceCoverageRegistry.ts`, plus three retired lanes) is evidence only when it is found near-verbatim in a durable stored copy of the page it cites, and never without one; no durable page store exists yet, because `scrape_snapshots` is a 24-hour fetch cache; the one admitted exception is recorded in the entry above.
Evidence is read in this order: the row's own research site, its official profile, other pages, and grant records last.
Grant rule (owner direction, 2026-10-04): grants are read only when the row's own research prose is absent or thin, only grants the row's lead holds as principal investigator that are active or ended within five years, never a single grant as the whole evidence, so one eligible grant is not read at all, and the prompt states only the theme several grants share.
The prompt forbids attributing navigation, carousel, related-unit or featured-item content, presenting training or past positions as current work, and turning a listed interest into a method or a study subject; a sentence naming a featured item, a related unit or training as current work is dropped deterministically.
The writer contract version is bumped, so every row is judged again on the next run.
Measured read-only on Development before the change, the strict rule leaves 2,074 of the 3,908 rows that carry evidence with no page evidence at all, 1,515 of them with no evidence even counting grants, because almost no stored page copies exist and most description evidence is model-extracted.
The owner chose the fallback in the entry above.

## 2026-10-04: A Page's Own Research Paragraph In The Progressive Is Research (#4809)

`describesResearchFocus` reads research from a closed list of phrasings, and it had the simple present ("we develop") without the progressive ("we are developing").
A lab page whose only research paragraph read "In the Yale Faboratory, we are developing intelligent, multifunctional materials" therefore failed the floor, and its meta blurb won on a phrase listed for that blurb alone.
The progressive with a research verb after a first-person or unit subject now counts, as does "focuses research, teaching, and outreach on".

Measured before landing on Development on 2026-10-04: over 4,193 stored rows the change flips the focus verdict on 4 bodies, all research prose, and no body or card quality verdict.
Over 668 fetched org pages it changes 10 deterministic picks: 7 pages that yielded nothing now yield their own paragraph, 1 replaces a question opener with the lab's statement, 1 lengthens the same text, and 1 now opens on two sentences of background before "We are currently investigating".

## 2026-10-04: A Card Line Is Produced To Fit The Browse Card (#4809)

The 2026-09-22 entry below stopped the serve path from deleting a card line past 200 characters, and kept it whole instead.
Kept whole, a one-sentence line still reaches the browse card, which ends at the last whole sentence within 200 characters and otherwise cuts mid-sentence with "…".
Measured on Development on 2026-10-04, after #4788's written bodies landed, 1,649 of 3,367 served browse cards were cut that way, almost all of them fluent "Studies ... using ..." sentences of 230 to 270 characters written to the card prompt's "under 30 words".

Resolution: every card producer prefers a line that shows whole, and a long line is the last resort rather than the first answer.
`resolveGroundedCardDescription` returns a derived line only when it fits, then a synthesized line that fits, and only then the long derived or synthesized line, which still outranks the topic summary.
Card synthesis asks for at most 20 words and 170 characters, naming only the main subject and method, and retries once with its own answer when that answer runs long or the serve chain would surrender it as an ungrounded synthesized card, asking for the description's own terms.
It prefers a retried line the serving bar keeps, and otherwise keeps the first grounded line, so a card accepted only on the stem-aware grader is still stored when nothing better comes back (#4834).
A character limit alone did not hold: the model returned the same 206-character line on both attempts, and the word budget with what to leave out fit 12 of 12 cut cards.
`resolveMaterializedShortDescription` reconsiders a stored card the browse card cuts, or one the serve chain would surrender for a longer line from the body, and replaces it only with a line that fits and the serve chain keeps, so one unshown line is never traded for another.

The limit lives in the per-call instruction, not in `prompts/cardSynthesis.md`.
`lab-microsite-description-llm` keys its content hash on that file's hash, so editing it would have invalidated every stored hash for the lane and re-run its LLM extraction over every row on the next sweep, about 2,500 calls, to change only the card.
The stored cards change through a targeted rematerialize of the cut rows instead.

Three resynthesis passes still left 611 of 3,613 cards cut: the model kept returning a long line, or a fitting one the serve chain's stricter grader surrenders.
The served card is therefore also ended at its last clause boundary that fits (`shortenCardLineToFitBrowseCard`): before ", including", ", such as", "; ", ", which", ", plus", a second coordinated clause such as ", and how" or " and develops ", or a method clause such as " using ".
The head of a grounded sentence is grounded, so this adds no claim; a cut at a bare comma, a parenthesis, or an "and" not followed by a clause-opening verb or wh-word lands inside a list, so a card with no clause boundary inside the card stays long.
A word that also reads as a plural noun ("uses", "studies", "tests") does not open a coordinated clause, because "structure, function and uses of" continues a noun list.
" through " and " via " are not boundaries, because they are not reliable method markers: "from adolescence through early adulthood" cut before " through " changes what the card says.
Measured on Development, cut cards went from 611 of 3,613 before this change to 326 of 3,609 after it (the served population moved by 4 rows between the two measurements), with no change to the four public-description invariant failures.
After the written body took over most cards, the lines still cut were mostly body leads whose boundary has no comma, so the boundaries were widened on 2026-10-05 (#4809): a bare " such as " or " including ", ", with focus on" and ", with a translational focus", an em-dash aside, " by <verb>ing ", " to explore " and similar purpose clauses, ", aiming to ", and a colon.
Each new boundary carries a guard for the shape it misread on Development: a head that ends on a linking verb or a placeholder noun ("and topics."), an em-dash or en-dash aside the sentence closes after its verb, and an example list inside a relative clause.
A boundary with no punctuation before it also refuses a head that ends on a word needing what follows ("has", "aims", "in order", "how", "the ability", an adverb, or a past participle).
A head the card quality check would call too short is never the cut, because the gate would then hold the row.
Measured on Development on 2026-10-05 with the change applied, cut served cards went from 294 to 153 of 3,573, and served cards the quality check calls not useful stayed at 44.
A routine materialize reconsiders a cut card with the deterministic derivation only, because a synthesis that yields no fitting line writes nothing and would repeat its LLM calls on every later materialize of the row.
Card synthesis for a cut card is opt-in through `--resynthesize-cut-cards`: `yarn --cwd server research-entity:rematerialize --slugs=<rows whose browse card is cut> --resynthesize-cut-cards --apply --confirm-rematerialize`.
`--card-model=<model>` synthesizes those cards with another model for that run only, because the description lane keys its content hash on its own card model, which must not change for a repair pass.

## 2026-10-04: Evidence Is Input To The Description, And One Writer Writes Every Description (#4788)

A served description answers one question for a student: what does this lab or researcher study.
Most served bodies were page text copied verbatim from a source, and a 45-row random sample of `student_ready` Development rows found about 13 that do not answer that question: career biographies, publication and grant listings, source narration, and page chrome or promotional copy.
The live `manual-admin-edit` `fullDescription` observations were worse than copying, because several narrate their sources in agent voice and every one outranked every scraper lane through the non-decaying curated precedence.
Decision (owner, 2026-10-04): evidence is input to the description, not the description.
One writer, the `coverage-synthesis-llm` lane run by `research-entity:coverage-synthesis`, synthesizes every live research row's `fullDescription` from that row's live evidence as 1 to 3 sentences answering what it studies.
The writer is checked against its evidence by the existing `coverageSynthesisDecision` gates, plus three deterministic arms: a past-career sentence is stripped and a body that is nothing else is refused, a body that narrates its sources is refused, and a body over 90 words is refused.
The resolver serves a servable written body over every copied value, and the copied values stay ranked behind it as the fallback for a row the writer refused or has not reached.
A PI's own edit is not copied page text, so it is the one source the written body does not outrank.
`manual-admin-edit` loses its curated precedence on description fields only: it decays and is reordered there like any other source, and it keeps the curated precedence on every other field.
An admin description is ordinary evidence the writer reads, unless it narrates its sources.
The card line is derived from the written body through the existing card derivation, so there is no second card writer.
This keeps the evidence contract: the written body is itself an observation, re-derived when its evidence or its prompt changes and retired when its evidence no longer supports it, so no field is written directly and nothing needs a lock.
A thin but accurate body still serves (#4766), and every accuracy gate still applies.
A read-only pilot of the prompt passed every gate on 31 of 31 rows, and a 10-row dry run of the lane passed on 10 of 10 with no body over 72 words.
This is a stored-data change: it reaches students only after the lane has run over every live Development row and the rows are materialized, regated and reindexed.

## 2026-10-04: Google Analytics Is Removed, And First-Party `analytics_events` Remain (#4754)

The Google Analytics 4 tag is removed from every page and every environment (owner decision, part of the privacy notice in #4157).
Nothing in this repository read the data it collected.
It loaded on the initial document before any consent existed, and so sent every visitor's IP address, user agent and a persistent tracking cookie to Google.
The CSP drops the Google tag and measurement origins with it, so `script-src` is `'self'` alone.
First-party `analytics_events` remain, under the constraints in `docs/research-journey-analytics.md`, and they still record signed-in students only.
Google Fonts is a separate decision and is unchanged here.
`client/src/__tests__/noGoogleAnalyticsGuard.test.ts` and `server/src/middleware/__tests__/securityHeaders.test.ts` fail if the tag or its origins reappear.

## 2026-10-04: The Program Card Bar Refuses An Administrative Note And Cuts An Over-Long Lead At A Clause (#4747)

A program card line states what the program is or funds, so a sentence that is an administrative note fails the program card bar as `administrative-chrome` in any phrasing: a note or please-note opener, an application-process heading, a deadline, due-by, nomination or endorsement sentence, a program-dates or info-session fragment, application routing through a portal or common application, an opening or rolling-review window, a click-through instruction, a donor-provenance sentence, and a line led by a third-person pronoun with no antecedent on the card.
The derivation then falls to the next sentence of the same evidence-backed text that clears the bar, and a stored line that opens on such a note falls to its own next usable sentence, or to no card when it has none.
When no sentence fits whole, the lead sentence of the body, if the bar refuses it for length alone, is cut at a clause boundary (a semicolon, a non-restrictive or restrictive relative clause, an including or such-as tail, a trailing participial phrase, a time phrase or a parenthesis) into a complete line under the cap.
A cut is refused when it would end on a function word or a short comma tail, fall under ten words, or lack a finite verb outside its comma-set clauses and parentheses, and a sentence refused for anything besides its length, such as first person, an incomplete sentence or administrative text, is never cut.
Only the lead is cut, because a cut later sentence measured as eligibility rather than an offer.
A dedication sentence ("is named in honor of") stays admissible, because refusing it promoted a biography sentence about the honoree to the card.
Calibrated through `searchProgramsController` over all 170 served programs on Development, 137 of them fellowships: 15 served cards changed and each was read against its source page.
Eight administrative-note cards were replaced by the program's own offer sentence, six programs that served no card gained a cut lead sentence, and one administrative-note card was withdrawn with nothing usable behind it.
None misleads; the weakest is a dedication sentence that names the program as undergraduate research assistantships.
Programs serving a card summary went from 152 to 157 of 170, and fellowships from 122 to 127 of 137.
The 13 that still serve none have no admissible sentence: a lead with no clause boundary under the cap, a bare application announcement, first-person copy, or a glued unterminated lead.

## 2026-10-04: Login Counts Personalization Signal Coverage In Aggregate Only, Until The Personalization Decision (#4744)

Personalizing default `/research` browse from the Yalies major, or a graduate curriculum, is only worth building if enough signed-in students carry that signal, and that share is unknown.
A Yale College major is declared late, a major hidden in the source directory is absent from Yalies, and a record marked leave or visitor carries nothing usable.
Development cannot answer it, because a Development login skips CAS and never calls Yalies.
Decision: each CAS login classifies its Yalies lookup into exactly one bucket and increments a per-UTC-day counter in `login_signal_tallies`.
A login Yalies has no record of is counted apart from a known faculty or staff login, because it may be a student hidden from the directory, so the report can show how large that unknown share is.
The row holds the date and integer counts only, with no netid, account id, major, curriculum or time finer than the day, so the #4162 rule that login stores no major is unchanged: the major is read inside `yaliesService.ts` and only its bucket label leaves.
A tally write never blocks or fails a login.
The collection is environment-local and is read with `yarn --cwd server auth:login-signal-tally --environment=production --from <date> --to <date>`.
It measures nothing until it reaches Production by promotion, and the reading is taken over the two weeks after that.
The report shows a bucket only when the range holds at least 3 logins in it, the #4159 threshold, and leaves a smaller bucket out of every total and share, so the reading cannot single out a student; it never prints a per-day row.
Once the personalization decision is made from that reading, the tally, its collection and this entry's mechanism are removed.

## 2026-10-04: A Thin Description That Is Accurate Serves Whatever Wrote It (#4766)

This supersedes the #4763 entry below: the thin-but-accurate relaxation no longer depends on who wrote the body (maintainer decision, confirmed in two sessions).
In the maintainer's words, "it is unfair to block thin description when it is accurate and has a lot of the information we have", and "the reason for thin description is that truly we don't have more information".
So a true but thin line serves at the gate and on the served page whatever its source, including a language-model line, a body with no recorded source, and the pipeline's own "Studies <topics>." sentence when it is the row's only body.
The bar is accuracy rather than authorship.
A line that is wrong, misattributed or not about the row still holds it, through the blockers that already judge accuracy: another person's profile (`profile_identity_risk`), a body about another organization, a name that names something else, a line that states no research, page fragments, chrome and label lists.
The relaxation lifts only the thinness flags (`too-short`, `area-echo-fallback`, and `topic-label-list` on a sentence that leads with a research statement), and write paths keep the strict verdict, so lanes still prefer richer prose.

One shape is inaccurate as a class and stays held: the "Studies <A>, including <B>, and <C>." sentence, which asserts that the other topics are part of the first (`isStudiesSentenceNestingTopicsUnderTheFirst`).
Measured on Development on 2026-10-04 with same-moment dry-run gate plans over all 4,234 research rows, against `beta` after #4768: this decision serves 47 rows that `beta` holds only because of the #4763 source check, demotes no served row, and keeps held 9 nesting sentences that `beta` would release.
All 47 carry a language-model body (33 and 12 from the two microsite lanes, 2 from the faculty profile synthesis lane), and all 47 were read by hand against their cited pages: 47 accurate and about the row, 0 inaccurate, 0 fragments.
An earlier read of the rows the #4768 shapes plus this decision release found the nesting sentence false on 7 of the 9 rows that carry it, all from the faculty roster lane, which is why that shape stays held; the other 2 were accurate and return when the roster lane writes a flat list.
The hand-reads also found released rows whose subject holds a current appointment at another university; that is a presence question for the activity lanes, not a description one, and this decision does not change it.

## 2026-10-04: The Echo Rule Holds A Language-Model Body And Not An Official One (#4756, #4763)

Superseded on 2026-10-04 by "A Thin Description That Is Accurate Serves Whatever Wrote It (#4766)" above: the provenance condition is removed and accuracy is the bar.

The #1664 echo rule holds a research body that adds fewer than about 4 words beyond the row's own topics.
#4481 closed on keeping it as it was, #4704 then relaxed it at the gate and the served page for every thin but accurate body, and this decision narrows that relaxation to a body an official or human source wrote (maintainer decision, landed in #4763).
An official or human body is one whose `fieldProvenance.fullDescription.sourceName` is present and is not a language-model lane, such as a faculty directory profile, a lab's own page with no model in between, or an operator edit.
A body a language model wrote keeps the echo rule whatever its grounding grade, because a GROUNDED grade does not tell the "Research focuses on topics including A, B, C" template apart from a body that says something.
A body with no provenance also keeps the strict verdict, so an unattributed body cannot earn the exemption by its absence.
The language-model set is `isLlmAuthoredSourceName`, which a test pins to every seed source whose display name says LLM, so a new model lane is held without an edit here.
Write paths already read the strict verdict and are unchanged.

The maintainer's read-only measurement on Development found 50 rows held by the echo rule alone: 2 official or human bodies, both accurate; 18 model bodies graded GROUNDED or REWORDED, mostly the template, of which only 6 add anything beyond the chips; and 30 model bodies ungraded or UNSUPPORTED.
Re-measured with same-moment dry-run gate plans over all 4,233 research rows on 2026-10-04, 44 rows were served only because of the #4704 relaxation: 42 carried a body from a language-model lane and 2 a faculty directory body.
Under this rule served rows are +2 against the strict rule, against +44 under #4704, and no other row moves.
The cost is the handful of model bodies that do add a little beyond their chips; they return when a description lane writes a fuller body, through the normal gate.

## 2026-10-04: A Multi-Purpose Fund Is Served When Its Own Page Names Research As An Eligible Use (#4675)

A fund that pays for research among other uses, such as study, language, internships or travel, is research-relevant when its own page text (description, eligibility or summary) names research as an eligible use (owner decision).
It stays withheld when research appears only in the purpose tags, when its text disclaims research ("non-research projects", "may not be used for research"), or when another hold applies: a duplicate copy, a prize for completed work, a stale cycle, a suspension or a listing page.
The statement has to name research as a use: research expenses, costs, travel or trips, a fund, grant or award used for research, or conducting research.
A bare "for research" with no usage word before it does not count.
Research named as an outcome ("language study that can support research"), as an applicant interest ("students whose work or research involves") or as prior experience does not count, which keeps the #4291 language-study rule intact.
The rule lifts the non-research title and language-study facet holds and the purpose-facet hold of #3904, and nothing else.
Measured on Development on 2026-10-04 over all 534 live programs: 238 were held as non-research, 9 of them with a research value in `purpose`.
The rule as merged changes the tier of 1 program, read on its live page: a summer research and language study grant open to undergraduates, with an upcoming deadline, becomes `student_ready`.
The draft rule also matched a bare "for research", which moved a travel fund to `limited_but_safe` and removed the non-research reason from a postgraduate fellowship that a stale cycle holds anyway, and requiring a usage word dropped both.
The other 8 stay withheld: their text names no research use, it disclaims research, they are a duplicate or a prize for completed work, or, in one case, the stored blurb was copied from a sibling grant and names research only as an applicant interest.
Applied on Development the same day, served programs went from 170 to 171 and served fellowships from 137 to 138, the added row being that grant.

## 2026-10-04: The Site Stays Out Of Search Engines, And Link-Preview Fetchers May Read It (#4241)

Search engines stay out of y/labs for now, so `client/public/robots.txt` keeps `User-agent: *` / `Disallow: /` and `client/index.html` keeps `<meta name="robots" content="noindex, nofollow">`.
Indexing waits for two things a public index would need first: a way for a researcher to be removed from the directory (#4160), and a per-page title, description and canonical URL in the served HTML (#4240).
Students mostly reach research through links posted in group chats and on social sites, so the link-preview fetchers are allowed: `facebookexternalhit`, `Twitterbot`, `LinkedInBot`, `Discordbot` and `Slackbot-LinkExpanding` each have their own `Allow: /` group.
Under RFC 9309 a crawler obeys the most specific group that names it and ignores `*`, so the named groups open nothing to a search engine.
A preview fetcher builds a card rather than an index, and the `noindex` tag keeps any page it reads out of one regardless.
Slack documents that `Slackbot-LinkExpanding` does not honour robots.txt at all, so its group records intent rather than changing its behaviour.
`client/src/__tests__/crawlerPolicy.test.ts` pins both halves, so an edit cannot silently open the site to search engines or close it to previews.
A future change that indexes part of the site must lift the `Disallow` on any path it keeps `noindex`, because a crawler refused by robots.txt never fetches the page and so never reads its `noindex` tag, and a refused URL can still be listed from outside links.

## 2026-10-04: A Lead Who Moved Institution Is Operator-Reported, Because ORCID Asserts No Relocation (#4614)

The departure class students meet most is a lead who moved to another institution, and every Yale-derived signal reports that row as present, so the departure lane's ceiling for it is 0.
ORCID was the candidate off-Yale source, and its bar was fixed before measuring: build a lane only if, over a seeded sample of 50 served leads that carry an ORCID id plus every served lead with an ORCID id and no probeable Yale profile link, it returns an employment record for at least half, and every relocation it asserts is confirmed by hand on the new institution's own page.
Measured read-only on Development and the public ORCID API on 2026-10-04: 3,455 served leads, 1,815 with an ORCID link, and none of those without a probeable Yale profile link, so the sample was the 50 seeded leads.
31 of 50 returned any employment record, which clears the first half of the bar.
11 of 50 carried either a current non-Yale employer or an ended Yale employment, and 0 of those 11 is a relocation: 9 still list a current Yale employment in ORCID itself, and the other 2 list no Yale employment at all while their Yale profile still answers 200 and names a current appointment, one of them an adjunct.
No record combined an ended Yale employment with no current one and a current non-Yale employer, so ORCID asserted no relocation for hand confirmation, and a lane reading the broader shape would have suppressed 11 present people.
So no ORCID relocation lane is built.
A relocated lead is recorded by an operator with `yarn --cwd server research-entity:record-departure` (#3477), and an off-Yale source is reconsidered only with a measurement that finds asserted relocations it can confirm.

## 2026-10-04: Five Access Signal Types Are Retired; A Lab's "No" Is Never Served (#4637)

Owner decision: `REACH_OUT_PLAUSIBLE`, `CONTACT_INSTRUCTIONS_EXIST`, `NOT_CURRENTLY_AVAILABLE`, `FELLOWSHIP_COMPATIBLE` and `COURSE_CREDIT_PATHWAY` are retired.
Reaching out is the universal action, so a signal that only says contact is plausible, or that a contact is listed, tells a student nothing they would not do anyway.
In a hand-labelled sample of 60 non-boilerplate lab-microsite `REACH_OUT_PLAUSIBLE` and contact excerpts, about 14 were real undergraduate invitations.
A lab's own "not taking undergraduates" is never served, because it can deter an email that may still succeed.
It survives only as the lane's verdict observation, and a join-page claim is minted only beside a "yes" verdict, so such a lab is never offered a "See how to get involved" button.
`FELLOWSHIP_COMPATIBLE` restated `PAST_UNDERGRADS` from the same field.
Course credit is retired with the rest; the department lane still records its observations, so it can return as a sourced department fact if a lane collects it at real coverage.
The kept types are `CURRENT_UNDERGRADS`, `PAST_UNDERGRADS` and `APPLICATION_FORM_EXISTS`, plus the dormant independent-study and posted-opening producers.
Stored rows of the retired types are archived by `archive:legacy-access-signals`, and the type list no longer admits them, so no reader counts or serves one in the meantime.

## 2026-10-04: The Absence Of A Signal No Lane Collects Is Never A Reason (#4574)

A gate reason, a repair task, or an operator-board blocker may record only the absence of something a lane collects.
`missing_action_evidence` and its inverse `concrete_next_step` failed that test: no lane collects a way in as a fact, so the pair measured only whether some access signal happened to exist.
Both are removed, which carries out the access-plausibility retirement in the 2026-08-25 "Simple Directory First" decision.
The harm was not on the served surface, because the reason was soft, but in the work it generated: the repair queue's `action_evidence` stage minted boilerplate `REACH_OUT_PLAUSIBLE` signals to clear it, and the operator board listed it as a blocker.
That stage is removed, and the queue no longer writes access signals; stored queue items keep the `action_evidence` stage value as history.
Measured on Development on 2026-10-04, the reasons sat on 2,940 and 1,468 non-archived research rows, and every `action_evidence` queue item was already resolved or suppressed, with none open.
`missing_alternate_access_path`, `missing_facet_signal`, `missing_application_route` and `missing_source_route` stay, because each measures something a lane collects.
`hasActionEvidence` still feeds the shell-suppression predicates, so suppression is unchanged.
An extra signal remains welcome as a badge or a citation.

## 2026-10-03: A Profile Synthesis Body Is Withdrawn Only When Its Pages State A Career (#4561)

`fra-profile-research-synthesis` now re-reads every row whose stored body it wrote and withdraws that body when complete reads of all candidate pages carry no admissible research prose, list no publication, and narrate the posts the person held.
Its snippet selector also refuses publication records and career-history sentences, so a new body can no longer be built from either.
Before this, a row whose synthesized body read as research left selection for good, so no fix to what the lane admits ever reached a body an earlier run had written.

The withdrawal is deliberately narrower than "the current lane would not write this body".
Measured on Development on 2026-10-03, 715 non-archived rows store a body with this lane's provenance and 643 of them serve.
A stratified random sample of 66 served bodies, each read against its live profile page, found 60 correct, 4 thin but accurate, and 2 wrong, about 3 percent (95 percent interval 1 to 10 percent): both wrong bodies read a practitioner's or an administrator's past posts as research.
With the new guards, 85 of the 715 rows have pages that yield no research snippet at all, and reading them, most hold a correct body built from the person's own publication feed.
The feed cannot tell those from a namesake's papers, which is the other shape #4561 found, so withdrawing on absence would hide real people to remove a handful of wrong bodies.
A namesake's feed is therefore an operator judgement on one row (`research-entity:refuse-field-value --rule=not_this_rows_research`), not a predicate.

The career rule plans 3 withdrawals over the 715, and all 3 were read and are wrong: two policy or program staff whose career biographies became research claims, and one administrator whose former job became a research program.
Residue recorded rather than chased: a practitioner's page whose duties read as investigations ("investigations of claims of factual innocence") keeps its body, because `investigat` is research vocabulary, and bodies that narrate the page itself ("as evidenced by the publication", "documents frequent co-authorship patterns") are a description-quality shape rather than a lane withdrawal.

## 2026-10-03: A Program That Is Not A Current Program Is Not Served (#4587)

A hand-read sample of served programs on Development found 12 rows that are not a current program a student can apply to, and the gate had no input for any of their shapes.
Each class is now a predicate in `server/src/services/programApplicability.ts` that the gate reads on every run, so it writes no field and needs no lock, and a row returns on its own once its evidence changes.
All four suppress, recorded with their own reason.

- **An outside program whose office record skipped its only stated cycle: `external_award_cycle_stale`.**
  The fellowships office lists outside programs under `funding.yale.edu/external-award/`, a section it no longer keeps current, and outside programs are out of scope except as Yale points students to them (2026-08-23).
  A record there whose deadline is stale by #4363's rule, closed more than a cycle ago with no upcoming window from another copy, no longer shows Yale pointing students to a current cycle.
  Measured on Development on 2026-10-03: 115 live programs carry a stale deadline, 113 of them external-award records; 9 were served, every one an outside program (a federal summer research fellowship, a federal undergraduate scholarship, the federal REU listing, a federal postbaccalaureate training award, three terms of a federal laboratory internship, a children's hospital summer program, an overseas PhD scholarship), and their last stated cycles closed 2.7 to 6.7 years ago.
  No second threshold is needed: every number from one cycle to 2.7 years drops the same 9 rows, so the existing one-cycle rule is the threshold.
  A Yale-administered fund whose own page skipped a cycle is not held, because its stale date is already withheld at serve time and the fund itself still recurs; the only 2 such rows (two Yale College fellowships last stated 1.6 years ago) were already suppressed for other reasons.
  Several of the 9 programs still run on their own sites; they leave because the office record is the only reason they were on `/programs`, not because the program ended.
- **A record stating that its award is suspended: `award_suspended`.**
  A sentence naming the award and saying it is suspended, discontinued or no longer offered, read conservatively: a conditional clause in the award's terms ("payments will be suspended if") and a statement that the award resumed do not count.
  Calibrated over the prose of all 597 program rows and 2,520 live program observations on Development, it matches exactly 1 row, a global scholarship for Oxford study whose page says its trustees suspended the award with immediate effect, which was served with a projected next-cycle deadline; a looser phrase list's only other hits were rules inside award terms and "endorsement is no longer required".
- **A prize for completed work: `prize_for_completed_work`.**
  A record titled a prize whose prose states no support for work still to be done (no support, funding, travel, stipend, expenses or project), because a prize for an essay or a book is recognition rather than something a student joins.
  A record with no prose is not read either way.
  Over the 12 live rows titled a prize it matches 5: the served one, an essay prize competition for graduating Yale College students, and 4 already suppressed (its graduate twin, two essay prizes and a leadership prize).
  The three travel prize rows and the three prize rows with no prose do not match, and neither does a faculty book prize whose prose names what it funds, which is already suppressed as non-research.
- **A catalog page listing programs: `program_listing_page`.**
  A title made only of generic funding words ("Grants to Students") that routes to two or more pages on its own site.
  Either half alone is not enough: 5 live rows have an all-generic title, 2 of them real programs with generic names, and 28 non-suppressed rows route to two pages, nearly all a fund page beside an application form.
  Together they match 1 row, a council's grants page whose two listed programs are each served as their own row and stay served.

Program duplicates (#3988) gain two narrow joins.

- **A narrower title over the same description.** One lane titles a fund "<name> Travel Fellowship" and another "<name> Fellowship" over the same paragraph and the same catalog page, which the one-lane guard of #4279 rightly refuses to join on.
  Two rows now join when their descriptions are one fund's by the existing test and every word of one title is in the other, unless the narrower title sits inside two titles that do not name one fund, so a generic title never chains residential college copies together.
- **The terms of one program.** A trailing term qualifier ("- Fall Term", "(Summer Term)") is set aside when titles are compared, so sibling records for one program's terms join, and a hidden copy for another term never supplies the kept copy's upcoming window, because the kept copy's title names its own term.
  Over all 532 live programs the two joins add exactly 4 redundant copies and remove none: the travel fellowship served once from each lane, two of the laboratory internship's three terms, and an unserved postgraduate fellowships page joined to its unserved common application.

Measured through the gate and the reader payload on Development on 2026-10-03, served programs go from 181 to 168: the 9 stale external records, the suspended scholarship, the essay prize, the listing page and the second copy of the travel fellowship, each hand-read from its stored text, and no row is added.
The two programs the listing page names, the kept copy of the travel fellowship and the two served external-award records with a current cycle stay served.
Six unserved external-award rows move to `suppressed`, and 102 already-suppressed rows gain a reason only.
Both program lane benchmarks are unchanged, because no lane output changed.

This is a stored-data change: rows move only when the program gate is applied on Development.

## 2026-10-03: A Survivor's Complete Read Re-Reads Evidence Filed Under Its Merged-In Keys (#4568)

This reverses one bullet of the 2026-09-28 #3609 entry below, which held that a survivor-key read never retires loser-keyed evidence.
A source that now reads the survivor never reads the merged-in key again, so matching reads by the exact key an observation was filed under judged that observation `source-has-not-reread` forever, and no evidence could ever retire it.
A merged-in key's state is already the survivor's (#3560), so a complete read of the survivor by the same source is that source's current statement about what the observation backs.
The #2647 concern that silence is not absence one key over still holds, and it is met by the guards rather than by the key: a retraction still needs the read to assert absence of the field, so a survivor read that is merely silent stays `absence-not-witnessed`, and the drop guard and the liveness screen are unchanged.
The sharing runs one way only: a merged-in key's read is never given to the survivor or to a sibling merged-in key, so a duplicate's absence claim never judges the survivor's own evidence.
Measured as a dry run on Development with this one-way rule, `dept-faculty-roster` observations judged not re-read fell from 1,368 to 1,336 and retractions before the liveness screen rose from 38 to 41, with none newly retained after it; sharing reads between sibling merged-in keys as well would have moved 145 and retracted 29 more, which is the cross-page risk the one-way rule refuses.
Most of the 873 `dept-faculty-roster` website observations on archived keys are re-read only under another archived key, because the lane still files new reads under stale slugs, so the remaining population belongs to the lane's key choice rather than to retraction.
The field-retraction section of [`research-data-pipeline.md`](research-data-pipeline.md) owns the mechanism.

## 2026-10-03: A Merged-In Row's Type Backs A Survivor's Matching Type, And Never Restates It (#3381)

A merged survivor's `entityType` stays survivor-owned, but a survivor with no `entityType` observation of its own now resolves its stored type from a merged-in row's observation of the same type, read through `mergedRowEvidenceIdentity`, so the served type rests on evidence and records it in `fieldProvenance`.
A merged-in type that contradicts the survivor's is still dropped, because the merge itself decided who the survivor is: an eponymous faculty research profile merged into a lab is evidence the lab exists.
Measured on Development on 2026-10-03, 627 of 3,464 served rows had no live `entityType` observation on their own key or id.
For 448 a merged-in row carries one; on the commit before, none of the 448 resolved a type, and with this rule 445 resolve the type they already serve, so no served type changes.
The other 3 are labs whose only type evidence is a merged-in profile's contradicting type.
Those 3 and the 179 served rows with no live type observation on any key and none ever filed on their own (162 `FACULTY_RESEARCH_AREA`, 16 `LAB`, 1 `CENTER`) are not fixable by derivation: no lane observes their type, and stamping the stored value as an observation would manufacture evidence.

## 2026-10-03: Design And Instrument Practice Are Creative Practice, And A Practice Biography Is Not A Description (#4551)

Three of the rows #4388 would newly serve were wrong for reasons the lead mint does not cause, and each is a serve-time predicate gap.

- **Design practice and an instrument's practice are creative practice evidence.**
  `creativePracticeDescription.ts` gains a `design` kind (typefaces, type design, typography, lettering, graphic design, book design, brand and visual identities) and an `instrument` kind (a named instrument, brass, woodwinds), and its practitioner arm reads founding or directing a named studio, foundry, collective, ensemble, press, gallery or company.
  A practitioner presenting "his story and research at design conferences" is giving a talk about the practice, so that phrase is no longer a research statement.
  The two-kinds rule and every research exemption are unchanged, so a design historian, an acoustics study of the organ and a single design mention stay research.
  The `role-biography` escape does not count either new kind, because organ, brass and brand identity have ordinary meanings outside the arts, so an administrative biography that mentions an organ transplant program is still refused.
- **A practice biography with no research is not a description.**
  `isPracticeBiographyWithoutResearch` in `descriptionNonResearchBodyShape.ts` reads a body that says where a clinician or a lawyer practises and what they treat or whom they represent, and states no research, publication or teaching, and the quality bar flags it `practice-biography`.
  Clinical practice is neither research nor creative practice, so a row whose only body is this names nothing a student could join.
  It is read on the body only, because a clinical card beside a research body is a card defect rather than a row without research, and its research test is case-insensitive so a capitalised "Research Fellowship" or a named grant keeps the body.
- **A practice card never opens on a glued profile header.**
  The labelled row's replacement card skips a sentence carrying header chrome the extractor glued onto it ("Graphic DesignUndergraduate Senior Critic Instagram").

**Measured on Development, 2026-10-03.**
Over every non-archived row's stored body and card, the predicates changed 4 rows: 2 bodies flagged `practice-biography` (both clinical practice biographies stating no research) and 2 rows newly labelled creative practice (both graphic or type designers).
Through `getResearchGroupDetail` over all 3,464 `student_ready` rows with the old and new code, 2 rows changed and both were read: one clinical practice biography stops serving, and one graphic designer is labelled creative practice with its research-voice chip card replaced by a practice sentence.
Served rows went from 3,459 to 3,458 and labelled rows from 30 to 31; no other served body, card, name or type changed.
Of the rows #4388 would newly serve, the performer and the type designer are now labelled creative practice and the clinical practice biography is refused.

The predicates err toward keeping research.
A clinical biography that also names a centre, a fellowship or any study keeps its body, so a clinician whose body states only "cares for patients" once still serves; that is recorded rather than chased.

This is a serve-time change for the label and a serve-time and stored-data change for the refusal: browse and detail recompute both on deploy, and the stored tier follows when the gate re-runs on Development.

## 2026-10-03: Role Biographies, Another Organization's Page Text And Education Programs Are Not A Description (#4528)

Three body shapes passed the description quality bar and served as a row's description although none describes the row's research or practice.
`nonResearchBodyShape` in `server/src/utils/descriptionNonResearchBodyShape.ts` names them, and the quality bar reads each as its own flag for both the body and the card, so the serve path, the materializer's candidate ranking and the gate all refuse the same text.

- **`role-biography`**: a teaching-only or administrative biography that states no research, no creative practice and no clinical work, such as a career office director, a language lector or a diversity office lead.
  Any research or care word, a faculty rank, or one kind of creative practice evidence keeps the body, because refusing a real research biography costs the row.
  The one exception is a career narrative whose every sentence is a past post or a degree and that names no current research, expertise or professorship: it is refused even when a research or care word sits inside one of those posts, because that word describes the old job (#4722).
  The research test is lower case on purpose, so a department name ("Africana Studies") is not read as a statement that the person studies something.
- **`third-party-page`**: another organization's page text, meaning a call for submissions with its usage terms, an event's own page, or a site's section blurbs ("Highlights of ...", "Lists of ...").
- **`instruction-offering`**: an education program's description, whose subject is the instruction it offers ("classes focus on", "hands-on lessons"), so a row carrying it as a lab names a course rather than a group a student could join.
  A research statement (a research, investigation, experiment, laboratory, scientist or publication word) keeps the body, so a research core that also trains its users is not read as a course.
  The wider research-or-care test is not used here, because an education program's own prose says "classes focus on".
  Only a `LAB` row is refused for it: a core facility's or a center's training and workshops are its own service, so those rows keep the body.

The research test reads every sentence with only its first letter lowered, so a research claim that opens a later sentence ("Research in the group ...") keeps the body as well.
`third-party-page` takes no research exemption, because its shapes are structural and the calibrated cases carry research words of their own (a funding agency's section text names research, and a call for artists says "interested in collaborating").

Measured on Development on 2026-10-03 by walking all 3,470 served rows through `getResearchGroupDetail` and the browse route with the old and new code: 5 rows stop serving, because the serve path recomputes the bar and their only body is refused.
All 5 were read and are wrong for the row: a language lector's teaching biography, a career office administrator's biography, an exhibition's event page, and one call for artists on two rows.
No other served body or card changed.
Of the 32 rows #4388 would newly serve, 3 are refused and all 3 are wrong: an education program filed as a lab, a funding agency's site section text, and a diversity office director's biography.

The predicates err toward keeping a body, and the residue is recorded rather than chased.
Four administrative biographies in an arts school stay served as research because each names a theatre or performance context or a research word; one person-scoped row serves an education center's mission statement, which the organization-subject rule (#2911) does not read as another organization's subject; and one design educator's biography mentions research at conferences.

This is a stored-data change as well as a serve-time one: browse and detail stop serving the refused bodies on deploy, and the stored tier follows once the gate re-runs on Development.

## 2026-10-03: Arts-Practice Faculty Rows Are Served And Labelled Creative Practice (#4519)

Owner decision: a faculty row whose own evidence describes creative practice rather than research is served, not withheld, and it is labelled "Creative practice" instead of research.
Students interested in art need a way in to the people who make it, and a directory that drops every performer, composer, playwright and studio artist leaves them none.
The defect #4388 measured was never the field itself: it was a performance or exhibition biography presented under "Research summary", a "Faculty Research" pill and a "Principal Investigator" heading, which tells a student there is a research group to join when the page describes a career in practice.
So the fix is an honest label, not a withhold.

It is a serve-time derivation in `server/src/utils/creativePracticeDescription.ts`, computed once in the public DTO from the row's served body, so the detail page, browse, search and related cards read the same answer, and no field is written or locked.

**The predicate.**
A row is creative practice when four things hold.
It is person-scoped by `isPersonScopedResearchEntityShape` in `server/src/models/storedVocabularies.ts` (a `LAB`, `FACULTY_RESEARCH_AREA` or `FACULTY_PROJECT` row, a legacy person type, or a typeless row whose `kind` is a person kind), because a lab in an arts school named after one artist is that artist's practice, while a `CENTER`, `INSTITUTE`, `INITIATIVE` or `CORE_FACILITY` is an organization and is never labelled.
Its department (Music, Art, Architecture, Film and Media Studies, Theater, Dance, and Performance Studies, English Language and Literature) or its school (the music, art, drama and architecture schools, the Institute of Sacred Music) places it in an arts context.
Its served body, or its card when no body serves, states at least two kinds of practice evidence among exhibitions, performances, compositions, productions, creative writing and a practitioner noun ("is a violinist", "as a playwright").
And that text states no research: a research, scholarship, musicology, theory, cognition, history-of, analysis, dissertation, journal or university-press statement keeps the row research, and so does a synthesized body that opens in the research voice ("Studies ...", "Examines ...").
An artwork in subject position ("work that examines memory") is an artist statement rather than a research claim, and the revoicer's "This researcher" placeholder is the pipeline's own wording, so neither counts.
Arts research that states a research question, such as music cognition, digital humanities, musicology or film history, therefore stays research.

**What a labelled row serves.**
The kind pill and the browse card read "Creative practice", the summary is headed "Practice summary" and "What this creative practice covers", the website action reads "Visit website", and a principal-investigator lead (`pi`, `co-pi`) is "Faculty" rather than "Principal Investigator", while a director lead stays "Director" and the lead section heading follows the same rule.
Nothing on the row claims a lab, a research group or an opening the page does not state.
An emeritus-led labelled row's current-activity notice reads "Emeritus faculty" and "this practice" rather than "Emeritus lab" and "this research".
A card in the research voice ("Studies chamber music.", or a sentence claiming the person studies something) contradicts the label beside it and is usually a chip summary the practice body never states, so `decideCreativePracticeCard` in `server/src/services/creativePracticeCard.ts` replaces it with the body's own first practice sentence, and withholds it when the body offers none, on the #2911 reasoning that a blank card line costs less than a false one.

**Measured on Development, 2026-10-03, through `getResearchGroupDetail` and the browse route over all 3,470 served rows.**
33 rows are labelled, and browse and detail agree on all 3,470.
Every labelled row was read: none states research, 30 are practice biographies of the row's own person (performers, composers, conductors, directors, stage managers, playwrights, poets, filmmakers and studio artists), and 3 serve another organization's page text (an architecture exhibition's event page, and one call for artists on two rows), which is a body defect the next change withholds rather than a mislabel.
Of the 32 rows #4388 would newly serve, 8 are labelled and all 8 are practice biographies.
On the 33 served rows, 18 cards are unchanged, 14 research-voice cards are replaced by a practice sentence from the row's own body (among them three chip summaries naming topics no practice body states, and one card describing a different person's medical research), and 1 is withheld.
The predicate errs toward research: a performer who also wrote a university-press book, a one-sentence body with a single kind of evidence, and an artist statement that calls itself research all stay research, because a practice label on a research row is the costlier error.

## 2026-10-02: A Merged Survivor's Evidence Reads Go Through One Identity, And A Lane's Newest Read Wins Across Its Keys (#4418)

The materializer evidence reads that reach the keys and ids of rows merged into the one being resolved now share one identity, `scrapers/mergedRowEvidenceIdentity.ts`: the merged survivor read and its award union, the topic evidence read, and the never-backed provenance check and relink.
The entry read and its two complement reads, the row-keyed contact filter, the lead school inheritance read, and the access signal read stay row-only by design and do not go through it.
An integration test drives the materializer over evidence filed only under a merged-in key.
Two reads did not: the never-backed provenance check and the provenance relink asked only the row's own key and id, so a lane that observed a field only under a merged-in key read as never having observed it.
Two field rules inside the merged read were also wrong, measured on Development after #4413 and #4425.

- **A fallback-only lane does not hold a field against a merged-in row.** A merged-in row may fill only a field the survivor does not hold (#3581), and a survivor whose only own `researchAreas` came from the graduate-track roster lane held the field, so the merged-in row's profile list never reached the resolver that #4413 taught to rank it first.
- **An award list unions across lanes, not across one lane's reads on different keys.** Every other latest-wins field already took the newest same-lane read whichever key it was filed under; the grant lists unioned instead (#3221), so a pre-#4425 NIH read on a merged-in key re-added each award once per fiscal year beside the survivor's corrected read.
  The union now stops at the row the newest read was filed under.
  This is a resolution rule, not a retirement: the merged-in key's observation stays live and is history, and a survivor-key read still never retires it.

A whole-corpus dry run on Development on 2026-10-02, against the same projection on the commit before, planned changes on 20 rows' `researchAreas`, every one from the graduate-track list to the row's own list, and on 83 rows' `recentGrants`.
76 of the 83 drop a fiscal-year repeat of an award, 70 of them `student_ready`, and 7 drop National Science Foundation awards that had already ended, which the served list withholds anyway (#4009).
One of those 7 keeps a repeat because its newest NIH read itself predates #4425, which a re-run of that lane fixes.
The never-backed provenance and relink change planned no change on any row.

## 2026-10-02: The Tailwind 4 Upgrade Renders Exactly What Tailwind 3 Rendered (#4386)

The client moved from `tailwindcss` 3 to 4 (part of #4038), and the upgrade was held to no visual change, measured by before and after Playwright screenshots and computed-style diffs of the student and operator surfaces.
A deliberate visual change belongs in its own reviewed PR, not inside a dependency bump.

Decided:

- **Tailwind runs as the `@tailwindcss/vite` plugin, and the theme lives in CSS.**
`tailwind.config.js`, `postcss.config.js`, and `autoprefixer` are gone; the `--yr-*` aliases are an `@theme inline` block in `client/src/index.css`, so a utility compiles to the token variable itself.
- **Tailwind 3's generic palette and line heights are restated rather than adopted.**
`client/src/tailwindPalette.css` pins every generic hue to its Tailwind 3 hex value, and `index.css` pins the `text-*` line heights to Tailwind 3's absolute values.
Tailwind 4's oklch palette and ratio line heights each shifted rendered pixels on the categorical scales and on any element pairing a `text-*` step with an arbitrary size.
A `leading-*` class also now outranks a responsive `text-*` step, so the headings and intros that rendered with the step's own line height state it with a matching responsive `leading-*`.
- **The Tailwind 3 preflight defaults that Tailwind 4 changed are kept in `@layer base`**: the default border and ring colours, the placeholder colour, the button cursor, the form-control font and background, and the search-field appearance.
The navigation's `!border-b-2` underline never rendered under Tailwind 3, because MUI's `border: 0` reset its style, and Tailwind 4 would have drawn it, so those classes were removed rather than shipped as an unreviewed design change.
- **Two Tailwind 4 behaviours were kept, because neither changes a desktop render.**
`hover:` applies only under `(hover: hover)`, so a tap on a touch screen no longer leaves a sticky hover state.
`space-*` and `divide-*` now space every child but the last with a trailing margin or border, which renders the same on every captured surface; the one filter list whose first child is a visually hidden legend takes an explicit `pt-1` to keep the leading gap it had.
- **The class scanner does not split a class from an interpolation that touches it**, so `` `row-start-1${...}` `` generates no rule; keep a space before `${`.
`client/src/__tests__/classScannerGuard.test.ts` fails on any such class.
- **The browser floor is Tailwind 4's**: Safari 16.4, Chrome 111, and Firefox 128.
`index.css` already required `color-mix`, so the floor moved by about one Safari minor release.

Reverting any pin is a visual change and is reviewed as one.

## 2026-10-02: Research Led By Emeritus Faculty Is Labelled And Claims No Way In Without Current Activity (#4431)

Owner decision: a research row led by emeritus faculty stays served and its tier is unchanged.
Its lead is labelled Emeritus on the browse card and the detail page, and the row claims no way in unless evidence keyed to the row shows current activity.
This refines the 2026-09-22 refusal below rather than reversing it: emeritus is still not a visibility signal, and it now decides what a served row may offer.

It is a serve-time derivation in `server/src/services/emeritusLeadWayIn.ts`, and no field is written.

**Emeritus-led.**
A person's own served title holds only emeritus appointments when it names a faculty appointment as emeritus (professor, lecturer, lector, scholar, scientist, faculty) and names no active faculty or research appointment beside it.
"Professor Emeritus and Senior Research Scientist" and "Professor Emeritus of Law and Professorial Lecturer in Law" are therefore not emeritus, because the title states current employment in the person's own words, and "President Emeritus and Sterling Professor" is not either, because only an office is emeritus.
A trailing "Emeritus" set off from the appointment ("Professor of History, Emeritus") qualifies every appointment in its clause; an affiliation ("Affiliated Faculty, ...") is neither.
"Emergency" never matches, and the word naming an institution ("Emeriti Association") is ignored; no named chair or prize in the corpus uses the word in another sense, measured over all 437 researcher titles containing `emer`.
A row is emeritus-led only when it has a lead and every lead passes, so a row co-led by an active lead, or by a lead with no title, is not.
The person-level label still appears beside an emeritus co-lead on the detail page, because it is a fact about that person.

**Current activity.**
Two arms, both already stored and keyed to the row.
A running research award: a served award (`servedCurrentFunding`) whose end date has not passed, excluding NIH conference awards (activity code R13 or U13), which fund a meeting rather than research.
A current team: a non-lead member (postdoc, graduate student, undergraduate, staff) on a fresh verified official roster row, the roster the detail page already serves as current.
Undergraduate evidence is deliberately not an arm.
Every emeritus-led row carrying a `CURRENT_UNDERGRADS` signal or a stored current-undergraduate count was hand-read against its page, and four of six were wrong or stale: an alumni list, a department committee roster, a retired lead's homepage, and a members page last updated two years ago, with one more uncertain.
Re-admit it only after the undergraduate lanes are re-measured (#4430).
Observation recency is not an arm either, because the sweep re-reads every row, so it dates the crawler rather than the research.

**What is withheld.**
On a withheld row the detail payload drops the `CONTACT_INSTRUCTIONS_EXIST`, `REACH_OUT_PLAUSIBLE` and `APPLICATION_FORM_EXISTS` signals, the lead email, and `planningContext` and `waysIn`.
The client replaces the "How to get involved" block with "Current activity" copy and one link to the official page, and offers no apply, get-involved, directory, or email action.
`hasUndergradHostingEvidence` and its badge stay, because "Has hosted undergraduate researchers" is a historical fact rather than a way in; no browse filter offers a way in, and `hostsUndergrads` reads that same historical predicate.
The browse and search DTOs carry `emeritusLed` and `wayInWithheld` from the same derivation as the detail page, computed in the batched lead read.

**Measured on Development, 2026-10-02, through `getResearchGroupDetail` over all 3,459 served rows.**
235 rows are emeritus-led (216 faculty research profiles, 19 labs), 233 withhold their way in and 2 keep it.
On the 233, 250 way-in signals on 155 rows and the lead email on 205 rows are no longer served; no row outside the 233 changed its signals or email.
263 rows have a lead whose title contains the word; 28 of them are not emeritus-led under the rules above.
Browse over all 3,459 rows, eight search queries (764 rows), and the `hostsUndergrads` filter (136 rows) served the same two flags as the detail page on every row.
Both kept rows hold a running NIH R01: one lab page lists a current research team, and the other row's awards were confirmed running in NIH RePORTER.
Of 10 sampled withheld rows, 8 show no current group a student could join, 1 is a false withhold whose profile lists active appointments the stored title omits, and 1 holds an external directorship.
The gate dry run promoted 3,459 rows before and 3,460 after; the one difference is a row a concurrent writer updated between the two runs, and the gate reads none of this code.

## 2026-10-02: `dotenv` Loads Quietly, And Prettier Stays On 3.8 For Now (#4367)

`dotenv` 17 and later print `injected env (N) from .env` on every `config()` call unless `quiet` is set, including in deployed runtimes where no `.env` file exists, and 18 sends that line to stderr.
The server calls `config()` from about 230 modules, so every `dotenv.config(...)` call passes `quiet: true` to keep the silent behaviour 16 had; a new call should do the same.
`import 'dotenv/config'` is already quiet by default from 18.0.4.

Prettier is held at its exact `3.8.3` pin.
Prettier 3.9 rewrites the layout of multi-line union types, which reformats about 80 files that no dependency change touches.
Land that as a formatting-only change of its own once the other #4038 upgrades are in, so the churn does not collide with them.
That landed on 2026-10-03 as its own formatting-only change; `docs/dependency-decisions.md` records it.

## 2026-10-02: A Fund's Upcoming Deadline Is Served Even When Its Database Record Lists A Passed One (#4382)

When a program is served from its Yale fellowship database record (#4289) and another lane's hidden copy of the same fund states a still-upcoming deadline while the record's own deadline has passed or is absent, students see the upcoming deadline (owner decision).
The database record stays the served copy and the source for everything else.

Decided: the visibility gate, which already groups the copies of one fund, derives the earliest still-upcoming window among the kept copy's hidden copies on every run and stores it as `upcomingDuplicateWindow`, clearing it when it no longer applies.
It is not written over `deadline`, because the materializer rewrites `deadline` from the fund page on every run and the two would flip between stages.
Only a copy the gate would serve on its own can supply the window, and the window carries that copy's opening date only when that copy states one, because the opening date and the deadline are one statement of one cycle.
Serve time re-checks the window against the current time, so a window that passes before the next gate run falls back to the row's own deadline.

Measured on Development on 2026-10-02 before the change: one served program changes, STARS II, from a projected July 30, 2027 deadline reading closed to the January 4, 2027 spring deadline the fellowships-office page states, reading accepting; no tier changes.

This is a stored-data change: a served deadline moves only after the gate applies on Development.

## 2026-10-01: The Yale Fellowship Database Copy Of A Program Is The One Served (#4289)

When a program has a copy in the Yale fellowship database and another lane's copy, the database record is the one served (#4289, owner decision).

## 2026-10-01: The Yale Fellowship Database Is An Official Source (#4284)

The owner decided that the Yale Student Grants and Fellowships database (`yale.communityforce.com`) is an official source, so a fund's own FundDetails page is Yale's official record of that fund.

This reverses part of #3984, which read a database page as an application portal and never as an official source.
Under that rule a fund the database alone describes could not be served, and after #4214 enumerated all 286 funds the ones no other Yale page describes were held as `missing_official_source`.

Decided: the visibility gate no longer caps a row whose `sourceUrl` is a FundDetails page, the `student-grants-database` lane asserts its fund page as `sourceUrl`, and the materializer no longer ignores that observation.

One part of #3984 stays, because it is about stability rather than officialness.
On a row another lane owns, the database lane writes no identity field, and a fund page never replaces a program's own web page as `sourceUrl`, because the page that describes the program is the richer citation.
The first sweep without that guard moved 93 rows to new keys and demoted 111 served rows.

The decision makes the database official; it does not make every fund research-related.
The research-relevance, audience, application-route and description checks are unchanged, so a non-research fund in the database stays suppressed.
Measured on Development before the change, diffing the gate before and after on the same rows: 33 programs become `student_ready`, 20 of which already cited their fund page and were capped at `limited_but_safe`, and 13 of which had no source at all.
Four of the 33 are common applications rather than single programs, which is the non-program shape #4110 tracks.

This is a stored-data change: rows move only after the lane re-scrapes and the gate re-evaluates on Development.

## 2026-10-01: A Biography Description Is A Fallback Only (#4288)

The fixes for #3437 (#4262, #4281, #4283) newly served 26 Development rows, and most of them served a career biography ("received a PhD from ... joined Yale in ...") rather than research prose.
The serving check admits a biography, and it should: #4262 at first refused a row's only servable body because it was a biography, which took the row off the surface, and #4283 reverted that refusal (#4280).

Decided:

- **A biography is served only when no research prose exists for the row, and the row stays visible either way.**
  The `fullDescription` choice ranks research prose above a biography as derivation inside `projectFromLog`, so it runs on every resolve and writes no locked field.
  `adoptServableFullDescription` now also runs when the incumbent serves a biography: it adopts the first ranked candidate that passes the serving check, is not a biography, opens by stating research, and leaves the row's description pair passing the public-description invariant, and otherwise keeps the biography.
  The pair condition was added after delivery, when one Development row adopted a one-sentence research body identical to its own card, lost its card, and dropped out of `student_ready`; a body that costs the row its card is not admissible, so that row keeps its biography.
  It never trades one biography for another and never trades a biography for a body that states no research, because a publication list or an organization's chrome that happens to serve is not the research prose the preference is for.
  An incumbent that serves nothing keeps the #4281 fallback order: a servable non-biography, then a servable biography.
  A second resolve re-derives the same body from the same ranked list, so the choice converges.
- **The biography test is calibrated, not assumed.**
  `isBiographyRatherThanResearch` in `server/src/utils/biographyRatherThanResearch.ts` reads a body as a biography when its opening states career facts and its opening two sentences state no research.
  Hand-read on 169 served Development bodies in three stratified samples (49 biographies), the test #4262 introduced (`isHighConfidencePersonBio || isCareerBiographyDescription`) scored precision 28 of 63 and recall 28 of 49, and the narrower one #4283 ranked on scored 23 of 38 and 23 of 49.
  Every false positive was research prose that opens on an orienting role ("is a cardiologist whose research focuses on"), which is why a research statement in the opening withdraws the verdict.
  On the third sample, read before the last calibration pass, the new test scored precision 9 of 11 and recall 9 of 17, and after that pass 38 of 39 and 38 of 49 across all three; the misses are biographies whose opening names a research activity or that never state a career fact, so the residual errs toward keeping a biography rather than displacing research prose.
- **A row serving a biography is flagged, not held.**
  The gate records the soft reason `biography_description_fallback` when the served body is a biography, so it never blocks and is the cohort a research-prose lane should select on.
  The Corpus Quality panel counts it as "Serves a biography as its description", measured by `corpus:snapshot` over the same representation the gate reads.
- **The card follows the same preference.**
  The shared card resolver serves a research card derived from the body in place of a stored biography card when that derived card clears the gate's card bar, and keeps the biography card otherwise, so browse, detail and the gate read one line (#4100, #4127).

This is a stored-data effect, delivered by rematerializing the affected rows on Development and re-gating them; promotion carries it to Beta and Production.
The rows that keep a biography after delivery are not fixable by ranking, because no research prose exists in their evidence; they are counted by the flag rather than patched.

## 2026-10-01: Three Undergraduate-Access Fields No Lane Fills Are No Longer Served (#3579)

Five undergraduate-access fields were served on every research entity, and three of them were empty on every served row.
Measured through `POST /api/research/search` on Development, all 3,426 served rows: `undergradEvidenceQuote` non-empty on 260, `pastUndergradAdvisees` on 5, and `offersIndependentStudy`, `independentStudyCourses` and `typicalUndergradRoles` on 0 of the 3,417 rows that carried the key.

The question was whether a lane had the evidence and dropped it, because that would be a lane bug to fix rather than a field to stop serving.
It does not.
Across the whole observation log, superseded rows included and both identity forms counted, `typicalUndergradRoles` and `independentStudyCourses` have 0 observations.
`offersIndependentStudy` has 13, all from `course-based-research-pathways`, all keyed by `entityKey`, and all on archived `COURSE_SEQUENCE` rows whose stored value is already `true`, so the materializer wrote what the lane said and the rows are simply not served.
`undergradRoleEvidenceQuote` is the nearest live evidence, and it is a free-text quote rather than a role list, so turning it into role labels would be a new extraction lane, not a wiring fix.

Decided: the public projection (`OPTIONAL_PUBLIC_RESEARCH_ENTITY_FIELDS` in `server/src/services/researchEntityDto.ts`) no longer serves the three fields, and the client type no longer declares them.
The browse card's entity fallback no longer derives "Student project evidence" from the independent-study pair, because it was reading two fields that never held a value; the pathway arm that derives that badge from `FACULTY_SUPERVISES_STUDENT_PROJECTS` is unchanged.
The client rendered nothing for an empty field before this change, measured headlessly on a served detail page, so a student sees no difference; the change removes a payload that asserted three empty facts on every row.

`undergradEvidenceQuote` and `pastUndergradAdvisees` are served exactly as before: a simultaneous pre-fix and post-fix read of all 3,426 rows found 0 differences in either field or in `hasUndergradHostingEvidence`.

The stored fields and the `offersIndependentStudy` index stay, deliberately.
The access materializer still derives `CREDIT_FORMALIZATION_POSSIBLE` from `offersIndependentStudy` and `independentStudyCourses` observations, and `course-based-research-pathways` still writes the flag, so this is not a vertical with no producer the way the logistics enums were.
A lane that later fills one of these fields with evidence restores it by adding it back to the projection, with a measured served count, rather than by the projection waiting for it.

This is a serve-time change and reaches students on deploy; no data operation is required.

## 2026-10-01: A Contradicted Lab-Site Lead Keeps Serving, Because The Shipped Verdict Was Mostly Wrong (#3750)

`lab-site-lead-verification` records per lead whether the row's own website confirms or contradicts that lead, and nothing reads it.
#2714 left acting on a contradiction to a follow-up that needed a precision measurement first, so this is that measurement and the decision it supports.

Measured on Development on 2026-09-30 by hand-reading the cited site against the lead for every `CONTRADICTED` judgement on a live row, which was 59 judgements on 55 rows, 38 of them on `student_ready` rows with no confirmed lead.
Each was labelled right (the site names somebody else as the lead), wrong (the attached lead is correct), or undecidable (the site does not say who leads it).

- **All 59: 15 right, 32 wrong, 12 undecidable, so 32% precision over the 47 decidable.**
- **The 38 served rows with no confirmed lead, the population any serve-time behaviour would act on: 4 right, 24 wrong, 10 undecidable, so 14%.**
- By type: 6 right of 21 decidable on `LAB`, 1 of 18 on `FACULTY_RESEARCH_AREA`, and every decidable `CENTER` and `INITIATIVE` judgement (8 of 8) right.

Decided: a contradicted lead is not suppressed, not held by the gate, and not demoted, and it keeps serving.
At 14% on the served population, suppression would have removed 24 correct leads to remove 4 wrong ones.
The verifier is fixed instead, and `leadVerification` stays unread by every serving path until a later measurement on a fresh lane run supports a reader.

The 32 wrong verdicts fell into classes, and each is now a rule in `scrapers/utils/labSiteLeadVerification.ts`:

- **17: the row's website is not its own page.** A faculty research profile, or an eponymous lab, whose website is a department, center or admissions page that names other people.
  The website is the defect, not the lead, and for a faculty research profile the lead is the subject by construction, so that type is never `CONTRADICTED` (`leadIsTheRecordSubjectFor`).
- **8: a two-letter surname.** `siteNamesPerson` refused any surname under three letters, so a site naming its PI in full could never confirm one.
  A two-letter surname now confirms when the given name sits next to it, with at most two initials between.
- **1: an initial-only given name**, now matched as the initial, with its period, next to the surname.
- **6: another person linked without being a lead.** The shipped rule contradicted on ANY person-shaped link other than the lead's, which included a members page, a section word (`collaborators`) and a social handle.
  A contradiction now needs a person-shaped slug that is either a namesake with a different given name and a surname of three or more letters, which is the collision the lane was built to find, or a person the page names next to a lead-role phrase (`slugNamesAnotherLead`).
  A bare `director` is not a lead-role phrase, because department pages name directors of undergraduate studies and of cores.

Replayed over the same pages, re-fetched on 2026-09-30, the fixed verifier contradicts 7 judgements, all 7 hand-labelled right, and none of the 32 wrong ones; 11 of those now confirm and 21 are unstated.
That is an in-sample result on the sample the rules were drawn from, so it is not yet the precision that would license a reader.
Recall falls: 8 of the 15 right contradictions are lost, mostly centers whose pages name their directors in prose without a person-shaped link, and one two-letter-surname namesake the three-letter floor now refuses.
That is the intended trade for a verdict that must never accuse a correct lead.

Undecidable is recorded, not chased: 12 judgements sit on pages that name no lead at all, and no lane can settle them from the site.
Before a reader lands, re-measure on a fresh lane run, and freeze that sample as a lane-scorecard benchmark so the next change is measured on the same input.

## 2026-10-01: Department Research Guidance Is Served On `/programs` As A Labelled Non-Application (#4285)

#4237 (#3746) stopped minting department undergraduate research pages as research entities, and the #4113 rule held their program records off `/programs` because a page whose only link is its own page and that states no application cycle is not an application.
Together they left a department's own guidance on finding a research mentor on neither student surface, and that guidance is the bridge from a vague interest to a lab a student could join.

Decided:

- **Keep #3746.** There is still no research row for these pages and no cross-surface duplicate.
- **Serve them on `/programs` as department research guidance**, `programKind: 'DEPARTMENT_RESEARCH_GUIDE'`, rather than as something to apply to.
  The #4113 rule still holds every other own-page record with no application cycle; guidance is the one admitted exception, recorded with the `department_research_guidance` gate reason.
- **The type is earned by the page, not by the lane's title.** The department undergraduate research lane observes the page's own document title as `sourcePageTitle`, and `server/src/services/departmentResearchGuidance.ts` admits a page only when that title names undergraduate research or research opportunities, names no senior essay, capstone, application, internship, scholars, funding, summer, news, flyer or graduate audience, and the record states no deadline, opening date or accepting-applications evidence.
  The lane-authored record title reads "<Department> Undergraduate Research" for every configured page, so it is not evidence: it named general undergraduate-program overviews, a labs list and senior-essay registration pages alike, which is why the classifier no longer derives the kind from it.
- **A guidance item carries no application affordance anywhere.** The card, the list row (and so the watched-program view), and the detail modal show a "Department guidance" label and "Not an application" in place of a cycle status, no deadline, no urgency banner, no apply action, and the served payload omits `applicationLink`.
  The one action is "Read the department's guidance", linking to the page.
- **Shown by default, in its own section.** `/programs` files guidance under "Department Research Guidance", after the application sections and apart from "No Dates Posted", and offers "Department Guidance" and "Applications Only" quick filters; every other quick filter is about an application and so excludes guidance.
  It is shown by default because it serves the student who does not yet know what to apply to, and a separate section costs an applicant nothing to skip.

Measured on Development on 2026-10-01 through `searchProgramsController` as a signed-out student: of the 31 pages the lane reads, 11 carry a page title the predicate admits and 20 do not (9 senior-essay or senior-requirement pages, 1 capstone page, 5 general undergraduate-program or undergraduate-study pages, 1 labs list, 1 senior-project page, and 3 application pages).
Of the 19 program records twinned with the #3746 archived rows that #4113 held, 11 are admitted and 8 stay held: 7 because their configured page is a program overview, a labs list or a senior-project page, so the lane should be pointed at those departments' own research pages rather than the predicate widened, and 1 because it is an application page with no stated cycle.
Applied through a re-scrape and materialize of the lane, served guidance went from 0 to 11; a dry run of the programs gate with the pre-fix and the fixed code over the same 533 live programs differs on exactly those 11 rows, so no application program's verdict changed.

## 2026-09-29: A Stored Topic List No Evidence States Is Extended By Derivation, Never Replaced (#3836)

#3836 traced every served chip that no live observation backs to one mechanism: `researchAreas` is not clear-on-empty, and the description fallback returned early on any non-empty stored list, so a list whose evidence was retired, rolled back, or never existed had no owner and no pass could replace it.

Decided, as derivation rather than repair:

- **Scope is the shared predicate.** A row is in scope when `researchAreas` is not in `manuallyLockedFields` and no live `researchAreas` observation on the row or on any merged-in key states an area the row admits, decided by `scrapers/researchAreaEvidence.ts` (#3842) with the #3856 admission rule, so an observation whose every value the row rejects is no evidence.
  The materializer evaluates it over the observations the pass already read, including merged-in candidates the #3560 carry rule keeps out of resolution, so a list only a merged-in row states stays out of scope.
  A pass entered through another key, and an archived row, are never judged, because neither has read all of the row's own evidence.
  An observation the resolver used this pass still outranks a derivation even when the predicate does not credit it (an `entityKey` match carrying another row's `entityId`).
- **The action is the existing derivation, and it only adds.** On every resolve the row's topics are derived from its own name and description with `applyDescriptionResearchAreaDerivation` and its `LAB`/`FACULTY_RESEARCH_AREA` gate and admitted through `partitionResearchAreas`.
  The resolved list is the stored list followed by every derived chip it does not already hold (compared case-insensitively), so a derivation never removes a stored chip, and it fills an empty stored list outright.
  No lock is written.
- **The derived attribution vouches for the whole list or is absent.** `description-derived-research-area` is recorded only when every resolved chip is one the derivation produces, which covers an empty stored list, a stored list the derivation reproduces, and one it extends.
  A list that keeps a stored chip the derivation does not produce carries no derived entry, and a derived entry already stored on such a list is unset, including by a pass scoped to `researchAreas`.
  The entry is whole-field: it exempts every chip from `dropDomainIncoherentUnsourcedResearchAreas` and is on the #3790 allowlist only because it is recomputed from the row's own description on every resolve, which a stored-only chip is not.
  Recording which chips were derived would need a per-chip provenance shape that every reader of the entry would have to learn, so the list is attributed only when the claim is true of all of it.
  A lane entry already on the field (history of a retired observation) is left as it is; retiring it is #3790's never-backed rule, not this one.
- **The guard stays: a derivation never empties a stored list.** When the derivation yields no admissible chip, or the row's type is not derived, the stored list stays as it is and the row is counted, per row as `unbackedResearchAreas` on the materialize result and summed in the `research-entity:rematerialize` report and the `[unbacked-research-areas]` line of a run's materialization log.
  The outcomes are `rederived` (the list or its attribution is written and is wholly derived), `already-derived`, `added-derived` (derived chips appended to a list that keeps stored-only chips), `kept-stored-covers-derived` (the stored list already holds every derived chip), `kept-stored-derived-empty`, `kept-stored-type-not-derived`, and `nothing-derived`.
  The rematerialize report also sums `researchAreaChips` `{ added, removed }` over every `researchAreas` change, and under this rule `removed` is 0 by construction.
- **It converges.** A second resolve derives the same answer, finds nothing to add and the attribution already right, and plans nothing.

Superseded, same day: the rule first landed (#3868) as a replacement, where the derived list overwrote the stored one.
Applied on Development on 2026-09-29 between 04:29 and 04:45 UTC it changed 79 rows, 54 of which lost at least one stored chip, 138 chips lost against 77 gained, and a re-read of the 9 served rows found 3 worse, each losing a topic its own description supports.
That matched the #3836 hand-read, where unbacked stored chips were supported 29 of 39 times: no live evidence means a value has no owner, not that it is wrong, and the description derivation is a coarser instrument than whatever wrote the stored chips.
So a derivation over an unowned list may add what the row's own text supports but may not take anything away.
That replacement run was then undone as a one-time rollback of the operation itself, not as an operator judgement about any row, so it needed no lock.
The 79 rows' `researchAreas` were restored at 05:27 UTC from a pre-apply capture kept outside the repository, cross-checked against the apply report's per-row before-values (79 of 79 matched), with each write conditioned on the row still holding that apply's after-value.
Provenance could not be restored, because the capture recorded values only; the rows kept the replacement run's derived attribution until the next resolve under this rule rewrote it.
That resolve, over the same predicate, changed 53 of the 79, added 77 chips and removed none, and a hand-read of 15 of the added chips against full descriptions found 14 supported.
The rollback holds because this rule keeps every stored chip on every later resolve.

- **Rows with live evidence behave exactly as before.**

Measured read-only on Development on 2026-09-29 between 03:37 and 03:40 UTC with the real materializer in dry run, peers writing: 711 unarchived rows are in scope, 110 of them `student_ready`.
Of the 110 served: 9 change to a different admissible set (4 different, 4 a subset, 1 a superset), 17 keep their list and gain the derived attribution, 10 are already derived, 19 keep their list because the derivation yields nothing, 1 keeps its list because its type is not derived, 53 store no topics and derive none (the 12 rows #3856 recorded among them), and 1 keeps an observation the resolver reads.
Of the 601 unserved: 70 change their list, 107 gain the attribution, 14 are already derived, 66 are kept by the guard, 339 store and derive nothing, 4 have no live observation of any field so no resolve reaches them, and 1 is skipped for invalidated-run evidence.
2,873 archived rows match the predicate and are not reached.

The rule reaches the stored corpus only when a row is next resolved, so the delivery is `yarn --cwd server research-entity:rematerialize --unbacked-research-areas`, which selects this scope by the same predicate and is scoped to `researchAreas`; dry run first, then `--apply --confirm-rematerialize` on Development.
What stays is recorded rather than patched: the rows the guard keeps hold a list no lane states, and they are fixed only by a lane that reads a page with real topics for them.

## 2026-09-28: A Merged-In Loser's Evidence Is Carried, Owned By Field Class, And Retired On Its Own Key (#3609)

#3609 asked for the opposite of what the log supports, so this entry diverges from its title on purpose.
The issue proposed retiring a loser's evidence when the survivor's own complete reads stop emitting the loser's key, on the premise that a loser key is never read again.
Measured on Development on 2026-09-28 between 04:10 and 05:05 UTC, read only, with a peer sweep writing, the premise does not hold.
3,195 tombstones reach a live survivor, 1,704 survivors resolve over them, and of the 2,492 slots on `student_ready` survivors whose provenance cites a live loser observation, 948 come from a source that has written that loser key again since the loser was last updated.
For those sources the loser key is still the live key for the page, so retiring by key would retire current evidence.
Retirement already reaches loser keys: 51 loser-keyed `websiteUrl` observations had been retired by field retraction reading the loser key itself, and the issue's proposal, survivor-key reads retiring loser-keyed evidence, reached 4 observations and 0 stored values.

What a survivor may take from a loser, by field class:

1. **Identity is the survivor's own** (`name`, `entityType`, `kind`, `school`, the lead fields; #3567).
   A loser never restates who the survivor is.
2. **Contact is row-keyed only** (#3609, the entry below).
   A loser's contact never fills a survivor, because contact is fail-closed.
3. **A website a survivor's own lab-identity lane typed is the survivor's** (#3585).
4. **Every other field is carried, not re-keyed** (#3560).
   A loser's live observation may fill a field the survivor holds no evidence for, and it keeps the loser's key and trust, so history stays where it was written.

How that carried evidence stops backing the survivor:

- **It retires on the loser key, through the ordinary field-retraction path**, which is where the source that wrote it keeps reading.
  The gap was the step after: the stored-value clear read the row whose slug is the loser key, the archived loser, so a retraction cleared a value nobody is served and left the survivor serving it, and it read the loser's locks instead of the survivor's.
  Now a loser key's state is the survivor its tombstone chain reaches: the survivor's stored value and locks decide, the clear lands on the survivor, and rival evidence is counted across every key and id merged into that survivor, because any of them refills the field on the next resolve.
  Two keys of one survivor retracting the same field in one pass are decided together, so the survivor clears once instead of each key deferring to the other.
- **A survivor-key read never retires loser-keyed evidence.** It is a read of a different key, and often a different page (of the 779 slots whose source now reads the survivor instead, 116 are the same page), so it says nothing about what the loser's page states; that is the #2647 lesson that silence is not absence, one key over.
  Superseded by the 2026-10-03 #4568 entry above: a survivor's complete read now counts as a re-read for evidence filed under its merged-in keys.
- **Nothing is pruned.** A retired observation is superseded with a reason, and provenance that cites it is history.

A dry run on Development on 2026-09-28 at 05:04 UTC, with the change, planned for `ysm-faculty-directory` 14 retirements and 8 stored clears, and for `dept-faculty-roster` 39 retirements and 5 clears, every clear on a live row.
22 of the retirements are on loser keys, 2 of the clears land on a survivor through one, and 10 clears are deferred to the resolver because another merged-in row still states the field.
The same dry run on the code before the change planned 3 of its clears onto archived losers.

What stays, recorded by predicate rather than patched:

- 765 slots on `student_ready` survivors cite a live loser observation whose source has read neither key since, so no evidence exists either way and no lane can decide them until it reads again.
- 449 survivors cite a superseded loser `entityType` observation and hold no live `entityType` observation of their own; a loser never restates identity, so no resolve plans the field, and the value stands on history rather than on evidence.

## 2026-09-28: A Contact Stands On A Row Only While Evidence Keyed To That Row States It (#3609)

Contact is fail-closed, and #3609 found two ways a contact reached a row from a page that was not about it.
A merge resolves the survivor over its tombstoned losers' observations (#3560), so a loser's `contactEmail`, `contactName` and `contactRole` filled a survivor that had none of its own.
And a lane whose own key resolved onto an existing row wrote its contact into that row under a key the row's own resolve never reads.
Measured on Development on 2026-09-28 at 04:35 UTC, with a peer sweep writing: 29 live rows store a contact field that only such foreign evidence states, 28 of them `student_ready`, 25 through a merge and 4 through another key; 176 of the 205 rows storing any contact field are backed by their own evidence.
The contact-field access signal is what students saw: the detail route serves its excerpt, which names the contact person and role, and 30 such signals cite foreign evidence, 28 of them on `student_ready` rows.

Decided:

- **An observation is keyed to a row when its `entityId` is the row's id, or when it has none and its `entityKey` is the row's slug.** That is the one predicate (`scrapers/rowKeyedContactEvidence.ts`), and it is deliberately narrower than "the row's resolve set", because the resolve set is exactly where the foreign evidence came from.
- **The projection refuses foreign contact evidence.** `materializeEntity` drops foreign contact observations before resolving, from every entry point, so a survivor-key pass and a loser-key pass agree.
  A pass that read the row under its own key or id also clears a stored contact field no row-keyed live observation states; a pass entered through another key does not, because it has not seen the row's own evidence.
  Contact is the one field class that clears on empty this way, because a contact nobody can show was read from a page about the row is worse than no contact.
- **The serve path withholds what the store still holds.** The access materializer upserts and never archives, so the detail route withholds a contact-field signal whose excerpt the row's own live contact observations do not re-derive, and the visibility gate does not count it as a way in.
  The excerpt is re-derived rather than the stored evidence id checked, because that id names only the single best contact observation while the excerpt combines the best of each contact field.
  The stored signal and the loser's observations stay: they are history, and nothing here prunes either.
- **Every other field class is unchanged here.** Each keeps the #3560 rule, under which a loser may fill what the survivor has no evidence for; how that evidence is retired is a separate decision.

The serve half reaches students on deploy.
The stored half is a data operation: `yarn --cwd server research-entity:rematerialize --foreign-contact`, dry run then `--apply --confirm-rematerialize`, which a dry run on the date above planned as 87 contact fields cleared on 29 rows and 0 tier changes on re-gate.

## 2026-09-28: One Hosted-Undergraduates Predicate, Past Undergraduates Only For Now (#3593)

"Has hosted undergraduate researchers" had four definitions.
The browse card read `pastUndergradAdvisees` and `typicalUndergradRoles`, the pathway badge read `CURRENT_UNDERGRADS`, `PAST_UNDERGRADS` and a `FACULTY_SUPERVISION` signal nothing mints, and the `hostsUndergrads` filter and saved plans read a stored flag that also counted `CURRENT_UNDERGRADS` and `FACULTY_SUPERVISES_STUDENT_PROJECTS`.
On Development that flag was set on 290 unarchived rows while the card showed the badge on 5.

There is now one predicate, `entityHasHostedUndergraduates` in `server/src/services/accessAcceptanceLevel.ts`, over one input, `pastUndergradAdvisees`, the field that mints `PAST_UNDERGRADS`.
Every surface reads it: the API serves `hasUndergradHostingEvidence` on each research entity, the card reads that flag instead of re-deriving it, saved plans use the same test, and `researchEntityBrowseRankService` writes the stored flag the filter reads from it too.
The stored flag is no longer derived from `AccessSignal` rows, because the access materializer never archives a signal it stops deriving, so a lingering `PAST_UNDERGRADS` signal would keep a row in the filter after its card lost the badge.
Supervising student projects is a separate claim with its own badge.

`CURRENT_UNDERGRADS` is held out because its stored input is not yet trustworthy.
A hand-read of 20 stored `lab-microsite-undergrad-llm` counts against their cited pages found 13 backed, while the lane's current page-grounded code scored 6 of 6 on `undergrad-llm-gold-v2`, so the gap is counts written by older runs.
Re-admitting it needs those counts re-derived and re-measured, not a code change here, which #3789 tracks.
It was re-admitted on 2026-09-28 after the #3789 re-run re-derived those counts from grounded roster lines: 28 of 30 stored positive counts then sampled on Development were backed by the cited page, against 13 of 20 before, and a count held only by the retired cache backfill still does not count.

The served flag is derived at request time, so the card, the pathway badge and saved plans are right on deploy.
The stored `hasUndergradHostingEvidence` that the `hostsUndergrads` filter reads is stored data, so this half is done only after `yarn --cwd server research-homes:backfill-browse-rank` has run against Development and the filtered browse output has been re-read.

## 2026-09-27: A Provenance Entry Names Its Observation, And An Attribution Nothing Backs Is Retired, Not The Value (#3769)

A `fieldProvenance` entry says a lane stands behind a value, and the only thing a lane can stand behind is an observation.
#3769 found 18 entries citing a repair lane that wrote 0 observations, and measuring the class found 467 such entries across 33 source names on Development (2026-09-28), 102 of them on `student_ready` rows, with one writer still producing the shape: `inheritSchoolFromLeadPi` appended observations after #3375 but still stamped provenance with neither id, and still wrote the value when the append was skipped.

Decided, in the order the issue asked:

1. **The 2 live rows' values are right, and the attribution on them is wrong twice.**
   The repair wrote `LAB`; both rows now hold `FACULTY_RESEARCH_AREA`, which is exactly what the grant lanes' current code emits for a grant shell, so a later writer changed the value and left the attribution behind.
   The provenance is stale as well as unbacked.
2. **Clear the attribution, never the field.**
   Clearing the field is worse on every row the measurement reached: an `entityType` falls back to the schema default `LAB`, which is the value these rows were correctly moved off, and a cleared description can drop a row's tier.
   Whether a value is right is a lane question (a re-scrape) or an operator one (a refusal), and it is answered on evidence; the attribution is the one thing already known to be false.
   An absent entry reads as "no recorded source", which is true, and it makes the row visible to instruments that key on a missing entry, such as `isUnbackedLabNameShell`, which a false entry was exempting.
   `websiteUrl` stays the exception #3586 already made, because an unbacked `websiteUrl` is itself a served citation and `sourceUrls` can refill the slot on the same pass.
3. **Served exposure is zero for #3769 and not zero for the class.**
   `entityType` is not in `servedFieldContributionLabels` and the 4 `fullDescription` entries are on archived rows, so no student sees the #3769 attribution.
   Across the class, 57 entries on served rows attach a `sourceUrl` to a labelled field, so `buildSourceFieldContributions` told a student a page supplied a Research summary, Topics, Name or Department when no lane read it for that field.

What makes it a class fix rather than 467 row fixes:

- **The write path refuses the shape.** The `ResearchEntity` model throws on any Mongoose write of an entry with no `observationId`, unless its source is a listed non-observation authority (`models/fieldProvenanceBacking.ts`).
  The list holds one name, `description-derived-research-area`, because it is recomputed from the row's own description on every resolve; a one-shot repair never qualifies, since the whole point is that it cannot re-derive itself.
- **The one live writer is converted rather than exempted.** Lead-PI inheritance writes a value only once its own observation of that value exists, and records that observation in the entry.
- **The residue retires on resolve.** `planNeverBackedFieldProvenanceRetirement` unsets an entry whose lane has no observation of that field on the row, live or superseded, and writes no field and needs no lock, so a second pass plans nothing.
- **A real assertion whose id was never recorded is relinked on resolve, by derivation (#3788).** `planUnrecordedProvenanceObservationRelink` rewrites such an entry citing the one live observation of its lane that states the value the row holds, and leaves it alone when two do.
  Measured on Development on 2026-09-28 at 02:48 UTC, with a peer sweep writing: 141 entries, all `lead-pi-school-inheritance` on `departments`, of which 139 match exactly one live observation and 2 match two identical live observations and stay as they are.
  The re-back pass `rebackLeadPiInheritanceProvenance` appends the lane's observations without rewriting the entry beside them, which is how a real observation comes to sit next to an entry that does not name it; the newest of the 141 was stamped on 2026-09-27, before #3790 merged, and the model now refuses the shape, so no live writer can add to them.
- **A raw handle is a reviewed exception, not a way around the guard (#3788).** Mongoose hooks never see a `collection` write, so `rawResearchEntityWriteGuard.test.ts` finds raw writes by call shape and resolves which collection each names.
  On 2026-09-27 it found 50 raw write sites in server code, the same 49 driver calls a type-aware pass over the whole program found plus one `$merge` stage, and 31 of them could reach `research_entities`: whole-collection copies and swaps, migrations and unsets of fields the schema no longer declares, and multi-collection relinks and text repairs, none of which authors an entry.
  One of the 31 wrote a `fieldProvenance` subpath and was an unregistered duplicate of `research-entity:collapse-citation-mirrors`, so it was deleted rather than listed.
  The other 30 are listed per file with their exact count and reason, an unresolvable collection counts as reaching the table, and no raw site may author a whole entry or its `sourceName`.
  The guard follows written keys through local and imported builders, and a key it cannot resolve fails closed: the 3 sites whose key comes from a caller are counted per file as reviewed exceptions.

Never-backed is kept distinct from history, because the repository forbids pruning history and the two share a shape.
An `observationId` that resolves to a superseded observation or to nothing, a bare `sourceId` (the #2897 residue), and an entry whose lane did observe the field are all kept: 34,901 history entries, 527 attributed to a real `Source`, and 142 real-but-unrecorded ones.
What the stage retires is an attribution to a claim that was never made.
The instrument that separates them is sound only while superseded observations are retained, and on Development the oldest superseded observation is as old as the log itself (2026-05-14), so no claim has been pruned out from under one of these entries; if pruning ever runs, an entry with no id cannot be protected by it, which is a further reason the write path now refuses to create one.

Measured predictions for the Development operation, 2026-09-28: 414 entries on 284 rows retire (58 live, 43 entries on `student_ready` rows); 47 on locked fields are left to the lock release path, 142 are kept as real assertions, and 6 sit on rows with no live observation, which no projection can reach and which are recorded here rather than patched.

## 2026-09-27: Person Identifiers Are Refused Before Posting, Not Reported After (#3682)

The `Person identifier scan` workflow commented on an issue or pull request body after GitHub had already stored it.
GitHub serves every prior revision of a body to anyone without an account, so a comment after publication could only report the exposure, never undo it.
It was removed together with its workflow test.

Enforcement now sits in front of publication instead.
`scripts/gh-identifier-guard.mjs` is installed as a `gh` shim ahead of the real binary on PATH by `scripts/install-gh-identifier-guard.sh`, which `scripts/new-agent-worktree.sh` runs.
For a `YaleComputerSociety` repository it runs `check-no-person-identifiers.mjs` on the title and body of every `gh` issue, pull request, comment, review, merge, and API text field, and refuses to call GitHub when the scan flags it or the scanner is missing.
That covers text an agent writes and the pull request body the gate writes, because the gate publishes through the same `gh`.

The guard makes the scanner's false positives blocking rather than advisory, so a false positive is fixed in the detector (#3681), never by calling the real `gh` directly or adding an `identifier-exempt:` line.

Two gaps remain and are accepted rather than hidden.
A host where the guard is not installed has no protection at all, since there is no longer a bot to report after the fact.
Commit messages are not guarded, because another tool owns `core.hooksPath` on the maintainer machine, so they are scanned by hand before a push.
The blocking file arm, `yarn security:identifiers` inside `security:preflight`, is unchanged.

## 2026-09-27: Scraper Sweeps Run Only Against Development (#3670)

Scrapers write only to Development.
Beta receives the accepted Development dataset through `beta:refresh-from-development`, Production receives accepted Beta through `production:promote-beta-copy`, and each target then re-gates and reindexes from its Render shell.
No sweep, scrape, or standalone materialize writes to Beta or Production, and the scrape CLI refuses one with a message naming the promotion commands.

Until this decision the repository documented two models for one job.
The primary one fetched the release candidate from the local machine straight into Atlas Beta (`scrape:beta:all:fetch`, the `beta-fetch` sweep mode) and materialized each recorded run from the Beta Render shell; the alternative swept Development and mirrored the result.
The two overwrite each other, because the mirror replaces the same whole collections a Beta fetch writes, so an operator had to choose correctly every time and the runbook had to keep both paths true.

Three facts made the Development model the only sensible one.
Development is where every instrument points: the served scoreboard, the corpus snapshot, the lane scorecard, and `journey:eval` all measure Development, so evidence written straight into Beta was evidence nothing had measured.
The definition of done in `AGENTS.md` already said a stored-data fix is done when Development is fixed and verified, which only holds if Beta can never diverge by being scraped on its own.
And the mirror no longer costs a second copy of the evidence log: it leaves `observations` behind, so it moves about 23,000 documents rather than 436,026, which removed the storage argument the Beta-fetch model was built on.

What was removed: the `beta-plan` and `beta-fetch` sweep modes with their stop-on-first-failure and per-run Render-command branches, the `scrape:beta*` and `profile:beta:write` scripts, the fellowship `catalog-refresh` sweep stage and the `fellowships:refresh` command it called, which wrote the catalog straight into Beta or Production, and the `--source` option of `beta:seed-environment`, which ran scrapers against Beta.
The former guarded production delta lane goes with them, and `scrape cron`, which only ever targeted Production, now refuses to write.
What was kept: the mirror, the promotion, the Beta and Production reindex, `release-hold`, every read-only audit that can target Beta or Production, and dry runs against either, which write no observations.

A future need to refresh Beta or Production without a full sweep is answered by a bounded Development run and the same promotion, never by a second write path.
The rest of `beta:seed-environment`, with its `beta:seed` and `beta:seed-meili` aliases, was retired later (#3723): its readiness preflight could not block, it recorded a backup confirmation nobody gave, and it cleared the Beta index through a rebuild with none of `reindex:meili`'s preconditions.
Each step it ran has a guarded owner: the Development-to-Beta refresh copies the `sources` collection, `node scripts/reindex-search-index.mjs beta` rebuilds the index through `reindex:meili`, which refuses an empty Mongo target before clearing anything, and `beta:readiness` now exits non-zero on any blocked gate without needing a flag.

## 2026-09-25: `beta` Requires Its Smoke Test Too, And Protection Here Is Rulesets (#3425)

`beta` already required `test-and-build` and one approving review, through the `require CI on beta` ruleset created 2026-08-22.
`main` already required `test-and-build`, `student-journey-smoke`, and `release-hold` through `protect main (production)`, created 2026-08-31.
The only substantive change here is adding `student-journey-smoke` to the `beta` ruleset, which brings it in line with `main` and closes a gap that existed only because `beta`'s ruleset predates the smoke test being required anywhere.
It was verified first: 30 of 30 recent runs successful, and triggered on every `pull_request` into `beta` with no path filter, because a required context that never reports blocks a pull request forever.

The entry exists mostly to record the mistake that produced it, because the mistake is reusable.
An audit concluded that `beta` had no protection at all, on the strength of `GET /repos/.../branches/beta/protection` returning `404 Branch not protected`.
That endpoint reports only **classic** branch protection and says nothing about rulesets, so its 404 was a statement about the wrong instrument rather than about the branch.
Acting on it added a redundant classic-protection layer on top of the rulesets, which has since been removed; the repository is back to rulesets as its single source of protection, which is where it should stay.
A negative answer from an API is a measurement like any other, and this one belongs to the same family as every other instrument error recorded in this file: the number looked authoritative and was about something else.

Two properties of the real configuration are worth stating because they read as sloppiness and are not.

`--admin` in the documented merge command is load-bearing.
`require CI on beta` demands one approving review, and a sole maintainer cannot approve their own pull request, so without the Admin role's unconditional bypass nothing merges at all.
This is also why every pull request merged to date shows no approving review, and why that fact is not evidence of review being skipped in a team that had one.

The bypass is unconditional, so it overrides a failing suite as readily as the review rule.
That makes restraint the contract rather than the configuration: the flag is for the review requirement and the watchdog's bot flow, and never for a red `test-and-build`.
`AGENTS.md` owns that rule.

`Person identifier scan` was never required, because it could not unpublish text GitHub already serves; it was removed on 2026-09-27 in favour of a guard that refuses the text before posting (#3682).

## 2026-09-24: Evidence Sets A Field, A Lane Owns A Class Of Wrongness, An Operator Decides One Row (#3359)

Three layers have governed this repository since the observation engine landed, without ever being written down, so each thread rediscovered them and some threads got them backwards.
Ratified here and stated as a rule in `AGENTS.md`, which is the single owner of the rule; this entry is the only other place it is written down, and it holds the reasoning so the reasoning survives a later edit to the rule.

1. The scraper asserts evidence, and it is first class.
   Evidence is the only thing that may set a field.
2. Wrong output means fix the lane, not the row, because a bug affects a class and so should the fix.
   At that layer the operator's job is to notice and to measure rather than to patch rows.
3. The operator acts only where evidence cannot decide: a refusal that a specific value is inadmissible, an archive, or a review verdict on one row.
   That is a judgement about that row, which is why `role-assignments:lead-edge-retirement-review-queue` was deliberately built read-only, throwing on `--apply` and on any `--confirm` flag, with no bulk-apply path (#3260).

### One claim in the ratification does not hold, and is stated here in its verified form

The contract was ratified saying that a direct field write with no backing observation "does not survive the next resolve, and the engine already enforces this".
The engine does not enforce that.
`projectFromLog` in `scrapers/entityMaterializer.ts` builds its `$set` by iterating the resolved map only, and the resolved map is keyed off observed fields, so a stored field that appears in neither `set` nor `unset` is untouched.
The sole general clearing is `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`, which is two fields, `methods` and `inferredPiUserId`.
Two integration tests pin the opposite for everything else: `entityMaterializerUnsetOnEmpty.integration.test.ts` asserts a directly seeded `shortDescription` and `researchAreas` survive a materialize, and `entityMaterializerDiffSkipEndToEnd.integration.test.ts` asserts an unbacked `websiteUrl` survives a no-op re-projection.

The verified statement is stronger for the contract rather than weaker, because it condemns a direct write from both directions.
Where rival observations exist for the field, the next resolve overwrites the write, so it sticks only behind a `manuallyLockedFields` entry.
Where no observation exists at all, the write persists and no lane can ever reach it again, which is the stranded state that `purgeSameNameCollisionAreaGrafts.ts`, `repairUnbackedLabNamesCore.ts` and `scrapers/fieldRetraction.ts` exist to clean up after.
Either way a direct field write is not durable correctness.

### Layer 3 applies where the derived value cannot WIN on evidence, not only where deriving it needs judgement

The obvious test is wrong, and it was run and refuted rather than reasoned about.
`disambiguateSurnameLabNames` renames a row sharing a bare-surname lab name to `<lead name> Lab`, derived mechanically from the single PI the row's own edge names and gated on a surname match, a uniqueness check and a collision check.
No human judgement enters the derivation, so the first reading was that it is an assertion and belongs to layer 1.

Built that way and measured, the asserted name arrived from evidence on 0 of 4 rows and all 4 diverged: the assertion sits at 0.6 and the roster lanes assert `name` at 0.7 to 0.8, so it loses the resolve and the value reverts.

Raising the confidence until it wins is choosing a number to force an outcome, and it would also be false: a lead's own name is not better evidence about what a research record is CALLED than the roster that names it.
So the rename cannot be carried as evidence at any honest tier, and preferring it anyway is an operator act by definition.
The refusal channel is right here even though the derivation is wholly mechanical, and the rule is `operator_judgement` rather than `superseded_by_better_source`, because the roster is not a worse source and a reason implying it was would be false.

The test to apply, then, is not "does deriving this require judgement" but **"can the derived value win on evidence?"**
If it cannot, it is layer 3 however mechanical the derivation.

### Two boundaries the census found, without which the next one over-reports

**A mint is not a field write.** `findOrCreateForOwner` in `services/researchGroupService.ts` inserts a row that does not exist yet, via `$setOnInsert`.
There is no field to back, because there is no row until the insert, so "convert the write to an observation" is the wrong question about it.
The assertion belongs to whichever lane caused the mint, and the insert is the row coming into existence rather than a claim about it.
This is a fourth category beside evidence-shaped, operator-shaped and derived-bookkeeping, and without it a census flags every insert in the tree.

**A normalizer that runs at ingest and again in the projection is hygiene, not evidence.**
`materializedFieldValue` composes the five name normalizers, and `observationFieldSanitizer` composes them again at ingest, so a name is cleaned on the way in and on every projection.
The corollary settles a whole class: mapping a retired vocabulary spelling onto the canonical one is derived-bookkeeping, because no source can assert "this spelling is the current vocabulary".
`consolidateFacultyResearchEntityType` was that shape before #3675 deleted it, and so is `orgAffiliationLabels`, which `canonicalizeDepartments` computes from `departments` - which is why 1,135 of 1,135 served rows carrying it with no observation is correct behaviour rather than a defect.

One note on how the census read, because it is the same lesson as the rest of it: the name cohort looked outstanding because what had been recorded was a reading of the scripts rather than of the materializer.
The hygiene was already in both places before the census started.
The instrument was wrong, not the corpus.

### The deciding test: does the wrongness have a shape?

If you can write a predicate for it, it is a lane bug and belongs to layer 2.
If you can only tell by reading the page, it is an operator judgement and belongs to layer 3.
This is the practically useful part of the contract, because it settles which layer owns a defect before any code is read.

### The second test: run it twice

Post-processing is legitimate and necessary, because the lanes are not perfect.
The distinction that matters is not whether output is corrected after extraction, but whether the correction runs every pass or once.

Post-processing that runs on every resolve is derivation, not repair.
It reads evidence, applies a correction, and produces the same answer next time, so it is layer 1 working as intended rather than an exception to it, and it writes no field and needs no lock.
A one-shot script that writes a value directly is the thing that rots, because it needs a `manuallyLockedFields` entry to survive the next resolve and the lock then freezes the row forever.
Same intent, opposite outcome.

So: run it twice.
If the second run re-derives the same answer from evidence, it is a lane.
If the second run is a no-op because the first wrote a field, it is a repair that will need a lock.

### The four legitimate places to correct output, in this order

Choosing among these is most of the skill.

1. In the lane, fixing the parse or the extraction, which stops the wrong value existing at all.
2. In the derivation path, as a cleaning, grounding or trust filter that runs every time the value is computed.
   Deterministic and idempotent, and it writes no field.
   `trustedAreaShellEntities` in `scripts/researchEntityPiDedupeCore.ts` is one: it excluded 301 topics carried by low-trust shell losers across the 134 applied merge groups, which is about 92% of an apparent topic loss being a guard working rather than failing (#3326, #3330).
   The residual 28 topics across 11 groups in that same measurement are not yet shown to be correctly filtered, so cite the 301 as a refusal and not as a clean bill of health.

"Every time the value is computed" is the trap in form 2, because some values are never computed again.
The projection writes only the fields it resolves, so a stored field no live observation asserts gets no planned value and a derivation wired into the resolve path cannot reach it, no matter how idempotent it is.
That is the recurrence behind the one-off repair class: the ingest sanitizer was the right fix for the invisible format character (#2874) and the lost sentence-boundary space (#3096), and each still needed a script for the standing corpus, which is then load-bearing forever and reachable from nothing but itself.
`planStoredTextNormalization` in `scrapers/storedTextNormalization.ts` is form 2 extended to that blind spot: it reads the stored value rather than a resolved one, applies the normalizers ingest applies, asserts nothing new, writes no field the projection planned, and needs no lock (#3408).
Measured before any write, it corrects 1 of 4,601 live research entities and 0 of 6,416 researchers and 459 fellowships, so it is a recurrence guarantee rather than a backlog clear, and the near-zero count is the finding: the corpus is clean, so the next defect of this class needs no new script.
A correction of this shape belongs there and not in `scripts/`.

An entity-scoped refusal is the other half of the same blind spot, and it is a wiring failure rather than a missing predicate.
`sanitizeResearchEntitySourceUrlsForMaterialization` refuses a citation per URL and takes no entity, so the two arms that depend on WHO is citing could not live in it: a faculty roster and a departmental programme page are real evidence about the department that publishes them and a graft only on a person.
Both predicates already existed and were composed only inside `scripts/retireGraftedDirectoryUrlsCore.ts`, which is the same reachability failure as the text case and is why 1,274 live rows still stored 1,315 of these citations, 756 of them `student_ready` (#3428).
`planDirectoryGraftCitationRetraction` in `scrapers/directoryGraftCitations.ts` is form 2 with an entity: it is a list-level stage in `projectFromLog` beside the #3000 stored-citation retraction, so it reads the list the projection just staged as well as the stored one and a live observation asserting the roster URL is re-filtered on every pass rather than retired.
Two independent instruments agree on the cohort, which is what makes the number usable: the script's own planner reports 942 rows and the new stage reports 941 on the stored list alone, the one row being the script's separate `websiteUrl` arm, both counts taken while each still carried the roster-shaped stranding guard below.
The stranding guard is the load-bearing part, and the first version of it was shaped by the wrong question.
Written as "refuse when every retracted URL is a roster", it read as protective and was wrong in both directions a mixed list can take: a person-scoped row citing only a departmental programme page satisfied neither arm and was emptied, and so was a row citing one roster and one programme page (#3448).
The rule the docblock actually stated is "never leave a row citing nothing unless every citation retracted was never a readable page", so the test is `every(isDirectoryLoaderUrl)` and not `every(isRoster)`.
The magnitude of what it protects was measured rather than reasoned about (#2630): 333 of the cohort's rows cite a roster and nothing else, and the roster arm alone would strand 318 corpus-wide, so retracting a row's only citation trades a duplicate-URL block for a missing-evidence block.
A CMS loader endpoint stays unprotected, because it was never a page at all, so correctly unsourced beats wrongly sourced.
The rule lives in one place for the same reason the person-scope predicate does: both the projection stage and `scripts/retireGraftedDirectoryUrlsCore.ts` write this stored field, so each consumes `retractionWouldStrandAReadablePage` rather than restating it, and the two instruments cannot disagree about which rows they strand (#2579).
Serve-time is the wrong layer for this one and that is a measurement too: the visibility gate groups rows on STORED `sourceUrls`, so the N people who cite the one page listing them all read as N duplicates of each other whatever the DTO hides. 3. At serve time, as a withholding guard.
Cheapest to change and it reaches students on deploy, and the repository already records a preference for landing serve-time fixes before repair passes.
`dropDomainIncoherentUnsourcedResearchAreas` in `utils/researchAreaDomainCoherence.ts` is one: a pure function with no database access, wired into both chokepoints, `sanitizeServedResearchEntityCopyFields` for the detail path and `sanitizeResearchEntityIndexDocument` for the Meilisearch document, so live data was corrected with no Mongo backfill (#1640).
Note where the guard sits before copying the pattern: it is serve-time only, no materialization lane calls it, and the index arm does write a search document even though it writes no entity field. 4. A durable refusal, for "this specific value is inadmissible".
This is the legitimate form of a one-shot correction.
It is stored on the row as `fieldValueRefusals`, screened out of the observation set before `resolveAllFields` runs on every materialization pass, keyed on the value so it survives re-observation, idempotent on a repeat, and withdrawable through `withdrawnAt` with a recorded reason, which a lock is not.

The one illegitimate form is a script that writes a field directly and locks it to make it stick.

#3178 is the cleanest recorded contrast between form 4 and that illegitimate form.
A bare clear of a dead `websiteUrl` did not hold, because the citation-promotion path in `entityMaterializer.ts` put the value straight back from the row's own citation on the next materialization, and until #3167 a `manuallyLockedFields` entry was the only thing that could stop it.
Recording a refusal instead held with `manuallyLockedFields: []`: #3208 released the lock, materialized twice per row, and reported 7 of 7 fully clean, and #3225 repeated it for 7 more released locks with 0 dead values returning and 0 served `websiteUrl`s moving.

### The fourth state: some rows are not fixable, and that is the answer

Recording them by predicate with a count and a reason is finishing the work rather than deferring it.
This ended several issues that would otherwise have stayed open as standing debt, so it is a completion state and not a euphemism for a deferral.

Two live examples.
The rows carrying a collective name on a person-scoped type were filed at 41 and measure 18 in the shape, of which 10 survive the evidence check, because the shape count is not the defect count and inferring a type from the row's own name is the exact inference that inflated the earlier figure (#3252, #3350).
And the served rows whose name the person-identity refusal condemns while no substitute is available are not correctable by refusing the name, because `name` is the heading every serve path falls back to, so a refusal with no substitution is a blank heading that preserves the fabrication rather than removing it; that cohort measured 6 on Development (#2913, #3132).

### Measured evidence: a layer-2 fix reaches a whole class from one change

- A bare substring test matched `explor` inside `internet-explorer` in a browser-upgrade banner's URL, so the banner cleared the research-sentence vocabulary.
  88 of the 100 `empty-description` rows had been handed that single snippet, spending a fetch and an LLM call each to learn their page has no research prose (#1878, narrowed in #3190).
- An empty array satisfies `Array.isArray`, so a roster read that discovered nobody was admitted as an authoritative snapshot rather than classified as unrecorded.
  It governed 25 rows, and 3 of those already carried a first-absence marker, so they were one repeat run away from `suppress_departed` (#3310, #3317).
- The grant lanes minted a lab from a record that asserts a PI name and an abstract and never asserts an organization.
  Grant shells typed `LAB` went 364 to 122 on Development, with durability 15 of 15 and no locked fields (#3145, #3289).
- A lead-role set written out thirteen times across two vocabularies meant only one of its four labels could ever match, penalizing 59 rows that hold a live `CO_PI`, `DIRECTOR` or `CO_DIRECTOR` edge and no `PI` edge (#3210, #3226).

### Measured evidence: repair-as-bugfix has a failure signature here

A repair could only make a field stick by writing `manuallyLockedFields`, which froze 125 field instances across 79 rows, and a frozen row never improves again.
That is why a durable refusal had to be built as a capability rather than approximated with a lock.
Building it drew the count down rather than sideways: lock instances went 113 to 105 across #3208 and 105 to 98 across #3225, each pass trading locks for refusals.
Measured on Development on 2026-09-24: 98 lock instances across 52 rows, concentrated in `fullDescription` at 19, `shortDescription` at 18 and `websiteUrl` at 17.
A lock that stands in for a capability the engine lacks is recorded as `engine_gap_workaround` in `fieldLockProvenance` and is revisitable through `research-entity:release-field-locks`; an operator's own decision never is (#2612).

## 2026-09-24: Two Vocabularies Named `entityType` Are Separated By Type, Not By Convention (#210)

An `Observation`'s SUBJECT type (`user`, `researchEntity`, ...) and the PRODUCT entity type (`LAB`, `CENTER`, ...) are both spelled `entityType` and are disjoint: measured on Development, 15,847 observations carry the product namespace as a value under `field: 'entityType'` across 13 values, overlapping the 8 subject values in 0 cases.

Decision: separate them by type rather than by comment.
`asResearchEntityType` is the single narrowing door from an untyped read into the product vocabulary, consumers take `ResearchEntityType` instead of `unknown`, and a guard test asserts the two vocabularies partition.
Crossing them is now a compile error that names both value spaces.

Decision: do NOT rename the subject values.
Phase 6 carried that as a roughly 471k-row migration; the values are opaque lane labels, nothing resolves one to a Mongoose model, and with overlap 0 the rename corrects a spelling and changes no behaviour.

Decision: ship the constraint without a data repair.
Reading the product type correctly flips 13 of 18,387 active prose verdicts, and none of the 13 is on a `student_ready` row, so a repair would write against a student-facing corpus for zero student benefit.

## 2026-09-24: A Materializer Lane Reports What It Wrote, Never What It Resolved (#210)

The roster lane reported `fieldsWritten` as its count of resolved INPUTS, on every pass, including a pass that changed nothing, because the canonical writer returned `void` and the lane had no outcome to report.

Decision: `materializeCanonicalMembership` returns a `CanonicalMembershipOutcome` naming what happened, including which refusal it took, and a lane reports `fieldsWritten` only for `created` or `updated`.
Intent is reported separately as `fieldsPlanned`, and a dry run reports `fieldsWritten: 0` because it applies nothing.

Decision: an update count is not a change signal on a timestamped collection.
`role_assignments` is `timestamps: true`, so mongoose adds a fresh `updatedAt` to every `$set` and an existing document always reports one modification; `modifiedCount` can never read zero there.
The outcome is read from a pre-image of the fields the write governs.

Corollary: a retired collection's SHAPE can outlive its storage.
`buildRosterMemberUpsert` built a `research_entity_members`-shaped update that its only caller unpacked in memory and never applied, and the test asserting that document was the only place four of its fields were ever observed.

## 2026-09-23: An Entity Is Held Rather Than Served When Its Only Lead Edge Is Unsupportable (#3166)

When a repair would leave a row with no lead edge its evidence supports, archive the edge and let the gate hold the row.
Do not preserve an unsupportable edge in order to avoid the hold, and do not mint or substitute a lead to fill the slot.

A student writing to a lead who is not there is a worse outcome than a row held on `missing_lead`, and `missing_lead` is the gate reason that exists for precisely this state.
So the hold is the correct answer rather than a cost to be worked around, and a repair that drops a row off the served surface for this reason is complete rather than regressive.

Two consequences follow.
A repair that edits a roster must re-gate every entity it touched through the ordinary gate rather than writing a tier itself, so every other blocker still applies.
And a repair whose effect is to demote a row a student can currently reach must say so in prose, naming the tier change, rather than reporting only a count of rows changed.

## 2026-09-23: A Suppression Override Survives Only While The Row Records No Route In (#1898)

A `studentVisibilityOverrideTier: 'suppressed'` written by the pre-#1802 launch-strictness pass claims one thing: that no official student action route, pathway, contact route, posted role, or access signal has been verified.
So the override is stale exactly when the row now records a route in, and it still states something true when the row does not.
That is a measurement, and it is the whole test.

This replaces an earlier reading that treated `CORE_FACILITY` and `INITIATIVE` as standing product questions to be answered by type.
Type is the wrong axis, because it asks what a row IS while the override claims what a student CANNOT do.
A core facility that publishes an access route is reachable, and a lab that publishes none is not, so the deciding property sits on the row.
Reachability decides, not kind.

That type-based reading also rested on a mis-citation, recorded here so nobody restores it.
Comments on #1898 attributed "a core facility is often a legitimate hold" to #1721, but #1721 is the `fullDescription` near-verbatim restatement guard and says nothing about core facilities or visibility holds; every other reference to it in this repository is that guard.
No issue records a type-based hold for either kind.
The two issues that do discuss cores point the other way: #1401 records `CORE_FACILITY` being dead-ended out of organizational ways-in, and #1925 records the research-scope gate over-suppressing instrumentation cores.
The tracker's recorded direction is that cores are wrongly suppressed rather than legitimately held, which is where reachability lands too.

The route-in test is the row's official, non-grant source URL that is not known to be dead, the same proof the gate uses that a student can reach the research.
It replaced a read of the gate's `concrete_next_step` reason when #4574 removed that reason.

A row held this way is not a backlog item waiting on taste.
It is a row with nothing for a student to act on, and the thing that releases it is evidence of a way in, which is scraper and pathway work rather than a policy call.

## 2026-09-23: Anonymous Traffic Is Deliberately Not Measured (#2333, #3103)

`analytics_events` declares `netid` as `required: true` and carries no address, `ip`, or `remoteAddress` field, so a logged-out visit cannot be written at all rather than merely going unwritten.
That was filed as a hole (#2333), because the product deliberately serves logged-out read-only discovery (#1657), which makes the one population the product supports on purpose the one population the instrument cannot see.

Decision: the hole stays open on purpose, and no pseudonymous or anonymous identifier is introduced to close it.
No session-scoped id, no cookie, no fingerprint.
This is a student-facing public site whose audience is substantially undergraduates, and least collection is the right answer for it, so the required `netid` is the enforcement of that decision rather than an oversight to be repaired.
A permissive branch in `normalizeAnalyticsEventNetid` would accept the sentinel netids `anonymous` and `unknown`, but no caller supplies either and neither Production nor Development holds a single row with one, so the sentinel is not a back door that is already in use.

What the decision costs, named rather than hidden: there is no denominator for total traffic, so the rate at which a logged-out visitor becomes a signed-in one is unknowable from stored events, and any anonymous-traffic threshold has to be sized from something other than this collection.
`server/src/middleware/rateLimiters.ts` already carries that consequence for the first-contact ceiling, which is sized by making saturation observable instead of by measuring per-address volume.

What we owe instead is honesty about what the instrument cannot see, which is the serve-time half of #3103.
No surface may label a signed-in count "Visitors", and the panel holding those counts states that the logged-out population is deliberately unmeasured, so a reader cannot take it for zero or for included.
A client guard asserts both halves: the section names the signed-in population it counts, and no analytics surface renders the bare word "Visitors".

This decision governs the first-party instrument only, and it is not a claim that the product collects nothing from a logged-out visitor.
A third-party GA4 tag then ran on every page load under none of these constraints, and whether it belonged here at all was left open (#3102).
The 2026-10-04 entry settles that one: the tag is removed (#4754).

The one thing that would change this decision is a product commitment to a consented, disclosed measurement, meaning a published statement of what is collected and a real opt-in, at which point the schema change follows the commitment rather than preceding it.
Until then the correct read of a missing anonymous number is "not collected", not "zero".

## 2026-09-23: The Undergraduate-Logistics Vertical Is Retired Rather Than Acquired A Fourth Time (#3088)

#1362 asked for a corpus-wide acquisition run so the Planning-context section would stop rendering nothing.
Measurement says acquisition cannot fill it, and this is the third time the same run has been proposed, so the answer is recorded here rather than re-derived.

Measured on Development: the section renders on **4 of 3,302** served rows.
Seven `Signal` rows exist across the five claim types in total, `STUDENT_LEVEL` 0, `COMPENSATION` 0, `TIME_COMMITMENT` 0, `MODALITY` 1 and `CURRENT_AVAILABILITY` 6, against 7,600 rows of `REACH_OUT_PLAUSIBLE` on the same collection.
All **209** stored logistics observations are `active: false`, against 7,674 `websiteUrl` observations, so the lane's output does not survive between sweeps even where it once landed.
Producer yield per claim type was 0 of 51, 0 of 21, 0 of 12, 1 of 4 and 5 of 121, which puts the acquisition ceiling at roughly 150 rows, about 3 percent, essentially all `CURRENT_AVAILABILITY`.
Three of the five claim types project to zero.

The zeros are the instrument reading the corpus rather than the instrument failing: the same queries return 7,600 and 7,674 on control fields, and the served-row count is taken from `getResearchGroupDetail` through the client's own render predicate rather than from a re-implemented one.

It also decays with no scheduled refresh.
Four of the five live signals expire within 9 to 30 days, and logistics emission requires either `--logistics-production` with `CONFIRM_LOGISTICS_ACQUISITION=true` or a hand-named allowlist of at most 25 labs, neither of which any scheduled path passes.
The enums behind the browse filter were already measured inert twice independently (#1285, #1328, #1362), and the browse filter and its three `ResearchEntity` enum fields were retired ahead of this entry, leaving the filter keys accepted by the search controller as residue that parses into nothing.

Decision: retire the vertical whole.
The Planning-context render, the five claim types, the producer lane's logistics arm, the materializer, the public serve projection, the audit and rollback scripts, and the residual filter keys all come out together.
Carrying a render, a producer, an audit and a filter that tell a student nothing is a cost with no student benefit, and a partial retirement leaves an enum with no producer, which is the shape that invited three acquisition proposals.

The cost is real and is stated rather than discounted.
A student loses a section that today tells them nothing on all but 4 rows, and the corpus loses the ability to express availability at all.
If availability becomes a product commitment, it needs a route designed against the measured 3 percent ceiling rather than one that assumes the ceiling can be raised, and that is new work rather than a continuation of this one.

Stored residue is expected and is not a defect.
Removing a value from the `Signal.type` enum does not delete a document, so 7 `signals` rows and 209 already-inactive `observations` rows keep a name nothing declares; Mongoose validates writes rather than reads, and no surviving read path queries either name.
`signals` indexes `type` generically, so no index there names a retired value, and `observations` has no index naming a retired field.
The three logistics-specific `research_entities` indexes were a different matter, and the first version of this entry got it wrong by asserting they had gone with the earlier field retirement.
They had not: that retirement unset the fields on every document and left `archived_1_undergraduateCurrentAvailability_1`, `archived_1_undergraduateCompensationModel_1` and `archived_1_undergraduateEligibleStudentLevels_1` physically present, which is the standing lesson that unsetting a field never drops its index.
A Development cleanup was therefore warranted for exactly those three, and `retire:undergraduate-logistics-fields --apply` dropped all three on Development, verified by re-reading `research_entities.indexes()` rather than by trusting the script's own count.
`ResearchEntity` no longer declares the fields, so `autoIndex` cannot rebuild them.
Beta and Production keep their own copies of the three, because promotion copies documents rather than index definitions, so a promotion does not clear them and whoever runs one should drop them there as well.

The 7 `signals` rows and 209 already-inactive `observations` rows are deliberately left in place, because they are unreachable from every read path and they are the evidence for this entry.

## 2026-09-23: An Invalid Index Specification Is Its Own Failure Class, Not Index Drift (#3081)

The `fellowships.sourceKey` unique index had never existed in any environment, and the reason was not the corpus.
Its declaration mixed `sparse: true` with `partialFilterExpression`, which MongoDB refuses outright: "cannot mix \"partialFilterExpression\" and \"sparse\" options".
The #2233 entry below records this drift as "a unique index that cannot build because a duplicate value exists", which was half the cause and the less important half.
A duplicate value is a corpus problem a repair clears; an invalid specification can never build in any environment against any data, so no repair helps and waiting for one is the trap.

Decision: the two classes are reported separately.
`unbuildableIndexSpecReason` names the rejection for a single spec and `reportUnbuildableDeclaredIndexSpecs` reads every registered model, so `db:build-indexes` refuses before it builds anything and says the declaration is the defect.
Only rejections this repository has actually hit are listed, because guessing at the server's validation rules would refuse specs MongoDB accepts.
A test asserts no registered model declares such a spec, which is the guard that keeps the class from landing again; the build-blocked-by-corpus message now quotes the server's own reason per collection instead of asserting a cause.

`sparse` is dropped rather than the partial filter, because `{ sourceKey: { $type: 'string' } }` already excludes every row `sparse` was for and additionally excludes an explicit null.
`analytics.dedupeKey` already declares exactly that shape.

Resolving the one colliding pair was a judgement, not a script.
Both rows carried the same title, summary, description and `sourceUrl`, and the department page is the authority on its own awards: it offers exactly two research grants to French majors, one award each per year.
So the corpus held one award twice rather than two awards that collided, and the two CommunityForce links are two listings of it, only one of which exposes an application cycle.
The surviving row is the live one, which is also the rule `findFellowshipByNormalizedTitle` already resolves a re-scrape with, and it is the only row a gate can ever serve.
`fellowships:repair-duplicate-source-keys` retires the other row's claim by unsetting `sourceKey`, so the document is preserved rather than deleted, and it refuses any group that no single live row decides instead of breaking the tie by timestamp.

## 2026-09-22: A Resolver Refusal Count Is Made Usable, Not Driven To Zero (#2582)

`sourceUrlToResearchHomeWebsiteUrl` refuses 271 of the 1,377 served `websiteUrl` values on Development, which reads like a 20 percent data-quality problem and mostly is not.
With every refusal attributed to the arm that produced it, 52 are defects and 219 are one arm declining a host shape it was never taught.
That arm is `isSpecificYaleResearchHomePath`, whose whole vocabulary is `lab|labs|project|group`: 170 refusals are a centre or a person's own page on a school subdomain such as `/research/centers/<name>`, 31 are a `www.<school>.yale.edu` legacy host, and 18 are a custom subdomain whose trailing label is not in `sharedTrailingHostLabel`.

The obvious action on the raw count is a repair pass that clears the refused values.
That pass would delete the served website of 219 entities that have a correct one, and a cleared row is indistinguishable from a row that never had one, so the loss would not be visible afterwards.

Decision: publish the split rather than the total, and make the resolver itself the source of the reason.
`researchHomeWebsiteUrlDecision` returns the refusing arm and, on the path-vocabulary arm, the host shape that also declined; `sourceUrlToResearchHomeWebsiteUrl` is its `url`, and `isCustomYaleResearchHomeSubdomain` is the null check on `customYaleResearchHomeSubdomainRefusal`.
`yarn --cwd server research-entity:audit-website-url-refusals` reports `defects` alongside `refused`, so the number is usable as a standing audit whose target is zero defects rather than zero refusals.

The reason has to come from the resolver rather than from a caller re-walking the same predicates, and the issue is the evidence: it attributed 41 refusals to `isBareDomainRootUrl` firing ahead of the subdomain rule, and this resolver never calls `isBareDomainRootUrl` at all.
Those rows are refused because their host's trailing label is unrecognized, so reordering anything would have fixed nothing.
A `faculty.som.yale.edu` host stays a defect on the same arm, because a faculty directory is never a research home; that is why the host shape is reported and not just the arm.

Extending the path vocabulary per entity shape is still the right repair for the 219 and is deliberately not done here: it changes which URL every future materialization promotes, so it needs its own measurement.

## 2026-09-22: An Identity Key Is Looked Up By Inverting Its Normalizer, Not By Storing A Second Copy (#3036)

The decision below held the resolve-at-mint go-live until a normalized URL identity key was stored on the row, because `findEntityCandidatesByKey` had nothing to scan for the `website-url` namespace.
A stored column turns out to buy none of the prevention it was supposed to unlock.

`normalizeWebsiteUrlIdentityKey` drops only three things reversibly: the scheme, a leading `www.`, and a trailing slash.
So the eight spellings that fold into a key can be enumerated and looked up against the stored `websiteUrl` directly.
Measured on Development against the 101 entityKeys that actually reach the resolver, the enumeration finds all 32 folds a stored key would find and 0 that only a stored key would find.
Corpus-wide the inverse recovers 1,756 of 1,763 live `websiteUrl` values; the 7 it cannot are 5 with a query string, 1 with a fragment, and 1 path-normalization case, and none of them is a resolver target.

The column's cost is not the field, it is the maintenance obligation: more than twenty scripts write `websiteUrl`, and each would have to rewrite the derived key or the resolver folds a mint onto a URL the row no longer holds.
That is the same objection #3027 raised against the alias ledger - a mapping every caller has to remember - moved from a side collection into a side column.

Decision: resolve a normalized identity key by inverting its normalizer where the normalizer is invertible, and keep the encoder and the inverse adjacent so the coupling is visible.
Store a derived key only for a namespace whose normalizer is lossy in a way enumeration cannot cover, and only after measuring that the stored form finds folds the enumeration does not.
`profile-lab-url` and `org-name` are that case today and stay unresolved: both lower-case part of the value, and a `profile-lab-url` arm would add 5 folds.

## 2026-09-22: Resolve-At-Mint Go-Live Is Held, Because The Flag Prevents Nothing (#2572)

The go-live for C4's prevention half was ready to set `C4_RESOLVE_AT_MINT_ENTITIES` on Development, on the honest footing that it moves 0 served rows today and earns its value at the next sweep.
Measurement says it earns nothing at the next sweep either.

Retiring the canonical-alias ledger (#3027) removed the only resolver for the `website-url`, `profile-lab-url` and `org-name` keys, so `findEntityCandidatesByKey` resolves only `slug` for an entity and `source-key` for a fellowship.
The mint path resolves both of those itself, and more broadly, before the resolver is reached, and the resolver only runs when that lookup returned nothing.
The one shape that could still differ is an observed `slug` that does not equal its `entityKey`: of 8,175 active `slug` observations on Development, 0 differ, and of 356 active fellowship `sourceKey` observations, 0 differ.
The instrument is not returning an empty set: the same comparison finds 8,088 distinct entityKeys where the two are equal.

The 786-of-1,240 simulated prevention that justified the go-live does not measure the flag.
`scoreDedupeStrategy` blocks on its own key set and its own union-find and never calls `resolveCanonical`, so it scores keys the shipped resolver cannot read.
It is a ceiling for the dedupe idea, not a forecast for this flag.

Decision: do not set the flag, by the runbook's own standard, which already refuses `C4_RESOLVE_AT_MINT_USERS` because setting it is a step that looks done and changes nothing.
Superseded in part by the entry above: #3036 restored the `website-url` arm, so the flag now folds a measured 32 mints and the hold is no longer a reachability gap. Whether 32 is worth a resolver in the mint path is a product call.
Three reachability cases in `entityMaterializerResolveAtMintEntities.integration.test.ts` pin the gap, one per key namespace and per resolver arm, and all three flip when a resolver is restored, so they are detectors rather than a record of the status quo.

## 2026-09-24: One Served-Citation Policy, Four Paths (#3312)

A whole-payload census over 3,355 served rows found eight paths carrying a url a health record judges gone, where "gone" is `UNAVAILABLE` plus a 404 or 410 and excludes the 50 status-less records, TLS failures and private addresses.
Four of those paths were then decided separately, and two ended up opposite on a single rendered list: a dead `sourceUrls` entry was dropped while a dead `websiteUrl` was still added and marked, so the Sources list qualified one dead citation and silently hid another.

Decision: the four rules below are settled together and live in one owner, `servedCitationPolicy`, which every surface asks.

1. A dead **citation** stays, qualified. `sourceUrls`, `sourceFieldContributions`, and the `websiteUrl` entry as a citation remain in the Sources list marked unavailable.
   They are the record of what a page cited, and #2556 already stated it: "the citation itself survives in the Sources list, qualified, because it is real provenance".
   `researchDetailSources` sets `isLikelyUnavailable` per source from the health record and groups the unavailable ones last on purpose, so withholding the url starves the pathway built to qualify it: a source the payload never carries cannot be marked.
   Never silently dropped.
2. A dead **access-signal** url is withheld, and the `excerpt` is kept.
   An access signal is an instruction telling a student how to get involved rather than provenance a reader may audit, so a student following it gets nowhere while the excerpt preserves what it said.
   The signal itself is not retired, because a 404 is not evidence a programme ended: a removed url is equally a renamed one, which is why `classifyYaleProfilePersonPresence` treats every non-2xx as indeterminate (#3144).
3. The `websiteUrl` **call-to-action** is suppressed separately, which `isUnreachableResearchWebsiteCtaUrl` already does at render, while the same url still appears in Sources under rule 1.
   A broken button and a historical citation are different things about one url, and only the button is an offer.
4. One owner. Every surface passes the KIND of citation it is serving rather than re-spelling the verdict test, and the provenance surfaces make the call even though the answer is currently always "keep", so a change to the policy reaches them instead of leaving them to agree by coincidence.

The distinction that decides all four is provenance versus instruction, not per-field precedent.
Absence of a verdict is never a verdict on any path: only a positive unavailable decides anything, because withholding on silence would empty the list.

Two paths remain outside this policy and are tracked separately: `entityRelationships` and `affiliatedRelationships` each carry a citation with no health record reachable by any means, so nothing can tell live from dead there (#3295).
That is the same shape that made access signals look like the only unqualifiable path, and an argument resting on "a client cannot qualify this" was withdrawn for access signals once it turned out the client looks health up by url against the entity's own `sourceLinkHealth`.

## 2026-09-22: A Person's Card May Never Describe Another Organization (#2911)

#2908 withheld a person-scoped row's long body when its subject was a third-party organization and deliberately stopped there, because the card is derived from the body when no stored short survives and refusing both risked a row with no prose at all.
#2915 then withheld the card too, but only on a row whose body had already been refused.
The remaining question was whether a card may describe another organization when the row's own body survives.

Decision: no, and the card is judged on its own terms regardless of the body.

The argument that settles it is not lexical.
Of the 21 live Development rows whose stored card the subject rule refuses while their body survives, 11 carry prose that appears verbatim on more than one person: one school's mission statement on four rows, one imaging core's service line on three, one department's grant total on two, one collaborative's mission on two.
Prose that two different people can both be described by describes neither of them.
The rest are service and care copy rather than research at all: a clinic's screening offer, a day care centre's philosophy, a career-development office's mentorship resources.

The worry #2908 stopped on does not materialise.
Across all 4,756 live rows the change moves 17 browse card lines: 12 are replaced by a line derived from the row's own research-area chips or its own body, 5 lose the line, and 0 rows end with neither body nor card.
A blank card line on a row that still serves a body is the accepted cost, and it is a smaller cost than a line that is false.

One exemption is required and is not a lexical heuristic either.
A first-person singular card is the person's own statement about their own role, and an organization's blurb never uses it: an organization writes "we provide" or "the core supports", never "I support".
Without that exemption the subject rule refuses "As co-Director of the Rheumatology, Endocrine and Geriatrics Syndrome Core, I support and foster research ...", because the organization's own name carries a comma and so lands in the span the leading-adjunct arm reads.
That was the single false positive in 21, a 4.8% rate against the 3.1% #2908 accepted for the body.

Two residual gaps are recorded rather than fixed here, because both live in the body rule and would change what 32 already-refused rows serve.
The leading-adjunct arm requires a comma, so "Housed under the Yale Bioimaging Institute the MR core is a revenue-neutral service provider" keeps its body and the card derived from it serves the same blurb the withhold just refused.
And "The mission of the Cancer Outcomes, Public Policy and Effectiveness Research Center at Yale is to ..." is not in subject position by the rule's reading, so that body survives as well.

## 2026-09-22: A Course-Credit Route Is A Department Fact, And The Cheap Attribution Recovers Nothing (#2214)

`COURSE_SEQUENCE` was retired because a senior essay is done in a lab, so the for-credit route is an attribute of a lab engagement rather than a research home.
That removed the wrong home for the fact without creating the right one: `COURSE_CREDIT_PATHWAY` is 0 of 11,945 stored signals, and the 13 `CREDIT_FORMALIZATION_POSSIBLE` signals that carried the fact are still `archived: false` on 13 `archived: true` hosts whose visibility tier was never set.
The fact is orphaned, not moved.

The surface is reachable, which is what makes this a real gap rather than a guard that cannot fire.
`getResearchGroupDetail` serves every `archived: false` signal whose `type` is in `accessSignalTypes`, `COURSE_CREDIT_PATHWAY` is in that enum, and the client labels an unmapped signal type through its own titleizer, so a row minted on a live entity reaches a student.

Three attributions were open: a signal on the `OrgUnit`, a signal on the lab labelled as departmental, or a signal only where the lab's own page corroborates it.
The third was the cheap one and measurement kills it: of the 449 live entities in the 13 departments those retired rows covered, **0** name a for-credit route in their own stored prose, against a control pattern that matches 2,961 of 4,756 entities.
Across the whole live corpus only 10 entities do, 8 of them served, and not one is in a covered department.
Corroboration is a prose proxy rather than a re-crawl, so it understates, but a zero in exactly the target departments is not a rounding error.

The second was already refused: asserting a departmental fact as a lab fact is the cross-graft error, and a `value` field recording that the evidence is departmental does not stop the card reading as a lab claim.

Decision: the fact belongs to the department, so the attribution is a signal on the `OrgUnit` surfaced on a lab page as inherited department context with the department named as the source.
That is new plumbing rather than a scraper repair, and the plumbing is the whole cost: `Signal` has no polymorphic target, only `researchEntityId`; all 14,210 `RoleAssignment` rows target `RESEARCH_ENTITY` and none targets `ORG_UNIT`; and `OrgUnit` reaches a student today only as a department-pill name through `configService`, never as a record with content.
So re-acquiring the deleted department course pages is the last step, not the first, and a department-to-all-labs fan-out remains forbidden.

## 2026-09-22: The Phase 0 Query-Cost Audit Is Retired, Not Narrowed (#2224)

`model-refactor:query-cost` profiled 16 collections and 66 query-shape labels across the five Phase 0 hot surfaces.
12 of those 16 collections are absent from Development, Beta and `Prod` alike, all three of which hold the same 25 collections, so 38 of the 43 shapes it could still measure returned 0 rows having examined 0 documents and 23 more were `fixture-unavailable` because the fixture they needed comes from an absent collection.
Its `reviewRequired` verdict was therefore permanently true for structural reasons and could not be acted on.

The zero is not an instrument error: the same run reads 3,377 rows from `research_entities` and 459 from `fellowships`, and flags a real blocking sort on the latter.

The issue proposed removing only the `admin-access-review` shapes and recorded that the four access collections still existed in the frozen `Prod` snapshot as a reason to keep them, which measurement refuted.
Narrowing the audit to the four surviving collections was also rejected: the live serve path reads `signals`, `role_assignments`, `research_plans`, `researchers`, `accounts` and `org_units`, none of which the audit ever profiled, so a narrowed version would report green over a hot path it never exercised, which is the worse failure.
Decision: retire the audit whole, keep the source-inferred hot-path document as a historical record, and require a replacement to be written against the current read paths rather than carved out of this one.

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

## 2026-09-22: An Empty Stored Body Is Reclaimable, An Empty Stored Card Is Not (#1908)

A field that stores an empty string is not the same thing as a field that serves nothing, and the two description fields differ on exactly that point.
Measured on Development: zero `student_ready` rows store an empty `fullDescription`, so an empty stored body always means the row shows no body; 26 `student_ready` rows store an empty `shortDescription` and 25 of them serve a card derived at serve time from the body.
So `--reclaim-stranded=fullDescription` can only fill a gap, while the same reclaim on the card would replace copy students already read.
That asymmetry, not the quality of the candidate values, is why the reclaim admits one field and refuses the other.

The same issue also recorded a root cause that does not hold.
It described a scrape-to-materialize trigger gap leaving a good description "stranded in the observation and never materialized".
On every live row whose `fullDescription` is empty while a materializable observation exists, `fieldProvenance.fullDescription.observationId` is exactly the non-superseded observation the materializer plans today.
The materializer did process that observation and stored an empty string; the plan is richer now because the sanitizer and quality predicates it consults have since changed.
The general lesson is that provenance naming an observation is proof the materializer saw it, so a stranded value with provenance is a projection defect or a stale corpus, never a missing trigger.

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
Roughly fifteen scripts called `mongoose.connect` directly with their own options and still defaulted `autoIndex` on; #3932 later routed every entry point through `connectScriptMongo` or `createScriptMongoConnection`, and `db/__tests__/everyEntryPointConnectsWithMongoOptions.test.ts` fails on any new direct connect.
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
Superseded on 2026-10-04 (#4833): such a sentence is now cut at a clause boundary that fits, as `docs/student-ready-definition.md` records.
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
Reproduce the tier counts with `yarn --cwd server student-visibility:gate --collection=research --mode=dry-run` and read the served copy with `yarn --cwd server research-entity:served-scoreboard --baseline <path.json>`.

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
That rule is now expressed, in `researchEntityTypeNameContradiction` in `server/src/utils/researchHomeNameIdentityAuthority.ts`, and read by `research-entity:audit-kind-typing` (#2884).
It has no caller in the visibility gate and must not acquire one, because a contradicting row may be mis-typed or mis-named and the name is the field already in doubt.
The name it judges is the heading the route serves, through `researchEntityDisplayName`, and not the stored `name`: the two differ on 83 of 4,610 live typed Development rows, and judging `name` first flipped the verdict on 7 served rows, 6 of them contradictions reported as clean (#3252).
Re-measured the day after this entry the three sets read 1, 61 and 42, and 16 of the 42 are already reachable by `research-entity:merge-eponymous-fra`, the lane the 2026-08-25 precedence names; the remaining 26 are what the audit exists to surface.

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
The remaining obstacles to one are toolchain, input-file, Atlas access-list, and target-environment questions rather than network ones, and `docs/data-refresh-runbook.md`, "Weekly Development Sweep Runner", records how the runner answers them (#4507).

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
Until it has run against Development, the index document allowlist `RESEARCH_ENTITY_SEARCH_INDEX_DOCUMENT_FIELDS` keeps the stored values out of the Meilisearch documents; it replaced the original `RETIRED_ACCESS_INDEX_FIELDS` denylist in #3944.
Removing the three `filterableAttributes` entries likewise leaves them advertised in each already-built index; `docs/meilisearch-reindex-runbook.md` owns clearing that residue, as it does for `#2527`.

## 2026-09-12: Retire The Identified-Lead Ways-In Signal Producer (#2578)

`deriveIdentifiedLeadWaysIn` minted two `REACH_OUT_PLAUSIBLE` derivation keys, `IDENTIFIED_FACULTY_LEAD` and `ORGANIZATIONAL_HOME`, for any eligible research home with an official non-grant page and one supporting observation.
It exists because #530 and #1361 wanted a fallback that cleared the dominant `missing_action_evidence` blocker without manufacturing undergrad-access claims.

It has no reachable reader, measured at `2275702f`.
Beta and Production each hold 4183 live rows from it, all `confidence=LOW` with `confidenceScore` capped at 0.4 by `Math.min(0.4, ...)` in the derivation itself, so the confidence is structural rather than incidental.
`signalCountsTowardAcceptance`, `accessSignalCount` in the gate, `reachOutPlausibleSignalCreditsActionEvidence`, and `countResearchEntityAlternateAccessPaths` all exclude the two keys by denylist.
`researchEntityBrowseRankService` over-fetches every access signal but feeds only `hasUndergradHostingEvidenceFromSignals`, whose set is `PAST_UNDERGRADS`/`CURRENT_UNDERGRADS`/`FACULTY_SUPERVISES_STUDENT_PROJECTS`.
Since #3593 it reads no signals at all, recorded in its own entry above.
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
#4585 removed the denylist, the guard and the spent script once Development held zero live rows with either key; Beta and Production receive `signals` as a whole-collection copy before code deploys, so they never run the denylist-free code against the old rows.

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

y/labs is a simple, high-quality directory of Yale research whose two co-equal priorities are good data and good search.
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

y/labs is a discovery product, so its top-of-funnel pages are readable without a Yale CAS login rather than gated behind it.
A logged-out visitor can browse and search `/research`, open any public `/research/:slug`, and read `/about`, seeing only the public student-visibility tiers already served to authenticated students.
Anonymous requests carry no authenticated principal, so the read controllers grant no operator authority and apply no personalization; logged-out browsing always uses the global Recommended order and never exposes non-public tiers or operator/admin fields.
Every write and account surface stays behind auth: saved plans, private notes, compare, outreach tracking and drafting, program watch, profiles, analytics, admin, and the seed routes.
On the public surfaces, save and outreach affordances are replaced with a Yale CAS login call to action, and journey analytics stays off for guests.
The read endpoints keep the existing global rate limit and unchanged SSRF, CORS, and CSRF posture.
This resolves the `Decide logged-out discovery` roadmap P0 in favor of public read-only discovery; the alternative of staying Yale-only was rejected because gating the entire corpus behind login is the largest limitation at the top of the discovery funnel.

## 2026-08-23: External/National Programs Are Out Of Scope For Discovery

y/labs stays a Yale-focused directory: its north star is broad, accurate coverage of Yale research homes and Yale undergraduate access, not a national fellowship or REU aggregator.
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

y/labs does not host faculty-authored lab or opportunity submissions.
Research homes, access evidence, postings, and official application routes come from authoritative-source ingestion, with official application URLs rendered only as outbound links.
Missing professor coverage is repaired through bounded, targeted scraper runs against the professor's canonical research homes rather than by asking the professor to maintain a duplicate y/labs record.
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
y/labs navigates to verified official Yale profile URLs and keeps ORCID and Google Scholar only as optional outbound identity links, not as a works feed, verification badge, or activity signal.
The confirmed Phase 3 scope also retires the curated official-profile scholarly-activity surface.
Producers and consumers are retired as a hard cutover with no rollback opt-in: the `Paper` and `PaperAuthor` models and their readers are removed, and the stored `papers`/`paper_authors` collections remain only until a human-gated collection drop.

## 2026-07-25: Development Uses Atlas MongoDB And Local Meilisearch

Its Yale VPN requirement is superseded by the 2026-09-18 entry "Scraper Fetches Do Not Require Yale VPN" above, and the paragraph below is kept only as the record of what was believed at the time.
Its local Beta operator fetch and Beta Render materialization are superseded by the 2026-09-27 entry "Scraper Sweeps Run Only Against Development" above.

Development uses the Atlas `Development` database and local Docker Meilisearch so operators share a disposable integration dataset while keeping search iteration local.
Development can be refreshed one way from accepted Beta through an allowlist-only, Atlas-Beta-to-Atlas-Development copy.
The refresh never reads Beta operational or student-workflow collections, clears Atlas Development non-mirror collections, sanitizes copied account state, and rebuilds local Meilisearch separately.
Unclassified Beta collections block apply until their mirror policy is reviewed.
See [`data-refresh-runbook.md`](./data-refresh-runbook.md) for the current copy set, the account sanitization rule, the observation policy, and which non-mirror collections the clear actually touches, since the environment-local measurement history is preserved by name rather than cleared (#4034).
The VPN-connected local Beta operator fetches observations into the Atlas `Beta` database but does not materialize them locally.
The Beta Render service materializes accepted run IDs and updates its private Beta Meilisearch indexes.
Production receives data only through the guarded accepted-Beta promotion, followed by the Production search and smoke gates.
Environment-specific database users and exact database-name checks enforce the boundary.
Operators authenticate to Yale VPN with their own NetID and Duo, and the team maintains at least two trained Yale-affiliated operators.
Interactive Yale VPN credentials are never stored for cron.
The long-term automation target is an approved team-managed runner on the Yale network rather than a member's personal laptop.

## 2026-07-24: Refactor Around Research Navigation And Evidence

The accepted target separates accounts, public people, role assignments, research entities, evidence claims, and private research plans while retaining bounded REST projections.
y/labs will own evidence-backed research navigation, not a mirrored professor-profile or publication product.
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

y/labs is a research navigation product, not a simple lab-opening board.
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
