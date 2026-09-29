# Engine benchmark

The engine benchmark answers for resolve, derive and gate the question `lane:scorecard` answers for a scraper lane: did this layer get better or worse, measured on the same input?

The lane scorecard stops at the observations a lane plans.
Everything after that - materialization, `confidenceResolver`, the derivations, the field-value refusals, the locks, and the student visibility gate - runs on every resolve, and a regression in any of it used to show up only later as corpus drift, mixed in with every lane's writes and every peer session's (#3526 records why a corpus delta cannot be attributed to one cause).
This holds the engine's input still, so the only thing left to move the number is the code (#3589).

## What is frozen

A benchmark is a fixed set of rows, and for each row the whole input the engine reads:

- its observations, as they stood at capture, with their `scrapeRunId` and their supersession state;
- its stored document, which carries `manuallyLockedFields`, the standing `fieldValueRefusals`, and the archive and tombstone state;
- whether anything is merged into it, because a survivor reads its losers' evidence;
- the per-row inputs the visibility gate reached its verdict on.

The gate inputs are read off `planStudentVisibilityGate` rather than rebuilt.
Every one of them is either corpus-wide (the duplicate-risk flags, the shared-citation flag) or a join (the access-signal count, the lead rows), so a benchmark that recomputed them from a scoped read would be freezing its own reimplementation instead of the gate's input.
The known-person surname roster is corpus-wide, so it is held once for the benchmark rather than per row.

The scope is rows that exercised a known engine defect, never a first-N sample: merged survivors, rows carrying a field-value refusal, rows carrying a manual lock, rows the gate holds, and rows the gate serves.
`ENGINE_BENCHMARK_SCOPE_PREDICATES` in `server/src/scripts/engineBenchmarkRun.ts` is the list, and each entry is a predicate rather than a set of slugs, so the capture describes what it froze without naming anybody (`docs/person-identifier-convention.md`).

## Capture

```bash
yarn --cwd server engine:benchmark --capture --apply --confirm-engine-benchmark
```

Capture is gated behind the apply confirmation, and refused outright in a dry run, because it is the one irreversible thing the script does: every snapshot stored before a re-capture was measured against different rows, so a re-capture silently ends the trend it appears to continue.

## Replay

```bash
yarn --cwd server engine:benchmark                     # dry run, stores nothing
yarn --cwd server engine:benchmark --replays=2         # the determinism check
yarn --cwd server engine:benchmark --apply --confirm-engine-benchmark
```

A replay runs the real `materializeEntity` with `dryRun`, reading through `FrozenMaterializationInput` instead of the live collections, then runs the real `computeResearchEntityStudentVisibility` over the projected row.
It writes nothing, and it never calls a model: card synthesis is answered with a refusal that returns nothing and increments `cardSynthesisRequested`, so a lane that starts asking for synthesis shows up as a number rather than as drift in the fingerprint.

The row the gate judges is the projection, not the stored document.
A gate run on the stored values would answer about the last apply rather than about the code under test.

## Reading the numbers

`outputFingerprint` is an order-independent digest of every resolved value, every cleared field, and every gate verdict.
The gate verdict is inside it deliberately: a change that alters no field but moves a row out of `student_ready` is the change a student feels most, and a digest covering only resolve would report it as no change at all.

`knownWrong / labeledEntityResolved` is the ratio to read, never `1 - knownWrong / resolved`.
A refusal is a negative label only, so a value no refusal names is unjudged rather than correct (#3514).

Before reading a fingerprint change as a regression, check that it is attributable at all:

- `rowsWithIncompleteInput` counts rows where the engine read something the capture did not freeze. `unfrozenReads` names which read it was.
- `invalidatedRunSetChanged` is true when an operator quarantined or released a scrape run between capture and replay, which withholds evidence and so moves the input.

Either one means the input moved too, so the change is a frozen-input leak rather than a regression.
`fingerprintChangeIsAttributable` is the predicate, and a measurement that called an input change a regression would earn being ignored.

## What "frozen" means here, and what it does not

**The bar is that every live read is either reviewed or counted. It is not that no read goes to the corpus.**

That distinction is the whole design, so it is worth stating before someone reads `rowsWithIncompleteInput` as a score to drive to zero.

A read the leak detector cannot see is the thing this benchmark cannot tolerate, because the claim it exists to support is that a fingerprint change means the code changed, and that claim rests entirely on the counter being able to see every read.
So a read is acceptable in exactly two states: routed through `MaterializationReadSource`, where a miss is counted, or listed as a reviewed exemption with the reason it cannot be routed.
`projectionObservationReadsRouted.test.ts` enforces that, for observation reads and entity reads alike, and fails when a read appears in neither state.

Some reads can never be frozen, and that is a property of the question rather than a gap to close.
The dedupe candidate lookup searches by `websiteUrl` across the corpus precisely to find rows the benchmark does not contain, so its answer set is not derivable from the frozen input; freezing it would mean freezing a URL-to-row map over the whole corpus, which is the corpus rather than an index of it.
It is a permanent reviewed exemption.

**So `rowsWithIncompleteInput` reaching zero is not the definition of done, and chasing literal zero is actively harmful**: it pushes toward freezing corpus-sized maps, and a benchmark that is not cheap enough to run every sweep stops being run at all.
Two smaller value searches, the lead-naming existence check and the email-alias resolution, are worth freezing as capture-time indexes because the capture can enumerate the keys a replay will ask about from the frozen observations, so those indexes are sized by the benchmark rather than by the corpus.
That is the test for whether a live read can become a frozen one: can the capture enumerate the questions.

`byFieldDelta` and `gateTierDelta` are counts, not rows, because a snapshot stores no row identifier: an entity key is a slug, and a slug beside a defect judgement is the pairing the person-identifier convention exists to prevent.
An operator who needs to know which rows moved runs `--replays=2` and reads `replayDisagreement`, which names the fields and never leaves the process.

## The trend

The `engine-benchmark` stage of the Development sweep replays and stores one `engine_benchmark_snapshots` row per run.
It deliberately does not pass `--capture`: a sweep that re-froze the input every run would compare each run against a benchmark taken from that same run, so no regression could ever surface.
Capture is an operator step.

`engine_benchmarks`, `engine_benchmark_rows` and `engine_benchmark_snapshots` are environment-local, listed in both `scripts/mirrorCollectionPolicy.ts` and the sync classifier, because a promotion replaces whole collections and would erase the benchmark the target captured.

## What it does not cover

Corpus-wide dedupe is not replayed.
It is a pass over the whole corpus rather than a per-row decision, so freezing it means freezing the corpus, and that is a different benchmark.
What is covered is the survivor side: a merged survivor reads its losers' evidence through the frozen input, so a change in how survivor evidence is admitted does move the fingerprint.
