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

Only lanes whose output is a function of the pages they fetch and the model answers they receive can be benchmarked, and `BENCHMARKABLE_LANES` in `server/src/scripts/laneBenchmarkRun.ts` lists them.
Pages are frozen at `getCached` and at `fetchPageWithPolicy`.
A rendered-page lane is excluded because its fetch bypasses both, and so are the two center LLM lanes, which fetch with a raw `axios.get`.

An LLM lane is benchmarkable because capture also freezes every model call (#3587).
Each chat-completion response is stored keyed by a hash of the exact request body, and replay serves it, so two replays of unchanged code give the same fingerprint.
A changed prompt, response format, or page-to-prompt step changes the request body, so it is a counted miss rather than a stale answer to a different question.
A lane's own cache of a model answer must key on the whole request for the same reason, as the undergrad lane's `llm:undergrad-v4` key does.
The content-hash gate is ignored during capture and replay, because it skips a target by what the live corpus stored, which is not the code under test.

## The replay

```bash
yarn --cwd server lane:scorecard            # dry run, every benchmark
yarn --cwd server lane:scorecard --apply --confirm-lane-scorecard
```

Replay serves only benchmark pages and blocks the default axios instance, so a page the capture never saw is a counted miss and never a fetch.
The SSRF guard skips its DNS lookup during replay, because nothing can connect, and a live lookup would let the resolver rather than lane code decide which targets reach the cache.
The work planner is ignored during both capture and replay, because it skips targets by when they were last scraped, which is a property of the clock and not of the code.
A lane that also reads the live corpus to choose its targets is only as frozen as that read, and `pagesMissed` is where that drift shows.

## The live-model band

A frozen replay measures the lane's code, never the model.
To measure the model and the prompt, replay the frozen pages with live model calls, several times:

```bash
yarn --cwd server lane:scorecard --benchmark=<benchmark-id> --live-model --runs=3
```

It reports, per field, the minimum, maximum, and mean emitted count across runs and the number of distinct fingerprints, and it never stores a row.
Read a change to an LLM lane's prompt or model against this band: on the first undergrad benchmark, 3 runs over 8 labs emitted between 33 and 36 values with 3 distinct fingerprints.
It calls the paid model once per target per run, so it is an operator command and not a sweep stage.

The `lane-scorecard` Development sweep stage runs the apply form every sweep and stores one `lane_scorecard_snapshots` row per benchmark.
Every capture and replay still goes through the orchestrator, so each one leaves a `scrape_runs` row, and that row is created `invalidated` so source health, freshness, and the barren-streak guard never read a benchmark run as a live run of the lane.

## Reading a row

- `emitted` is every value the lane planned, and `byField` splits it by field.
- `labeledEntityEmitted` is the part of that population a frozen refusal could have judged: a value on a row that carries a refusal at a field this observation is evidence for.
- `knownWrong` is how many of those a refusal names.
- `outputFingerprint` hashes the planned values regardless of order, so two rows with the same fingerprint emitted exactly the same thing.
A field the lane stamps with the run clock, such as the undergrad lane's `lastObservedAt`, is declared in `RUN_CLOCK_FIELDS_BY_LANE` and masked.
A `readAt` key inside a value is masked first, because it is the moment the lane read the page, as in the `dept-faculty-roster` health record's `read.readAt`, and that clock alone made every replay of that lane differ.
Every other date still counts, including a page-stated deadline serialized as a full instant.
Fingerprints stored before this masking landed are not comparable with later ones.

The ratio to watch is `knownWrong / labeledEntityEmitted`, never `1 - knownWrong / emitted`.
A refusal is a negative label only, and a value no refusal names is unjudged rather than correct, which is the defect #3514 removed from the identity harness.

Two replays of unchanged code must give the same fingerprint.
If they do not, the lane depends on something the benchmark did not freeze, and its numbers are not comparable until that is found.

The collections are environment-local and listed in `NEVER_COPY_COLLECTIONS`, so a promotion never replaces a benchmark or its history.
