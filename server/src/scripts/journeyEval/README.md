# Browse journey eval harness

Read-only harness that exercises the real browse path a student hits and scores it, so a browse defect lands as a permanent case instead of a fresh audit script.
It never writes to live collections.

Run it against a data-profile DB (Development) from `server/`:

```bash
yarn journey:eval --window=100 --pages=3 --facet-values=3 --output="$TMPDIR/journey.json"
```

Flags:

- `--window=<N>` sets the browse page size each case requests, so it is also the sample size for the rates.
- `--pages=<N>` sets how many pages the pagination case walks.
- `--facet-values=<N>` sets how many of the highest-count department facet values the agreement case checks.
- `--case=<id>[,<id>]` runs a subset, which is how you re-run one case while fixing the lane behind it.
- `--output=<path>` writes the JSON report under `$TMPDIR` or `./tmp`, enforced by `resolveSafeJsonReportOutputPath`.

Read the report from the `--output` file rather than stdout.
The shared database bootstrap logs a line to stdout before the report, so stdout is for humans and the file is the machine-readable artifact.

The process exits non-zero when an invariant fails, so the invariant half can gate.
An inconclusive invariant does not set a failing exit code and is named on stderr, so it reads as neither green nor a defect.

## Invariants and rates are different instruments

The harness emits two kinds of result and they are not interchangeable.

An **invariant** is true or false and does not depend on how good the corpus is: a facet count equals the total of a search filtered to that value, paging never serves a row twice, a sorted browse is ordered, a browse does not silently fall back to a degraded search path.
These are properties of the serving code, so a failure is always a defect and an invariant may gate a merge.

An invariant carries a third status, **inconclusive**, for the case where the run cannot decide.
Development is written while the harness reads it, and two checks are confounded by that.
Paging walks pages 1..N as separate requests, so a write between two of them re-ranks the index and a row legitimately crosses a page boundary and is served twice.
Attribution recomputes the coherence guard from the row's current stored state and compares it to the indexed value, so a write between the two reads makes an accounted-for drop look unaccounted-for.

Both cases take a corpus fingerprint, the row count plus the latest `updatedAt`, before and after their reads, and report inconclusive when the corpus moved.
The confound is one-directional in both, which is what makes the rule tighter than "moved, so give up": corpus mutation can manufacture a repeat but cannot hide one, so zero repeats is a genuine pass even on a moving corpus, and the same holds for zero unexplained drops.
Attribution also reports inconclusive when no row could be compared at all, because a zero unexplained count over an empty population is a green signal that means nothing.

Verified by running four times against a live Development: before this rule the same three checks returned 24, 21 and 16 drops with 1, 1 and 0 unexplained and 3, 3 and 2 page repeats, failing twice for reasons no code change caused.

A **rate** is a number that moves when the corpus moves: the share of browse cards serving a topic, the share of topic drops the coherence guard accounts for.
A rate must never gate, because a peer writing Development changes it between two runs and the resulting failure belongs to nobody.
Track rates over time and compare them against the Corpus Quality panel.

Hold `--window` constant when comparing two rate measurements.
The window is the top of the default browse ranking, so a deeper window reaches weaker rows and the rate falls: measured on Development the topic rate is 0.96 at `--window=50` and 0.89 at `--window=100`.
Neither number is the corpus-wide figure, and a rate compared across two different windows is not a comparison.

## Why the topic case asserts attribution rather than equality

Measured on Development, 14 of the first 100 browse cards serve fewer topics than they store and 3 serve none while storing some.
Every one of those is `dropDomainIncoherentUnsourcedResearchAreas` withholding research areas that are both unsourced and domain-incoherent, which is the guard working.

So an assertion that served topics equal stored topics would fail 14 times on its first run and teach everyone to ignore the check.
The assertion that carries signal is that every drop is attributable to a named guard: it reads zero today, stays quiet while the guard is right, and fires only on a drop nothing accounts for.
Apply the same shape to any new case.
Assert that the difference between stored and served is explained, not that it is absent.

## Supplying topic-query relevance judgements

Retrieval quality cannot be derived from the corpus.
It needs a human judgement about what a query should return, and that judgement lives in `topicQueryJudgements.json`.

```bash
yarn journey:eval --case=topic-query-relevance
yarn journey:eval --case=topic-query-relevance --judgements=/tmp/my-judgements.json
```

A judgement states a **predicate** a relevant result satisfies rather than listing the rows it expects.

```json
{
  "query": "neuroscience",
  "note": "why this query is worth judging",
  "topK": 10,
  "minRelevant": 8,
  "relevantWhen": {
    "anyTopicMatches": ["neuro", "brain", "cognit"],
    "anyDepartmentMatches": ["Neuroscience", "Psychology"],
    "anyTextMatches": ["synap"]
  }
}
```

A served card counts as relevant when any supplied matcher hits, compared case-insensitively as a substring.
`anyTopicMatches` reads `researchAreas`, `anyDepartmentMatches` reads `departments`, and `anyTextMatches` reads the name, display name, short description, card description, topics, and departments together.
The case reports `precisionAtK` and the rank of the first relevant result, and asserts `relevant >= minRelevant`.

Set `expectNoResults` instead of a matcher to judge the zero-result path, which keeps a legitimately empty search distinguishable from a broken one.

Two rules the format enforces, both rejected at parse time rather than producing a misleading score: a judgement must assert something, so one with neither `expectNoResults` nor a matcher is an error; and `minRelevant` must lie within `0..topK`, so a floor that can never be met is an error.
A query that returns nothing to judge is inconclusive rather than passing, and a missing judgements file makes the whole case inconclusive, because a retrieval score over an empty query set is a green signal that means nothing.

Judgements never name a row. A faculty research profile slug is person-bearing, so a checked-in file pairing one with "expected in the top 10 but not served" would be a defect judgement beside a person identifier in a public repository, which `docs/person-identifier-convention.md` rules out and which editing the file later would not remove.
A row list would also rot, because rows merge, archive, and are reminted, decaying into false failures that say nothing about retrieval.
Keep a private or experimental set outside the repository and point at it with `--judgements`.

Write the matchers as tightly as the judgement really is.
Permissive substring lists inflate `precisionAtK`, so a high score against a loose judgement measures the judgement rather than the retrieval.

## Adding a case

Add one object to `journeyCases` in `journeyEvalCases.ts`.
Keep the scoring in `journeyEvalMetrics.ts`, which is pure and has no IO so it stays unit-tested without a database.

A closed browse defect belongs here as a case.
An exploratory query that has not yet found anything stays a throwaway under `/tmp`.
That split is the point of the harness: 16 of the repository's 33 audit-shaped scripts were committed once and never ran again, so each of those defects can return without anything noticing.

A case asserts over a class of rows.
One row wrong in a way only a person can see has no predicate, so it is an operator judgement rather than a case.
Report counts and predicates, never a row identifier, because the report and any issue quoting it are public.
