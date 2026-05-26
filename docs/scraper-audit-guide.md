# Scraper Audit Guide

Last updated: 2026-05-25

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
  -> ResearchEntity/User/Paper/Grant/etc.
  -> EntryPathway / AccessSignal / ContactRoute / PostedOpportunity when evidence supports it
  -> student surfaces: Research, Pathways, Evidence, Best Next Step
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
- `papers`: publication records.
- `paper_entity_links`: paper-to-research-entity joins.
- `grants`: funding records.
- `entry_pathways`: ways a student can enter.
- `access_signals`: evidence-backed access clues.
- `contact_routes`: guarded routes for next action.
- `posted_opportunities`: real posting/application instances.

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

Dry-run without writes:

```bash
SCRAPER_ENV=development \
  npx -y corepack@0.34.7 yarn scrape run --source <source-name> --limit 10 --use-cache
```

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
npx -y corepack@0.34.7 yarn scrape report --run <scrapeRunId>
```

To save a durable QA artifact outside the repo, add `--output`:

```bash
npx -y corepack@0.34.7 yarn scrape report --run <scrapeRunId> --output /tmp/ylabs-scraper-reports/<scrapeRunId>.json
```

Useful source-health summary:

```bash
npx -y corepack@0.34.7 yarn --cwd server source:health
```

The source-health command is read-only. It summarizes enabled sources, recent run status, coverage metadata, materialization errors/conflicts, and the next action needed before promotion.

Useful department repair conflict review:

```bash
npx -y corepack@0.34.7 yarn --cwd server department-repair:conflict-review --run <scrapeRunId> --output /tmp/ylabs-dept-conflicts.json
```

The conflict review is read-only. It reconstructs per-field resolver conflicts from persisted observations, buckets malformed URL/parser issues, missing lead repairs, safe existing values, and rows that still need operator review before more department repair writes.

Useful posted-opportunity status reaper:

```bash
npx -y corepack@0.34.7 yarn --cwd server opportunities:reap-statuses
```

The reaper defaults to dry-run. Use `--apply` only after reviewing the dry-run output; it closes expired open posted opportunities and marks posted-role pathways unavailable when no active posting remains.

## Recommended Audit Order

1. `dept-faculty-roster`: entity/faculty/lab ownership trunk.
2. `lab-microsite-undergrad-llm`: high-value pathway evidence, higher risk because it uses LLM and live websites.
3. `department-undergrad-research`: deterministic official undergraduate research pages; pause expansion if materialization conflicts remain unreviewed.
4. `undergrad-fellowships-recipients`: past-undergrad and fellowship-compatible evidence.
5. `yale-college-fellowships-office`: fellowship program and application-cycle observations.
6. `centers-institutes-index`, `ysm-atoz-index`, `yse-centers-index`: entity discovery.
7. `nih-reporter`, `nsf-award-search`, `openalex`, `arxiv`: enrichment, funding, publication, and preprint context.

## Source Map

| Scraper                            | Main purpose                                                                                             | Primary observation entity types                                       | Expected materialized collections                                               | Access-model impact                                                                                                                                                                         | Audit notes                                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dept-faculty-roster`              | Discover faculty, official profile URLs, ORCID, lab/personal sites, Scholar review candidates, inferred PI ownership | `researchEntity`, `user`                                               | `users`, `research_entities`                                                    | Should not create `entry_pathways` or `access_signals`. `contact_routes` are a future decision unless guarded contact materialization is added.                                             | Audit by department when possible. Current configs cover Econ, MCDB, CS, Psych, Math, Physics, Statistics, and Astronomy. Large runs can be slow because profile pages are enriched sequentially.                                                       |
| `lab-microsite-undergrad-llm`      | Extract evidence from lab/faculty websites: join pages, role language, constraints, contact instructions | `researchEntity`                                                       | `research_entities`, then access records when evidence supports them            | Can create `access_signals`, `entry_pathways`, and guarded `contact_routes` through `accessMaterializer.ts`. Should preserve quotes/source URLs and avoid final claims inside scraper code. | Start with small `--limit`. Requires `OPENAI_API_KEY`. Review quotes and `quoteSourceUrl` carefully.                                                                                                                                                  |
| `undergrad-fellowships-recipients` | Capture evidence of past undergrad advisees and fellowship-compatible research                           | `researchEntity`                                                       | `research_entities`, `entry_pathways`, `access_signals`                         | Can create exploratory outreach pathways plus `PAST_UNDERGRADS` and `FELLOWSHIP_COMPATIBLE` signals. Fellowship funding remains formalization evidence, not a standalone entry pathway.     | Many programs require manual upload or CSV/PDF handling. Audit skipped/manual-upload programs separately.                                                                                                                                             |
| `yale-college-fellowships-office`  | Capture official Yale fellowship program titles, deadlines, application links, source metadata, and program classification | `fellowship`                                                           | `observations`, then Fellowship/program records through guarded backfill/materialization flows | Emits program classification and student-visibility input evidence. It does not create `PostedOpportunity`, `EntryPathway`, `AccessSignal`, or `ContactRoute` rows from fellowship funding pages. | Canonicalizes the moved Mellon Mays URL from `yalecollege.yale.edu/finances/...` to `college.yale.edu/life-at-yale/...`; never fetches gated CommunityForce application pages.                                                                         |
| `centers-institutes-index`         | Discover centers, institutes, child centers, directors/members, official pages                           | `researchEntity`, `user`, `researchGroupMember` depending on extractor | `research_entities`, `users`, `research_entity_members`                         | Entity and membership context. Should not imply undergrad access unless explicit access evidence is added later.                                                                            | Check member/director parsing and skipped JS/gated configs.                                                                                                                                                                                           |
| `ysm-atoz-index`                   | Discover YSM lab websites from official index                                                            | `researchEntity`                                                       | `research_entities`                                                             | Discovery only. Should not emit or materialize undergraduate-access claims from index rows.                                                                                                 | Useful seed for lab microsite crawling. Audit that it does not create student-facing access claims by itself.                                                                                                                                         |
| `yse-centers-index`                | Discover YSE centers/programs/initiatives                                                                | `researchEntity`                                                       | `research_entities`                                                             | Discovery only. Should not emit or materialize undergraduate-access claims from index rows.                                                                                                 | Useful seed for broader research entities.                                                                                                                                                                                                            |
| `yale-directory`                   | Authoritative Yale appointment/profile metadata                                                          | `user`                                                                 | `users`                                                                         | Membership/profile context only. Not access evidence.                                                                                                                                       | Depends on Yalies/API configuration. Good for improving person matching.                                                                                                                                                                              |
| `nih-reporter`                     | Pull Yale NIH grants and PI/co-PI context                                                                | `user`, `researchEntity`, grant-shaped observations                    | `users`, `research_entities`, `grants`                                          | Funding/topic enrichment only. Not undergraduate access evidence.                                                                                                                           | Audit PI matching, synthetic keys, grant counts, and duplicate external IDs.                                                                                                                                                                          |
| `nsf-award-search`                 | Pull Yale NSF awards and PI/co-PI context                                                                | `user`, `researchEntity`, grant-shaped observations                    | `users`, `research_entities`, `grants`                                          | Funding/topic enrichment only. Not undergraduate access evidence.                                                                                                                           | Especially useful where department pages are JS-heavy.                                                                                                                                                                                                |
| `openalex`                         | Sync publications and author/group links                                                                 | `paper`, possibly `user`/entity-linked observations                    | `papers`, `paper_entity_links`, `research_entities` when linked                 | Publication/topic enrichment only. Not access evidence.                                                                                                                                     | Audit paper counts, Yale author matches, and entity links.                                                                                                                                                                                            |
| `arxiv`                            | Sync recent author-matched preprints before journal publication                                          | `paper`                                                                | `papers`                                                                        | Preprint/recent research enrichment only. Not access evidence by itself.                                                                                                                    | Audit exact-author matching, duplicate paper IDs, and recency fields. Use small `--limit` runs because the API should be queried politely.                                                                                                            |

## Per-Source Audit Playbooks

### `dept-faculty-roster`

Commands:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn scrape run --source dept-faculty-roster --limit 100 --use-cache --auto-materialize
```

Expected collections:

- `observations`: user and research-entity observations.
- `users`: faculty rows.
- `research_entities`: inferred lab/group/entity rows.

Expected report shape:

- `entryPathways`, `accessSignals`, `postedOpportunities` should be `0`.
- `researchEntity` and `user` observation counts should be nonzero.
- If `ContactRoute` appears as missing expected output, decide whether to add guarded contact materialization or remove `ContactRoute` from source coverage metadata.

Project impact:

- Improves faculty-to-entity ownership.
- Finds official profile URLs and lab websites.
- Seeds later lab microsite crawling.

### `lab-microsite-undergrad-llm`

Commands:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn scrape run --source lab-microsite-undergrad-llm --limit 10 --use-cache --auto-materialize
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

### `department-undergrad-research`

Commands:

```bash
SCRAPER_ENV=development \
  npx -y corepack@0.34.7 yarn scrape run --source department-undergrad-research --limit 10 --dry-run
```

Expected collections after an accepted materialized write:

- `observations`: department-backed research entity, access evidence, contact, and application-route fields.
- `research_entities`: lab or program-like research homes discovered from official department pages.
- `entry_pathways`, `access_signals`, and guarded `contact_routes` through access materialization.

Audit focus:

- Use this deterministic department-page lane before targeted LLM repair for action-evidence gaps.
- Treat department pages as evidence, not final claims that a lab is accepting students.
- Latest accepted dev/Beta write: run `6a14fb8c884e98ac9070d6b5` wrote 414 observations and materialized 27 research entities, 31 entry pathways, 42 access signals, and 30 contact routes with zero errors.
- Hold broader applies until the 67 materialization conflicts from that run are reviewed with `yarn --cwd server department-repair:conflict-review --run 6a14fb8c884e98ac9070d6b5`; 18 contact routes were guarded from public exposure as expected.
- Generic department guidance should remain exploratory access evidence, not a posted opening.
- Structured application pages can create official application routes, but the source must not create `PostedOpportunity` rows by itself.
- Direct contact details should stay behind the existing guarded contact-route policy.

Project impact:

- Adds official, deterministic undergraduate research routes before any broad LLM or worker automation.
- Current deterministic coverage includes Physics, Chemistry, MCDB, Economics, Psychology, Astronomy, Mathematics, Engineering, Cognitive Science, Ecology and Evolutionary Biology, and Yale College Science and Quantitative Reasoning Education.

### `undergrad-fellowships-recipients`

Commands:

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  npx -y corepack@0.34.7 yarn scrape run --source undergrad-fellowships-recipients --limit 50 --use-cache --auto-materialize
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

### `yale-college-fellowships-office`

Commands:

```bash
SCRAPER_ENV=development \
  npx -y corepack@0.34.7 yarn scrape run --source yale-college-fellowships-office --limit 10 --dry-run --use-cache
```

Expected collections in `new-foundation`:

- `observations`: fellowship title, summary/description, application link, deadline, source URL, source key, source name, source fingerprint, program classification, and visibility input fields.
- `fellowships`: program/source/student-visibility fields after approved backfill or materialization.

Audit focus:

- Stale Yale College financial-awards links for Mellon Mays must canonicalize to `https://college.yale.edu/life-at-yale/student-faculty-awards/mellon-mays-undergraduate-fellowship-program`.
- CommunityForce links should be retained as `applicationLink`/`links` values, not fetched.
- Generic fellowship-administration, advising, navigation, and alternative-funding pages should either be suppressed or kept in operator review rather than becoming student-ready program records.
- The source should emit program/funding evidence only; it must not create posted opportunities or student-facing research pathways from fellowship funding pages.
- Run `yarn --cwd server programs:backfill-classification` and `yarn --cwd server student-visibility:backfill` in dry-run mode before applying any DB updates.

Project impact:

- Gives the operator board and canonical `/programs` surface official fellowship URL/deadline evidence with explicit student visibility tiers.

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

Expected collections:

- `observations`
- `users`
- `research_entities`
- `grants`
- `papers`
- `paper_entity_links`

Audit focus:

- External IDs dedupe correctly.
- PI/faculty matching is conservative.
- Topics/funding/publication context enriches research entities without creating access claims.

Project impact:

- Improves research-area discovery, entity context, and credibility.
- Helps students understand what an entity studies before deciding on a pathway.

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
- Post-write smoke checks cover Research, Pathways, Opportunity detail, Programs/Fellowships visibility, admin auth, removed legacy routes, source health, and Meili counts.
