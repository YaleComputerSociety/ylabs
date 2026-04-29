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
yarn scrape run --source <name> --dry-run                # preview without writing observations
yarn scrape run --source <name> --use-cache              # cache external fetches (dev only)
yarn scrape run --source <name> --limit 25               # cap entities processed
yarn scrape run --source <name> --auto-materialize       # promote observations to entities after run
yarn scrape materialize --run <runId>                    # materialize a previous run separately
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
| 2 | Run all free scrapers locally against fresh local MongoDB; sanity-check the data | dev | 1–2 hrs |
| 3 | Spot-check 10 random ResearchGroup docs in Mongo: are slugs sensible? PI matches accurate? `acceptanceConfidence` populated? | dev | 30 min |
| 4 | Browse `/labs` locally; verify trust-gradient badges, filters, detail pages | dev | 15 min |
| 5 | Run `BackfillListingResearchGroups.ts` dry-run; verify every existing Listing gets a parent group | dev | 10 min |
| 6 | Open PR to `main` (or `beta`), merge, deploy via Render | dev | per existing flow |
| 7 | On Beta: re-run free scrapers against Beta DB; watch for cron-readiness issues | dev | 2–4 hrs |
| 8 | Validate Beta UI with a few real students or test users | PM/dev | varies |

---

## Next steps (after Beta validation)

In priority order:

| 🥇 | **Admin disambiguation queue UI** at `/admin/scholar-conflicts` | The bootstrap scraper emits ambiguous matches as low-confidence Observations today; admins need a UI to review the top 3 candidates and pick one. Without this, the bootstrap's ambiguous-match output is just a log. | 2–3 days, 1 agent |
| 🥈 | **PI claim flow** — when a faculty CAS-logs in, prompt: "claim your lab page" | Single biggest data-quality win after scrapers. Architecture already supports `manuallyLockedFields`; needs a UX entry point. | 3–5 days, 2 agents |
| 🥉 | **Status reaper** — daily cron marks stale ResearchGroups/Listings/Users archived | Without it, the labs UI accumulates dead labs over time. | 1 day, 1 agent |
| 4 | **GitHub Actions cron config** — one workflow per scraper, on schedule | Currently scrapers are CLI-only. For prod we need automatic cadences. | 1 day, 1 PR |
| 5 | **`Listing.owner*` deprecation** | 34 files referencing the denormalized owner fields; finish the tech debt by computing on read from `User` via `researchGroupId → ResearchGroupMember`. | 2–3 days, 1 agent |
| 6 | **PaperLivenessScraper** | Derived scraper that updates `ResearchGroup.lastObservedAt` and `recentPaperCount` from existing Paper data. Improves status-reaper accuracy. | 1 day, 1 agent |
| 7 | **Admin field-lock UI** — checkbox on faculty profile edit: "lock this field from scrapers" | Generalizes the manuallyLockedFields workflow beyond `googleScholarId`. | 1 day, 1 agent |

### Deliberately deferred

- Semantic Scholar paper sync (OpenAlex 3-tier covers ~95% now; S2 adds TLDRs but isn't critical)
- Headless browser for JS-rendered dept pages (NSF Award Search closes that gap structurally)
- LinkedIn / Twitter academic profile scrapers (diminishing returns until validated)
- More Apify use cases (lab microsite scraping at scale) — current LLM extractor is sufficient
- Wu Tsai / Yale Cancer Center sub-program rosters (already covered at center level)

---

## Honest gaps to know about

- **Nothing has been run against real data yet.** Every scraper is unit-tested but not integration-tested. The first Beta run will surface bugs the unit tests miss.
- **Pre-existing client build failure** from commit `9636191` (`react-virtuoso` missing dep in `BrowseGrid.tsx`). Not caused by this branch but blocks deploy.
- **`UndergradFellowshipRecipientScraper` is scaffolding only.** Yale doesn't publish recipient lists as scrapable HTML; the architecture is ready for when admin pastes in data manually.
- **Yale Engineering / CS dept pages are JS-rendered.** The `DepartmentRosterScraper` has a stub for CS that throws "JS-rendered, needs headless browser." `NSF Award Search` is the structural workaround — it closes the engineering coverage gap without needing to scrape those pages.
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
