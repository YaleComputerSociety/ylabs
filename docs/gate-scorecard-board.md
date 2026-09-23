# Gate scorecard board

The Gate Status panel on `/programs` renders seven promotion gates.
Each gate's verdict comes from an audit that runs separately from the serving process, so the board's honesty depends entirely on where that verdict is kept.

## Where a verdict lives

A verdict lives in the `gate_scorecard_snapshots` collection, one row per gate per environment, upserted by `yarn --cwd server gates:refresh`.

It used to live only in a JSON file.
`resolveSafeJsonReportOutputPath` confines a report artifact to the OS temp directory or `./tmp`, and Render wipes both on redeploy, so the board reverted to "Gate output is not persisted in this branch yet" after every release.
A GitHub Actions runner also has no access to the serving process's filesystem, so scheduling `gates:refresh` could not make the board show anything.

`gates:refresh` still writes the files, because the audits take their `--output` path and several other readers consume them.
The board takes whichever of the row and the file was generated later, and the row wins on a tie.
That is how a hand-run during the transition still shows, and how a refresh that produced nothing replaces the previous verdict instead of being masked by the file it failed to rewrite.

## A row says what it judged, not just the outcome

A stored verdict that cannot say what it judged is no better than the blank board it replaces, so each row records:

| field | what it answers |
|-------|-----------------|
| `gate`, `environment`, `databaseName` | which gate, measured against which database |
| `measuredAt` | when the underlying audit generated its scorecard, which is what the staleness rule reads |
| `storedAt`, `refreshRunId` | which refresh run produced this row, so the run can be pointed at |
| `evaluated.command` | the feeder command and its flags, so the scope of the audit is legible |
| `evaluated.exitCode`, `evaluated.artifactWritten` | whether the feeder ran and rewrote its artifact |
| `evaluated.artifactDatabase`, `evaluated.artifactEnvironment` | the database the audit itself claims, which is how a cross-environment refresh becomes visible |
| `evaluated.failureReason` | why there is no summary, when there is none |
| `summary` | the gate detail the matching `derive*Gate` consumes |

`summary` is deliberately untyped in the schema.
Those shapes are owned by `adminOperatorBoardService`, differ per gate, and gain fields regularly, so pinning them in the model would silently drop whatever the schema had not been taught yet.
They are counts and command strings only: a normalized gate artifact never carries a slug or a name, per `docs/person-identifier-convention.md`.

## A failed feeder is recorded, not skipped

`gates:refresh` tolerates one feeder failing so a single broken gate does not block the rest.
That tolerance is only safe if the failure reaches the board.
A feeder that wrote no scorecard, or whose scorecard cannot be read back, stores a row with no `summary` and a `failureReason`, and the board renders that gate as unreadable naming the refresh run that failed.
The alternative is the swallow recorded in #3049: a run that reports success over state it was unable to write.

If the row itself cannot be written, `gates:refresh` throws rather than exiting clean, because a silent store failure leaves the board serving the previous verdict as current.

## The collection is environment-local

`gate_scorecard_snapshots` is listed in `scripts/mirrorCollectionPolicy.ts` and must never join `COPY_COLLECTIONS` in `promoteAcceptedBetaCopy.ts`.
A promotion replaces whole collections, so copying it would present one environment's promotion verdict as another's.
Rows are read by the connected database name rather than by a claimed environment, so a row that reaches the wrong database by some other route still cannot be read as that database's verdict.

## Staleness

`GATE_SCORECARD_MAX_AGE_HOURS` (default 3) bounds how old a verdict may be before the board downgrades it to a rerun instead of showing it as live.
Tune it to the refresh cadence so a single missed run flags stale.
A row past the TTL downgrades exactly as a file past the TTL always did.
