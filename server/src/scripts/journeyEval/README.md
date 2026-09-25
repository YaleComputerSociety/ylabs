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

The process exits non-zero when any invariant fails, so the invariant half can gate.

## Invariants and rates are different instruments

The harness emits two kinds of result and they are not interchangeable.

An **invariant** is true or false and does not depend on how good the corpus is: a facet count equals the total of a search filtered to that value, paging never serves a row twice, a sorted browse is ordered, a browse does not silently fall back to a degraded search path.
These are properties of the serving code, so a failure is always a defect and an invariant may gate a merge.

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

## Adding a case

Add one object to `journeyCases` in `journeyEvalCases.ts`.
Keep the scoring in `journeyEvalMetrics.ts`, which is pure and has no IO so it stays unit-tested without a database.

A closed browse defect belongs here as a case.
An exploratory query that has not yet found anything stays a throwaway under `/tmp`.
That split is the point of the harness: 16 of the repository's 33 audit-shaped scripts were committed once and never ran again, so each of those defects can return without anything noticing.

A case asserts over a class of rows.
One row wrong in a way only a person can see has no predicate, so it is an operator judgement rather than a case.
Report counts and predicates, never a row identifier, because the report and any issue quoting it are public.
