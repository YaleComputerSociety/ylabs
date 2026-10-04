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

`--source-concurrency=<n>` caps how many fetches the lane makes at once during capture, so a capture against a host that throttles, such as the Yale sites, can run at `1`.
Only `lab-microsite-undergrad-llm` and `lab-microsite-description-llm` read that cap, so capture refuses the flag for any other lane rather than silently fetching at the lane's default.
Replay makes no fetches, so it needs no such cap.

Capture runs the lane as a dry run and records every page it would have written to `scrape_snapshots` into `lane_benchmark_pages`, which has no TTL.
Capture misses every cache read, so each page is a live fetch, and `runLaneDry` installs the same host concurrency interceptor the scrape CLI does so a capture honors `HOST_THROTTLE_OVERRIDES` too.
It also freezes the live refusals on every row the lane planned a value for, so a refusal recorded next week does not move this benchmark's score.
A benchmark is frozen once captured: the command refuses an id that already exists, and a new scope is a new benchmark.

Only lanes whose output is a function of the pages they fetch and the model answers they receive can be benchmarked, and `BENCHMARKABLE_LANES` in `server/src/scripts/laneBenchmarkRun.ts` lists them.
Pages are frozen at `getCached`, at `fetchPageWithPolicy`, and at the Scrapling renderer.
A `fetchPageWithPolicy` fetch that failed with an HTTP status is frozen as that status, so a sub-page that answered 404 at capture answers 404 on replay rather than counting as a miss.
The two center LLM lanes stay out, because they fetch with a raw `axios.get` that none of those freeze.

A rendered page is frozen at `createScraplingRenderedFetcher`, the one place every rendered lane gets its renderer (#3590).
Capture records whether a renderer existed at all, because a lane with no renderer takes a different path from one whose render returns nothing, and it records every render, including a null or blocked result.
Replay reproduces both: no renderer when the capture had none, and otherwise a renderer that serves the frozen render or counts a miss and refuses.
During capture and replay the renderer freeze is the only record of a render, so the lane's own rendered-page cache stays out of the benchmark and every usable render on replay is served by the frozen renderer.
A benchmark captured before #3590 has no record of the renderer, so it replays as it did before: the renderer the replay environment builds refuses every call, and a render is served only from the lane's rendered-page cache the capture froze.
`centers-institutes-index` and `student-grants-database` joined `BENCHMARKABLE_LANES` on this basis.
`student-grants-database` also reads the live corpus to choose its targets: it adds every FundDetails page the live catalog cites to the funds it reads (#3984).
A fund first cited after capture is therefore a page the benchmark never froze, so it counts in `pagesMissed` rather than changing the score, and a benchmark scoped with `--only` holds its fund list still.
Its static grid enumeration (#4214) never runs under `--only` or during any capture or replay, because a postback carries per-session view state that no replay could serve, so `programs-grants-gold-v1` replayed with the same fingerprint before and after it landed.
`yale-college-fellowships-office` joined once its page fetch moved from a raw `axios.get` onto `fetchPageWithPolicy` (#4132), and a dry-run explain of the whole lane before and after that move planned the same 4,009 values.
That lane reads no `--only`, so its capture freezes the whole crawl and the scope only bounds which programs may carry labels.
It also reads the live corpus once a page is refused as not a program, to find the row that page minted and plan its `archived: true` retraction (#4110), so those retraction values move with the corpus rather than with the lane.

A replay is compared only once it has resolved something from the frozen input.
One that served none of its frozen pages, or a rendered lane that served none of its frozen renders, is reported as unscored rather than scored, because it measured a path that never engaged.
A lane that aborts because it requested a page or render the capture never froze is reported as unscored too, so one such benchmark does not stop the sweep before the others store their rows.

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
A live Scrapling renderer built before a replay began still refuses every call during it, so no replay renders a page live.
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

## The analytics panel

`/analytics` shows every stored benchmark in the "Is each lane getting better?" panel, served by the admin-only `GET /api/analytics/lane-benchmarks` (#3591).
Each benchmark shows its latest stored replay, and each change compares it with the replay stored before it, never with a live run.
A stored replay that missed more than its capture left unfrozen is left out of both, as "Hand-judged labels" below describes.
Known wrong is shown over its labeled population, input coverage as pages served and missed, and each hand-labeled field as precision and recall with their counts.
Each of those carries its change from the previous replay, so a lane with no hand labels still shows whether it got better or worse.

The panel reads the output fingerprint and the code version together, because a fingerprint is a pure function of the frozen input and the code:

- Same fingerprint: the lane emitted exactly what it emitted before.
- New fingerprint and new code: the change came with a code change, which is what a scorecard exists to show.
  The code version is the repository head, not the lane's own code, so an input leak that surfaces across an unrelated commit reads here too; only two replays on the same head prove a leak.
- New fingerprint and the same code: the frozen input leaked, so the benchmark depends on something it did not freeze and its numbers are not comparable until that is found.
- New fingerprint with no recorded code version on either side: the change cannot be attributed.

A live-model band is never stored, so it never appears here; read it from `--live-model`.
Engine benchmark snapshots are stored in `engine_benchmark_snapshots` by `engineBenchmark.ts`, keyed by `benchmarkId` and `stage`, but no panel reads them yet.

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

Gold labels score `researchEntity` and `fellowship` observations, and each is checked against the ingest refusals for its own entity type.
A fellowship's structured fields compare by kind rather than by containment, because a URL, a date, or a set contained in another is a different value rather than a shorter quote of it.
The comparison is chosen by entity type and field together, so a research-entity field that shares a name keeps containment.
`applicationLink` compares as a URL after upgrading `http` to `https`, lowercasing the host, and dropping the fragment and any trailing slash.
`yearOfStudy`, `termOfAward`, and `purpose` compare by set equality, with each acceptable set written as a JSON array string, so a superset does not match.
A `deadline` label written `YYYY-MM-DD` matches an emitted instant that falls on that America/New_York calendar date, and one written `YYYY-MM-DDTHH:MM` matches only the same New York minute.
`requiresMentorBeforeApply` and `entryMode` compare by exact value, and a fellowship `title` and `contactOffice` keep containment.
A fellowship `eligibility` is a statement: it matches when it is a clause of an acceptable value at least 20 characters long, or contains one and runs at most 400 characters past it (#4233).
Plain containment would credit a lane that stored a whole page as the statement, which is the failure a statement field invites.
No lane emits `requiresMentorBeforeApply` or `entryMode`, because the materializer derives them with the program classifier.
The scorecard therefore derives both per program from the replay's planned observations with `classificationFromObservedFacts` and scores that derivation, and a program with no planned observations derives nothing.
That function runs the materializer's own `planFellowshipClassification` on the observations as a pass staging every one of them, so the scorecard reads the same uncapped, contact-redacted prose the materializer classifies and scores the value a student is served (#4232).

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

`undergrad-llm-gold-v2` re-captures the same 42 labs, because #3762 changed the page text the prompt carries for six of them, which turned their frozen v1 answers into misses.
A frozen answer is keyed by the exact request, so any change to the page-to-prompt step stales a benchmark in this way; re-capture, and carry a label over only when the lab's frozen page text is unchanged or has been re-read.
Of v1's 38 labels, 35 carried unchanged, 2 were re-read and kept, and 1 dropped because v2 captured no home page.
On v2, #3775 moved the frozen replay from precision 7 of 8 and recall 7 of 11 to 9 of 9 and 9 of 11.
Three live-model runs on v2 then read precision 1.00 and recall 0.82 in every run.
The sample over-represents rows that already carry a quote, so the rate describes the lane on these strata rather than the corpus, and at this size one row moves precision by about 8 points.

A replay may miss only the requests its capture could not freeze, which a capture records as `unfrozenRequestCount` (#3816).
Missing more means the lane asked for something the benchmark never held, most often a changed prompt whose model requests no longer match the frozen answers, so the replay is reported unscored rather than stored, and the dashboard leaves such stored rows out of the trend.
A benchmark captured before that count existed uses its first replay at its own capture commit as the baseline, and without one any miss is refused, so it must be recaptured to score again.
Changing a lane's prompt therefore invalidates that lane's benchmarks until they are recaptured.

Two replays of unchanged code must give the same fingerprint.
If they do not, the lane depends on something the benchmark did not freeze, and its numbers are not comparable until that is found.

The collections are environment-local and listed in `NEVER_COPY_COLLECTIONS`, so a promotion never replaces a benchmark or its history.
They are also listed in `PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS`, so the Development refresh never clears one either (#4034).
Being unmirrored used to be the reason the refresh destroyed them, because the refresh cleared every collection Beta does not mirror; the allowlist is what makes "never mirrored" mean "kept" rather than "unprotected".
