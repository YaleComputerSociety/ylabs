# Scraper Audit Guide

Last updated: 2026-07-21

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
  -> ResearchEntity/Researcher/RoleAssignment/Grant/etc.
  -> Signal (access types) when evidence supports it
  -> student surfaces: Research, Evidence, Best Next Step
```

Most scrapers write raw `Observation` rows first. `entityMaterializer.ts` then upserts physical entities such as `research_entities`, canonical `researchers`, and `role_assignments` (the roster; the legacy `users` collection is retired, #2014). `accessMaterializer.ts` derives typed `Signal` rows in `signals` from evidence-bearing observations. Contact routes and entry pathways are no longer modeled: contact is a derived official-profile link-out, and scraped emails are never surfaced.

Meilisearch failures are non-blocking during scraper audit if Mongo writes and materialization succeed. Reindex/backfill Meilisearch after the source data looks good.

## Shared Collections

Every scraper run can touch:

- `sources`: seeded source registry and source coverage metadata.
- `scrape_runs`: one run record per CLI execution, including report counters and materialization metrics.
- `observations`: append-only field evidence from the scraper.
- `scrape_snapshots`: optional fetch/API cache when `--use-cache` is used.

Materialization may then touch:

- `researchers`: canonical public research identities, with `role_assignments` roster edges (the legacy `users` collection is retired, #2014).
- `research_entities`: physical backing for `ResearchEntity`.
- `grants`: funding records.
- `signals`: typed `Signal` rows for evidence-backed access clues and undergraduate logistics claims (each former access `signalType` and each logistics claim type is its own `Signal.type`).

Transitional note: until the human-gated `signalConsolidationMigration` is applied, the legacy `access_signals` and `undergraduate_logistics_claims` collections may still hold un-migrated rows, so audits should account for both those collections and `signals` until the migration completes.

## Safe Audit Commands

List available scrapers:

```bash
npx -y corepack@0.34.7 yarn --cwd server scrape list
```

Seed source metadata in the target DB:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn --cwd server scrape:seed-sources --dry-run --output /tmp/ylabs-seed-sources-dry-run.json
  npx -y corepack@0.34.7 yarn --cwd server scrape:seed-sources --apply --confirm-seed-apply --output /tmp/ylabs-seed-sources-apply.json
```

Dry-run without writes:

```bash
SCRAPER_ENV=development \
  npx -y corepack@0.34.7 yarn --cwd server scrape run --source <source-name> --limit 10 --use-cache
```

Small development write with materialization:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn --cwd server scrape run --source <source-name> --limit 10 --use-cache --auto-materialize
```

Scale up in development:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn --cwd server scrape run --source <source-name> --limit 100 --use-cache --auto-materialize
```

Production writes require both `--release` and `CONFIRM_PROD_SCRAPE=true`:

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  npx -y corepack@0.34.7 yarn --cwd server scrape run --source <source-name> --release --auto-materialize
```

This command is blocked until the production promotion operator packet in [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md) is filled and accepted. Do not use the command to make the lane decision.

## Audit Checklist

For every source:

- Confirm the Mongo target printed by the CLI is the intended database.
- Start with dry-run, then a small dev write, then a larger dev write.
- Inspect the printed run report.
- Confirm `observationCount` and `entitiesObserved` are plausible.
- Confirm `materialization.errors` is `0`.
- Investigate `materialization.conflicts` before production.
- Treat local Meilisearch `ECONNREFUSED` as non-blocking during audit.
- Confirm the source does not create access artifacts it should not create.
- Confirm source coverage warnings are either expected or documented as follow-up work.
- Use the deployment runbook before Beta seeding or production cron setup.

Useful report command:

```bash
npx -y corepack@0.34.7 yarn --cwd server scrape report --run <scrapeRunId>
```

To save a durable QA artifact outside the repo, add `--output`:

```bash
npx -y corepack@0.34.7 yarn --cwd server scrape report --run <scrapeRunId> --output /tmp/ylabs-scraper-reports/<scrapeRunId>.json
```

When a run has nonzero `materialization.conflicts`, the saved report also includes
`quality.materializationConflictReview`. That review is read-only and samples active
Observation conflicts for the entities touched by the run, with field/source counts,
bounded samples, and direct contact details redacted from value previews. It omits
materializer-managed fields such as `lastObservedAt`, which are set by the materializer
rather than resolved from scraper observations. The review includes `categoryCounts`,
`actionableConflictCount`, and per-sample `reviewCategory` values for additive metadata,
identity/routing, content, access-evidence, funding-context, and other conflicts. Use
the review to decide whether conflicts are benign metadata churn, source-specific
review work, or materializer/source bugs. It does not by itself clear the conservative
source-health warning.

Not every counted conflict is an observation conflict.
The user-identity enrichment path also counts one when a source-resolved ORCID is already claimed by another `Researcher`: the existing holder keeps the ORCID, the enriched researcher keeps the identity it already had, and the collision is logged rather than failing the run.
Such a conflict has no matching sample in the review, so the run log line naming the colliding ORCID is the signal that upstream directory data carries a duplicate to fix at the source.

Useful source-health summary:

```bash
npx -y corepack@0.34.7 yarn --cwd server source:health
```

The source-health command is read-only. It summarizes enabled sources, recent run status, coverage metadata, materialization errors/conflicts, and the next action needed before promotion.

Useful access-claim gate:

```bash
npx -y corepack@0.34.7 yarn --cwd server scraper:claim-gate --collection=research --include-samples
```

The claim gate is read-only. It validates existing access-signal artifacts against deterministic source-evidence contracts and reports accepted, review, and rejected interpretations. Use `--strict` when a promotion gate should fail on rejected claims, and `scraper:integrity-gate --include-claim-gate` when the claim summary should travel with the broader post-materialization integrity artifact.

## Recommended Audit Order

1. `dept-faculty-roster`: entity/faculty/lab ownership trunk.
2. `lab-microsite-undergrad-llm`: high-value access evidence, higher risk because it uses LLM and live websites.
3. `undergrad-fellowships-recipients`: past-undergrad and fellowship-compatible evidence.
4. `yale-college-fellowships-office`: fellowship program and application-cycle observations.
5. `yale-research-official`, `centers-institutes-index`, `ysm-atoz-index`, `ysm-faculty-directory`, `yse-centers-index`, `yse-faculty-directory`: entity discovery.
6. `official-research-home-roster`: gated current-team context after reviewed-source and sampled-precision approval.
7. `nih-reporter`, `nsf-award-search`: funding and research-context enrichment.

## Source Map

| Scraper                            | Main purpose                                                                                                                          | Primary observation entity types                                       | Expected materialized collections                                                              | Access-model impact                                                                                                                                                                                 | Audit notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dept-faculty-roster`              | Discover faculty, official profile URLs, ORCID, lab/personal sites, Scholar review candidates, inferred PI ownership                  | `researchEntity`, `user`                                               | `researchers`, `research_entities`                                                                   | Should not create access `signals`. Contact is a derived official-profile link-out, not a materialized artifact.                                                                                    | Audit by department when possible. The authoritative list of covered configs is `DEFAULT_DEPT_CONFIGS` in `server/src/scrapers/sources/departmentRosterScraper.ts`, which now includes school-wide index rows (e.g. the `ysph` "Faculty Directory by Name" A-Z page) alongside per-department rosters (all SEAS engineering departments are covered as of #640). Taxonomy/topic links must be parsed as separate labels, not flattened container text; generic index URLs such as the Yale Medicine A-to-Z lab website directory must not be promoted as a specific lab website. Large runs can be slow because profile pages are enriched sequentially. |
| `official-profile-pi-backfill`     | Repair queued PI identity rows from already-known official Yale profile URLs                                                          | `user`                                                                 | `researchers`                                                                                        | Identity/profile evidence only. Existing repair queue may later attach PI by exact profile URL; the scraper itself must not create membership, department/org, or action evidence.                  | Run with `--only medicine-pi-backfill` and a small `--limit`. Reject mismatched canonical URLs, name-only matches, missing Yale email/NetID, center membership pages, listing pages, non-profile pages, and ambiguous identities.                                                                                                                                                                                                                                                                           |
| `official-research-home-roster`    | Acquire reviewed current non-lead team membership from explicit official roster sections                                              | `researchEntity`, `researchGroupMember`                                | `research_entities`, `role_assignments`                                                 | Team context only. Must not create access, availability, or contact claims.                                                                                                                         | Disabled by default. Require stable official-profile identity, bounded freshness, a clean structural audit, and an attributable sampled-precision review before broad enablement.                                                                                                                                                                                                                                                                                                                           |
| `lab-microsite-undergrad-llm`      | Extract evidence from lab/faculty websites: join pages, role language, constraints, contact instructions, and undergraduate logistics | `researchEntity`                                                       | `research_entities`, access records, and logistics `signals` when exact evidence supports them | Can create access and logistics `signals` and independent logistics claims through validated materializers. Bare join-page URLs without undergrad access evidence should not create access signals. | Start with small `--limit`. Requires `OPENAI_API_KEY`. Review every logistics quote against its exact `quoteSourceUrl`, inspect freshness, and complete the sampled precision audit before broad release.                                                                                                                                                                                                                                                                                                   |
| `lab-microsite-description-llm`    | Extract source-backed description, topics, and methods from official lab/profile/center pages                                         | `researchEntity`                                                       | `research_entities` through normal materialization                                             | Description only. Must not emit undergrad access, contact, opening, or application claims.                                                                                                          | Defaults to open `source_description` visibility-queue rows, considers `websiteUrl`, `website`, and `sourceUrls`, and supports targeted `--only <id-or-slug>` plus `--offset`/`--limit`. Requires `OPENAI_API_KEY`; dry-run and inspect conflict report first.                                                                                                                                                                                                                                              |
| `undergrad-fellowships-recipients` | Capture evidence of past undergrad advisees and fellowship-compatible research                                                        | `researchEntity`                                                       | `research_entities`, `signals`                                                                 | Can create exploratory outreach access signals plus `PAST_UNDERGRADS` and `FELLOWSHIP_COMPATIBLE` signals. Fellowship funding remains formalization evidence, not a standalone access signal.       | Many programs require manual upload or CSV/PDF handling. Audit skipped/manual-upload programs separately.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `yale-college-fellowships-office`  | Capture official Yale fellowship catalog and public detail-page evidence                                                              | `fellowship`                                                           | `observations`, then Fellowship/program records through guarded backfill/materialization flows | Emits classification, visibility, research-focus, and source-backed application-process observations; missing evidence remains unknown. Does not derive access signals or opportunities.            | Canonicalizes the moved Mellon Mays URL from `yalecollege.yale.edu/finances/...` to `college.yale.edu/life-at-yale/...`; never fetches gated CommunityForce application pages.                                                                                                                                                                                                                                                                                                                              |
| `centers-institutes-index`         | Discover centers, institutes, child centers, directors/members, official pages                                                        | `researchEntity`, `user`, `researchGroupMember` depending on extractor | `research_entities`, `researchers`, `role_assignments`                                        | Entity and membership context. Should not imply undergrad access unless explicit access evidence is added later.                                                                                    | Check member/director parsing and skipped JS/gated configs.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ysm-atoz-index`                   | Discover YSM lab websites from official index                                                                                         | `researchEntity`                                                       | `research_entities`                                                                            | Discovery only. Should not emit or materialize undergraduate-access claims from index rows.                                                                                                         | Useful seed for lab microsite crawling. Audit that it does not create student-facing access claims by itself.                                                                                                                                                                                                                                                                                                                                                                                               |
| `ysm-faculty-directory`            | Discover YSM faculty from the school-wide A-Z directory seed, then extract identity, research home, governed MeSH research areas, and official profile prose from each individual profile page | `user`, `researchEntity`                                               | `researchers`, `research_entities`, `role_assignments` (lead PI)                                     | Discovery only. Should not imply undergraduate access without explicit access evidence. Seeds a `FACULTY_RESEARCH_AREA` home from profile research areas or official research prose, or a `LAB` home when the profile links its own site. | Each individual profile page is the cited source; the directory root (~14k entries, mostly non-research staff/trainees) is a crawl seed only and is never recorded as a source. Profiles with no lab website, no research areas, and no research description are skipped, so non-research staff are excluded without a title allowlist. The lead PI keys on the profile's own email/NetID, never a surname search, so it does not reintroduce the #562/#579 surname-collision bug. |
| `yse-centers-index`                | Discover YSE centers/programs/initiatives                                                                                             | `researchEntity`                                                       | `research_entities`                                                                            | Discovery only. Should not emit or materialize undergraduate-access claims from index rows.                                                                                                         | Useful seed for broader research entities.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `yse-faculty-directory`            | Discover Yale School of the Environment faculty from the directory seed, then extract identity, research home, research areas, and official profile prose from each individual profile page | `user`, `researchEntity`                                               | `researchers`, `research_entities`, `role_assignments` (lead PI)                                     | Discovery only. Should not imply undergraduate access without explicit access evidence. Seeds a `FACULTY_RESEARCH_AREA` home from profile research areas or official research prose, or a `LAB` home when the profile links its own site. | Each individual profile page is the cited source; the directory root and loader endpoints are rejected listings and are never recorded as a source. The lead PI keys on the person-specific `@yale.edu` email so the materializer reconciles to the canonical `Researcher`; the school name is kept out of entity departments. |
| `yale-research-official`           | Discover official research.yale.edu centers, institutes, and core facilities                                                          | `researchEntity`                                                       | `research_entities`                                                                            | Discovery only. Must not emit or materialize undergraduate-access, contact-route, application, or posted-opening claims from directory rows.                                                        | Active configs cover `research.yale.edu/centers-institutes` and filtered core/facility directory rows under `research.yale.edu/cores?f%5B0%5D=result_type%3A1`. Use as source-backed entity identity and infrastructure context, then follow official entity URLs for access evidence.                                                                                                                                                                                                                      |
| `yale-directory`                   | Authoritative Yale appointment/profile metadata                                                                                       | `user`                                                                 | `researchers` (enrichment only)                                                                     | Membership/profile context only. Not access evidence.                                                                                                                                               | Depends on Yalies/API configuration. Good for improving person matching. Bare directory identity no longer mints a `Researcher` or `Account`; it only enriches a researcher a research signal already attached, recording the netid on `Researcher.identifiers.netid` and filling profile fields (skips `directory-identity-without-research-signal`). Accounts are created only at login.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `nih-reporter`                     | Pull Yale NIH grants and PI/co-PI context                                                                                             | `user`, `researchEntity`, grant-shaped observations                    | `researchers`, `research_entities`, `grants`                                                         | Funding/topic enrichment only. Not undergraduate access evidence.                                                                                                                                   | Audit PI matching, synthetic keys, grant counts, and duplicate external IDs.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `nsf-award-search`                 | Pull Yale NSF awards and PI/co-PI context                                                                                             | `user`, `researchEntity`, grant-shaped observations                    | `researchers`, `research_entities`, `grants`                                                         | Funding/topic enrichment only. Not undergraduate access evidence.                                                                                                                                   | Especially useful where department pages are JS-heavy.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Directory, grant, and dataset sources are not research-description sources.
Cancer, WTI, Economics, English, department, and center listing pages can support source or membership provenance but must be followed to individual official profile or lab pages for public description copy.
NIH and NSF records can support funding and research-context evidence, but must not repair `fullDescription` or `shortDescription` by copying award summaries, raw data titles, or source chrome.
The one sanctioned exception is the guarded `grant-corpus-synthesis-llm` lane, which synthesizes a grounded PI-level description from the aggregated grant corpus instead of copying any award text; its contract lives in [`docs/research-data-pipeline.md`](./research-data-pipeline.md).
OpenAlex, arXiv, ORCID works, Europe PMC, PubMed, Crossref, and official-profile publication ingestion are retired and must not appear in audit rollout plans; see the authoritative retirement contract in [`docs/research-data-pipeline.md`](./research-data-pipeline.md).
Keep reviewed Google Scholar and ORCID profile links as outbound researcher navigation only.
Paper materialization and the `Paper`/`PaperAuthor` models and their readers are fully retired with no rollback opt-in; historical `paper` source rows and observations are retained as read-only archived evidence, and stored `papers`/`paper_authors` collections remain only until the human-gated collection drop under issue #207.

## Per-Source Audit Playbooks

### `dept-faculty-roster`

Commands:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn --cwd server scrape run --source dept-faculty-roster --limit 100 --use-cache --auto-materialize
```

Expected collections:

- `observations`: person and research-entity observations.
- `researchers`: canonical faculty/person rows (with `role_assignments` roster edges).
- `research_entities`: inferred lab/group/entity rows.

Expected report shape:

- `accessSignals` should be `0`.
- `researchEntity` and `user` observation counts should be nonzero.
- Any configured source that fetched but yielded zero faculty is flagged: it carries an `empty` status in the `Departments:` notes summary and is named in a `WARNING: ... yielded no faculty` log line, signalling a likely site migration or renamed layout whose URL and extractor need re-verification.

Project impact:

- Improves faculty-to-entity ownership.
- Finds official profile URLs and lab websites.
- Seeds later lab microsite crawling.

### `lab-microsite-undergrad-llm`

Commands:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn --cwd server scrape run --source lab-microsite-undergrad-llm --only <reviewed-slug> --limit 1 --use-cache --auto-materialize
```

Logistics observations remain staging-gated unless the run supplies an explicit allowlist of at most 25 unique slugs.
Runs without that bounded allowlist continue to emit legacy undergraduate signals but cannot emit logistics observations.

Expected collections:

- `observations`: evidence-shaped access fields plus independently quoted logistics fields for student level, compensation or credit, weekly time, modality, and current availability when the run uses the required bounded allowlist.
- `signals` (access types): reach-out plausible, application form exists, contact instructions exist, or not currently available.
- `signals` (logistics types): one independently materialized row per supported claim type, including withheld stale or conflicting states.

Audit focus:

- Quotes are real and traceable to `sourceUrl`/`quoteSourceUrl`.
- Every logistics quote supports only its associated normalized claim.
- LLM evidence remains low-trust and conservative.
- No access signal overstates availability from a generic join page.
- Direct emails and phone numbers are redacted from public quote/excerpt fields unless a guarded contact policy explicitly allows display.
- A warning about emitted observations with zero fetch successes can be expected when normal HTTP fetches succeed but only rendered-fallback fetch metrics are counted; inspect per-run errors before treating it as source failure.

Project impact:

- Main source for credible access evidence.
- Helps students answer "what should I do next?" from official lab evidence.

### `lab-microsite-description-llm`

Commands:

```bash
SCRAPER_ENV=beta \
  npx -y corepack@0.34.7 yarn --cwd server scrape run --source lab-microsite-description-llm --dry-run --only <entity-id-or-slug> --limit 1 --output /tmp/ylabs-description-llm-dry-run.json

SCRAPER_ENV=beta ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn --cwd server scrape run --source lab-microsite-description-llm --only <entity-id-or-slug> --limit 1 --auto-materialize --output /tmp/ylabs-description-llm-apply.json
```

Expected collections:

- `observations`: `fullDescription`, `shortDescription`, `researchAreas`, and `methods`.
- `research_entities`: profile fields only after accepted materialization.

Audit focus:

- Use this for `source_description` queue rows after the repair queue finds no deterministic patch.
- Prefer entity/lab/research-home pages over listing pages or generic profile pages.
- A profile-page extraction may improve stored text but still leave the row in `operator_review` when the visibility gate flags `thin_description`, missing lead, or missing action evidence.
- It must not emit access evidence, join pages, contacts, or applications.
- Review `quality.conflictCandidateCount`, missing source URL counts, and source URL provenance before applying.
- An emitted `sourceUrl` may be a same-host research page the entity's own page links (`/research`, `/research_page/`) rather than a stored `websiteUrl`/`website`/`sourceUrls` value, so an unfamiliar subpage URL is expected provenance here, not a defect; `skills/scrapers/SKILL.md` owns the crawl and page-selection rules (#2176).

Project impact:

- Converts source acquisition into a targeted lane instead of repeatedly retrying the deterministic repair queue.
- Helps distinguish rows that need better official URLs from rows where existing profile pages are insufficient to clear the launch gate.

### `department-undergrad-research`

Commands:

```bash
SCRAPER_ENV=development \
  npx -y corepack@0.34.7 yarn --cwd server scrape run --source department-undergrad-research --limit 10 --dry-run
```

Expected collections after an accepted materialized write:

- `observations`: department-backed program identity, access evidence, contact, and application-route fields.
- `fellowships`: program records from these pages materialize onto `/programs` as `Fellowship` records, not `PROGRAM` research entities (that entity type no longer exists).
- access `signals` through access materialization.
- no `research_entities`: no configured page uses the per-faculty `physics-project-list` parser, so this source no longer mints `LAB` research homes.

Audit focus:

- Use this deterministic department-page lane before targeted LLM repair for action-evidence gaps.
- Treat department pages as evidence, not final claims that a lab is accepting students.
- Generic department guidance should remain exploratory access evidence, not an overstated opening.
- Direct contact details are never surfaced; contact is a derived official-profile link-out.
- A single dead department page is skipped rather than aborting the run, and each skip is recorded as a failed attempt in the run's `fetchMetrics`, so check the report's fetch coverage for `failed` and `selectorBreakages` before accepting a run.
- The run still fails outright when every attempted page fails, so a site-wide restructure stays loud in source health.

Project impact:

- Adds official, deterministic undergraduate research routes before any broad LLM or worker automation.
- The authoritative list of covered department pages is `DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES` in `server/src/scrapers/sources/departmentUndergradResearchScraper.ts`; audit by page key (`--only <key>`) rather than against a copied department list.

### `undergrad-fellowships-recipients`

Commands:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn --cwd server scrape run --source undergrad-fellowships-recipients --limit 50 --use-cache --auto-materialize
```

Expected collections:

- `observations`: `pastUndergradAdvisees`, legacy `acceptingUndergrads`.
- `research_entities`: faculty-owned entities.
- `signals`: `PAST_UNDERGRADS`, `FELLOWSHIP_COMPATIBLE`.

Audit focus:

- Advisor matching is precise.
- Manual-upload-required programs are logged, not silently treated as zero evidence. Accepted CSVs are read from `--manual-recipient-csv-dir` when provided, otherwise from `/tmp/ylabs-accepted-inputs/fellowships/<programKey>.csv`; when no CSV is present, the scraper falls back to `/tmp/ylabs-accepted-inputs/fellowships/<programKey>.pdf` and parses labelled recipient/advisor text from the official PDF.
- Past participation is shown as historical/fellowship-compatible evidence, not an active opening.

Project impact:

- Helps students find plausible fellowship/thesis supervisors with real past undergrad evidence.

### `yale-college-fellowships-office`

Commands:

```bash
SCRAPER_ENV=development \
  npx -y corepack@0.34.7 yarn --cwd server scrape run --source yale-college-fellowships-office --limit 10 --dry-run --use-cache
```

Expected collections in `new-foundation`:

- `observations`: fellowship title, summary/description, application link, deadline, source URL, source key, source name, source fingerprint, program classification, and visibility input fields.
- `fellowships`: program/source/student-visibility fields after approved backfill or materialization.

Audit focus:

- Stale Yale College financial-awards links for Mellon Mays must canonicalize to `https://college.yale.edu/life-at-yale/student-faculty-awards/mellon-mays-undergraduate-fellowship-program`.
- CommunityForce links should be retained as `applicationLink`/`links` values, not fetched.
- Generic fellowship-administration, advising, navigation, and alternative-funding pages should either be suppressed or kept in operator review rather than becoming student-ready program records.
- The source should emit program/funding evidence only; it must not create access signals or student-facing research opportunities from fellowship funding pages.
- Run `yarn --cwd server programs:backfill-classification` and `yarn --cwd server student-visibility:backfill` in dry-run mode before applying any DB updates.

Project impact:

- Gives the operator board and canonical `/programs` surface official fellowship URL/deadline evidence with explicit student visibility tiers.

### Official Research-Home Rosters

Source:

- `official-research-home-roster`

Expected collections:

- `observations`
- `research_entities` for bounded roster refresh state
- `role_assignments` for verified current and archived historical roles

Audit focus:

- Run the source in dry-run mode against the narrow reviewed allowlist before any write.
- Use `yarn --cwd server scrape run --source official-research-home-roster --only <research-entity-key> --limit 1` for a bounded source review; add the normal environment write confirmation and `--auto-materialize` only after the dry-run evidence is accepted.
- Confirm every accepted section is explicitly configured as current and that former or alumni sections remain excluded.
- Confirm each materialized member has a unique official profile identity, an honest mapped role, an observation date, and an unexpired freshness window.
- Confirm duplicate profile identities, same-profile different-name collisions, ambiguous roles, unsafe links, and direct contact text are withheld.
- Run `yarn --cwd server research-homes:audit-rosters --strict --output /tmp/ylabs-roster-audit.json` after Beta materialization.
- Review the bounded sample manually, then rerun with `--sampled-precision-reviewed-by=<reviewer>` so the approval is attributable in the report.
- The audit checks every entity in `OFFICIAL_ROSTER_CONFIGS` and fails closed when an allowlisted entity is missing or its latest snapshot is failed, empty, withheld, stale, expired, or mismatched.
- Every membership key declared by the latest snapshot must have a fresh verified current row materialized for the same entity, official source URL, and snapshot observation time.
- Do not enable the source broadly unless `broadEnablementReady` is true.
- `--strict` exits non-zero until both the structural checks pass and `--sampled-precision-reviewed-by=<reviewer>` records the manual sample review; `--sample-limit=<0-100>` controls the bounded sample in the JSON report.
- Confirm a successful complete non-empty refresh archives disappeared source-owned rows, while empty or failed refreshes archive nothing.

Project impact:

- Adds bounded team-composition context without implying access, availability, or permission to contact a member.

### Entity Discovery Sources

Sources:

- `centers-institutes-index`
- `yale-research-official`
- `ysm-atoz-index`
- `ysm-faculty-directory`
- `yse-centers-index`
- `yse-faculty-directory`
- `yale-directory`

Expected collections:

- `observations`
- `research_entities`
- `researchers`
- `role_assignments` for richer center/member extraction

Audit focus:

- They discover entities, websites, official profiles, and membership.
- They do not create access `signals` from index-only evidence.
- Any legacy `acceptingUndergrads` field remains compatibility data only unless backed by explicit evidence.

Project impact:

- Broadens "Explore Research" beyond labs.
- Feeds later microsite, access-evidence, and admin review workflows.

### Funding Enrichment

Sources:

- `nih-reporter`
- `nsf-award-search`

Expected collections:

- `observations`
- `researchers`
- `research_entities`
- `grants`

Audit focus:

- External IDs dedupe correctly.
- PI/faculty matching is conservative.
- Topics and funding context enrich research entities without creating access claims.

Project impact:

- Improves research-area discovery, entity context, and credibility.
- Helps students understand what an entity studies before deciding on a next step.

## Production Readiness Checklist

Before switching a source to production:

- The operator has read the production gate in [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md).
- The promotion lane is explicit: accepted Beta copy or guarded production delta.
- A Production Atlas backup or restore point exists and rollback ownership is clear.
- Small dev write passes.
- Larger dev write passes.
- Materialization errors are `0`.
- Conflicts are understood.
- Source coverage warnings are expected or fixed.
- Meilisearch backfill/reindex plan is ready.
- Production command includes `SCRAPER_ENV=production`, `CONFIRM_PROD_SCRAPE=true`, and `--release`.
- Render cron is source-specific and staggered rather than one giant all-scraper job.
- Render cron does not assume Yale VPN, local accepted-input files, local Meili, or interactive browser dependencies.
- Post-write smoke checks cover Research, Programs/Fellowships visibility, admin auth, removed legacy routes, source health, and Meili counts.
