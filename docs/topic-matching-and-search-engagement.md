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
Neither request carries any notion of intent, so `recordSiteSearch` in `siteSearchAnalytics.ts` owns the decision, and every recorded search is one `AnalyticsEventType.SEARCH` event with the query text the student settled on.

A request is recorded when a signed-in student asked for something on the first page of results.
Page 2 and beyond are the same search being paged through, and the programs surface walks every page of a result set in a loop, so recording per request would turn one search into as many events as the result set has pages.
An empty query with no filters is a browse load, not a search.
An anonymous visitor records nothing, on either surface.
Only the student-chosen filters count: the operator visibility-tier and quality controls are excluded on both surfaces, because counting them would put an admin sweep into the student report as a titled filter-only search.
A request that declares `suggestionProbe: true` records nothing either.
The research surface issues one when a search returns nothing, to find out whether dropping the last term would have matched, so recording it would report a query the student never typed.
Clicking that suggestion is a real search, and it declares `startsNewSearchEpisode: true` instead.
A relaxed query is the failed one with a word dropped, so it would otherwise fold into the zero-result row and erase the coverage gap the report exists to surface; any deliberate re-search offered by the page carries the same mark.

Searches that continue the same typing episode are folded into one row rather than accumulating one row per keystroke pause.
`logEvent` rewrites the student's previous search in place when it is recent, from the same surface, carries the same filters, and its query is an edit of the new one.
Edit means subsequence containment in either direction, which covers prefix growth, mid-string insertion, and a backspace: `mechengineering` through `mechanical engineering` is one query being typed, and no pair in that sequence is a prefix of another.
Containment alone is too loose for a short query, which spells out inside almost any longer phrase (`ai` sits inside `machine learning`), so the two also have to open with the same characters.
The rewritten row keeps the timestamp of the episode's first snapshot, because search attribution counts only the actions recorded after a search, and moving the row forward would orphan a click that already followed the earlier snapshot.
The window is measured from a separate `searchEpisodeUpdatedAt`, the time of the episode's latest snapshot, so a slowly typed query keeps folding instead of leaving a partial row behind; that field is also the compare-and-set the fold writes under, so when two requests race for the same row the loser records its own search rather than being dropped.
Two unrelated lookups stay two searches.
An empty query folds only into another empty query with the identical filter set: reissuing one filter-only result set inside the window is one search, while two different filter sets stay two rows.

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
