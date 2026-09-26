# Lane scorecard

The lane scorecard answers one question the other instruments cannot: did this lane get better or worse, measured on the same input?

`corpus:snapshot` counts stored values over a corpus that grows, `journey:eval` reads what browse serves, and the served scoreboard verifies one fix.
Each of those moves when the corpus moves, so none of them can separate a lane improving from the corpus changing underneath it.
The scorecard holds the input still, so the only thing left to move the number is the code (#3526).

## The frozen input

A benchmark is one lane, one fixed scope, and the pages that lane fetched for that scope on one day.

```bash
yarn --cwd server lane:benchmark-capture --source=dept-faculty-roster --only=<keys> --id=<benchmark-id>
yarn --cwd server lane:benchmark-capture --source=dept-faculty-roster --only=<keys> --id=<benchmark-id> --apply --confirm-lane-benchmark-capture
```

Capture runs the lane as a dry run and records every page it would have written to `scrape_snapshots` into `lane_benchmark_pages`, which has no TTL.
It also freezes the live refusals on every row the lane planned a value for, so a refusal recorded next week does not move this benchmark's score.
A benchmark is frozen once captured: the command refuses an id that already exists, and a new scope is a new benchmark.

Only lanes whose output is a function of the pages they fetch can be benchmarked, and `BENCHMARKABLE_LANES` in `server/src/scripts/laneBenchmarkRun.ts` lists them.
LLM lanes are excluded because one run of an LLM lane is not repeatable, and a rendered-page lane because its fetch bypasses the cache.

## The replay

```bash
yarn --cwd server lane:scorecard            # dry run, every benchmark
yarn --cwd server lane:scorecard --apply --confirm-lane-scorecard
```

Replay serves only benchmark pages and blocks the default axios instance, so a page the capture never saw is a counted miss and never a fetch.
The work planner is ignored during both capture and replay, because it skips targets by when they were last scraped, which is a property of the clock and not of the code.
A lane that also reads the live corpus to choose its targets is only as frozen as that read, and `pagesMissed` is where that drift shows.

The `lane-scorecard` Development sweep stage runs the apply form every sweep and stores one `lane_scorecard_snapshots` row per benchmark.

## Reading a row

- `emitted` is every value the lane planned, and `byField` splits it by field.
- `labeledEntityEmitted` is the part of that population a frozen refusal could have judged: a value on a row that carries a refusal at a field this observation is evidence for.
- `knownWrong` is how many of those a refusal names.
- `outputFingerprint` hashes the planned values regardless of order, so two rows with the same fingerprint emitted exactly the same thing.

The ratio to watch is `knownWrong / labeledEntityEmitted`, never `1 - knownWrong / emitted`.
A refusal is a negative label only, and a value no refusal names is unjudged rather than correct, which is the defect #3514 removed from the identity harness.

Two replays of unchanged code must give the same fingerprint.
If they do not, the lane depends on something the benchmark did not freeze, and its numbers are not comparable until that is found.

The collections are environment-local and listed in `NEVER_COPY_COLLECTIONS`, so a promotion never replaces a benchmark or its history.
