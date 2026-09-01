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

## Search engagement

The admin search-success metric is action-aware.
A search is engaged when the same signed-in user views a research home, listing, or program, or saves a pathway, listing, or program, within 30 minutes and before that user's next search.
The next-search boundary avoids attributing an action to multiple earlier queries in the same browsing session.

The dashboard reports engaged searches separately from searches that returned results but received no attributed view or save.
Zero-result rate remains available as a coverage diagnostic.
Attribution is computed from existing bounded analytics events and does not copy query text or direct contact information onto action events.
