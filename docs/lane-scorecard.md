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
Capture misses every cache read, so each page is a live fetch, and `runLaneDry` installs the same host concurrency interceptor the scrape CLI does so a capture honors `HOST_THROTTLE_OVERRIDES` too.
It also freezes the live refusals on every row the lane planned a value for, so a refusal recorded next week does not move this benchmark's score.
A benchmark is frozen once captured: the command refuses an id that already exists, and a new scope is a new benchmark.

Only lanes whose output is a function of the pages they fetch and the model answers they receive can be benchmarked, and `BENCHMARKABLE_LANES` in `server/src/scripts/laneBenchmarkRun.ts` lists them.
Pages are frozen at `getCached` and at `fetchPageWithPolicy`.
A `fetchPageWithPolicy` fetch that failed with an HTTP status is frozen as that status, so a sub-page that answered 404 at capture answers 404 on replay rather than counting as a miss.
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
The Scrapling renderer refuses every call during replay too, so a lane's rendered fallback serves only a rendered page the capture froze and never renders one live.
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
It also reports each run's `pagesServed`, `pagesMissed`, and `networkBlocks`, because a band measured over missed pages mixes lane drift into the model's spread, so read the band only when every run missed nothing.
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

- `refusedAtIngest` counts planned values the observation store would refuse outright, such as the retired `kind` field, and they are left out of `emitted` and `knownWrong`, because a value that is never stored cannot be wrong on a served row.
Before this, three `ysm-faculty-directory` known-wrong values were `kind` claims that never reached the log.

A replay that plans nothing where its capture planned values is not stored and makes the run exit non-zero, because it measured the environment rather than the lane: an LLM lane with no `OPENAI_API_KEY` emits zero, and stored as a score that row would read as a lane with no wrong values at all.

The ratio to watch is `knownWrong / labeledEntityEmitted`, never `1 - knownWrong / emitted`.
A refusal is a negative label only, and a value no refusal names is unjudged rather than correct, which is the defect #3514 removed from the identity harness.

## Hand-judged labels

Refusals can only say a lane is wrong, so a benchmark can also carry hand-judged gold labels, which say what it should have emitted (#3588).
A label is one `(entityKey, field)` pair judged against the frozen benchmark page, never the live page, so the judgement and the input it judges cannot drift apart.
`absent` means the lane should emit nothing for that field, and `present` lists the page text a reader accepted, of which an emitted value must contain one, or be a clause of one at least 20 characters long.
An access verdict is judged on `openToUndergrads` alone, because its quote is judged under its own field.

```bash
yarn --cwd server lane:benchmark-label --id=<benchmark-id> --file=<labels.json>
yarn --cwd server lane:benchmark-label --id=<benchmark-id> --file=<labels.json> --apply --confirm-lane-benchmark-label
```

The file is a JSON array of `{ entityKey, field, expected, acceptable, judgedPageUrl, note }`, and it lives under `/tmp`, never in the repository, because a label quotes a page that can name a person.
The command refuses a label outside the benchmark's `--only` scope, any label on a benchmark captured without `--only`, a `present` label with nothing acceptable, and a repeated pair, and it refuses to overwrite existing labels without `--replace`.
Leave a pair unlabeled when the frozen page cannot settle it, such as a page that captured only site chrome: an unlabeled pair is counted nowhere, which is honest, while a guessed label is a wrong instrument.

Each scorecard row then carries `gold`, one entry per labeled field with true and false positives, false negatives, true negatives, precision, and recall.
A wrong value on a `present` pair is both a false positive and a false negative, so recall is over every `present` label.
A rate is `null` when its denominator is zero, never `0` or `1`.
A live-model run reports the band of each rate as `liveModelGold`.

The first gold benchmark is `undergrad-llm-gold-v1` on Development: 42 labs drawn from three strata of the lane's population, of which 38 were labeled for `undergradEvidenceQuote`, 11 `present` and 27 `absent`.
Its first replay read precision 8 of 12 and recall 8 of 11.
Three live-model runs over the same frozen pages read precision 0.57 to 0.58 and recall 0.64 to 0.73, so the captured answers were a favourable draw and the lane's own band sits below the frozen number.
Quote the band, not the frozen replay, when judging the lane rather than its code.
After #3764 fixed the four false-badge shapes the labels found, the frozen replay read precision 7 of 7 and recall 7 of 11, and three live-model runs read precision 0.88 to 1.00 and recall 0.55 to 0.64.
The recall given up is a bare "Undergraduate Students" heading on a page that does list an undergraduate below it: the heading alone names no one, so the lane now needs the roster line itself.
The sample over-represents rows that already carry a quote, so the rate describes the lane on these strata rather than the corpus, and at this size one row moves precision by about 8 points.

Two replays of unchanged code must give the same fingerprint.
If they do not, the lane depends on something the benchmark did not freeze, and its numbers are not comparable until that is found.

The collections are environment-local and listed in `NEVER_COPY_COLLECTIONS`, so a promotion never replaces a benchmark or its history.
