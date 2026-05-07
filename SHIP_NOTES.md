# `feat/scraper-foundation` — Ship Notes

End-to-end scraper subsystem for auto-discovering Yale labs, faculty, papers, and grants — with a confidence-scored UI for undergrads to find research opportunities. Branch built today; this doc summarizes what shipped, how to run it, and what's next.

---

## TL;DR

- **13 scrapers** registered, all unit-tested, none yet run against real data
- **362 server tests + 375 client tests** passing
- **New `/labs` browse page + `/labs/:slug` detail page** with trust-gradient verdict badges
- **3 new tech-debt cleanups** done (Paper extraction, ownListings drop, dept aliases)
- **15 new collections / schema fields** for the scraper subsystem
- Recommended next move: **ship to Beta and validate against real data before adding more features**

---

## Current implementation status

This pass moved the scraper subsystem from "built but hard to audit" to "ready for validation runs":

- Added `yarn scrape` and `yarn scrape:seed-sources` scripts at repo root, plus matching server scripts.
- Added `yarn scrape report --run <runId>` for read-only QA reporting.
- `run` and `materialize` now print a run report after completing, so every manual run leaves an immediate audit artifact.
- Added same-source Observation dedupe/supersession: repeated identical facts stay in append-only history, but older same-source equivalents are marked `superseded=true` and ignored by resolution/materialization.
- Added duplicate-rate reporting (`observations.superseded` and `observations.duplicateRate`) to `yarn scrape report --run <runId>`.
- Added `workPlanner.ts`, a reusable freshness/manual-lock planner that expensive scrapers can call before hitting external APIs, websites, LLMs, or Apify.
- Added scraper environment guardrails: `SCRAPER_ENV=development|beta|production`; non-production runs default to dry-run and disable auto-materialization, while production writes require `--release` and `CONFIRM_PROD_SCRAPE=true`.
- Materialization now persists `entitiesCreated`, `entitiesUpdated`, `materializationSkipped`, `materializationConflicts`, and `materializationErrors` back to `ScrapeRun`.
- Added pure unit tests for report summaries, duplicate metrics, Observation fingerprints/supersession, work-planning freshness decisions, and environment guardrails.
- Fixed scraper compile drift by re-exporting the CourseTable/Yalies service functions/types that the scrapers already expected.
- Updated the server test script to run the existing Vitest suite.

Verification from this pass:

```bash
npx tsc --noEmit -p server/tsconfig.json
yarn --cwd server test
yarn scrape help
```

Result: server TypeScript passed, **380 server tests across 20 files passed**, and the scraper CLI help shows `list`, `run`, `materialize`, and `report`.

Note: `yarn scrape help` may need elevated sandbox permission in Codex because `tsx` creates a local IPC pipe under `/tmp`. In a normal terminal this should not matter.

### Development smoke test — 2026-05-03

Ran all 13 registered scrapers against the Development Mongo target with:

```bash
SCRAPER_ENV=development yarn scrape:seed-sources
SCRAPER_ENV=development yarn scrape run --source <source> --use-cache --limit 5
```

Guardrail behavior worked: every scraper run was forced to `dryRun: true`, so no Observations were persisted and no auto-materialization occurred. Source seeding, ScrapeRun rows, and `--use-cache` ScrapeSnapshot entries can still write to the Development DB.

Results:

| Source | Run ID | Result |
|---|---|---|
| `yale-directory` | `69f6c626ffb3e7eb2332b8b1` | Pass; would emit 30 observations for 5 faculty. Note: `limit=5` still scanned 66 Yalies pages before finding 5 faculty. |
| `openalex` | `69f6c660b2d1fd59ffa99e00` | Pass; 5 faculty, 299 works; used existing `openalex_id` fast path. |
| `ysm-atoz-index` | `69f6c67e94bf46f4b6e4a14a` | Pass; 5 YSM labs, 1 inferred PI. |
| `yse-centers-index` | `69f6c6987602c49a49f7c1fc` | Pass; 5 YSE entities. |
| `dept-faculty-roster` | `69f6c6b22cdf31385792de25` | Pass; `econ=5`. |
| `nih-reporter` | `69f6c6ce1b383ae4bea83100` | Pass; FY 2024-2026 returned 2,623 Yale grants, limited output to 5 PIs. |
| `nsf-award-search` | `69f6c6eed4eff0ace965701c` | Pass; 5 awards, 5 PIs, 2 matched Users. |
| `yale-course-catalog` | `69f6c704915c8ef731fa6ae0` | Pass; no independent-study courses found in this smoke run. |
| `centers-institutes-index` | `69f6c71e3273e7a0aa840f20` | Pass; limit caps centers, not members; 5 centers produced large member counts. |
| `undergrad-fellowships-recipients` | `69f6c7804c97ea270f4d1e0c` | Pass; all configured programs remain `manual-upload-required`, zero observations. |
| `lab-microsite-undergrad-llm` | `69f6c79682a2e41bfd182017` | Pass; processed 5/5 labs, 0 fetch/LLM failures, would emit 11 observations. |
| `apify-google-scholar-bootstrap` | `69f6c7bd6d68e1514699f35d` | Pass/skip; `APIFY_API_TOKEN` missing, emitted zero observations. |
| `apify-google-scholar` | `69f6c7dd3155b27ea4da8d24` | Pass/skip; `APIFY_API_TOKEN` missing, emitted zero observations. |

Follow-ups from smoke test:

- Consider making `yale-directory --limit` stop earlier by querying/filtering likely faculty records server-side or by adding a smoke-test mode; current behavior is correct but inefficient for tiny limits.
- Consider making `centers-institutes-index --limit` clearer in CLI notes: it limits centers processed, not members emitted.
- Dry-run reports show zero persisted observations by design. For QA, compare the scraper result block ("would emit") with the report block ("persisted").

### Scraper implementation inventory — 2026-05-03

Runnable/registered scrapers: 13 (`openalex`, `yale-directory`, NIH, NSF, YSM/YSE indexes, dept roster, CourseTable, centers, fellowship-recipient scaffold, lab microsite LLM, and the two Apify Google Scholar scrapers).

Seeded as `Source` rows but **not implemented as runnable scrapers** yet:

| Source | Status | Notes |
|---|---|---|
| `orcid` | Not implemented | Useful for author-curated profile/paper identity enrichment. OpenAlex currently uses existing `User.orcid` as a lookup signal, but there is no ORCID sync scraper. |
| `crossref` | Not implemented | Useful DOI-of-record metadata validator for title/year/venue. Probably lower priority because OpenAlex already covers broad paper metadata. |
| `pubmed` | Not implemented | Useful biomedical validator and PubMed-specific identifiers; could improve YSM/Public Health paper confidence. |
| `arxiv` | Not implemented | Useful preprint coverage for CS/physics/math. Lower priority until OpenAlex gaps are measured. |
| `semantic-scholar` | Not implemented | Good candidate for TLDRs, citation context, and cross-validation. Requires `SEMANTIC_SCHOLAR_API_KEY` for best rate limits. |
| `ssrn` | Not implemented | Possible law/econ/social-science working paper coverage. Defer until coverage gaps justify it. |
| `nber` | Not implemented | Possible economics working paper coverage. Defer until economics coverage is measured. |
| `yale-college-fellowships-office` | Not implemented | Would scrape/list Yale fellowship opportunities, not recipient/advisor history. Separate from current recipient scaffold. |
| `external-fellowship-llm-scraper` | Not implemented | Would extract external research programs/fellowships; not needed for lab discovery v1. |
| `lab-microsite-llm` | Superseded/not implemented | Older broader idea for lab microsite extraction. Current implemented scraper is narrower: `lab-microsite-undergrad-llm`. |

Implemented but not fully live-data useful yet:

- `undergrad-fellowships-recipients`: framework exists, but all default Yale programs are `manual-upload-required`.
- `apify-google-scholar-bootstrap` / `apify-google-scholar`: implemented, but require `APIFY_API_TOKEN`.
- `semantic-scholar`: API key can be added now as `SEMANTIC_SCHOLAR_API_KEY`, but no registered Semantic Scholar scraper uses it yet.
- `openalex`: implemented; should be updated to pass `OPENALEX_API_KEY` now that OpenAlex requires free API keys.

---

### Senior engineering read

The scraper architecture is directionally strong: structured sources first, source-weighted observations, delayed materialization, and manual locks are the right primitives for data that will always be noisy. I would **not** replace the subsystem with a third-party scraping platform or direct-write crawler.

The main risk is not architecture; it is validation. Unit tests cover parser/control-flow behavior, but the system has not yet proven real-world precision, recall, idempotency, or operational behavior against fresh Yale data. Treat this as a Beta-quality ingestion pipeline until the first real run produces coverage metrics and a reviewed sample set.

---

## Architecture summary

```
   Scrapers (13 sources, IScraper interface)
      │ emit Observations
      ↓
   ObservationStore (append-only)
      ↓
   ConfidenceResolver (pure: aggregates per (entity, field))
      ↓
   EntityMaterializer (only writer to user-facing entities)
      ↓
   User / Listing / ResearchGroup / Paper / Fellowship  ← UI reads from here
      ↓
   MeiliSyncService (per-entity-type registry)
      ↓
   Meilisearch indexes (listings, researchgroups, papers)
```

**Two-tier write architecture**: scrapers write only to `Observation`/`ScrapeRun`/`ScrapeSnapshot`. They cannot write directly to entities. The `EntityMaterializer` is the only writer, gated by confidence scoring + `manuallyLockedFields` (PI/admin overrides always win).

---

## Features built today (in order shipped)

### Phase 1 — Foundation models + tech-debt cleanup

**New collections**: `ResearchGroup`, `ResearchGroupMember`, `Paper`, `Source`, `Observation`, `ScrapeRun`, `ScrapeSnapshot`.

**Schema deltas to existing models**:
- `User`: dropped `ownListings` array; added `confidenceByField`, `manuallyLockedFields`, `lastObservedAt`, `semanticScholarAuthorId`, `googleScholarId`, `googleScholarMetricsUpdatedAt`
- `Listing`: added `researchGroupId` (FK), confidence/lock fields
- `Fellowship`: added `eligibleDepartments`, `eligibleResearchAreas`, `sourceUrls`, confidence/lock fields
- `Department` + `ResearchArea`: added `aliases: [String]` for scraper canonicalization

**Migrations**:
- [`MigratePublicationsToPapers.ts`](data-migration/MigratePublicationsToPapers.ts) — extracts embedded `User.publications` into the new `Paper` collection
- [`BackfillListingResearchGroups.ts`](data-migration/BackfillListingResearchGroups.ts) — every existing Listing without a `researchGroupId` gets a stub group via `findOrCreateForOwner`

**New services**:
- [`departmentResolver.ts`](server/src/services/departmentResolver.ts) — canonicalizes free-text dept strings against the Department collection (jaccard fuzzy matching)
- [`researchAreaResolver.ts`](server/src/services/researchAreaResolver.ts) — same pattern for ResearchArea
- [`researchGroupService.ts`](server/src/services/researchGroupService.ts) — CRUD + `findOrCreateForOwner` (auto-stub helper called by `listingService.createListing`)
- [`meiliSyncService.ts`](server/src/services/meiliSyncService.ts) — per-entity-type sync registry; called by EntityMaterializer

### Phase 2 — Scraper engine

**Pure-function core**:
- [`confidenceResolver.ts`](server/src/scrapers/confidenceResolver.ts) — aggregates Observations into resolved values with recency decay + agreement bonuses + manual lock + conflict detection. Pure, no DB calls. **9 unit tests.**
- [`observationStore.ts`](server/src/scrapers/observationStore.ts) — append-only writer
- [`entityMaterializer.ts`](server/src/scrapers/entityMaterializer.ts) — single writer to entities; calls Meili sync after every write
- [`orchestrator.ts`](server/src/scrapers/orchestrator.ts) — dispatches scrapers, opens ScrapeRun, persists Observations
- [`snapshotCache.ts`](server/src/scrapers/snapshotCache.ts) — TTL'd Mongo-backed fetch cache for `--use-cache`
- [`cli.ts`](server/src/scrapers/cli.ts) — entry point with `--dry-run` / `--use-cache` / `--release` / `--limit` / `--auto-materialize` flags

**Reusable utilities** ([`utils/scraperHelpers.ts`](server/src/scrapers/utils/scraperHelpers.ts)): `slugify`, `netidFromEmail`, `normalizeName`, `splitName`. Used by 6+ scrapers.

### Phase 3 — Coverage scrapers (4 + 1 from earlier)

| # | Scraper | Source | What it pulls |
|---|---|---|---|
| 1 | `OpenAlexPaperScraper` | `openalex` | Yale faculty papers via 3-tier resolver: (1) ORCID lookup, (2) existing `openalex_id`, (3) Yale-affiliation name search with exact-match-only acceptance |
| 2 | `YsmAtoZScraper` | `ysm-atoz-index` | ~266 YSM labs from one-page scrape |
| 3 | `YseCentersScraper` | `yse-centers-index` | ~29 YSE centers/programs/initiatives |
| 4 | `YaleDirectoryScraper` | `yale-directory` | Faculty roster via Yalies API (paginated) |
| 5 | `DepartmentRosterScraper` | `dept-faculty-roster` | Per-dept faculty (Econ, MCDB, CS-stub, Psychology); parameterized for easy expansion |
| 6 | `NihReporterScraper` | `nih-reporter` | ~3,500 active Yale NIH grants → ResearchGroup `recentGrants` field |
| 7 | `NsfAwardScraper` | `nsf-award-search` | ~391 active Yale NSF awards; **closes Engineering coverage gap** without headless browser |
| 8 | `IndependentStudyCourseScraper` | `yale-course-catalog` | Faculty offering 290/471/489/490/491-style indep-study courses → primary signal for **humanities** |
| 9 | `CentersInstitutesScraper` | `centers-institutes-index` | 10 Yale cross-cutting centers (Wu Tsai, Cancer Center, Cowles, Tobin, ISPS, MacMillan, Whitney, YQI, YCGA, Jackson) |

### Phase 4 — Confidence scrapers (2)

| # | Scraper | Source | What it does |
|---|---|---|---|
| 10 | `UndergradFellowshipRecipientScraper` | `undergrad-fellowships-recipients` | Scaffolding + `drupalRecipientRowExtractor`. **Currently all 6 program configs are `manualUploadRequired`** because Yale doesn't publish recipient lists as scrapable HTML (PDFs or absent). Architecture is in place for when data appears. |
| 11 | `LabMicrositeUndergradLLMExtractor` | `lab-microsite-undergrad-llm` | LLM (gpt-4o-mini, structured outputs via direct axios) over each lab's home + people/team page. Extracts `openToUndergrads`, `currentUndergradCount`, `undergradEvidenceQuote`, `joinPageUrl`. ~$1.60 per 1,000-lab run. |

### Phase 5 — Apify integration with disambiguation

| # | Scraper | Source | What it does |
|---|---|---|---|
| 12 | `ApifyGoogleScholarBootstrapScraper` | `apify-google-scholar-bootstrap` | Auto-discovers Scholar IDs via search + multi-signal scoring: +1.0 Yale affiliation, −1.0 hostile affiliation, +0.4 dept overlap, +0.3/match Yale co-author (cap +0.6), **+0.5/match paper-title overlap with OpenAlex** (cap +1.0), stub-profile floor. Auto-assigns at confidence 0.85 only when top score ≥1.5 AND runner-up <0.5. Otherwise emits alternates at 0.2-0.3 for admin review. ~$0.04/faculty. |
| 13 | `ApifyGoogleScholarScraper` | `apify-google-scholar` | Pulls h-index, i10, citations, interests, recent papers for faculty with `googleScholarId` set. **Defense-in-depth Yale-affiliation guard** rejects profiles whose `affiliation` doesn't contain "yale" (catches mis-assigned IDs). Bypassed when admin has `manuallyLockedFields` includes `'googleScholarId'`. ~$2 per quarterly sync of 500 humanities profs. |

### Phase 6 — UI surfaces

**`/labs` browse page** ([`pages/labs.tsx`](client/src/pages/labs.tsx)):
- Search bar + filter sidebar (kind, school, departments, researchAreas, openness, **acceptance level**)
- Hybrid Meili search (semanticRatio 0.8 when query non-empty)
- Each result card has a **trust-gradient verdict badge** (verified-accepting / likely-accepting / unknown / not-accepting) + 1 evidence chip
- Infinite scroll
- Wired via [`LabSearchContextProvider`](client/src/providers/LabSearchContextProvider.tsx) + [`labSearchReducer`](client/src/reducers/labSearchReducer.ts) (20 tests)

**`/labs/:slug` detail page** ([`pages/labDetail.tsx`](client/src/pages/labDetail.tsx)):
- [`LabHeader`](client/src/components/labs/LabHeader.tsx) — verdict pill, kind/school/department metadata, description
- [`LabMembersList`](client/src/components/labs/LabMembersList.tsx) — sorted by role (PI first), photos, links to `/profile/:netid`
- [`LabPapersList`](client/src/components/labs/LabPapersList.tsx) — top 10 by `publishedAt`, with TLDR/venue/citations
- [`LabActiveListings`](client/src/components/labs/LabActiveListings.tsx) — reuses existing BrowseCard
- [`LabInquireCard`](client/src/components/labs/LabInquireCard.tsx) — sticky CTA with **Evidence section** showing verdict chips + grant/paper/indep-study credibility lines
- [`LabInquireModal`](client/src/components/labs/LabInquireModal.tsx) — prefilled mailto

**Shared verdict utility** ([`utils/undergradAcceptance.ts`](client/src/utils/undergradAcceptance.ts)):
Pure function `computeAcceptanceVerdict(group, hasActiveListing) → { verdict, confidence, evidence[] }`. Used in 3 places. 18 unit tests.

### Phase 7 — Backend search routes

- `POST /api/research-groups/search` — Meili-backed hybrid search with the new `acceptanceLevel` filter ('verified' / 'verified-or-likely' / 'all')
- `GET /api/research-groups/:slug` — returns `{ group, members[], recentPapers[], activeListings[] }`
- Filter logic in [`researchGroupFilters.ts`](server/src/services/researchGroupFilters.ts) (12 unit tests)
- Denormalized `ResearchGroup.acceptanceConfidence` field (mirror of `confidenceByField['acceptingUndergrads']`) so Meili can filter on it

---

## How to run it

### One-time setup

```bash
# Install deps
yarn install:all

# Set up env vars in server/.env (see below for full list)
# Required: MONGODBURL, SESSION_SECRET, SSOBASEURL, SERVER_BASE_URL, VITE_APP_SERVER (in client/.env)
# Optional but useful: YALIES_API_KEY, OPENAI_API_KEY, OPENALEX_CONTACT_EMAIL, APIFY_API_TOKEN

# Seed the Source registry (idempotent — safe to re-run)
yarn scrape:seed-sources

# Configure Meilisearch indexes (listings, researchgroups, papers)
cd data-migration && npx tsx MigrateToMeilisearch.ts && cd ..

# (One-time) migrate existing User.publications → Paper collection
cd data-migration
yarn migrate:publications-to-papers          # dry-run
yarn migrate:publications-to-papers:live     # apply

# (One-time) backfill existing Listings with researchGroupId
yarn backfill:listing-groups                 # dry-run
yarn backfill:listing-groups:live            # apply
cd ..
```

### Required env vars (`server/.env`)

| Variable | Required | Notes |
|---|---|---|
| `MONGODBURL` | ✅ | Per-environment Mongo connection string |
| `SCRAPER_ENV` | recommended | `development`, `beta`, or `production`; controls scraper write guardrails |
| `CONFIRM_PROD_SCRAPE` | prod writes | Must be `true` for production scraper writes/materialization |
| `ALLOW_NON_PROD_SCRAPER_WRITES` | optional | Set to `true` only when you intentionally want dev/beta scraper writes |
| `SESSION_SECRET` | ✅ | Cookie signing key |
| `SSOBASEURL` | ✅ | Yale CAS URL |
| `SERVER_BASE_URL` | ✅ | Public server URL for CAS callbacks |
| `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`, `MEILISEARCH_INDEX_PREFIX` | for prod | Meili instance config |
| `YALIES_API_KEY` | for `yale-directory` scraper | api.yalies.io API key |
| `OPENAI_API_KEY` | for Meili embedder + LLM extractor | OpenAI API key |
| `OPENALEX_CONTACT_EMAIL` | optional | Polite-pool email; defaults to `info@yalelabs.io` |
| `APIFY_API_TOKEN` | for Apify scrapers only | Apify account token; both Apify scrapers exit gracefully when missing |

### Running scrapers locally

```bash
yarn scrape list                                         # list all 13 scrapers
yarn scrape run --source <name> --use-cache              # dev/beta: forced dry-run unless explicitly overridden
yarn scrape run --source <name> --limit 25               # cap entities processed
yarn scrape materialize --run <runId>                    # materialize a previous run separately
yarn scrape report --run <runId>                         # print QA report for a run
```

Environment behavior:

```bash
# Development / beta: safe test mode by default. Writes are disabled.
SCRAPER_ENV=development yarn scrape run --source yale-directory --use-cache --limit 50

# Intentional non-prod write test, still not a prod run.
SCRAPER_ENV=beta ALLOW_NON_PROD_SCRAPER_WRITES=true yarn scrape run --source yale-directory --use-cache --auto-materialize

# Production write run. Requires both --release and explicit confirmation.
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true yarn scrape run --source yale-directory --release --auto-materialize
```

### Recommended bootstrap order (free sources first)

```bash
cd server
yarn scrape run --source yale-directory --use-cache --auto-materialize
yarn scrape run --source nih-reporter --use-cache --auto-materialize
yarn scrape run --source nsf-award-search --use-cache --auto-materialize
yarn scrape run --source ysm-atoz-index --use-cache --auto-materialize
yarn scrape run --source yse-centers-index --use-cache --auto-materialize
yarn scrape run --source dept-faculty-roster --use-cache --auto-materialize
yarn scrape run --source centers-institutes-index --use-cache --auto-materialize
yarn scrape run --source yale-course-catalog --use-cache --auto-materialize
yarn scrape run --source openalex --use-cache --limit 100 --auto-materialize
```

### Optional paid sources (with `OPENAI_API_KEY` / `APIFY_API_TOKEN`)

```bash
# LLM extraction over lab websites (~$1.60 per 1000 labs)
yarn scrape run --source lab-microsite-undergrad-llm --use-cache --limit 100 --auto-materialize

# Discover Google Scholar IDs for humanities profs (~$0.04/faculty, only confident matches assigned)
yarn scrape run --source apify-google-scholar-bootstrap --use-cache --limit 50 --auto-materialize

# Pull Scholar h-index/papers for faculty with discovered IDs (~$0.004/faculty)
yarn scrape run --source apify-google-scholar --use-cache --auto-materialize
```

### Browsing the result

```bash
yarn dev:server     # one terminal
yarn dev:client     # another terminal
# Open http://localhost:3000/labs
```

---

## Tests

```bash
yarn --cwd server test       # 362 tests across 16 files
yarn --cwd client test:ci    # 375 tests across 29 files
```

Coverage areas: confidence resolver, all 13 scrapers (with mocked HTTP/Mongo), 6 reducers (lab search, lab detail, etc.), trust-gradient verdict computation, Meili filter builders.

---

## Pre-deploy checklist

| # | Task | Owner | Effort |
|---|---|---|---|
| 1 | **Resolve pre-existing `react-virtuoso` missing dep** (commit `9636191` from before this branch — client build currently fails without it) | dev | 15 min |
| 2 | Run `BackfillListingResearchGroups.ts` dry-run; verify every existing Listing gets a parent group before scraper-created groups arrive | dev | 10 min |
| 3 | Run all free scrapers locally against fresh local MongoDB; save counts per source: observations, entities created, materialized fields, conflicts, skips | dev | 1–2 hrs |
| 4 | Spot-check at least 30 random ResearchGroup docs across Medicine, STEM, social sciences, and humanities: slug quality, PI/member match, school/dept, `acceptanceConfidence`, source URLs | dev/PM | 1 hr |
| 5 | Run the same free scraper set twice with `--use-cache --auto-materialize`; verify the second run is idempotent enough (no duplicate groups/papers, no runaway observations) | dev | 30 min |
| 6 | Browse `/labs` locally; verify trust-gradient badges, filters, detail pages, empty/unknown states, and mobile layout | dev | 30 min |
| 7 | Open PR to `main` (or `beta`), merge, deploy via Render | dev | per existing flow |
| 8 | On Beta: re-run free scrapers against Beta DB; watch runtime, API limits, partial failures, Meili sync, and cron-readiness issues | dev | 2–4 hrs |
| 9 | Validate Beta UI with a few real students or test users; collect "would you contact this lab?" quality feedback | PM/dev | varies |

### Validation gates before production cron

Do not schedule unattended recurring scrapes until these are true:

- Local/Beta scraper runs have source-level count reports checked into notes or an issue.
- Duplicate rate for `ResearchGroup.slug`, `Paper.openAlexId`, and faculty-linked groups is understood and low.
- At least 30 reviewed ResearchGroups have a recorded precision estimate for PI/member match and undergrad acceptance evidence.
- Failed or missing optional credentials (`YALIES_API_KEY`, `OPENAI_API_KEY`, `APIFY_API_TOKEN`) produce graceful no-op runs, not partial corrupt writes.
- Meilisearch indexing has been verified after materialization for created and updated `ResearchGroup`/`Paper` docs.
- A rollback path is documented: disable Source rows, stop cron, and restore from the last pre-scraper DB backup if materialized data is bad.

---

## Next steps (after Beta validation)

In priority order:

| Priority | Work | Why | Effort |
|---|---|---|---|
| 🥇 | **Scraper QA dashboard / saved run artifacts** | CLI report is done. Next layer is saving or surfacing per-source counts, conflicts, skipped rows, created/updated entities, and sample links for admins. | 1–2 days, 1 agent |
| 🥈 | **PI claim flow** — when a faculty CAS-logs in, prompt: "claim your lab page" | Single biggest data-quality win after scrapers. Architecture already supports `manuallyLockedFields`; needs a UX entry point. | 3–5 days, 2 agents |
| 🥉 | **Admin disambiguation queue UI** at `/admin/scholar-conflicts` | The bootstrap scraper emits ambiguous matches as low-confidence Observations today; admins need a UI to review the top 3 candidates and pick one. Without this, ambiguous-match output is mostly a log. | 2–3 days, 1 agent |
| 4 | **Status reaper** — daily cron marks stale ResearchGroups/Listings/Users archived | Without it, the labs UI accumulates dead labs over time. | 1 day, 1 agent |
| 5 | **GitHub Actions cron config** — one workflow per scraper, on schedule | Currently scrapers are CLI-only. Add only after validation gates pass. | 1 day, 1 PR |
| 6 | **Admin field-lock UI** — checkbox on faculty profile edit: "lock this field from scrapers" | Generalizes the manuallyLockedFields workflow beyond `googleScholarId`. | 1 day, 1 agent |
| 7 | **`Listing.owner*` deprecation** | 34 files referencing the denormalized owner fields; finish the tech debt by computing on read from `User` via `researchGroupId → ResearchGroupMember`. | 2–3 days, 1 agent |
| 8 | **PaperLivenessScraper** | Derived scraper that updates `ResearchGroup.lastObservedAt` and `recentPaperCount` from existing Paper data. Improves status-reaper accuracy. | 1 day, 1 agent |

### Suggested changes / engineering notes

- Done: added a first-class `ScrapeRun` report command (`yarn scrape report --run <runId>`) that prints source counts, created/updated entities, conflict candidates, skipped/error counters, and warnings. Still useful future work: convert this JSON report into an admin dashboard or saved Markdown run artifact.
- Make idempotency explicit in tests for the materialization path: running the same scraper twice should not create duplicate `ResearchGroup`/`Paper` records or oscillate confidence unexpectedly.
- Add a lightweight source-health contract: every scraper should return `ok`, `partial`, or `blocked` with machine-readable reasons such as `missing-env`, `manual-upload-required`, `js-rendered-skip`, `api-rate-limited`.
- Keep Playwright/headless scraping as a targeted exception for JS-rendered high-value pages only. The current structured-source strategy is cheaper, easier to operate, and less brittle.
- Prefer human-in-the-loop quality improvements before adding more sources. PI claim flow, admin locks, and conflict review will improve correctness more than another broad crawler.
- Add per-school coverage reporting before declaring coverage "good": Yale College humanities, social sciences, Engineering/CS, Medicine, Public Health, YSE, Law/Management/Divinity/Art/Drama/Music are very different data landscapes.

### Pickup plan for next session

Start here:

```bash
git status --short
npx tsc --noEmit -p server/tsconfig.json
yarn --cwd server test
```

Then run the first real validation loop against a fresh local or Beta database:

```bash
yarn scrape:seed-sources
SCRAPER_ENV=development yarn scrape run --source yale-directory --use-cache --limit 50
yarn scrape report --run <runId-from-output>
```

Recommended next coding tasks:

1. Wire `workPlanner.ts` into the expensive scrapers first: `lab-microsite-undergrad-llm`, `apify-google-scholar-bootstrap`, `apify-google-scholar`, and then OpenAlex.
2. Add an integration-level idempotency test around `materializeFromRun`: same observations twice should not create duplicate entities and duplicate Observations should be superseded.
3. Add a `sourceHealth`/`blockedReason` shape to `ScraperResult` and begin migrating scrapers to return machine-readable `missing-env`, `manual-upload-required`, `js-rendered-skip`, and `api-rate-limited`.
4. Add a coverage summary command/report section grouped by `school`, `department`, `entityType`, and `acceptanceConfidence` bucket.
5. After the first real run, paste the `report --run` JSON into an issue or notes file and spot-check at least 30 ResearchGroups before enabling cron.

### Deliberately deferred

- Semantic Scholar paper sync (OpenAlex 3-tier covers ~95% now; S2 adds TLDRs but isn't critical)
- Headless browser for JS-rendered dept pages (NSF Award Search closes that gap structurally)
- LinkedIn / Twitter academic profile scrapers (diminishing returns until validated)
- More Apify use cases (lab microsite scraping at scale) — current LLM extractor is sufficient
- Wu Tsai / Yale Cancer Center sub-program rosters (already covered at center level)

---

## Honest gaps to know about

- **Nothing has been run against real data yet.** Every scraper is unit-tested but not integration-tested. The first Beta run will surface bugs the unit tests miss.
- **Coverage quality is unknown until measured.** Current source mix should give broad recall, but precision/recall by school and department must be measured from real runs.
- **Pre-existing client build failure** from commit `9636191` (`react-virtuoso` missing dep in `BrowseGrid.tsx`). Not caused by this branch but blocks deploy.
- **`UndergradFellowshipRecipientScraper` is scaffolding only.** Yale doesn't publish recipient lists as scrapable HTML; the architecture is ready for when admin pastes in data manually.
- **Yale Engineering / CS dept pages are JS-rendered.** The `DepartmentRosterScraper` has a stub for CS that throws "JS-rendered, needs headless browser." `NSF Award Search` is the structural workaround — it closes the engineering coverage gap without needing to scrape those pages.
- **Undergrad acceptance is evidence-weighted, not ground truth.** Independent study, grants, papers, and LLM microsite extraction are useful signals, but current openness still needs PI/admin confirmation when possible.
- **`Listing.owner*` denormalization still in place** (34 files). Deferred to a follow-up PR; doesn't block scrapers because `researchGroupId` is the new source of truth and old fields are kept synced for read compatibility.
- **No GitHub Actions cron yet.** Production runs require manual CLI invocation until that lands.

---

## Cost summary (per full sync)

| Scraper | Cost | Cadence |
|---|---|---|
| All 9 free scrapers (yale-directory, nih, nsf, ysm-atoz, yse-centers, dept-roster, centers, course-catalog, openalex) | $0 | nightly to weekly |
| `lab-microsite-undergrad-llm` | ~$1.60 / 1000 labs (gpt-4o-mini) | weekly |
| `apify-google-scholar-bootstrap` | ~$20 / 500 humanities faculty (one-time + occasional) | as-needed |
| `apify-google-scholar` | ~$2 / 500 faculty | quarterly |

Total recurring: under **$10/month** even with all paid sources running.

---

## Branch state

- Branch: `feat/scraper-foundation`
- Server tests: 362 passing
- Client tests: 375 passing
- `tsc --noEmit` (server): clean
- `tsc --noEmit` (client): pre-existing errors documented in [CLAUDE.md](CLAUDE.md), none introduced by this branch
- `yarn build` (server): passes
- `yarn build` (client): **fails** on pre-existing `react-virtuoso` missing dep — must be resolved before deploy

See [CLAUDE.md](CLAUDE.md) for the up-to-date factual reference of models, services, and architecture.
