# Research Data Pipeline

Status: active operator reference

Last updated: 2026-08-26

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
  -> beta repair queue applies deterministic trusted-source repairs and re-gates records
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
3. `url-identity-dedupe` (opt-in, only when `SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES` is set)
4. `visibility-gate` (`student-visibility:gate --collection=all --apply`)
5. `search-rebuild` (`meili:rebuild-research-entities --clear`)
6. `coverage-audit`
7. `data-quality` (`beta:data-quality --strict`)
8. `integrity-gate` (`scraper:integrity-gate --include-claim-gate`)
9. `trust-contract` (`launch:trust-contract --mode=student-ready-only --strict`)
10. `archived-cleanup` (`research-entity:cleanup-archived --merge-residue-only`; residue is deleted by default in Dev sweeps, disable with `SCRAPER_SWEEP_DELETE_MERGE_RESIDUE=0`)
11. `dead-data-prune` (`observations:prune-dead --apply`; opt-in, only when the sweep is run with `--prune-between-phases`)

The `researcher-dedupe`, `eponymous-fra-merge`, and merge-residue deletion stages run by default on the two exhaustive Development modes so the Dev pipeline auto-dedupes every run. Each can be disabled independently by setting its environment flag to a falsey value: `SCRAPER_SWEEP_DEDUPE_RESEARCHERS`, `SCRAPER_SWEEP_AUTO_MERGE_FRA`, and `SCRAPER_SWEEP_DELETE_MERGE_RESIDUE`. The `url-identity-dedupe` stage is opt-in and stays off unless `SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES` is set to a truthy value, so a routine sweep never silently merges by shared profile URL. Every `SCRAPER_SWEEP_*` stage flag in either engine parses through the one shared helper pair in `server/src/scripts/sweepStageFlags.ts`, so the accepted truthy values (`1`, `true`, `yes`, `y`, `on`, `enable`, `enabled`) and falsey values (`0`, `false`, `no`, `n`, `off`, `disable`, `disabled`) are identical for every flag. These post-run stages never run on Beta or Prod sweeps, so those paths are unaffected.

The post-run chain is defined once as a declarative registry (`DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS` in `runScraperSweep.ts`, issue #2050): each stage owns its command, args builder, enable predicate, and optional typed result contract, and both the plan builder and the runner derive from it.
A stage that declares a result contract but exits successfully without a readable, valid result artifact fails loud rather than silently dropping its delta.

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
Every stage that takes an `--output` path is held to a report contract: a stage that exits successfully without a readable, valid JSON report at the path recorded in `summary.json` fails loud, and a stage that writes no report records no `artifactPath` at all.
`official-sources-backfill` is opt-in via `SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET=1` because `programs:backfill-official-sources` is not a general recomputation: with no `--input` it replays the committed one-shot curated change-set at `server/src/scripts/data/programOfficialSourceBackfill.json`, so running it on every sweep would overwrite each listed record's freshly scraped `sourceUrl` with a frozen hand-researched value.
`catalog-refresh` is off by default because `fellowships:refresh` only accepts a `beta` or `prod` target and refuses any target that does not match `SCRAPER_ENV`, so no Development sweep mode can satisfy it; it is opt-in via `SCRAPER_SWEEP_REFRESH_FELLOWSHIPS=1` plus `SCRAPER_SWEEP_FELLOWSHIP_REFRESH_TARGET` and `SCRAPER_SWEEP_FELLOWSHIP_REFRESH_RESTORE_TOKEN`, and stays skipped (with a logged reason) unless all three are set *and* the requested target matches the sweep mode's own target, so opting in during a Development sweep skips the stage instead of failing it.
The restore token reaches `fellowships:refresh` through the child environment (`FELLOWSHIP_REFRESH_RESTORE_TOKEN`) rather than argv, so it never appears in the host process table.
No `Fellowship`/`/programs` Meilisearch rebuild stage is wired because there is no programs search-index script; `researchEntity` is the only Meilisearch-syncable type.
The beta modes (`beta-plan`, `beta-fetch`) still run `RESEARCH_SWEEP_SOURCES` only; a beta fellowship sweep is a possible follow-up.
The two engines can therefore be scheduled, gated, and reasoned about on independent cadences.

### Faculty Researcher spine creation

There is no standalone faculty-projection sweep stage, and adding one back would contradict the current identity policy.
A `Researcher` spine is created only where a research signal already attaches to the person: `canonicalMembershipMaterializer` resolves-or-creates the `Account` and the thin `Researcher` together while materializing a canonical membership, and the ORCID branch of the same path creates an accountless `Researcher` for an identity that carries a valid ORCID.
The `user`-observation path in `entityMaterializer` never mints a person: a bare directory identity that reaches no existing researcher by netid, name, or email is refused with `skipped('directory-identity-without-research-signal')` (issue #2129), so it enriches an existing `Researcher` but never creates one.
The retired `research-entity:project-faculty` stage did the opposite, minting a spine for every active faculty row regardless of research signal, and it read the `User` model that issue #2014 retired.
Its removal is therefore intentional rather than a lost capability; see [`research-model.md`](research-model.md) for the identity-join and netid-stamping rules.

### Eponymous FRA-to-lab merge and durable redirects

The `eponymous-fra-merge` sweep stage (`research-entity:merge-eponymous-fra`, on by default in Dev sweeps, disable with `SCRAPER_SWEEP_AUTO_MERGE_FRA=0`) collapses only the high-confidence eponymous case: a `faculty-research-area-*` shell that shadows the same PI's concrete lab home.
Selection filters to the `profile_area_shell_with_concrete_home` dedupe category and refuses a `CENTER`/`INSTITUTE` canonical (issue #1957), then relinks references onto the canonical, recomputes student visibility, and force-resyncs the canonical to Meilisearch.
Every merge records a durable `ResearchEntityRedirect` (`researchEntityMergeRedirectService.ts`) keyed on the shell slug/id and pointing at the live canonical, so a later re-scrape resolves the old shell to its canonical instead of re-minting a duplicate; resolution follows redirect and `canonicalGroupId` chains and never depends on the shell row still existing.
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

### Ingest-time observation-store guards

`observationStore.appendObservations` (`server/src/scrapers/observationStore.ts`) is the single ingest choke point, and it applies several guards before any observation is stored:

- Ingest sanitization runs `observationFieldSanitizer` over every field from every source so page furniture, contact leakage, and chrome cannot enter a stored field (#1375).
- Supersession keys on `observationFingerprint`; fields in `LATEST_WINS_FINGERPRINT_FIELDS` (including the first-class `methods` field, see below) omit `value` so a fresh snapshot supersedes the prior one despite content drift.
- The regressive-prose guard `isRegressiveProseRefresh` (#2035) protects the quality-guarded prose fields (`fullDescription`, `shortDescription`): when the incoming value is judged not useful by the description-quality checks but an active same-`(source, entity, field)` value is useful, the incoming observation is dropped, so a degraded re-scrape can never overwrite a clean source-backed description.
- Clean-to-clean refreshes are guarded too as of #2232: `isWeakerProseRefresh` drops an incoming prose value that IS useful but scores strictly lower on `prosePreferenceScore` than the clean incumbent it would displace.
  That comparison is necessary because every known regression in this class passes `fullDescriptionQuality` with zero flags, so the subtractive `isUseful` verdict cannot rank two flag-free candidates and the winner fell to the confidence gap alone (0.82 for a non-`/profile/` capture against 0.55 for official-profile extraction), which is how a mission statement displaced grounded research prose and served silently for months.
  Ties pass, so a refresh must be demonstrably worse to be dropped rather than merely not better: an ordinary same-quality re-scrape keeps newest-wins and the corpus cannot freeze on its first capture.
  `prosePreferenceScore` sums only the off-topic demotions of `offTopicResearchHomeDemotionScore` (navigational, recruiting, mission: mission -20, recruitment -30, research 0) and deliberately not the full `scoreResearchHomeDescriptionCandidate`.
  An observation carries an `ObservedEntityType` (`researchEntity`, `user`), never the product entityType or kind that says whether the home is a lab or a faculty research area, so the kind-aware person-centric term would resolve to `organization` for every home and charge legitimate person-voiced faculty research prose -100, ranking it below a mission statement at -20 and inverting the comparison.
  The resolver still applies the kind-aware score downstream, where the product kind is known.
  Do not substitute `researchSubjectSpecificityScore` either: it saturates at 8.00 across a mission statement, a recruitment notice, a figure caption, and real research prose alike, because it grades a short extracted subject phrase rather than a paragraph.
  `collapseLatestWins` applies the same comparison, because under `C4_LOSSLESS_INGEST` the write-time guard is skipped and a pure newest-wins collapse would reinstate the regression; it folds each key's rows oldest-first because callers read the log unsorted, so folding in array order would make the comparison depend on the query plan.
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

### Grant-corpus research synthesis and PI-to-school inheritance

Grant-backed PIs (especially YSM/YSPH faculty whose `medicine.yale.edu/profile/*` pages are WAF-403-blocked) can be given real research coverage from the sanctioned government grant data we already ingest.
`research-entity:grant-corpus-synthesis` (`server/src/scripts/grantCorpusSynthesis.ts`, core in `grantCorpusSynthesisCore.ts`) selects non-archived entities that have `recentGrants` but no better-sourced description, aggregates the PI's grant corpus (each grant's title plus abstract across NIH RePORTER, NSF, NEH, USASpending, and DOE, contact-redacted, deduplicated, and bounded by the coverage synthesizer's own `MAX_COVERAGE_SNIPPETS`/`MAX_COVERAGE_SNIPPET_CHARS` limits), and reuses the grounded coverage synthesizer (`synthesizeCoverageDescription`, gpt-5-mini) to produce one clean, PI-level `fullDescription`.
An entity is skipped when an official non-grant source already carries a useful description, so a real profile always wins; the single-abstract grant fallback (`GRANT_ABSTRACT_DESCRIPTION_CONFIDENCE`, 0.35) does not.
That skip guard reads the same observation scope the materializer resolves from (`materializationReadScopeFilter` plus both the entityKey- and entityId-anchored rows), so a description a repair lane deliberately superseded no longer blocks recovery, and an entityId-anchored official description is still respected.
The synthesized description is written as a `grant-corpus-synthesis-llm` observation at `GRANT_CORPUS_DESCRIPTION_CONFIDENCE` (0.45), above the single-abstract fallback and below the weakest official-profile source, and it fails closed (no observation) when the output is not grounded in the grant text or does not clear the description-quality bar.
The materializer then derives the grounded `shortDescription` (`resolveMaterializedShortDescription`) and canonical `researchAreas` (`applyDescriptionResearchAreaDerivation`) from that description on the same pass, so no separate research-area LLM call is needed.
The lane is dry-run-first, bounded by `--limit`, and apply is Development-only and requires `--confirm-grant-corpus-synthesis`; the source must be seeded first (`scrape:seed-sources`).

PI-to-school inheritance runs as a materialize-time step in `entityMaterializer.inheritSchoolFromLeadPi`, right after the inferred PI/director membership is resolved.
It applies to every research entity that carries no school facet at all, which in practice is the grant-derived shell population: when both the scalar `school` and `schools[]` are empty, exactly one current lead (PI or director) resolves to a single `Researcher`, and that researcher's department (from `Researcher.profile.primaryDepartment` or the linked `Account.department`) resolves to a real department `OrgUnit` whose parent chain reaches a school, the entity inherits that school and, when it has no departments of its own, the canonical department name too.
The lead's department must itself canonicalize and must itself have a parent school, so a raw HR appointment string never lands in the student-facing `departments[]` facet and a school that only fell out of the entity's own pre-existing departments is never reported as inherited.
The write goes through `applyResearchEntityOrgUnitCanonicalization` and records `fieldProvenance.school`/`confidenceByField.school` under `lead-pi-school-inheritance`, so the inherited school is attributable in admin and audit surfaces.
It honors `manuallyLockedFields`, never overwrites an existing school or `schools[]`, and skips the multi-PI org kinds (`center`/`institute`/`program`) so one director can never guess a whole cross-school center's school.
It fails closed on every other outcome (locked, an existing school facet, ambiguous or missing lead, no department, or a department that does not canonicalize to an `OrgUnit` with a parent school), so a wrong school is never guessed.
This closes the "grant-derived shells have no school" gap on the same engine pass that closes the description gap, and stays correct on re-runs.

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

A human-recorded `permanently_closed` marker outranks roster presence.
Since #2414 a recorded closure derives the same `yaleStatusReasonCache: 'departed'` this reconciler writes from roster absence, so the presence branch would otherwise read a human marker as its own past output and clear it, and the relocation cohort the marker exists for is by definition the cohort still listed on a stale Yale roster.
`decideFacultyRosterDeparture` therefore takes `hasRecordedClosure` (from `hasRecordedClosureEvidence`) and downgrades `clear_departed` to `refresh_present`, still recording the last-seen fact.
The absent branch already no-ops on a `departed` reason, so it needs no equivalent check.

Enabling the lane is a separate, measured change: it can only remove research homes from the directory, so it needs a recomputed `computeResearchEntityStudentVisibility` served-tier diff over every row on Development and Production, not a flag count.

### Faculty-research-area profile research synthesis

A `FACULTY_RESEARCH_AREA` usually has no lab site, so its only source is the professor's official Yale profile page, which states the research but interleaves it with credentials, so no contiguous verbatim span carries it and extraction can only copy the biography.
`research-entity:fra-profile-synthesis` (`server/src/scripts/fraProfileSynthesis.ts`, pure logic in `fraProfileSynthesisCore.ts`, per-entity DB step in `fraProfileSynthesisLane.ts`) serves that cohort: for unlocked, non-archived `FACULTY_RESEARCH_AREA` entities whose stored description is a career biography and which have a profile source URL, it harvests the page's research sentences, drops career, credential, and navigation sentences, and reuses the same grounded coverage synthesizer the grant-corpus lane uses.
Selection asks whether the served description states career facts (degrees earned, appointments, honours), not whether it reads as person prose: `isCareerBiographyDescription` in `server/src/utils/careerBiographyDescription.ts` owns that predicate, and name-framed research prose ("Dr. Sauler's research investigates mechanisms of lung injury") is good copy that must never be rewritten.
An entity is skipped as already served when it has a recorded non-synthesis description that is not a career biography, clears the description-quality bar, **and** actually describes research (`describesResearchFocus`), so clinical-service or committee prose does not count as a research description the lane should stand down for.
The output is written as an `fra-profile-research-synthesis` observation at `FRA_PROFILE_SYNTHESIS_CONFIDENCE` (0.48), above the grant-corpus lane because a professor's own profile is the better authority on their research and below official-profile extraction so a genuine verbatim research statement still wins, and the lane fails closed when the output is not grounded, still reads as a person biography, keeps a dangling pronoun subject, or no longer clears the description-quality bar.
Confidence alone cannot displace the biography, since official-profile extraction re-emits it weekly at a higher weight, so `confidenceResolver` sorts biography `fullDescription` groups last once this lane has recorded a useful non-bio value for the entity; the bio is demoted rather than dropped, so an entity with only a bio still serves it.
That demotion covers person-voiced prose and career biographies alike, because a demotion narrower than the lane's selection predicate would leave the selected cohort undemotable and the lane reporting success while the biography stayed served.
The lane is dry-run-first, bounded by `--limit`, needs `OPENAI_API_KEY`, and apply is Development-only and requires `--confirm-fra-profile-synthesis`; the source must be seeded first (`scrape:seed-sources`).
The rest of the contract, including the measurement harness and the traps this lane already paid for, lives in [`skills/scrapers/SKILL.md`](../skills/scrapers/SKILL.md).

### One serve-time description sanitizer

Every HTTP path that serves research-entity copy runs one canonical function, `sanitizeServedResearchEntityCopyFields` in `server/src/utils/researchEntityDescriptionText.ts`.
It composes the full guard union in a fixed, idempotent order: the text-transform layer (subjectless-lead repair, first-person re-voicing, mismatched-name-prefix correction, the non-person-org biography guard, and the `publicResearchEntityDescriptionText` fail-closed gate), then the faculty and research-home self-reference relabel passes, then the `descriptionHygiene` layer (chrome and dump stripping, contact-block/publications/center-blurb/HTML fail-close, and the per-field length clamps).
The two prose fields clamp differently, because a card line has to load whole (#2184).
A `fullDescription` is clamped by length with `clampDescriptionLength`, but a `shortDescription` goes through `clampShortDescriptionToWholeSentences`: it keeps as many leading sentences as fit `MAX_SHORT_DESCRIPTION_LENGTH`, taken from the abbreviation-aware sentence tiling (`partitionSentencesForFiltering`) so a `Dr.`/`Prof.`/`etc.` period is not read as a sentence end, and it fails closed to an empty card rather than emitting a truncation fragment when nothing whole fits.
The kept text must also clear the same eight-word floor `shortDescriptionQuality` applies to a card, so the clamp can never hand back a line the card gate would reject as too short; that floor is also what rejects a bare name-initial lead such as `J.`, which the tiling does not protect.
A stored short that already ends in a trailing ellipsis fails closed at the same sanitize boundary for the same reason: `shortDescriptionQuality` rejects a trailing ellipsis as a fragment, so serving one would gate the entity on the exact copy it is being shown.
Both the DTO card field and `resolveServedShortDescription` then recover a quality-checked line derived from the entity's own full description instead.
The public research-entity DTO (`toPublicResearchEntityDto`, `toPublicResearchEntitySummaryDto`) routes through it, so browse and search cards get the same guard set the detail page already applied, rather than the `descriptionHygiene` subset alone.
One guard here is not about copy: the same function withholds a person-scoped record's `displayName` when that name identifies an umbrella organization the person merely belongs to or another person's lab, so every surface falls back to `name` (`personScopedResearchEntityNameNamesSomethingElse`, #2234/#2351).
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
`websiteUrl` derivation runs after that projection on the same pass, because it clears a profile-page `websiteUrl` the entity already cites and so has to see a freshly projected citation immediately instead of one materialization later (issue #2352); `skills/scrapers/SKILL.md` owns the website-derivation rules.
Our own site is never valid evidence for an entity, so self-referential URLs (`yalelabs.io` and the deploy hosts, per `isSelfReferentialUrl` in `utils/urlSafety`) are dropped defense-in-depth: `observationStore.appendObservations` fails closed and never stores them as provenance, `sanitizeResearchEntitySourceUrlsForMaterialization` strips them from materialized `sourceUrls`, and the public `/research/:slug` payload assembly filters them out server-side at read time via `isDisallowedResearchEntitySourceUrl` in `utils/researchHomeWebsiteUrl` (whose sibling arms reject the other never-servable URL classes, including index/listing roots, generic CMS/platform boilerplate hosts, and roots of shared multi-tenant academic hosts; `skills/scrapers/SKILL.md` owns that arm inventory) across group `sourceUrls`, access-signal source URLs, and undergraduate-logistics evidence, so bad sources stop rendering everywhere without a data write.
The shared-host arm is the only arm that reads the entity being served: group `sourceUrls` and access-signal URLs pass it, so a shared host's own organization keeps its root there while its tenants do not, and the undergraduate-logistics filter passes none, so it drops such a root outright.

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
The source is seeded disabled and owned by Yale Research data operations on a weekly cadence until `research-homes:audit-rosters` reports clean structure and a sampled precision review is recorded.

## Read-Only Control Plane

The first control-plane slice is the admin Operator Board. It remains read-only and does not replace CLI or cron execution. It should show:

- source readiness from seeded `Source` rows, recent `ScrapeRun` posture, expected artifacts, and next actions
- latest dry-run and write-run posture so operators can see whether Mongo writes need a follow-up Meili rebuild
- review queues split into repair blockers, review signals, and positive evidence signals
- release queue pressure from held visibility records, grouped by blocker and source
- discovery candidates from high-signal evidence queues that may be promotable after review
- WorkPlanner freshness policies for broad, paid, API-limited, or stale-sensitive sources
- manual gate commands for data quality, scraper integrity, and search sync posture

Pending Meili sync is an operator warning, not a worker. Local or VPN jobs may make Mongo current while Render-owned Meili remains stale; production promotion must explicitly rebuild or verify the prefixed production indexes before smoke checks.

The release queue is written by `yarn --cwd server student-visibility:gate`. Scraper `--auto-materialize`, manual materialize, and production cron paths run the gate after clean write materialization.

The gate recomputes visibility for the whole corpus on every run rather than tracking a version stamp.
A per-plan write guard, `isStudentVisibilityGatePlanMateriallyChanged`, means only records whose recomputed plan actually changes are written, so an unconditional recompute stays cheap in writes (issue #2044 retired the former `STUDENT_VISIBILITY_VERSION` stamp and its stale-version sweep in favor of this model; do not reintroduce a version).
After a clean cron materialization the runner (`server/src/scrapers/cronRunner.ts`) runs one full-corpus `--collection=all` apply gate before marking the source crawled, and the exhaustive Development sweep runs the same gate as its `visibility-gate` post-run stage.
The gate keeps search consistent itself (issue #1958): `applyStudentVisibilityGatePlans` re-reads the entities it changed and calls `syncEntities` so Meilisearch reflects the freshly applied tiers without waiting for a separate rebuild, in addition to the sweep's explicit `search-rebuild` stage. Standalone manual materialize writes require `--confirm-materialize` in addition to the existing scraper environment write guards; use `--dry-run --output <path>` first for review artifacts. Scheduled or manual global reconciliation should run the same command in dry-run mode first, then apply only with `--collection=all --mode=apply --confirm-student-visibility-apply --max-apply=<reviewedScannedCount>` under the existing environment write guards. For research entities, both public tiers require source-backed complete card copy plus source/lead identity quality; `limited_but_safe` means the record is usable but lacks action/access evidence, not that weak bios or sparse cards are allowed into public Beta.
The gate fails closed on an empty-roster state: once enough lead-requiring research entities are scanned and nearly all of them resolve zero canonical leads, apply is refused with an explicit blocker instead of mass-suppressing the directory, so an accidental recompute against a mid-migration empty roster cannot hide public records.
Recover by populating the canonical `Researcher` roster (re-materialize scraped sources or backfill legacy identities) and re-running the dry run before apply.

Beta repair is dry-run-first through `yarn --cwd server beta:repair-queue --mode=dry-run --collection=all --output <artifact>`, then apply mode must use `--apply-from <artifact> --confirm-beta-repair-queue-apply` after reviewing the fresh Beta artifact.
Source-description repair fails closed when an exact `https://medicine.yale.edu/lab/<slug>` URL, with an optional trailing slash, belongs to another active research entity: it reports `official_source_url_collision`, applies no patch, and does not use that URL as description evidence until ownership is resolved.
The same reviewed-artifact workflow supports Development repairs when the dry-run artifact and guarded database target are both Development.
Development artifacts cannot be applied to Beta, Beta artifacts cannot be applied to Development, and production repair-queue apply remains unsupported.
The repair runner plans ordered lanes from blocker reasons: source/description first, PI identity second, and action evidence third.
Only deterministic source-backed patches are applied automatically.
Repair code must block archived research entities before PI member or access-signal upserts; archived duplicates should be repaired through the guarded member/artifact cleanup scripts instead.
Same-PI duplicate research homes are consolidated through the guarded dry-run, review, and apply workflow in [`research-entity-pi-dedupe-runbook.md`](research-entity-pi-dedupe-runbook.md).
PI identity conflicts, same-name risks, suppression decisions, and unsupported action-evidence gaps remain queued as exceptions instead of being guessed into student-visible data.

Formalization-only programs are deliberately capped. Fellowship funding, research travel grants, senior thesis funding, and secure-mentor-before-apply funding rows can be useful after a student has a research home, but they are not entry pathways by themselves. The visibility gate marks these records with `formalization_only`, keeps them out of `student_ready`, and routes them to exception review rather than source-description auto-repair unless evidence shows mentor matching, project placement, an internship, an RA program, or another real entry route.

Program audience is an honest label, not a suppression trigger. A graduate-only research program (`undergraduateOnly === false`) is a legitimate record: the gate records `graduate_relevant`, lets it reach the same tiers as an undergraduate-relevant program when it has a real non-portal official source and an application route, and surfaces it with a Graduate label rather than hiding it. Only catalog and administrative program pages (`not_undergraduate_relevant`) and non-research programs (`non_research_program`) stay `suppressed`. This applies to programs and fellowships only; research entities are never suppressed on undergraduate-relevance grounds.

Deterministic card-copy repair is cleanup, not the launch-clearing loop. It may derive missing cards from source-backed descriptions, including official-profile prose such as `research is centered on`, `interests include`, `studies ... focusing on`, and `our work focuses on`, but rows with missing PI/action evidence or only directory/listing/grant/publication sources must be enriched from better official entity/profile pages before promotion. Do not use Cancer, WTI, Economics, English, department, or center listing pages, NIH/NSF award text, ORCID works, paper abstracts, DOI metadata, dataset records, source chrome, or teaching/course-only profile biographies as public research descriptions. Course titles such as `Writing about...` are not scholarship evidence unless surrounding prose explicitly describes the person's research, writing, curatorial, or field-focused scholarly work.

Search indexes `shortDescription` and `fullDescription`, so their quality is a first-order discovery lever. `yarn --cwd server research-homes:backfill-descriptions` has several lanes. The default deterministic short-description lane scans active research entities and, for every entity whose short is empty, equal to the full, or not a genuine distinct summary, derives a distinct short from the full via the shared `deriveShortDescriptionFromFullDescription` core (the same derivation the materializer applies, reused without changing it). It never fabricates or persists a short equal to the full, reports a before/after quality scorecard plus duplicate/templated full-description groups, and leaves thin or empty full descriptions as a re-scrape follow-up rather than inventing them. It is dry-run-first; apply requires `--confirm-short-descriptions` and is blocked against production unless `CONFIRM_PROD_SCRAPE=true`. The `--llm-rewrite` lane is the grounded LLM rewrite of description-blocked bios and stays gated behind `--confirm-research-descriptions` plus an explicit `--limit`. The `--llm-synthesis` lane reuses the repository's existing OpenAI chat-completions integration (gpt-5-mini, JSON output, contact redaction) to synthesize a clean short and full from the best available stored source text. Its prompt is entity-type-aware: for lab, center, institute, program, or project entities it describes what the research home studies rather than the PI biography, while for faculty-research-area and other person entities it describes that individual's research and drops the administrative CV framing. Output must be grounded in the source, pass the description quality bar, and classify as genuine research prose or it is rejected. It requires an explicit `--limit` to bound generation, apply also requires `--confirm-llm-synthesis`, and it reports a token/cost projection from real usage plus before/after samples. The `--card-synthesis` lane (issue #557) targets the `missing_card_description` cohort - entities that already carry a genuine source-backed full description but no shippable one-line card - and resolves a card by trying the deterministic `deriveShortDescriptionFromFullDescription` first and, only when that returns nothing, a grounded LLM synthesis that condenses the entity's own full description into one sentence gated by a content-word grounding check plus the existing `shortDescriptionQuality` bar. The card quality bar is never relaxed and synthesis fails closed (returns empty) when not grounded or not quality-passing, so existing good cards are unchanged and only the empty-derivation gap is filled. It reports cards gained and how many would promote to `student_ready` (fresh visibility-gate reasons leave `missing_card_description` as the sole blocking reason via the canonical `isBlockingVisibilityReason` filter, so positive evidence reasons do not count against promotion); apply writes durable `shortDescription` observations plus the entity field, requires `--confirm-card-synthesis` plus an explicit `--limit`, and is production blocked. Scrape-time extraction of the lab-page description block is entity-type-aware in the same spirit (see the `lab-microsite-description-llm` notes below), so the research-home research prose is preferred over the stored PI bio.

For action-evidence repair, official deterministic department undergraduate research pages are the first repair lane before targeted LLM extraction. The `department-undergrad-research` source emits program records that materialize into `Fellowship` records on `/programs` (never a `PROGRAM` research entity, which no longer exists) plus undergraduate access evidence and guarded contact/application-route observations when the page itself supports them; generic guidance pages must not be materialized as active access `Signal` rows. Its per-faculty `physics-project-list` parser still yields `LAB` `ResearchEntity` evidence but no configured page uses it, so a run of this source produces no research entities. A page whose fetch or parse fails is skipped and recorded as a failed attempt in the run's `fetchMetrics` so the rest of the department pages still land, and the run fails only when every attempted page fails.

Faculty profile data should prefer official department profile evidence before publication-derived or same-name signals. Department roster/profile scrapes emit official profile URL, image, title, email, and bio observations, but Yale email observations must be person-specific for the profile name; reject generic contacts and wrong-person page emails even when the email is on a Yale-controlled page. Yale Medicine profile extraction must prefer the explicit `Biography` section, then explicit Research `Overview` text, over patient cards, page chrome, contact paragraphs, appointment-only copy, office addresses, course listings, publication-link text, citation metrics, center/program labels, credential-only education lists, leading author-list publication entries, or article headlines. Public profile shaping hides those non-biographical snippets, metric topics, and h-index values when no supported research identity or explicit interests back them, clips long public bios at a sentence boundary, expands clean official `Research Areas`/`Fields of Interest` snippets into readable source-attributed bios, can use official profile `researchInterests` arrays as a presentation-only source-attributed fallback when stored prose is empty or appointment-only, and accepts legitimate Yale profile URL variants such as compact compound surnames, first-name-prefix slugs, short same-person given-name slugs, explicit-first-initial slugs, or standalone first-initial slugs. A Yale profile URL that still fails name matching may stop suppressing the bio only when the stored bio starts with the exact current professor name, when it starts with first name + middle initial(s) + last name, or when title-stripped official bio prose starts with a verified multi-token given-name variant plus the stored last name; keep hiding the mismatched URL itself unless the URL independently matches the person. When a personal bio is still empty, public profile shaping may derive a presentation-only fallback from trusted membership-backed research homes only if the person is a lead of a concrete non-individual home with its own non-profile website and useful source-backed research prose; do not materialize guessed profile-bio values from that fallback, and do not use ORCID/grant-only, individual faculty-research-area, first-person, or person-named shell summaries as biographies. Same-name contaminated profile URLs, profile bios, topics, papers, and research entities must not leak into public profiles; same-prefix or same-initial wrong-person URLs still count as contamination.

The `official-profile-pi-backfill` scraper is a targeted official Yale profile repair source. It can emit `user` identity/profile observations when canonical URL, name, Yale email/NetID, and faculty title all validate. For already-linked public professor profiles, the visible bio lane may use the known `User.netid` after canonical URL, name, faculty title, and same-person URL matching validate, so missing profile email does not block bio repair; large visible-profile batches throttle repeated profile fetches to reduce 403s from official profile hosts. That visible-bio-only lane may also read official department person pages, such as Engineering faculty-directory or department `/people/` pages, when the URL path matches the linked user's name, may fetch official `/profile/` slugs made from a multi-token given-name variant when fetched identity validation still matches the linked user, and may target weak faculty users directly when their own profile URL is a same-person official Yale profile even if no public research-home membership supplied that URL. Visible bio materialization should emit only profile enrichment fields such as bio, image, interests/topics, and ORCID, not broad identity fields like `userType`, names, titles, or profile verification. Queued PI identity, research-home, and description repair lanes remain limited to canonical official profile URLs. When a grant shell already has an attached Yale lead but no stored profile URL, the profile-description lane may generate bounded `medicine.yale.edu/profile/<first-last>/` and `ysph.yale.edu/profile/<first-last>/` candidates from the lead identity; those URLs are fetch candidates only, and observations are emitted only after the existing canonical URL, name/email, and expected-person validation passes. Expected-person validation fails closed on an email disagreement instead of falling back to a bare name-token match, and a guessed `medicine.yale.edu`/`ysph.yale.edu` profile is rejected as an entity's official-profile identity when no expected email confirms it and the entity's own recorded school/departments affirmatively rule out medicine, so a same-name medical professor's areas and website cannot graft onto an unrelated humanities or social-science entity (the same never-attach-on-name-alone invariant as #562, applied at the research-area/website official-profile-identity step, issue #585). It can also use official profile bio text for bounded source-description repair, expand terse official research-interest snippets into readable source-attributed user bios, and use an attached lead member's official profile to emit same-entity `ResearchEntity` name/type/website/source observations when person-scoped JSON-LD affiliations or profile-body links show a leadership-backed lab, center, institute, program, or initiative. The extracted research-home name is truncated to its head-noun phrase, dropping a trailing description clause that begins right after a `Lab`/`Center`/`Institute`/`Program`-style head noun with a pronoun, article, or study/investigate/develop-style verb, so linked-lab prose can no longer glue a first description sentence onto the name; legitimate multi-word names such as `Center for Molecular Biology` and `Institute of Sacred Music` are preserved because only clause-starters are cut, never connectives like `for`/`of`/`on`/`in`/`and` (#624). It must reject profile chrome, navigation-panel links, broad department/org labels, generic institutional centers, parent organizations named only through subarea leadership, and outside-Yale/deputy-director affiliations as automatic research-home replacements. Directory news/card titles, appointment labels, degree/education credential lines, generic voluntary-faculty boilerplate, single-study clinical-trial abstracts, publication-count blurbs, Google Scholar/link prompts, broad MeSH/taxonomy buckets, and generic field headings must not be converted into profile bios, research-interest observations, topics, or title evidence; standalone noun `research` is too broad to validate a faculty title without a real role phrase. The source-url website lane must also reject scholarly or social directory hosts such as Academia.edu and ISPU scholar listings as direct research-home websites. A named Google Sites lab or personal academic site (`sites.google.com/view/<lab>`, `sites.google.com/site/<name>`, or a domain-scoped `sites.google.com/<org>/<name>` path) is a genuine research home and is preferred over a faculty-directory or `/profile/` stub for the primary `websiteUrl`, while a bare `sites.google.com` host with no named site stays rejected (#537). The materializer and public profile shaper must ignore active official-profile bio observations that are known non-bio snippets, including credential-only education lists, leading author-list or single-citation publication entries, appointment-only title lists, grant/project metadata blocks, clinical-profile calls to action, email-bearing contact text, external scholar-profile callouts such as `Google Scholar profile`, profile CTA text such as `Watch a video` or `Learn more about Dr...`, and trailing or glued `Last Updated` metadata, so stale address/title/news/citation/contact observations cannot beat later source-backed values. When otherwise useful official profile prose contains contact chrome, strip inline email parentheticals and leading `Email:`/`Phone:` header blocks before observation emission; if contact text remains, reject the bio or fall back to source-attributed official interests instead of exposing emails or phone numbers. Long official bios should clip at real sentence boundaries without cutting at dangling honorific abbreviations such as `Dr.` or `Prof.`. This lets NIH-style PI shells such as `Albert Sinusas Lab` resolve to a real research home like Yale Translational Research Imaging Center when the official profile and center page support it. It must not emit access/action evidence, research membership, department/org labels, or contact observations from profile chrome alone.

For queued PI repair, official-profile identity fallback may create a missing Yale user only when the page itself validates as the same canonical Yale profile, exposes a person-specific `@yale.edu` email, has a matching display name, and carries a supported research/faculty/director title. In that case the scraper emits `user` observations keyed by the email local part and an `inferredPiUserKey` observation; the materializer creates or enriches the user first, then resolves the key into a PI member. Keep this path bounded to real profile/person pages: lab, center, institute, initiative, research-home, and broad directory URLs must not be treated as profile candidates.

For stale official profile URLs, fix deterministic upstream URL patterns before broad backfill. The visible-bio lane canonicalizes the confirmed Sociology migration from `sociology.yale.edu/people/<slug>` to `sociology.yale.edu/profile/<slug>/`, and profile fetches try the preferred official candidate first, then same-person validated alternates instead of letting one 404 block the whole target. Bio observations must still pass quality gates: do not emit short topic fragments or semicolon-delimited topic lists as a stored profile bio, even from official profile pages.
A department site is also the authority on its own person-page path, so a stored `YALE_OFFICIAL` link is not append-only: `materializeUserIdentityToResearcher` replaces it when the freshly composed official link supersedes it per `supersedesOfficialProfileUrl` (`scripts/backfillResearcherOfficialProfileLinksCore.ts`), which accepts a move only on the same host and only onto that site's canonical CMS profile page (`/profile/<slug>`, or `/<section>/profile/<slug>` on the sites that nest it), never the reverse and never across hosts, so two roster pages cannot overwrite each other's link every sweep (#2282).
Links already frozen at a dead directory path are repaired by `yarn --cwd server researchers:repair-superseded-official-profile-links`, dry-run first; apply requires `--apply --confirm-superseded-profile-link-repair` plus an explicit `--limit` on top of the shared script apply guard, and stdout carries a bounded sample of the planned before/after rows (plus the omitted count, with `--output <path>` for the full artifact) because operator review is the only guard against a mis-targeted rewrite.
That repair is evidence-backed rather than a rewritten guess: it replaces the stale URL with a URL observed verbatim (Yale paths are case-sensitive, so a synthesized twin could 404 the same way), only from that researcher's own active `user` `profileUrls` observations under `materializationReadScopeFilter()`, matched by netid (`Researcher.identifiers.netid`, else the linked `Account.netid`).
A researcher with no matchable netid is left alone rather than repaired from another person's same-slug page (#468).
Neither of those lanes proves a stored link still resolves, so `yarn --cwd server researchers:verify-official-profile-links` probes them: it groups every non-archived researcher's `YALE_OFFICIAL` link by department host, walks each host's links serially with bounded cross-host concurrency (`--host-concurrency`, default 4) so one department is never hammered, and takes `--host <department host>` to scope a run to one site (#2292).
It is dry-run-first; apply requires `--apply --confirm-profile-link-verification` plus an explicit `--limit` on top of the shared script apply guard, and `--output <path>` writes the full per-link report because the summary printed to stdout carries only counts and the per-department roll-up.
Its observed replacement candidates are pooled per department host from active `user` `profileUrls` observations under `materializationReadScopeFilter()`, for the same reason the netid-matched lane uses that filter: a superseded or rollback-retired observation is no longer evidence that the site publishes that page.
[research-model.md](research-model.md) owns which probe verdicts settle a link and what a proved-dead link does at serve time.

Action-evidence repair must prefer official/profile-quality entity source URLs over grant, identifier, or ORCID provenance when creating low-confidence exploratory outreach artifacts. Grant-member provenance can identify a funding relationship, but it should not be the public next-step URL once an official Yale profile or research-home source has been materialized.

When no official profile bio exists, trusted personal or lab homepages may support reviewed user-bio backfill only when the page contains person-specific narrative evidence. Keep this as a guarded review lane unless a deterministic extractor can prove identity and narrative quality. Do not synthesize a stored profile bio from WTI-style roster pages, contact pages, generic lab slogans, title-only pages, person-named shells, or pages where the only evidence is a broad research-home summary.

Explicit `View Lab Website` links on official Yale profiles are a stronger research-home signal than broad profile affiliations. This path may accept a non-Yale lab domain when the official profile card itself labels the target as a lab website; the materialized lab name should use the profile person's name plus `Lab`, with credential suffixes such as `PhD` stripped. These lab-card links still must not be confused with profile chrome, academic-publication concept links, social/profile services, or broader center/department pages.

The department-roster scraper no longer extracts official-profile publications or linked publication lists, and the entity materializer ignores historical `officialProfilePublications` observations instead of creating `research_scholarly_links`.
The standalone official-profile publication-pointer repair command is also retired.
Paper Observation materialization and the `Paper` and `PaperAuthor` models and their readers are fully retired, with no rollback opt-in.
Historical `paper` observations are retained as read-only archived evidence and are never materialized.
Stored observations and scholarly sidecars remain available only for the human-gated `papers`/`paper_authors` collection-drop step in issue #207.

Description extraction should follow newly discovered official research-home websites before falling back to older profile/source URLs. `lab-microsite-description-llm` prefers non-profile `websiteUrl`/`website` values over profile source URLs, and non-profile official page descriptions carry higher confidence than profile-page descriptions so center/lab pages can replace biographical profile fallback copy. Profile-page extraction stays lower confidence and should not override better official research-home pages. The same non-profile microsite extraction also emits the research home's own real `name`/`displayName` at high confidence when the page states a proper or branded name, though it rejects governance/umbrella-org titles (Council, Committee, Consortium, Commission, Task Force, Working Group, Senate, Assembly, Office of, Board of) that are never a lab's own branded name so a shared center landing page cannot overwrite distinct person-lab names (#785), and the broader identity refusal it shares with every other source is enforced at the materialize, serve, and search-index choke points rather than here (see `personScopedResearchEntityNameNamesSomethingElse`, #2234/#2351), while the NIH/NSF grant scrapers emit their `<PI> Lab` fallback only as a low-confidence placeholder, so any real-name source wins during field resolution. Selecting the embedded lab-page description block is entity-type-aware: for lab, center, institute, program, or project entities it picks the research home's research prose and rejects the PI biography, administrative CV, and welcome/navigation boilerplate, while for faculty-research-area and other person entities it keeps a research-focused bio; a page that offers no research-focus prose yields no description rather than materializing a stub. When the path emits a good `fullDescription` but no card, it also ships a grounded one-line `shortDescription` at ingestion (issue #557): it synthesizes a card grounded in that same full description and gated by the `shortDescriptionQuality` bar. When prose yields no groundable, quality-passing summary, the materializer falls back to a deterministic card built from the entity's own trusted `researchAreas` (oxford-joined, capped at four topics, gated on shape rather than full-description grounding), and only when no clean structured topic survives does it fail closed to no card rather than a weak one (issue #952). The same quality bar now rejects vacuous generic summaries such as `Studies the field.` unconditionally, so a bare verb-plus-generic-noun template can never win over an entity's already-populated `researchAreas`. One unreachable or broken page must be logged and skipped without aborting the remaining bounded extraction batch.

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
- Known warnings must be documented in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md) before promotion.
- Production must have a fresh Atlas backup or restore point before any copy or write.
- The operator must choose exactly one promotion lane: accepted Beta copy or guarded production delta.
- Meilisearch must be rebuilt or synced after accepted Mongo writes.
- Recurring scraper jobs stay disabled until the manual production gate and smoke checks pass.

The operator decision packet in [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md) is the promotion record for lane, backup/restore point, rollback owner, smoke owner, accepted warnings, run IDs, and rollback drill status. Do not infer a lane from pipeline state alone; the operator must fill the packet before production writes or copy operations.
The presence of that packet is not acceptance by itself; blank fields mean the production gate is blocked.

### Undergraduate logistics release audit

Run the read-only logistics audit after a bounded Beta acquisition and before broad or recurring acquisition:
During staging, the microsite scraper emits logistics observations only when `--only` supplies an explicit allowlist of at most 25 unique slugs.
Runs without that allowlist retain the legacy undergraduate-signal behavior but cannot emit logistics observations.

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
