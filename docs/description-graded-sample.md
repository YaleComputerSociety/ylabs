# Description graded sample

`corpus:snapshot` counts shapes a rule can see.
Whether a served description is accurate, and whether it tells a student what is studied, needs the cited page read, so it is measured by a graded sample (#4809).

## Procedure

1. Draw a fresh stratified random sample of `student_ready` rows: 60 faculty research profiles, 40 labs, and 20 centers, cores, institutes and initiatives.
2. Read each row through the detail route (`GET /api/research/:slug`), which serves the same card text as the search route.
3. Fetch each row's cited page (`fieldProvenance.fullDescription.sourceUrl`, else the short description's, else `websiteUrl`) sequentially, one host at a time, through `fetchPageWithPolicy`.
Parallel fetches read throttled pages as dead.
4. Keep the whole page body.
The first run cut page dumps at 15,000 characters, and 6 of the 8 "unsupported" verdicts it produced were claims further down the page.
5. Grade every row with the rubric below.
6. Re-check every `unsupported` and `contradicted` verdict by hand against the full live page before it counts.
Only a verified case counts as wrong.

Write the sample, the page dumps, and the verdicts under `/tmp`, never into the repository.
A verdict pairs a row with a defect judgement, and this repository is public.

## Rubric

Students scan the browse card: the served card text cut to the last whole sentence within 200 characters, otherwise cut at a word with "…", as `docs/corpus-quality-panel.md` describes.
The full text shows on the entity page.

| Field | Values | Meaning |
|---|---|---|
| `wrong_entity` | true, false | The row is not a Yale research entity (a book, a federal program, a course, a news item, staff who are not research faculty), or the text describes a different entity than the row's name. |
| `accuracy` | accurate, unsupported, contradicted, no_page | Accurate when every factual claim in the card and full text is supported by the page, paraphrase included. |
| `card_scent` | good, weak, bad | Good when a student learns what is studied, specifically, from the card as cut. Weak when it is vague, a topic or department list, mission-only, background framing, a narrow sub-detail without the big picture, or cut with "…". Bad when it is chrome, biography or CV, news, recruiting, or wrong. |
| `card_problem` | cut_off, too_vague, dept_or_topic_list, background_framing, mission_only, bio_cv, chrome, news, recruiting, narrow_detail, none, other | The main reason a card is not good. |
| `full_quality` | good, has_junk, bio_cv, fragment, off_topic, missing | Has junk when research prose is mixed with breadcrumbs, notices, awards, funding rhetoric, repeated sentences, contact details, or title and degree lists. Fragment when it starts or ends mid-thought or is a slice of a paper. |
| `methods_on_page`, `methods_in_card` | true, false | The page, or the card, says how the work is done: organisms, techniques, data, field sites, instruments, archives. |
| `better_text_on_page` | true, false, with a verbatim quote | The page carries a clearly more specific self-description than the one served. |

A thin but accurate research sentence ("Studies galaxy evolution.") is accurate.
Its card is weak only when it is too generic to say what is studied.

## Reported numbers

Report each as a count over the sample, never as a bare rate:

- wrong: `wrong_entity`, plus verified `contradicted` or ungrounded rows,
- card that says what is studied: `card_scent` good,
- clean research full text: `full_quality` good,
- method dropped: `methods_on_page` true and `methods_in_card` false,
- better text left on the page: `better_text_on_page` true.

Baseline on Development, 2026-10-04: 12 of 120 wrong, 45 of 120 good cards, 72 of 120 clean full text, 41 of 73 methods dropped, 26 of 120 better text on the page.
