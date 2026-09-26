# Topic matching and search engagement

## Program topics

Program discovery uses a deliberately small canonical subject taxonomy in `programTopicService.ts`.
Each subject has explicit aliases, including common student language such as `AI`, `ML`, `NLP`, and `computer vision`.
Normalization lowercases text, removes punctuation, and matches whole normalized phrases.

Subjects are inferred at read time only from existing source-backed program fields such as title, summary, description, eligibility, application information, purpose, and student-facing category.
An inferred subject is a discovery aid, not a claim that an operator curated the program.
Programs with no supported topic evidence receive no inferred subjects.

The same taxonomy normalizes saved-plan research areas and research-home names for fellowship matching.
Topic overlap contributes to the match score alongside compensation, fellowship-compatible evidence, department overlap, application-route evidence, and cycle status.
It does not bypass existing deadline demotion, minimum-score, source, or eligibility caveats.

## What counts as a recorded search

Both discovery surfaces search live.
The programs surface refreshes from a 500ms debounce with no submit affordance, and the research surface refreshes on submit and on every filter change.
Neither request carries any notion of intent, so `recordSiteSearch` in `siteSearchAnalytics.ts` owns the decision, and every recorded search is one `AnalyticsEventType.SEARCH` event carrying the fullest query of the typing episode it belongs to.

A request is recorded when a signed-in student asked for something on the first page of results.
Page 2 and beyond are the same search being paged through, and the programs surface walks every page of a result set in a loop, so recording per request would turn one search into as many events as the result set has pages.
An empty query with no filters is a browse load, not a search.
An anonymous visitor records nothing, on either surface.
Only the student-chosen filters count: the operator visibility-tier and quality controls are excluded on both surfaces, because counting them would put an admin sweep into the student report as a titled filter-only search.
A request that declares `suggestionProbe: true` records nothing either.
The research surface issues one when a search returns nothing, to find out whether dropping the last term would have matched, so recording it would report a query the student never typed.
Clicking that suggestion is a real search and is recorded like any other.
Each recorded event is timestamped when its request arrived, not when its response finished, because two searches issued in order can come back out of order.

An identical repeat of a search - the same normalized query, the same filter set, the same surface, inside the window - collapses into the row it repeats, on every surface.
Re-running a result set is not asking a second question, which is what a sort change does: it re-sends the same query and filters so the student's results can be reordered.

Whether an EDIT of the query folds is the part that varies by surface, declared in `siteSearchAnalytics.ts` and handed to `logEvent` per event.
Only the programs surface searches from a keystroke debounce, so only there is an edited query the same question.
Every research search comes from a submit, a filter click, a sort change, a deep link, or a result chip, and the search box's own typing issues no request, so an edited research query is a second question the student deliberately asked: folding it would erase the first, including the zero-result row the report exists to surface.

Where an edit does fold, `logEvent` rewrites the student's previous search in place when it is recent, from the same surface, and its query is an edit of the new one.
Edit means subsequence containment in either direction, which covers prefix growth, mid-string insertion, and a backspace: `mechengineering` through `mechanical engineering` is one query being typed, and no pair in that sequence is a prefix of another.
Containment alone is too loose for a short query, which spells out inside almost any longer phrase (`ai` sits inside `machine learning`), so the two also have to open with the same characters.
The rewritten row keeps the timestamp of the episode's first snapshot, because search attribution counts only the actions recorded after a search, and moving the row forward would orphan a click that already followed the earlier snapshot.
The row keeps the episode's fullest query, with the newest breaking a tie, because the last keystroke of an episode is often a backspace: keeping the newest snapshot reported `rosenfel` with no results in place of the `rosenfeld` that found one, the misspelling `Schulz` in place of `Schultz`, and the fragment `m` with five results in place of the `math` that had none.
The fullest query is also the one whose coverage gap is worth reading, which a shorter fragment hides.
A query and its result count belong together, so when the stored query wins, the search that arrived changes nothing but the episode's last-snapshot time.

The decisions live in `server/src/services/searchEpisode.ts` and nowhere else, because `analyticsService` applies them when a search is recorded and `yarn --cwd server analytics:collapse-search-episodes` applies them to rows recorded before the fold existed.
That script is a dry run by default; applying deletes the superseded snapshots and the `page > 1` rows and requires `--confirm-search-episode-collapse` and a `--snapshot` artifact, which is the restore point.
Applying also gives each surviving row the episode's first timestamp and its last snapshot time, the same pair the live fold writes, because the fullest query is often not the episode's first row and leaving the later timestamp in place would drop an entity open that already followed the earlier snapshot out of attribution range.
`analytics_events` is in `NEVER_COPY_COLLECTIONS`, so it has to run once per environment and a promotion will not carry it.
The window is measured from a separate `searchEpisodeUpdatedAt`, the time of the episode's latest snapshot, so a slowly typed query keeps folding instead of leaving a partial row behind; that field is also the compare-and-set the fold writes under, so when two requests race for the same row the loser records its own search rather than being dropped.
A snapshot that arrives after the episode has already moved past its arrival time is dropped rather than recorded, so a partial query whose response came back late cannot overwrite the query the student settled on or leave a row of its own.
The lookup reads the student's five most recent candidate rows rather than only the newest one, because an unrelated search recorded in between would otherwise hide the episode row and let that late snapshot land as a search of its own.
Two unrelated lookups stay two searches.
The filter set has to match only for an episode with no query text, which is the filter-only search the comparison was added for: reissuing one filter-only result set inside the window is one search, while two different filter sets stay two rows.
A student who toggles a filter mid-word is still typing one query, so a non-empty edit folds across the change, and the row reports the filters of whichever snapshot's query wins rather than always the newest, because a query and its result count belong to the same snapshot.

The report groups by query, by surface, and, for a filter-only search, by filter set.
Filters are rendered from `metadata.filters` at read time, so a search recorded with no query text reports the filters the student selected instead of a nameless `(empty search)` bucket.
Each filter's values are sorted when rendered, because both surfaces send them in the order the student clicked them, and two students who picked the same values in a different order performed the same search.
Splitting by surface keeps one corpus per row: the same word searched on both surfaces has two different result counts, so merging them would report an average that describes neither and mis-attribute a zero-result search.

## Search engagement

The admin search-success metric is action-aware.
A search is engaged when the same signed-in user views a research home, listing, or program, or saves a pathway, listing, or program, within 30 minutes and before that user's next search.
The next-search boundary avoids attributing an action to multiple earlier queries in the same browsing session.

The dashboard reports engaged searches separately from searches that returned results but received no attributed view or save.
Zero-result rate remains available as a coverage diagnostic.
Attribution is computed from existing bounded analytics events and does not copy query text or direct contact information onto action events.
