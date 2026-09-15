# Corpus Quality Panel

The panel answers one question without anyone running a script: is what students are served getting better?

It lives in **Research Data Coverage** on `/analytics`, directly below the Student-Ready count.
That placement is deliberate.
A rising student-ready count is the thing most easily mistaken for rising quality, so the count and its composition are read together.

## Where the numbers come from

Most of the panel is a single MongoDB aggregation on the request, so it says what is true now.

| Rows | Source | Freshness |
|---|---|---|
| Coverage, by tier, by school | Live aggregation | Now |
| Has a research website, Has topics, No website and no topics, Generic "Faculty Research" title | Live aggregation | Now |
| Opens by stating the research, Card summary only echoes the topics, Public description invariant fails | Latest `corpus_quality_snapshots` row, tagged **measured** on screen | As of that measurement |

Three rows cannot be an aggregation: each needs the roster resolved and `buildResearchEntityPublicDescriptionRepresentation` built per entity, which is JavaScript rules over 2,839 lines and about **13 seconds** over the served corpus, against about **150 ms** for the aggregation. Those three carry a `measured` tag and the header says how many rows are in that state, so nobody reads an as-of number as a now number.

**The other five were measured to be identical, not assumed.** Over 3,120 served Development rows on 2026-09-14 the aggregation and the representation returned the same counts: research website 1,276, topics 3,026, topic total 15,136, dead ends 69, generic title 1,471. Routing them through the representation cost 13 seconds and bought nothing, so they moved.

If a future sanitizer starts rewriting `websiteUrl`, `name`, or `researchAreas` at serve time, the aggregation would drift from the representation. `corpus:snapshot` keeps recording the representation-derived value for those same metrics, so a divergence appears as a disagreement between the live number and the newest row rather than as a silently wrong number. `corpusQualityLiveMetricsParity.test.ts` pins which metrics sit on which side of that line.

## Why every metric keeps its denominator

Ratios are stored and rendered as `{ n, of }`, never as a percentage.
A stored percentage hides the denominator, and that is exactly how a corpus growing 2,622 to 3,095 served rows in four days read as progress while `websiteUrl` coverage among the newcomers ran 17% against an incumbent 44%.

Each row also carries a direction, so the trend marker means the same thing everywhere: green is better, red is worse.
`integrity` counts invariant **failures** rather than passes for the same reason, so a rise always reads as worse.
A move smaller than half a point renders as "no change" rather than a signed delta.

## Vocabulary

Labels use plain directory language, per the 2026-08-25 "Simple Directory First" decision in `docs/decisions.md`, which deprecates "research home" and "research area".
So the panel says "research website" for `websiteUrl` and "topics" for `researchAreas`, matching the words the client already uses: `researchWebsiteCtaLabel` renders "Visit research website", and `labDetail` calls the chips `topics`.

**Topics are deprecated wording, not a deprecated field.**
The decision demotes them from a first-class gating field to enrichment, which means they never hide a card.
It does not mean they are invisible or search-only, and an earlier version of this doc said so wrongly.
They are load-bearing student-facing content: rendered on every detail page under "Best fit for", compared in the entity comparison view, fed into the intro-email draft, curated through an admin surface, and both searchable and filterable in Meilisearch as well as present in the embedder template.

The stored `researchAreas` field keeps its name: renaming a schema field is a migration, not a vocabulary change.

## Taking a measurement

```bash
yarn --cwd server corpus:snapshot --environment development
yarn --cwd server corpus:snapshot --environment development --dry-run
```

It reads every collection and writes only `corpus_quality_snapshots`, after asserting the database `MONGODBURL` points at matches the `--environment` claimed.
`--dry-run` prints the measurement and writes nothing.

## Judge the representation, never the stored document

`servedRowFacts` resolves the roster, builds `buildResearchEntityPublicDescriptionRepresentation`, and reads its verdicts.
Stored fields are the wrong thing to judge: the representation rewrites self-referential copy, strips body chrome, and derives a card description when none is stored.
#2671 landed the same correction for the card planner, and measuring with an empty roster instead of a resolved one reported 2 invariant failures where the real figure was 0.

A consequence worth keeping: the panel's definition of "good" **is** the gate's definition, because both call the same quality functions.
Tightening a description flag shows up here as a dip, with no parallel heuristic to maintain.

## The collection is environment-local

`corpus_quality_snapshots` is listed in `scripts/mirrorCollectionPolicy.ts` and must never join `COPY_COLLECTIONS` in `promoteAcceptedBetaCopy.ts`.
A promotion replaces whole collections with an unguarded `deleteMany({})`, so carrying this one would erase the history it exists to keep, and would attribute one environment's measurements to another.
Two tests pin that.

## How the history keeps growing

The serving process records a measurement itself, using the connection it already holds.
`startCorpusQualitySnapshotScheduler` in `server/src/index.ts` wakes hourly and asks whether the newest row for the connected environment is older than `CORPUS_SNAPSHOT_MAX_AGE_HOURS` (default 24); if it is, it takes one.

Staleness-driven rather than interval-driven, deliberately.
A daily timer loses a day whenever the process restarts or the host spins down, and this deploy is kept awake by an external ping rather than by traffic, so "fire once every 24h from boot" would silently skip.
Asking about staleness is correct across restarts and cheap when the answer is no.

The environment is discovered from the connected database name via `operatorEnvironmentForDatabaseName`, not from a flag, so a row can never be labelled with an environment it did not come from.
A database the mapping cannot place records nothing.

On by default in a deployed runtime, because a measurement nobody remembers to take is the problem this exists to solve.
Off under `NODE_ENV=test` so suites never write, and disableable with `CORPUS_SNAPSHOT_DISABLED=true`.

There is deliberately no GitHub Actions workflow and no database secret.
An earlier version of this shipped one; it needed a `DEV_MONGODBURL` repository secret that does not exist, so it could never have run, and it could only ever have measured the one environment whose URL the secret held.
The in-process scheduler measures whichever environment the process serves, which is what makes Beta and Production accumulate their own series rather than borrowing Development's.

Verify by reading the newest row's `measuredAt`, not by reading this file.

## What this cannot tell you

The series starts at its first snapshot.
The 2026-08-31 hand-read in `docs/served-corpus-scoreboard.md` cannot be backfilled into it: that artifact holds served copy for 100 slugs, not corpus-wide ratios, so the earlier ratios are unrecoverable rather than merely unrecorded.

The panel also reads one environment, whichever database the process is connected to.
Cross-environment drift is a different question; `yarn --cwd server research-entity:served-scoreboard` reads all three.
