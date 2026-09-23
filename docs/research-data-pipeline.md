# Research Data Pipeline

Status: active operator reference

Last updated: 2026-09-05

Yale Research data moves through an evidence-first pipeline. Use this document for the stable shape of the pipeline, [`docs/scraper-audit-guide.md`](./scraper-audit-guide.md) for source-level audit expectations, and [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md) for Beta and production promotion steps.

## C4 engine (flagged)

The consolidated C4 engine (issue #2063) adds prevention-first identity resolution (resolve-at-mint against a canonical-alias ledger) and decide-late projection over a lossless observation log, plus a fuzzy residual matcher and grounded gpt-5-mini description coverage.
It is gated behind three off-by-default flags: `C4_RESOLVE_AT_MINT_USERS`, `C4_RESOLVE_AT_MINT_ENTITIES`, and `C4_LOSSLESS_INGEST`.
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
  -> Signal (logistics types) when exact official evidence supports an independent logistics claim
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
`validateScraperSweepManifest` asserts every registered orchestrator source is in exactly one engine, with the sole exception of the manual-input source in `MANUAL_ONLY_SWEEP_SOURCES` (`undergrad-fellowships-recipients`), which stays registered and runnable by hand but out of both automated manifests because it is a backward-looking recipients source with no clean public feed.
`department-undergrad-research` dual-writes (its `program` records materialize as `Fellowship` while its `lab` records materialize as `ResearchEntity` access-evidence); it lives in the research engine because access-evidence is research-side.
The registered sources in each engine are grouped into ordered phases that run in sequence in the order the phases first appear in the manifest: `identity`, `discovery`, `funding`, `relationships`, and `content-access`.
The fellowship engine currently only spans the `discovery` phase.
The `scholarly` phase is declared in the source-phase contract but currently carries no registered sources, so it does not run.
Sources inside a phase run with bounded concurrency, and the two LLM-heavy phases (`relationships`, `content-access`) are capped at concurrency 2 by `PHASE_CONCURRENCY_CAPS` regardless of the requested `--concurrency`.
The three exhaustive Development modes (`development-full`, `development-incremental`, and `fellowship-development-full`) default the network-bound discovery phase to cross-source concurrency 8; to stay polite to any single host, the sweep sets each source child process a `SCRAPER_PER_HOST_CONCURRENCY` cap that shrinks as cross-source concurrency rises, so the combined per-host request budget across concurrent children stays bounded, and an operator `SCRAPER_PER_HOST_CONCURRENCY` override can only tighten that per-child cap, never loosen it.
Individually rate-limited hosts are pinned tighter still by a per-host override map that no `SCRAPER_PER_HOST_CONCURRENCY` value can lift; see `utils/hostConcurrencyLimiter.ts` in `skills/scrapers/SKILL.md` for the current entries and the rationale.
The dept-roster and dept-undergrad sources stay effectively serial because they page through their own in-loop `--limit`.

The sweep modes fix the environment, database, write posture, and confirmation flag together, so a single `--mode` cannot straddle environments:

| Mode | Env / DB | Writes | Auto-materialize | Confirmation flag |
| --- | --- | --- | --- | --- |
| `development-plan` | development / Development | no | no | none (dry-run, `--limit 100 --use-cache`) |
| `development-sample` | development / Development | yes | yes | none (`--limit 100 --use-cache`) |
| `development-full` | development / Development | yes | yes | `--confirm-development-full-sweep` (`--exhaustive --ignore-work-planner`) |
| `development-incremental` | development / Development | yes | yes | `--confirm-development-incremental-sweep` (`--exhaustive --use-cache`) |
| `fellowship-development-full` | development / Development | yes | yes | `--confirm-fellowship-sweep` (fellowship engine only, `--exhaustive --ignore-work-planner`) |
| `beta-plan` | beta / Beta | no | no | none (dry-run, stop-on-failure) |
| `beta-fetch` | beta / Beta | yes | no (Render materializes) | `--confirm-beta-release-candidate` (`--exhaustive`, stop-on-failure) |

Development modes require a local Meilisearch host and an empty `MEILISEARCH_INDEX_PREFIX`; the sweep refuses a non-local Development Meili target.
Beta modes fetch observations into the `Beta` database and emit per-source `betaRenderCommands` (dry-run materialize plan plus apply) so the Beta Render service materializes the recorded run ID; local Beta runs never materialize.

#### Checkpoint, resume, and structured logging

The sweep is resumable and observable so a long run that dies mid-way does not restart from scratch (issue #2182).
Every step - each source step and each post-run stage - is tracked in a durable checkpoint JSON at `<os.tmpdir>/ylabs-sweep-checkpoint-<mode>-<worktree-fingerprint>.json`, written atomically (temp file plus rename) after every `pending -> running -> done|failed` transition with the step's exit code and timestamps.
The checkpoint key includes a fingerprint of the repository root, so two worktrees running the same mode at the same time never share or clobber one checkpoint.
A normal invocation resumes automatically: if a checkpoint for the same mode exists it reuses that run's output directory, skips every step already marked `done`, and re-runs anything not `done` (failed, interrupted, or never started); resume granularity is per step, so an interrupted source re-runs whole.
Three conditions deliberately refuse or narrow a resume, because a checkpoint alone is not enough evidence that a step's work is still valid:

- The checkpoint records the invocation's behavior-changing flag set (`--force-llm`, `--prune-between-phases`). Only a checkpoint whose recorded flag set matches this invocation is a resume candidate; a re-invocation with a different flag set starts fresh instead of inheriting `done` steps that were produced under different semantics, and its fresh checkpoint replaces the old one at the same path.
- The checkpoint records its owner pid. On a resume candidate, if a step is still `running` and that pid is alive, the sweep refuses to start rather than interleaving two writers against one checkpoint; use `--restart` to abandon a checkpoint whose owner is truly gone. The flag-set comparison happens first, so this guard does not cover a re-invocation that changes the flag set: never re-invoke a live sweep's mode with a different flag set, because that path replaces the running sweep's checkpoint instead of refusing.
- Post-run stages are whole-database aggregate stages, not per-source work. If any source step is not `done` in the checkpoint, every `stage:` entry is cleared at plan time so the entire post-run chain (faculty projection, visibility gate, search rebuild, and the rest) re-runs over the newly written data, rather than a resumed sweep reporting green with a re-fetched source missing from the projections or the search index. The decision reads the checkpoint only: a source that is `done` but re-runs later because its artifact turned out to be missing or invalid does not itself invalidate the stages, so pass `--restart` when resuming a run whose output directory may have been partially cleaned up.

A step marked `done` whose declared result or artifact is missing, unreadable, or invalid is treated as not done and re-run, so the resume path keeps the same fail-loud artifact contract as a fresh run (#2050) instead of reporting an empty delta as success.
`--restart` wipes the checkpoint and starts a fresh run.
A fully successful sweep (no failures, nothing not-run, post-run not failed) clears its checkpoint so the next plain invocation starts fresh rather than resuming a completed run.
Alongside `summary.json` the sweep writes, into the same output directory, a `runner.log` (a timestamped step-start/done/fail timeline), an `errors.log` (each failure with its step id, exit code, and the tail of that step's captured output), and per-step `.log` files capturing each child's output.
`errors.log` reads a bounded tail from the end of a step log (never the whole file, which can reach hundreds of megabytes on an exhaustive run) and passes every captured line through `sanitizeLogValue`, so scraped contact data and connection credentials never land in the file operators are told to read and share.
Because every child's stdout and stderr now redirect into its own step log, child output no longer streams to the sweep's terminal: the parent prints one header line per step (per-source headers include the log path) and the rest lands in the log file, so `tail -f` that path to watch a step in flight.

#### `--force-llm` and mid-run storage headroom

`--force-llm` (off by default) threads `--force-llm` into every per-source `scrape run` child, re-running paid LLM extraction even when a page's content hash is unchanged; use it for a full re-derivation pass.
`--prune-between-phases` (off by default) runs the gated dead-observation prune (`observations:prune-dead`) between phases and adds a final `dead-data-prune` post-run stage to both engines' chains, so a `--force-llm` run can hold storage headroom without a separate watchdog process.
Both the between-phases hook and the final stage are restricted to the Development-database write modes (`development-full`, `development-incremental`, `fellowship-development-full`), matching the rest of the post-run chain: a Beta or Prod sweep never deletes mid-run, because in `beta-fetch` materialization is deferred to the Beta Render service and nothing has consumed the run yet.
The between-phases prune is best-effort: a prune failure is logged to `errors.log` and does not stop the sweep.

The two exhaustive Development modes (`development-full`, `development-incremental`) run a fixed chain of post-run stages after every source has fetched and materialized:

1. `researcher-dedupe` (on by default in Dev sweeps; disable with `SCRAPER_SWEEP_DEDUPE_RESEARCHERS=0`)
2. `eponymous-fra-merge` (on by default in Dev sweeps; disable with `SCRAPER_SWEEP_AUTO_MERGE_FRA=0`)
3. `url-identity-dedupe` (on by default in Dev sweeps; disable with `SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES=0`)
4. `website-url-identity-dedupe` (the same lane family keyed on the whole normalized `websiteUrl` rather than a Yale `/lab/` or `/profile/` path; gated by the same flag)
5. `source-link-health` (`research-homes:backfill-source-link-health --apply`; ordered before the gate because the gate reads `sourceLinkHealth`)
6. `visibility-gate` (`student-visibility:gate --collection=all --apply`)
7. `search-rebuild` (`meili:rebuild-research-entities --clear`)
8. `coverage-audit`
9. `data-quality` (`beta:data-quality --strict`)
10. `integrity-gate` (`scraper:integrity-gate --include-claim-gate`)
11. `trust-contract` (`launch:trust-contract --mode=student-ready-only --strict`)
12. `archived-cleanup` (`research-entity:cleanup-archived --merge-residue-only`; residue is deleted by default in Dev sweeps, disable with `SCRAPER_SWEEP_DELETE_MERGE_RESIDUE=0`)
13. `dead-data-prune` (`observations:prune-dead --apply`; opt-in, only when the sweep is run with `--prune-between-phases`)

The `researcher-dedupe`, `eponymous-fra-merge`, both URL-identity dedupe stages, and merge-residue deletion stages run by default on the two exhaustive Development modes so the Dev pipeline auto-dedupes every run. Each can be disabled independently by setting its environment flag to a falsey value: `SCRAPER_SWEEP_DEDUPE_RESEARCHERS`, `SCRAPER_SWEEP_AUTO_MERGE_FRA`, `SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES`, and `SCRAPER_SWEEP_DELETE_MERGE_RESIDUE`. One flag gates the whole URL-identity family, because `url-identity-dedupe` and `website-url-identity-dedupe` are two keys onto one question and an operator suppressing URL-keyed merges wants both off. `url-identity-dedupe` was opt-in until #2699; it defaults on because the never-demote survivor resolution defers rather than demotes (#2070) and because the whole post-run set is unreachable outside Development, so the flag only ever gated Dev. Every `SCRAPER_SWEEP_*` stage flag in either engine parses through the one shared helper pair in `server/src/scripts/sweepStageFlags.ts`, so the accepted truthy values (`1`, `true`, `yes`, `y`, `on`, `enable`, `enabled`) and falsey values (`0`, `false`, `no`, `n`, `off`, `disable`, `disabled`) are identical for every flag. These post-run stages never run on Beta or Prod sweeps, so those paths are unaffected.

The post-run chain is defined once as a declarative registry (`DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS` in `runScraperSweep.ts`, issue #2050): each stage owns its command, args builder, enable predicate, and optional typed result contract, and both the plan builder and the runner derive from it.
A stage that declares a result contract but exits successfully without a readable, valid result artifact fails loud rather than silently dropping its delta.
Every merge-applying stage declares one, so `summary.json` carries its counts and an exit code is never the only evidence the stage ran: `researcher-dedupe` reports `researcherDedupeDelta`, `eponymous-fra-merge` reports `mergeDelta`, and both `url-identity-dedupe` and `website-url-identity-dedupe` report `urlIdentityDedupeDelta`, whose fields are enumerated in [`research-entity-pi-dedupe-runbook.md`](research-entity-pi-dedupe-runbook.md).

The `fellowship-development-full` mode runs the fellowship engine's own post-run chain (`FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS`, issue #2172), which wires the existing `programs:*` / `fellowships:refresh` scripts against the freshly scraped catalog in this order:

1. `classification-backfill` (`programs:backfill-classification --apply`)
2. `global-regions-backfill` (`programs:backfill-global-regions --apply`)
3. `official-sources-backfill` (`programs:backfill-official-sources --apply`, opt-in and off by default)
4. `link-labels-backfill` (`programs:backfill-link-labels --apply`)
5. `accepting-applications-invariant` (`programs:backfill-accepting-applications-invariant --apply`)
6. `source-link-health` (`programs:backfill-source-link-health --apply`)
7. `catalog-refresh` (`fellowships:refresh`, opt-in and off by default)
8. `research-relevance-audit` (`programs:audit-research-relevance`, report-only)
9. `freshness-audit` (`programs:audit-freshness`, report-only)
10. `dead-data-prune` (`observations:prune-dead --apply`; opt-in, only when the sweep is run with `--prune-between-phases`)

Each backfill applies with the script's own confirm flag (production writes are blocked by each script's own apply guard, so the Development mode is safe), and the two audits run report-only.
`classification-backfill` is the one stage that can decline to write: it refuses an apply that would cost a program row its student-visible tier, and the sweep never passes the flag that overrides that refusal, so the stage fails rather than demoting a served row unattended (see "`programs:backfill-classification` asserts and never retracts" below).
Every stage that takes an `--output` path is held to a report contract: a stage that exits successfully without a readable, valid JSON report at the path recorded in `summary.json` fails loud, and a stage that writes no report records no `artifactPath` at all.
`official-sources-backfill` is opt-in via `SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET=1` because `programs:backfill-official-sources` is not a general recomputation: with no `--input` it replays the committed one-shot curated change-set at `server/src/scripts/data/programOfficialSourceBackfill.json`, so running it on every sweep would overwrite each listed record's freshly scraped `sourceUrl` with a frozen hand-researched value.
`catalog-refresh` is off by default because `fellowships:refresh` only accepts a `beta` or `prod` target and refuses any target that does not match `SCRAPER_ENV`, so no Development sweep mode can satisfy it; it is opt-in via `SCRAPER_SWEEP_REFRESH_FELLOWSHIPS=1` plus `SCRAPER_SWEEP_FELLOWSHIP_REFRESH_TARGET` and `SCRAPER_SWEEP_FELLOWSHIP_REFRESH_RESTORE_TOKEN`, and stays skipped (with a logged reason) unless all three are set *and* the requested target matches the sweep mode's own target, so opting in during a Development sweep skips the stage instead of failing it.
The restore token reaches `fellowships:refresh` through the child environment (`FELLOWSHIP_REFRESH_RESTORE_TOKEN`) rather than argv, so it never appears in the host process table.
No `Fellowship`/`/programs` Meilisearch rebuild stage is wired because there is no programs search-index script; `researchEntity` is the only Meilisearch-syncable type.
The beta modes (`beta-plan`, `beta-fetch`) still run `RESEARCH_SWEEP_SOURCES` only; a beta fellowship sweep is a possible follow-up.
The two engines can therefore be scheduled, gated, and reasoned about on independent cadences.

### A dead acquisition lane is a failed run, not a warning

`runReport` has always warned "Run produced zero observations" and "Source coverage metadata exists, but successful run emitted zero observations", and the run still ended `success`.
So the diagnosis existed on every barren run and escalated to nothing: six Development sources emitted zero observations on every run they ever had (8, 5, 3, 3, 3 and 3 runs), three of them funding lanes, while the sweep summary and the operator board read healthy (#2607).

`scrapers/sourceYieldGuard.ts` converts the streak into the run's own status.
It classifies every run of a source as `productive` (emitted at least one observation), `inconclusive`, or `barren`, and once the current run plus its unbroken run of barren predecessors reaches `BARREN_RUN_STREAK_FAILURE_THRESHOLD` (3), the orchestrator persists `status: 'failure'` and records the reason in `run.errors`.

Nothing new reports it, because a stored `failure` is what the existing surfaces already act on.
`scraperSweepArtifactError` fails the sweep step on any `runStatus` other than `success`, so the sweep counts the source in `failed` and exits non-zero; `sourceHealthService` raises the source to `error` risk with "Latest run failed; inspect scraper report before rerunning"; and `runReport` warns not to materialize without inspecting errors.
The cron path is the one surface that was reading only its own materialization counters, so `runScraperCron` now also exits 1 and releases its job lock as `failure` when the run it just finished is a `failure`.
The sweep's own `sourcesThatProducedNothing` stays report-only for the shorter streaks it can still see.

Four properties of the rule are load-bearing.

- **It is not gated on a recorded successful fetch.** The issue proposed `fetched > 0 && attributed == 0` as the cheap unambiguous guard, and on real data it is inert: none of the six dead lanes records `fetchMetrics` at all (467 of 2,009 Development runs do), so a fetch-gated guard would have fired on zero of them.
- **The streak, not a single run, is the trigger.** A source can legitimately have nothing new to say once, so one barren run stays `success` and is left to the sweep's report-only count.
- **An `inconclusive` run is stepped over rather than counted or treated as a reset.** A run is inconclusive when it is `invalidated` or still `running`, when `options.only` scoped it to a handful of entities so its silence says nothing about the lane, or when the work planner skipped every target it planned (`workPlannerSkippedEveryTarget`, the same predicate `runReport` uses for its warning, so the two cannot drift).
  Without the step-over an alternating history would never accumulate a streak; with a reset instead, one quarantined run would hide a dead lane indefinitely.
- **A source with no re-crawl expectation has no yield expectation either.** `sourceIsExpectedToYield` exempts a disabled source and the `MANUAL_OVERRIDE` tier, mirroring `classifySourceFreshness`.
  That is the whole exemption list; do not grow it into a denylist of lanes that need operator-supplied input, because "it needs a CSV" is indistinguishable from "it is dead" when the lane has produced nothing for eleven runs.

The history read is bounded to the most recent `BARREN_RUN_HISTORY_SCAN_LIMIT` (12) runs of the source, so running out of history settles the question conservatively as "no failure".

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
The `archived-cleanup` stage enforces a fail-closed redirect invariant (issue #2039): in `--merge-residue-only` mode it refuses to delete any residue that is not provably inert and defers it with a reason instead, and the reason codes are enumerated in [`research-entity-pi-dedupe-runbook.md`](research-entity-pi-dedupe-runbook.md).

### Materialization is run-scoped, so an interrupted run strands its observations

`materializeFromRun` is the only entry point that enumerates observations, and it is scoped to a single `scrapeRunId`.
The CLI calls it after `orchestrator.run` returns, so a scraper that throws (run left `failure`) or a process killed mid-run (run left `running`) never reaches the call at all.
Nothing else re-enumerates observations by key: `research-entity:rematerialize` selects by `research_entities.slug` and reports `found: false` for a key with no entity row, and the synthesis lanes enumerate existing entities.
There is no corpus-wide materialize pass.

The consequence is a stable failure mode rather than a transient one.
Observations from an interrupted run stay live and unsuperseded forever, no entity is ever minted for their `entityKey`, and no later sweep revisits them, because supersession keys on `observationFingerprint` within a source lane rather than on whether the lane was ever materialized.
Measured on Development for issue #2383: 978 of 1,508 stranded keys (10,828 of 14,592 live observations) were emitted only by runs that never reached `success`, including 521 of the 527 keys carrying a complete faculty observation set with no identifiable target.
Those observations are unprocessed input, not dead data.
Do not prune a stranded lane before checking this axis; pruning it discards acquired evidence that was never offered to a materializer.

`research-entity:rematerialize` reports `skipped: archived-entity` for an archived row unless `--include-archived` is passed (issue #2905).
An archived row has no served surface, and a merged shell's slug resolves through its redirect to a live canonical, so materializing it writes one document while the report diffs another.
A row whose slug or id resolves through a redirect to a different canonical reports `skipped: redirected-to-canonical` even under `--include-archived`, because the write would land on the canonical while the diff and the re-gate scope stay keyed on the requested row.
The run also attempts every requested slug and carries a per-slug failure in `entitiesFailed` rather than aborting partway through, and a re-gate failure lands in `regateError` instead of losing the report, then exits non-zero in either case, so an operator can tell from the report which slugs were written.

The report's `changes` array is exactly as wide as `REMATERIALIZE_TRACKED_FIELDS`, so a field the materializer rewrites and that list omits reads as unchanged rather than as unmeasured (issue #2536).
`entityType` was omitted while its derived `kind` was tracked, so every report answered a `LAB`-versus-`FACULTY_RESEARCH_AREA` drift question with the shadow of the field instead of the field, and the first reader of it concluded the materializer refused to write the corrected type when the write had always been correct.
Measured on a 400-row Development sample, the pre-fix list reported 244 rows as changed and hid 67 field-level changes it had no column for (`departments` 40, `schools` 26, `school` 1) on top of an `entityType` column that could not be non-zero at all.
Add a field here when the materializer plans it and the product serves it; `inferredPiUserKey` stays out because it is planned but persisted on 0 of 8,280 Development rows, so tracking it would report a change on every run forever, and `contactEmail`, `contactName` and `contactRole` stay out because `publicResearchDetailGroup` withholds them from every served payload, so a report that carried them would print a withheld contact beside a per-slug defect judgement.
The list doubles as the `--only-fields` allowlist, so widening it mints a write scope as well as a report column, and a field the materializer co-derives needs its whole closure in that scope or the scoped write lands one half of a pair.
Every member of a group in `MATERIALIZER_DERIVED_FIELD_GROUPS` is written together, so `--only-fields=kind` and `--only-fields=entityType` both write that pair (issue #2144) and `--only-fields=departments` also writes the `school`, `schools` and `orgAffiliationLabels` that `applyResearchEntityOrgUnitCanonicalization` recomputes from it, rather than leaving the stored `schools` facet describing the old departments.

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

### Stranded observation keys and their category split

`yarn --cwd server observations:audit-orphan-keys` (`orphanObservationKeyAudit.ts`, with the pure classifier in `orphanObservationKeyAuditCore.ts`) splits every live `researchEntity` observation key that matches no `research_entities.slug` and no `research_entity_redirects.mergedSlug`.
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
  It reads and writes the native collections rather than the models, because the served `profileSynthesisDescription` is not declared on the research-entity schema and a strict Mongoose `$set` drops it without error.
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
  The collapse also judges quality without the batch's `researchAreas` or `fullContext`, which the write path supplies, so the two can reach different verdicts on the same pair; that is a known gap rather than a settled decision.
  `appendObservations` resolves every incumbent prose lookup the batch can need once, up front and concurrently, and judges the incumbent with the same `entityType` and `researchAreas` as the incoming value, so an incumbent the quality bar rejects cannot block a refresh.
- `retireObservations` (#1966) is a primitive that bulk-supersedes the observations matching a filter (for example an entity's active rows) and stamps a `rollback` marker with an audit reason, without deleting evidence.

Microsite LLM extractors are gated on a versioned content hash (#2025).
Each extractor computes a SHA-256 hash over the exact fetched page bytes plus the extraction contract that would consume them (the extractor's prompt content hash and model id, and for the description extractor also the card model and card-synthesis prompt content hash), compares it against the last stored `sourceContentHash` bookkeeping observation for that `(source, entity)`, and skips the paid LLM call entirely when both the bytes and the contract are unchanged.
Prompt text lives in editable `.md` files under `server/src/scrapers/prompts/`, and each `*_PROMPT_HASH` is the sha256 of its file content (#2099), so editing a prompt `.md` changes the contract hash and re-extracts exactly the affected entities on the next run with no manual version bump, while unchanged pages still skip.
The `--force-llm` flag is the only bypass; the gate is read directly by the extractor so it also holds under `--exhaustive` and `--ignore-work-planner`.
One deliberate exception: the description extractor writes no `sourceContentHash` for a run in which it kept a stored description instead of an unopposed crawled one (the rule lives in [`skills/scrapers/SKILL.md`](../skills/scrapers/SKILL.md)), because that decision reads the stored description, which is not a hash input, and recording the hash would freeze it so a later cleared description was never reconsidered.
Such an entity therefore re-extracts on every run until its pages or its stored description change (#2180).

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
A lock on `studentVisibilitySuppressionReason`, `activeAtYaleCache` or `yaleStatusCache` is refused outright and reported as `keep_gates_other_writer`, because those locks hold `ysmLabDelistingReconciler` and the roster-departure reconciler shut rather than holding a projection shut.
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

What the operation cannot reach is the 87 instances that pin a VALUE and carry no record.
They are fail-closed by design rather than overlooked: nothing on the row says whether a human judged that value or a script patched it, and the rule is that a lock re-opens on evidence it was a workaround, never on the absence of a record.
Reaching them needs a reclassification operation that establishes `lockedBy` from outside the row - the `websiteUrl` locks `repair-vanity-host-citations` wrote before it recorded a reason are the clearest candidate, because that writer is knowable with certainty - and that is separate authorized work rather than a widening of this sweep.

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
`dept-faculty-roster` deliberately does not qualify despite the identical emit shape: on a `profileBelongsToRosterPerson` mismatch it keeps the citation and drops only the enrichment, `labUrl` included, so a wrong-person refusal is indistinguishable from a delisting, and #2385 records that dropping that edge strands the real lab, which `observations:retarget-foreign-lab-websites` repairs rather than retracts.
`ysm-atoz-index` does not qualify for the opposite reason: a delisted lab vanishes from the index entirely, so it emits no witness and no partial read ever occurs, which is `ysmLabDelistingReconciler`'s cohort.

A field is only declarable when ingest cannot have dropped the value itself.
`assertDeclarableRetractionField` refuses every quality-guarded prose field, every list `observationFieldSanitizer` can empty, and every enum-validated field, and refuses a latest-wins field as a witness.
For those an ingest rejection and a retraction are indistinguishable downstream, so declaring one would let `isRegressiveProseRefresh` - a guard that exists to protect a good incumbent - become the trigger for deleting it.

Three guards, all failing closed:

- A complete read, not a run. A partial fetch, a content-hash skip, or an SSRF refusal emits no witness and licenses nothing.
- Two complete reads (`FIELD_RETRACTION_MIN_COMPLETE_READS`), mirroring the two-run rule in `facultyRosterDepartureReconciler` and `ysmLabDelistingReconciler`, so one anomalous parse cannot retract.
- A drop guard (`FIELD_RETRACTION_MAX_ABSENT_FRACTION`, 0.5), the inverse of the fraction those two lanes already use, over the entities that hold a live assertion for the field rather than over everything read. A broken selector stops asserting for every holder at once and persists across runs, so it defeats the two-read rule and only the cohort shape separates it from a handful of genuine delistings. Above the ceiling the whole (source, field) pair is frozen for the pass and reported; it is never applied partially. The fraction only applies above `FIELD_RETRACTION_DROP_GUARD_MIN_POPULATION` (20) holders, because three of five holders dropping a link is an ordinary month at that scale and a ceiling there would freeze small sources permanently while protecting nothing; below the floor the two-read rule and the operator's `--max-apply` ceiling are the bounds.

The stored value is cleared only when the retraction removed the last live observation for that field **and** the stored value is still the retracted one, folded through `normalizeWebsiteUrlIdentityKey`.
With rival evidence surviving, the resolver decides on the next materialization and clearing here would blank a field the corpus can still support.
That positive condition is also why this is not the same thing as adding the field to `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`: clear-on-empty reads an absence, so it would also unset a value whose backing observation was merely pruned, while this reads a retirement it performed itself in the same pass.
A locked field is skipped whatever its reason says.
Every row whose stored value is cleared goes back through `planStudentVisibilityGate`/`applyStudentVisibilityGatePlans`, because a row can be published because of the field being removed.

Two entry points. The sweep lane, `reconcileFieldRetractionsFromRun`, runs at the end of `materializeFromRun` after every entity has been projected, and is gated by `SCRAPER_FIELD_RETRACTION=true`; unlike the two older reconcilers, a dry run still plans and reports, because the drop-guard fraction has to be readable before a pass that deletes evidence is authorized.
The operator lane, `yarn --cwd server observations:reconcile-field-retractions`, needs no fresh scrape: the evidence that a field stopped being asserted is already in the log.
It is dry-run by default, and apply requires `--confirm-field-retraction` plus a planned count within `--max-apply` (default 200).
Retention bounds how far back witnesses reach - `observations:prune-dead` keeps the last 3 runs per source - and losing older witnesses only ever makes the lane more conservative.

### Grant-corpus research synthesis and PI-to-school inheritance

Grant-backed PIs (especially YSM/YSPH faculty whose `medicine.yale.edu/profile/*` pages are WAF-403-blocked) can be given real research coverage from the sanctioned government grant data we already ingest.
`research-entity:grant-corpus-synthesis` (`server/src/scripts/grantCorpusSynthesis.ts`, core in `grantCorpusSynthesisCore.ts`) selects non-archived entities that have `recentGrants` but no better-sourced description, aggregates the PI's grant corpus (each grant's title plus abstract across NIH RePORTER, NSF, NEH, USASpending, and DOE, contact-redacted, deduplicated, and bounded by the coverage synthesizer's own `MAX_COVERAGE_SNIPPETS`/`MAX_COVERAGE_SNIPPET_CHARS` limits), and reuses the grounded coverage synthesizer (`synthesizeCoverageDescription`, gpt-5-mini) to produce one clean, PI-level `fullDescription`.
An entity is skipped when an official non-grant source already carries a useful description, so a real profile always wins; the single-abstract grant fallback (`GRANT_ABSTRACT_DESCRIPTION_CONFIDENCE`, 0.35) does not.
That skip guard reads the same observation scope the materializer resolves from (`materializationReadScopeFilter` plus both the entityKey- and entityId-anchored rows), so a description a repair lane deliberately superseded no longer blocks recovery, and an entityId-anchored official description is still respected.
The synthesized description is written as a `grant-corpus-synthesis-llm` observation at `GRANT_CORPUS_DESCRIPTION_CONFIDENCE` (0.45), above the single-abstract fallback and below the weakest official-profile source, and it fails closed (no observation) when the output is not grounded in the grant text or does not clear the description-quality bar.
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

### Faculty roster departure detection is off, and has never run

`facultyRosterDepartureReconciler` is the only writer of `yaleStatusReasonCache: 'departed'` from roster absence.
It has never executed a decision in any environment, and three independent gates each stop it, in the order the code hits them (#2410).

1. `SCRAPER_FACULTY_DEPARTURE_DETECTION` gates the whole pass and is `false` by default.
It is now listed in `server/.env.example` so the lane is discoverable; before that it appeared nowhere outside the reconciler and its own test.
2. `departmentRosterHealth` observations are the reconciler's only input, and there were **0** in Beta and Production and **1** in Development when this was measured on 2026-09-05.
`departmentRosterScraper` emits one per configured department per run, so the input appears only after a roster sweep.
3. The department join. The health snapshot records the raw `DEFAULT_DEPT_CONFIGS` `deptName` while `research_entities.departments[]` stores the canonical `OrgUnit` name, so the reconciler now resolves the snapshot name through the catalog (`resolveGovernedDepartmentName`) instead of comparing two spellings.
Before that, 14 of 110 configs matched 0 entities each while their canonical spelling matched 316 governed entities.

Evidence that it never ran: `absentFromRosterSinceRunId` is written on the first absent run and `lastSeenInCompleteRosterAt` on every present run, both before any suppression, and both are 0 rows in Development, Beta, and Production.
Do not read `yaleStatusReasonCache: 'departed'` being 0 rows as "no departures were detected"; nothing was evaluated.

The pass returns a `FacultyRosterDepartureOutcome` naming why it did nothing (`disabled`, `no-roster-health-observations`, `no-authoritative-departments`, `reconciled`, and similar) plus the departments it governed and the snapshot names no `OrgUnit` names.
A department name that resolves to nothing is now an explicitly reported condition rather than a zero governed count, which is what made this dormancy invisible: a lookup miss and "this department genuinely has no entities" were the same observation.
`passesRosterDropGuard` still passes a zero governed count, which is correct once the join resolves: a genuine zero means the `governed` query returns no entity for that department, so the suppression loop cannot act on it.

A recorded `permanently_closed` marker outranks roster presence, whether an operator recorded it or the YSM lab delisting lane below did.
Since #2414 a recorded closure derives the same `yaleStatusReasonCache: 'departed'` this reconciler writes from roster absence, so the presence branch would otherwise read a marker it did not write as its own past output and clear it, and the relocation cohort the marker exists for is by definition the cohort still listed on a stale Yale roster.
`decideFacultyRosterDeparture` therefore takes `hasRecordedClosure` (from `hasRecordedClosureEvidence`) and downgrades `clear_departed` to `refresh_present`, still recording the last-seen fact.
The absent branch already no-ops on a `departed` reason, so it needs no equivalent check.

Enabling the lane is a separate, measured change: it can only remove research homes from the directory, so it needs a recomputed `computeResearchEntityStudentVisibility` served-tier diff over every row on Development and Production, not a flag count.

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

`client/src/utils/researchDetailSources.ts` mirrors the retiring-status set; changing the arms on either side requires updating the other copy.

A stored entry carries a second, independent axis: `privateAddressHost`.
It records that the URL's host resolves only into private address space, so nothing off the Yale network can route to it, and it is deliberately not a `healthStatus` value.
The two axes answer different questions: `healthStatus` asks whether the page exists, and for one of these hosts we never fetched the page at all, so it stays `UNKNOWN`.
Sharing the `UNKNOWN` bucket was the defect: `UNKNOWN` fails open, so a link no student off campus can open counted as a way in, and 29 served rows cited one (#2556).
Mislabelling it `UNAVAILABLE` instead would have been worse, because that axis is what the dead-citation retirement lanes read to delete a citation, and these pages are not gone.

Three consequences follow.
`isPubliclyUnreachableSourceUrl` is the predicate a way-in projection asks, and it is true when either axis disqualifies the citation; `officialNonGrantSourceUrl` uses it and falls through to a publicly reachable citation instead.
The citation itself is never deleted, because it is real provenance: the detail page keeps listing it with an on-campus-network-only qualifier, while `isUnreachableResearchWebsiteCtaUrl` stops it being offered as the research-website CTA or as the outreach official source.
Routing never expires and is only ever unlearned from positive evidence: a probe that came back with an HTTP status proves the host was publicly routable at that moment and drops the flag, while a timeout or transport error learns nothing about addressing and keeps it.

`sources:reclassify-private-address-hosts` (`server/src/scripts/reclassifyPrivateAddressCitations.ts`, dry-run-first, `--apply --confirm-private-address-reclassify`) is the stored-data half.
It resolves each distinct cited host once through the existing SSRF guard's `classifyHostnameResolution`, so the verdict comes from the resolved IP rather than from whether a fetch succeeded, and it re-gates every row it writes.
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
A `fullDescription` is clamped by length with `clampDescriptionLength`, but a `shortDescription` goes through `clampShortDescriptionToWholeSentences`: it keeps as many leading sentences as fit `MAX_SHORT_DESCRIPTION_LENGTH`, taken from the abbreviation-aware sentence tiling (`partitionSentencesForFiltering`) so a `Dr.`/`Prof.`/`etc.` period is not read as a sentence end, and when no run fits that rendering preference it keeps the run that fits the card's hard ceiling (`MAX_CARD_SHORT_DESCRIPTION_LENGTH`/`WORDS`) rather than deleting the line (#1878), failing closed to an empty card only when the leading sentence is itself past that ceiling.
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

Undergraduate logistics validation is claim-specific and independent from generic access validation.
`undergraduateLogisticsMaterializer.ts` accepts only versioned observations whose exact excerpt was verified on the recorded official public source page.
It materializes student level, compensation or credit, time commitment, modality, and current availability independently, with a short freshness window for availability and explicit stale or conflict withholding states.
No observation for a field means unknown, not false, unpaid, unavailable, in-person, or unrestricted.

For YSM lab entities, `ysm-atoz-index` uses the current official index at `https://medicine.yale.edu/about/a-to-z-index/lab-websites/`. It is not only an index discovery source: it fetches the official lab homepage and emits source-backed `fullDescription` and `shortDescription` observations from Yale's embedded page metadata when available. It follows an exact lab `Research Faculty` page link and emits a named `director` member only when that page has exactly one profile card; profile URLs are canonicalized to `medicine.yale.edu/profile/<slug>/`, and the scraper does not fabricate a `Researcher` when no existing match is available. Materialization records per-field provenance from the winning observation so detail pages can be audited back to the exact source URL.

Research-entity `sourceUrls` are durable home/profile/grant evidence pointers, not a dump of every supporting page. Materialization keeps raw observation evidence intact, but filters article, news, event, blog, podcast, video, and webinar paths out of materialized `sourceUrls` so content pages cannot make a valid lab or center look like a leaked article record.
Materialization also promotes a lead's official profile page into `sourceUrls` so the detail-page official-profile CTA can find it: `officialLeadProfileSourceUrl` picks the highest-confidence lead-identity observation (only `inferredPiUserId`/`inferredPiUserKey`/`inferredDirectorName`) whose `sourceUrl` passes `isLikelyOfficialPersonProfileUrl`, and materialization unions that URL in, deduped by `normalizeOfficialProfileDestination` and skipped when `sourceUrls` is manually locked (issue #613).
It is intentionally lead-scoped so roster and department entities do not flood `sourceUrls` with every cited profile.
Neither that projection nor the `bestMaterializationProvenanceSourceUrl` provenance projection may mint a citation the corpus already knows is gone, because an observation's `sourceUrl` is immutable and a removed profile page would otherwise be re-projected by every later materialization (issue #2567).
Both skip a candidate the entity's stored `sourceLinkHealth` records as dead and fall through in confidence order, the lead projection additionally refuses a candidate whose successor the entity already cites, and both refuse a person page belonging to somebody other than the person the entity's own citations establish as its own (issue #2945); `skills/scrapers/SKILL.md` owns those refusal rules.
`websiteUrl` derivation runs after that projection on the same pass, because it clears a profile-page `websiteUrl` the entity already cites and so has to see a freshly projected citation immediately instead of one materialization later (issue #2352); `skills/scrapers/SKILL.md` owns the website-derivation rules.
Our own site is never valid evidence for an entity, so self-referential URLs (`yalelabs.io` and the deploy hosts, per `isSelfReferentialUrl` in `utils/urlSafety`) are dropped defense-in-depth: `observationStore.appendObservations` fails closed and never stores them as provenance, `sanitizeResearchEntitySourceUrlsForMaterialization` strips them from materialized `sourceUrls`, and the served payloads filter them out server-side at read time via `isDisallowedResearchEntitySourceUrl` in `utils/researchHomeWebsiteUrl` (whose sibling arms reject the other never-servable URL classes, including index/listing roots, generic CMS/platform boilerplate hosts, and roots of shared multi-tenant academic hosts; `skills/scrapers/SKILL.md` owns that arm inventory) across group `sourceUrls`, access-signal source URLs, and undergraduate-logistics evidence, so bad sources stop rendering everywhere without a data write.
Group `sourceUrls` is narrowed at DTO output (`publicResearchEntitySourceUrls` in `researchEntityDto.ts`), which covers the list and detail payloads alike, while access-signal and undergraduate-logistics evidence are narrowed in their own assembly.
That placement is load-bearing rather than incidental: the served citations are also an input to the name sanitizers the DTO runs, so narrowing them in `publicResearchDetailGroup` first hid the shared academic host root from `servedPersonScopedDisplayName` and served the host organization's name as the detail heading (#2360).
Our own site is never valid evidence for an entity, so self-referential URLs (`yalelabs.io` and the deploy hosts, per `isSelfReferentialUrl` in `utils/urlSafety`) are dropped defense-in-depth: `observationStore.appendObservations` fails closed and never stores them as provenance, `sanitizeResearchEntitySourceUrlsForMaterialization` strips them from materialized `sourceUrls`, and the public `/research/:slug` payload assembly filters them out server-side at read time via `isDisallowedResearchEntitySourceUrl` in `utils/researchHomeWebsiteUrl` (whose sibling arms reject the other never-servable URL classes, including index/listing roots, generic CMS/platform boilerplate hosts, institutional advancement pages, and roots of shared multi-tenant academic hosts; `skills/scrapers/SKILL.md` owns that arm inventory) across group `sourceUrls`, access-signal source URLs, and undergraduate-logistics evidence, so bad sources stop rendering everywhere without a data write.
The shared-host arm is the only arm that reads the entity being served: group `sourceUrls` and access-signal URLs pass it, so a shared host's own organization keeps its root there while its tenants do not, and the undergraduate-logistics filter passes none, so it drops such a root outright.
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
The source is seeded disabled and owned by Yale Research data operations on a weekly cadence.
It was meant to stay disabled until `research-homes:audit-rosters` reported clean structure and a sampled precision review was recorded, but that audit was never built ([#2412](https://github.com/YaleComputerSociety/ylabs/issues/2412)), so the gate is currently a manual per-entity review rather than a report.

## Read-Only Control Plane

The first control-plane slice is the admin Operator Board. It remains read-only and does not replace CLI or cron execution. It should show:

- source readiness from seeded `Source` rows, recent `ScrapeRun` posture, expected artifacts, and next actions
- latest dry-run and write-run posture so operators can see whether Mongo writes need a follow-up Meili rebuild
- review queues split into repair blockers, review signals, and positive evidence signals
- release queue pressure from held visibility records, grouped by blocker and source
- discovery candidates from high-signal evidence queues that may be promotable after review
- WorkPlanner freshness policies for broad, paid, API-limited, or stale-sensitive sources
- manual gate commands for data quality, scraper integrity, and search sync posture

Pending Meili sync is an operator warning, not a worker. Local or one-off operator jobs may make Mongo current while Render-owned Meili remains stale; production promotion must explicitly rebuild or verify the prefixed production indexes before smoke checks.

The release queue is written by `yarn --cwd server student-visibility:gate`. Scraper `--auto-materialize`, manual materialize, and production cron paths run the gate after clean write materialization.

The gate recomputes visibility for the whole corpus on every run rather than tracking a version stamp.
A per-plan write guard, `isStudentVisibilityGatePlanMateriallyChanged`, means only records whose recomputed plan actually changes are written, so an unconditional recompute stays cheap in writes (issue #2044 retired the former `STUDENT_VISIBILITY_VERSION` stamp and its stale-version sweep in favor of this model; do not reintroduce a version).
After a clean cron materialization the runner (`server/src/scrapers/cronRunner.ts`) runs one full-corpus `--collection=all` apply gate before marking the source crawled, and the exhaustive Development sweep runs the same gate as its `visibility-gate` post-run stage.
The gate keeps search consistent itself (issue #1958): `applyStudentVisibilityGatePlans` re-reads the entities it changed and calls `syncEntities` so Meilisearch reflects the freshly applied tiers without waiting for a separate rebuild, in addition to the sweep's explicit `search-rebuild` stage. Standalone manual materialize writes require `--confirm-materialize` in addition to the existing scraper environment write guards; use `--dry-run --output <path>` first for review artifacts. Scheduled or manual global reconciliation should run the same command in dry-run mode first, then apply only with `--collection=all --mode=apply --confirm-student-visibility-apply --max-apply=<reviewedScannedCount>` under the existing environment write guards. For research entities, both public tiers require source-backed complete card copy plus source/lead identity quality; `limited_but_safe` means the record is usable but lacks action/access evidence, not that weak bios or sparse cards are allowed into public Beta.
The gate fails closed on an empty-roster state: once enough lead-requiring research entities are scanned and nearly all of them resolve zero canonical leads, apply is refused with an explicit blocker instead of mass-suppressing the directory, so an accidental recompute against a mid-migration empty roster cannot hide public records.
Recover by populating the canonical `Researcher` roster (re-materialize scraped sources or backfill legacy identities) and re-running the dry run before apply.
Only `runStudentVisibilityGate` enforces that guard, because `applyStudentVisibilityGatePlans` is the raw writer, so any script that plans and applies gate rows itself must evaluate `evaluateStudentVisibilityGateLeadResolution` first.
`retireAffiliatedOrgNameGrafts.ts` is such a script and does: renaming a record can add or drop a duplicate-risk suppression, so it re-gates and resyncs every record it corrects, and it reports a skipped re-gate rather than throwing once the document corrections are already durable.
Its scan is corpus-wide and the backlog it reports spans several issues at once, so `--slugs=<a,b>` scopes the WRITE to named rows while leaving the measurement whole; without it an apply landing one issue's fix silently carries every other pending row with it.
The `SHARED_HOST_ORGANIZATION` verdict is the #2360 arm: the row's name is the name of a shared academic host it cites, which the name axis cannot see (see `skills/scrapers/SKILL.md`).
The gate's own `syncEntities` call only covers records it actually wrote, so a lane that edits a roster without moving the tier, computed tier, or reasons produces no gate write and therefore no index refresh.
Such a lane has to resync itself: `retireForeignLeadGrafts.ts` re-reads its corrected entities and calls `syncEntities` after its re-gate, while `role-assignments:retire-surname-clash-lead-grafts` (#2768) does not, so a lead it detaches can still match the index `leadProfessorNames` and `professorNames` until the next rebuild.

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

Program audience is an honest label, not a suppression trigger. A graduate-only research program (`undergraduateOnly === false`) is a legitimate record: the gate records `graduate_relevant`, lets it reach the same tiers as an undergraduate-relevant program when it has a real non-portal official source and an application route, and surfaces it with a Graduate label rather than hiding it. Only catalog and administrative program pages (`not_undergraduate_relevant`) and non-research programs (`non_research_program`) stay `suppressed`. This applies to programs and fellowships only; research entities are never suppressed on undergraduate-relevance grounds.

`programClassifier.classifyProgram` holds the other half of that rule (issue #1926), because `studentFacingCategory` is stored rather than recomputed at serve time and `Archive / review` is a hard block on both public tiers. A graduate or professional audience alone therefore no longer routes a record to `Archive / review`: when `classifyProgramResearchRelevance` says the record is research-shaped it gets an honest graduate category (`Graduate research assistantship`, `Graduate research travel funding`, `Graduate collections research fellowship`, or `Graduate research funding`) with a matching `entryMode`, `undergraduateOnly: false` so the Graduate label still renders, and a `bestNextStep` that opens with the eligibility check. Only a graduate record with no research dimension, or one whose stated audience is researchers outside Yale, stays `Archive / review`.

`programs:backfill-classification` asserts and never retracts (#2910).
A recomputed classification only carries the optional fields it has evidence for, so an omission is the classifier having no opinion rather than a retraction; the classifier's only way to say "not undergraduate-only" is to assert `undergraduateOnly: false`, which lands in `$set` like any other value.
The script used to treat an omission as a clear and `$unset` stored `undergraduateOnly` / `yaleCollegeOnly`, which dropped rows out of the gate's `audienceKnown` branch: measured on Development a corpus-wide apply cost 77 rows their `student_ready` tier and also cleared 318 stored `compensationSummary` and 315 stored `programDates` values.
The write now sets only what the classifier asserts and reports the fields it left alone as `optionalFieldsRetained`.

A corpus-wide apply is also guarded rather than trusted.
The script projects every scanned row through the real `computeProgramStudentVisibility` before and after its planned write, reports `studentVisibility` (`studentReadyBefore`, `studentReadyAfter`, `publicTierLost`), and refuses to write anything when the run would cost a row its student-visible tier or reduce the `student_ready` count.
`publicTierLost` is counted per row against `publicStudentVisibilityTiers`, the single tier (`student_ready`) that `publicFellowshipFilter` actually serves, so a `student_ready` row demoted to `limited_but_safe` counts as a loss and no promotion elsewhere in the same run can net it away.
`--confirm-student-visibility-loss` is the only way past that refusal and the fellowship sweep stage never passes it, so an unattended pass cannot demote a served program row.
`--only-archive-review` still narrows the scan to stored `Archive / review` rows when the point of the run is to release records the classifier no longer archives.

The refusal is all-or-nothing and inspectable rather than silent.
A refused run still prints and writes its `--output` report with `mode: 'refused'`, the `visibilityRefusal` message, and a `demotedRows` list naming the rows that would leave the served tier, so the sweep's stage artifact records why nothing was written.
Sweep stages are independent, so a refused `classification-backfill` fails only its own stage and marks the sweep's post-run `failed`; the remaining backfills still run and the stage re-runs on the next resume.
To clear a blocked stage, read `demotedRows` in the stage artifact, fix the rows at the source (re-scrape or repair the evidence the gate is missing) or re-gate them with `student-visibility:gate --collection=programs --record-id=...`, and only run the backfill by hand with `--confirm-student-visibility-loss` once the demotions are the intended outcome.

What the guard does not cover is `studentFacingCategory`, which the classifier always has an opinion about and always overwrites.
Stored categories are richer than anything `classifyProgram` produces today, so a corpus-wide apply still flattens 66 served category labels on Development (for example `Senior research funding` to `Funding after mentor`) without moving any tier.
Read the dry-run `counts` before an apply and prefer a narrowed scan plus `student-visibility:gate --collection=programs --record-id=...` over a corpus-wide rewrite.

Deterministic card-copy repair is cleanup, not the launch-clearing loop. It may derive missing cards from source-backed descriptions, including official-profile prose such as `research is centered on`, `interests include`, `studies ... focusing on`, and `our work focuses on`, but rows with missing PI/action evidence or only directory/listing/grant/publication sources must be enriched from better official entity/profile pages before promotion. Do not use Cancer, WTI, Economics, English, department, or center listing pages, NIH/NSF award text, ORCID works, paper abstracts, DOI metadata, dataset records, source chrome, or teaching/course-only profile biographies as public research descriptions. Course titles such as `Writing about...` are not scholarship evidence unless surrounding prose explicitly describes the person's research, writing, curatorial, or field-focused scholarly work.

Search indexes `shortDescription` and `fullDescription`, so their quality is a first-order discovery lever. `yarn --cwd server research-homes:backfill-descriptions` has several lanes. The default deterministic short-description lane scans active research entities and, for every entity whose short is empty, equal to the full, or not a genuine distinct summary, derives a distinct short from the full via the shared `deriveShortDescriptionFromFullDescription` core (the same derivation the materializer applies, reused without changing it). It never fabricates or persists a short equal to the full, reports a before/after quality scorecard plus duplicate/templated full-description groups, and leaves thin or empty full descriptions as a re-scrape follow-up rather than inventing them. It is dry-run-first; apply requires `--confirm-short-descriptions` and is blocked against production unless `CONFIRM_PROD_SCRAPE=true`. The `--llm-rewrite` lane is the grounded LLM rewrite of description-blocked bios and stays gated behind `--confirm-research-descriptions` plus an explicit `--limit`. The `--llm-synthesis` lane reuses the repository's existing OpenAI chat-completions integration (gpt-5-mini, JSON output, contact redaction) to synthesize a clean short and full from the best available stored source text. Its prompt is entity-type-aware: for lab, center, institute, program, or project entities it describes what the research home studies rather than the PI biography, while for faculty-research-area and other person entities it describes that individual's research and drops the administrative CV framing. Output must be grounded in the source, pass the description quality bar, and classify as genuine research prose or it is rejected. A corpus run requires an explicit `--limit` to bound generation; a run scoped by one or more `--record-id=` is authoritative over that claimed set and processes every candidate in it without a `--limit`, which is what makes the lane usable as a single-writer, class-scoped repair tool. A scoped run also accounts for its claimed set: `claimedScope.unprocessed` names every claimed record id that produced no processed row and why (`absent-or-archived`, `not-a-candidate`, or `beyond-limit`), so an operator reading `updated` can reconcile it against the ids they passed instead of trusting a bare counter. Apply also requires `--confirm-llm-synthesis`, and writes durable `fullDescription` and `shortDescription` observations under `lab-microsite-description-llm` carrying the same sanitized pair the entity fields receive, so a later re-materialize resolves the synthesized prose rather than blanking it back to thin; apply fails closed when that source row is absent, because a bare field write is exactly the non-durable case. A row also fails closed, counted under `skipped`, when either description sanitizer collapses the accepted output to empty (`sanitized-empty`, applied in dry-run too so the projection matches an apply) or the observation store's own write-time prose guards drop either observation (`observation-dropped`), so a counted `updated` always means a field write backed by durable evidence rather than the bare write this lane exists to eliminate. It reports a token/cost projection from real usage plus before/after samples of the sanitized text that actually lands. The `--card-synthesis` lane (issue #557) targets the `missing_card_description` cohort - entities that already carry a genuine source-backed full description but no shippable one-line card - and resolves a card by trying the deterministic `deriveShortDescriptionFromFullDescription` first and, only when that returns nothing, a grounded LLM synthesis that condenses the entity's own full description into one sentence gated by a content-word grounding check plus the existing `shortDescriptionQuality` bar. The card quality bar is never relaxed and synthesis fails closed (returns empty) when not grounded or not quality-passing, so existing good cards are unchanged and only the empty-derivation gap is filled. It reports cards gained and how many would promote to `student_ready` (fresh visibility-gate reasons leave `missing_card_description` as the sole blocking reason via the canonical `isBlockingVisibilityReason` filter, so positive evidence reasons do not count against promotion); apply writes durable `shortDescription` observations plus the entity field, requires `--confirm-card-synthesis` plus an explicit `--limit`, and is production blocked. Scrape-time extraction of the lab-page description block is entity-type-aware in the same spirit (see the `lab-microsite-description-llm` notes below), so the research-home research prose is preferred over the stored PI bio.

For action-evidence repair, official deterministic department undergraduate research pages are the first repair lane before targeted LLM extraction. The `department-undergrad-research` source emits program records that materialize into `Fellowship` records on `/programs` (never a `PROGRAM` research entity, which no longer exists) plus undergraduate access evidence and guarded contact/application-route observations when the page itself supports them; generic guidance pages must not be materialized as active access `Signal` rows. Its per-faculty `physics-project-list` parser still yields `LAB` `ResearchEntity` evidence but no configured page uses it, so a run of this source produces no research entities. A page whose fetch or parse fails is skipped and recorded as a failed attempt in the run's `fetchMetrics` so the rest of the department pages still land, and the run fails only when every attempted page fails.

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

Description extraction should follow newly discovered official research-home websites before falling back to older profile/source URLs. `lab-microsite-description-llm` prefers non-profile `websiteUrl`/`website` values over profile source URLs, and non-profile official page descriptions carry higher confidence than profile-page descriptions so center/lab pages can replace biographical profile fallback copy. Profile-page extraction stays lower confidence and should not override better official research-home pages. The same non-profile microsite extraction also emits the research home's own real `name`/`displayName` at high confidence when the page states a proper or branded name, though it rejects governance/umbrella-org titles (Council, Committee, Consortium, Commission, Task Force, Working Group, Senate, Assembly, Office of, Board of) that are never a lab's own branded name so a shared center landing page cannot overwrite distinct person-lab names (#785), and the broader identity refusal it shares with every other source is enforced at the materialize, serve, and search-index choke points rather than here (see `personScopedResearchEntityNameNamesSomethingElseByUrlPath`, #2234/#2351), while the NIH/NSF grant scrapers emit their `<PI> Lab` fallback only as a low-confidence placeholder, so any real-name source wins during field resolution. Selecting the embedded lab-page description block is entity-type-aware: for lab, center, institute, program, or project entities it picks the research home's research prose and rejects the PI biography, administrative CV, and welcome/navigation boilerplate, while for faculty-research-area and other person entities it keeps a research-focused bio; a page that offers no research-focus prose yields no description rather than materializing a stub. When the path emits a good `fullDescription` but no card, it also ships a grounded one-line `shortDescription` at ingestion (issue #557): it synthesizes a card grounded in that same full description and gated by the `shortDescriptionQuality` bar. When prose yields no groundable, quality-passing summary, the materializer falls back to a deterministic card built from the entity's own trusted `researchAreas` (oxford-joined, capped at four topics, gated on shape rather than full-description grounding), and only when no clean structured topic survives does it fail closed to no card rather than a weak one (issue #952). The same quality bar now rejects vacuous generic summaries such as `Studies the field.` unconditionally, so a bare verb-plus-generic-noun template can never win over an entity's already-populated `researchAreas`. One unreachable or broken page must be logged and skipped without aborting the remaining bounded extraction batch.

Card-copy derivation may treat later official-profile project prose as usable research evidence when the sentence itself is explicit, such as `research aimed at`, `presently working on`, or `Co-Principal Investigator on a grant`. It may also summarize narrow official lab homepage phrasing such as `lab research focus extends through diverse areas...`, `our research program uses...`, `our lab is focused on...`, `mission is to enhance...`, `working group aims to...`, or `seek to decrease...` when the source text names a concrete research method/domain. Keep these patterns narrow: the biography or appointment lead is still ignored, and the derived card should summarize the later research/project sentence rather than copying title, retirement, degree, directory chronology, book pages, teaching-only profiles, or page chrome.

Launch trust is checked with `yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --strict`.
This is a read-only contract audit over the visibility gate.
It fails launch if visible records are not launch-grade.
The report keeps its violation sample bounded to 50 rows and lists current public visibility violations before ordinary held rows so every exposed invalid record remains actionable when the held backlog is larger than the sample.
Use the returned repair lanes and commands as the fix plan, then re-run the visibility gate and contract audit.

YSM A-to-Z lab records use full-name PI inference when the lab name includes first-name context, such as `Ya-Chi Ho Lab`. The entity materializer converts accepted `inferredPiUserId` observations into canonical PI `RoleAssignment` rows so public detail pages and visibility computation share the same lead evidence.

Grant-source PI matching must remain conservative because award APIs are funding evidence, not official Yale profile identity evidence.
NSF PI matching requires exact last name plus an exact match on the leading given-name token, then exact last name plus first-name prefix; a bare source initial never binds to a same-initial namesake and fails closed instead (issue #562).
Matching the leading token rather than the whole given string recovers a surname particle or compound-surname part that `splitName` mis-parsed into the given field (`Frank van den Bosch`, `Oswaldo Chinchilla Mazariegos`), but it still fails closed on a differing leading token (`Charles` vs `Patrick`) or a goes-by-a-different-given-name profile (`Ann Carla` to `Carla` stays closed).
Do not match a full source given name to a different Yale first name by initial alone, such as `Leying Guan` to `Lawrence Guan`.
NIH PI matching applies the same leading-given-token rule; a lab named only after a surname (`Arnsten Lab`) never attaches a PI on the surname alone, because a shared surname can identify the wrong person, so it fails closed to ambiguity whenever any surname-compatible Yale faculty exists and to absence when none match (issue #562).

The shared canonical-home resolver distinguishes a safe absence of memberships from one canonical official home and ambiguous or ineligible memberships.
Grant scrapers create a synthetic shell only for the safe-absence case and emit no research-home observations for ambiguity, archived or grant-only candidates, or other ineligible memberships.
Canonical-home enrichment emits grant evidence without replacing official identity or source URL fields.
Ambiguous Yale user matches and archived or non-current lead memberships are ineligible, not safe absences.
At materialization, only each source's latest grant snapshot participates.
The public grant display is a recency-sorted, deduplicated union capped at ten records, while `recentGrantCount` sums the independent latest source totals without applying that display cap and funding agencies are unioned across sources.

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
All eight now sit in `RETIRED_SOURCE_NAMES` and carry the retirement marker, alongside `lab-microsite-llm` and `ylabs-listing`, the three one-time `root-yale-*-json` imports, and the `holdfix-second-opinion*`, `official-profile-enrichment`, `research-entity-cache-backfill`, and `yale-directory-csv` lanes whose writing code is no longer in the tree.
Retirement changes the row only; their stored observations and scrape runs stay as evidence of what they once asserted.

### Source dispatch and the freshness worklist (#2619)

`server/src/scrapers/sourceDispatch.ts` sorts every `Source` row into `sweep-registered`, `script-driven`, `retired`, or `unowned`.
`buildOrchestrator()` is the authority for the first: the CLI, the cron, and the sweep all resolve a name through it, so a row it does not name fails with "No scraper registered with name" no matter what the row says.
`scrapers:audit-freshness` therefore computes overdue and never-crawled over sweep-registered rows only, reports script-driven lanes next to the command that runs each one, lists retired rows separately, and fails rather than reporting phantom work when a registered scraper has no row, a row is `unowned`, or a retired lane's row is still enabled.
Admin source health reads the same classification, so a retired row is `ok` with its retirement stated rather than a warning asking an operator to confirm a decision the repo already made, and a script-driven lane with no scrape run names its command instead of suggesting a crawl that would fail.
Every scraper in `registry.ts` must also have a `seedSources.ts` entry, because applying the seed is the only remediation the audit's missing-row block accepts.

## Canonical Collections

Runtime research discovery is centered on:

- `research_entities`
- `role_assignments` (roster, joined to `researchers`)
- `researchers`
- `accounts` (login principal)
- `signals`
- `research_entity_relationships`
- `research_entity_redirects` (durable shell-to-canonical merge redirects; keeps deduped entities from re-minting on re-scrape)
- `research_plans`
- `users` (legacy identity/profile store; still the primary write target for most identity fields pending retirement, see `docs/research-model.md#legacy-user-residue`)
- `fellowships`
- `sources`
- `scrape_runs`
- `observations`

The `signals` collection holds typed `Signal` rows and consolidates the former `access_signals` and `undergraduate_logistics_claims` collections; each former access `signalType` and each logistics claim type is now its own `Signal.type`.
Transitional note: until the human-gated `signalConsolidationMigration` is applied, the legacy `access_signals` and `undergraduate_logistics_claims` collections may still hold un-migrated rows, so reconciliation and copy work should account for all three until the migration completes.

The legacy `research_groups` collection is intentionally absent after the hard `ResearchEntity` migration and should not be used as a data-health signal.

## Promotion Invariants

Before production promotion:

- The accepted Beta dataset must have zero blocking referential errors across canonical collections.
- Source reports must show `materialization.errors = 0`, or any nonzero count must block promotion for that source.
- Known warnings must be documented in the promotion's GitHub issue before promotion.
- Production must have a fresh Atlas backup or restore point before any copy or write.
- The operator must choose exactly one promotion lane: accepted Beta copy or guarded production delta.
- Meilisearch must be rebuilt or synced after accepted Mongo writes.
- Recurring scraper jobs stay disabled until the manual production gate and smoke checks pass.

The operator decision packet in [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md) is the promotion record for lane, backup/restore point, rollback owner, smoke owner, accepted warnings, run IDs, and rollback drill status. Do not infer a lane from pipeline state alone; the operator must fill the packet before production writes or copy operations.
The presence of that packet is not acceptance by itself; blank fields mean the production gate is blocked.

### Undergraduate logistics release audit

Run the read-only logistics audit after a bounded Beta acquisition and before broad or recurring acquisition:
During staging, the microsite scraper emits logistics observations only when `--only` supplies an explicit allowlist of at most 25 unique slugs.
Runs without that allowlist ask the same prompt and simply write no logistics observation: #2055 retired the separate `legacy-v1` prompt, response format, and cache namespace, so the emit-side filter on the `undergraduateLogistics` field prefix is the only gate.

```bash
SCRAPER_ENV=beta yarn --cwd server undergraduate-logistics:audit \
  --sample-size=25 \
  --minimum-precision=0.95 \
  --output=/tmp/ylabs-undergraduate-logistics-audit.json
```

The artifact reports coverage separately for every claim type and separates known, unknown, stale-under-review, and conflicting-withheld states.
Review every deterministic sample against its linked official page, then provide a JSON decision file with this shape:

```json
{
  "decisions": [
    {
      "claimHandle": "20-character-handle",
      "correct": true,
      "reason": "The exact excerpt supports the normalized claim."
    }
  ]
}
```

Re-run the command with `--decisions=/tmp/ylabs-undergraduate-logistics-decisions.json`.
Broad release remains blocked unless `precision.releaseReady` is true and the coverage, rejection, stale, and conflict totals are understood.
Do not treat low coverage as negative evidence.

## Rollback Drill Expectations

Rollback drills are dry-run-only until an operator approves production action:

- Lane A accepted Beta copy: identify the Production backup or point-in-time restore timestamp, the copied collection set, the Atlas restore owner, and the Meilisearch rebuild sequence.
- Lane B guarded production delta: identify the source to disable, the plan to stop additional source runs, the pre-run backup or restore point, and the threshold for restoring broad bad materialization.
- A bad logistics acquisition run can be isolated with `yarn --cwd server undergraduate-logistics:rollback --run=<scrapeRunId> --output=/tmp/ylabs-undergraduate-logistics-rollback.json` before apply mode is considered.
- Approved apply mode adds `--apply --confirm-undergraduate-logistics-rollback`, marks only that run's logistics observations as rolled back, restores the newest eligible predecessor observations, and rematerializes affected entities from the remaining evidence.

## Retention Posture

Compact observation retention must preserve every source observation referenced by an undergraduate logistics claim.
Follow the reviewed dry-run-first retention procedure in `docs/scraper-deployment-runbook.md`; the exact source observations remain the audit backbone for student-facing logistics claims and claim-local rollback.

`observations:prune-dead` (`server/src/scripts/pruneDeadObservations.ts`) is the committed, gated dead-data prune used for mid-run and on-demand storage reclamation.
It deletes observations that are both superseded and unreferenced regardless of age, reusing the same `observationRetention.ts` primitives (`buildSupersededObservationPruneFilter` with `cutoff = now`, plus `buildObservationReferencePipeline` over `OBSERVATION_REFERENCE_SPECS` to protect every referenced observation id), and can optionally drop the `scrape_snapshots` fetch cache with `--drop-snapshot-cache`.
Dropping the age floor does not drop run retention: the dead prune keeps the last 3 runs per source (`keepRuns`, same default as the compact prune) so the immediately preceding run's superseded observations survive.
Those predecessors are exactly what `undergraduate-logistics-rollback` restores, and `OBSERVATION_REFERENCE_SPECS` protects only the newer target of `supersededBy`, so without run retention a single prune would silently destroy claim-local rollback for the last run.
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
