---
name: scrapers
description: Use when working on the scraper system in server/src/scrapers/ - adding or modifying source scrapers, observations, materializers, confidence resolution, or running the scrape CLI. Covers the evidence-first pipeline, safety/write guards, the infrastructure files, and the active source-scraper catalog.
---

# Scrapers

The scraper system lives in `server/src/scrapers/`. Run via `yarn --cwd server scrape <command>` (uses `server/src/scrapers/cli.ts`). See `docs/scraper-audit-guide.md` and `docs/scraper-deployment-runbook.md` for audit and deployment details.

## Core rule: evidence-first

Scrapers emit append-only `Observation` rows; materializers derive first-class access records. **Never hard-assert product conclusions directly from scraper output.** Preserve raw observations/source records, then materialize derived fields through resolver/materializer logic. Avoid binary fields like `acceptingUndergrads` - produce source evidence and `AccessSignal`s with evidence strength instead.

## Safety rules (write guards)

- Non-production environments default to dry-run. Set `ALLOW_NON_PROD_SCRAPER_WRITES=true` to write to a dev DB.
- Production requires `SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true`.
- `scraperEnvironment.ts` enforces `SCRAPER_ENV` write guards.
- Do not expose scraped contact data indiscriminately. Contact routes are fail-closed: prefer official/public URLs; redact scraped emails from public payloads.
- Any outbound fetch to a host derived from user input or stored data MUST go through `utils/ssrfGuard.ts`.

## Infrastructure files

- `cli.ts` - CLI entrypoint (`scrape run`, `scrape materialize`, `scrape report`, etc.)
- `orchestrator.ts` - `ScraperOrchestrator` runs registered scrapers sequentially
- `registry.ts` - registers all source scrapers
- `observationStore.ts` - writes `Observation` rows. Supersession keys on `observationFingerprint`: a new observation supersedes prior non-superseded ones with the same fingerprint. Fingerprint = `(sourceName, entityType, entity, field)` and, for most fields, `value`. **Latest-wins fields** (`LATEST_WINS_FINGERPRINT_FIELDS`: `fullDescription`, `shortDescription`, `researchAreas`, `methods`) omit `value`, so a fresh observation supersedes the prior one despite text drift. Only add a field there if no source emits it as multiple rows per (entity, field) per run.
- `entityMaterializer.ts` - derives `ResearchEntity`/`ResearchGroupMember`. `materializeInferredPiMembership` (labs, from grant-inferred PI keys) and `materializeInferredDirectorMembership` (organizational homes, from `center-director-llm`'s entity-level inferred-director observation) attach the entity **lead**: each resolves the name to a unique Yale User and upserts a `pi`/`director` member. Promoting a director also lets the access materializer upgrade an organizational home from its "no named director" `DEPARTMENT_CONTACT` fallback to a named-lead `FACULTY_PI` ways-in on the same pass. Official roster rows use stable profile identity and membership keys; only a complete non-empty snapshot archives disappeared source-owned rows, while failed, empty, partial, stale, or withheld snapshots preserve current history.
- `accessMaterializer.ts` - derives `AccessSignal`, `EntryPathway`, `ContactRoute`. When the pipeline yields no source-backed (http-URL) entry pathway, it falls back to an evidence-based ways-in: concrete faculty/lab home with an attached PI/director lead + official non-grant page -> low-confidence `EXPLORATORY_CONTACT` + `FACULTY_PI` route + `REACH_OUT_PLAUSIBLE` signal; organizational home with an official page but no named director -> center-level "Explore this center" `EXPLORATORY_CONTACT` + `DEPARTMENT_CONTACT` route + signal. Both skip duplicates, grant/ORCID-only sources, and programs, and require a supporting source observation. Backfill with `yarn --cwd server research-homes:backfill-faculty-ways-in` (dry-run-first).
- `workPlanner.ts` - per-entity field-level work planning
- `snapshotCache.ts` - caches fetched pages to avoid redundant HTTP requests
- `scraperEnvironment.ts` - enforces `SCRAPER_ENV` write guards
- `sourceCoverageRegistry.ts` - declares source priority, tier, and artifact types
- `cronRunner.ts` - cron-aware runner with distributed job locking (`ScrapeJobLock`)
- `confidenceResolver.ts` - pure-function aggregator that picks a winning observation value and computes a confidence score (no DB calls, fully testable)
- `observationRetention.ts` - TTL/cleanup for old observation rows
- `renderedFetch.ts` - headless-browser fetch helper for JS-rendered pages
- `runReport.ts` - structured report for a completed scrape run
- `scrapeJobLock.ts` - acquire/heartbeat/release helpers wrapping the `ScrapeJobLock` model
- `seedSources.ts` - populates the `Source` collection from the coverage registry
- `integrityGate.ts` - post-materialization integrity gate (duplicate entities/people/papers, current members on archived entities, duplicate routes/signals, active artifacts on archived entities), with recommended CLI repair commands
- `paperAuthorshipPolicy.ts` - policy for which paper authorships are accepted/attributed
- `cliHelpers.ts` / `scraperCliOutput.ts` / `types.ts` - CLI parsing, output formatting, shared types
- `scraplingBridge.py` - Python bridge for utilities requiring Python tooling

## Active source scrapers (`server/src/scrapers/sources/`)

| Scraper                                  | Data                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `nsfAwardScraper.ts`                     | NSF grant awards                                                                                                                      |
| `nihReporterScraper.ts`                  | NIH Reporter grants                                                                                                                   |
| `centersInstitutesScraper.ts`            | Yale centers and institutes index                                                                                                     |
| `departmentRosterScraper.ts`             | Department faculty roster pages                                                                                                       |
| `ysmAtoZScraper.ts`                      | Yale School of Medicine A-Z index                                                                                                     |
| `yseCentersScraper.ts`                   | Yale School of Engineering centers                                                                                                    |
| `arxivPreprintScraper.ts`                | arXiv preprints                                                                                                                       |
| `openAlexPaperScraper.ts`                | OpenAlex paper metadata                                                                                                               |
| `orcidWorksScraper.ts`                   | ORCID public works with identity-backed authorship                                                                                    |
| `europePmcPaperScraper.ts`               | Europe PMC and PubMed ORCID-backed paper metadata                                                                                     |
| `crossrefPaperScraper.ts`                | Crossref DOI metadata hydration                                                                                                       |
| `departmentUndergradResearchScraper.ts`  | Department-level undergrad research opportunity/program pages                                                                         |
| `undergradFellowshipRecipientScraper.ts` | Undergrad fellowship recipient lists                                                                                                  |
| `labMicrositeUndergradLLMExtractor.ts`   | LLM extraction of undergrad-access signals from lab microsites                                                                        |
| `labMicrositeDescriptionLLMExtractor.ts` | LLM extraction of lab description text from microsites                                                                                |
| `centerDirectorLLMExtractor.ts`          | LLM extraction of the single named director of an organizational home from its official site + leadership pages                       |
| `studentDecisionLLMExtractor.ts`         | LLM extraction of student-decision signals from lab microsites                                                                        |
| `officialProfilePiBackfillScraper.ts`    | Backfill scraper for PI official-profile data                                                                                         |
| `officialResearchHomeRosterScraper.ts`   | Disabled-by-default, allowlisted current non-lead research-home rosters with stable official-profile identities and bounded freshness |
| `yaleResearchOfficialScraper.ts`         | Yale Research (provost/OVPR) official data                                                                                            |
| `yaleCollegeFellowshipsOfficeScraper.ts` | Yale College Fellowships Office public catalog                                                                                        |
| `yaleDirectoryScraper.ts`                | Faculty roster via Yalies API (live equivalent of the static bootstrap import)                                                        |
