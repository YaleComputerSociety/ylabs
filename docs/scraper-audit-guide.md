# Scraper Audit Guide

Last updated: 2026-05-22

This guide explains how to audit each scraper before production writes, what each scraper writes, and how the output supports Yale Research.

The active per-source checklist and latest Development-only validation snapshot live in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md).

The deployment flow from development testing to Beta seeding, production writes, and recurring cron lives in [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md).

## Mental Model

Scrapers are evidence collectors. They should not make final product claims such as "this lab is accepting undergrads."

The normal flow is:

```txt
Source metadata
  -> ScrapeRun
  -> Observation rows
  -> materializer/resolver
  -> ResearchEntity/User/research_scholarly_links/etc.
  -> EntryPathway / AccessSignal / ContactRoute / PostedOpportunity when evidence supports it
  -> student surfaces: Yale Research, Programs & Fellowships, saved research plans, Evidence, Best Next Step
```

Most scrapers write raw `Observation` rows first. `entityMaterializer.ts` then upserts physical entities such as `research_entities` and `users`. `accessMaterializer.ts` derives access-model records such as `entry_pathways`, `access_signals`, and `contact_routes` from evidence-bearing observations.

Meilisearch failures are non-blocking during scraper audit if Mongo writes and materialization succeed. Reindex/backfill Meilisearch after the source data looks good.

## Shared Collections

Every scraper run can touch:

- `sources`: seeded source registry and source coverage metadata.
- `scrape_runs`: one run record per CLI execution, including report counters and materialization metrics.
- `observations`: append-only field evidence from the scraper.
- `scrape_snapshots`: optional fetch/API cache when `--use-cache` is used.

Materialization may then touch:

- `users`: faculty/user records.
- `research_entities`: physical backing for `ResearchEntity`.
- `research_scholarly_links`: compact person/profile research-activity links.
- `research_scholarly_attributions`: explicit user/entity relationship evidence for compact scholarly links.
- Legacy `papers`, `paper_authors`, and `paper_entity_links` only as migration inputs before cleanup; new publication enrichment should prefer compact scholarly-link materialization.
- Embedded `research_entities.recentGrants`: compact funding evidence from NIH/NSF-style sources; do not recreate standalone `grants`.
- `entry_pathways`: ways a student can enter.
- `access_signals`: evidence-backed access clues.
- `contact_routes`: guarded routes for next action.
- `posted_opportunities`: real posting/application instances.

## Official Yale Research Directories

`yale-research-official` ingests `research.yale.edu` centers/institutes, cores, and selected durable research-infrastructure resources. It is an official-index, discovery-only source:

- Expected writes: `ResearchEntity` and `Observation`.
- Expected entity types: `CENTER`, `INSTITUTE`, `PROGRAM`, `INITIATIVE`, and `CORE_FACILITY`.
- Expected non-writes: no `EntryPathway`, `AccessSignal`, `ContactRoute`, or `PostedOpportunity` rows.
- Core services, instruments, and equipment should enrich the parent core facility as method/topic context instead of creating standalone research homes.
- Center/institute rows may overlap with existing official source rows. Materialization should reuse one active exact-name `ResearchEntity` for `yale-research-official` directory observations when the match is unique, preserve the canonical slug, and merge `sourceUrls` rather than creating a duplicate shell.

## Safe Audit Commands

List available scrapers:

```bash
npx -y corepack@0.34.7 yarn scrape list
```

Seed source metadata in the target DB:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn scrape:seed-sources
```

First parser dry-run:

```bash
SCRAPER_ENV=development \
  npx -y corepack@0.34.7 yarn scrape run --source <source-name> --limit 10 --dry-run
```

The first parser dry-run should omit `--use-cache`. The scraper CLI still creates or updates
`scrape_runs`, and `--use-cache` can create or delete `scrape_snapshots`; dry-run means no
`Observation` rows and no materialized collection writes.
Dry-run reports use the run-level `observationCount` and `entitiesObserved` counters because
would-be observations are not persisted. Field breakdowns such as `byField` stay empty until a
non-dry write creates `Observation` rows.

Small development write with materialization:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn scrape run --source <source-name> --limit 10 --use-cache --auto-materialize
```

Scale up in development:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn scrape run --source <source-name> --limit 100 --use-cache --auto-materialize
```

Production writes require both `--release` and `CONFIRM_PROD_SCRAPE=true`:

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  npx -y corepack@0.34.7 yarn scrape run --source <source-name> --release --auto-materialize
```

## Audit Checklist

For every source:

- Confirm the Mongo target printed by the CLI is the intended database.
- Start with an uncached parser dry-run, then a small dev write, then a larger dev write.
- Inspect the printed run report.
- Confirm `observationCount` and `entitiesObserved` are plausible.
- For dry-runs, expect `byField`/`byEntityType` to remain empty while top-level counters reflect
  would-be emitted observations.
- Confirm `materialization.errors` is `0`.
- Investigate `materialization.conflicts` before production.
- Treat local Meilisearch `ECONNREFUSED` as non-blocking during audit.
- Confirm the source does not create access artifacts it should not create.
- Confirm source coverage warnings are either expected or documented as follow-up work.
- Confirm broad, paid, or recurring sources report WorkPlanner skip/fetch metrics, or explain why no freshness policy applies.
- Confirm repeated dry-run or development reruns do not create uncontrolled observation growth.
- Confirm compact-retention dry-runs are reviewed before deleting superseded observations.
- Use the deployment runbook before Beta seeding or production cron setup.

## Backfill Promotion Gate

Do not use broad backfills as the way to discover scraper bugs. Promote each source through the same gate before increasing scope:

1. **Read-only baseline:** run `yarn --cwd server source:health --strict` and `yarn --cwd server scraper:integrity-gate --include-samples --limit=50`. Any hard failure blocks new backfill work until it is understood or repaired.
2. **Parser dry run:** run the source with `SCRAPER_ENV=development` or `SCRAPER_ENV=beta`, `--dry-run`, and a bounded `--limit`, `--only`, or `--since` option. Omit `--use-cache` for the first live audit because cache mode can mutate `scrape_snapshots`; add cache only for accepted reruns where snapshot writes are intentional. This proves fetch/parsing behavior without Observation writes or materialized collection writes.
3. **Sample write:** run a small non-production write with `ALLOW_NON_PROD_SCRAPER_WRITES=true` and `--auto-materialize`. Inspect the printed report or `yarn scrape report --run <scrapeRunId>`.
4. **Acceptance bar:** require `run.status = success`, `materialization.errors = 0`, expected artifact counts for the source purpose, no unsupported access claims, no non-public contact exposure, and only documented materialization conflicts.
5. **Edge-case tests:** add or update focused tests for every bug class discovered during the audit, especially selector changes, source URL pollution, identity matching, duplicate artifact creation, and access-claim false positives.
6. **Scale deliberately:** increase the same source from sample to medium chunk to full backfill only after the prior chunk passes the bar. Do not switch sources and broad-backfill at the same time.
7. **Post-chunk gate:** after every non-dry materialized chunk, rerun `yarn --cwd server scraper:integrity-gate --include-samples --limit=50`; for Beta or production promotion also run the relevant data-quality/readiness gate.

If a chunk fails, stop at the failed scope, fix the scraper or materializer, add a regression test, and rerun the smallest failing case before continuing.

## Old Observation Replay Cleanup

Use replay cleanup when scraper logic has improved and old active observations may still carry stale bad values.

Dry-run first:

```bash
yarn --cwd server observations:replay-cleanup \
  --source lab-microsite-description-llm \
  --entity-type researchEntity \
  --field fullDescription \
  --older-than-days 7 \
  --limit 25 \
  --output /tmp/yale-research-observation-replay-review.json
```

Review the output. Rows with `SCRAPER_STILL_BAD` mean the scraper still needs a code fix and regression test. Rows with `SCRAPER_ALREADY_FIXED` or `MATERIALIZED_STALE` may be accepted by setting `acceptedForApply: true` in a reviewed copy of the file.

Apply accepted rows only:

```bash
SCRAPER_ENV=beta ALLOW_NON_PROD_SCRAPER_WRITES=true \
  yarn --cwd server observations:replay-cleanup \
  --apply \
  --accepted-input /tmp/yale-research-observation-replay-accepted.json \
  --reviewed-by <reviewer> \
  --output /tmp/yale-research-observation-replay-applied.json
```

After apply, run:

```bash
yarn --cwd server scraper:integrity-gate --include-samples --limit=50
yarn --cwd server beta:data-quality --include-samples
```

If the integrity gate reports `activeArtifactsOnArchivedEntities`, run the archived-artifact
repair dry-run first:

```bash
yarn --cwd server research-entity:repair-archived-artifacts --limit=50
```

Apply only after reviewing the plan. The repair relinks or merges artifacts when the archived
ResearchEntity has a canonical target, and archives orphan artifacts when the archived entity has
no canonical target.

Current 2026-05-22 Beta promotion posture:

- Chunk-apply accepted sources only: `yale-directory`, `official-profile-enrichment`, `ysm-atoz-index`, `yse-centers-index`, `centers-institutes-index`, reviewed `dept-faculty-roster` departments including CS and Engineering-wide `seas` via Yale VPN, `nih-reporter`, `nsf-award-search`, `orcid`, identity-backed `openalex`, `crossref`, `europe-pmc`, and `pubmed`.
- Keep excluded sources gated: broad arXiv failed live smoke with 429/timeouts and zero observations; LLM sources require reviewed `descriptionReviewSamples`/quote samples per chunk; OpenAlex name discovery stays off.
- The scraper CLI and cron path enforce the highest-risk gates for non-dry Beta/production apply: OpenAlex name discovery is blocked, arXiv requires `--accepted-review-artifact` with accepted identity targets, Engineering `dept-faculty-roster` runs require bounded `--only cs` or `--only seas` `--limit/--offset` chunks, and broad LLM chunks require `--accepted-review-artifact` unless the scope is already manually bounded to 25 targets or fewer.
- Funding sources are grant/research-entity enrichment only. NIH/NSF observations from unmatched PIs must not mint or update local `User` records, contact routes, pathways, or access claims.
- Publication sources are compact `research_scholarly_links` plus `research_scholarly_attributions` enrichment only. Do not rebuild a full local publication archive or treat papers as undergraduate-access evidence.
- `lab-microsite-description-llm` may derive a missing short description from an already source-backed full description and may use official Engineering `Perspectives` paragraphs as deterministic profile evidence, but must still reject terminal-ellipsis/truncated fragments and facility/core pages that do not support a person-specific research-home description.

Useful report command:

```bash
npx -y corepack@0.34.7 yarn scrape report --run <scrapeRunId>
```

To save a durable QA artifact outside the repo, add `--output`:

```bash
npx -y corepack@0.34.7 yarn scrape report --run <scrapeRunId> --output /tmp/yale-research-scraper-reports/<scrapeRunId>.json
```

Useful source-health summary:

```bash
npx -y corepack@0.34.7 yarn --cwd server source:health
```

The source-health command is read-only. It summarizes enabled sources, recent run status, coverage metadata, materialization errors/conflicts, and the next action needed before promotion.

## Repeatable Source Automation Runbook

Use this operator sequence for any source-expansion batch before student-facing promotion:

1. **Seed sources in the target DB.** Confirm the CLI prints the intended Mongo target.

   ```bash
   SCRAPER_ENV=<development|beta> ALLOW_NON_PROD_SCRAPER_WRITES=true \
     npx -y corepack@0.34.7 yarn scrape:seed-sources
   ```

2. **Run a DB-backed dry-run.** Omit `--use-cache` for the first live parser audit. Dry-run may create or update `scrape_runs`, but must not write `Observation` rows or materialized collections.

   ```bash
   SCRAPER_ENV=<development|beta> \
     npx -y corepack@0.34.7 yarn scrape run --source <source-name> --limit <n> --dry-run
   ```

3. **Review and accept before apply.** Inspect the printed report or save it with `scrape report`; require plausible counters, zero materialization errors, understood warnings, no unsupported access claims, and no non-public contact exposure. Do not run apply from an unreviewed dry-run.

   ```bash
   npx -y corepack@0.34.7 yarn scrape report --run <dryRunId> \
     --output /tmp/yale-research-scraper-reports/<dryRunId>.json
   ```

4. **Apply only the reviewed scope.** Use the same bounded source options that were accepted in dry-run and materialize immediately.

   ```bash
   SCRAPER_ENV=<development|beta> ALLOW_NON_PROD_SCRAPER_WRITES=true \
     npx -y corepack@0.34.7 yarn scrape run --source <source-name> --limit <n> --auto-materialize
   ```

   If materialization is run separately, use the accepted run ID:

   ```bash
   SCRAPER_ENV=<development|beta> ALLOW_NON_PROD_SCRAPER_WRITES=true \
     npx -y corepack@0.34.7 yarn scrape materialize --run <scrapeRunId>
   ```

5. **Run gates after materialization.**

   ```bash
   npx -y corepack@0.34.7 yarn --cwd server scraper:integrity-gate --include-samples --limit=50
   npx -y corepack@0.34.7 yarn --cwd server source:health --strict
   ```

6. **Recompute student visibility.** Dry-run first, get operator acceptance for rule effects, then apply. When the target checkout provides `student-visibility:approve-rules`, use it as the explicit approval step before apply; otherwise record the reviewed dry-run output and reviewer decision in the run artifact.

   ```bash
   npx -y corepack@0.34.7 yarn --cwd server student-visibility:backfill --collection=all
   npx -y corepack@0.34.7 yarn --cwd server student-visibility:approve-rules --input <reviewed-backfill-report.json>
   SCRAPER_ENV=<development|beta> ALLOW_NON_PROD_SCRAPER_WRITES=true \
     npx -y corepack@0.34.7 yarn --cwd server student-visibility:backfill --collection=all --apply
   ```

7. **Rebuild Meilisearch after accepted writes.** Use `--clear` for local/dev rebuilds; use the deployment runbook's swap/reindex posture for Beta or production traffic.

   ```bash
   npx -y corepack@0.34.7 yarn --cwd server meili:rebuild-research-entities --clear
   npx -y corepack@0.34.7 yarn --cwd server meili:rebuild-pathways --clear
   ```

8. **Smoke-check student APIs.** Confirm public APIs return only `student_ready` / `limited_but_safe` rows by default and that search still returns plausible results for the source's expected terms.

   ```bash
   curl -sS 'http://localhost:4000/api/research?page=1&pageSize=5'
   curl -sS 'http://localhost:4000/api/programs?page=1&pageSize=5'
   curl -sS 'http://localhost:4000/api/research/search?q=<term>&page=1&pageSize=5'
   ```

No production writes are allowed without the existing production guardrails: `SCRAPER_ENV=production`, `CONFIRM_PROD_SCRAPE=true`, source-specific `--release` posture where applicable, a confirmed backup/rollback point, and the same review gates above. Equivalent future automation must preserve those guardrails rather than bypassing them.

Current source-specific lessons:

- `department-undergrad-research` dry-run posture is healthy. Keep using bounded `--only` batches and verify that department guidance creates restrained access evidence rather than `PostedOpportunity` rows.
- `yale-research-official` and `ysm-atoz-index` are healthy discovery-only sources. They should continue to materialize entities and provenance without undergraduate-access artifacts unless a later reviewed extractor adds explicit access evidence.
- `yale-college-fellowships-office` needs stale URL hygiene around the Mellon path before promotion. Clean or suppress stale Mellon URLs before accepting a full apply.

Useful sparse-detail / coverage-gap audit:

```bash
npx -y corepack@0.34.7 yarn --cwd server research-entity:coverage-audit -- --limit=25 --min-score=8
```

Slug-level diagnosis for a single blank or suspicious page:

```bash
npx -y corepack@0.34.7 yarn --cwd server research-entity:coverage-audit -- --slug dept-cs-yuejie-chi
```

The research-entity coverage audit is read-only. It ranks sparse research profiles, flags gaps such as missing descriptions, members, pathways, and public routes, and calls out likely scraper/materialization mismatches such as lab-microsite observations with no actionable artifacts or inferred PI ownership with no membership rows.

Useful temporary Yale Directory CSV denominator audit:

```bash
npx -y corepack@0.34.7 yarn --cwd server yale-directory:coverage-audit -- --limit-units=25
```

The Yale Directory CSV audit is read-only. It treats the temporary `yale_directory_all.csv` file as a one-time coverage denominator, excludes suppressed operational rows, and ranks units where likely research people are missing identity, membership, entity, publication, grant, or student-action coverage. The CSV should be deleted after the one-time seed/audit workflow is complete; durable state belongs in Mongo observations and source metadata, not in the raw CSV file.

When the audit identifies a bounded sparse-lab slice that can be repaired from existing observations, use the paired repair command:

```bash
npx -y corepack@0.34.7 yarn --cwd server research-entity:coverage-repair -- --limit=100 --min-score=8
```

Add `--apply` only after reviewing the candidate list. The repair command rematerializes the selected labs, fills PI membership rows, replays access materialization, and applies guarded official-profile fallback coverage without running a fresh scrape.

Useful posted-opportunity status reaper:

```bash
npx -y corepack@0.34.7 yarn --cwd server opportunities:reap-statuses
```

The reaper defaults to dry-run. Use `--apply` only after reviewing the dry-run output; it closes expired open posted opportunities and marks posted-role pathways unavailable when no active posting remains.

## Recommended Audit Order

1. `dept-faculty-roster`: entity/faculty/lab ownership trunk.
2. `department-undergrad-research`: official department undergraduate research routes, project lists, contacts, and application links.
3. `lab-microsite-description-llm`: sparse ResearchEntity description repair, higher risk because it uses LLM and live websites.
4. `lab-microsite-undergrad-llm`: high-value pathway evidence, higher risk because it uses LLM and live websites.
5. `undergrad-fellowships-recipients`: past-undergrad and fellowship-compatible evidence.
6. `centers-institutes-index`, `ysm-atoz-index`, `yse-centers-index`: entity discovery.
7. `nih-reporter`, `nsf-award-search`, `openalex`, `arxiv`: enrichment, funding, publication, and preprint context.

Legacy `legacy-listing` records are not scraper coverage proof. The Beta `listings` collection has been dropped, and listing-derived pathways/signals/opportunities are archived or deleted. Use source coverage, official profile URLs, reviewed accepted inputs, and admin/manual seeds to prioritize sparse entities.

## Source Map

| Scraper                            | Main purpose                                                                                             | Primary observation entity types                                       | Expected materialized collections                                               | Access-model impact                                                                                                                                                                         | Audit notes                                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dept-faculty-roster`              | Discover faculty, official profile URLs, ORCID, lab/personal sites, Scholar review candidates, inferred PI ownership | `researchEntity`, `user`                                               | `users`, `research_entities`, then guarded fallback `research_entity_members`, `entry_pathways`, `contact_routes` during materialization when applicable | Can backfill lab descriptions/research areas, PI membership, and guarded public PI-profile fallback routes/pathways. It should not create active posted openings or strong access claims by itself.               | Audit by department when possible. Current configs cover Econ, MCDB, CS, Engineering-wide SEAS, Psych, Math, Physics, Statistics, and Astronomy. Engineering endpoints require Yale VPN and bounded `--only cs` / `--only seas` chunks; `seas` excludes CS-only rows and infers per-person Engineering departments from titles. Large runs can be slow because profile pages are enriched sequentially. Review negative microsite signals before trusting fallback pathways/routes. |
| `department-undergrad-research`    | Extract official department undergraduate research routes, project lists, contacts, and application links             | `researchEntity`                                                       | `research_entities`, then access records through `accessMaterializer.ts`             | Can create exploratory `EntryPathway`, `AccessSignal`, and guarded `ContactRoute` records from explicit undergraduate research evidence. It must not create `PostedOpportunity` rows by itself.               | Start with `--only physics,chemistry,mcdb,economics-tobin-ra,psychology` dry-runs. Physics-style project lists can create lab-specific evidence; generic department guidance should remain a restrained program/pathway entity. |
| `lab-microsite-description-llm`    | Extract source-backed research descriptions, methods, and conservative topic labels from official lab websites | `researchEntity`                                                       | `research_entities`                                                             | None. It must not create `EntryPathway`, `AccessSignal`, `ContactRoute`, or `PostedOpportunity` records.                                                                                  | Start with an uncached dry-run sample such as `SCRAPER_ENV=beta yarn --cwd server scrape run --source lab-microsite-description-llm --limit 25 --dry-run --ignore-work-planner`. Review source URLs, specificity, review samples, and absence of access/opportunity claims before apply. |
| `lab-microsite-undergrad-llm`      | Extract evidence from lab/faculty websites: join pages, role language, constraints, contact instructions | `researchEntity`                                                       | `research_entities`, then access records when evidence supports them            | Can create `access_signals`, `entry_pathways`, and guarded `contact_routes` through `accessMaterializer.ts`. Should preserve quotes/source URLs and avoid final claims inside scraper code. | Start with small `--limit`. Requires `OPENAI_API_KEY`. Use source coverage, official profile URLs, accepted inputs, and reviewed sparse-entity reports for target selection; review quotes and `quoteSourceUrl` carefully.                         |
| `undergrad-fellowships-recipients` | Capture evidence of past undergrad advisees and fellowship-compatible research                           | `researchEntity`                                                       | `research_entities`, `entry_pathways`, `access_signals`                         | Can create exploratory outreach pathways plus `PAST_UNDERGRADS` and `FELLOWSHIP_COMPATIBLE` signals. Fellowship funding remains formalization evidence, not a standalone entry pathway.     | Many programs require manual upload or CSV/PDF handling. Audit skipped/manual-upload programs separately.                                                                                                                                             |
| `centers-institutes-index`         | Discover centers, institutes, child centers, directors/members, official pages                           | `researchEntity`, `user`, `researchGroupMember` depending on extractor | `research_entities`, `users`, `research_entity_members`                         | Entity and membership context. Should not imply undergrad access unless explicit access evidence is added later.                                                                            | Check member/director parsing and skipped JS/gated configs.                                                                                                                                                                                           |
| `ysm-atoz-index`                   | Discover YSM lab websites from official index                                                            | `researchEntity`                                                       | `research_entities`                                                             | Discovery only. Should not emit or materialize undergraduate-access claims from index rows.                                                                                                 | Useful seed for lab microsite crawling. Audit that it does not create student-facing access claims by itself.                                                                                                                                         |
| `yse-centers-index`                | Discover YSE centers/programs/initiatives                                                                | `researchEntity`                                                       | `research_entities`                                                             | Discovery only. Should not emit or materialize undergraduate-access claims from index rows.                                                                                                 | Useful seed for broader research entities.                                                                                                                                                                                                            |
| `yale-directory`                   | Authoritative Yale appointment/profile metadata                                                          | `user`                                                                 | `users`                                                                         | Membership/profile context only. Not access evidence.                                                                                                                                       | Depends on Yalies/API configuration. Good for improving person matching.                                                                                                                                                                              |
| `yale-directory-csv`               | One-time temporary CSV seed/audit for Yale-wide identity and affiliation coverage                         | `user`                                                                 | `users` through observation materialization only                                | Identity/profile context only. Must not create research entities, pathways, access signals, contact routes, or opportunities by itself.                                                     | Use only while `yale_directory_all.csv` is present. Run the read-only coverage audit first, then a guarded one-time scraper run if the target DB and source row are confirmed. Delete the raw CSV afterward.                                           |
| `nih-reporter`                     | Pull Yale NIH grants and PI/co-PI context                                                                | `user`, `researchEntity`, grant-shaped observations                    | `users`, `research_entities` with embedded `recentGrants`                       | Funding/topic enrichment only. Not undergraduate access evidence.                                                                                                                           | Audit PI matching, synthetic keys, grant counts, and duplicate external IDs.                                                                                                                                                                          |
| `nsf-award-search`                 | Pull Yale NSF awards and PI/co-PI context                                                                | `user`, `researchEntity`, grant-shaped observations                    | `users`, `research_entities` with embedded `recentGrants`                       | Funding/topic enrichment only. Not undergraduate access evidence.                                                                                                                           | Especially useful where department pages are JS-heavy.                                                                                                                                                                                                |
| `openalex`                         | Sync publication/research-activity context through accepted author identities                            | `scholarlyLink`, possibly `user`/entity-linked observations            | `research_scholarly_links`, with legacy paper collections only as migration inputs | Publication/topic enrichment only. Not access evidence.                                                                                                                                     | Audit accepted ORCID/OpenAlex identity matching, real source destinations, and compact-link counts. Name-only discovery remains opt-in/review-only and should not be mass-applied.                                                                                                                                                             |
| `crossref`                         | Hydrate DOI-backed compact scholarly links with DOI-of-record title, venue, year, and destination metadata | `scholarlyLink`                                                        | `research_scholarly_links`                                                       | Publication metadata/destination-quality enrichment only. Not access evidence or authorship evidence by itself.                                                                             | Run as a chunked/as-needed quality pass over existing DOI-backed compact links. Audit skipped non-research records, real DOI destinations, compact-link updates, and absence of new paper/authorship rows.                                                                                                                                       |
| `europe-pmc`                       | Hydrate publication metadata and full-text destinations from Europe PMC                                  | `scholarlyLink`, authorship evidence when identity-backed              | `research_scholarly_links`                                                       | Publication metadata/destination-quality enrichment only. Not access evidence.                                                                                                              | Keep chunked/as-needed. Preserve multiple Yale authorship evidence rows but dedupe duplicate metadata observations; verify source labels and publication dates before writes.                                                                                                                                                                  |
| `pubmed`                           | Hydrate MED/PubMed publication metadata and destinations through Europe PMC                              | `scholarlyLink`, authorship evidence when identity-backed              | `research_scholarly_links`                                                       | Publication metadata/destination-quality enrichment only. Not access evidence.                                                                                                              | Keep MED-source filtered and chunked/as-needed. Do not label PMC-only/non-MED results as PubMed evidence.                                                                                                                                                                       |
| `arxiv`                            | Sync recent author-matched preprints before journal publication                                          | `scholarlyLink` or compact publication observations                    | `research_scholarly_links`                                                       | Preprint/recent research enrichment only. Not access evidence by itself.                                                                                                                    | Audit exact-author matching, duplicate external IDs, and recency fields. Use small `--limit`/`--since` runs because the API should be queried politely.                                                                                                            |

## Per-Source Audit Playbooks

### `dept-faculty-roster`

Commands:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn scrape run --source dept-faculty-roster --only econ --limit 100 --use-cache --auto-materialize
```

Expected collections:

- `observations`: user and research-entity observations.
- `users`: faculty rows.
- `research_entities`: inferred lab/group/entity rows.

Expected report shape:

- Direct scraper output should not emit `PostedOpportunity` rows or positive access claims. After materialization, guarded PI-profile fallback `EntryPathway` / `ContactRoute` artifacts may appear when the lab has inferred PI ownership, an official Yale profile URL, and no stronger public route or negative availability signal.
- `researchEntity` and `user` observation counts should be nonzero.
- If `ContactRoute` appears as missing expected output, decide whether to add guarded contact materialization or remove `ContactRoute` from source coverage metadata.

Project impact:

- Improves faculty-to-entity ownership.
- Finds official profile URLs and lab websites.
- Backfills professor bios and blank faculty-lab descriptions/research areas from official profile enrichment. For YaleSites profile pages, `.text-field .text` body prose should win over roster/card fragments when it is materially richer.
- Can repair sparse pages with guarded public PI-profile routes and exploratory-profile pathways.
- Seeds later lab microsite crawling.

### `lab-microsite-description-llm`

Commands:

```bash
SCRAPER_ENV=beta \
  yarn --cwd server scrape run --source lab-microsite-description-llm --limit 25 --dry-run --ignore-work-planner
```

Expected collections:

- `observations`: `description`, `fullDescription`, `shortDescription`, optional `researchAreas`, and `lastObservedAt`.
- `research_entities`: description fields and empty research-area gaps after materialization.

Audit focus:

- Source URLs are official lab/faculty microsite pages.
- Official Engineering faculty profile URLs stored in `sourceUrls` may be used as supplemental evidence when the public lab/personal site is sparse or blocked, but forbidden Engineering directory URLs still must not be exposed as public student-facing sources.
- Legacy framed microsites should be audited from same-site frame content when that frame contains the actual research text.
- Descriptions explain research questions, subject matter, methods, or research fit.
- Text does not imply openings, undergraduate availability, applications, contact routes, or posted roles.
- Empty/unsupported pages produce no description fields or freshness heartbeat.
- Person-style `— Research` rows must reject facility/core/center descriptions unless the source text clearly ties the description to that person.
- Existing manually locked description fields are not overwritten.

Project impact:

- Repairs sparse `/research/:slug` pages and improves Research search relevance without changing access or opportunity claims.
- Should be applied in small Beta batches only after reviewing dry-run samples.

### `lab-microsite-undergrad-llm`

Commands:

```bash
SCRAPER_ENV=development \
  npx -y corepack@0.34.7 yarn scrape run --source lab-microsite-undergrad-llm --limit 10 --dry-run --ignore-work-planner
```

Expected collections:

- `observations`: evidence-shaped fields such as `undergradAccessEvidence`, `joinPageUrl`, `undergradRoleEvidenceQuote`, `contactInstructionsQuote`, `undergradConstraintQuote`.
- `entry_pathways`: exploratory/contact or application-like pathways when evidence supports them.
- `access_signals`: reach-out plausible, application form exists, contact instructions exist, or not currently available.
- `contact_routes`: guarded official application routes when an official URL is observed.

Audit focus:

- Quotes are real and traceable to `sourceUrl`/`quoteSourceUrl`.
- LLM evidence remains low-trust and conservative.
- No active posted opportunity is created from a generic join page.
- Direct emails and phone numbers are redacted from public quote/excerpt fields unless a guarded contact policy explicitly allows display.
- A warning about emitted observations with zero fetch successes can be expected when normal HTTP fetches succeed but only rendered-fallback fetch metrics are counted; inspect per-run errors before treating it as source failure.

Project impact:

- Main source for credible non-posted pathways.
- Helps students answer "what should I do next?" from official lab evidence.

### `undergrad-fellowships-recipients`

Commands:

```bash
SCRAPER_ENV=development \
  npx -y corepack@0.34.7 yarn scrape run --source undergrad-fellowships-recipients --limit 25 --dry-run --manual-recipient-csv-dir /tmp/yale-research-accepted-inputs/fellowships
```

Expected collections:

- `observations`: `pastUndergradAdvisees`, legacy `acceptingUndergrads`.
- `research_entities`: faculty-owned entities.
- `entry_pathways`: `EXPLORATORY_CONTACT` when past-undergrad evidence suggests a plausible mentored-project outreach route.
- `access_signals`: `PAST_UNDERGRADS`, `FELLOWSHIP_COMPATIBLE`.

Audit focus:

- Advisor matching is precise.
- Manual-upload-required programs are logged, not silently treated as zero evidence.
- Past participation is shown as historical/fellowship-compatible evidence, not an active opening.

Project impact:

- Helps students find plausible fellowship/thesis supervisors with real past undergrad evidence.

### Entity Discovery Sources

Sources:

- `centers-institutes-index`
- `ysm-atoz-index`
- `yse-centers-index`
- `yale-directory`

Expected collections:

- `observations`
- `research_entities`
- `users`
- `research_entity_members` for richer center/member extraction

Audit focus:

- They discover entities, websites, official profiles, and membership.
- They do not create `entry_pathways` or `access_signals` from index-only evidence.
- Any legacy `acceptingUndergrads` field remains compatibility data only unless backed by explicit evidence.

Project impact:

- Broadens "Explore Research" beyond labs.
- Feeds later microsite, pathway, and admin review workflows.

### Funding And Publication Enrichment

Sources:

- `nih-reporter`
- `nsf-award-search`
- `openalex`
- `arxiv`
- `orcid`
- `crossref`
- `europe-pmc`
- `pubmed`

Expected collections:

- `observations`
- `users`
- `research_entities`
- embedded `research_entities.recentGrants`
- `research_scholarly_links`
- Legacy `papers`, `paper_authors`, and `paper_entity_links` only when auditing an environment that has not completed compact-link cleanup

Audit focus:

- External IDs dedupe correctly.
- PI/faculty matching is conservative.
- Publication context uses accepted ORCID/OpenAlex/arXiv identity evidence, not name-only matching.
- Compact links point to real DOI, publisher, PubMed, PMC, arXiv, ORCID, or equivalent source destinations.
- Topics/funding/publication context enriches research entities without creating access claims or a full local publication archive.
- Funding sources do not mint or update local users from grant-only unmatched PI evidence.
- Broad arXiv is not accepted for mass apply until live API rate-limit behavior and identity targets pass their own smoke; non-dry Beta/production arXiv requires `--accepted-review-artifact`, either as a newline list or accepted-input JSON containing `scraperOnlyValues`.

Project impact:

- Improves research-area discovery, entity context, and credibility.
- Helps students understand what an entity studies before deciding on a pathway.

## Production Readiness Checklist

Before switching a source to production:

- Small dev write passes.
- Larger dev write passes.
- Materialization errors are `0`.
- Conflicts are understood.
- Source coverage warnings are expected or fixed.
- Meilisearch backfill/reindex plan is ready.
- Production command includes `SCRAPER_ENV=production`, `CONFIRM_PROD_SCRAPE=true`, and `--release`.
- Render cron is source-specific and staggered rather than one giant all-scraper job.
