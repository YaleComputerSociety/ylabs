# Research Data Pipeline

Status: active operator reference

Last updated: 2026-09-05

y/labs data moves through an evidence-first pipeline. Use this document for the stable shape of the pipeline, [`docs/scraper-audit-guide.md`](./scraper-audit-guide.md) for source-level audit expectations, and [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md) for Beta and production promotion steps.

## C4 engine (flagged)

The consolidated C4 engine (issue #2063) adds prevention-first identity resolution (resolve-at-mint against live candidate lookups; its canonical-alias ledger is retired per #3027) and decide-late projection over a lossless observation log, plus a fuzzy residual matcher and grounded gpt-5-mini description coverage.
It is gated behind three off-by-default flags: `C4_RESOLVE_AT_MINT_USERS`, `C4_RESOLVE_AT_MINT_ENTITIES`, and `C4_LOSSLESS_INGEST`.
Only two of the three do anything: nothing reads `C4_RESOLVE_AT_MINT_USERS`, because no caller passes `type: 'researcher'` to `resolveCanonical`, so the person mint still runs its own identity cascade in `entityMaterializer.ts`.
When the flags are unset the pipeline behaves exactly as described below.
See [`docs/c4-rollout-runbook.md`](./c4-rollout-runbook.md) for the flags, the new CLIs, the Development-first go-live sequence, the measured gains, and rollback.

## Pipeline Shape

```txt
Source metadata
  -> ScrapeRun
  -> append-only Observation rows (ingest-time sanitized, content-hash gated, prose-regression guarded)
  -> claim validation for access interpretations
  -> entity/materializer resolution
  -> ResearchEntity / RoleAssignment (roster) / Researcher / Grant / Fellowship records
  -> Signal (access types) when evidence supports it
  -> student visibility gate promotes public-safe records or opens release queue items
  -> beta repair queue routes queue items by recoverability, then applies deterministic trusted-source repairs and re-gates records
  -> Meilisearch rebuild or sync (the gate resyncs its changed entities itself)
  -> Research, Programs, and admin/operator surfaces
```

The materializer resolves a scraped person name to a canonical `Researcher` (via `resolveResearcherIdForPersonName`) before writing roster rows, so `RoleAssignment.personId` is always a `Researcher` id.
See [`docs/research-model.md`](./research-model.md) for the current collection shapes.

### Scraper sweep and recurring stages

The pipeline is orchestrated by two sweep engines that share the same substrate (append-only observation log, materializer, and content-hash gate) but own separate source manifests and post-run stages, both driven by `yarn --cwd server scrape:sweep --mode=<mode>` (`server/src/scripts/runScraperSweep.ts`), rather than by running each source by hand.
The research engine writes `ResearchEntity` records for `/research` and runs the sources in `RESEARCH_SWEEP_SOURCES` (identity and faculty directories, labs, centers, microsites, funding and grants, research-area extractors, and the undergraduate research access sources).
The fellowship engine writes `Fellowship` records for `/programs` and runs the catalog sources in `FELLOWSHIP_SWEEP_SOURCES`: `yale-college-fellowships-office`, `yale-reu-programs`, `yale-health-sciences-summer-programs`, and `student-grants-database`.
`validateScraperSweepManifest` asserts every registered orchestrator source is in exactly one engine, with the exception of the sources in `MANUAL_ONLY_SWEEP_SOURCES`, which stay registered, seeded and runnable by hand (`scrape run --source <name>`) but out of both automated manifests.
The validator also refuses a manual-only name that is no longer registered, so the list cannot go stale.
Each manual-only source records its reason next to its name in `scrapers/manualOnlySweepSources.ts`, which `runScraperSweep.ts` re-exports:

- `undergrad-fellowships-recipients` is a backward-looking recipients source with no clean public feed.
- `federal-award-usaspending` can never acquire, because USAspending publishes no principal-investigator field: across the 293 Yale DOE, NASA and DoD awards its request returns, 1 description embeds a PI name and that name resolves ambiguously, so every sweep failed it on the barren-streak guard below (#3542, #3547).
  A manual run is still the way to re-check whether the source starts carrying PI data.
- `undergrad-research-posting` can never acquire today, because its only configured page never existed and no official public Yale page publishes postings in the shape it reads, so its page list is empty (#3550).
  Development holds 5 runs for it, all `failure` with 0 observations, so every sweep failed it on the barren-streak guard below (#3553).
  It returns to the research sweep when a real page is configured, and #3551 tracks a possible replacement source.
- `lab-microsite-undergrad-llm` is not precise enough to refresh automatically (#3636).
  #3569 measured its served `undergradEvidenceQuote` badge precision at 18/50 = 0.36 (95% Wilson interval 0.24 to 0.50) and its grounding precision at 18/38 = 0.47.
  19 of those 50 quotes are an absence note the model wrote rather than text from a page, and that shape matches 299 of the 925 rows the lane serves, so the student-facing badge was withdrawn (#3607).
  It is also the slowest lane: about 4 to 19 labs per minute over 4,808 labs projects to 15 to 20 hours of a sweep, and it was deferred from the 2026-09-26 sweep by operator decision.
  Leaving the sweep also stops its description emits refreshing automatically; a manual run still refreshes both.
  It returns to the research sweep when #3592 (the quote must appear on a fetched page) lands and a re-measure with `yarn --cwd server journey:eval --case=undergrad-evidence-quote-precision` clears the #3569 thresholds.

`department-undergrad-research` dual-writes (its `program` records materialize as `Fellowship` while its `lab` records materialize as `ResearchEntity` access-evidence); it lives in the research engine because access-evidence is research-side.
The registered sources in each engine are grouped into ordered phases that run in sequence in the order the phases first appear in the manifest: `identity`, `discovery`, `funding`, `relationships`, and `content-access`.
The fellowship engine currently only spans the `discovery` phase.
The `scholarly` phase is declared in the source-phase contract but currently carries no registered sources, so it does not run.
Sources inside a phase run with bounded concurrency, and the two LLM-heavy phases (`relationships`, `content-access`) are capped at concurrency 2 by `PHASE_CONCURRENCY_CAPS` regardless of the requested `--concurrency`.
The three exhaustive Development modes (`development-full`, `development-incremental`, and `fellowship-development-full`) default the network-bound discovery phase to cross-source concurrency 8.
The per-host request budget is one budget for the whole sweep, not one per child (#3568).
The sweep parent runs a host slot broker (`scrapers/utils/hostSlotBroker.ts`) on a private Unix socket for the preflight canaries and the source phases, and names it to every canary and source child in `SCRAPER_HOST_SLOT_BROKER`; each child's axios interceptor and rendered fetch ask the broker for a slot on the request's host, and the broker grants from one `HostConcurrencyLimiter` holding `DEFAULT_PER_HOST_CONCURRENCY` (4) per host, with the `HOST_THROTTLE_OVERRIDES` concurrency and spacing applied across all children together.
So a child alone on its host gets the whole budget, children that share a host divide it between them, and no host ever sees more than its budget or its override in flight, whatever the phase concurrency.
The previous rule gave every child `floor(4 / phase concurrency)`, which at concurrency 8 was 1 slot per child on every host: a lane alone on its host ran one request at a time, while eight children on one host could hold 8 between them.
An operator `SCRAPER_PER_HOST_CONCURRENCY` can only tighten the broker's budget, never loosen it.
A child keeps that old per-child cap (`resolveSweepChildPerHostConcurrency`) only as its fallback: when the broker cannot be reached it logs the reason and gates each host on its own, which is no looser than before.
The broker gates request slots, not lane loops: a lane that fetches one page at a time still runs at one request in flight however large its host budget is.
Individually rate-limited hosts are pinned tighter still by a per-host override map that no `SCRAPER_PER_HOST_CONCURRENCY` value can lift; see `utils/hostConcurrencyLimiter.ts` in `skills/scrapers/SKILL.md` for the current entries and the rationale.
The dept-roster and dept-undergrad sources stay effectively serial because they page through their own in-loop `--limit`.

The sweep modes fix the environment, database, write posture, and confirmation flag together, so a single `--mode` cannot straddle environments:

| Mode | Env / DB | Writes | Auto-materialize | Confirmation flag |
| --- | --- | --- | --- | --- |
| `development-plan` | development / Development | no | no | none (dry-run, `--limit 100 --use-cache`) |
| `development-sample` | development / Development | yes | yes | none (`--limit 100 --use-cache`) |
| `development-full` | development / Development | yes | yes | `--confirm-development-full-sweep` (`--exhaustive --ignore-work-planner`) |
| `development-incremental` | development / Development | yes | yes | `--confirm-development-incremental-sweep` (`--exhaustive`) |
| `fellowship-development-full` | development / Development | yes | yes | `--confirm-fellowship-sweep` (fellowship engine only, `--exhaustive --ignore-work-planner`) |

Every mode targets Development, because sweeps run only there (decision 2026-09-27 in `docs/decisions.md`).
Beta and Production receive the swept result through promotion, and the scrape CLI refuses any `run` or `materialize` write against either of them.

Only the two `--limit 100` modes pass `--use-cache`.
An exhaustive mode always fetches live and writes no `scrape_snapshots` rows, because the cache persists every fetched payload for 24 hours and one cached `development-full` sweep wrote about 3.5 GB of it, pushed the Development Atlas cluster over its space quota, and failed 19 sources (#3536).
A live read is also what an exhaustive refresh is for: with the cache on, a run within a day of the last one re-read the previous day's pages, and department roster snapshots recorded `cacheAllowed: true`.
To re-run one failed source cheaply, run it by hand and pass `--use-cache` yourself; that bounds the cache to one source.

#### Page reuse within one sweep

The three exhaustive Development modes reuse a page one source child fetched earlier in the same sweep instead of asking the site again (#3568), and `--no-page-reuse` turns it off.
It is scoped to an explicit list, `SWEEP_PAGE_REUSE_HOSTS` (`medicine.yale.edu` and `ysph.yale.edu`), the two hosts in `HOST_THROTTLE_OVERRIDES`: each caps the sweep at 2 requests in flight and sends no `ETag` or `Last-Modified`, so the #3557 validator cache (`utils/httpValidatorCache.ts`) can never store their pages.
The list is deliberately not derived from `HOST_THROTTLE_OVERRIDES`, so throttling another host does not turn reuse on for it.
On 2026-09-26 `medicine.yale.edu` carried about 18,600 discovery requests shared by `ysm-faculty-directory` and the roster's `ysm-*` profile enrichment, and later `official-profile-pi-backfill` and `ysm-mesh-keyword` re-read the same school-wide `/profile/` pages.

- The store lives in memory in the sweep parent's host slot broker process, the same process and socket that hands out host slots, and it is discarded when the source phases end, so it is never a cache across sweeps and never touches Mongo.
  A resumed sweep starts with an empty store.
- It is bounded by `SCRAPER_SWEEP_PAGE_REUSE_MAX_MB` (default 1024 MiB of gzip-compressed pages, least recently used evicted first), which holds every reused-host page of a full sweep with room to spare: a school-wide profile page is about 330 KB and 35 KB compressed.
- A page is reused only for a later `GET` of the same URL, compared without its fragment.
  Only a `200` with a textual body is stored; a `403`, a `429`, any other error, a `Cache-Control: no-store` body, and any request carrying `Authorization`, `Cookie`, `Range` or a conditional header are never stored or served.
  A redirected page is stored under its final URL, and under the requested URL only when every hop was a permanent `301` or `308`, so a reused redirect answers with the final URL the first fetch actually landed on.
  `medicine.yale.edu` answers a school-wide `/profile/<slug>/` with two `301` hops, and a department-scoped `/<department>/profile/<slug>/` lands on a different page, so the two are never reused for each other.
- A reused response carries `x-ylabs-sweep-reused-fetched-at` with the time the page was fetched, and takes no host slot, so it costs the throttled host nothing.
- A run records `fetchMetrics.sweepPageReuse` (`lookups`, `reused`, `bytesReused`, `offered`), and the sweep's `summary.json` records `pageReuse` with the store's `hits`, `stored`, `evicted` and `peakHeldBytes`.
- A department roster snapshot's `read` block records `pagesReusedWithinSweep`, and the roster's fetch attempt reads `http-sweep-reused` instead of `http`.
  The departure lane classifies such a snapshot as `reused-within-sweep` and admits it exactly like `fetched` and `cache-permitted`, because the page came off the wire during this sweep; the provenance says what happened without weighting it.
  The departure lane's own Yale-profile probe never reuses a page: a suppression asserts that a person left, so it reads the profile live at decision time.
- Outside a sweep nothing changes: a hand-run `scrape run` and the preflight canaries never install reuse, and a child without both `SCRAPER_HOST_SLOT_BROKER` and `SCRAPER_SWEEP_PAGE_REUSE=1` fetches every page as before.
  If the broker cannot be reached, the child logs one warning and fetches every page from the site.
- Post-run stages run after the broker closes, so `source-link-health` still probes each URL live.

The materializing modes require a local Meilisearch host and an empty `MEILISEARCH_INDEX_PREFIX`; the sweep refuses a non-local Development Meili target.

#### Preflight: fail a broken sweep in minutes, not hours

A `development-full` sweep runs a preflight before its first phase, and `--skip-preflight` turns it off (#3568).
It exists because failures used to surface hours in: on the 2026-09-26 sweeps a full cluster failed 19 sources about 100 minutes in (#3536), and three lanes that could never acquire failed on the barren-streak guard only after the discovery phase had spent 3.6 hours.
The preflight has two checks, and either failing stops the sweep before any source runs, with the report printed and written to `preflight.json` in the sweep's output directory.

- **Storage headroom.** It sums `dataSize` plus `indexSize` from `dbStats` over every non-system database on the cluster, because Development, Beta and Production share one Atlas quota (see `data-refresh-runbook.md`), and fails when the quota minus that sum is under the required headroom.
  The quota defaults to 5120 MB (`SCRAPER_SWEEP_CLUSTER_QUOTA_MB`) and the headroom to 1024 MB (`SCRAPER_SWEEP_MIN_HEADROOM_MB`); the headroom is a starting figure, not a measured per-sweep growth.
  A measurement that cannot be taken, for example a credential without `listDatabases`, fails closed.
- **A write-free canary per source.** Each source still to run gets a `scrape:canary --source <name> --limit 5` child (`SCRAPER_SWEEP_CANARY_LIMIT`), eight at a time (`SCRAPER_SWEEP_CANARY_CONCURRENCY`), each killed after 150 s (`SCRAPER_SWEEP_CANARY_TIMEOUT_MS`).
  The canary runs the lane in process with a dry-run, uncached context whose `emit` only counts, so it opens no `ScrapeRun` and writes no observation, unlike `scrape run --dry-run`, which records a run row.
  A `--force-llm` sweep passes `--force-llm` to each canary too, so content-hash gated LLM lanes re-extract exactly as their real run will.
  It is write-free by construction rather than by convention: before anything connects, `installMongoWriteRefusal` (`scrapers/utils/mongoWriteRefusal.ts`) replaces every driver write path (collection and database write methods, write commands, `$out` and `$merge` pipelines, client bulk writes, index and collection creation) with a refusal, so a lane that writes outside `emit` is refused rather than trusted.
  A lane that throws fails the preflight, and so does a lane that emits nothing when its prior runs were already barren, because the real run would then fail the barren-streak guard below.
  The canary classifies its own zero-yield run with the lane's returned metrics and options, the same facts the orchestrator uses, so a bounded run whose work planner skipped every target stays `inconclusive` rather than predicting a barren failure.
  A lane that emits nothing with a productive history, times out, or is refused a write is reported `inconclusive` and does not stop the sweep, because a bounded run cannot tell those apart from a healthy lane.

A canary cannot catch a failure that only appears at full scale, such as the `official-profile-pi-backfill` observation sort that overflowed memory on the whole corpus (#3543).
On a resume the canary covers only the sources the checkpoint does not already record as `done`.
The canary list is the sweep manifest, so a manual-only source is never canaried.

#### The commit a sweep runs

A sweep executes the code in its own checkout's working tree, never the code on `beta`.
Every stage is spawned with `cwd` set to the repository root, so whatever `HEAD` is at the moment a stage launches is what that stage runs.

`summary.json` records that commit as `codeSha`, which makes a stage's behaviour attributable after the fact; each scrape run a stage writes also records its own `codeSha` (#3824).
Read it rather than the merge time of a fix: a fix merged while a sweep is running reaches none of its stages, because nothing pulls the checkout mid-run.

If the checkout moves during a run, each later stage is refused rather than spawned, and the refusal is recorded in `summary.json` as `codeDrift` naming both commits.
This fails closed because the alternative is silent: a stage running newer or older code than the stages before it can re-apply a defect the checkout predates, and for a sweep that writes data that means storing values a merged fix had already removed.
A refusal does no work, so the checkpoint survives and a resume re-runs the refused stages once the checkout is back on the commit the run started.
The checkpoint records that commit when the run begins, so a resume keeps it as the run's `codeSha` and keeps refusing until `HEAD` returns to it, and each refusal is kept in the checkpoint so every later `summary.json` of the run still reports it.
A new invocation on a different commit adopts the newer commit by starting a new sweep rather than resuming this one (see the checkpoint rules below, #3989).

This was measured on the Development full sweep of 2026-09-28, which ran from 00:38Z to past 06:40Z.
`HEAD` fast-forwarded six times during the run, and the 24 source stages split across two different commits: 11 ran the commit in force at 00:40Z and 13 ran a commit that landed at 05:07Z.
A fix that merged at 05:16Z reached none of them, and because the summary recorded no commit at all, nothing in the artifacts could have revealed either fact.

#### Checkpoint, resume, and structured logging

The sweep is resumable and observable so a long run that dies mid-way does not restart from scratch (issue #2182).
Every step - each source step and each post-run stage - is tracked in a durable checkpoint JSON at `<os.tmpdir>/ylabs-sweep-checkpoint-<mode>-<worktree-fingerprint>.json`, written atomically (temp file plus rename) after every `pending -> running -> done|failed` transition with the step's exit code and timestamps.
The checkpoint key includes a fingerprint of the repository root, so two worktrees running the same mode at the same time never share or clobber one checkpoint.
A normal invocation resumes automatically: if a checkpoint for the same mode exists it reuses that run's output directory, skips every step already marked `done`, and re-runs anything not `done` (failed, interrupted, or never started); resume granularity is per step, so an interrupted source re-runs whole.
Four conditions deliberately refuse or narrow a resume, because a checkpoint alone is not enough evidence that a step's work is still valid:

- The checkpoint records the invocation's behavior-changing flag set (`--force-llm`, `--prune-between-phases`). Only a checkpoint whose recorded flag set matches this invocation is a resume candidate; a re-invocation with a different flag set starts fresh instead of inheriting `done` steps that were produced under different semantics, and its fresh checkpoint replaces the old one at the same path.
- The checkpoint records the commit the run started on. An invocation whose checkout is at a different commit is not a resume candidate: it warns, names both commits, and starts a new sweep, because a run whose steps are all `done` otherwise resumes silently, reports every step as already done, writes nothing, and stops at the first code-drift refusal (#3989). To resume the earlier run, reset the checkout to its recorded commit and invoke again.
- The checkpoint records its owner pid. On a resume candidate, or on a checkpoint that differs only by commit, if a step is still `running` and that pid is alive, the sweep refuses to start rather than interleaving two writers against one checkpoint; use `--restart` to abandon a checkpoint whose owner is truly gone. The flag-set comparison happens first, so this guard does not cover a re-invocation that changes the flag set: never re-invoke a live sweep's mode with a different flag set, because that path replaces the running sweep's checkpoint instead of refusing.
- Post-run stages are whole-database aggregate stages, not per-source work. If any source step is not `done` in the checkpoint, every `stage:` entry is cleared at plan time so the entire post-run chain (faculty projection, visibility gate, search rebuild, and the rest) re-runs over the newly written data, rather than a resumed sweep reporting green with a re-fetched source missing from the projections or the search index. The decision reads the checkpoint only: a source that is `done` but re-runs later because its artifact turned out to be missing or invalid does not itself invalidate the stages, so pass `--restart` when resuming a run whose output directory may have been partially cleaned up.

A step marked `done` whose declared result or artifact is missing, unreadable, or invalid is treated as not done and re-run, so the resume path keeps the same fail-loud artifact contract as a fresh run (#2050) instead of reporting an empty delta as success.
A `done` source step is matched to the artifact it recorded when it finished, not to a path re-derived from its current position in the source list.
Artifact names carry the declared-order index (#2007), so adding, removing or reordering a source between attempts renumbers every later artifact; judging a `done` step by the re-derived name would re-run finished sources whose artifact is still on disk under its old name (#3570).
A checkpoint written before a step recorded its artifact falls back to the derived name.
`--restart` wipes the checkpoint and starts a fresh run.
A fully successful sweep (no failures, nothing not-run, post-run not failed) clears its checkpoint so the next plain invocation starts fresh rather than resuming a completed run.
Alongside `summary.json` the sweep writes, into the same output directory, a `runner.log` (a timestamped step-start/done/fail timeline), an `errors.log` (each failure with its step id, exit code, and the tail of that step's captured output), and per-step `.log` files capturing each child's output.
`errors.log` reads a bounded tail from the end of a step log (never the whole file, which can reach hundreds of megabytes on an exhaustive run) and passes every captured line through `sanitizeLogValue`, so scraped contact data and connection credentials never land in the file operators are told to read and share.
Because every child's stdout and stderr now redirect into its own step log, child output no longer streams to the sweep's terminal: the parent prints one header line per step (per-source headers include the log path) and the rest lands in the log file, so `tail -f` that path to watch a step in flight.

#### `--force-llm` and mid-run storage headroom

`--force-llm` (off by default) threads `--force-llm` into every per-source `scrape run` child, re-running paid LLM extraction even when a page's content hash is unchanged; use it for a full re-derivation pass.
`--prune-between-phases` (off by default) runs the gated dead-observation prune (`observations:prune-dead`) between phases and adds a final `dead-data-prune` post-run stage to both engines' chains, so a `--force-llm` run can hold storage headroom without a separate watchdog process.
Both the between-phases hook and the final stage are restricted to the Development-database write modes (`development-full`, `development-incremental`, `fellowship-development-full`), matching the rest of the post-run chain, so a bounded plan or sample sweep never deletes mid-run.
The between-phases prune is best-effort: a prune failure is logged to `errors.log` and does not stop the sweep.

The two exhaustive Development modes (`development-full`, `development-incremental`) run a fixed chain of post-run stages after every source has fetched and materialized:

1. `stale-scrape-run-reap` (`scrape-runs:reconcile-stale --apply --heartbeat-stale-only --started-before <sweep start>`; first, so a later stage failing cannot skip it; see "A run record always ends terminal")
2. `researcher-dedupe` (on by default in Dev sweeps; disable with `SCRAPER_SWEEP_DEDUPE_RESEARCHERS=0`)
3. `grant-shell-faculty-port` (`research-entity:port-grant-shells-to-faculty-profiles --apply`; on by default in Dev sweeps, disable with `SCRAPER_SWEEP_PORT_GRANT_SHELLS=0`; moves every live faculty-typed `nih-pi-*`/`nsf-pi-*` row onto a faculty research profile key, see below; ordered before `eponymous-fra-merge` so a ported faculty row can still fold into the same person's lab)
4. `eponymous-fra-merge` (on by default in Dev sweeps; disable with `SCRAPER_SWEEP_AUTO_MERGE_FRA=0`)
5. `url-identity-dedupe` (on by default in Dev sweeps; disable with `SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES=0`)
6. `website-url-identity-dedupe` (the same lane family keyed on the whole normalized `websiteUrl` rather than a Yale `/lab/` or `/profile/` path; gated by the same flag)
7. `source-link-health` (`research-homes:backfill-source-link-health --apply --reprobe-healthy-after-days=7`; ordered before the gate because the gate reads `sourceLinkHealth`; `--full-link-health-reprobe` on the sweep drops the window and probes every URL)
8. `profile-link-health` (`researchers:verify-official-profile-links --apply --stale-after-days=<window>`; the sibling of `source-link-health` for a lead's `YALE_OFFICIAL` profile link, #3222)
9. `dead-research-website-clear` (`research-entity:clear-dead-research-websites --apply`; ordered after both link-health probes because it consumes their verdicts, #3309)
10. `organization-identity-website-retire` (`observations:retire-organization-identity-websites --apply`; idempotent, plans nothing once the corpus is clean, #3484)
11. `shared-roster-website-retire` (`observations:retire-shared-roster-websites --apply`; ordered before `refusal-lane-attribution` so its refusals are attributed the same sweep, #3615)
12. `refusal-lane-attribution` (`refusals:attribute-lanes --apply`; after every stage that records a refusal, #3521)
13. `inferred-pi-lead-reclaim` (`data:materialize-inferred-pi-leads --all --apply`; ordered before the gate so the gate judges the leads it links in the same sweep; its result reports `materialized-lead` and `still-unresolved`, #3741)
14. `visibility-gate` (`student-visibility:gate --collection=all --apply`)
15. `search-rebuild` (`meili:rebuild-research-entities --clear`)
16. `lane-scorecard` (`lane:scorecard --apply`; replays each lane on its frozen benchmark, see [`lane-scorecard.md`](lane-scorecard.md))
17. `engine-benchmark` (`engine:benchmark --apply --replays=2`; never `--capture`, see [`engine-benchmark.md`](engine-benchmark.md))
18. `coverage-audit`
19. `data-quality` (`beta:data-quality --strict`)
20. `integrity-gate` (`scraper:integrity-gate --include-claim-gate`)
21. `trust-contract` (`launch:trust-contract --mode=student-ready-only --strict`)
22. `archived-cleanup` (`research-entity:cleanup-archived --merge-residue-only`; residue is deleted by default in Dev sweeps, disable with `SCRAPER_SWEEP_DELETE_MERGE_RESIDUE=0`)
23. `dead-data-prune` (`observations:prune-dead --apply`; opt-in, only when the sweep is run with `--prune-between-phases`)

The `researcher-dedupe`, `grant-shell-faculty-port`, `eponymous-fra-merge`, both URL-identity dedupe stages, and merge-residue deletion stages run by default on the two exhaustive Development modes so the Dev pipeline auto-dedupes every run. Each can be disabled independently by setting its environment flag to a falsey value: `SCRAPER_SWEEP_DEDUPE_RESEARCHERS`, `SCRAPER_SWEEP_PORT_GRANT_SHELLS`, `SCRAPER_SWEEP_AUTO_MERGE_FRA`, `SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES`, and `SCRAPER_SWEEP_DELETE_MERGE_RESIDUE`. One flag gates the whole URL-identity family, because `url-identity-dedupe` and `website-url-identity-dedupe` are two keys onto one question and an operator suppressing URL-keyed merges wants both off. `url-identity-dedupe` was opt-in until #2699; it defaults on because the never-demote survivor resolution defers rather than demotes (#2070) and because the whole post-run set is unreachable outside Development, so the flag only ever gated Dev. Every `SCRAPER_SWEEP_*` stage flag in either engine parses through the one shared helper pair in `server/src/scripts/sweepStageFlags.ts`, so the accepted truthy values (`1`, `true`, `yes`, `y`, `on`, `enable`, `enabled`) and falsey values (`0`, `false`, `no`, `n`, `off`, `disable`, `disabled`) are identical for every flag.

#### Grant rows move onto a faculty research profile key

The grant lanes stopped minting in #3564, but the rows they minted earlier kept lane-owned keys (`nih-pi-*`, `nsf-pi-*`), so a funded professor's research was identified by a grant record rather than by the person-scoped key the roster and profile lanes use (#3909).
`grant-shell-faculty-port` moves each live `FACULTY_RESEARCH_AREA` row with such a key onto a faculty research profile through the merge engine (`applyResearchEntityDedupeMergeGroup`), never by renaming a slug.
The survivor is the one live faculty row the same lead already has; failing that, an archived `faculty-research-area-<person>` row whose tombstone already points at the grant row, which is revived; failing that, a new `faculty-research-area-<person>` row carrying the grant row's stored document, including its locks, refusals and provenance.
The grant row is archived with a `canonicalGroupId` tombstone and `archivedReason: research-entity:port-grant-shells-to-faculty-profiles`, its lead edges, signals, plans and `entityId` observations are relinked, and the survivor resolves over its own and the tombstoned row's evidence (#3560), so an observation that still arrives under an old grant key lands on the survivor.
The merge runs never-demote with the survivor pinned, so a port that would lower the tier is rolled back and counted rather than applied.
Lab-typed grant rows are left in place and counted as `labTyped`, because the `faculty-research-area-` prefix is itself read as "profile shell" by `isProfileAreaShellEntity`, the eponymous FRA merge and relationship typing whatever the row's `entityType` is.
A grant enriches a row and never creates one (#3145), so a faculty-typed grant row that cites nothing but grant records is refused as `grantOnlyEvidence` and archived instead of ported (#3992), and so is a port survivor that has become grant-only.
Grant-only is the gate's URL test (`isUncorroboratedGrantOnlyEntity`) plus the observation log: every observation on the row, and on every row tombstoned into it, must have been fetched from a grant or ORCID record, because a lane can read an official profile page without citing it (10 of 44 URL-grant-only rows on Development had profile-page observations).
Where the row's lead already leads one live lab or faculty research profile, the row is merged into it instead, so the grants enrich that page rather than being archived out of reach; the enrichment check runs before the grant-only refusal for that reason.
The archive uses `archivedEntityUpdate` with `archivedReason: research-entity:port-grant-shells-to-faculty-profiles:grant-only`, removes the row from the search index, and leaves observations and lead edges in place, so a real faculty row for the same person can still be enriched by those grants later; a row with a lock or a visibility override is left for the operator.
The other refusals are `severalLeads`, `noPersonName` (an unled row whose key tail is an ObjectId), `severalFacultyRowsForPerson`, `targetSlugHeldByAnotherRow` and `targetSlugHeldByUnrelatedArchivedRow`.
Its durability check re-materializes each survivor twice and reports `secondPassChangedFields`, a value diff that ignores `updatedAt`, `lastObservedAt`, `confidenceByField` and subdocument ids, because every resolve re-mints `recentGrants` subdocument ids and re-decays confidence on grant rows whether or not they were ported.

The post-run chain is defined once as a declarative registry (`DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS` in `runScraperSweep.ts`, issue #2050): each stage owns its command, args builder, enable predicate, and optional typed result contract, and both the plan builder and the runner derive from it.
A stage that declares a result contract but exits successfully without a readable, valid result artifact fails loud rather than silently dropping its delta.
Every merge-applying stage declares one, so `summary.json` carries its counts and an exit code is never the only evidence the stage ran: `stale-scrape-run-reap` reports `staleScrapeRunReapDelta` (`running`, `planned`, `closed`, `changedSinceRead`, `keptByReason`) and fails its contract if its report is not an apply scoped to heartbeat-stale runs or plans any other reason, `researcher-dedupe` reports `researcherDedupeDelta`, `grant-shell-faculty-port` reports `grantShellPortDelta` and fails its contract unless its report is an apply, `eponymous-fra-merge` reports `mergeDelta`, and both `url-identity-dedupe` and `website-url-identity-dedupe` report `urlIdentityDedupeDelta`, whose fields are enumerated in [`research-entity-pi-dedupe-runbook.md`](research-entity-pi-dedupe-runbook.md).

The `fellowship-development-full` mode runs the fellowship engine's own post-run chain (`FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS`, issue #2172), which wires the existing `programs:*` scripts against the freshly scraped catalog in this order:

1. `program-visibility-gate` (`student-visibility:gate --collection=programs --apply`)
2. `global-regions-backfill` (`programs:backfill-global-regions --apply`)
3. `official-sources-backfill` (`programs:backfill-official-sources --apply`, opt-in and off by default)
4. `link-labels-backfill` (`programs:backfill-link-labels --apply`)
5. `accepting-applications-invariant` (`programs:backfill-accepting-applications-invariant --apply`)
6. `source-link-health` (`programs:backfill-source-link-health --apply`)
7. `research-relevance-audit` (`programs:audit-research-relevance`, report-only)
8. `freshness-audit` (`programs:audit-freshness`, report-only)
9. `dead-data-prune` (`observations:prune-dead --apply`; opt-in, only when the sweep is run with `--prune-between-phases`)

Each backfill applies with the script's own confirm flag (production writes are blocked by each script's own apply guard, so the Development mode is safe), and the two audits run report-only.
`program-visibility-gate` re-gates every program row after the lanes have written, because a fellowship's classification is derived during materialization (see "Program classification is a projection derivation" below) and the tier reads it.
Every stage that takes an `--output` path is held to a report contract: a stage that exits successfully without a readable, valid JSON report at the path recorded in `summary.json` fails loud, and a stage that writes no report records no `artifactPath` at all.
`official-sources-backfill` is opt-in via `SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET=1` because `programs:backfill-official-sources` is not a general recomputation: with no `--input` it replays the committed one-shot curated change-set at `server/src/scripts/data/programOfficialSourceBackfill.json`, so running it on every sweep would overwrite each listed record's freshly scraped `sourceUrl` with a frozen hand-researched value.
The former `catalog-refresh` stage and its `fellowships:refresh` command wrote the fellowship catalog straight into Beta or Production, so both were removed with the Beta sweep modes; the catalog now reaches Beta and Production the same way the research corpus does, through promotion.
No `Fellowship`/`/programs` Meilisearch rebuild stage is wired because there is no programs search-index script; `researchEntity` is the only Meilisearch-syncable type.
The two engines can therefore be scheduled, gated, and reasoned about on independent cadences.

### A dead acquisition lane is a failed run, not a warning

`runReport` has always warned "Run produced zero observations" and "Source coverage metadata exists, but successful run emitted zero observations", and the run still ended `success`.
So the diagnosis existed on every barren run and escalated to nothing: six Development sources emitted zero observations on every run they ever had (8, 5, 3, 3, 3 and 3 runs), three of them funding lanes, while the sweep summary and the operator board read healthy (#2607).

`scrapers/sourceYieldGuard.ts` converts the streak into the run's own status.
It classifies every run of a source as `productive` (emitted at least one observation), `inconclusive`, or `barren`, and once the current run plus its unbroken run of barren predecessors reaches `BARREN_RUN_STREAK_FAILURE_THRESHOLD` (3), the orchestrator persists `status: 'failure'` and records the reason in `run.errors`.

Nothing new reports it, because a stored `failure` is what the existing surfaces already act on.
`scraperSweepArtifactError` fails the sweep step on any `runStatus` other than `success`, so the sweep counts the source in `failed` and exits non-zero; `sourceHealthService` raises the source to `error` risk with "Latest run failed; inspect scraper report before rerunning"; and `runReport` warns not to materialize without inspecting errors.
The sweep's own `sourcesThatProducedNothing` stays report-only for the shorter streaks it can still see.

Four properties of the rule are load-bearing.

- **It is not gated on a recorded successful fetch.** The issue proposed `fetched > 0 && attributed == 0` as the cheap unambiguous guard, and on real data it is inert: none of the six dead lanes records `fetchMetrics` at all (467 of 2,009 Development runs do), so a fetch-gated guard would have fired on zero of them.
- **The streak, not a single run, is the trigger.** A source can legitimately have nothing new to say once, so one barren run stays `success` and is left to the sweep's report-only count.
- **An `inconclusive` run is stepped over rather than counted or treated as a reset.** A run is inconclusive when it is `invalidated`, still `running`, or `interrupted`, when `options.only` scoped it to a handful of entities so its silence says nothing about the lane, or when the work planner skipped every target it planned (`workPlannerSkippedEveryTarget`, the same predicate `runReport` uses for its warning, so the two cannot drift).
  Without the step-over an alternating history would never accumulate a streak; with a reset instead, one quarantined run would hide a dead lane indefinitely.
- **A source with no re-crawl expectation has no yield expectation either.** `sourceIsExpectedToYield` exempts a disabled source and the `MANUAL_OVERRIDE` tier, mirroring `classifySourceFreshness`.
  That is the whole exemption list; do not grow it into a denylist of lanes that need operator-supplied input, because "it needs a CSV" is indistinguishable from "it is dead" when the lane has produced nothing for eleven runs.

The history read is bounded to the most recent `BARREN_RUN_HISTORY_SCAN_LIMIT` (12) runs of the source, so running out of history settles the question conservatively as "no failure".

#### A failed run records the frame it failed on

`errors[].stack` has been a path on the `ScrapeRun` schema since the beginning and nothing wrote it between June 2026 and #3891: four runs from May and early June carry one, none since, because the June 2026 foundation rewrite replaced the error write with the message alone and pinned that absence in a test.

It is written now, through `sanitizeErrorForLog`, so every redaction the message gets applies to the stack: credentials in a URL, bearer and access tokens, OpenAI keys, secret headers and fields, emails and phone-shaped digits. A thrown non-`Error` stores no stack rather than an invented one. The test that pinned the absence now pins the sanitization instead, which is a stronger guarantee than storing nothing.

The cost of not having it is recorded in #3891: one run died with `Maximum call stack size exceeded` and, with no frame to read, the cause had to be narrowed by elimination over the lane's source.

#### A run keeps what it measured

`metrics` on a lane's return value is lost when the lane throws, and a throw is when a measurement is worth most: one Development run died after 474 observations with `Maximum call stack size exceeded` and stored nothing about how far it had got (#3890, #3891).

A lane reports through `ctx.reportMetrics(...)` as soon as a number is known.
The orchestrator holds the accumulator outside its `try`, so a crash cannot take it, and persists it on the success path and the failure path alike.
A returned `metrics` object wins key by key, because the return value is the lane's final word, and a key only reported mid-run survives beside it.
A run that measured nothing stores no `metrics` at all rather than an empty object.

`reportMetrics` is optional on `ScraperContext` only because several dozen test fixtures build a context by hand; the orchestrator always supplies it and `orchestrator.test.ts` pins that, so call it as `ctx.reportMetrics?.(...)`.

What this does not change: **the barren-streak guard does not need metrics and is not silent without them.**
`classifyRunYield` reads `observationCount` to decide `productive`, and consults `metrics.workPlanner` only to upgrade a barren run to `inconclusive`, so a run with no metrics reads `barren`.
Missing metrics can cause a false failure, never a missed one.
Measured on Development over the 470 runs in the fourteen days to 2026-09-29: 277 belong to 22 lanes whose code returns no metrics at all, and every lane that does report stored them on every completed run but five.

#### The same rule, per unit inside a lane

A source-level check cannot see one unit inside a lane going to zero, because the lane's other units keep yielding and the source total never drops.
One BBS track listed zero faculty for three consecutive runs while every run reported `success` with no warnings and no errors, and the per-source check had nothing to fire on (#3833, #3876).

A unit is the smallest thing a lane fetches and parses on its own: one track page, one department roster, one centre index.
A lane reports what each of its units yielded in `metrics.unitYields`, keyed by unit, and `resolveBarrenUnitStreakFailures` applies the same streak rule to each key, with the same threshold and the same `productive` / `barren` / `inconclusive` classification, so there is one rule and one place to change it rather than a hand-written floor per lane.
A unit failure fails the run exactly as a source failure does.

Three rules make the per-unit arm safe to add to a lane.

- **Report a unit only on a run that attempted it.** An omitted unit reads as `inconclusive`; a zero reads as `barren`.
Reporting zero for a unit the run never fetched is the one way to make this guard lie, which is why the BBS lane records a count on the branch that parsed the page and not on either branch that failed to read it.
- **Count the same thing every run.** The comparison is within one unit across runs and never between units, so rows parsed and observations emitted are both fine as long as the lane does not switch.
- **It cannot fire on history it does not have.** A lane that has only just started reporting unit counts has no prior per-unit facts, every prior run reads `inconclusive` for its units, and the guard stays silent until the streak accumulates.
That is a real delay, not a defect: only 159 of the 470 Development runs in the fourteen days to 2026-09-29 persist any `metrics` at all, and the BBS lane persisted none before this.

A lane may still keep a stricter check of its own.
The BBS lane's per-track floor fires on the first barren run for a track that has listed PIs before, where the general rule waits for the streak, so deferring to the general rule alone would cost two runs of detection on the one unit class known to have broken.

### A run record always ends terminal, and `running` is read through a heartbeat

Before #3595 an interrupted run never closed its `scrape_runs` record, so 48 Development rows read `running` for up to four months and a question as simple as "is a sweep running?" invented activity.
The contract now has four parts.

- **Every exit path of `ScraperOrchestrator.run` writes a terminal status.**
  A normal return writes `success`, `partial` or `failure`, a thrown error writes `failure`, and `SIGINT` or `SIGTERM` writes `interrupted` with `interruption: { reason: 'signal', signal }` before the signal is re-raised.
  Every terminal write, the signal write included, goes through `writeScrapeRunTerminalStatus` (`scrapers/scrapeRunTerminalWrite.ts`): up to three attempts with 500 ms and then 1,500 ms of backoff, so a transient Atlas DNS failure no longer leaves a finished run `running` with its real outcome only in the console.
  When every attempt fails it logs one line naming the status, the attempt count and the last error, and says the row stays `running` until the stale-run stage or the command below closes it.
  A failed `failure` write is logged and the scrape's own error is rethrown, so the cleanup never replaces the real fault.
  An exhausted `success` or `partial` write is thrown as `ScrapeRunTerminalWriteError` and is not re-recorded as `failure`, because the scrape itself did not fail.
  The signal write carries a 4-second deadline (`SCRAPE_RUN_INTERRUPT_WRITE_DEADLINE_MS`): a hung attempt is abandoned at the deadline and no retry starts whose backoff would pass it, so the handler still re-raises the signal inside the shared budget.
  The signal write shares one handler with the job-lock release (`scrapers/interruptCleanup.ts`), so neither cleanup can kill the process while the other is still writing, and both must settle inside `INTERRUPT_CLEANUP_TIMEOUT_MS` (5 seconds) because the sweep sends `SIGKILL` 10 seconds after its `SIGTERM`.
- **A running run proves it is alive.**
  The orchestrator stamps `heartbeatAt` at creation and every `SCRAPE_RUN_HEARTBEAT_INTERVAL_MS` (1 minute), and records `owner: { host, pid, lockOwnerId }`, where `lockOwnerId` is the `ScrapeJobLock` owner for a writing CLI run.
  It also records `codeSha`, the commit the process loaded (`scrapers/scrapeRunCodeIdentity.ts`: a declared `SOURCE_COMMIT`, `RENDER_GIT_COMMIT` or `GIT_COMMIT`, else the checkout's `HEAD` when the process started), so a reader can ask by ancestry whether a fix was in the run (#3824); runs before that change carry none.
  `classifyScrapeRunLiveness` in `scrapers/scrapeRunLiveness.ts` reads a row as `finished`, `live` (heartbeat within `SCRAPE_RUN_STALE_HEARTBEAT_MS`, 15 minutes), `stale`, or `unverifiable` (a `running` row that predates heartbeats).
  Only `live` means a writer is working.
  Ask "is anything running" with `classifyScrapeRunLiveness`, never with a bare `status: 'running'`; `sourceHealthService` and `runReport` already do.
  `recentRuns` reports `running` (live), `unverifiable` (predates heartbeats and started within 72 hours), `abandoned` (stale, or predates heartbeats and started more than 72 hours ago, per `isAbandonedScrapeRun`) and `interrupted` separately.
- **A run that died without a word is closed by a writer, not by a reader.**
  A `SIGKILL`, an out-of-memory kill or a host crash runs no handler, so its row stays `running` with a heartbeat that stops.
  `yarn --cwd server scrape-runs:reconcile-stale` is dry-run by default and reports every `running` row with a verdict.
  It closes a row as `interrupted` only when its heartbeat is older than the stale bound, or when it predates heartbeats and started more than 72 hours ago (`legacy_abandoned`), and it keeps any row whose heartbeat is fresh, whose source holds a live `ScrapeJobLock`, or whose owner process is still alive on this host.
  The bounds can be raised with `--stale-after-minutes` and `--legacy-older-than-hours` but never lowered.
  Each write pins the `heartbeatAt` it read, so a run that beat after the plan was built is left alone, and `finishedAt` is set to the last sign of life rather than the time of the cleanup.
  `--apply` requires `--confirm-reconcile-stale-scrape-runs` and refuses any target that is not Development, because Beta and Production receive `scrape_runs` only through promotion.
- **The Development sweep reaps heartbeat-stale runs on every run.**
  Until this stage existed nothing scheduled the command, which is how the stuck rows accumulated.
  The first Development post-run stage, `stale-scrape-run-reap`, runs it with `--apply --heartbeat-stale-only --started-before <sweep start>`.
  It closes a row only when it is `heartbeat_stale`: its heartbeat is older than the stale bound, its owner is not a live process on this host, and its source holds no live `ScrapeJobLock`.
  It never closes a row with a fresh heartbeat, a live owner or a held lock, and never one that started at or after the sweep began (`started_at_or_after_cutoff`), so the sweep's own runs are left for the next sweep.
  A row that predates heartbeats is kept as `legacy_operator_only` when it is past the 72-hour bound, or `legacy_too_recent` when it is not, because its start time is its only sign of life; closing those stays the operator-run command without `--heartbeat-stale-only`.

`interrupted` is a stored value, so every consumer handles it: the sweep fails the step (any status other than `success`), `scrape run` exits nonzero, `runReport` warns not to materialize the run, `sourceHealthService` rates it `warn` with a rerun action, and the barren-streak guard steps over it as `inconclusive`.
Treat the stored set as open anyway, because Development still holds a few `completed` and `failed` rows written by raw updates that bypassed the validator.

### Faculty Researcher spine creation

There is no standalone faculty-projection sweep stage, and adding one back would contradict the current identity policy.
A `Researcher` spine is created only where a research signal already attaches to the person: `canonicalMembershipMaterializer` resolves-or-creates the `Account` and the thin `Researcher` together while materializing a canonical membership, and the ORCID branch of the same path creates an accountless `Researcher` for an identity that carries a valid ORCID.
The `user`-observation path in `entityMaterializer` mints a person only where the corpus already names that person as the lead of a live research entity: a bare directory identity that reaches no existing researcher by netid, name, email, or the official profile page it cites, and that no live `inferredPiUserKey` observation names, is still refused with `skipped('directory-identity-without-research-signal')` (issue #2129).
That refusal is the bulk of the #2325 reading: of 5,053 `user` keys the engine cannot resolve on Development, 2,868 are `absent` (no researcher of that surname exists, so the #2129 refusal is the whole answer) and 2,062 are `ambiguous` (same-surname candidates the resolver correctly declines to choose between).
Resolving them is mostly not a served-row question either: 4,954 of the 5,053 name a person who appears on no `student_ready` row at all, against 73% of the keys that do resolve, so this population is off the student-facing surface rather than degrading it.
The narrowing in #2773 is that a PI attribution IS the research signal the refusal looks for, rather than the absence of one, so an attributed identity creates an accountless `Researcher` and an unattributed one does not.
The attribution must match the `user` entityKey exactly, never by name: `inferredPiUserKey` values and `user` entityKeys share one namespaced grammar (3,316 of 5,501 PI keys matched a user entityKey outright when this landed), and #2767 refused scattered-token name matching after two wrong-person joins.
`inferredPiUserId` is not part of the gate, because every emitter writes a resolved `Researcher` id into that field rather than a `user` entityKey, so such an attribution already has its person.
Three conditions keep the mint from adding a record nobody can use: the name resolution must be `absent` rather than `ambiguous`, so a name the corpus already holds more than once is never duplicated; the attribution key must assert a name, which is the `dept:<ns>:<slug>` shape `materializeInferredPiMembership` derives one from, or else map to a real netid through `netidForRosterEmailAlias`, because the mint must be able to stamp something the lead resolver can find the new record by; and the entity making the attribution must not be archived, because a folded dept-roster shell is archived without superseding its observations.
A `netid:<first>.<last>` key that maps to no netid still mints nothing, even though #2763 lets the lead resolver read that payload as a name: the name such a key spells is implied rather than asserted, and minting on an implied name would let a misspelled alias invent a person.
A `--dry-run` materialization reports `skipped('dry-run-would-mint-researcher')` instead of creating the person.
Without this, 655 entities sat held from students on `missing_lead` while 624 of them carried an `inferredPiUserKey` and 139 of a 150 sample already had a `user` observation naming that person.
The keys in that population needed a lead resolver that can reach an accountless researcher, not a looser mint, and #2763 gave the `netid:`-namespaced and bare dotted-alias forms one.
`materializeInferredPiMembership` tries the netid, then the alias-to-netid map, and only then the name: a namespaced key asserts a name, and a `netid:<first>.<last>` payload spells one, so a key that reaches no netid can still resolve to a researcher the corpus already holds.
The email-shaped forms (`email:<local>@<domain>`, `netid:<local>@<domain>`, and a bare address) are still held, because only `^netid:` is stripped to a bare payload and anything still carrying an `@` asserts no name to resolve.
The ordering is load-bearing, because the alias map states whose address the alias is while the alias only spells a name, and it fails closed on `ambiguous` for the #2799 reason: an alias the directory maps to two netids resolves to nobody rather than falling through to the name it spells.
A map that resolves to exactly one netid is accepted without a name check, and that is deliberate rather than an outstanding gap.
#2927 proposed adding the check and was closed as disproven: all 106 Development disagreements read as one person spelled two ways, in seven families (a local part dropping an apostrophe, hyphen or diacritic, a closed-up particle or two-word surname, a stored credential or generational suffix, a stored name that is scraped noise, a payload given name that is an initial, a stored first token that is a middle name, and a nickname outside the variant map), and reading the veto through `getResearchGroupDetail` found it would strip the only lead from 50 `student_ready` rows to catch zero wrong-person edges.
Measured on Development before the change: the real gate held 1,579 of 4,792 research rows, `missing_lead` was carried by 386 and was the sole blocker on 74, and of the 45 `netid:`-namespaced keys on those 74 rows 8 resolved through the alias map, 0 through a direct netid, and 24 of the remaining 37 resolved to exactly one researcher by the name the alias spells, with 10 refused as ambiguous.
The retired `research-entity:project-faculty` stage did the opposite, minting a spine for every active faculty row regardless of research signal, and it read the `User` model that issue #2014 retired.
Its removal is therefore intentional rather than a lost capability; see [`research-model.md`](research-model.md) for the identity-join and netid-stamping rules.

The `netid:` namespace on these keys is a misnomer that must not be corrected, which #2831 measured and is the reason that issue closes without a migration.
The payload is a Yale email local part on 2,068 distinct values, essentially the whole namespace, and it is the live join key between a researcher and their own observations rather than a dangling label.
The route there is indirect, and naming it is what keeps this paragraph from contradicting [`research-model.md`](research-model.md), which forbids stamping whatever a source called a netid: `netidFromEmail` hands the local part on to `resolveOrCreateAccountId`, which upserts an `Account` whose own `netid` is that value, after which `accountNetidForResearcherLink` stamps it onto `identifiers.netid` as the account's own netid, exactly as that policy allows.
Measured on Development 2026-09-22, 190 non-archived researchers hold a netid failing the netid shape, and 185 of those values are live `user` observation keys joining 3,479 observations.
That population is shrinking, from 495 a day earlier, because `research-entity:resolve-lead-netids` (#2864) resolves the researcher's real netid from the directory; the observation keys it leaves alone.
Correcting the key to the netid the faculty directory holds for that address is net-negative on the served surface.
Resolving every distinct payload through the real `materializeInferredPiMembership` walk and comparing it against a direct lookup on the directory's netid: 1,743 payloads resolve today, 955 would resolve identically after a correction, 126 would stop resolving, 62 would newly resolve, 2 would resolve to a different person, and 818 have no directory netid to write at all.
Read through `getResearchGroupDetail`, the 62 unlocks sit on 26 live entities of which 21 already serve a lead, and the real gate holds the other 5 on description and duplicate reasons with `missing_lead` the sole blocker on none, so the correction releases zero rows while withholding 13 served lead edges and silently re-pointing 2.
The honest fix for the false namespace therefore belongs at the readers, not the key: a consumer classifies the payload before trusting it as a netid, which `identityFromObservationKey` in [`server/src/scripts/resolveLeadNetidsFromDirectoryCore.ts`](../server/src/scripts/resolveLeadNetidsFromDirectoryCore.ts) does by reading the shape through `isNormalizedYaleNetid` from [`server/src/utils/yaleNetid.ts`](../server/src/utils/yaleNetid.ts), and that is what #2864 did to release 159 leads without touching a single key.

### Eponymous FRA-to-lab merge and durable redirects

The `eponymous-fra-merge` sweep stage (`research-entity:merge-eponymous-fra`, on by default in Dev sweeps, disable with `SCRAPER_SWEEP_AUTO_MERGE_FRA=0`) collapses only the high-confidence eponymous case: a `faculty-research-area-*` shell that shadows the same PI's concrete lab home.
Selection filters to the `profile_area_shell_with_concrete_home` dedupe category and refuses a `CENTER`/`INSTITUTE` canonical (issue #1957), then relinks references onto the canonical, recomputes student visibility, and force-resyncs the canonical to Meilisearch.
Every merge records a durable `ResearchEntityRedirect` (`researchEntityMergeRedirectService.ts`) keyed on the shell slug/id and pointing at the live canonical, so a later re-scrape resolves the old shell to its canonical instead of re-minting a duplicate; resolution follows redirect and `canonicalGroupId` chains and never depends on the shell row still existing.
Because resolution replaces the document the identifier found, the materializer never projects an observed `slug` onto a row that already has one (issue #2905): a slug names the row it is stored on, so an observed slug may only mint one, and writing the shell's slug onto the canonical would invalidate every bookmark, redirect and search-index document keyed on the canonical's slug.
The `archived-cleanup` stage enforces a fail-closed redirect invariant (issue #2039) in every mode, not only in `--merge-residue-only`: it refuses to delete any archived row that is not provably inert and defers it with a reason instead, including a row whose slug has no surviving redirect row (#2795), and the reason codes are enumerated in [`research-entity-pi-dedupe-runbook.md`](research-entity-pi-dedupe-runbook.md).

### Materialization is run-scoped, so an interrupted run strands its observations

`materializeFromRun` is the only entry point that enumerates observations, and it is scoped to a single `scrapeRunId`.
The CLI calls it after `orchestrator.run` returns, so a scraper that throws (run left `failure`) or a process interrupted mid-run (run left `interrupted`, or `running` until `scrape-runs:reconcile-stale` closes it after a `SIGKILL` or a crash) never reaches the call at all.
Nothing else re-enumerates observations by key: `research-entity:rematerialize` selects by `research_entities.slug` and reports `found: false` for a key with no entity row, and the synthesis lanes enumerate existing entities.
There is no corpus-wide materialize pass.

`materializeFromRun` materializes its rows in their usual order, in chunks of up to 100 same-type rows (`materializeObservedEntitiesInChunks`, #3568).
For each chunk, `MaterializationChunkPrefetch` reads once what each row would otherwise read on its own: the row's observations, and for research rows the stored document, the observations anchored to the row's other identifier, whether any merged-in row points at it, and its lead role assignment.
Observation reads carry the per-row query's index hint, so each row sees its observations in the same order, because the resolver breaks an exact tie by array order.
An entity with more than one lead assignment, a merged survivor, and a tombstoned or C4-adopted canonical all read live.
In an apply run a row marks its own id and slug, and a fold marks its canonical, before anything is written.
From then on every answer about a marked row reads live, and so does every "no document" answer after a create in the chunk.
A prefetch that fails falls back to per-row reads.
Dry-run projections were measured identical, apart from the wall-clock `lastObservedAt` and confidence decay of at most 1.5e-6, on 600 sampled Development rows from three lanes.

The consequence is a stable failure mode rather than a transient one.
Observations from an interrupted run stay live and unsuperseded forever, no entity is ever minted for their `entityKey`, and no later sweep revisits them, because supersession keys on `observationFingerprint` within a source lane rather than on whether the lane was ever materialized.
Measured on Development for issue #2383: 978 of 1,508 stranded keys (10,828 of 14,592 live observations) were emitted only by runs that never reached `success`, including 521 of the 527 keys carrying a complete faculty observation set with no identifiable target.
Those observations are unprocessed input, not dead data.
Do not prune a stranded lane before checking this axis; pruning it discards acquired evidence that was never offered to a materializer.

`research-entity:rematerialize` reports `skipped: archived-entity` for an archived row unless `--include-archived` is passed (issue #2905).
An archived row has no served surface, and a merged shell's slug resolves through its redirect to a live canonical, so materializing it writes one document while the report diffs another.
A row whose slug or id resolves through a redirect to a different canonical reports `skipped: redirected-to-canonical` even under `--include-archived`, because the write would land on the canonical while the diff and the re-gate scope stay keyed on the requested row.
The run also attempts every requested slug and carries a per-slug failure in `entitiesFailed` rather than aborting partway through, and a re-gate failure lands in `regateError` instead of losing the report, then exits non-zero in either case, so an operator can tell from the report which slugs were written.

The report's `changes` array once was exactly as wide as `REMATERIALIZE_TRACKED_FIELDS`, so a field the materializer rewrites and that list omits read as unchanged rather than as unmeasured (issue #2536); it now covers every field the run may write, as described under the `--foreign-contact` pass below (#3822).
`entityType` was omitted while its derived `kind` was tracked, so every report answered a `LAB`-versus-`FACULTY_RESEARCH_AREA` drift question with the shadow of the field instead of the field, and the first reader of it concluded the materializer refused to write the corrected type when the write had always been correct.
Measured on a 400-row Development sample, the pre-fix list reported 244 rows as changed and hid 67 field-level changes it had no column for (`departments` 40, `schools` 26, `school` 1) on top of an `entityType` column that could not be non-zero at all.
Add a field here when the materializer plans it and the product serves it; `inferredPiUserKey` stays out because it is planned but persisted on 0 of 8,280 Development rows, so tracking it would report a change on every run forever, and `contactEmail`, `contactName` and `contactRole` stay out because `publicResearchDetailGroup` withholds them from every served payload, so a report that carried their values would print a withheld contact beside a per-slug defect judgement; they are still compared, but recorded by field name and direction only.
The list doubles as the `--only-fields` allowlist, so widening it mints a write scope as well as a report column, and a field the materializer co-derives needs its whole closure in that scope or the scoped write lands one half of a pair.
Every member of a group in `MATERIALIZER_DERIVED_FIELD_GROUPS` is written together, so `--only-fields=kind` and `--only-fields=entityType` both write that pair (issue #2144) and `--only-fields=departments` also writes the `school`, `schools` and `orgAffiliationLabels` that `applyResearchEntityOrgUnitCanonicalization` recomputes from it, rather than leaving the stored `schools` facet describing the old departments.
A scoped pass also scopes what runs after the projection (#3874).
Lead-PI school inheritance (`lead-pi-school-inheritance`) runs only when the expanded scope names `school` or `departments`, and otherwise appends no observation and writes no field; before this, a pass scoped to `researchAreas` wrote `departments` on 2 Development rows.
The inferred-PI and inferred-director lead edges, the access-signal upserts, and the department-roster shell fold are skipped, because they write no field and the report compares fields, so any write they made would be invisible.
The dedupe merge's fill-only pass (`rematerializeMergeCanonicalFillOnly`) is the one scoped caller that keeps them, through `keepPostProjectionEvidence`, because it exists to carry the merged-in evidence onto the survivor.
The browse-rank recompute and the search-index sync still run, because each is a cache recomputed from the row as stored and must follow the scoped write.

### Stored-versus-projected divergence is four classes, and only one of them is safe

`yarn --cwd server research-entity:projection-drift-census` (`projectionDriftCensus.ts`, pure classification in `projectionDriftCensusCore.ts`) measures the gap between a stored row and what the engine would project onto it today.
It is read-only, takes `--sample=<n>` over the live corpus or `--slugs=`, and reuses the rematerialize skip rule so an archived row or a row that resolves through a merge redirect is excluded rather than diffed against a document the write would never land on.
`--sample` defaults to 200, `--include-archived` widens both the draw and that skip rule, and `--output` writes the per-row findings to a `.json` path under the approved temp roots, because the console prints the counts and omits the per-row entities.
Read-only means it writes no document rather than that it has no cost: a dry-run projection still resolves a card description, so a sampled row whose stored `shortDescription` misses the quality bar issues the same grounded gpt-5-mini call a real materialization would, which spends per sampled row and makes the `shortDescription` occurrences inside `overwrite` and `fill-empty` reproducible in kind rather than value for value.
Suppressing that call would understate what a rematerialize actually writes, so the census keeps it and the figures below are re-measured rather than quoted.
A single divergence number is not actionable, because a plan holds four different things and they point in opposite directions (issue #2688):

- `unstorable`: the engine plans a field the `ResearchEntity` schema has no path for, so mongoose drops it on write. The divergence is permanent and reports the same value on every run.
- `fill-empty`: the stored value is empty and projection would supply one, so the write can only add. This is the only class that is safe by construction.
- `overwrite`: both sides hold a value and they differ. Whether projection or the stored value should win needs a per-field argument, and a repair lane may have set the stored value deliberately.
- `clear-stored`: projection would empty or unset a value the row holds today, so the write removes something a student may be reading.

Storability is read from `ResearchEntity.schema.paths` at run time rather than from a hand-kept list, because a list would drift from the schema and reintroduce the phantom divergence the census exists to separate out.
Storability picks which class a divergence falls into and never whether one exists.
Mongoose drops an undeclared path on write but it also never strips one already stored, so an off-schema field the row holds at the planned value agrees with its own projection and is not divergent at all; classing it `unstorable` on the strength of the field name alone counted such a row as permanently divergent.
The comparison therefore runs before the class does, for every class.
Storability is not the only phantom, and the second one hides inside `overwrite` rather than beside it.
The stored side of the comparison was written through the schema and the planned side is still the raw observation value, so mongoose's own write artifacts read as a content difference: it mints a fresh `_id` into every subdocument it casts, applies subdocument defaults, casts a grant's `startDate` string to a `Date`, and stores a subdocument's keys in schema order rather than in the order the projection emitted them.
Compared directly, a byte-identical `recentGrants` list therefore lands in `overwrite` on every run and no run can close it.
The census casts a planned value through its schema path before comparing and takes the comparison over a canonical form with the minted id dropped and keys ordered, so `overwrite` means a real content disagreement.
That normalization alone retired every `recentGrants` occurrence: 41 of 275 `overwrite` occurrences in a 400-row sample were the cast artifact and nothing else, so a figure measured before it landed overstates `overwrite` and therefore the actionable count.
Measured on Development with every normalization in place, over a 400-row sample of 4,743 live rows: 393 rows diverge in some field, but 229 of them diverge *only* in `unstorable` fields, leaving 164 rows (41 percent, about 1,945 at corpus scale) with any actionable drift at all.
Of those, `fill-empty` reaches 53 rows, `overwrite` 134 and `clear-stored` 22, so a blanket rematerialize would empty roughly 261 live rows to fill roughly 628 and more than half of the headline can never be closed by any run.
Across four consecutive 400-row draws the shape held while the counts moved: 392 to 398 rows diverging, 226 to 229 permanent-only, 164 to 172 actionable, `fill-empty` 44 to 53, `overwrite` 134 to 143, `clear-stored` 19 to 27.
Read the split, not the digits: a random `$sample` is a different 400 rows each time, and other sessions write Development while a run is in flight.
Fifteen field names carry the `unstorable` class, led by `inferredPiUserKey`, `contactInstructionsQuote` and `inferredPiUserId`; each is a live observation field consumed by a sibling materializer or access-signal derivation rather than stored on the entity row, so its projection is expected to be dropped and is not a defect to repair.
Re-measure with the census rather than quoting these figures back: two of the classes are the thing a repair is meant to change, and a change to the materializer's read scope moves the `unstorable` occurrence counts without any row changing.

`unstorable` was a write amplifier as well as a reporting inflation, and #3869 closed that half.
The projection's no-op short-circuit compared every planned path against the stored row, so a path that can never land held the comparison open forever, and the same flag gates the row write, the `updatedAt` bump and the Meilisearch re-sync.
Measured over a random 300 live rows on Development, 3 rows converged and 113 converge once storability is read, so 110 rows, 37 percent, were taking a write and a re-index on every pass that could change nothing.
No stored value changes: 7 of the 8 paths that held those rows open are stored on zero rows of the corpus, and `studentDecisionExplanation`, stored on 1,742 rows as legacy residue, still differed from its own projection on 5 rows whose `updatedAt` is later than the observation, which is that path's own evidence that the write does not land.
Storability is read from the live schema in one place, `materializerProjectionPathIsStorable`, which the census calls rather than restating, so the engine and the census cannot disagree about what counts.
An `unset` is compared whichever way storability reads.
Mongoose strips an undeclared `$unset` as well as an undeclared `$set`, measured by raw-seeding a value under one and watching a pass that plans its removal leave it in place while clearing a declared field in the same update, so an unstorable `unset` path could hold a row open in the same way.
It reaches nothing today, because `inferredPiUserId` is the only undeclared entry in `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS` and no row stores it, so the comparison stays on the side that cannot skip a removal a row does need.

`scaledToCorpus` appears only on a `--sample` run, because a random `$sample` is the only population the scaling is valid for and extrapolating a caller-chosen `--slugs` list to 4,744 live rows reports that the whole corpus diverges because the one slug asked about does.
Its denominator is every row drawn rather than every row classified, so a skipped row does not inflate the estimate.
A requested slug that names no document reports `skipped: entity-not-found`, and a requested archived row loads and reports `skipped: archived-entity`, so a slug can never be dropped from the report without a row saying so.
A row the engine projected nothing for reports `skipped: no-projection-evidence` rather than joining the classified rows with an empty plan, because "stored state agrees with its projection" and "nothing was projected at all" are opposite claims and an empty plan reads as the first.
That distinction is load-bearing outside Development: promotion copies materialized collections without the observation store, so Beta and Production hold a full entity corpus against zero observations and a census there would otherwise report every row clean.
The figures above were measured before that skip existed, so a re-measure on Development moves `rowsSampled` down by however many sampled rows carry no in-scope evidence and moves the divergent share up accordingly.

The one served consequence of that class is attribution rather than content.
`fieldProvenance` outlives a field's retirement, because the projection keeps recording what a source asserted even after nothing serves it, and `servedFieldContributionLabels.ts` turns a provenance key into a student-facing "this source contributed X" row on the detail page.
`studentDecisionExplanation` was retired by #1634 and the public DTO refuses to serve it, yet about 1,100 of 3,211 publicly served rows still carried its provenance entry and were served a "Student guidance" credit for content no student can read.
Retiring a served field therefore also means removing its key from that allowlist.

`yarn --cwd server observations:catch-up-materialize` (`catchUpMaterializeStrandedKeys.ts`, pure planning in `catchUpMaterializeStrandedKeysCore.ts`) supplies the missing enumeration axis: by key, over the corpus, independent of any run.
It takes its population from the #2401 audit rather than from a query of its own, so it cannot disagree with the audit about which keys are stranded, and its eligible set is derived from `ORPHAN_CATEGORY_REMEDY` rather than restated, so the two cannot drift.
Only categories whose remedy is `drive_materialization` are offered a mint; `--category` refuses an ineligible one instead of ignoring it.

Every key goes through the ordinary `materializeEntity('researchEntity', { entityKey })` path, so every existing guard still applies - the retired-`PROGRAM` skip, the merged-into-canonical no-op, merge-redirect resolution, and the name-identity authority refusal.
It is not a new write path.
Dry-run by default; `--apply` additionally requires `--confirm-catch-up-materialize` and routes through `assertScriptApplyAllowed`, and `--limit` bounds the batch because an unbounded first run over the whole stranded population is not reviewable.

Read the report, not just the counts.
A materializer guard skip and a zero-field write are reported separately on purpose: a skip is the materializer correctly refusing to mint, while zero fields written with no skip reason means the key was offered, accepted, and still produced nothing, which is the case worth investigating.
The report also carries each key's planned `name` and `entityType`, because this command creates research entities and whether a given mint is wanted is a product judgement that "would create" alone cannot answer.

Measured on Development 2026-09-05: 560 of the 1,508 stranded keys are eligible, and a dry run plans to create all 560 - 551 `FACULTY_RESEARCH_AREA`, 6 `LAB`, 2 `CENTER`, 1 `INSTITUTE`, at 18 to 28 fields each.
No materializer guard rejects any of them, so this would add about 8.7% to a 6,440-row corpus, and `dept-ysph-*` dominates it.
That the guards accept a row is not evidence the row should exist: the YSPH directory enumerates staff, postdocs, and students alongside faculty, and several eligible keys match no `Researcher` record at all.
Size and review the batch before applying, and treat `PERSON_KNOWN_NO_RESEARCH_HOME` as its own batch, since there the person already exists as a `Researcher` but leads nothing, so minting creates a research home the corpus has so far withheld.

#### The Development recovery, 2026-09-05 (#2404)

Applied on Development only, in three batches (10 as a probe, then 507 `NO_TARGET_AT_ALL`, then 33 `PERSON_KNOWN_NO_RESEARCH_HOME` on its own).

| | before | after |
|---|---|---|
| `research_entities` | 6,440 | 7,000 |
| stranded keys | 1,508 | 948 |
| live observations stranded | 14,592 | 8,114 |
| keys never offered to a materializer | 978 | 424 |
| keys with remedy `drive_materialization` | 560 | **0** |
| `student_ready` | 3,102 | **3,102** |
| `operator_review` | 1,575 | 2,135 |
| `suppressed` | 1,172 | 1,172 |

**Only 226 of the 560 carry any description prose; 334 minted with both `fullDescription` and `shortDescription` empty.**
Those 334 were blank at mint rather than blanked afterwards - the key never had a `fullDescription` observation at all, so there was nothing to write (all 226 keys that did have one wrote it).
They are not empty rows: each carries 18 to 28 fields including `name`, `school`, `departments`, `researchAreas`, `sourceUrls`, and `inferredPiUserKey`.
But a recovery of this shape should be reported as "identity and affiliation recovered, prose absent for 60%", not as prose recovery.
Do not size this cohort from a sample: an eight-row slice of the recovered set showed prose on all eight, which is the opposite of the population rate.

All 560 minted at `operator_review`, so the recovery published nothing to students.
That is verified at the serve layer rather than from the stored tier: `publicStudentVisibilityTiers` is `['student_ready']` and a non-admin research search is forced onto it, so a recovered row is unreachable by a student query even though it is present in the Meilisearch index (the index carries `studentVisibilityTier` as a field and the query filters on it, rather than the index being tier-filtered).

**The command is self-limiting rather than idempotent in the usual sense, and that is the safer property.** A re-run does not re-process a recovered key: once the key has an entity row the audit no longer classifies it as stranded, so it leaves the eligible set. Running the same command twice with `--limit 10` recovered keys 1-10 and then keys 11-20, with the stranded population dropping by exactly 10 each time. So the operation is naturally resumable and cannot double-materialize, but repeated runs keep consuming the population - bound it with `--limit` and read `eligibleKeys` rather than assuming a re-run is a no-op.

Two expected side effects worth not mistaking for drift: `NO_MINT_INTENT_ENRICHMENT_ONLY` moved 240 to 239 and `NAME_MATCHES_LIVE_ENTITY` 12 to 13, because the newly minted entities enter the identity index and one previously unmatched key now name-matches a live entity.

Production was deliberately not touched; it is a separate authorized operation.

#### What strands a key in the first place: a write run that materializes nothing

A run without `--auto-materialize` writes its observations and stops.
That is a legitimate workflow, because `scrape materialize --run <runId> --confirm-materialize` finishes it later, but nothing said so: the `ScrapeRun` row records `success` with `entitiesCreated: 0`, `entitiesUpdated: 0` and `materializationSkipped: 0`, which is byte-identical to a run that materialized and had nothing to create.
The `art` lane's 2026-09-16 apply run left 18 research-home keys stranded exactly that way, and the lane read 108 people while serving 0 rows until they were recovered (#2759).
So `scrape run` now warns at the end of any write run that materialized nothing, naming the run id and both finishing commands (`unmaterializedWriteRunWarning`).
The warning is advisory rather than a refusal, because deferring materialization is a choice an operator is entitled to make; what it removes is the silence.

### Stranded observation keys and their category split

`yarn --cwd server observations:audit-orphan-keys` (`orphanObservationKeyAudit.ts`, with the pure classifier in `orphanObservationKeyAuditCore.ts`) splits every live `researchEntity` observation key that matches no `research_entities.slug`. The slug index loads archived rows too, because a merged identity is kept as an archived row carrying a `canonicalGroupId` tombstone (#3027), so that row's slug is the coverage and the separate redirect join this audit used to need is gone.
It is read-only and writes nothing but its `--output` report.

Join against `mergedSlug`.
That is the field the schema and `researchEntityMergeRedirectService` use; there is no `fromSlug`.
Ignoring the redirect table inflates the Development population from 1,508 keys / 14,592 observations to 1,931 / 20,172, because 423 keys (5,580 observations) are correctly re-keyed by a redirect and are not stranded at all.

The classifier reports two independent axes, and conflating them produces the wrong remedy.
`category` says what the lane is; `materializationReach` says whether materialization ever ran over it.
Categories are decided by shape - recorded `entityId`, observed `entityType`, person identity, source enablement - never by the absence of a flag a materializer would have set, since such a bucket reads as empty whether or not the condition exists.

Person identity is matched on both the exact person-slug tail and a first-and-last-name key that drops middle names and initials.
Without the second form, `dept-ysph-megan-l-ranney` and `ysm-faculty-megan-ranney` read as two different people and merge residue is misreported as a lane with no target.

Restoring a redirect is not the safe default remedy.
A redirect converts a dormant lane into an active writer into the canonical entity, which is precisely the #2378 graft channel: `dept-mbb-i-george-miller` would graft the name "I George Miller Lab" onto a live record.
Only `ENTITY_ID_RESOLVES_LIVE` is a safe redirect backfill, because those observations already materialize into that entity; every other cross-scheme match needs a per-key decision on whether the stranded values agree with the canonical.

### Merging a stranded key's evidence into the live home it names

`LEAD_RESOLVES_TO_LIVE_ENTITY` and `NAME_MATCHES_LIVE_ENTITY` carry the remedy `merge_evidence_into_live_home`.
The name states the outcome rather than the reviewer's uncertainty: the key is a second record of a person who already has a live home, so its evidence belongs in that home and never in a new row.
The earlier name `review_per_key` kept these keys out of the catch-up mint path only as a side effect of not being `drive_materialization`, which is the accidental-guard shape #2421 catalogues, so `isCatchUpEligibleCategory` now refuses them by their named remedy.

`yarn --cwd server observations:stranded-key-decisions` (`strandedKeyRedirectDecisionReport.ts`, with the pure decision in `strandedKeyRedirectDecisionCore.ts`) owns that remedy.
Its population comes from the #2401 audit filtered to `merge_evidence_into_live_home`, so it cannot disagree with the audit about which keys are in scope.
Each key's stranded values are compared against the live target it resolves to and the row is recommended as `BACKFILL_REDIRECT`, `RETIRE_OBSERVATIONS`, or `LEAVE_ALONE`.

Two rules decide a row, and both are stated as exemptions rather than as named field lists.
Every observed field is compared unless it is bookkeeping (`lastObservedAt`, `sourceContentHash`, `inferredPiUserKey`) or a `slug`, which differs on every key in this population and which the projection already refuses to write across a differing target (#2918).
Every compared field counts as served copy unless it is bookkeeping, so a `DIFFERS` on one withdraws the key as `WOULD_OVERWRITE_SERVED_COPY`.
Naming the two sets positively failed open twice: `researchAreas` is a browse facet like `school` and `departments` yet was compared and then ignored, and `recentGrants`, `recentGrantCount`, and `fundingAgencies` are all in the public detail DTO yet were never compared at all.
The set of compared fields is taken from the materializer's own `shouldIgnoreObservationForEntityMaterialization` filter, not from a second opinion stated in the report, so "every field a redirect would write" is literally true: an implausible `undergradEvidenceQuote` and the `undergraduateLogistics*` fields are dropped by the projection and must not decide a redirect either.

Dry-run by default; `--apply` additionally requires `--confirm-stranded-key-decisions` and routes through `assertScriptApplyAllowed`.
The report always covers the whole population, while `--only` and `--limit` bound only the write, so an operator executes exactly the rows they read in the dry run.
`--limit` defaults to 25 rather than to the whole population, because a first run has to be small enough to read row by row.

A redirect here is a record that a merge happened, so it only survives a merge that did.
This is the property to preserve when changing the apply path.
The audit defines its population as keys with neither an entity row nor a redirect, so a redirect left behind by a materialization that wrote nothing removes the key from the one lane that could ever find it again: the evidence is not merged, it is invisible.
Each row therefore records its redirect, materializes through the ordinary `materializeEntity('researchEntity', { entityKey })` path, and verifies that the projection reached the intended canonical.
When it did not, the row withdraws its own redirect through `withdrawResearchEntityMergeRedirect` and reports `redirect_withdrawn_merge_did_not_land`, which keeps the key stranded and findable.
`unchanged` is the only materializer skip that still counts as a landed merge, because it is the only one that returns after the projection ran; every other skip reason, including one added later, fails closed into a withdrawal.
A throw is isolated to its own row for the same reason, so an abort partway through cannot leave the rest of the population behind an unbacked redirect.

At most one row per target lands per run.
Several stranded keys routinely name one live home, because the audit pairs keys on a first-and-last identity, and every decision in a run was judged against the same pre-apply snapshot of that home.
Letting a sibling act second would judge it against a target state that no longer exists and record a reason that is false.
The deferred key reports `deferred_target_written_by_a_sibling_key` and keeps its evidence and its stranded status, so a later run re-derives its decision against the home as the first key left it.

This is a stored-data operation, so merging the code changes nothing a student sees.
Read the served output afterwards with `yarn --cwd server research-entity:served-scoreboard`, and treat a `redirect_withdrawn_merge_did_not_land` count above zero as a row still needing a home rather than as a completed merge.

### Ingest-time observation-store guards

`observationStore.appendObservations` (`server/src/scrapers/observationStore.ts`) is the single ingest choke point, and it applies several guards before any observation is stored:

- Ingest sanitization runs `observationFieldSanitizer` over every field from every source so page furniture, contact leakage, and chrome cannot enter a stored field (#1375).
  It also strips the invisible Unicode format characters a CMS emits inside words (U+00AD soft hyphen and its zero-width siblings, plus a no-break-space fold) from every field, array element, and plain-object value, because they render as nothing and silently defeat every pattern that reads the stored text (#2874).
  `sanitizeProjectedField` composes the same step, so a row already holding one corrects on its next materialization.
  That reaches every field a live observation still asserts and no others: a field nothing asserts is never planned, so the stored text keeps whatever it was written with.
  `data:repair-invisible-format-characters` (`scripts/repairInvisibleFormatCharacters.ts`) closes that remainder by normalizing the stored document in place and re-syncing the search document, keyed on the probe "does the stored value still carry one" so a second run reports a real zero.
  It scans all three served collections a materializer projects observed text into (`research_entities`, `researchers`, `fellowships`), taking each name from its model, so a post-run zero is a zero for everything a student can read rather than for two collections out of three.
  Its `entitiesResynced` count comes from what `syncEntities` reports submitting, not from how many documents were handed to it, and the script exits non-zero when any search document was left unsynced: `syncEntities` swallows a Meilisearch failure, so inferring success from the input length would report a delivered fix while the index kept serving the old text.
  It reads and writes the native collections rather than the models, because the stored `profileSynthesisDescription` is not declared on the research-entity schema and a strict Mongoose `$set` drops it without error.
- Supersession keys on `observationFingerprint`; fields in `LATEST_WINS_FINGERPRINT_FIELDS` (including the first-class `methods` field, see below) omit `value` so a fresh snapshot supersedes the prior one despite content drift.
- The regressive-prose guard `isRegressiveProseRefresh` (#2035) protects the quality-guarded prose fields (`fullDescription`, `shortDescription`): when the incoming value is judged not useful by the description-quality checks but an active same-`(source, entity, field)` value is useful, the incoming observation is dropped, so a degraded re-scrape can never overwrite a clean source-backed description.
- Clean-to-clean refreshes are guarded too as of #2232: `isWeakerProseRefresh` drops an incoming prose value that IS useful but scores strictly lower on `prosePreferenceScore` than the clean incumbent it would displace.
  That comparison is necessary because every known regression in this class passes `fullDescriptionQuality` with zero flags, so the subtractive `isUseful` verdict cannot rank two flag-free candidates and the winner fell to the confidence gap alone (0.82 for a non-`/profile/` capture against 0.55 for official-profile extraction), which is how a mission statement displaced grounded research prose and served silently for months.
  Ties pass, so a refresh must be demonstrably worse to be dropped rather than merely not better: an ordinary same-quality re-scrape keeps newest-wins and the corpus cannot freeze on its first capture.
  `prosePreferenceScore` sums only the off-topic demotions of `offTopicResearchHomeDemotionScore` (navigational, recruiting, mission: mission -20, recruitment -30, research 0) and deliberately not the full `scoreResearchHomeDescriptionCandidate`.
  An observation carries an `ObservedEntityType` (`researchEntity`, `user`), never the product entityType or kind that says whether the home is a lab or a faculty research area, so the kind-aware person-centric term would resolve to `organization` for every home and charge legitimate person-voiced faculty research prose -100, ranking it below a mission statement at -20 and inverting the comparison.
  The resolver still applies the kind-aware score downstream, where the product kind is known.
  Do not substitute `researchSubjectSpecificityScore` either: it saturates at 8.00 across a mission statement, a recruitment notice, a figure caption, and real research prose alike, because it grades a short extracted subject phrase rather than a paragraph.
  `collapseLatestWins` applies the same chain, because under `C4_LOSSLESS_INGEST` the write-time guard is skipped and a pure newest-wins collapse would reinstate the regression; it folds each key's rows oldest-first because callers read the log unsorted, so folding in array order would make the comparison depend on the query plan.
  "The same chain" is load-bearing and used to be false: the collapse ran only the two comparative guards, and #2302 found that the half of #2232 meant to hold under lossless ingest therefore did not fire.
  `isWeakerProseRefresh` requires BOTH values to clear the quality bar, so it is blind to a newer value that fails the bar outright, and `isMateriallyThinnerProseRefresh` only sees a value at least 200 chars shorter, so a LONGER newer value that fails the bar fell through both and won on recency.
  `isRegressiveProseRefresh` is the guard for that case and the collapse now calls it first.
  Measured on Development before the fix, over the corpus read the way `materializeEntity` reads it: 744 multi-row prose groups, 9 of which the collapse resolved to a value the quality bar rejects while an older useful value from the same source sat behind it, 7 of the 9 on `student_ready` rows.
  Adding a guard to one of these two paths and not the other is the recurring failure here, so treat the two lists as one contract: any prose guard added to the `appendObservations` chokepoint must be added to the collapse in the same change, and a test must assert the guard fired through the damaging path rather than calling the guard directly.
  One asymmetry is deliberate and stays: `isMateriallyThinnerProseRefresh` runs only in the collapse, because the richer-value preference (#2423) compares against the whole retained log rather than against a single active incumbent.
  A second asymmetry runs the other way: the card-loss guard `isCardLosingDescriptionRefresh` (below) runs only on the write path, because it judges a field pair against the row's stored document and gate lead members, and the synchronous per-field collapse reads neither, so under `C4_LOSSLESS_INGEST` a card-losing refresh is not held.
  The collapse also judges quality without the batch's `researchAreas` or `fullContext`, which the write path supplies, so the two can reach different verdicts on the same pair; that is a known gap rather than a settled decision.
  `appendObservations` resolves every incumbent prose lookup the batch can need once, up front and concurrently, and judges the incumbent with the same `entityType` and `researchAreas` as the incoming value, so an incumbent the quality bar rejects cannot block a refresh.
- The card-loss guard `isCardLosingDescriptionRefresh` (`server/src/scrapers/descriptionCardRefreshGuard.ts`, #3767) judges a research row's `fullDescription` and `shortDescription` as one pair, because the card is built from both.
  It drops the whole incoming pair when the source's current pair builds a complete card and the incoming one does not, filling a field the batch does not refresh from the current value.
  The verdict comes from the gate's own `buildResearchEntityPublicDescriptionRepresentation` with the row's stored fields and its gate lead members, not from the raw prose checks, because a keyword list, a citation or a recruiting line can pass those and still build no card.
  An equal or better pair still replaces the current one, and a row the judge cannot load raises no objection.
  It is one of the two write-path/collapse asymmetries recorded above.
- `retireObservations` (#1966) is a primitive that bulk-supersedes the observations matching a filter (for example an entity's active rows) and stamps a `rollback` marker with an audit reason, without deleting evidence.

Microsite LLM extractors are gated on a versioned content hash (#2025).
Each extractor computes a SHA-256 hash over the exact fetched page bytes plus the extraction contract that would consume them (the extractor's prompt content hash and model id, and for the description extractor also the card model and card-synthesis prompt content hash), compares it against the last stored `sourceContentHash` bookkeeping observation for that `(source, entity)`, and skips the paid LLM call entirely when both the bytes and the contract are unchanged.
Prompt text lives in editable `.md` files under `server/src/scrapers/prompts/`, and each `*_PROMPT_HASH` is the sha256 of its file content (#2099), so editing a prompt `.md` changes the contract hash and re-extracts exactly the affected entities on the next run with no manual version bump, while unchanged pages still skip.
The `--force-llm` flag is the only bypass; the gate is read directly by the extractor so it also holds under `--exhaustive` and `--ignore-work-planner`.

The description extractor is the exception to the bytes rule, and the reason generalises.
Hashing raw bytes cannot skip a page whose markup churns, and on this corpus that is the common case: fetching each host's page twice seconds apart, `medicine.yale.edu`, `ysph.yale.edu` and `sites.google.com` return different bytes every time, while `campuspress.yale.edu`, `research.yale.edu`, `engineering.yale.edu` and `environment.yale.edu` are byte-identical.
2,507 of the 4,123 rows that lane has read fetch from one of the churning hosts, so a bytes hash could never let them skip however many runs happened (#3840).
It therefore hashes a per-page digest over what its extraction paths READ, combined order-independently: the visible text and the deterministic official prose `extractDescriptionPageProse` derives.
Both are required rather than only the visible text, because the deterministic path reads script-tag payloads, JSON-LD, meta descriptions and paragraphs past the prompt cutoff that a text extractor never sees, so a digest over visible text alone would let an official-prose-only change stop re-running extraction (#2022).
Order independence is precautionary and unmeasured; sub-page discovery varying was plausible but not observed.
A page unreachable on one run still drops out of the set and changes the digest, so a transient fetch failure costs one re-extraction, which is preferred over letting a row skip while silently missing evidence it usually reads.
Changing that input invalidated every stored hash for the lane once, so the first run after it re-extracted the lane.

One deliberate exception: the description extractor writes no `sourceContentHash` for a run in which it kept a stored description instead of an unopposed crawled one (the rule lives in [`skills/scrapers/SKILL.md`](../skills/scrapers/SKILL.md)), because that decision reads the stored description, which is not a hash input, and recording the hash would freeze it so a later cleared description was never reconsidered.
Such an entity therefore re-extracts on every run until its pages or its stored description change (#2180).

A second withholding exists for the same reason and is now bounded.
A run that produced a `fullDescription` but no `shortDescription` withholds the hash, because the card synthesis that failed is a separate retryable call and recording the hash would freeze the student-visibility gate's `missing_card_description` blocker in place (#2180, #2436).
That retry used to be unbounded, so a row whose card never succeeds paid for a page read and a model call on every sweep forever: measured on Development, of 4,228 rows the description extractor had touched, 679 had a `fullDescription` and no `shortDescription`, and 362 of those carried no stored hash at all (#3840).
The bound is the description itself rather than an attempt count, because an identical value is diff-skipped and writes nothing, so the observation log cannot count attempts and a row retried ten times looks like one.
The hash is therefore recorded once a run re-derives the same `fullDescription` this lane already stored and still produces no card, since content that yields the same prose cannot yield a card that prose already failed to produce.
The two are compared in stored form, after the same ingest sanitization the stored value went through, so whitespace or redaction differences cannot keep a repeated description looking new.
That reasoning holds only for a card the model declined, so a run whose card call threw (a rate limit, a timeout, an unparseable response) keeps the retry open whatever the stored description says.
A changed or first-seen description keeps the retry open, which is the case the withholding was written for.
The comparison reads this lane's own last `fullDescription` observation rather than the materialized field, which can hold another lane's winning prose, and an unanswerable lookup leaves the retry open so it never closes a decision on a row's behalf.

#### What the gate does not version, and why that is correct (#3332)

The hash covers the page input (bytes, or the description extractor's read digest) and the EXTRACTION contract, so a prompt edit or a model bump re-extracts the affected entities on the next run.
It carries no resolver version, and it should not.
`materializeFromRun` enumerates only entities carrying an observation in that run, so a row is re-resolved only when some lane emits for it; the gate suppresses the emission on an unchanged page, and a row whose pages settle keeps whatever its fields resolved to on the last run that touched it.
That means a resolver improvement is undelivered by default, and the freeze is real.
But folding a resolver version into the content hash would answer it in the wrong currency: a resolver change needs no new observation, because the better-ranked candidate is already in the log, so re-keying the hash would re-spend every paid LLM lane over the whole corpus to deliver text the corpus already holds.
A resolver-version input would have to sit on the MATERIALIZE trigger rather than on the fetch gate - a per-row stamp of "last re-resolved at", compared against the newest candidate observation for the fields in question.

Until such a stamp exists, delivery is a bounded pass, and the reason to bound it is measured rather than cautious.
#3163 changed the resolver's answer on 203 (entity, field) slots and only 13 of those were a stored value failing the served bar, because a changed decision is not a defect: most of the 203 already stored the winner.
A 40-row sample of the 1,304 rows whose resolved description merely differs from stored found 2 improvements, 0 bar regressions and 33 lateral rewrites, several of which read worse as copy while still clearing the bar.
So a corpus-wide rematerialize is churn with a quality risk.

`yarn --cwd server research-entity:audit-frozen-descriptions` scopes the pass instead, and it counts one thing: a description field whose SERVED value is empty today while the corpus holds a live observation for it, read through `sanitizeServedResearchEntityCopyFields` rather than through the inner pass it wraps.
That population can only gain, because there is nothing to overwrite, and the script reports `served_fill`, `served_regress`, `served_lateral`, `served_unchanged` and `projection_silent` separately so a fill is never counted alongside a rewrite.
A row is offered for delivery only when it has a fill and no regression on any description field, because `research-entity:rematerialize` writes a field closure rather than one field.
Delivery is that script's `--slugs-out` list handed to `research-entity:rematerialize --only-fields=fullDescription,shortDescription`, and re-running the audit is the verification, because the selector and the verifier are the same query.

Measured on Development 2026-09-25, with peers writing the same corpus: 284 candidate rows, 67 served fills on 64 deliverable rows, 44 of the fills on `student_ready` rows, 0 served regressions and 25 lateral rewrites left alone.
The bounded pass wrote 122 fields across those 64 rows and moved no visibility tier; re-running the audit read 4 served fills on 4 rows, and a detail-route re-read confirmed the previously empty fields now serve text.
Three same-code runs of the selector reported 71, 69 and 67 fills, so the band on this measurement is about plus or minus 2 from concurrent writes rather than from the code.

At materialization, `entityMaterializer` clears stale observation-only fields on rematerialize (#1963): for `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS` (`methods`, `inferredPiUserId`) it unsets the field and its `confidenceByField` entry when the field is not manually locked, is not written this run, and has no live observation this run, so a value no source still supports is removed rather than lingering.
`methods` is a first-class `string[]` of grounded research techniques (#1954, #1947): the microsite description extractor emits it (grounded through `utils/methodGrounding.ts` to drop vague fillers), the work planner targets it alongside descriptions and areas, and the materializer writes it latest-wins.

Scrapers collect evidence. They should not create unsupported student-facing conclusions such as "accepting undergrads." Materializers derive product records from observed evidence, source confidence, stable keys, and manual locks. The student visibility gate is the public-release boundary: it promotes records that satisfy the visibility rules and holds the rest in the release queue with root repair reasons. In Beta, `operator_review` is an automatic repair state: queued records should be repaired from trusted source evidence where deterministic, then re-gated until they become `student_ready`, `limited_but_safe`, `suppressed`, or an explicit exception.

Research description visibility is assessed after the same lead-aware sanitization used by the public detail response.
A `student_ready` entity must have useful public full and card descriptions after sanitization, and an operator override cannot bypass that invariant.

### A field lock records whether it is a decision or a workaround

`manuallyLockedFields` overrides evidence at resolve time rather than stopping collection.
`confidenceResolver.resolveField` and `resolveFieldRanked` short-circuit a locked field to the value the document already holds, at confidence 1.0 with `contributingSources: ['manual']`, so no observation can outrank it.
`workPlanner` does report `shouldFetch: false, reason: 'manual-lock'`, but only 4 of the 30 files under `scrapers/sources/` pass the lock list to the planner, so most sources keep observing a locked field and the resolver is what discards their assertions.
A lock can also assert absence: `entityMaterializer` builds `manualValues` only from document fields that are not `undefined`, so a locked field with nothing stored resolves to `value: undefined` at confidence 1.0, a confident assertion that there is no value.
That is #2542 hand-rolled; the dated measurement at the end of this section counts how many locked instances on Development are in exactly that state.

Two unrelated decisions share that one mechanism.
An operator judging a value by hand is a decision no later engine improvement may override.
A repair script locking a field because the engine cannot retract a value it no longer has evidence for (#2542) is a workaround, and has to be revisitable the moment that gap closes.
Until #2612 the two wrote the same bare field name, so neither could be acted on.
Measured 2026-09-17, when Development carried 100 locked field-instances across 43 rows: of the 79 that also carried `fieldProvenance` for the value, 33 named a live scraper source, so a third of the classifiable locks were freezing the engine's own output.
The corpus counts have moved since; the dated measurement at the end of this section is the current one.

`fieldLockProvenance` is a per-field map recording why each lock was applied, alongside who applied it and when.
It is the lock-side counterpart of `fieldProvenance`, which records who produced the *value* - a distinction that matters because an operator may lock a value a scraper produced.
Write locks only through `planFieldLock` in `utils/researchEntityFieldLocks.ts`: it returns the lock and its reason as one `$set` fragment, so no writer can record a lock without recording why, and it writes the reason under a per-field dotted path so sibling fields keep theirs.
A source scan in `utils/__tests__/researchEntityFieldLocks.test.ts` pins that, and it matches an assignment as well as a property key: the scan originally matched only `manuallyLockedFields: [`, and the next writer to land assigned the list instead (`change.manuallyLockedFields = [...]`) and shipped 38 unrecorded `websiteUrl` locks straight past it.

A writer may declare only `operator_decision` or `engine_gap_workaround`; `unknown` is a reading, and `planFieldLock` rejects it, because a lock declared `unknown` would be indistinguishable from the pre-#2612 corpus while appearing to record why.
An absent record - every lock applied before this landed - reads as `unknown`, and `isRevisitableFieldLock` returns true only for a positive `engine_gap_workaround`: a lock is re-opened on evidence that it was a workaround, never on the absence of evidence.
A lock asserting absence needs no separate reason: the reason axis records why the lock exists, and a lock asserting absence exists because the engine cannot retract, so it is an `engine_gap_workaround`.
Whether a given lock asserts a value or its absence is read from the row, not duplicated into the record.
The `clear` arm of `sources:repair-promotion-regressed-website-urls` is that case in code: it unsets `websiteUrl` and locks the field.

`operator_decision` has no writer today, and that is not an oversight.
`manuallyLockedFields` appears in no route, controller, or request body, and the DTO never serves it, so every lock in the corpus was applied by a script rather than by anyone using the product.
The value exists because the distinction is the whole point of the record.

Nothing on the serve or materialize path branches on the reason.
A locked field still overrides evidence at confidence 1.0 whatever its reason says, and field retraction, below, deliberately does not consult `isRevisitableFieldLock` either.
Re-opening a lock is its own reviewed operation, never a sweep side effect, because unlocking is exactly how a value someone removed comes back.

#### Releasing a lock: `research-entity:release-field-locks`

The operation that reads the classification, so a workaround lock stops being permanent (#2612).
It asks two questions per lock, in order, and both have to answer yes.

May the engine be asked?
`isRevisitableFieldLockOnEntity` says yes on a positive `engine_gap_workaround` record, and on a lock that holds no value, which is a hand-rolled retraction and therefore a workaround by construction rather than by guess.
A lock that pins a value and carries no record stays `unknown` and stays shut: the rule is still that a lock re-opens on evidence it was a workaround, never on the absence of a record.
A lock on `studentVisibilitySuppressionReason`, `activeAtYaleCache` or `yaleStatusCache` is refused outright and reported as `keep_gates_other_writer`, because those locks hold `ysmLabDelistingReconciler`, the roster-departure reconciler, and the operator lane `research-entity:record-departure` shut rather than holding a projection shut.
Those lanes read the lock list and update the row themselves, so a materialization asked to ignore one of their locks answers for the projection only and reports agreement while the lane it actually gates stays unexercised - and those lanes are what flip a row between student-visible and suppressed.
Releasing one of them needs an operation that exercises the reconcilers; `fieldLockGatesNonMaterializerWriteLane` names the fields, and a new lane that gates on a lock means adding its field there.

Does the engine agree?
The answer comes from `materializeEntity(..., { dryRun: true, reviseRevisitableFieldLocks: [...] })`, which runs the real resolve-and-project path with the named locks ignored and reports what it would write in `plannedSet`.
`dryRun` is required rather than conventional: `materializeEntity` throws without it, so a projection derived with locks ignored can never reach a write.
The option names fields rather than saying "all revisitable" because a kept lock still pins a value other fields' derivation reads - `websiteUrl` feeds the identity-name authority loop - so a plan is only an answer about the exact set of locks that is about to be released.
On a row with several revisitable locks the operation therefore re-asks about the agreeing subset until the plan describes that subset, which terminates because the subset only shrinks.
The lock is released only when that answer is the value the row already holds, which makes a release value-preserving by construction: nothing a student reads moves on the day of the release, and the field is back under derivation for every improvement after it.
So no re-gate and no re-index is needed, and verification is a re-read of the served surface rather than the script's own counters.

Disagreement is the expected majority case and is not a failure.
It says the gap the lock stands in for is still open - typically a source still asserting the value a repair cleared, which needs a retraction rather than an unlock.
A row the materializer declines to project at all (no live observation) is reported as `keep_engine_silent`, because "it would have written nothing" is a claim about a code path and only a plan counts as an answer.
A slug a durable merge redirect resolves to another row is reported the same way: the plan describes the survivor, not the shell whose locks are being judged.

One class of field needs the plan to name it before a release, rather than falling back to the stored value: the target fields of the four `workPlannerSourcePolicies` lanes, which are exactly the four sources that pass the lock list to the planner, plus `undergradAccessEvidence`, which `labMicrositeUndergradLLMExtractor` drops outright while the field is locked.
On those fields the lock is why no observation exists, so reading the absence of evidence as agreement would hand the field back to the lane the lock was holding shut, and the next scrape would restore the value someone cleared.
`lockSuppressesFieldCollection` derives the set from the planner policies rather than naming it by hand, so a new lane's target fields are covered when its policy lands.

"Nothing a student reads moves" is wider than the locked field, because a lock's presence in the list can gate a sibling field's derivation.
Almost every lock gate in `projectFromLog` reads `set[field] ?? entityDoc[field]`, which is the same value once the locked field agrees with what is stored, so the locked field alone is enough.
`fullDescription` is the exception: only its unlocked path can decide the body restates the stored card, and that reopens `shortDescription` - a served, indexed field - for re-derivation even when the body itself does not move.
`siblingFieldsGatedByFieldLock` names those pairs, the plan has to agree about the sibling too, and a lock whose release would move one is reported as `keep_sibling_field_moves`.
A gate that changes a sibling's derivation rather than its own field means adding the pair there.

The report's `summary` is the plan, per verdict.
What a run wrote is `appliedReleases` and `releasedRows`, which count only the conditional writes that won their optimistic-concurrency check, because a counter that overstates what a repair delivered is itself a defect (#2440).
A row that throws is recorded in `errors` and the sweep continues, so one unusable row cannot abandon the report for the rows already written.

Measured on Development 2026-09-22: 126 locked instances across 78 rows, every one of them with no `fieldLockProvenance` record, so every one read `unknown` and was permanently frozen.
39 of the 126 assert absence; 29 of those are contradicted by a live observation and stay locked, in several sampled cases by a publisher page or another institution's profile, which is what releasing on the record alone would have re-served.
The sweep released 2 instances on 2 rows and left 124, verified by re-reading all 78 rows through `getResearchGroupDetail`: no served field moved, and a rematerialize of the 2 released rows reported no change, which is the value-preserving property stated as a measurement rather than as an intention.

What the standing rule cannot reach is the instances that pin a VALUE and carry no record.
They are fail-closed by design rather than overlooked: nothing on the row says whether a human judged that value or a script patched it, and the rule is that a lock re-opens on evidence it was a workaround, never on the absence of a record.

#### Measuring a lock the release rule never asks about: `research-entity:audit-field-locks`

Because the standing rule refuses to put such a lock to the engine at all, its inertness is not merely unreleased but unmeasurable, and a lock nobody can measure is a lock nobody can retire.
`research-entity:audit-field-locks` asks anyway, one lock at a time, through `materializeEntity(..., { dryRun: true, auditFieldLocksIgnoringRecord: [field] })`, which drops the named lock whatever the record says.
That option is read-only by construction: it requires `dryRun`, it is mutually exclusive with `reviseRevisitableFieldLocks` so a release can never be judged under the wider rule by accident, and the script has no `--apply`.
One lock at a time rather than a row's whole list, because a kept lock still pins a value other fields' derivation reads, and the question here is about this lock.

It reports a verdict per lock rather than a release decision.
`inert` means the plan NAMES the field and reproduces the stored value, so the lock does nothing today.
`unbacked_preserved_value` means the plan says nothing about the field and no live observation asserts it, so the lock is the only thing keeping the value: neither a lane bug nor a judgement, and no layer of the evidence contract owns it.
`engine_would_replace` and `engine_would_clear` mean the lock is holding the engine back, which is either a producer defect to fix in the lane or a judgement no evidence can make, and only reading the row separates the two.
`engine_made_no_plan` means the materializer projected nothing for the row, which on a merged or withdrawn row is the correct answer rather than a silence to interpret.

Measured on Development 2026-09-24, with peers writing the same corpus: 98 lock instances across 52 rows, out of 8,804 entities and 4,602 live ones, and all 98 still read `unknown`.
50 `engine_would_replace`, 24 `unbacked_preserved_value` across 14 rows, 16 `engine_made_no_plan` which are exactly the 16 instances on the 8 archived rows, 4 `silent_with_evidence`, 3 `inert`, 1 `engine_would_clear`.
Five of the `engine_would_replace` instances freeze a `fullDescription` that still carries retired product vocabulary, which is the sharpest illustration of the cost: the lock is precisely why no lane can ever replace that copy.

#### Releasing a lock the engine's own plan proves inert: `--release-proven-inert`

The reclassification route - establish `lockedBy` from outside the row and write the reason the lock deserves - is one answer, and it is still open.
`--release-proven-inert` is a different and narrower one: it releases a lock recording no reason when the engine's plan names the locked field and derives the value the row already holds.
That is stronger evidence than a record, because it proves the release changes nothing a student reads, which is the whole thing a record is consulted for.

Two fences, and both are load bearing.
The plan must NAME the field, so the stored-value fallback in `plannedFieldValue` can never be read as agreement; a projection silent about a field says nothing about it, and reading that silence as permission is why relaxing "revisitable" on its own was refused.
And the flag requires `--slugs`, so it can only ever release locks an operator named after reading the row, never a corpus-wide sweep.
The verdict carries `provenInert: true` and the summary counts it as `plannedReleasesProvenInert`, so a release on a proof is never confused with a release on a record.

### The canonical topic vocabulary and its review gate (#3377)

`researchAreas` chips are plain canonical strings, and the vocabulary that decides which strings are canonical is `TaxonomyTerm`.
`buildCanonicalizerFromDatabase` reads `reviewStatus: 'APPROVED', status: 'ACTIVE', archived: false` and nothing else, and `deriveCanonicalResearchAreasFromPage` documents itself as fail-closed on that: an unapproved or invented topic is never produced.
So the review state is a genuine gate rather than a schema default nobody moved, and a term sitting at `UNREVIEWED` is invisible to every topic lane on purpose.

What is missing is the other half of it.
Nothing in the repository moves a term out of `UNREVIEWED`: there is no minting lane, no reviewer, and no script that writes `reviewStatus` on a `TaxonomyTerm`.
All 5,291 Development terms carry the same creation date, so the collection was loaded once from outside the codebase, and the gate is enforced and unactionable at the same time.
That is the shape `fieldLockProvenance.operator_decision` had before #3368 gave refusals a writer, and the honest deliverable here is a review queue rather than a repair.

Bulk approval is not the answer, and that is measured rather than asserted.
`yarn --cwd server taxonomy:review-queue` builds a second canonicalizer over the whole active vocabulary, runs the real prose scan over the served description of every served row that shows no topic today, and attributes each newly matched term to the rows it would reach.
Measured on Development 2026-09-25, with peers writing the same corpus: 672 approved terms against 4,619 unreviewed; 147 of 3,386 served rows show no topic; 125 of those are reachable by an unreviewed term; and on **49** of them the only thing that would arrive is a single word.
Those 49 are not rows the gate blocks, they are rows it protects.

The reason single words decide this is structural.
`buildResearchAreaResolverIndex` puts a single-word canonical name into the prose phrase list unless it appears in `AMBIGUOUS_SINGLE_WORD_AREAS`, and that list was curated against the 672 approved terms rather than against the 4,619 unreviewed ones.
So approving a generic single word silently adds it to the prose scan, which is exactly what the list exists to prevent: of 234 candidate terms, 110 are unlisted single words and their reach is led by "Development" (17 rows), "Science" (16), "Health" (15) and "society" (12).
Approval and the ambiguity list have to move together, and the queue says for which terms: 96 candidates are well-formed and specific enough for a reviewer to judge on merit, and they reach 113 row-slots between them, the best of them 3 rows each.
28 more are labels a seeding pass mangled ("AnemiaYSM Researcher", a lower-case prose fragment, an access concept like "Undergraduate Research"), which need fixing rather than approving.

#### The reviewer: `taxonomy:review-term`

The gate's writer, and the vocabulary's origin is recoverable rather than lost: `data-migration/seedTaxonomyTerms.ts` and its core were deleted with the retired data-migration package, and their own comments record the split.
`buildApprovedTaxonomyTermSeedRows` built the approved rows "from the curated research-area ground truth plus curated aliases", which is why the 672 are the ratified vocabulary.
`buildCandidateTaxonomyTermSeedRows` built the rest "from the residual scraped area strings that did not resolve against the approved seed", parked as `UNREVIEWED` "for human ratification", and said they "never participate in canonicalization until an approver promotes them".
The approver was never built, which is the whole of #3377's mechanism.

Three fences, and each one exists because its absence has already cost something.

A reviewer and a note are REQUIRED, for `DISPUTED` as well as `APPROVED`.
A verdict nobody can attribute and nobody can explain is what left 98 `manuallyLockedFields` instances reading `unknown`, and the same field in a new collection would be the same defect.
`planTaxonomyReviewDecision` enforces it, so a future writer inherits the fence rather than restating it.

One term per invocation. There is no `--labels`, no file input and no bulk arm, because approval is a judgement about a term; `taxonomy:review-queue` is what tells a human which term to spend it on.

Approving a SINGLE-WORD term is refused unless the reviewer says which kind it is, and that is the mechanism rather than caution.
`buildResearchAreaResolverIndex` puts a single-word canonical name into the prose phrase list unless it appears in `AMBIGUOUS_SINGLE_WORD_AREAS`, so approving an unlisted one silently widens the prose scan.
The refusal names both routes: affirm it is a specific technical term with `--prose-safe-single-word`, as "Immunology" or "Genomics" would be, or add it to the ambiguity list first, which is a code change.
A term already on that list approves without the question, because the list is what keeps it out of the scan.
A `DISPUTED` verdict never asks, because it widens nothing.

The write is conditioned on the review status the decision was read from, so a term another reviewer moved in between is reported rather than overwritten.
`reviewedBy`, `reviewNote` and `reviewedAt` are optional in the schema and required by the writer, deliberately: 4,619 Development terms predate the writer and carry none, so a schema requirement would make every one of them unwritable.

`canonicalizeResearchAreas` fails open, returning an unrecognised input inside `values` as well as inside `unmatched`, so it is not a catalog-membership test; `matchCanonicalResearchAreas` is.

### Field retraction: how the engine stops asserting a field a source dropped

Observations are append-only and supersede on fingerprint, so a source could only ever change a field by asserting something new for it.
When a profile drops its lab-website link the source emits nothing for `websiteUrl`, the last assertion stays live and unopposed, and neither a re-scrape nor a rematerialization can withdraw it (#2542).
Recency decay cannot help because there is no rival group to out-weigh; `LATEST_WINS_FINGERPRINT_FIELDS` cannot help because it needs a new row to supersede with; `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS` cannot help because it fires only when no live observation exists and the stale one is live.
That is why a script plus a permanent lock was the only durable answer available, and why part of the locked corpus already holds an empty value; the dated measurement in the field-lock section above counts those instances.

`scrapers/fieldRetraction.ts` closes the gap. The unit of evidence is a **complete read**: a run in which the source emitted, for one entity, every field it emits unconditionally on a successful read (`witnessFields`).
A complete read is a positive record that the source fetched and parsed that entity's page in that run.
When a live assertion for a declared retractable field belongs to an older run than two later complete reads, the page stopped stating the field, and the assertion is retired through `retireObservations` with a `rollback.reason` naming #2542.
When no later complete read exists, the source simply has not looked again and nothing happens.
That comparison is of run identity, never of a missing row, which is what keeps the lane from firing on silence.

Retraction is opt-in per source (`fieldRetractionContracts`), because a run's field set is a fact about the run rather than about the page.
`ysm-faculty-directory` qualifies: `facultyToResearchEntityObservations` emits `slug`, `name`, `kind`, `entityType`, `school`, `sourceUrls`, and `inferredPiUserKey` for every profile it accepts, and emits `websiteUrl` only when the profile links a research home the person owns, which is exactly the pair of cases #2542 asks to retract - a lab slot emptied, and a lab slot now holding an affiliated organization.
It states the absence only when the profile's lab slot carries no link at all (`labSlotAttestation === 'empty'`): a slot holding a value it cannot adopt, such as a scheme-less URL, is `refused` and states nothing.
`dept-faculty-roster` qualifies through `FacultyEntry.labSlotAttestation` (#3135), which every parse that reads `labUrl` sets and which a refusal path always leaves `refused`.
Two outcomes of the profile read decide the attestation too: a profile refused by `profileBelongsToRosterPerson` records `refused`, and a profile that was never read, because its fetch failed or it links off Yale, withdraws the roster card's `empty`, because the profile is where the lab link usually lives and an unread page states nothing.
#2385 records that dropping a wrong-person edge strands the real lab, which `observations:retarget-foreign-lab-websites` repairs rather than retracts.
`yse-faculty-directory` qualifies for one case: it states `assertsNoValueFor: ['websiteUrl']` only when it withdrew a lab because the linked site is dead on a stored or probed verdict (#3452), so the `websiteUrl` it asserted before it knew stops being live; a refused link and an empty lab slot state nothing, because `extractLabUrl` can decline a link the page still carries.
`ysm-atoz-index` does not qualify for the opposite reason: a delisted lab vanishes from the index entirely, so it emits no witness and no partial read ever occurs, which is `ysmLabDelistingReconciler`'s cohort.

A field is only declarable when ingest cannot have dropped the value itself.
`assertDeclarableRetractionField` refuses every quality-guarded prose field, every list `observationFieldSanitizer` can empty, and every enum-validated field, and refuses a latest-wins field as a witness.
For those an ingest rejection and a retraction are indistinguishable downstream, so declaring one would let `isRegressiveProseRefresh` - a guard that exists to protect a good incumbent - become the trigger for deleting it.

Three guards, all failing closed:

- A complete read, not a run. A partial fetch, a content-hash skip, or an SSRF refusal emits no witness and licenses nothing.
- Two complete reads (`FIELD_RETRACTION_MIN_COMPLETE_READS`), mirroring the two-run rule in `facultyRosterDepartureReconciler` and `ysmLabDelistingReconciler`, so one anomalous parse cannot retract.
- A drop guard (`FIELD_RETRACTION_MAX_ABSENT_FRACTION`, 0.5), the inverse of the fraction those two lanes already use, over the entities that hold a live assertion for the field rather than over everything read. A broken selector stops asserting for every holder at once and persists across runs, so it defeats the two-read rule and only the cohort shape separates it from a handful of genuine delistings. Above the ceiling the whole (source, field) pair is frozen for the pass and reported; it is never applied partially. The fraction only applies above `FIELD_RETRACTION_DROP_GUARD_MIN_POPULATION` (20) holders, because three of five holders dropping a link is an ordinary month at that scale and a ceiling there would freeze small sources permanently while protecting nothing; below the floor the two-read rule and the operator's `--max-apply` ceiling are the bounds.

An absence claim counts only when the run that made it carried the lane's latest fix to its absence-claim path (#3824).
The log is append-only, so a fix to a lane that asserted empty slots it had not read leaves every claim the old code made live, and those claims kept counting toward the two-read quorum.
Measured on Development on 2026-09-28: all 24 planned `websiteUrl` retractions had at least one claim from a run before #3666 merged, and only 10 had two post-fix claims.
Each contract therefore declares `absenceClaimCutoffs`, at most one per field, naming the fix PR, its full commit, and its merge time; `dept-faculty-roster` and `ysm-faculty-directory` declare #3666 for `websiteUrl`, and `yse-faculty-directory` declares none because its claim path has not changed since #3566 introduced it.
`disregardPreFixAbsenceClaims` drops a claim whose run did not carry the fix before the quorum is counted, and the read still counts as a later complete read that said nothing, so the quorum has to come from post-fix claims alone.
A run that recorded its commit (`scrape_runs.codeSha`) is decided by ancestry, because a run started after the merge on a stale checkout still runs the old code; a run with no recorded commit, or one git cannot resolve (a shallow clone), is decided by its `startedAt` against the merge time; a run that cannot be found is refused.
The dry-run report's `preFixAbsenceClaimsExcluded` states, per source and field, the claims excluded, and the observations and entities they would otherwise have retracted.
A fix to any lane's absence-claim path replaces that field's cutoff in a follow-up PR that names the fix's squash-merge commit, which contains the earlier fixes, and its GitHub merge time.
The fix PR cannot declare it, because every merge is a squash, so its commit does not exist until it merges and its branch head is not an ancestor of any post-merge run.
No retraction apply for that field runs until the follow-up lands.

The stored value is cleared only when the retraction removed the last live observation for that field **and** the stored value is still the retracted one, folded through `normalizeWebsiteUrlIdentityKey`.
A retraction on a merged-in loser's key decides and clears on the live survivor that key's tombstone chain reaches, with the survivor's locks, and counts rival evidence across every key and id merged into the survivor; keys of one survivor retracting the same field in one pass are decided together, and the sole-holder probe withholding any of them cancels the survivor's clear (#3609).
With rival evidence surviving, the resolver decides on the next materialization and clearing here would blank a field the corpus can still support.
That positive condition is also why this is not the same thing as adding the field to `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`: clear-on-empty reads an absence, so it would also unset a value whose backing observation was merely pruned, while this reads a retirement it performed itself in the same pass.
A locked field is skipped whatever its reason says.
Every row whose stored value is cleared goes back through `planStudentVisibilityGate`/`applyStudentVisibilityGatePlans`, because a row can be published because of the field being removed.

Two entry points. The sweep lane, `reconcileFieldRetractionsFromRun`, runs at the end of `materializeFromRun` after every entity has been projected, and is gated by `SCRAPER_FIELD_RETRACTION=true`; unlike the two older reconcilers, a dry run still plans and reports, because the drop-guard fraction has to be readable before a pass that deletes evidence is authorized.
The operator lane, `yarn --cwd server observations:reconcile-field-retractions`, needs no fresh scrape: the evidence that a field stopped being asserted is already in the log.
It is dry-run by default, and apply requires `--confirm-field-retraction` plus a planned count within `--max-apply` (default 200).
Retention bounds how far back witnesses reach - `observations:prune-dead` keeps the last 3 runs per source - and losing older witnesses only ever makes the lane more conservative.

A tombstoned loser's evidence is carried rather than re-keyed: the loser's observation bundle stays active while `mergedSurvivorEvidence` resolves the survivor over it (#3560), and it retires only on the loser's own key, through the retraction path above, when a source that still reads that key stops stating the field.
A read of the survivor's own key never retires loser-keyed evidence, because it says nothing about the page the loser key was read from; the 2026-09-28 #3609 entry in [`decisions.md`](decisions.md) records the per-field-class ownership and the measurements.
For `websiteUrl` and `website` on a survivor its own lab-identity lane typed, the survivor-ownership rule in [`research-entity-pi-dedupe-runbook.md`](research-entity-pi-dedupe-runbook.md) keeps that evidence out of the slot at resolve time (#3585).
That is an ownership decision rather than a retirement, so every other field, and a survivor with no lab-identity typing of its own, still resolves over carried loser evidence until the loser key's own reads retire it.

A stored `websiteUrl` that no observation states is left alone by default, because retention can prune the evidence behind a real value and an absence is not a claim (#3586).
The one exception is a value whose `fieldProvenance.websiteUrl` names a lane but carries neither a `sourceId` nor an `observationId`: that record is the shape a direct write leaves (#3363), so `planUnsourcedProvenanceWebsiteUrlClear` (`scrapers/unsourcedProvenanceWebsiteClear.ts`) clears it on materialize when no observation the pass reads states it, and a cited `sourceUrls` entry may still refill the slot on the same pass.
Before that clear runs against stored rows, `data:find-lab-websites --reverify-stored` re-reads exactly that population, chosen by the materializer's own dry run so the two never disagree about which observations count, with the lane's own `judgePage` test and appends a `lab-site-search-discovery` observation for every page it adopts, so a real website becomes evidence and only a refused one clears.
Measured on Development on 2026-09-27: 18 live rows stored a `websiteUrl` no active observation, loser observation or citation backs; 9 carried the unsourced-provenance shape, the lane's judge adopted 8 of them, and a whole-corpus dry-run projection changed exactly those 9 served values and no other.
Five more were a `centers-institutes-index` roster page asserted as `websiteUrl` and refused by the write gate, which left an earlier landing page standing with nothing behind it; that lane now emits a declared `homeUrl` and never a refused crawl URL.

The same shape on any other field is handled by attribution rather than by value (#3769).
The model refuses to persist a `fieldProvenance` entry that carries no `observationId` unless its source is listed in `NON_OBSERVATION_PROVENANCE_AUTHORITIES` (`models/fieldProvenanceBacking.ts`), on every Mongoose write path: `updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne`, `findOneAndReplace`, `save`, `insertMany` and `bulkWrite`.
The only listed authority is `description-derived-research-area`, which the materializer recomputes from the row's own description on every resolve.
`$unset` and a subpath repoint of `sourceUrl` author no attribution and are allowed.
A raw `collection` handle skips those hooks, so `models/__tests__/rawResearchEntityWriteGuard.test.ts` keeps raw writers of `research_entities` to a reviewed list with a reason per file and refuses any raw write that authors a whole entry or its `sourceName` (#3788).
For stored residue, `planNeverBackedFieldProvenanceRetirement` (`scrapers/neverBackedFieldProvenance.ts`) runs at the end of `projectFromLog` and unsets an entry that names a lane, carries neither `observationId` nor `sourceId`, is not a listed authority, sits on no locked field, and whose lane has no observation of that field on the row at all, live or superseded.
It clears the attribution and never the value: the value stays exactly as evidenced, which is by nothing, and a later lane observation re-attributes it through the normal projection.
Everything else is history and is kept: an `observationId` that resolves to a superseded observation or to nothing (a pruned one), a bare `sourceId` (the #2897 residue), and an unrecorded-id entry whose lane really did observe the field.
It needs no lock and a second pass plans nothing, so it is a derivation rather than a repair.
It cannot reach a row with no live observation, since `materializeEntity` returns before projecting one; measured on Development on 2026-09-28 that was 6 entries.
The same pass relinks an unrecorded-id entry whose lane did observe the field (#3788): `planUnrecordedProvenanceObservationRelink` rewrites the entry citing that lane's live observation when exactly one of them states the value the row holds after the pass, adding its `observationId` and `sourceId` and keeping the entry's `sourceName`, `sourceUrl`, `observedAt` and `confidence`, in schema key order.
Two live observations stating the same value are ambiguous and the entry is left alone, as is a locked field; once an entry carries an id neither stage reads it again, so a second pass plans nothing.
This matters where the projection itself leaves the entry standing, and in the provenance-only pass below, which writes none of the projection's own entries.
For rows no sweep re-materializes, `yarn --cwd server research-entity:rematerialize --unbacked-provenance [--include-archived]` selects every row carrying such an entry by predicate and runs the materializer with `onlyReconcileFieldProvenance`, which plans both stages against the stored row and writes the provenance unsets and relinks and nothing else, then re-gates the rows it changed; the report counts `retiredProvenanceEntries` and `relinkedProvenanceEntries` apart, it is dry-run by default, and `--apply --confirm-rematerialize` is Development-only.

A contact field stands on a row only while a live observation keyed to that row states it (#3609): a merged-in loser's contact, or one read under another key that resolved onto the row, is dropped before resolving and a stored one is cleared on the row's next own-key pass.
`yarn --cwd server research-entity:rematerialize --foreign-contact` selects the rows that still store such a field, scopes the materializer to the three contact fields, reports `clearedContactFields` by field name, and re-gates the rows it cleared; it is dry-run by default and `--apply --confirm-rematerialize` is Development-only.
A stored `researchAreas` list that no live evidence states is extended from the row's own description on every resolve, and never replaced (#3836).
Scope is the shared predicate in `scrapers/researchAreaEvidence.ts`: `researchAreas` is unlocked and no live observation on the row or any merged-in key states an area the row admits.
The derived chips are admitted through `partitionResearchAreas` and appended after the stored ones they do not duplicate, so a derivation never removes a stored chip; `description-derived-research-area` is recorded only when every resolved chip is derived, and a stale derived entry on a list that keeps stored-only chips is unset.
A derivation is never allowed to empty a non-empty stored list, and a second pass plans nothing; the materialize result reports each in-scope row as `unbackedResearchAreas`.
`yarn --cwd server research-entity:rematerialize --unbacked-research-areas` selects that scope, runs scoped to `researchAreas`, and sums the outcomes in its report together with `researchAreaChips` `{ added, removed }`, where `removed` must be 0; it is dry-run by default and `--apply --confirm-rematerialize` is Development-only.
`docs/decisions.md` records the rule and its Development measurement.

Every rematerialize report measures one change list per row over every field the run may write: the tracked fields, the `--only-fields` scope, and the three contact fields (#3822).
A contact change is recorded as `{ field, withheld: 'set' | 'replaced' | 'cleared' }` and never carries a value.
`entitiesChanged`, `fieldsWritten` and `clearedContactFields` are all read off that list, so they cannot disagree; the materializer's own count, which also counts a planned value equal to the stored one, is reported per row as `materializerFieldsWritten`.
An apply diffs the row it re-reads, and a dry run diffs the row its plan would leave in the same shape, so an unset field reads as a change in both modes.

Measured on Development on 2026-09-23, and it corrects a root cause recorded elsewhere as "merged but inert, because no source asserts absence" (#3135).
Absence is asserted: 90 live observations carry a non-empty `assertsNoValueFor`.
What has never happened is a retraction, of which there have been zero.
The operator lane runs and accounts for every candidate rather than lying dormant: over the 766 live `websiteUrl` observations from the only contracted source it reports 618 `sourceHasNotReread`, 147 `absenceNotWitnessed`, 1 `awaitingSecondCompleteRead` and 0 planned, and that single row is archived, already stores no value and carries no lock, so it is not a proof case.
The 90 assertions sit on rows with no live `websiteUrl` observation from that source, which is the source correctly reporting that a profile carries no lab link on a row that never recorded one.

The binding constraint is producer coverage, not engine capability.
One source declares a contract and one field is retractable, covering 766 of the 4,399 live `websiteUrl` observations.
33 `websiteUrl` locks hold a hand-rolled retraction and 26 still face a live rival assertion, which is why `research-entity:release-field-locks` reports exactly 33 `keep_engine_disagrees`; those rivals come from six sources and only 5 from the contracted one, so 21 are blocked by sources that cannot say a field is gone.
Whether those pages dropped their links is not measurable until those sources declare a witness contract, so contract coverage is a prerequisite for diagnosing this backlog rather than only for fixing it.

Widening coverage is not a configuration change.
`dept-faculty-roster` holds 15 of the 26 and emits `websiteUrl` only when `entry.labUrl` is set, which looks like the contracted source's shape but is not: `labUrl` is left unset by several refusal paths, a website the same roster lists for two or more people among them, as well as by a genuinely empty entry, so testing `!entry.labUrl` would reintroduce exactly what #2647 measured, where 2 of 4 planned retractions were refusals of links the page still carried.
An honest contract for a source needs a parse-time "no candidate was present at all" signal kept distinct from every refusal path and from every unread page, which is what `labSlotAttestation` is on the YSM and department-roster sources.

### Value refusal: how a repair persists without freezing a field

Retraction answers "the source stopped saying it". A refusal answers "the source still says it and it is wrong", which is a different question and was not answerable until #3167.
That gap is why 107 lock instances exist: writing `manuallyLockedFields` was the only way to make a correction durable, and it removes the field from derivation for good (#2612).

Measured on Development, 22 of the 28 values blocking a `websiteUrl` lock are admitted by every rule in `researchHomeWebsiteUrlDecision`, and correctly so: a real lab site that belongs to a different row is not refusable by any URL-shape vocabulary.
Admissibility there is a judgement about a value on a row.

`ResearchEntity.fieldValueRefusals` is a map from field to a list of refusals, each carrying a normalized `valueKey`, the `rule` that refused it, who recorded it, when, an optional evidence URL, and an optional `withdrawnAt`.
`server/src/utils/researchEntityFieldValueRefusals.ts` owns the vocabulary and both directions of it.

Three properties matter more than the shape.

It is keyed on the value rather than on an observation, which is what makes it durable.
`superseded` retires one row and the next run mints a fresh one carrying the same value, live and unopposed, which is the #2542 mechanism itself; 181,047 rows carry `superseded` and not one can stop a value coming back.
The same argument rules out the rollback reasons already in use: they are retirement records about observations, not admissibility rules about values.

It removes a value, not a field, which is what keeps it from being the lock again.
`refusedResolverObservations` drops matching observations before `resolveAllFields` runs, so a better rival at the same field still wins and a field whose every candidate is refused resolves to nothing.
The projection reads that same screened set rather than the unscreened one, so no re-rank walk can adopt a refused value that the #3438 stored-description clear would then blank over an admissible rival (#3884).
That is every re-rank walk the projection runs rather than the description ones alone: the `fullDescription` fallback walk and the single-PI shell gate, the name-authority and department-naming walks, and the `researchAreas` readmission walk.
It also settles the projection's live-evidence test: a field whose every candidate is refused counts as having no live observation, so its stale stored value is clearable rather than pinned by the refused evidence.

It has to reach every path that can write the field.
The resolver screen alone did not hold: `deriveResearchEntityWebsiteUrl` promotes a cited `sourceUrl` into an empty `websiteUrl` slot and was gated only by `manuallyLockedFields`, which is precisely why clearing a wrong `websiteUrl` never stuck.
A refusal that reaches one derivation path and not the other reaches neither.

Clearing the stored value belongs to the operation, not to materialization, because a materializer that unsets a served field on a sweep is how a value disappears without a visibility re-gate.
`yarn --cwd server research-entity:refuse-field-value` is per-row by construction, dry-run by default, clears the stored value only when it is the value being refused, and re-gates the row in that case.
`--withdraw` retires a refusal, because a rule can change and a judgement can be wrong.

This is also layer 3's only writer, and `--rule=operator_judgement` is the one rule that demands both halves of its record: a `--note` saying why and a `--decided-by` saying whose.
Every other rule names a condition a later reader can re-derive - a dead page can be re-probed, a wrong owner re-checked against the record's own lead - while a judgement can only ever be read from its own record.
`planFieldValueRefusal` enforces it rather than the CLI's argument parser, so every writer inherits the fence.
`fieldLockProvenance.operator_decision` still has no writer and keeps none: a judgement recorded as a lock cannot be revisited and, as the 2026-09-24 census showed, carries no reason at all in practice.

A refusal also names the lane that produced the refused value, which is what turns a refusal count into a lane's precision.
`sourceName` is the lane an operator declared at refusal time (#3506).
`attributedSourceNames` is derived: the `refusal-lane-attribution` Development sweep stage (`yarn --cwd server refusals:attribute-lanes`, #3521) reads the observation log and records every lane that asserted the refused value, and it never overwrites a declared `sourceName`.
The join reads observations by `entityKey` as well as `entityId`, because almost every research-entity observation is keyed only by the row slug, and for a URL-valued field it reads the `sourceUrls` citations as well, because a refused `websiteUrl` is usually a promoted citation rather than a value any lane observed at `websiteUrl`.
A citing lane is credited only when no lane asserted the value at a field, so a citation never charges a lane for a value another lane produced.
Measured on Development before the first run, those two choices move attribution from 73 to 229 of 277 refusals.
A stored attribution only grows, so `observations:prune-dead` removing the evidence never un-attributes a refusal, and a second run plans nothing.

### Grant-corpus research synthesis and PI-to-school inheritance

Grant-backed PIs (especially YSM/YSPH faculty whose `medicine.yale.edu/profile/*` pages are WAF-403-blocked) can be given real research coverage from the sanctioned government grant data we already ingest.
`research-entity:grant-corpus-synthesis` (`server/src/scripts/grantCorpusSynthesis.ts`, core in `grantCorpusSynthesisCore.ts`) selects non-archived entities that have `recentGrants` but no better-sourced description, aggregates the PI's grant corpus (each grant's title plus abstract across NIH RePORTER, NSF, NEH, USASpending, and DOE, contact-redacted, deduplicated, and bounded by the coverage synthesizer's own `MAX_COVERAGE_SNIPPETS`/`MAX_COVERAGE_SNIPPET_CHARS` limits), and reuses the grounded coverage synthesizer (`synthesizeCoverageDescription`, gpt-5-mini) to produce one clean, PI-level `fullDescription`.
An entity is skipped when an official non-grant source already carries a useful description, so a real profile always wins; the single-abstract grant fallback (`GRANT_ABSTRACT_DESCRIPTION_CONFIDENCE`, 0.35) does not.
That skip guard reads the same observation scope the materializer resolves from (`materializationReadScopeFilter` plus both the entityKey- and entityId-anchored rows), so a description a repair lane deliberately superseded no longer blocks recovery, and an entityId-anchored official description is still respected.
The synthesized description is written as a `grant-corpus-synthesis-llm` observation at `GRANT_CORPUS_DESCRIPTION_CONFIDENCE` (0.45), above the single-abstract fallback and below the weakest official-profile source, and it fails closed (no observation) when the output is not grounded in the grant text or does not clear the description-quality bar.
Each skipped entity records the synthesizer's own refusal (`synthesisRefusal`), and the report's `synthesisRefusals` counts `llm-call-failed` and `llm-malformed-response` as `llmFailures` apart from the content refusals, so an API outage reads as `synthesis-llm-failed` rather than as the quality gate (#3729).
The materializer then derives the grounded `shortDescription` (`resolveMaterializedShortDescription`) and canonical `researchAreas` (`applyDescriptionResearchAreaDerivation`) from that description on the same pass, so no separate research-area LLM call is needed.
The lane is dry-run-first, bounded by `--limit`, and apply is Development-only and requires `--confirm-grant-corpus-synthesis`; the source must be seeded first (`scrape:seed-sources`).

PI-to-school inheritance runs as a materialize-time step in `entityMaterializer.inheritSchoolFromLeadPi`, right after the inferred PI/director membership is resolved.
The lead supplies two org-unit fields, so the gate reports which of them the row still needs rather than one eligible/skip verdict (#2802).
A row with no school and no department inherits both (`school-and-department`), the grant-derived shell population this started as.
A row that already carries a school but no department inherits the department alone (`department-only`); before that verdict existed the school check ended the whole function, which left 242 student-ready rows outside the department facet even though their own PI's home department was already stored.
A row carrying both is skipped (`has-school-and-department`).
In every case exactly one current lead (PI or director) must resolve to a single `Researcher`, and that researcher's department (from `Researcher.profile.primaryDepartment` or the linked `Account.department`) must canonicalize to exactly one real department `OrgUnit`, so a raw HR appointment string never lands in the student-facing `departments[]` facet.
Only the school half additionally requires that the department's parent chain reaches a school; `department-only` does not, because the department is the field the row is missing and an unmapped parent should not withhold it.
In `department-only` mode the row's own `school` and `schools[]` are deleted from the update before the write, because `applyResearchEntityOrgUnitCanonicalization` derives a parent school from the department it just set: without that guard a School of the Environment row whose PI is appointed in Genetics would be rewritten to School of Medicine.
The write goes through `applyResearchEntityOrgUnitCanonicalization` and records `fieldProvenance`/`confidenceByField` for whichever of `school` and `departments` it actually set, under `lead-pi-school-inheritance`, so an inherited value is attributable in admin and audit surfaces and still loses to a real roster observation.
Evidence comes first: the step appends a `lead-pi-school-inheritance` observation for each inherited field, writes the value only when a live observation of that exact value exists, and records that observation's `observationId` and `sourceId` in the provenance entry.
When the observation cannot be recorded (an unseeded environment, or `appendObservations` refusing it) the step writes nothing at all, because a value written anyway is the unbacked attribution #3769 found 142 stored entries of.
It honors `manuallyLockedFields`, never overwrites an existing school, `schools[]`, or `departments[]`, and skips the multi-PI org kinds (`center`/`institute`/`program`) so one director can never guess a whole cross-school center's school.
It fails closed on every other outcome (locked, both facets already present, ambiguous or missing lead, no department, or a department that does not canonicalize), so a wrong value is never guessed.
Because this is a materialize-time step rather than a repair script, re-running the engine reapplies it instead of erasing it, and it reaches rows that do not exist yet.
This closes the "grant-derived shells have no school" gap on the same engine pass that closes the description gap, and stays correct on re-runs.

### The release queue is routed by recoverability, not swept whole

The gate opens a release-queue item for every withheld record, so the queue is an inventory of what is held rather than a list of work.
Most of it is not repairable by any lane: a 200-item sweep patched 7 and blocked 193, on `missing_card_description`, `missing_description`, `thin_description` and `missing_lead` over rows whose prose does not exist within reach of the runner.
Before this was routed, 5,890 of 6,441 items had an `attemptCount` of 0 and the operator board advertised 1,228 open items as work when 84 of them were actionable.

`visibilityRecoverabilityService.classifyRecoverabilityForRecordIds` batch-classifies records through the audit's pure `classifyRecoverability`, and both consumers route on the verdict.
`beta:repair-queue` attempts only `regate` and `materialize` by default, the two buckets whose evidence is already stored so a repair can clear them; `--bucket=` overrides, and passing all four restores the unrouted behaviour.
`acquire` needs a crawl and `ceiling` needs a decision, and this runner performs neither, so attempting them only spends the `--limit`.
The report carries `queuedBeforeRouting`, `routedBuckets` and `skippedByBucket` so the backlog stays visible rather than being hidden by a smaller `scanned`.
The operator board reports the same bucket counts plus `actionableCount`.

`patched` and `resolvedByGate` are two different numbers and neither substitutes for the other (issue #2440).
`patched` counts attempts whose patch cleared every blocker this lane models; `resolvedByGate` counts rows the real gate then moved into a public tier, and the gate re-decides the patched row against the full reason set and disagrees most of the time.
Measured on Development, `source_description` patched 61 and promoted 7 while `pi_identity` patched 21 and promoted 19, so sizing the lane off the patch count overstated it by roughly 6x.
The counter was called `repaired` until #2440, which is the name a reader trusted for a promotion count; the operator board still accepts the old key when reading an artifact saved before the rename.
A dry run reports `resolvedByGate: null` with `resolvedByGateNote`, not `0`, because it applies no patch and so has nothing for the gate to re-decide: the number is unknowable in that mode rather than zero, and this is the mode every sizing decision is taken from.
Take a promotion count from an apply run only.
The operator board serves the same split under `patchedCount` and `promotedByGateCount`, alongside the artifact's `mode`, and it phrases the patch count by mode: a dry run reads "Would patch", an apply run reads "Patched".
`promotedByGateCount` is omitted entirely for a dry run rather than served as a zero, and the board refuses a `resolvedByGate` number found in a dry-run artifact for the same reason, because artifacts saved before #2440 record `0` there.

Two details are load-bearing:

- The runner classifies the **queue item's** `blockerReasons`, not the entity's stored `studentVisibilityReasons`. A queue item outlives the gate run that wrote it, so classifying one blocker set while attempting another routed 64 items in as repairable that had already been classified unrepairable.
- A `review_exception` plan is never attempted. `formalization_only` program rows are capped at `limited_but_safe` deliberately, and because that is not a public tier the gate never resolves their queue rows, so they stayed open forever and every sweep re-attempted them. `acceptFormalizationReviewExceptions` is the script that closes them out; it had never been run, and closing 99 of them removed the largest blocked reason without performing any repair.

Routing raised the patch rate from 3.5% to 11.5% on the same corpus, for the same 9 patches out of 78 attempts rather than 500.
It releases no additional rows by itself: what it fixes is a queue that could not be worked and a board that misreported how much work it held.

#### What the lead adapter carries, and what it deliberately does not

`researchEntityLeadMembersFromRoster` is the only production producer of `leadMembers`, so a field it drops is a field no repair lane can read however well that lane is implemented.
It dropped `email` and `profileLinks`, both of which are on `ResearchEntityRosterEntry`, which left `memberEmailLocalTokens` and the profile-URL resolution reading inputs that never arrived: implemented, unit-tested, and inert in production (#2154).
Measured on Development on 2026-09-22, of 4,332 distinct lead people on live research entities, **3,258 carry a `@yale.edu` account email** and **4,117 carry a `YALE_OFFICIAL` or `PERSONAL_ACADEMIC` profile link that is not already the denormalized `profile.websiteUrl`**.
On a paired 400-row dry run over all four buckets, passing them through moved `patched` from 1 to 3, `deduped trusted sourceUrls` from 1 to 3, and `deduped trusted sourceUrls from field provenance` from 150 to 159; a patch is not a promotion, per the `patched` versus `resolvedByGate` split above.

Only `YALE_OFFICIAL` and `PERSONAL_ACADEMIC` links are passed.
`GOOGLE_SCHOLAR` and `ORCID` are publication indexes rather than profile pages, and `profileSourceUrlForMember` falls through to any http URL, so passing them would let a repaired field cite a citation index as its source; `LAB_ABOUT` names a group rather than the person the lane is matching.

The prose lanes stay inert, and that is a model gap rather than an oversight.
`leadResearchInterestCandidates` reads `user.researchInterests`, `user.topics` and `user.bio`, and `leadProfileDescriptionCandidates` reads `user.bio`, none of which exist anywhere on `Researcher`: `Researcher.profile` is `{ title, primaryDepartment, imageUrl, websiteUrl }`.
Reviving them needs a decision that is larger than an adapter, and in this order: name the source that would write the prose (the profile scrapers already extract a bio for the entity's own description, so the question is whether a person also needs one), decide whether it belongs on `Researcher` or stays an observation the entity materializer resolves, and then measure what accepting it as a repair candidate would promote.
Retiring the two lanes is the other legitimate answer.
Until one of those happens, treat their unit tests as pinning a capability the model does not currently feed, not as evidence the lanes run.

### Faculty roster departure detection is off, and has never run

`facultyRosterDepartureReconciler` is the only writer of `yaleStatusReasonCache: 'departed'` from roster absence.
It has never executed a decision in any environment, and three independent gates each stop it, in the order the code hits them (#2410).

Read the lane rather than inferring it: `yarn --cwd server research-entity:audit-departure-lane` names the first gate in the way, plans the next run's decisions from the reconciler itself, and states in prose whether the lane has ever evaluated a row (#2428).
It writes nothing, needs no flag, and has no `--apply`, because a suppression removes a research home from the directory and belongs to a materialize pass an operator turned on deliberately.
The plan's `suppress_departed` count is taken before the Yale-profile probe, so it is an upper bound rather than a prediction.

1. `SCRAPER_FACULTY_DEPARTURE_DETECTION` gates the whole pass and is `false` by default.
It is now listed in `server/.env.example` so the lane is discoverable; before that it appeared nowhere outside the reconciler and its own test.
The flag now gates only the writing arm: a dry run plans and reports instead of returning `outcome: 'dry-run'` before reading anything, which is what made the lane's dormancy unmeasurable, and it is the contract the field-retraction lane already follows.
The `disabled` outcome is also stated in the materialize log rather than passed over in silence, because the flag being off and there being no departures were previously the same quiet.
2. `departmentRosterHealth` observations are the reconciler's only input, and there were **0** in Beta and Production and **1** in Development when this was measured on 2026-09-05.
`departmentRosterScraper` emits one per configured department per run, so the input appears only after a roster sweep.
**That gate has since opened on Development**: on 2026-09-22 it holds 125 live roster-health observations across 12 runs, so enabling the lane now reaches live rows where it provably could not before.
Since #3251 a snapshot also records what its lane read, in `read: { pagesRead, readMode, cacheAllowed, pagesReusedWithinSweep, readAt }` (the last since #3568), and a snapshot whose run recorded no read is not authoritative.
Read that before believing a plan.
The run-level `fetchMetrics` is not a substitute and was not one before either: only the rendered-browser branch pushed an attempt, so a run whose 112 HTML lanes each fetched reported `summary.total: 0`, and that zero was read once as "the fetch layer was never entered".
Every snapshot written before #3251 classifies as `unrecorded` and governs nothing until a roster run supersedes it.
The field is also latest-wins now: with `value` in the fingerprint a department whose roster had not changed wrote no row and kept its predecessor's date, so 7 of 113 departments carried a snapshot up to 11 days older than the run that had just re-read them, and were absent from that run's plan.
On the most recent of those runs the plan is 37 `refresh_present`, 20 `record_first_absence`, and 0 `suppress_departed`, because suppression needs an absence already recorded by an earlier run: the first enabled run can only record bookkeeping, and the rows it records become suppression candidates on the next one.
Beta and Production still hold zero observations of any kind, because promotion copies materialized collections and not the evidence behind them, so the lane remains unreachable there whatever the flag says.
3. The department join. The health snapshot records the raw `DEFAULT_DEPT_CONFIGS` `deptName` while `research_entities.departments[]` stores the canonical `OrgUnit` name, so the reconciler now resolves the snapshot name through the catalog (`resolveGovernedDepartmentName`) instead of comparing two spellings.
Before that, 14 of 110 configs matched 0 entities each while their canonical spelling matched 316 governed entities.

Evidence that it never ran: `absentFromRosterSinceRunId` is written on the first absent run and `lastSeenInCompleteRosterAt` on every present run, both before any suppression, and both are 0 rows in Development, Beta, and Production.
Do not read `yaleStatusReasonCache: 'departed'` being 0 rows as "no departures were detected"; nothing was evaluated.

The pass returns a `FacultyRosterDepartureOutcome` naming why it did nothing (`disabled`, `no-roster-health-observations`, `no-authoritative-departments`, `reconciled`, and similar) plus the departments it governed, the snapshot names no `OrgUnit` names, and a `readProvenance` count of how many of the run's snapshots recorded reading their page.
A department name that resolves to nothing is now an explicitly reported condition rather than a zero governed count, which is what made this dormancy invisible: a lookup miss and "this department genuinely has no entities" were the same observation.
`passesRosterDropGuard` still passes a zero governed count, which is correct once the join resolves: a genuine zero means the `governed` query returns no entity for that department, so the suppression loop cannot act on it.

A recorded `permanently_closed` marker outranks roster presence, whether an operator recorded it or the YSM lab delisting lane below did.
Since #2414 a recorded closure derives the same `yaleStatusReasonCache: 'departed'` this reconciler writes from roster absence, so the presence branch would otherwise read a marker it did not write as its own past output and clear it, and the relocation cohort the marker exists for is by definition the cohort still listed on a stale Yale roster.
`decideFacultyRosterDeparture` therefore takes `hasRecordedClosure` (from `hasRecordedClosureEvidence`) and downgrades `clear_departed` to `refresh_present`, still recording the last-seen fact.
The absent branch already no-ops on a `departed` reason, so it needs no equivalent check.

Enabling the lane is a separate, measured change: it can only remove research homes from the directory, so it needs a recomputed `computeResearchEntityStudentVisibility` served-tier diff over every row on Development and Production, not a flag count.
An emeritus appointment, the word retired, an ORCID employment end date, and a name-mismatch guard have each been measured and refused as suppression signals, so a future version of this lane must not reach for them; `docs/decisions.md` holds the refusals and the counts behind them.

#### Roster absence plus a Yale page that no longer names a person

Suppression needs two independent positive facts: absence from a complete roster snapshot across two distinct runs, and a Yale profile page that positively asserts the person is gone (`scrapers/yaleProfileDepartureEvidence.ts`, #3144).

The second fact used to be a link-death probe over every citation the entity carried, and that probe read backwards for the whole population this lane exists to judge.
Somebody who relocates takes their personal website with them, so the strongest available evidence of departure, a live page naming the new institution, arrived as a 200 and vetoed the suppression; 62 of the 163 roster-minted absent rows on Development carry an off-Yale host.
It also mislabelled its own finding, because a website that has gone means the site has gone, which is `sourceLinkHealth`'s subject, not that the person left Yale.
Nothing was lost by replacing it: the lane has never written a row in any environment.

The replacement reads the page rather than the status line, which is the distinction #1923 missed when it closed as not actionable on the grounds that all 20 candidates "still serve a live Yale profile page at HTTP 200".
A Yale directory profile whose person has been unpublished still answers 200 and renders the Drupal view's empty state, which is also why `sourceLinkHealth` and `profileLinks[].healthStatus` both record those URLs `HEALTHY`.
Absence therefore requires three things, and a non-2xx status is never absence because a 404 is equally what a renamed URL looks like: an explicit person-less marker, no role word anywhere in the page text, and no biographical prose.

The third condition is not decoration, and the story of how it was added is the useful part (#3168).
The first two were measured over the 1,207 Yale profile URLs the lane reaches from rows absent from a complete snapshot (1,190 `person_present`, 4 `person_absent`, 8 indeterminate, 5 non-2xx) plus a random sample of 70 live links across 14 hosts, all 70 present, and produced **no false positive in 1,272 live pages**.
Widening the sweep from roster-absent rows to the whole served corpus then found one within the next 439 pages, so the clean first measurement was a property of the narrower population rather than of the rule.
The marker is not always the page's whole content: a profile template can render a full biography **and** a second, empty people view whose empty state is the same string, and somebody can describe teaching a language for a decade without the word professor, lecturer or instructor appearing.
Prose is what separates the two, because a page whose person has been unpublished has nothing left to say: the 2 genuinely unpublished rows extract to the name plus the marker with 0 prose sentences, the false positive carries 2.
A prose sentence is 12+ words ending in terminal punctuation, above every nav label and postal address seen across 1,700 pages and below the shortest real bio sentence, measured with the markers stripped first so the marker cannot count as its own content.

Treat a clean precision measurement on a filtered population as provisional until the rule has been swept over the whole served corpus.
The population the rule will run against is not the population you measured it on.

The pages are resolved through the lead role edge (`RoleAssignment` -> `Researcher.profileLinks`), not from the entity alone, because a roster-minted faculty row keeps only the subject's personal site in `sourceUrls` and carries no Yale page at all.

`isYaleProfileUrl` decides what counts as a person's Yale page, and it accepts the marker segment at any path depth because several schools nest it: `research-and-faculty/faculty-directory/<slug>` at SEAS, `directory/faculty/<slug>` at YSE, `<region>/person/<slug>` at MacMillan, `<unit>/profile/<slug>` at YSM, plus the flat `law.yale.edu/<slug>` through a host allowlist (#3197).
Requiring the marker first rejected 463 of the corpus's 5,242 `YALE_OFFICIAL` links, 8.8%, and left 170 served rows the lane could not judge at all, 95 of them `FACULTY_RESEARCH_AREA` and 74 `LAB`.
It failed closed, so the cost was blindness rather than a bad write, but it also means a corpus-wide sweep is only as wide as this predicate: widening it added 624 reachable URLs, and the pre-widening "2 rows corpus-wide" figure was measured over 3,055 of 3,361 served rows.
A segment after the marker is required, which is a tightening the widening had to carry: a bare `.../people` is a directory index, and an index's empty state is what a whole broken directory looks like rather than what one departure looks like.

The rest of the served rows with no probeable page are not defects.
69 are organisational rows with no lead role edge at all (`CORE_FACILITY`, `INITIATIVE`, `CENTER`, `INSTITUTE`), and an institute has no person profile to read; 15 have a lead whose `Researcher` carries no `profileLinks` of any kind, which is an identity-coverage gap rather than a matcher one.
One `person_present` vetoes the verdict even when another page asserts absence, since somebody cross-listed who leaves one departmental roster has not left Yale, and no Yale page to read means hold rather than suppress.
One `indeterminate` page vetoes it too (#3647): a profile that failed to fetch, answered non-2xx, or could not be classified is a page nobody read, and it may be the current profile that still names the person, so a stale person-less page beside it is not evidence that they left.
The probe reports those pages as `indeterminateUrls`.

#### A roster read that did not see the whole roster is not complete

Absence from a snapshot is only evidence when the snapshot's lane read the whole roster, so `dept-faculty-roster` marks every other read with a non-`ok` status, and a non-`ok` status is `complete: false` (#3647).

| Lane status | What happened |
| --- | --- |
| `ok` | The pager reached the roster's own end (`not-paginated`, `empty-page`, `repeated-page`) and `--limit` did not cut the lane. |
| `empty` | A page was read and listed nobody. Warned as a likely site migration. |
| `partial-read` | The walk stopped before the end (`fetch-failed`, `extractor-error` or `no-identifiable-rows` on a later page of a paginated lane, or `page-cap`), or `--limit` cut the lane mid-roster. |
| `skipped-by-limit` | `--limit` ran out before the lane started. |
| `fetch-failed`, `rendered-unavailable` | No page was obtained, so the lane asserts nothing about who is listed. Warned as unreadable, never as a migration. |
| `extractor-error`, `rendered-extractor-error` | The first page was fetched but could not be parsed. |
| `js-rendered-skip` | No renderer was available for a JS-rendered lane. |

Before this a walk that stopped on a later page's fetch failure or at the 20-page cap reported `ok` whenever it had read anybody, so the people on its unread pages were recorded absent and became suppression candidates on the next run, and the truncated discovery also became the next read's retention baseline.
`--limit` did the same to the development-sample sweep, and a department whose sibling config the limit never reached published the first config's people as the whole department.
`loadPreviousDiscoveryCounts` reads only `complete: true` snapshots, so a partial read no longer lowers the baseline either.
It also reads only snapshots observed no later than the run being judged, so a standing marker's run is measured against the read before it rather than against a later run, including the current one.
It keys each baseline by the lane's own `deptKey` rather than by canonical department, because two lanes of one department list different people, and a department-keyed baseline judged one lane's full read regressed against its sibling's count and let the sibling govern alone.

A lane's incomplete read withholds its whole canonical department in that run, not just its own snapshot (`rosterHealthRecordsAnIncompleteRead`).
Several configs resolve to one department (Economics and School of Management, Physics and Wright Laboratory), and absence is concluded from every lane failing to find somebody; a lane that did not read its pages has not failed to find anybody on them, so the union of the other lanes cannot stand in for it.
Every status in the table except `ok` withholds, `empty` and `js-rendered-skip` included: a fetched page that listed nobody is warned as a likely site migration, so its people cannot be concluded absent from a sibling lane's read.
`empty` means the page listed no rows at all, not that the lane emitted nobody new, so a tab sharing its `deptKey` with an earlier tab that re-lists the same people stays `ok` rather than withholding its department on every run.
When several configs share one `deptKey`, the collapsed status is the first incomplete-read status among them, so an `empty` config cannot mask a sibling's `partial-read` or `fetch-failed`.
The pass reports as `incompleteReadDepartments` only the departments this rule withheld, so a department that no lane admitted in the first place is not counted.
A lane whose read regressed against its own previous read withholds its department the same way, because the regression guard distrusts that read for the same reason, so a sibling lane that passed cannot conclude absence for the people only the regressed lane lists; the count stays in `regressedDepartments`.
A lane the drop guard freezes does not withhold, because the drop guard compares one lane against the whole department's governed rows, so a small sibling lane such as a School of Management tab would freeze on every run and permanently withhold its department.
A frozen lane still counts as presence evidence: when a sibling lane governs the department, the people the frozen lane listed are unioned into the department's discovered set, so the sibling cannot conclude absence for somebody only the frozen lane lists.

A run in which every attempted lane failed to read throws, so it is stored as a `failure` rather than a `success`, and so does an `official-research-home-rosters` run in which every roster fetch failed.
Without that, a lane whose every page was unreachable still emitted its honest not-read snapshot, which counted as an observation, so the barren-streak guard could never fire and the run read healthy.

#### A first absence counts only for its own department and its own read

`absentFromRosterSinceRunId` stores a run id and nothing else, so on its own it cannot say which department it was read against or whether that read was whole (#3702).
Measured on Development on 2026-10-01, all 22 stored markers came from one 2026-09-23 run scoped with `--only` to a single department and written before #3661, 16 of them on `student_ready` rows.
A complete read clears a marker only on a row it classifies `present`, so 20 of the 22 were unreachable, and one served row whose covered department had since changed was planned `suppress_departed` on a marker recorded against a different department.
Three rules now decide an absence, and none of them writes a field.

1. A standing marker completes a departure only when its own run, re-read with the current rules (`createAbsenceMarkerJudge`), classifies the row `absent` from the row's current departments, and that run carried the #3661 fix (`ROSTER_ABSENCE_MARKER_CUTOFF`, judged by `ScrapeRun.codeSha` ancestry and then `startedAt`, as `fieldRetraction.ts` judges its cutoffs).
A marker that fails is not trusted and not cleared: an absent row gets a first absence of the current run in its place, and any other row keeps an inert marker that can never prime a suppression.
2. A row is `absent` only from a department whose roster listed it on an earlier read (`loadPreviousRosterListings`, superseded snapshots included).
A department tag the materialize added, or a row the lane observed only on another department's page, is `inconclusive` there, so moving a row between departments or moving a department across the drop guard cannot turn an unchanged read into first absences.
3. A row listed anywhere in the run is `present` (`loadRunRosterPresence`): every snapshot's discovered keys, whatever that snapshot was worth as evidence of absence, plus every `researchEntity` key the lane observed in the run, which covers cross-listing tabs that publish no discovery set and departments no `OrgUnit` names.

On the run the #3647 verification read, these rules moved the read-only plan from 494 `refresh_present` and 89 `record_first_absence` to 522 and 12, with 0 `suppress_departed` before and after, and the judge refuses all 22 stored markers.
The fix needs no data operation: the plan re-judges markers at decision time, so the stale markers stop mattering on the next plan without a repair.

Writing the Yale-status fields is not the same as removing the row from the directory, so every suppressed or cleared row is re-gated through `planStudentVisibilityGate`/`applyStudentVisibilityGatePlans` and the count is reported as `regatedEntities`.
`studentVisibilityTier` is a stored field and `activeAtYaleCache === false` only decides the tier the next gate pass computes.
The first enabled run on Development proved the gap: of two rows written `departed`, one was re-gated by a later pass in the same materialize and left the surface, and the other kept serving `student_ready` at HTTP 200.
A lane that changes a field the gate reads has to re-gate in the same pass, or whether the change reaches students depends on what happens to run next.

That requirement is also what bounds the blast radius of enabling the flag.
`governed` is every live `FACULTY_RESEARCH_AREA`/`LAB` row carrying the department while `discoveredEntityKeys` holds only what the faculty roster found, so 746 of the 909 absent rows on Development were minted by another lane entirely and are absent from a faculty roster by construction.
Their absence means nothing, and a positive Yale-side assertion is what stops it being read as a departure.

### YSM lab delisting detection is off by default

`ysmLabDelistingReconciler` records the `permanently_closed` marker for YSM lab microsites that YSM deleted and dropped from its A-Z index.
It runs from `materializeFromRun` and is gated by `SCRAPER_YSM_LAB_DELISTING_DETECTION`, which is `false` by default and listed in `server/.env.example` so the lane is discoverable rather than existing only inside the reconciler and its test.

Suppression requires two independent positive facts: absence from an authoritative index across two distinct runs, recorded on the entity as `absentFromIndexSinceRunId` and cleared the moment the index lists the lab again, and the microsite itself probing `404`/`410`.
Absence alone is an inference from a missing row that a selector change produces wholesale, and a `404` alone is one URL that a transient edge error can fake, so a single failing signal freezes the lane instead of retiring a live lab.
A `403`, `429`, `5xx`, timeout, or SSRF refusal leaves `micrositeDead` false, because collapsing those into "gone" would turn throttling on `medicine.yale.edu` into mass suppression.

The only index input is the `ysmLabIndexHealth` observation `ysmAtoZScraper` emits once per run, and it is authoritative only when the run parsed the whole index: `--only`, `--limit`, and `--offset` each mark the snapshot incomplete.
`discoveredLabSlugs` carries microsite slugs derived by the reconciler's own `labSlugFromMicrositeUrl`, not entity slugs, because it is compared against a stored `websiteUrl`; emitting the `ysm-`-prefixed entity slug put the two sides in different key spaces and made every governed row read as absent.
Slug normalization folds the casing and separator drift between the index and stored URLs (`lab/Pitt` for indexed `pitt`, `lab/colon_ramos` for indexed `colon-ramos`), which is a correctness requirement: a raw comparison reported 52 delisted labs where 48 are, and the 4 extra were live.
`YSM_LAB_INDEX_DROP_GUARD_MIN_FRACTION` (0.5) freezes the pass when the discovered set collapses below half the governed population.

The lane honours `manuallyLockedFields`: a row that locks `studentVisibilitySuppressionReason` is skipped and counted in `lockedSkipped`, since the closure marker outranks even an explicit operator override to publish.
The marker is appended to any existing suppression reason rather than replacing it, because that field is a comma-joined list read by substring elsewhere.
The result names why a pass did nothing (`disabled`, `dry-run`, `invalid-run-id`, `no-index-health-observation`, `index-not-authoritative`, `drop-guard-frozen`, `reconciled`) and separates `held` (suppression withheld because the microsite answered as alive) from `unchanged` (nothing to decide), so a healthy run cannot look like a run that withheld dozens of suppressions.

### Center roster retirement: members a complete read no longer lists

`centers-institutes-index` keys every roster member as its own observation (`<center>:<member>`), so a member the roster stops listing is never re-asserted, never superseded, and keeps its role edge forever, including a stale lead edge (#3781).
`centerRosterRetirement.ts` closes that gap from evidence the lane states itself, and runs from `materializeFromRun` after every entity of the run is projected.

Each read of a center emits one `centerRosterHealth` observation naming every member key, role claim, membership key and relationship key it listed, with `status`, `complete` and a `read` block (`pagesRead`, `readMode`, `cacheAllowed`, `stopReason`, `readAt`).
Only a read that reached the roster's own end (`not-paginated`, `empty-page`, `repeated-page`, or a single rendered page), listed at least one member, and did not run with `--use-cache` is admitted.
A refused roster site, a first-page fetch failure or `404`, and an unavailable render emit no snapshot at all; a later-page failure, an extractor error and the page cap record `partial-read`; an empty page records `empty`.
A cache-permitted read is excluded because two runs inside the snapshot cache's 24-hour lifetime replay one fetch, which would let one parse satisfy the two-read rule; the exhaustive sweep modes never pass `--use-cache`.
The pager now stops on two consecutive pages that add nobody, the rule `walkRosterLanePages` uses, because a 1-based Drupal pager repeats page 0 once and then continues.

A claim retires only when two admitted reads in distinct runs, both after the claim was last observed and after the last read that listed it, omit it.
Four populations are judged, each scoped to this source on this center: member observation keys (every field is retired), role claims of members still listed (a stale `director` observation for a person now listed as `core-faculty`), profile URL claims of members still listed (a stale `profileUrl` observation for a person now listed under another URL, which would otherwise hold the member's profile URL in conflict and block the re-keyed edge), and role edges whose `rosterProvenance.sourceName` is this source, matched on the `rosterProvenance.membershipKey` the materializer stamps (`utils/rosterMembershipKey.ts` owns that string for both sides).
An edge with no membership key or no `observedAt` is never judged, and an edge whose membership key another source's live member observations produce, or whose person and lead role another source's live `inferredDirector*` observations name, is left alone.

The pass freezes a center, retiring nothing and warning, when the retiring share of its member keys, edges or relationship keys exceeds `CENTER_ROSTER_MAX_ABSENT_FRACTION` (0.5), or when the latest read lists fewer than `CENTER_ROSTER_DISCOVERY_RETENTION_MIN_FRACTION` (0.75) of the largest admitted read on record.
There is no population floor, so a small center that genuinely halves stays frozen until the larger read ages out of observation retention, which keeps the last three runs per source.

Retirement writes no field and no lock.
Observations get `superseded` plus `rollback.rolledBackAt`, which both read scopes honour, so the next materialization has nothing to rebuild the claim from; an edge is ended with `state: HISTORICAL` and `endedAt`, the same write an official-roster departure makes, so a later read that lists the person again revives it through the ordinary upsert; a relationship is archived unless another source's live relationship observations, or a relationship key this source still asserts, resolve to the same target.
Members still listed whose edge or claim was retired are re-materialized in the same pass, so a demoted lead gets its current role edge at once; the center is then re-gated and its search document re-synced, because the gate re-indexes only a row whose tier changed and the document carries the roster's names.
Role edges that carry no `rosterProvenance` at all predate provenance, and this pass never judges an edge that names no source.

A read can hand such an edge to this pass by adopting it (#3799).
When the lane materializes a listed member whose identity it resolves to exactly one researcher, through the listing's profile URL or the identity evidence the member's own profile page states (#3802), the canonical upsert already stamps this source's provenance onto that person's provenance-less edge of the listed role, because it matches on person, target and role; `adoptUnprovenancedRoleAssignments` then stamps the person's remaining provenance-less edges on the same center, whose roles the read does not state.
An adopted edge of an unlisted role gets the membership key `<identity>|<its own role>`, an `observedAt` taken from the edge itself rather than from the read, and `rosterProvenance.adoptedAt`, so the read that adopted it already counts as the first read that omits it and the ordinary two-read rule and freeze guards govern it from then on.
Adoption follows only the identity the listing proves, never a name, so a namesake's edge is never adopted; it never touches an edge whose provenance names any source; and only a source whose retirement meets the two-read rule may adopt (`SOURCES_THAT_ADOPT_UNPROVENANCED_EDGES`), because `official-research-home-roster` ends an edge on a single snapshot.

Measured read-only on Development against one live read of every config on 2026-09-28: 968 live provenance-less edges on 12 center rows, 20 of them lead edges, all created on one migration date.
Adoption reaches 1 of them, because the upsert had already adopted every edge whose person and role a read restates.
824 are edges of a person the read lists under the same display name whose center-hosted profile URL resolves to no researcher, so the materializer resolves the listing to a separate name-only person and the center serves the name twice; that identity split is a lane defect, not something adoption may bridge.

#3802 fixes that lane defect without a name join.
The lane follows each Yale-hosted member page and emits `profileIdentityEvidence`, and `resolveRosterMemberIdentity` joins the listing to the one researcher that evidence reaches: a Yale person page the member page declares or links that a researcher carries as `YALE_OFFICIAL`, the member's own Yale email on a live account, or a netid the page's Person metadata labels as one.
The listed name only vetoes a candidate, with the comparator the email and profile-page joins already use, and two agreeing candidates resolve to nobody.
An edge written for a resolved listing records `rosterProvenance.identityBasis`.
A listing that stays unresolved is not minted when a researcher with an account, netid or ORCID already carries its exact name (`unresolved-identity-namesake`): that mint is what the accountless-shell dedupe folds back by name every sweep and the next read mints again, and the listing itself is not lost, because its observations and its `centerRosterHealth` membership key stay live, so the retirement still governs the person's edges and a later read with evidence resolves it.
Twins minted before the fix fold through that same dedupe, whose roster arm joins a shell to the holder whose edge records the same source, entity and membership key with an `identityBasis` ([`research-entity-pi-dedupe-runbook.md`](research-entity-pi-dedupe-runbook.md)).
Measured read-only against one live dry-run read of every config on 2026-09-28, the same class re-counted at 838 edges, 8 of them leads: 609 (6 leads) resolve to their holder by evidence; 194 on `center-wu-tsai` come from listings the current read publishes with no profile URL, which write nothing before or after the fix and serve no duplicate; and 35 (2 leads) stay unresolved and are refused rather than minted, 16 because the member page states nothing that reaches a researcher, 13 because the page still answered 403 after the backoff, and 6 because the page names somebody else.
Following member pages costs the lane about 3,600 extra fetches a run, which the shared per-host limiter paces, so a full read takes roughly half an hour.
The remaining 143 are edges no read and no other source supports, recorded for operator judgement on #3799.

### Link-health verdicts, and what each one licenses

`sourceLinkHealth` records one probe verdict per cited URL, written by `research-homes:backfill-source-link-health` and read at render time by `isUnavailableResearchWebsiteCtaUrl` to hide a dead website CTA.
Three properties of the verdict matter, and they were all wrong before #2473.

Only a status that asserts the resource is gone retires a link.
`404` and `410` record `UNAVAILABLE`; `401`, `403`, `429`, and every `5xx` record `UNKNOWN`, along with timeouts and SSRF refusals.
Collapsing the inconclusive statuses into `UNAVAILABLE` let a WAF or one bad afternoon retire a live citation, which is the inverse of the standing rule that `403`/`429`/`5xx`/timeout never retire a link and never license a replacement.

A `2xx` that lands somewhere other than the requested resource is a soft `404`, not a healthy page.
`landsAwayFromRequestedResource` compares the post-redirect landing against the request and records `UNAVAILABLE` when a deeper page lands on the host root or on a shared roster, because a CMS answers a missing person by redirecting to the index rather than by status code.
An `http`-to-`https` upgrade, a `www.` change, a trailing-slash normalization, and a genuine per-person move that still names the person are all excluded, so a URL that merely moved is not read as gone.

A verdict expires.
`SOURCE_LINK_HEALTH_FRESHNESS_DAYS` (30) is the horizon past which a verdict stops counting as verification, because a stale `HEALTHY` is worse than a missing one: serve-time suppression keys off `UNAVAILABLE`, so an absent record fails open while a stale `HEALTHY` positively asserts that a now-`404` page is fine.
Staleness means unknown, not gone, so it never suppresses on its own - it makes the row eligible for a re-probe (`--stale-only`, which skips rows whose every verdict is still fresh) and it withholds the row from anything that requires proof, which is what `isVerifiedReachableSourceLink` answers.
That predicate is deliberately not the negation of `isLikelyUnavailableSourceLink`: an inconclusive or stale verdict is neither verified-reachable nor dead, and the two questions are "hide a known-dead CTA" and "count a proven route".

The sweep re-probes by URL rather than by row, with `--reprobe-healthy-after-days=7` (`SOURCE_LINK_HEALTH_REPROBE_HEALTHY_AFTER_DAYS`, #3568).
A URL is probed when it has no stored verdict, including a URL new to the row since its last probe, and whenever its verdict is anything but `HEALTHY`, so `UNAVAILABLE`, `UNKNOWN` and `REDIRECTED` are re-probed on every sweep.
A `HEALTHY` verdict is carried forward unprobed, with its original `checkedAt`, until it is more than 7 days old.
The stored verdict is found by `sourceLinkCandidateKey`, which normalizes like `findSourceLinkHealth` but keeps the scheme, so each spelling carries only its own verdict and the readers rank the spellings as described below.
The window is 7 days rather than the 30-day horizon because the gate and `dead-research-website-clear` act on these verdicts, and a site can die within a month: a dead site is noticed at most 7 days late.
Keeping it well inside the 30-day horizon also means a regularly swept `HEALTHY` verdict never lapses into unverified.
No reader of a dead verdict loses anything, because a dead verdict is never carried and so is at most one sweep old; `retireDeadCitationResearchEntities`, the only reader that ages a dead verdict, still applies the 30-day horizon.
The gate itself reads no verdict age.
`--full-link-health-reprobe` on the sweep, or running the backfill without the flag, probes every URL, which is the recovery path after a probe-rule change alongside `--checked-before`.
The saving depends on sweep cadence: a sweep run more than 7 days after the last one re-probes almost everything.

`client/src/utils/researchDetailSources.ts` mirrors the retiring-status set; changing the arms on either side requires updating the other copy.

A stored entry carries a second, independent axis: `privateAddressHost`.
It records that the URL's host resolves only into private address space, so nothing off the Yale network can route to it, and it is deliberately not a `healthStatus` value.
The two axes answer different questions: `healthStatus` asks whether the page exists, and for one of these hosts we never fetched the page at all, so it stays `UNKNOWN`.
Sharing the `UNKNOWN` bucket was the defect: `UNKNOWN` fails open, so a link no student off campus can open counted as a way in, and 29 served rows cited one (#2556).
Mislabelling it `UNAVAILABLE` instead would have been worse, because that axis is what the dead-citation retirement lanes read to delete a citation, and these pages are not gone.

Three consequences follow.
`isPubliclyUnreachableSourceUrl` is the predicate a way-in projection asks, and it is true when either axis disqualifies the citation; `officialNonGrantSourceUrl` uses it and falls through to a publicly reachable citation instead.
The citation itself is never deleted, because it is real provenance: the detail page keeps listing it with an on-campus-network-only qualifier, while `isUnreachableResearchWebsiteCtaUrl` stops it being offered as the research-website CTA or as the outreach official source.
Routing never expires and is only ever unlearned from positive evidence: a probe that came back with an HTTP status proves the host was publicly routable at that moment and drops the flag, public DNS mapping the host to public space drops it too, and a timeout or transport error learns nothing about addressing and keeps it.

A stored entry carries a third independent axis, `tlsVerificationFailed`, and each URL scheme carries its own verdict (#4080).
The flag records that the server answered but its certificate failed verification, so a browser stops a student at a security warning; `healthStatus` stays `UNKNOWN`, because a certificate says how the host presents itself on port 443 and never whether the page exists (#2751).
The scheme is kept in the backfill's candidate key, so `http:` and `https:` spellings of one page are probed and stored separately, since on a host with an expired certificate plain HTTP answers `200` while HTTPS fails.
Merging them let the `http:` result stand for the `https:` link a student is sent to, and the carry-forward then wrote that `HEALTHY` back under the `https:` spelling.
Lookups rank a same-scheme verdict first; the other spelling's verdict stands in otherwise, except that a plain-HTTP verdict saying the link works never speaks for an `https:` URL, while a plain-HTTP `404` still says the page is gone.
A fresh certificate failure replaces a stored `HEALTHY` for the same `https:` URL rather than being preserved under it, because it contradicts that verdict; a stored `UNAVAILABLE` still stands.
When an `https:` probe fails verification and no plain-HTTP spelling is already a candidate, the pass probes that spelling too, and serve time (`servedResearchWebsiteUrl`) offers it only when it is verified `HEALTHY`; otherwise the stored URL is linked unchanged.

The resolved address has to be the one a student gets, not the one the probing machine gets.
Yale answers its legacy departmental hosts with split-horizon DNS: the resolver on the Development scrape host returned RFC1918 space for `www.cs.yale.edu`, `ursula.chem.yale.edu`, `www.astro.yale.edu` and others, while public resolvers return routable `128.36.0.0/16` addresses and the pages load off campus (#3903).
So the flag is recorded only after `classifyOffCampusAddressing` (`server/src/utils/publicDnsResolution.ts`) confirms the host against public DNS over HTTPS, which a network intercepting port 53 cannot answer in the public resolver's place.
A public answer reports `publicAddressHost`, the release evidence, which is never stored; a private answer or NXDOMAIN confirms the flag.
A failed lookup is logged and leaves our resolver's private answer standing, because a failed measurement must never release a link a student cannot open.
Each host is asked once per process, however many cited pages it serves.
The SSRF guard is unchanged and still refuses to connect, because our own resolver would route the connection into private space.
#2556 flagged these hosts on the probing machine's view, so flags stored before #3903 are released by the reclassify pass below rather than by waiting for a re-probe.

`sources:reclassify-private-address-hosts` (`server/src/scripts/reclassifyPrivateAddressCitations.ts`, dry-run-first, `--apply --confirm-private-address-reclassify`) is the stored-data half.
It resolves each distinct cited host once through the existing SSRF guard's `classifyHostnameResolution`, confirms any private answer with `classifyOffCampusAddressing`, so the verdict comes from the address a student resolves rather than from whether a fetch succeeded, and it re-gates every row it writes.
Decide this question from the resolved address, never from reachability measured on the machine running the pass: a developer machine egressing from a Yale range answers `200` for these hosts in well under a second, and that reading says nothing about a student at home.
Every arm is keyed on the live verdict rather than on a plan, so a re-run settles `unchanged`, and only a `public` verdict releases a flag - `unresolvable` and `resolver-failure` settle nothing in either direction.

### Faculty-research-area profile research synthesis

A `FACULTY_RESEARCH_AREA` usually has no lab site, so its only source is the professor's official Yale profile page, which states the research but interleaves it with credentials, so no contiguous verbatim span carries it and extraction can only copy the biography.
`research-entity:fra-profile-synthesis` (`server/src/scripts/fraProfileSynthesis.ts`, pure logic in `fraProfileSynthesisCore.ts`, per-entity DB step in `fraProfileSynthesisLane.ts`) serves that cohort: for unlocked, non-archived `FACULTY_RESEARCH_AREA` entities whose description is a career biography **or which serve no description at all** and which have at least one candidate profile page, it harvests the page's research sentences, drops career, credential, and navigation sentences, and reuses the same grounded coverage synthesizer the grant-corpus lane uses.
Which citations count as that profile page is `selectFraProfileUrl` in `fraProfileSynthesisCore.ts`, and it is deliberately two halves rather than a path match: a Yale page shaped like one person's own page (`isOfficialYalePersonPageUrl`, which refuses rosters, indexes, faceted listings, directory loaders, file downloads and fundraising pages) whose leaf also names the person the row is about (`personPageUrlNamesPerson`, keyed on the row's leads first and then its own title).
The row's own citations are not the whole candidate set: `selectLeadProfileUrls` adds the official Yale profile pages the row's resolved leads carry that the row does not already cite, and `profileUrlsOf` orders the row's own citation first and tries each page until one yields a usable description.
A cross-appointed professor's research prose often lives on a second official host while the row cites only a bare departmental contact stub, so the lane's reach was bounded by what a row happens to cite rather than by what the corpus already knows about its lead (#1937).
A lead candidate is admitted only when the URL corroborates the lead's identity as well as belonging to them on record: the leaf names the lead under the same surname-plus-given-name rule, or the leaf equals the lead's own netid, because a `YALE_OFFICIAL` link can itself have been bound to a same-surname colleague (#1935) and a description harvested onto the wrong person is worse than none.
The row's own title must name that lead as well, because a role edge says the person leads the row and not that the row is about them, so on a multi-lead row the edge alone would let a co-director's page be harvested as this person's research.
A link the corpus has already probed and recorded `UNAVAILABLE` is dropped before the fetch.
Shape alone would admit a faculty directory, since a directory row, a section index and a profile share the same path shapes, and a directory page adopted as one person's description is #2385 and #2708.
The identity half reuses the surname-plus-given-name rule `profileSlugNamesPerson` states, applied to a leaf that reader cannot see because a vanity path carries no directory segment to key on, plus a concatenated arm for the School of Art shape (`art.yale.edu/<GivenSurname>`).
The `/profile/` arm is admitted on shape alone, preserving the reach the lane had before #2276, because those leaves are routinely opaque netids and requiring identity there would narrow the existing cohort.
Selection asks whether the served description states career facts (degrees earned, appointments, honours), not whether it reads as person prose: `isCareerBiographyDescription` in `server/src/utils/careerBiographyDescription.ts` owns that predicate, and name-framed research prose ("Dr. Sauler's research investigates mechanisms of lung injury") is good copy that must never be rewritten.
A row that serves no description is in scope too, and that is not a widening of the same risk but the case the risk cannot apply to: there is nothing to churn and the row serves no card at all.
`servedFullDescription` decides it by running the row through `sanitizeServedResearchEntityCopyFields`, the same single canonical serve-time sanitizer the DTO runs, so a row storing an appointment dump, a role-only fragment, a contact route, a publications dump, escaped markup or another organization's prose counts as serving nothing.
Why it delegates instead of re-applying one stage of that sanitizer belongs to the sanitizer's own contract, in "One serve-time description sanitizer".
An entity is skipped as already served when it **serves** a description and has a recorded non-synthesis description that is not a career biography, clears the description-quality bar, **and** actually describes research (`describesResearchFocus`), so clinical-service or committee prose does not count as a research description the lane should stand down for.
The serves-it condition matters because "already beats this lane" is a claim about a contest that has been held: on a row serving nothing the recorded alternative demonstrably did not win, so reading it as a winner leaves the row blank forever.
Reading the stored field instead decides the opposite of what a student sees on 68 Development rows.
The output is written as an `fra-profile-research-synthesis` observation at `FRA_PROFILE_SYNTHESIS_CONFIDENCE` (0.48), above the grant-corpus lane because a professor's own profile is the better authority on their research and below official-profile extraction so a genuine verbatim research statement still wins, and the lane fails closed when the output is not grounded, still reads as a person biography, keeps a dangling pronoun subject, or no longer clears the description-quality bar.
Confidence alone cannot displace the biography, since official-profile extraction re-emits it weekly at a higher weight, so `confidenceResolver` sorts biography `fullDescription` groups last once this lane has recorded a useful non-bio value for the entity; the bio is demoted rather than dropped, so an entity with only a bio still serves it.
That demotion covers person-voiced prose and career biographies alike, because a demotion narrower than the lane's selection predicate would leave the selected cohort undemotable and the lane reporting success while the biography stayed served.
A harvested page is deliberately not written onto the row's `sourceUrls`: the observation is the durable record, `fieldProvenance.fullDescription.sourceUrl` already counts as a live citation to the visibility gate, and adding a shared `/profile/` URL to hundreds of already-sourced rows is what `exact_url_duplicate_risk` keys on, which is why the materializer's own #1802 projection is scoped to rows exposing no reachable http source.
The lane is dry-run-first, bounded by `--limit`, needs `OPENAI_API_KEY`, and apply is Development-only and requires `--confirm-fra-profile-synthesis`; the source must be seeded first (`scrape:seed-sources`).
The rest of the contract, including the measurement harness and the traps this lane already paid for, lives in [`skills/scrapers/SKILL.md`](../skills/scrapers/SKILL.md).

### One serve-time description sanitizer

Every HTTP path that serves research-entity copy runs one canonical function, `sanitizeServedResearchEntityCopyFields` in `server/src/utils/researchEntityDescriptionText.ts`.
It composes the full guard union in a fixed, idempotent order: the text-transform layer (subjectless-lead repair, first-person re-voicing, mismatched-name-prefix correction, the non-person-org biography guard, the `publicResearchEntityDescriptionText` fail-closed gate, and then orphaned third-person re-voicing), then the faculty and research-home self-reference relabel passes, then the `descriptionHygiene` layer (chrome and dump stripping, contact-block/publications/center-blurb/HTML fail-close, and the per-field length clamps).
A body whose first word is a pronoun carried over from the scraped bio ("His research focuses on ...") is re-voiced rather than withheld, because a `student_ready` row that loses its body loses its detail page.
A leading possessive determiner takes the entity's own possessive subject, which keeps the noun phrase after it verbatim.
Three shapes take a demonstrative instead: a possessed research-home noun ("His lab studies ..." -> "This lab studies ..."), a bare `He`/`She` subject ("This researcher ..."), and an entity name carrying an `at <place>` phrase, whose possessive would read as the place owning the research.
Only the leading pronoun is re-voiced: a later one can point back at a subject the prose itself introduced.
Most of those bodies never opened with a pronoun when stored - stripping the credential opener ahead of them is what left the next sentence's pronoun heading the body, so the re-voice pass has to run on the stripped remainder too (#1871).
One guard in that union reads a legacy stored flag rather than the text in front of it, and has to be read as narrowly as it is written.
`descriptionSource: 'PI_PROFILE_SYNTHESIS'` blanks a description that carries no research signal, but nothing in the tree writes that value any more, so on a row that has since won a higher-confidence description the flag describes text that is no longer there.
The guard therefore exempts a field whose own `fieldProvenance` names a source, because provenance is what says whose text is being served, and keeps firing on `profileSynthesisDescription`, which is the profile-synthesis field by name and records no provenance on any of the 341 Development rows carrying the flag.
Reading the flag alone blanked 5 source-backed bodies and 9 source-backed cards, and because an empty body fails the public-description invariant, 6 rows were held at `operator_review` and served no detail page at all; every one of them was humanities or writing faculty whose research content is topic nouns and works rather than STEM verbs (#1921).
A leading administrative title list is dropped by `stripLeadingAppointmentTitleBlock`, which recovers the paragraph boundary the source page had rather than guessing a semantic one: the block flattener collapses a paragraph break to a single space by design (#851), so the title list and the first real sentence arrive as one run-on and every sentence-bounded lead strip sees a single segment (#1815).
The seam is a narrative clause opener, the run dropped ahead of it must carry no finite verb of its own, and a substantial narrative with a verb has to survive, so a title-only description is left for the closers that already fail it rather than truncated here.
It reached 15 of 3301 served Development rows, every one of them `student_ready`, and none of them lost its body.
The two prose fields clamp differently, because a card line has to load whole (#2184).
A `fullDescription` is clamped by length with `clampDescriptionLength`, but a `shortDescription` goes through `clampShortDescriptionToWholeSentences`: it keeps as many leading sentences as fit `MAX_SHORT_DESCRIPTION_LENGTH`, taken from the abbreviation-aware sentence tiling (`partitionSentencesForFiltering`) so a `Dr.`/`Prof.`/`etc.` period, or a parenthetical `e.g.`/`i.e.` (#3866, which served 3 Development cards cut at "(e.g."), is not read as a sentence end, and when no run fits that rendering preference it keeps the run that fits the card's hard ceiling (`MAX_CARD_SHORT_DESCRIPTION_LENGTH`/`WORDS`) rather than deleting the line (#1878), failing closed to an empty card only when the leading sentence is itself past that ceiling.
It never emits a truncation fragment either way.
The kept text must also clear the same eight-word floor `shortDescriptionQuality` applies to a card, so the clamp can never hand back a line the card gate would reject as too short; that floor is also what rejects a bare name-initial lead such as `J.`, which the tiling does not protect.
A stored short that already ends in a trailing ellipsis fails closed at the same sanitize boundary for the same reason: `shortDescriptionQuality` rejects a trailing ellipsis as a fragment, so serving one would gate the entity on the exact copy it is being shown.
Both the DTO card field and `resolveServedShortDescription` then recover a quality-checked line derived from the entity's own full description instead.
A line the clamp keeps past the rendering preference is held to the card bar at both of those places before it is served (`storedShortPastRenderingPreferenceIsServable`), because that band displaced those fallbacks rather than sitting alongside them, and the two paths must not disagree about what a row shows; `docs/decisions.md` owns the reasoning (#1878).
Avoiding that same divergence bounds the other read-time surrender the card field can make.
A stored card whose distinctive topics are absent from the body can be a wrong-entity graft (#1212), so the card field surrenders it only when the fallback is a summary of the row's own body, and keeps it when the fallback would be the `researchAreas` chip summary the chip row already renders beside the card (#2299, `surrenderingTheCardReachesTheBody` in `server/src/services/researchEntityDto.ts`).
There are three fallback forms to recognise there rather than two, because the resolver can also withhold the chip summary outright when the row's own body supports no chip (#2972), and giving up a stored card for nothing is a strictly worse trade than giving it up for a chip row.
Withholding is reported as `topicCardWithheld` on `ServedShortDescriptionOutcome` rather than as an empty card, because the DTO answers an empty card with the row's whole body and that is the right answer only when the resolver had nothing to derive in the first place.
The public research-entity DTO (`toPublicResearchEntityDto`, `toPublicResearchEntitySummaryDto`) routes through it, so browse and search cards get the same guard set the detail page already applied, rather than the `descriptionHygiene` subset alone.
One guard in that union needs an input the sanitizer cannot derive: the mismatched-person-name strip is a structural no-op unless the caller supplies the record's lead display names, so a serve path that omits them is running a smaller guard set than the detail page, not a cheaper version of the same one.
Browse and search therefore batch one roster read per result page (`optionalPublicLeadMemberNames` in `researchGroupService.ts`) and pass the names to `addResearchEntitySearchAliases`, which keys them onto each hit by `_id` (#2240).
The detail page's related and similar rails and the saved-plan list in `researchPlanService.ts` batch the same read through the same function.
A failed read is reported as `unavailable` rather than as an empty map, because no names is exactly the no-op above: every caller then serves its rows through `withoutLeadGuardedCopy` in `servedResearchEntityCard.ts`, which withholds the copy fields those guards protect, and a list response carries `degraded: true`.
A row whose read succeeded but found no leads is a different case and keeps its copy (#3641).
`publicProfileResearchEntity` in `profileService.ts` also calls the sanitizer with no names, but it is reached only through `normalizePublicProfile`, which no route calls: the person page is retired, and `cleanPublicProfileBio` is the one export any production caller still imports from that module.
It is left nameless deliberately rather than plumbed, because wiring a batched roster read into a path nothing serves would add a reader for `rosterEnrichment` that no request exercises.
Any future route that revives that surface has to supply lead names, or it revives the divergence with it.
A card surface that omits them is the defect, not a cheaper variant, so any projection feeding one must carry `rosterEnrichment`; the official-roster freshness filter inside the derivation fails closed without it and silently shortens the lead set.
The browse visibility GATE stays name-agnostic on purpose: repairing copy cannot drop a row, but admitting a hit set through a non-monotonic transform can hide a card whose detail page serves (#2241).
A consumer that serves no response but still has to know what a row shows a student calls this whole function too, never one named stage of it: the FRA profile-synthesis lane's `servedFullDescription` does, because a single stage diverges from the card in both directions, the hygiene layer blanking bodies `publicResearchEntityDescriptionText` alone keeps and the repair passes that run ahead of the blanking predicates rescuing bodies a lone predicate call calls blank.
One guard here is not about copy: the same function withholds a person-scoped record's `displayName` when that name identifies an umbrella organization the person merely belongs to or another person's lab, so every surface falls back to `name` (`personScopedResearchEntityNameNamesSomethingElseByUrlPath`, #2234/#2351).
It sits in the shared sanitizer rather than in one DTO because the saved-plan and profile serve paths build their own summaries; [`skills/scrapers/SKILL.md`](../skills/scrapers/SKILL.md) owns that guard's full contract and its materialize and search-index choke points.
The bad-description classes this must catch are enumerated as a data-driven catalogue in `server/src/utils/__tests__/researchEntityDescriptionServeContract.test.ts`.
When a new class of bad served description surfaces, add a row to that catalogue (and, only if no existing detector matches, one detector wired into the layer the sanitizer composes) instead of bolting another read-time guard onto a single serve path; the catalogue then proves the fix holds on every surface at once.
The quality/visibility assessor (`buildResearchEntityPublicDescriptionRepresentation` -> `assessResearchEntityDescriptionQuality`) is a separate concern that flags rather than rewrites, and it gates the release tier; the detail response still runs the full serve sanitizer downstream in the DTO.
A lead-requiring research entity (a lab or group, not a program or organizational home) with no attached lead is likewise held at `operator_review`: a missing, weak, or conflicting PI is a hard floor that no operator override can lift to a public tier.
Run `yarn --cwd server research-entity:audit-public-descriptions --strict --include-samples --output /tmp/ylabs-public-description-audit.json` against Beta before promotion.
The strict Beta data-quality scorecard includes this audit as an error-level check.

Access claim validation is the interpretation boundary before student-facing access artifacts are written. `accessMaterializer.ts` now treats derived access `Signal` rows as candidate claims and filters them through deterministic validation before upsert. The V1 contract is intentionally narrow: a candidate with no source evidence is rejected, and any candidate with source evidence is accepted. Operators can inspect current artifacts with `yarn --cwd server scraper:claim-gate --collection=research --include-samples`, or include the summary inside `scraper:integrity-gate --include-claim-gate`.

Undergraduate logistics validation is retired (#3088), along with its five claim types, its materializer, its producer arm and its audit.
The five `undergraduateLogistics*` observation field names survive only in the materializer's ignore filter, so stored rows are never written onto an entity.

For YSM lab entities, `ysm-atoz-index` uses the current official index at `https://medicine.yale.edu/about/a-to-z-index/lab-websites/`. It is not only an index discovery source: it fetches the official lab homepage and emits source-backed `fullDescription` and `shortDescription` observations from Yale's embedded page metadata when available. It follows an exact lab `Research Faculty` page link and emits a named `director` member only when that page has exactly one profile card; profile URLs are canonicalized to `medicine.yale.edu/profile/<slug>/`, and the scraper does not fabricate a `Researcher` when no existing match is available. Materialization records per-field provenance from the winning observation so detail pages can be audited back to the exact source URL.

Research-entity `sourceUrls` are durable home/profile/grant evidence pointers, not a dump of every supporting page. Materialization keeps raw observation evidence intact, but filters article, news, event, blog, podcast, video, and webinar paths out of materialized `sourceUrls` so content pages cannot make a valid lab or center look like a leaked article record.
Materialization also promotes a lead's official profile page into `sourceUrls` so the detail-page official-profile CTA can find it: `officialLeadProfileSourceUrl` picks the highest-confidence lead-identity observation (only `inferredPiUserId`/`inferredPiUserKey`/`inferredDirectorName`) whose `sourceUrl` passes `isLikelyOfficialPersonProfileUrl`, and materialization unions that URL in, deduped by `normalizeOfficialProfileDestination` and skipped when `sourceUrls` is manually locked (issue #613).
It is intentionally lead-scoped so roster and department entities do not flood `sourceUrls` with every cited profile.
Neither that projection nor the `bestMaterializationProvenanceSourceUrl` provenance projection may mint a citation the corpus already knows is gone, because an observation's `sourceUrl` is immutable and a removed profile page would otherwise be re-projected by every later materialization (issue #2567).
Both skip a candidate the entity's stored `sourceLinkHealth` records as dead and fall through in confidence order, the lead projection additionally refuses a candidate whose successor the entity already cites, and both refuse a person page belonging to somebody other than the person the entity's own citations establish as its own (issue #2945); `skills/scrapers/SKILL.md` owns those refusal rules.
Refusing a candidate is not enough on its own, because a graft minted before that rule keeps being served: the materializer also retracts an already-stored citation the same narrow arm refuses, before the lead projection runs and regardless of whether this pass has a lead-profile observation to trigger on, since a row with no such observation is exactly the row nothing else would revisit (issue #3000).
`websiteUrl` derivation runs after that projection on the same pass, because it clears a profile-page `websiteUrl` the entity already cites and so has to see a freshly projected citation immediately instead of one materialization later (issue #2352); `skills/scrapers/SKILL.md` owns the website-derivation rules.
Our own site is never valid evidence for an entity, so self-referential URLs (`yalelabs.io` and the deploy hosts, per `isSelfReferentialUrl` in `utils/urlSafety`) are dropped defense-in-depth: `observationStore.appendObservations` fails closed and never stores them as provenance, `sanitizeResearchEntitySourceUrlsForMaterialization` strips them from materialized `sourceUrls`, and the served payloads filter them out server-side at read time via `isDisallowedResearchEntitySourceUrl` in `utils/researchHomeWebsiteUrl` (whose sibling arms reject the other never-servable URL classes, including index/listing roots, generic CMS/platform boilerplate hosts, and roots of shared multi-tenant academic hosts; `skills/scrapers/SKILL.md` owns that arm inventory) across group `sourceUrls` and access-signal source URLs, so bad sources stop rendering everywhere without a data write.
Group `sourceUrls` is narrowed at DTO output (`publicResearchEntitySourceUrls` in `researchEntityDto.ts`), which covers the list and detail payloads alike, while access-signal evidence is narrowed in its own assembly.
That placement is load-bearing rather than incidental: the served citations are also an input to the name sanitizers the DTO runs, so narrowing them in `publicResearchDetailGroup` first hid the shared academic host root from `servedPersonScopedDisplayName` and served the host organization's name as the detail heading (#2360).
Our own site is never valid evidence for an entity, so self-referential URLs (`yalelabs.io` and the deploy hosts, per `isSelfReferentialUrl` in `utils/urlSafety`) are dropped defense-in-depth: `observationStore.appendObservations` fails closed and never stores them as provenance, `sanitizeResearchEntitySourceUrlsForMaterialization` strips them from materialized `sourceUrls`, and the public `/research/:slug` payload assembly filters them out server-side at read time via `isDisallowedResearchEntitySourceUrl` in `utils/researchHomeWebsiteUrl` (whose sibling arms reject the other never-servable URL classes, including index/listing roots, generic CMS/platform boilerplate hosts, institutional advancement pages, and roots of shared multi-tenant academic hosts; `skills/scrapers/SKILL.md` owns that arm inventory) across group `sourceUrls` and access-signal source URLs, so bad sources stop rendering everywhere without a data write.
The shared-host arm is the only arm that reads the entity being served: group `sourceUrls` and access-signal URLs pass it, so a shared host's own organization keeps its root there while its tenants do not.
Someone else's deploy host is no better evidence than our own, so `isEphemeralDeployHostUrl` in `utils/urlSafety` runs at all three of those layers as well (issue #2805).
A host a platform ASSIGNS to a deploy target names a build rather than a page, so it stops existing on the next deploy: the School of Art site's `<link rel="canonical">` pointed at its DigitalOcean build host, and 100 active citations were stored before issue #2804 stopped the lane trusting a cross-domain canonical.
The predicate asks about the host's durability, never about the lane, because a roster lane legitimately quotes a professor's own site; `skills/scrapers/SKILL.md` owns the arm inventory and the repair that retires stored rows.

Research detail membership and lead identity resolve from the canonical roster (`RoleAssignment` joined to `Researcher`), so the earlier `User` versus `FacultyMember` identity divergence no longer applies.
Each roster member is a single canonical `Researcher`, and the public detail payload shows that identity rather than falling back to a separate scraper-backed `FacultyMember` record.
Because canonical identity is unified there is no `facultyMemberId` conflict to detect, so the student visibility gate no longer raises `pi_identity_conflict` from roster leads and strong-lead detection relies on the roster member's presence and name.
A lead `RoleAssignment` that resolves to a `Researcher` counts as attached lead evidence.

The `official-research-home-roster` source acquires non-lead current membership only from an allowlisted official page and explicitly configured current section.
Each materialized row requires a source-specific official profile identity, an honestly mapped role, a recent page publish date, an observation date, and a bounded refresh-expiry date.
Names alone never resolve a `Researcher` or merge membership rows.
A complete non-empty snapshot archives source-owned rows that disappeared while preserving their observation and membership history; empty, stale, withheld, and failed snapshots never trigger cleanup.
Public detail suppresses expired or conflicting rows, limits roster presentation to 24 members, excludes direct contact data, and discloses that missing roster evidence does not mean an empty team.
After an optional-source failure, public detail may retain only the exact still-fresh rows from the most recent successful current or partial snapshot, using that snapshot's source and observation metadata for disclosure.
The source is seeded disabled and owned by y/labs data operations on a weekly cadence.
It stays disabled until `yarn --cwd server research-homes:audit-rosters --strict --sampled-precision-reviewed-by=<reviewer>` reports `broadEnablementReady`, which needs clean structure and a recorded sampled precision review (#2412).
The audit reads each configured page with the source's own extractor and joins it to the stored snapshot, so it measures the acquisition path rather than restating the config: a configured current section that left the page is `section-contract-broken` rather than an empty roster, a stored membership key with no live source-owned `CURRENT` row is `membership-not-materialized`, and a member whose profile URL is a listing or the roster page itself is the #2357 precision defect.
`snapshot-expired` is reported and deliberately does not alarm, because the source expires every row 21 days after its run, so an unrefreshed lane serves no roster at all while remaining structurally sound: on Development on 2026-09-22 both configured lanes were `current` on the page with 7 members and all 7 materialized rows had expired four days earlier.

## Read-Only Control Plane

The first control-plane slice is the admin Operator Board. It remains read-only and does not replace CLI or sweep execution. It should show:

- source readiness from seeded `Source` rows, recent `ScrapeRun` posture, expected artifacts, and next actions
- latest dry-run and write-run posture so operators can see whether Mongo writes need a follow-up Meili rebuild
- review queues split into repair blockers, review signals, and positive evidence signals
- release queue pressure from held visibility records, grouped by blocker and source
- discovery candidates from high-signal evidence queues that may be promotable after review
- WorkPlanner freshness policies for broad, paid, API-limited, or stale-sensitive sources
- manual gate commands for data quality, scraper integrity, and search sync posture

Pending Meili sync is an operator warning, not a worker. Local or one-off operator jobs may make Mongo current while Render-owned Meili remains stale; production promotion must explicitly rebuild or verify the prefixed production indexes before smoke checks.

The release queue is written by `yarn --cwd server student-visibility:gate`. Scraper `--auto-materialize` and manual materialize run the gate after clean write materialization.

The gate recomputes visibility for the whole corpus on every run rather than tracking a version stamp.
A per-plan write guard, `isStudentVisibilityGatePlanMateriallyChanged`, means only records whose recomputed plan actually changes are written, so an unconditional recompute stays cheap in writes (issue #2044 retired the former `STUDENT_VISIBILITY_VERSION` stamp and its stale-version sweep in favor of this model; do not reintroduce a version).
The exhaustive Development sweep runs one full-corpus `--collection=all` apply gate as its `visibility-gate` post-run stage, immediately after the `inferred-pi-lead-reclaim` stage so the gate judges the leads that stage links in the same sweep (#3741).
The gate keeps search consistent itself (issue #1958): `applyStudentVisibilityGatePlans` re-syncs entities to Meilisearch so the index reflects the freshly applied tiers without waiting for a separate rebuild, in addition to the sweep's explicit `search-rebuild` stage.
That sync is keyed on a read of the index rather than on the plan's changed flag (#3049).
After the corpus write the gate projects the indexed `studentVisibilityTier` for every planned row and syncs the materially-changed rows plus every row the index disagrees with, so a sync that failed during a Meilisearch outage is repaired by the next run instead of being invisible to it: a plan that has already been written is no longer materially changed, so the old plan-keyed arm had nothing left to push and reported a clean `changed: 0` over a permanently stale index.
Both modes report an `index` block. `divergentTierRecordIds` is the drift the run found, `unsyncedRecordIds` is the rows the index refused, `missingFromIndex` counts planned rows the index does not hold at all, and `indexReadFailed` says the probe could not run.
A row missing from the index is counted rather than synced, because pushing the corpus at an empty index would make a gate apply a partial rebuild and a mis-set `MEILISEARCH_INDEX_PREFIX` would send it to a phantom index; use `meili:rebuild-research-entities` for that.
An apply that leaves the index unrepaired prints its report and then exits non-zero. Standalone manual materialize writes require `--confirm-materialize` in addition to the existing scraper environment write guards; use `--dry-run --output <path>` first for review artifacts. Scheduled or manual global reconciliation should run the same command in dry-run mode first, then apply only with `--collection=all --mode=apply --confirm-student-visibility-apply --max-apply=<reviewedScannedCount>` under the existing environment write guards. For research entities, both public tiers require source-backed complete card copy plus source/lead identity quality; `limited_but_safe` means the record is usable but lacks action/access evidence, not that weak bios or sparse cards are allowed into public Beta.
The gate fails closed on an empty-roster state: once enough lead-requiring research entities are scanned and nearly all of them resolve zero canonical leads, apply is refused with an explicit blocker instead of mass-suppressing the directory, so an accidental recompute against a mid-migration empty roster cannot hide public records.
Recover by populating the canonical `Researcher` roster (re-materialize scraped sources or backfill legacy identities) and re-running the dry run before apply.
Only `runStudentVisibilityGate` enforces that guard, because `applyStudentVisibilityGatePlans` is the raw writer, so any script that plans and applies gate rows itself must evaluate `evaluateStudentVisibilityGateLeadResolution` first.
`retireAffiliatedOrgNameGrafts.ts` is such a script and does: renaming a record can add or drop a duplicate-risk suppression, so it re-gates and resyncs every record it corrects, and it reports a skipped re-gate rather than throwing once the document corrections are already durable.
Its scan is corpus-wide and the backlog it reports spans several issues at once, so `--slugs=<a,b>` scopes the WRITE to named rows while leaving the measurement whole; without it an apply landing one issue's fix silently carries every other pending row with it.
The `SHARED_HOST_ORGANIZATION` verdict is the #2360 arm: the row's name is the name of a shared academic host it cites, which the name axis cannot see (see `skills/scrapers/SKILL.md`).
The gate's own `syncEntities` call only covers records it actually wrote, so a lane that edits a roster without moving the tier, computed tier, or reasons produces no gate write and therefore no index refresh.
Such a lane has to resync itself: `retireForeignLeadGrafts.ts` re-reads its corrected entities and calls `syncEntities` after its re-gate, while `role-assignments:retire-surname-clash-lead-grafts` (#2768) does not, so a lead it detaches can still match the index `leadProfessorNames` and `professorNames` until the next rebuild.
`researchers:dedupe-accountless-shells` edits a roster too, by folding a person shell into the record that outranks it and moving or archiving that shell's role edges, and it did not re-gate at all: a row it changed kept a tier and a search document describing a roster it no longer had (#2952).
It now re-gates every entity whose roster it edited, reporting `rosterChangedEntities` and `regatedEntities` alongside the merge counts, and the gate's own apply path resyncs the records it writes.
That matters most where the fold strengthens a lead rather than removing one: the surviving record can carry a netid the shell did not, which is a different answer to the gate's lead question than the one the stored verdict was computed from.

`yarn --cwd server research-entity:backfill-lab-branded-name-type` is the other name-correcting lane and it both asserts and retracts (#2446).
It is dry-run by default and apply mode requires `--confirm-lab-branded-name-type`; the destructive half retires that source's `name` and `displayName` observations and clears a grafted `displayName` on rows the product is already serving, so read a dry-run report before every apply.
It re-materializes and resyncs the rows it corrects but does not gate them, so run `student-visibility:gate` afterwards and read the tier change from that dry-run, because `entityType` and `name` both decide the gate cohort.
`server/src/scripts/labBrandedNameTypeBackfillCore.ts` is the source of truth for which page provenance types a row up, which retracts its brand, and which is held for review; do not restate those rules here.

Beta repair is dry-run-first through `yarn --cwd server beta:repair-queue --mode=dry-run --collection=all --output <artifact>`, then apply mode must use `--apply-from <artifact> --confirm-beta-repair-queue-apply` after reviewing the fresh Beta artifact.
Source-description repair fails closed when an exact `https://medicine.yale.edu/lab/<slug>` URL, with an optional trailing slash, belongs to another active research entity: it reports `official_source_url_collision`, applies no patch, and does not use that URL as description evidence until ownership is resolved.
The same reviewed-artifact workflow supports Development repairs when the dry-run artifact and guarded database target are both Development.
Development artifacts cannot be applied to Beta, Beta artifacts cannot be applied to Development, and production repair-queue apply remains unsupported.
The repair runner plans ordered lanes from blocker reasons: source/description first, PI identity second, and action evidence third.
Only deterministic source-backed patches are applied automatically.
Repair code must block archived research entities before PI member or access-signal upserts; archived duplicates should be repaired through the guarded member/artifact cleanup scripts instead.
Same-PI duplicate research homes are consolidated through the guarded dry-run, review, and apply workflow in [`research-entity-pi-dedupe-runbook.md`](research-entity-pi-dedupe-runbook.md).
PI identity conflicts, same-name risks, suppression decisions, and unsupported action-evidence gaps remain queued as exceptions instead of being guessed into student-visible data.

Repair-queue yield alone cannot say whether a withheld row has anything to repair with, so read it against `yarn --cwd server visibility:recoverability`.
It is read-only against Mongo and writes only its report, taking no apply flag at all.
It scans the `operator_review` and `suppressed` tiers and sorts every scanned record into one of four buckets: `regate` (never gated), `materialize` (a live observation carries the blocked value and the document does not), `acquire` (nothing observed, but a citable source URL remains to crawl), and `ceiling` (a decision blocker, an unmodelled hold, or no evidence and no source).
It accepts `--tier=<withheld tier>` (repeatable, rejects public and unknown tiers), `--limit=<n>`, `--examples=<n>`, and `--output=<path>` for a JSON artifact.
`server/src/scripts/visibilityRecoverabilityAuditCore.ts` is the source of truth for what each bucket means and why a record takes its WORST blocker rather than its best; do not restate those rules here.
The `regate` bucket turns on `hasRecordedGateVerdict`, which reads `studentVisibilityEvaluatedAt` and falls back to `studentVisibilityComputedAt`, because the latter only moves on a material change and so cannot tell a row the gate re-decided and left alone from a row it has never reached (issue #2604).
Both readers go through that one helper rather than restating the predicate, and it keeps the audit script's `reasons.length > 0` fallback as a last resort, because only the gate and the repair scripts carrying its verdict forward write reasons, so a row holding them has been decided even when neither stamp survived.
The fallback was measured inert on Development, where all 1,171 rows carrying no `studentVisibilityComputedAt` are archived and every one of the 4,744 live rows carries it, but nothing in the code enforces that, so calling such a row never-gated would queue a re-gate it has already had.
The gate writes `studentVisibilityEvaluatedAt` on every row it decides, in both apply paths, so a re-gate is verifiable from the run that stamped it forward rather than retroactively.
Both paths compose that write through one helper in `server/src/services/studentVisibilityGateService.ts`, so the rule that a re-decided unchanged row records only the evaluation stamp cannot hold on one path and not the other.
For a row the gate re-decided and left unchanged, that stamp is deliberately carried in its own bulk-write op rather than folded into the visibility update, because the Meili resync is keyed on the ops that change what a student sees and folding it in would resync the whole evaluated scope on every gate run.
Those standalone stamp ops pass `timestamps: false`, because the row did not change and bumping `updatedAt` across the whole evaluated scope would desynchronize the indexed copy of that field from Mongo and collapse the materializer's duplicate-title tiebreak into a single instant.
A materially changed row needs no separate op: its stamp rides along in the visibility update, which is already in the resync-keyed set and does mean to bump `updatedAt`.

Formalization-only programs are deliberately capped. Fellowship funding, research travel grants, senior thesis funding, and secure-mentor-before-apply funding rows can be useful after a student has a research home, but they are not entry pathways by themselves. The visibility gate marks these records with `formalization_only`, keeps them out of `student_ready`, and routes them to exception review rather than source-description auto-repair unless evidence shows mentor matching, project placement, an internship, an RA program, or another real entry route.

Program audience is an honest label, not a suppression trigger. A graduate-only research program (derived audience `GRADUATE`) is a legitimate record: the gate records `graduate_relevant`, lets it reach the same tiers as an undergraduate-relevant program when it has a real non-portal official source and an application route, and surfaces it with a Graduate label rather than hiding it.

The audience is derived, never stored (#4088).
`programAudience` in `server/src/services/programAudience.ts` is its single owner and returns `UNDERGRADUATE`, `UNDERGRADUATE_AND_GRADUATE`, `GRADUATE`, or null.
The source's `yearOfStudy` facet decides whenever it names a class of student, and the stored `undergraduateOnly` and `yaleCollegeOnly` booleans are only the fallback for a row whose source lists no year.
A boolean cannot say "open to undergraduate and graduate applicants", so before this every program in that state was stored as one of two false claims: on Development 22 of 128 served programs stored `undergraduateOnly: true` beside a year list that names graduate students, and 1 stored it beside graduate years only.
Both public serializers and the admin payloads serve the derived value as `audience`, and the client's Graduate badge, the detail modal's Audience line and the eligibility Level line read only that field, so they cannot disagree with the gate.
The "Yale College students only" line is shown only when the audience is `UNDERGRADUATE`, because a year list naming graduate students contradicts it.
The served `audience` is serve-time, but the gate verdict is stored: `studentVisibilityTier` and `studentVisibilityReasons` change only when the gate reruns.
So a change to the derivation is a stored-data change, done once `yarn --cwd server student-visibility:gate --collection=programs --apply --confirm-student-visibility-apply --max-apply=<n>` has run against Development and the served programs have been re-read.
Two classes of row move on that run: a row with neither boolean whose `yearOfStudy` names a class of student, whose audience becomes known and which can leave `operator_review`; and a row stored with `undergraduateOnly: true` beside graduate years only, whose recorded reason becomes `graduate_relevant`.
Only catalog and administrative program pages (`not_undergraduate_relevant`), non-research programs (`non_research_program`), and redundant copies of a fund (`duplicate_program`) stay `suppressed`. This applies to programs and fellowships only; research entities are never suppressed on undergraduate-relevance grounds.

The programs gate also serves one row per fund (`server/src/services/programDuplicateIdentity.ts`, #3988).
A CommunityForce fund page is reached through an encrypted query that differs from link to link, so one fund can carry several FundDetails URLs, and two lanes, or one lane twice, can mint a row for each.
Two live rows are one fund when their titles match once case, punctuation, an ampersand, apostrophes and a leading "The" are set aside, and their descriptions match: identical at 80 characters or more, or with at least 80% of the shorter description's five-word phrases found in the longer one, because one lane stores the fund's own paragraph and another the page around it.
Neither half is enough alone: distinct funds share titles, and each residential college's copy of a fund shares one description word for word, differing only in the college its title names.
Two live rows are also one fund when they cite the same record-specific FundDetails page (`recordSpecificApplicationPortalIdentity` over `sourceUrl`, `applicationLink` and `links`) and their titles agree: the same title key, or one key containing the other once parenthetical text is removed (#4289).
That rule only joins rows whose fund page is equal and never splits rows whose pages differ, so the per-link encryption above cannot mislead it; the title check stays because a catalog page can give one fund another fund's link, and because a common application is one FundDetails page that several funds cite.
The gate keeps the Yale fellowship database's copy (`student-grants-database`) whenever the fund has one (owner decision, #4289), then the copy most fit to serve on its own, then the oldest, and suppresses the others with `duplicate_program`.
The verdict is recomputed over every live program on each gate run, including a run scoped to some records, so it writes no field and needs no lock.
Applied on Development on 2026-10-01 with exact titles and descriptions it removed 3 funds served twice; the tolerant comparison found 17 redundant copies and removed 7 more, taking served programs from 145 to 138, with no fund left without a served copy.

What counts as a research program is decided by `classifyProgramResearchRelevance` in `server/src/services/programResearchRelevance.ts`.
When a record carries the source catalog's purpose facet (Research, Study, Travel, Service, and the rest), the facet is the authority: the record is research-related only when a purpose is research, a senior project or dissertation support, its own title names research, its kind is research by construction (senior thesis funding, an RA program, mentor matching, a summer research program), or its own prose says the award funds research or is for students pursuing research careers (#3904).
The derived `studentFacingCategory` is never read as evidence there, because a label such as "Research travel funding" is the classifier's output rather than the source's statement, and reading it let study, service, internship and postgraduate awards reach `/programs`.
A record without the facet keeps the text rule.
A structured program whose own prose names faculty mentorship is research-related whatever its facet or wording says, because a mentored pathway is a student's way into research even when its page never uses the word (product decision, 2026-09-30).
This replaced an exemption keyed on a `STARS` title or `/stars/` source URL, so the rule now covers any program of that shape rather than one named family.

`programClassifier.classifyProgram` holds the other half of that rule (issue #1926), because `studentFacingCategory` is stored rather than recomputed at serve time and `Archive / review` is a hard block on both public tiers. A graduate or professional audience alone therefore no longer routes a record to `Archive / review`: when `classifyProgramResearchRelevance` says the record is research-shaped it gets an honest graduate category (`Graduate research assistantship`, `Graduate research travel funding`, `Graduate collections research fellowship`, or `Graduate research funding`) with a matching `entryMode`, `undergraduateOnly: false` so the derived audience is `GRADUATE` and the Graduate label renders when the source lists no year of study, and a `bestNextStep` that opens with the eligibility check. Only a graduate record with no research dimension, or one whose stated audience is researchers outside Yale, stays `Archive / review`.

### Program classification is a projection derivation

A fellowship's classification is derived in the projection on every resolve, never observed (#3904).
`planFellowshipClassification` in `server/src/scrapers/fellowshipClassificationDerivation.ts` runs `classifyProgram` over the facts the pass is about to leave standing (title, competition type, summary, description, application information, eligibility, additional information, source URL, purpose, and term of award) and stages the result.
No lane emits a classifier field any more, so a stale classifier observation still in the log is inert for the fields the classifier owns: the derivation overwrites whatever the resolver picked for `programCategory`, `programKind`, `programRole`, `entryMode`, `studentFacingCategory`, `requiresMentorBeforeApply`, `mentorMatching`, `bestNextStep`, and `prepSteps`.
The derivation skips a field named in `manuallyLockedFields`.
`programRole` is always recomputed from the `programKind` the row keeps, so a locked kind still yields a matching role.
Run it twice and the second pass plans nothing, which is what makes it a derivation rather than a repair, and a classifier fix reaches every row on its next materialize without a re-scrape.

It replaced `programs:backfill-classification`, a post-sweep repair that re-ran the classifier over stored rows but refused any apply that would demote a served row or replace a served `studentFacingCategory`.
Those refusals were right about the classifier and wrong as a mechanism: measured on Development on 2026-09-29 they had frozen 100 of 459 live rows on a label today's classifier no longer produces, including 12 served travel and research awards still labelled `Internship program` after the #2925 classifier fix meant to remove that label.

Two lessons from that script carry over into the derivation.
An omission is silence rather than a retraction (#2910): the classifier asserts `undergraduateOnly`, `yaleCollegeOnly`, `compensationSummary`, `hoursPerWeek`, and `programDates` only when it has something to say, so an omitted value keeps whatever the pass would otherwise leave standing.
Clearing on silence used to cost 77 rows their `student_ready` tier by dropping them out of the gate's `audienceKnown` branch.
The logistics fields are mostly not classifier output either: on Development 316 rows store a `compensationSummary` while 23 live observations assert one, so clearing them on silence would erase curated award amounts and dates from 75 served cards.
A classifier change is measured before it lands, not after: project every live row through `planFellowshipClassification` and the real `computeProgramStudentVisibility`, and read the tier moves and the served category rewrites.
For #3904 that projection moved no served row out of `student_ready` apart from one multi-award hub page, and it surfaced the rule bugs the frozen labels had hidden, which are now pinned as the "frozen Development misreadings" cases in `server/src/services/__tests__/programClassifier.test.ts`: a senior rule that only read titles, an `ra\b` pattern that read any word ending in "ra" as a research-assistant program, a travel rule that counted study and public-service awards as research travel, and STARS and Bouchet records read as generic funding.
The `purpose` facet is a list of permitted uses, so a statement about who an award is for comes from the record's prose rather than from that facet.

The classifier's internship branch also read the wrong evidence (#2925).
`purpose` is a multi-select of permitted uses on the source record, so an `Internship/Work Project` entry sits beside `Research` and `Senior Research Project or Senior Essay` on the same award, and the flattened record text made the late `internship` branch claim any funding award that merely permits an internship.
That branch now requires the record to name an internship in its own title, competition type, or source URL, and it declines when the title names a funding instrument (`fellowship`, `grant`, `fund`, `award`, `scholarship`, `prize`, `stipend`), because an award that may fund an internship is not an internship program.
On Development this moved the served rows the classifier calls `Internship program` from 28 to 2, and the 2 survivors are the records whose titles are internships rather than awards.
The same branch used to file every internship as `CENTER_INTERNSHIP`, including one a department publishes on its own undergraduate-study page (#4089).
It now reads the source URL first: an internship whose source path carries a `departments` or `undergraduate-study` segment is a department program (`RECURRING_PROGRAM` / `STRUCTURED_PROGRAM`), and only the rest keep the center kind.
`studentFacingCategory` stays `Internship program` either way, so the change is visible only in the `/programs` category and kind facets.
On Development it moved 1 of the 3 served `CENTER_INTERNSHIP` programs, the one whose source is a department page, and no other live row.

Deterministic card-copy repair is cleanup, not the launch-clearing loop. It may derive missing cards from source-backed descriptions, including official-profile prose such as `research is centered on`, `interests include`, `studies ... focusing on`, and `our work focuses on`, but rows with missing PI/action evidence or only directory/listing/grant/publication sources must be enriched from better official entity/profile pages before promotion. Do not use Cancer, WTI, Economics, English, department, or center listing pages, NIH/NSF award text, ORCID works, paper abstracts, DOI metadata, dataset records, source chrome, or teaching/course-only profile biographies as public research descriptions. Course titles such as `Writing about...` are not scholarship evidence unless surrounding prose explicitly describes the person's research, writing, curatorial, or field-focused scholarly work.

Search indexes `shortDescription` and `fullDescription`, so their quality is a first-order discovery lever. `yarn --cwd server research-homes:backfill-descriptions` has several lanes. The default deterministic short-description lane scans active research entities and, for every entity whose short is empty, equal to the full, or not a genuine distinct summary, derives a distinct short from the full via the shared `deriveShortDescriptionFromFullDescription` core (the same derivation the materializer applies, reused without changing it). It never fabricates or persists a short equal to the full, reports a before/after quality scorecard plus duplicate/templated full-description groups, and leaves thin or empty full descriptions as a re-scrape follow-up rather than inventing them. It is dry-run-first; apply requires `--confirm-short-descriptions` and is blocked against production unless `CONFIRM_PROD_SCRAPE=true`. The `--llm-rewrite` lane is the grounded LLM rewrite of description-blocked bios and stays gated behind `--confirm-research-descriptions` plus an explicit `--limit`. The `--llm-synthesis` lane reuses the repository's existing OpenAI chat-completions integration (gpt-5-mini, JSON output, contact redaction) to synthesize a clean short and full from the best available stored source text. Its prompt is entity-type-aware: for lab, center, institute, program, or project entities it describes what the research home studies rather than the PI biography, while for faculty-research-area and other person entities it describes that individual's research and drops the administrative CV framing. Output must be grounded in the source, pass the description quality bar, and classify as genuine research prose or it is rejected. A corpus run requires an explicit `--limit` to bound generation; a run scoped by one or more `--record-id=` is authoritative over that claimed set and processes every candidate in it without a `--limit`, which is what makes the lane usable as a single-writer, class-scoped repair tool. A scoped run also accounts for its claimed set: `claimedScope.unprocessed` names every claimed record id that produced no processed row and why (`absent-or-archived`, `not-a-candidate`, or `beyond-limit`), so an operator reading `updated` can reconcile it against the ids they passed instead of trusting a bare counter. Apply also requires `--confirm-llm-synthesis`, and writes durable `fullDescription` and `shortDescription` observations under `lab-microsite-description-llm` carrying the same sanitized pair the entity fields receive, so a later re-materialize resolves the synthesized prose rather than blanking it back to thin; apply fails closed when that source row is absent, because a bare field write is exactly the non-durable case. A row also fails closed, counted under `skipped`, when either description sanitizer collapses the accepted output to empty (`sanitized-empty`, applied in dry-run too so the projection matches an apply) or the observation store's own write-time prose guards drop either observation (`observation-dropped`), so a counted `updated` always means a field write backed by durable evidence rather than the bare write this lane exists to eliminate. It reports a token/cost projection from real usage plus before/after samples of the sanitized text that actually lands. The `--card-synthesis` lane (issue #557) targets the `missing_card_description` cohort - entities that already carry a genuine source-backed full description but no shippable one-line card - and resolves a card by trying the deterministic `deriveShortDescriptionFromFullDescription` first and, only when that returns nothing, a grounded LLM synthesis that condenses the entity's own full description into one sentence gated by a content-word grounding check plus the existing `shortDescriptionQuality` bar. The card quality bar is never relaxed and synthesis fails closed (returns empty) when not grounded or not quality-passing, so existing good cards are unchanged and only the empty-derivation gap is filled. It reports cards gained and how many would promote to `student_ready` (fresh visibility-gate reasons leave `missing_card_description` as the sole blocking reason via the canonical `isBlockingVisibilityReason` filter, so positive evidence reasons do not count against promotion); apply writes durable `shortDescription` observations plus the entity field, requires `--confirm-card-synthesis` plus an explicit `--limit`, and is production blocked. Scrape-time extraction of the lab-page description block is entity-type-aware in the same spirit (see the `lab-microsite-description-llm` notes below), so the research-home research prose is preferred over the stored PI bio.

For action-evidence repair, official deterministic department undergraduate research pages are the first repair lane before targeted LLM extraction. The `department-undergrad-research` source emits program records that materialize into `Fellowship` records on `/programs` (never a `PROGRAM` research entity, which no longer exists) plus undergraduate access evidence and guarded contact/application-route observations when the page itself supports them; generic guidance pages must not be materialized as active access `Signal` rows. Its per-faculty `physics-project-list` parser still yields `LAB` `ResearchEntity` evidence but no configured page uses it, so a run of this source produces no research entities. A page whose fetch or parse fails is skipped and recorded as a failed attempt in the run's `fetchMetrics` so the rest of the department pages still land, and the run fails only when every attempted page fails.

Research-entity observations that a program source wrote before it switched to `Fellowship` are never superseded, so the materializer reads a set whose winning `entityType` is the retired `PROGRAM` as a program rather than as a research entity (#3746).
When a live `Fellowship` carries the same key as its `sourceKey`, the program already lives on `/programs`: the materializer mints nothing for that key, and archives an existing research row under it with the `materialize:program-lives-on-programs` attribution and removes it from search.
The answer is re-derived on every materialize, so a second run is a no-op and no field is locked.
A row whose program has no live `Fellowship` is left live, because archiving it would remove the only record of that program.
The #2206 heal still re-types a `PROGRAM` assertion from a research-structure `kind`, but a `program` kind confirms the retired type and heals nothing.

Faculty profile data should prefer official department profile evidence before publication-derived or same-name signals. Department roster/profile scrapes emit official profile URL, image, title, email, and bio observations, but Yale email observations must be person-specific for the profile name; reject generic contacts and wrong-person page emails even when the email is on a Yale-controlled page. Yale Medicine profile extraction must prefer the explicit `Biography` section, then explicit Research `Overview` text, over patient cards, page chrome, contact paragraphs, appointment-only copy, office addresses, course listings, publication-link text, citation metrics, center/program labels, credential-only education lists, leading author-list publication entries, or article headlines. Public profile shaping hides those non-biographical snippets, metric topics, and h-index values when no supported research identity or explicit interests back them, clips long public bios at a sentence boundary, expands clean official `Research Areas`/`Fields of Interest` snippets into readable source-attributed bios, can use official profile `researchInterests` arrays as a presentation-only source-attributed fallback when stored prose is empty or appointment-only, and accepts legitimate Yale profile URL variants such as compact compound surnames, first-name-prefix slugs, short same-person given-name slugs, explicit-first-initial slugs, or standalone first-initial slugs. A Yale profile URL that still fails name matching may stop suppressing the bio only when the stored bio starts with the exact current professor name, when it starts with first name + middle initial(s) + last name, or when title-stripped official bio prose starts with a verified multi-token given-name variant plus the stored last name; keep hiding the mismatched URL itself unless the URL independently matches the person. When a personal bio is still empty, public profile shaping may derive a presentation-only fallback from trusted membership-backed research homes only if the person is a lead of a concrete non-individual home with its own non-profile website and useful source-backed research prose; do not materialize guessed profile-bio values from that fallback, and do not use ORCID/grant-only, individual faculty-research-area, first-person, or person-named shell summaries as biographies. Same-name contaminated profile URLs, profile bios, topics, papers, and research entities must not leak into public profiles; same-prefix or same-initial wrong-person URLs still count as contamination.

The `official-profile-pi-backfill` scraper is a targeted official Yale profile repair source. It can emit `user` identity/profile observations when canonical URL, name, Yale email/NetID, and faculty title all validate. For already-linked public professor profiles, the visible bio lane may use the known `User.netid` after canonical URL, name, faculty title, and same-person URL matching validate, so missing profile email does not block bio repair; large visible-profile batches throttle repeated profile fetches to reduce 403s from official profile hosts. That visible-bio-only lane may also read official department person pages, such as Engineering faculty-directory or department `/people/` pages, when the URL path matches the linked user's name, may fetch official `/profile/` slugs made from a multi-token given-name variant when fetched identity validation still matches the linked user, and may target weak faculty users directly when their own profile URL is a same-person official Yale profile even if no public research-home membership supplied that URL. Visible bio materialization should emit only profile enrichment fields such as bio, image, interests/topics, and ORCID, not broad identity fields like `userType`, names, titles, or profile verification. Queued PI identity, research-home, and description repair lanes remain limited to canonical official profile URLs. When a grant shell already has an attached Yale lead but no stored profile URL, the profile-description lane may generate bounded `medicine.yale.edu/profile/<first-last>/` and `ysph.yale.edu/profile/<first-last>/` candidates from the lead identity; those URLs are fetch candidates only, and observations are emitted only after the existing canonical URL, name/email, and expected-person validation passes. Expected-person validation fails closed on an email disagreement instead of falling back to a bare name-token match, and a guessed `medicine.yale.edu`/`ysph.yale.edu` profile is rejected as an entity's official-profile identity when no expected email confirms it and the entity's own recorded school/departments affirmatively rule out medicine, so a same-name medical professor's areas and website cannot graft onto an unrelated humanities or social-science entity (the same never-attach-on-name-alone invariant as #562, applied at the research-area/website official-profile-identity step, issue #585). It can also use official profile bio text for bounded source-description repair, expand terse official research-interest snippets into readable source-attributed user bios, and use an attached lead member's official profile to emit same-entity `ResearchEntity` name/type/website/source observations when person-scoped JSON-LD affiliations or profile-body links show a leadership-backed lab, center, institute, program, or initiative. The extracted research-home name is truncated to its head-noun phrase, dropping a trailing description clause that begins right after a `Lab`/`Center`/`Institute`/`Program`-style head noun with a pronoun, article, or study/investigate/develop-style verb, so linked-lab prose can no longer glue a first description sentence onto the name; legitimate multi-word names such as `Center for Molecular Biology` and `Institute of Sacred Music` are preserved because only clause-starters are cut, never connectives like `for`/`of`/`on`/`in`/`and` (#624). It must reject profile chrome, navigation-panel links, broad department/org labels, generic institutional centers, parent organizations named only through subarea leadership, and outside-Yale/deputy-director affiliations as automatic research-home replacements. Directory news/card titles, appointment labels, degree/education credential lines, generic voluntary-faculty boilerplate, single-study clinical-trial abstracts, publication-count blurbs, Google Scholar/link prompts, broad MeSH/taxonomy buckets, and generic field headings must not be converted into profile bios, research-interest observations, topics, or title evidence; standalone noun `research` is too broad to validate a faculty title without a real role phrase. The source-url website lane must also reject scholarly or social directory hosts such as Academia.edu and ISPU scholar listings as direct research-home websites. A named Google Sites lab or personal academic site (`sites.google.com/view/<lab>`, `sites.google.com/site/<name>`, or a domain-scoped `sites.google.com/<org>/<name>` path) is a genuine research home and is preferred over a faculty-directory or `/profile/` stub for the primary `websiteUrl`, while a bare `sites.google.com` host with no named site stays rejected (#537). The materializer and public profile shaper must ignore active official-profile bio observations that are known non-bio snippets, including credential-only education lists, leading author-list or single-citation publication entries, appointment-only title lists, grant/project metadata blocks, clinical-profile calls to action, email-bearing contact text, external scholar-profile callouts such as `Google Scholar profile`, profile CTA text such as `Watch a video` or `Learn more about Dr...`, and trailing or glued `Last Updated` metadata, so stale address/title/news/citation/contact observations cannot beat later source-backed values. When otherwise useful official profile prose contains contact chrome, strip inline email parentheticals and leading `Email:`/`Phone:` header blocks before observation emission; if contact text remains, reject the bio or fall back to source-attributed official interests instead of exposing emails or phone numbers. Long official bios should clip at real sentence boundaries without cutting at dangling honorific abbreviations such as `Dr.` or `Prof.`. This lets NIH-style PI shells such as `Albert Sinusas Lab` resolve to a real research home like Yale Translational Research Imaging Center when the official profile and center page support it. It must not emit access/action evidence, research membership, department/org labels, or contact observations from profile chrome alone.

For queued PI repair, official-profile identity fallback may create a missing Yale user only when the page itself validates as the same canonical Yale profile, exposes a person-specific `@yale.edu` email, has a matching display name, and carries a supported research/faculty/director title. In that case the scraper emits `user` observations keyed by the email local part and an `inferredPiUserKey` observation; the materializer creates or enriches the user first, then resolves the key into a PI member. Keep this path bounded to real profile/person pages: lab, center, institute, initiative, research-home, and broad directory URLs must not be treated as profile candidates.

For stale official profile URLs, fix deterministic upstream URL patterns before broad backfill. The visible-bio lane canonicalizes the confirmed Sociology migration from `sociology.yale.edu/people/<slug>` to `sociology.yale.edu/profile/<slug>/`, and profile fetches try the preferred official candidate first, then same-person validated alternates instead of letting one 404 block the whole target. Bio observations must still pass quality gates: do not emit short topic fragments or semicolon-delimited topic lists as a stored profile bio, even from official profile pages.
A department site is also the authority on its own person-page path, so a stored `YALE_OFFICIAL` link is not append-only: `materializeUserIdentityToResearcher` replaces it when the freshly composed official link supersedes it per `supersedesOfficialProfileUrl` (`scripts/backfillResearcherOfficialProfileLinksCore.ts`), which accepts a move only on the same host and only onto that site's canonical CMS profile page (`/profile/<slug>`, or `/<section>/profile/<slug>` on the sites that nest it), never the reverse and never across hosts, so two roster pages cannot overwrite each other's link every sweep (#2282).
Links already frozen at a dead directory path need no separate repair pass: the same materializer replacement reaches them on the next sweep, from that researcher's own active `user` `profileUrls` observations under `materializationReadScopeFilter()`, matched by netid (`Researcher.identifiers.netid`, else the linked `Account.netid`).
The replacement is a URL observed verbatim rather than a synthesized twin, because Yale paths are case-sensitive and a rewritten guess could 404 the same way; a researcher with no matchable netid is left alone rather than repaired from another person's same-slug page (#468).
`researchers:repair-superseded-official-profile-links` performed exactly this and was retired in #2653 once it reported `considered 4517, repairable 0`; the behaviour is pinned at the engine by `scrapers/__tests__/officialProfileLinkSupersedeEngineProbe.integration.test.ts`, which carries its refusal cases over.
Neither the materializer lane nor a fresh scrape proves a stored link still resolves, so `yarn --cwd server researchers:verify-official-profile-links` probes them: it groups every non-archived researcher's `YALE_OFFICIAL` link by department host, walks each host's links serially with bounded cross-host concurrency (`--host-concurrency`, default 4) so one department is never hammered, and takes `--host <department host>` to scope a run to one site (#2292).
It is dry-run-first; apply requires `--apply --confirm-profile-link-verification` plus an explicit `--limit` on top of the shared script apply guard, and `--output <path>` writes the full per-link report because the summary printed to stdout carries only counts and the per-department roll-up.
Its observed replacement candidates are pooled per department host from active `user` `profileUrls` observations under `materializationReadScopeFilter()`, for the same reason the netid-matched lane uses that filter: a superseded or rollback-retired observation is no longer evidence that the site publishes that page.
[research-model.md](research-model.md) owns which probe verdicts settle a link and what a proved-dead link does at serve time.

That verifier now runs unattended as the `profile-link-health` post-run sweep stage, beside the `source-link-health` stage that does the same job for research-entity links (#3222).
It passes `--stale-after-days=30`, matching `SOURCE_LINK_HEALTH_FRESHNESS_DAYS` so the two halves of the served surface agree about how old a stored verdict may be, and that flag is what makes the stage resumable: the candidate list is the head of a stable read order with no skip, so without it a run that dies partway re-probes the same links next sweep and the tail is permanently unreachable rather than merely sampled.
Read the window as "recent AND decisively judged", not as age alone.
A link probed yesterday that came back 403 carries a fresh `verifiedAt` and a stored `UNKNOWN`, which is the absence of a verdict, so age-only reasoning parked exactly the population the stage exists to drain: a 30-day window on the largest host reported 0 links due while 439 links corpus-wide held no decisive status at all.
Until it did, nothing re-probed a profile link at all, and `canonicalProfileLinkUrl` withholds a link only when its stored `healthStatus` is `UNAVAILABLE` - correctly failing open on an unprobed one, which is why the probe has to actually run.
Measured before the stage existed: 3 served rows linked students to a profile that answers 404, two of them recorded `HEALTHY` three weeks earlier, and 416 of the 3,463 links held by leads of served rows had never been probed at all, so 12% of the served surface was fail-open by default rather than by verdict.
The serve-time half was never wrong: of the 7 live-dead links, the 4 recorded `UNAVAILABLE` were withheld and 0 live links were wrongly withheld.
The stage is safe to run unattended against a host as large as `medicine.yale.edu`, which carries most of the corpus, because `settledHealthStatusFor` writes only a decisive verdict: a 403 or a 5xx is retried and then left alone rather than recorded, so a run that draws a WAF block partway through cannot un-retire a link an earlier probe already judged.
A 404 here is a dead link and nothing more - it is never read as a departure, because a removed URL is equally a renamed one, which is the rule `classifyYaleProfilePersonPresence` encodes by treating every non-2xx as indeterminate.

Both of those lanes write only `Researcher.profileLinks`, and that is not the field the detail page renders.
`ResearchEntity.sourceUrls` carries the entity's own citations and the Sources section reads it, so a repaired researcher link left the entity still citing the dead directory path: for one lab the served payload simultaneously carried a correct `/profile/<slug>` on the member and a 404 `/people/<slug>/` in `sourceUrls` and on an access `Signal` (#2522).
`yarn --cwd server sources:repair-superseded-entity-source-urls` repairs that field, dry-run first; apply requires `--apply --confirm-entity-source-url-repair` plus an explicit `--limit` on top of the shared script apply guard, and `--host` / `--slug` scope a run.
It reuses the probe semantics of the researcher lane rather than restating them, so only a `404`/`410` licenses a replacement and only a `HEALTHY`/`REDIRECTED` candidate is adopted; a 403 or 5xx settles nothing, because a bot-blocked probe would otherwise retire a working citation.

Two constraints decide which citations it may touch, and neither is sufficient alone.
`personPageNameTokensFromUrl` must recognize the stored URL as a person page, which keeps out a lab page and a directory row that merely end in a person-shaped slug (`/lab/<slug>/`, `/directory/faculty/<slug>`).
`profileSlugNamesPerson` must then tie that slug to a name the entity can actually claim - a current PI/director lead, else the entity's own name - so an entity that can name nobody repairs nothing.
Without the second constraint a same-host, same-slug match re-pointed one entity's lab citation at an unrelated person's profile, which is the #468 same-slug failure in a new field.

An apostrophe in a surname is elided rather than split, because Yale's own slugs elide it (`O'Example` is published at `/profile/robin-oexample`).
Splitting on it produced `o` + `example`, whose surname token matched no slug, so every apostrophe surname silently failed `profileSlugNamesPerson` and was unrepairable by any of these lanes.

Only two signal citations are ever re-pointed: the `IDENTIFIED_FACULTY_LEAD` and `ORGANIZATIONAL_HOME` ways-in derivations.
Their excerpts are synthesized boilerplate that quotes nothing, so the citation is a pointer to the page whose existence is the claim, and re-pointing it at the same person's page at its current path preserves the claim exactly.
Every other signal quotes the page it cites, so re-pointing one would assert we read a page we never fetched; those are left alone even when their citation is dead.

The materializer closes the loop so a repair is not undone on the next pass.
The #613 lead-profile projection only ever appended, so `withoutSupersededProfileSourceUrls` now also retires the same person's superseded sibling citation on that host, gated on both `supersedesOfficialProfileUrl` and person-token equality - the supersession rule reasons about host and path shape only, so on a center citing several colleagues on one departmental host a projected lead profile would otherwise retire every colleague's citation too.
Dropping the superseded citation is not enough on its own, because the retired path is still the immutable provenance of a live observation; the projections also refuse to re-mint it, as described above under `sourceUrls` promotion (issue #2567).

None of those lanes asks whether a live link names the right person, so a record bound to a same-surname colleague's page keeps serving it: `yarn --cwd server researchers:repoint-wrong-person-official-profile-links` is the repair for that (#2989), dry-run first, with apply requiring `--confirm-repoint-wrong-person-official-profile-links` on top of the shared script apply guard.
A bind-time guard is not the fix here, because the arbitration it would need did not exist when the link was minted: the record for the person the page names was created later, so the graft was unarbitrable at the moment it was written and only a later pass over the corpus can see it.
`skills/scrapers/SKILL.md` owns why the repair needs both halves of its arbitration and what its false-negative cohort is.

A promotion can regress a served field even when every scraper and materializer is correct, because a mirror replaces whole documents instead of merging fields: the Development-to-Beta mirror cleared 27 dead served `websiteUrl`s and introduced 3 (#2583).
`yarn --cwd server sources:repair-promotion-regressed-website-urls` repairs those three rows from an explicit per-row decision table, dry-run first; apply requires `--apply --confirm-website-url-repair` on top of the shared script apply guard, and `--output <path>` writes the full plan.
It is safe to re-run because it settles nothing on assumption: it probes each URL live rather than trusting the stored `sourceLinkHealth`, restores only a value that probes decisively live and that the row already cites, clears only a value that probes decisively dead, and treats a 403, 429, 5xx, timeout, or SSRF false positive as settling neither.
Every row it writes also locks `websiteUrl` in `manuallyLockedFields`, because the canonical derivation would otherwise undo the write on the next materialization; `skills/scrapers/SKILL.md` owns why each of the three rows was decided the way it was.
It records that lock as an `engine_gap_workaround` in `fieldLockProvenance`, so a later engine improvement can re-open it without touching a lock an operator applied deliberately (#2612).
Merging the script changes nothing a student sees, so #2583 stays open until the operation has run in every environment that serves students and the served rows have been re-read.

Action-evidence repair must prefer official/profile-quality entity source URLs over grant, identifier, or ORCID provenance when creating low-confidence exploratory outreach artifacts. Grant-member provenance can identify a funding relationship, but it should not be the public next-step URL once an official Yale profile or research-home source has been materialized.

When no official profile bio exists, trusted personal or lab homepages may support reviewed user-bio backfill only when the page contains person-specific narrative evidence. Keep this as a guarded review lane unless a deterministic extractor can prove identity and narrative quality. Do not synthesize a stored profile bio from WTI-style roster pages, contact pages, generic lab slogans, title-only pages, person-named shells, or pages where the only evidence is a broad research-home summary.

Explicit `View Lab Website` links on official Yale profiles are a stronger research-home signal than broad profile affiliations. This path may accept a non-Yale lab domain when the official profile card itself labels the target as a lab website; the materialized lab name should use the profile person's name plus `Lab`, with credential suffixes such as `PhD` stripped. These lab-card links still must not be confused with profile chrome, academic-publication concept links, social/profile services, or broader center/department pages.

The department-roster scraper no longer extracts official-profile publications or linked publication lists, and the entity materializer ignores historical `officialProfilePublications` observations instead of creating `research_scholarly_links`.
The standalone official-profile publication-pointer repair command is also retired.
Paper Observation materialization and the `Paper` and `PaperAuthor` models and their readers are fully retired, with no rollback opt-in.
Historical `paper` observations are retained as read-only archived evidence and are never materialized.
Stored observations and scholarly sidecars remain available only for the human-gated `papers`/`paper_authors` collection-drop step in issue #207.

Description extraction should follow newly discovered official research-home websites before falling back to older profile/source URLs. `lab-microsite-description-llm` prefers non-profile `websiteUrl`/`website` values over profile source URLs, and non-profile official page descriptions carry higher confidence than profile-page descriptions so center/lab pages can replace biographical profile fallback copy. Profile-page extraction stays lower confidence and should not override better official research-home pages. The same non-profile microsite extraction also emits the research home's own real `name`/`displayName` at high confidence when the page states a proper or branded name, though it rejects governance/umbrella-org titles (Council, Committee, Consortium, Commission, Task Force, Working Group, Senate, Assembly, Office of, Board of) that are never a lab's own branded name so a shared center landing page cannot overwrite distinct person-lab names (#785), and the broader identity refusal it shares with every other source is enforced at the materialize, serve, and search-index choke points rather than here (see `personScopedResearchEntityNameNamesSomethingElseByUrlPath`, #2234/#2351), while the grant scrapers no longer name a lab at all: a grant record asserts that a person is funded and never that an organization exists, so the NIH, NSF, NEH, USAspending and DOE lanes have no mint arm and only enrich the existing research row the canonical resolver names (#3145, #3542, #3561, #3565). Selecting the embedded lab-page description block is entity-type-aware: for lab, center, institute, program, or project entities it picks the research home's research prose and rejects the PI biography, administrative CV, and welcome/navigation boilerplate, while for faculty-research-area and other person entities it keeps a research-focused bio; a page that offers no research-focus prose yields no description rather than materializing a stub. When the path emits a good `fullDescription` but no card, it also ships a grounded one-line `shortDescription` at ingestion (issue #557): it synthesizes a card grounded in that same full description and gated by the `shortDescriptionQuality` bar. When prose yields no groundable, quality-passing summary, the materializer falls back to a deterministic card built from the entity's own trusted `researchAreas` (oxford-joined, capped at four topics, gated on shape rather than full-description grounding), and only when no clean structured topic survives does it fail closed to no card rather than a weak one (issue #952). The same quality bar now rejects vacuous generic summaries such as `Studies the field.` unconditionally, so a bare verb-plus-generic-noun template can never win over an entity's already-populated `researchAreas`. One unreachable or broken page must be logged and skipped without aborting the remaining bounded extraction batch.

Card-copy derivation may treat later official-profile project prose as usable research evidence when the sentence itself is explicit, such as `research aimed at`, `presently working on`, or `Co-Principal Investigator on a grant`. It may also summarize narrow official lab homepage phrasing such as `lab research focus extends through diverse areas...`, `our research program uses...`, `our lab is focused on...`, `mission is to enhance...`, `working group aims to...`, or `seek to decrease...` when the source text names a concrete research method/domain. Keep these patterns narrow: the biography or appointment lead is still ignored, and the derived card should summarize the later research/project sentence rather than copying title, retirement, degree, directory chronology, book pages, teaching-only profiles, or page chrome.

Launch trust is checked with `yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --strict`.
This is a read-only contract audit over the visibility gate.
It fails launch if visible records are not launch-grade.
The report keeps its violation sample bounded to 50 rows and lists current public visibility violations before ordinary held rows so every exposed invalid record remains actionable when the held backlog is larger than the sample.
Use the returned repair lanes and commands as the fix plan, then re-run the visibility gate and contract audit.
Every returned command carries the `SCRAPER_ENV` of the environment the audit measured, so a Development audit prints Development commands and a Beta audit prints Beta commands (#3818).

YSM A-to-Z lab records use full-name PI inference when the lab name includes first-name context, such as `Ya-Chi Ho Lab`. The entity materializer converts accepted `inferredPiUserId` observations into canonical PI `RoleAssignment` rows so public detail pages and visibility computation share the same lead evidence.

Grant-source PI matching must remain conservative because award APIs are funding evidence, not official Yale profile identity evidence.
NSF PI matching requires exact last name plus an exact match on the leading given-name token, then exact last name plus first-name prefix; a bare source initial never binds to a same-initial namesake and fails closed instead (issue #562).
Matching the leading token rather than the whole given string recovers a surname particle or compound-surname part that `splitName` mis-parsed into the given field (`Frank van den Bosch`, `Oswaldo Chinchilla Mazariegos`), but it still fails closed on a differing leading token (`Charles` vs `Patrick`) or a goes-by-a-different-given-name profile (`Ann Carla` to `Carla` stays closed).
Do not match a full source given name to a different Yale first name by initial alone, such as `Leying Guan` to `Lawrence Guan`.
NIH PI matching applies the same leading-given-token rule; a lab named only after a surname (`Arnsten Lab`) never attaches a PI on the surname alone, because a shared surname can identify the wrong person, so it fails closed to ambiguity whenever any surname-compatible Yale faculty exists and to absence when none match (issue #562).

The shared canonical-home resolver distinguishes a safe absence of memberships from one canonical official home and ambiguous or ineligible memberships.
The NIH, NSF, NEH, USAspending and DOE lanes treat the safe-absence case as a counted refusal and mint nothing (#3561, #3565).
No grant scraper emits research-home observations for ambiguity, archived or grant-only candidates, or other ineligible memberships.
Canonical-home enrichment emits grant evidence without replacing official identity or source URL fields.
Ambiguous Yale user matches and archived or non-current lead memberships are ineligible, not safe absences.
At materialization, only each source's latest grant snapshot participates.
The public grant display is a recency-sorted, deduplicated union capped at ten records, while `recentGrantCount` sums the independent latest source totals without applying that display cap and funding agencies are unioned across sources.
The stored list is what the lanes read and may hold awards that have since ended, because the NIH and NSF windows admit ended awards and a stored list ages between reads.
The public DTO (`server/src/services/servedCurrentFunding.ts`) therefore re-reads each award's `endDate` on every request and serves an award as current funding only while its end day has not passed or it has no end date (#3924).
When it drops an ended award it restates `recentGrantCount` as the number of running awards it serves and keeps only the funding agencies a running award still backs; when every award has ended it serves an empty list and omits both.
It never writes the stored list, which stays the lane's evidence.

### Retired museum, collections, and digital-humanities research homes (#2202)

The museum/collections/digital-scholarship acquisition lanes were retired along with the entity types they produced.
`peabody-collections-research`, `beinecke-collections-research`, `beinecke-curatorial-units`, `yuag-curatorial-areas`, `ycba-collections-research`, `library-collections-as-data`, `dh-lab-projects`, and `course-based-research-pathways` are no longer registered scrapers or sweep sources.

Each was discovery-only by design: it emitted identity, an official-page description, and at most an `inferredDirector*` observation, and failed closed on contact data.
That design was the problem rather than a safeguard.
Because these types sat in `ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES`, an unled unit still earned an organizational `REACH_OUT_PLAUSIBLE` ways-in from its official page and reached `student_ready` carrying no lead, no roster, no affiliated-lab edge, and no contact email.
Measured on Dev, that produced 157 student-ready pages whose only student-visible action was one outbound link.

The surviving organizational types (`CENTER`, `INSTITUTE`, `INITIATIVE`, `CORE_FACILITY`) earn their place by routing to labs through `AFFILIATED_LAB` edges, which these lanes never produced.
See [research-model.md](research-model.md) for the retirement rationale and the course-credit signal direction that replaces `COURSE_SEQUENCE`.

Their `Source` rows outlived the decision, still carrying `enabled: true` and a `lastCrawledAt`, so the freshness worklist counted them as re-crawl work that nothing could perform (#2619).
All eight now sit in `RETIRED_SOURCE_NAMES` and carry the retirement marker; that list in `server/src/scrapers/sourceDispatch.ts` owns the full set of retired sources.
Retirement changes the row only; their stored observations and scrape runs stay as evidence of what they once asserted.

### Research entities minted from a support-staff profile (#3410)

A person profile mints a research entity only if its stated title owns research.
Three screens decide that, and the scrapers skill owns their separation; `isResearchSupportStaffTitle` was the missing third, so a lab technician's profile minted a research entity carrying the PI's lab name, the PI's lab website, and - once the microsite lane followed that website - the PI's lab prose.

The rows already minted are the residue, and the mint-side screen is inert against them.
`yarn --cwd server research-entity:retire-staff-minted-entities` archives them.

The population is derived, never listed: a live row whose identity citation (`fieldProvenance.slug.sourceUrl`) is a page about exactly one person, and for whom EVERY live `title` observation any lane states for that page is refused by one of the three screens.
`slug` provenance only, and live observations only.
A `name` fallback fires for 255 live rows but adds nothing here, because both mints write `slug` and `name` from the same base, and where it does fire the `name` is by definition a value another lane wrote.
A superseded or rolled-back title is a claim the lane has withdrawn, so it cannot archive a row; filtering to live changes no verdict on Development and moves 33 identity pages into `no-stored-title`, which refuses.

Unanimity, not recency, because several lanes write a `user` `title` against the same profile URL and none of them owns the question.
On Development 1,343 identity pages carry more than one live title and 20 disagree about whether the person owns research, in both directions: a roster subheading that appends a second appointment to a professorship can read as refused, and `official-profile-pi-backfill` stores award names as titles, which read as owning research.
One title saying the person owns research is `title-evidence-disagrees` and keeps the row, because a kept defect is re-readable and an archived professor is not.

**The pass retires two classes only**: a research-support or technical title, and a non-research staff role.
A trainee rank is deliberately not in the population, even though every mint lane still refuses one.
With a faculty-keyword yield, whether a trainee row archived would turn on whether `FACULTY_KEYWORDS` happens to spell the rank the way `SUBORDINATE_RESEARCH_RANK_PATTERNS` does, `postdoc` yes and `post-doc` no, so `'Postdoctoral Fellow'` would have been spared while `'Post-Doctoral Fellow'` was archived.
No irreversible archive should turn on a hyphen.
That residue is pre-#2304 trainee data rather than the research-support class this pass exists for, and retiring it needs its own issue and its own predicate.
`subordinate_research_rank` is therefore not a reason this pass can report.

Any title that states a faculty appointment anywhere yields, and this is the one place the retirement side is deliberately stricter than the mint gate.
`staffMintedEntityReasonFor` asks `statesAnyFacultyAppointment` on the WHOLE title, before any screen, and refuses the row as `title-owns-research`.
That predicate reads `FACULTY_KEYWORDS` directly rather than going through `isFacultyTitle`, and the difference is the point: `isFacultyTitle` is a classifier, so it short-circuits on `looksLikeNonResearchTitle` to stop a staff title reading as faculty on a stray keyword, and that short-circuit costs `'Associate Professor of Medicine; Clinical Program Manager'` its faculty reading to `\bmanager\b`.
The yield is a one-way guard, used only to spare a row and never to accept one, so it can afford to be broader than the classifier.

Four narrower yields were tried before this one and each had a corpus counterexample.
Do not reintroduce any of them.
A `FACULTY_KEYWORDS` list filtered keyword-by-keyword against `isSubordinateResearchRank` left `associate research scientist` unarchivable, because every title that phrase matches contains the faculty keyword `research scientist`.
A clause split on `;` and `,` then archived `'Visiting Assistant Professor'` and `'Visiting Fellow and Lecturer in Law'`, because a refused phrase sharing a clause with the appointment, or joined by `and`, defeated the yield; it also manufactured a yield out of `'Research Assistant, Professor Doe Laboratory'`.
`isFacultyTitle` on the whole title then archived `'Associate Professor of Medicine; Clinical Program Manager'`, `'Clinical Professor and Nurse Practitioner'` and `'Lecturer and Program Coordinator'` through the short-circuit above.
A predicate whose counterexamples keep arriving is the wrong kind of predicate for an irreversible bulk archive, so the blunt rule stands and the population narrows to match it.
The mint screens are unchanged and do not yield, because a research row withheld at mint is restored by the next run while an archive is not.
"Exactly one person" is load-bearing: the person-scoped path shape alone admits `/people/faculty` and `/people/core-faculty`, which are shared rosters, so whichever person's title happened to sit beside that URL would speak for every row minted from it.
`isSharedPeopleRosterUrl` refuses that shape.
On Development the pass reads 2,150 identity-bearing rows.
What it plans is deliberately not recorded here: the counts measured before the faculty-appointment yield described the population the yield then narrowed, and a stale breakdown on this page reads as a target.
Take the plan and its reason breakdown from a dry run against Development.
The reason is re-derived from the stored title on every run, so a second run reaches the same verdict rather than going blind once the first has written, and what makes the second run a no-op is that the row query is live-only rather than any plan state.
Every uncertainty refuses instead of archiving, and each refusal is counted: a citation that is not a person profile, a page with no stored title, a title that owns research, a `manuallyLockedFields` entry, a visibility override tier, or an operator- or manual-named `fieldProvenance.sourceName` (operator intent outranks a derived verdict, and it is not only the lock list: an admin edit leaves that empty), a row carrying a `websiteUrl` or `website` that its identity page did not supply (it must read both fields, because 1,695 live rows populate the first against 454 the second), and a `RoleAssignment` edge attaching somebody other than the person the identity page names.

That last refusal compares people rather than counting edges, and the difference decides whether the pass reaches the defect at all.
An edge attaching the very person whose profile minted the row is the same lane restating its own mint: the `PI` edge on the row that opened #3410 cites that person's own profile page as its provenance.
Counting edges refused 95 of 157 candidates and left every served defect in place; comparing people refuses 5, each attaching somebody else.

The website floor needed the same correction for the same reason.
Both mint gates write the row's `websiteUrl` FROM the lab link on the person's own profile, so that website *is* the graft being retired and is exactly what the microsite lane followed to write the PI's lab prose.
Refusing on any website at all spared 22 of the 34 rows that carry one, which is the defect rather than a floor, so the refusal compares the website's provenance against the identity page and fires on 11 rows whose website came from somewhere else.
The join is `researchers.profileLinks.url`, and a row whose identity page matches no person has no self to compare against, so every edge on it reads as foreign and it refuses.

It is dry-run by default; `--apply` additionally requires `--confirm-staff-minted-entity-retirement`, routes through `assertScriptApplyAllowed` so a production-looking target needs `SCRAPER_ENV=production` plus `CONFIRM_PROD_SCRAPE=true`, and is bounded by `--max-apply` (default 200).
It archives with the `research-entity:retire-staff-minted-entities` attribution through `archivedEntityUpdate`, so the stale visibility verdict is cleared in the same write, and it deletes the Meilisearch documents for what it archived.
It supersedes nothing and deletes nothing: the row and its observations stay as evidence of what the lane once asserted.
The `--output` report is resolved and written **before** the archive, and it records the pre-apply tier of exactly the rows the run touches, because a peer session writes Development concurrently and a post-hoc corpus-wide tier delta cannot be attributed to this run without it.

**What this pass does not reach.** Its population is rows whose identity citation is a page about exactly one person, which is what licenses a stored title to decide the row's fate.
A department-roster entry that carries an explicit lab website cites the roster page rather than the person's profile (`base.sourceUrl` falls back to the roster URL once `entry.labUrl` is set), and no configured roster URL satisfies `isPersonProfileIdentityUrl`, so those rows are out of population by construction.
They are not unprotected: the same website makes them `has-foreign-website` had they been in it, because the website's provenance is the roster page rather than an identity page.
Reaching them needs a join from the roster entry to the person's profile that this pass deliberately does not make, and #3410 records it as remaining work rather than implying the pass covers it.

The mint-side screen is asked by the three lanes that cite a person profile as a row's identity and harvest that person's title: `ysm-faculty-directory`, `dept-faculty-roster`, and `yse-faculty-directory`.
`bbs-research-track` cites a person's YSM profile too but harvests no title, so it cannot ask the screen; its rows remain reachable by this pass through the YSM lane's title observation for the same URL, which makes a refused person listed on a track page archived and then re-observed under the same `ysm-faculty-<slug>` key on the next sweep.
Re-observation is not resurrection: `findEntityDocByIdentifier` resolves the write target by slug with no archived filter and nothing on that path sets `archived: false`, so the row keeps its archived state while its fields are refreshed, and a student never sees it again.
Measured rather than assumed: the lane has observed 338 research-entity keys and exactly 1 of the rows the pass planned before the faculty-appointment yield narrowed it was one of them, so the cost is wasted writes on a single archived row, and #3410 records it as remaining work.
A lane added later that mints a research entity from a person profile has to ask the screen, or the pass will archive rows that lane keeps re-minting.

**A known cost in the roster drop guard.** The roster lane still adds a title-refused entry's key to its discovered set, because `loadRosterObservedEntityKeys` remembers every key the lane ever emitted, so dropping the key would read as `absent` to `classifyEntityRunSignal` and let the departure lane mark somebody as having left Yale for holding a support title.
That set is also the drop guard's numerator, while `countRosterGovernedEntities` counts live rows only, so the numerator now includes keys with no live row and the ratio reads high after `research-entity:retire-staff-minted-entities --apply` archives the roster-keyed rows it plans.
The effect is that a real roster breakage is slightly harder to detect, which is the lesser harm next to publishing a false claim that a person left.
Closing it needs a live-row join before the key is added, and the roster lane holds no `ResearchEntity` read at all today, so that is a separate change rather than a tightening of this one.

This is a stored-data operation: merging the screen changes nothing a student sees.

### What a stated title claims about research ownership (#3576)

`scrapers/utils/titleResearchOwnership.ts` answers one question: does this title claim research of its own.
It exists because the three mint-side title predicates cannot answer it.
`FACULTY_KEYWORDS` deliberately contains `postdoctoral`, `research associate` and `research scientist`, since those people are researchers, so a faculty-keyword test and a subordinate-rank test disagree about the trainee class by construction rather than by accident.

It is a rank lattice, not a keyword set, and each property fixes a mechanism that failed before it:
every rank is a phrase carrying an explicit verdict; a match is a span found anywhere, so no clause splitting is needed and a conjoined appointment keeps its reading; the longest span wins an overlap, so `associate research scientist` beats `research scientist` without either pattern knowing about the other; and both spellings of a rank live in one pattern, so no verdict turns on whether a second vocabulary spells it the same.
`states_no_rank` is a third answer and the most common one, 1,103 of 5,574 distinct stored titles: silence is not a claim that somebody owns nothing.

**It is not sufficient for an archive, and the module says so.**
A title names ranks; it does not say whose rank each one is.
Five distinct stored titles name a rank as the population somebody serves, of the shape "Senior Associate Director, Graduate Student and Postdoctoral Career Services", and a director of postdoctoral career services is not a postdoc.
`namesARankItServesRatherThanHolds` reports those rather than reclassifying them, because a rule for them would be the sixth string heuristic in this family and the first five each broke on first contact with the corpus.

`yarn --cwd server research-entity:audit-title-research-ownership` is the read-only instrument over that predicate.
It takes no `--apply`, deliberately: there is no writing arm to reach for.
It buckets every live row by what its identity page's live titles claim, keeps a row whose titles disagree in its own bucket rather than resolving it by recency, and reports two numbers beside the population so a reader can size the work honestly.

On Development, over 4,687 live rows: `owns_research` 1,755, `works_in_another_group` 103 (39 served), `states_no_rank` 85, `titles_disagree` 29, `no_identity_profile` 2,422, `no_stored_title` 293.

Three of those numbers are the point, and the first corrects how this audit was first read.

**`works_in_another_group` is not a defect count.** Of its 39 served rows, **38 carry a non-trainee lead**, so a student who lands there reaches the faculty lead and the row describes a real access route.
Whether a row is a way in is owned by `isTraineeLevelTitle` and `hasStrongLead` (#2876/#2877) rather than by what a title says about its own rank, and this predicate is deliberately wider than that pair: it disagrees with `isTraineeLevelTitle` on 59 of the 103, because it reads an associate research scientist or a clinical fellow as working in another group when those people are reachable through their PI.
Archiving on this bucket would have removed 19 legitimately-led pages, which is why the command has no `--apply`.

`namingARankTheyServe` was **0** among the 103, so the predicate's known limit does not reach this population even though it is real in the vocabulary.
And `corroboratedByALeadEdgeElsewhere` was **2** of 103, which retires the second-witness design #3576 first proposed: a trainee is a member rather than a lead, so a lead edge on another entity is evidence almost none of them carries.
That 2 was read under an earlier edge query that matched `PI`, `DIRECTOR` and `CO_DIRECTOR` in any `state`; the audit now counts `CURRENT` `PI`, `CO_PI`, `DIRECTOR` and `CO_DIRECTOR` edges, and the number needs a fresh Development read before it is quoted again.
The retirement does not rest on the count alone: a lead edge elsewhere shows that a person leads research somewhere, which is not evidence that this row belongs to somebody else's group, so the report carries the count for sizing only and never as archive evidence.

What the audit did find, once read against the hostability rule rather than as a defect list, was **one** served row: a `Postgraduate Associate` whose only lead's stored title the gate read as hostable, because `postgraduate associate` and `postgraduate fellow` were missing from `TRAINEE_TITLE_PATTERN` in `utils/traineeLevelTitle.ts`.
Those are Yale's post-bachelor's, pre-doctoral research appointments, so they belong there for the same reason a postdoc does.
Adding them matches seven distinct stored titles and removes the strong lead from four served rows, each routing to `missing_lead` and the PI-attachment lane rather than being removed, which is the remedy #2877 established.
A workable second witness has to be something a person in somebody else's group actually holds, and finding one is open work.

### Source dispatch and the freshness worklist (#2619)

`server/src/scrapers/sourceDispatch.ts` sorts every `Source` row into `sweep-registered`, `script-driven`, `retired`, or `unowned`.
`buildOrchestrator()` is the authority for the first: the CLI and the sweep both resolve a name through it, so a row it does not name fails with "No scraper registered with name" no matter what the row says.
`scrapers:audit-freshness` therefore computes overdue and never-crawled over sweep-registered rows only, reports script-driven lanes next to the command that runs each one, lists retired rows separately, and fails rather than reporting phantom work when a registered scraper has no row, a row is `unowned`, or a retired lane's row is still enabled.
Admin source health reads the same classification, so a retired row is `ok` with its retirement stated rather than a warning asking an operator to confirm a decision the repo already made, and a script-driven lane with no scrape run names its command instead of suggesting a crawl that would fail.
Source health and the freshness worklist also share one recurrence rule, `sourceIsExpectedToRecur` in `scrapers/sourceYieldGuard.ts`: a source that is disabled, `MANUAL_OVERRIDE`, or in the sweep's manual-only set (`scrapers/manualOnlySweepSources.ts`) has no recurring run expectation, so it never reads as stale and its latest failed run is `ok` with the report command rather than `error` risk (#3582).
Only the recurrence rule reads the manual-only set: the barren-streak guard still uses `sourceIsExpectedToYield`, so a deliberate manual run of a manual-only lane that acquires nothing is still a failed run the operator sees.
Every scraper in `registry.ts` must also have a `seedSources.ts` entry, because applying the seed is the only remediation the audit's missing-row block accepts.

## Canonical Collections

Runtime research discovery is centered on:

- `research_entities`
- `role_assignments` (roster, joined to `researchers`)
- `researchers`
- `accounts` (login principal)
- `signals`
- `research_entity_relationships`
`yarn --cwd server research-entity:repair-dead-end-tombstones` (dry-run-first, `--apply --confirm-dead-end-tombstone-repair`) reports every tombstone whose `canonicalGroupId` chain reaches no live row, split by why, because the three causes are not one defect.
A `cycle` or an `absent_target` is a malformed pointer and is cleared; an `archived_terminal` is well-formed data saying the subject has no live home and is left alone.
The repair only ever CLEARS a pointer and never picks a new destination: a cycle and a dangling id cannot name one, and inferring it from a name is the #2378 graft channel.
Clearing keeps the row, so it keeps occupying its slug and keeps its own description, citations and website, which is the `sole_surviving_record_of_slug` state the archived-row cleanup already refuses to delete.
Do not delete a dead-end tombstone: all 47 on Development still carried live observations, so a source still publishes every one of those slugs and freeing them buys a re-mint on the next sweep.
Applied to Development on 2026-09-23: 2,665 tombstones scanned, 5 cycles and 3 dangling pointers cleared, 39 archived-terminal rows kept, 2,618 resolving; a re-run reports 0 of both malformed causes.
The integrity gate now detects the malformed causes on every run as the `deadEndTombstoneChains` warning, through the same production walk (`walkResearchEntityTombstoneChainWithCause`) the repair uses, because this class accumulated 47 rows while only the script's dry run could see it (#3704).

- (retired #3027) `research_entity_redirects`: a merged identity is kept as an archived `research_entities` row whose slug occupies the unique index and whose `canonicalGroupId` routes re-scraped evidence to the survivor, so the mapping lives on the row
- `research_plans`
- `users` (legacy identity/profile store; still the primary write target for most identity fields pending retirement, see `docs/research-model.md#legacy-user-residue`)
- `fellowships`
- `sources`
- `scrape_runs`
- `observations`

The `signals` collection holds typed `Signal` rows and consolidates the former `access_signals` and `undergraduate_logistics_claims` collections; each former access `signalType` is now its own `Signal.type`, and the five logistics claim types it also absorbed are retired (#3088).
Transitional note: until the human-gated `signalConsolidationMigration` is applied, the legacy `access_signals` and `undergraduate_logistics_claims` collections may still hold un-migrated rows, so reconciliation and copy work should account for all three until the migration completes.

The legacy `research_groups` collection is intentionally absent after the hard `ResearchEntity` migration and should not be used as a data-health signal.

## Promotion Invariants

Before production promotion:

- The accepted Beta dataset must have zero blocking referential errors across canonical collections.
- Source reports must show `materialization.errors = 0`, or any nonzero count must block promotion for that source.
- Known warnings must be documented in the promotion's GitHub issue before promotion.
- Production must have a fresh Atlas backup or restore point before any copy or write.
- The accepted Beta copy is the only promotion lane; no scraper writes to Beta or Production (decision 2026-09-27).
- Meilisearch must be rebuilt or synced after accepted Mongo writes.

The operator decision packet in [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md) is the promotion record for lane, backup/restore point, rollback owner, smoke owner, accepted warnings, run IDs, and rollback drill status. Do not infer a lane from pipeline state alone; the operator must fill the packet before production writes or copy operations.
The presence of that packet is not acceptance by itself; blank fields mean the production gate is blocked.

### Undergraduate Logistics Release Audit (Retired)

The read-only logistics audit, its rollback script, the staging allowlist and the `--logistics-production` flag are retired with the vertical (#3088).
There is no logistics acquisition to gate, so no audit runs before one.

## Rollback Drill Expectations

Rollback drills are dry-run-only until an operator approves production action:

- Accepted Beta copy: identify the Production backup or point-in-time restore timestamp, the copied collection set, the Atlas restore owner, and the Meilisearch rebuild sequence.

## Retention Posture

Compact observation retention must preserve every source observation referenced by a served claim.
Follow the reviewed dry-run-first retention procedure in `docs/scraper-deployment-runbook.md`; the exact source observations remain the audit backbone for every student-facing claim.

`observations:prune-dead` (`server/src/scripts/pruneDeadObservations.ts`) is the committed, gated dead-data prune used for mid-run and on-demand storage reclamation.
It deletes observations that are both superseded and unreferenced regardless of age, reusing the same `observationRetention.ts` primitives (`buildSupersededObservationPruneFilter` with `cutoff = now`, plus `buildObservationReferencePipeline` over `OBSERVATION_REFERENCE_SPECS` to protect every referenced observation id), and can optionally drop the `scrape_snapshots` fetch cache with `--drop-snapshot-cache`.
Referenced ids are excluded in memory while the eligible ids stream from a cursor, and deletes go out in batches of `OBSERVATION_PRUNE_DELETE_BATCH_SIZE`, because the referenced set passed the 16 MB BSON command limit on Development at about one million ids and a single `_id: { $nin }` filter made both prunes and the `beta:data-quality` retention stage crash (#3733).
Dropping the age floor does not drop run retention: the dead prune keeps the last 3 runs per source (`keepRuns`, same default as the compact prune) so the immediately preceding run's superseded observations survive.
`keepRuns` default 3 was justified by `undergraduate-logistics-rollback`, which restored exactly those predecessors, and that script is retired (#3088), so the default now has no named consumer.
It is deliberately left at 3 rather than lowered here, because `OBSERVATION_REFERENCE_SPECS` protects only the newer target of `supersededBy`, so dropping run retention makes the preceding run's superseded rows unrecoverable by any means; re-sizing it is its own measurement rather than a side effect of this retirement.
`--keep-runs=<n>` overrides the default, and `--keep-runs=0` explicitly forfeits claim-local rollback for every source; only pass it when rollback for the retained window is no longer needed.
It is dry-run first; `--apply` requires `--confirm-prune-dead-observations` and routes through the shared `applyObservationPruneEnvironmentGuards`, so it enforces `SCRAPER_ENV`/Mongo-target coherence, downgrades to dry-run outside production without `ALLOW_NON_PROD_SCRAPER_WRITES=true`, and is unconditionally blocked when the resolved environment is production, independent of how the database happens to be named.
The sweep runs it between phases and as the final `dead-data-prune` post-run stage of both engines, only when invoked with `--prune-between-phases` on a Development-database write mode.

Both pruners are coupled to the materializer's read scope, because `superseded: true` only means "not projected" while that scope excludes superseded rows (#2944).
`supersededPruneIsProjectionNeutral` reads `materializationReadScopeFilter()` rather than restating the assumption, so with `C4_LOSSLESS_INGEST` set the pruners throw on `--apply` and report `projectionNeutral: false` in a dry run, and a sweep invoked with `--prune-between-phases` fails its prune stage instead of deleting evidence the materializer still reads.
The two changes are individually safe and jointly destructive: measured on Development on 2026-09-22, 2,301 prune candidates touched 2,095 `(entityType, entityKey, field)` slots, 511 of which had no surviving non-superseded row and 438 of which would have been left with no in-scope evidence at all under the lossless read scope.

That in-process guard only sees the flag the prune process was given, and the prune runs in its own process, so an absent `C4_LOSSLESS_INGEST` does not prove the target environment's materializer excludes superseded rows.
`applyObservationPruneEnvironmentGuards` therefore treats an undeclared flag as unknown and forces a dry-run, the same downgrade it applies for a missing `ALLOW_NON_PROD_SCRAPER_WRITES`; declare `C4_LOSSLESS_INGEST=false` in the environment the target materializes from to apply.
Only a per-slot sole-evidence filter would make the delete safe under the lossless read scope itself, and that filter is deliberately not built yet, so the guard is a refusal rather than a narrowing.

A refusal that nobody notices is its own failure, so two things keep the downgrade from reading as a clean prune.
Every prune result carries `readScopeDeclared` alongside `projectionNeutral`, so an artifact recording zero deletions says which of the two it was: nothing to reclaim, or a read scope this process could not establish.
And the sweep declares the scope it materialized under to the children it spawns (`declareMaterializationReadScopeForChildren`), because the sweep is the process that wrote those rows, so an opted-in `--prune-between-phases` stage still reclaims storage instead of silently becoming a green no-op.
`server/.env.example` therefore ships `C4_LOSSLESS_INGEST=false` declared rather than absent.
