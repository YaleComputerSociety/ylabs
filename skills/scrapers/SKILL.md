---
name: scrapers
description: Use when working on the scraper system in server/src/scrapers/ - adding or modifying source scrapers, observations, materializers, confidence resolution, or running the scrape CLI. Covers the evidence-first pipeline, safety/write guards, the infrastructure files, and the active source-scraper catalog.
---

# Scrapers

The scraper system lives in `server/src/scrapers/`. Run via `yarn --cwd server scrape <command>` (uses `server/src/scrapers/cli.ts`). See `docs/scraper-audit-guide.md` and `docs/scraper-deployment-runbook.md` for audit and deployment details.

## Core rule: evidence-first

Scrapers emit append-only `Observation` rows; materializers derive first-class access records. **Never hard-assert product conclusions directly from scraper output.** Preserve raw observations/source records, then materialize derived fields through resolver/materializer logic. Avoid binary fields like `acceptingUndergrads` - produce source evidence and access `Signal` rows (the former `AccessSignal` model is folded into `Signal`) with evidence strength instead.

## Safety rules (write guards)

- Non-production environments default to dry-run. Set `ALLOW_NON_PROD_SCRAPER_WRITES=true` to write to a dev DB.
- Production requires `SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true`.
- `scraperEnvironment.ts` enforces `SCRAPER_ENV` write guards.
- Observation retention must preserve every Observation referenced by durable materialized records, including archived rollback records. Run it dry-run-first with an explicit environment, keep scrapers and materializers paused, and leave Production retention disabled unless a separate reviewed issue authorizes it.
- Repair existing orphaned Observation references only with `observations:repair-orphaned-references`. The command is Development-only, writes private mode-0600 artifacts, requires a fresh target-bound classifier plus reviewed decisions, rechecks every owner and replacement before applying, and never manufactures evidence or silently clears provenance. Deterministic source-equivalent relinks and current-materializer rebuilds are preferred. Preserve archived records by recording evidence loss, and archive ambiguous active canonical artifacts only after an explicit reviewed decision.
- Do not expose scraped contact data indiscriminately. Contact is fail-closed and derived at read time from official links: prefer official/public URLs; never surface scraped emails in public payloads.
- Any outbound fetch to a host derived from user input or stored data MUST go through `utils/ssrfGuard.ts`.

## Infrastructure files

- `cli.ts` - CLI entrypoint (`scrape run`, `scrape materialize`, `scrape report`, etc.)
- `orchestrator.ts` - `ScraperOrchestrator` runs one named source per `run(name)` call: it resolves the source, opens a `ScrapeRun`, runs the scraper, and persists `Observation` rows as they are emitted. It is single-source by design (materialization is a separate step); the sweep runs many sources by spawning one subprocess each, not through an in-process loop here.
- `registry.ts` - registers all source scrapers
- `scripts/runScraperSweep.ts` - the phased end-to-end sweep (`scrape:sweep --mode=<mode>`). It spawns one fault-isolated `scrape run --source <name>` subprocess per registered source, grouped into ordered phases (`identity`, `discovery`, `funding`, `relationships`, `content-access`; the `scholarly` phase is a reserved value in the type union with no active source) with bounded per-phase concurrency (the LLM phases capped at 2), then runs the exhaustive-Development post-run stage chain. That chain is a single declarative registry, `DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS`: each stage owns its command, args builder, enable predicate, and optional typed result contract, and both the plan builder and the runner derive from it. A stage that declares a result contract but exits successfully without a readable, valid result artifact fails loud rather than silently dropping its delta (#2050). The optional `researcher-dedupe`, `eponymous-fra-merge`, `url-identity-dedupe`, and merge-residue-deletion stages are each gated by a distinct `SCRAPER_SWEEP_*` env flag.
- `observationStore.ts` - writes `Observation` rows. Supersession keys on `observationFingerprint`: a new observation supersedes prior non-superseded ones with the same fingerprint. Fingerprint = `(sourceName, entityType, entity, field)` and, for most fields, `value`. Fields in the authoritative `LATEST_WINS_FINGERPRINT_FIELDS` constant omit `value`, so a fresh snapshot supersedes the prior one despite content drift. Fellowship observations also omit `value` because the sole fellowship producer emits one source-owned snapshot row per (entity, field) per run. Only use latest-wins semantics when no source emits multiple rows per (entity, field) per run. Latest-wins for the guarded prose fields (`fullDescription`, `shortDescription`) has one exception: `isRegressiveProseRefresh` drops an incoming prose observation that is not useful (per `researchEntityDescriptionQuality`) when an existing active same-(source, entity, field) observation is useful, so a re-run that degrades to a flagged/unusable description can never supersede a previously clean, source-backed one (#2028). Clean-to-clean refreshes are unaffected.
- `observationFieldSanitizer.ts` - shared ingest-time extraction sanitizer applied by `observationStore.appendObservations` to every observation from every source, so no scraper (present or future) can leak page furniture into a stored field (#1375).
  It composes the existing hygiene utilities rather than restating their rules:
  - a `user` `title` runs through `sanitizePersonTitle` (rejected when it is nav/section furniture);
  - a research-entity `name`/`displayName` is normalized and rejected when it is nav chrome, a section label, a glued contact or street-address fragment, or literal HTML;
  - research-entity `researchAreas`/`topics`/`researchInterests` lists drop label/section leakage element-wise (rejected when nothing survives);
  - `fullDescription`/`shortDescription` are chrome-stripped and contact-redacted (rejected when only chrome remains);
  - the undergrad/contact evidence-quote fields are contact-redacted.
  Type-overloaded fields are scoped by `entityType` (a fellowship/paper `title` is a proper name, not a role, so the person-title cap never fires on it), and structured identifier fields (URLs, ids, enums, and the `email` kept for internal contact derivation) pass through untouched.
  This is the ingest half of the ingest/serve/coverage data-integrity triad (#1374 owns serve-time, #1376 owns coverage); the person/entity identity resolver half is already hardened in `personProfileEntityMatch.ts`/`piNameMatch.ts` (#562/#981/#1045/#1110).
- `entityMaterializer.ts` - derives `ResearchEntity`/`RoleAssignment` (the canonical roster; replaces the retired `ResearchGroupMember`).
  - `materializeInferredPiMembership` (labs, from grant-inferred PI keys) and `materializeInferredDirectorMembership` (organizational homes, from `center-director-llm`'s entity-level inferred-director observation) attach the entity **lead**.
  Each resolves the name to a canonical `Researcher` via `resolveResearcherIdForPersonName` (`researcherPersonNameResolver.ts`), and upserts a `PI`/`DIRECTOR` `RoleAssignment`.
  Promoting a director also lets the access materializer upgrade an organizational home from its "no named director" `DEPARTMENT_CONTACT` fallback to a named-lead `FACULTY_PI` ways-in on the same pass.
  - Official roster rows use stable profile identity and membership keys.
  Only a complete non-empty snapshot archives disappeared source-owned rows; failed, empty, partial, stale, or withheld snapshots preserve current history.
  - After field resolution and canonicalization it derives `websiteUrl`, reusing `resolveBackfillWebsiteUrl` from `scripts/backfillResearchEntityWebsiteUrlsCore.ts` (the #404 backfill core) so every exclusion rule and the never-overwrite-a-usable-value rule stay single-sourced.
  A source-observed `websiteUrl` always wins.
  - The URL-exclusion rules are enforced by exported predicates rather than a frozen list here; consult those functions for the authoritative patterns.
  Listing/index and faculty-directory roster roots are rejected by `isListingOrIndexUrl` (whose directory-loader arm is `isDirectoryLoaderUrl` and whose faceted/section-index arm is `isFacetedOrSectionIndexUrl`), while a genuine single-person profile or named directory slug is kept as a PI fallback (#549/#556/#560/#569).
  Generic CMS/platform boilerplate hosts are rejected by `isBoilerplatePlatformHostUrl`, the sibling arm of `isDisallowedResearchEntitySourceUrl` (#572).
  File-share and direct-document links (Drive/Docs, Dropbox, Box, OneDrive, bare office/PDF paths) are rejected by `isFileShareOrDocumentUrl`, which also short-circuits `sourceUrlToResearchHomeWebsiteUrl` and the `isPromotableWebsiteUrl` path so a dead share or stray `.pdf` can never become the "Visit lab website" CTA (#730).
  An existing `websiteUrl` that is a listing page or a file link is re-picked to a genuine research home when evidence has one, and otherwise cleared (fail closed to no website, #510/#518/#730).
- `canonicalResearchHomeResolver.ts` - lets NIH, NSF, and DOE grant sources enrich one existing official research home for an unambiguous PI. It permits a synthetic shell only when no research-home membership exists, and fails closed for ambiguous identities plus archived, non-current, or grant-only candidates.
- `orgUnitCanonicalization.ts` - ingest-time department/school canonicalization.
  `entityMaterializer` calls `applyResearchEntityOrgUnitCanonicalization` to rewrite a research entity's `school` and `departments[]` to canonical `OrgUnit` names using a deterministic normalized-name/alias match (`orgUnitMatchKey` reuses `slugify` and collapses "Department of X"/"X Department" qualifiers).
  It **fails closed**: an unresolved value is kept as its raw string, never guessed, so the browse facet stops fragmenting without inventing a department.
  - Two student-facing-quality passes run first: `isDroppedAdministrativeOrgUnit` removes reviewed administrative/non-research units (the `ADMINISTRATIVE_ORG_UNIT_VALUES` denylist: Provost/FAS-admin/`NONE`/all-caps division buckets), and `denoiseOrgUnitValue` strips an opaque leading Yale HR org code (e.g. `MEDCCC Medical Oncology`) from an otherwise-unresolved value so it displays clean.
  - A School/Department boundary guard then drops any `departments[]` entry that resolves against the `SCHOOL_KINDS` index `canonicalizeSchool` uses (e.g. `Yale School of Medicine`/`YSM` leaking into `departments[]`) so a school name can never become a selectable department facet value; it reuses the existing resolver/index and is distinct from the admin-code drop (#837).
  - The canonical `OrgUnit` set is seeded (dry-run-first, `--confirm-seed-apply`) by `data-migration/seedOrgUnits.ts` from `orgUnitGroundTruth.ts` (Yale schools + the reused department ground truth, plus an `orgUnitAliasOverlay` mapping HR-coded/all-caps variants onto canonical units); the seed's unresolved audit is the review queue that grows aliases.
  - `research-homes:backfill-org-units` (dry-run-first, `--confirm-org-units`) re-applies canonicalization + admin-drop across the corpus; rebuild the Meilisearch index afterward so the `school`/`departments` facets pick up canonical values. Seed/apply on real data is human-gated.
  - Facet display is finished client-side by `client/src/utils/departmentNames.ts`, whose abbreviation-prefix stripper only fires on a spaced `ABBR - Name` separator so plain hyphenated names (`RADIATION-DIAGNOSTIC/ONCOLOGY`) are never truncated.
- `researchAreaCanonicalization.ts` - ingest-time research-area canonicalization.
  `entityMaterializer` calls `applyResearchEntityResearchAreaCanonicalization` to rewrite `researchAreas[]` to canonical `TaxonomyTerm` (`taxonomy_terms`) names using a deterministic normalized-name/alias match (`researchAreaMatchKey` reuses `slugify`).
  Only approved terms canonicalize: the resolver reads active, non-archived `TOPIC`/`METHOD` terms with `reviewStatus: APPROVED`, so seeded-but-unratified groupings stay `UNREVIEWED` and inert until a human approves them (issue #208 option A - the registry never becomes a `ResearchEntity` reference; areas stay canonical strings).
  It **fails closed**: an unresolved value is kept as its raw string, never guessed, so a guess can never collapse two distinct topics.
  - A scraper-label stop-list (`isResearchAreaLabelLeakage`) drops non-topic extraction artifacts (section headers, role/status labels, publication chrome) so they never become an area or pollute the review queue.
  Its `isNonTopicResearchAreaChip` arm additionally rejects only unambiguous non-topics that can leak public PII or prose (protocol/HIC/IRB ids, publication URLs, list markers, person-award lines, leading-lowercase prose, sentence fragments, first-person bio prose, lab-blurb sentences, and run-on multi-topic concatenations >= 15 words) while preserving legitimate multi-word topics below that ceiling so no real area is dropped (#624/#948).
  A companion repair in `stripResearchAreaSourceChrome` strips a stray leading coordinating conjunction (`and Optical Physics` -> `Optical Physics`) so a split fragment is fixed rather than dropped (#948).
  - The registry is seeded (dry-run-first, `--confirm-seed-apply`) by `data-migration/seedTaxonomyTerms.ts` (`seed:taxonomy-terms`) from the `seedResearchAreas.ts` ground truth; approved rows canonicalize immediately and candidate rows land `UNREVIEWED`.
  - `research-homes:backfill-research-areas` (dry-run-first, `--confirm-research-areas`) applies it to the corpus and, for entities with no areas, derives new ones deterministically from canonical department names, department-text phrase scans, and description phrases.
  Specific single-word technical terms (`Immunology`, `Genomics`) are recoverable from prose, but generic single-word names listed in `AMBIGUOUS_SINGLE_WORD_AREAS` (`art`, `law`, `history`, finance idioms) are only recovered from existing-area or department strings via the exact index.
  - Each applied backfill batch re-syncs its changed entities to Meilisearch via `syncEntities` (write-then-sync), so the area facet never drifts from Mongo and no separate reindex is needed (#1002).
- `utils/personNameCasing.ts` - ingest-time person-name casing canonicalization via `canonicalPersonName`, wired into the two person-name write choke points: the `Researcher.displayName` create/lookup in `canonicalMembershipMaterializer.ts` and the raw `fname`/`lname` emit in `ysmAtoZScraper.ts` `nameHintFromProfileName`. It title-cases all-caps name tokens of length >= 3 but deliberately preserves 2-letter initials (`TJ`, `AZ`), roman-numeral generational suffixes (`III`, `VIII`), post-nominal credentials (`MD`, `PhD`, `MFA`/`DFA`), and military ranks (`LTC`, `RET`) so legitimate uppercase is never corrupted. Entity `displayName` is deliberately not blanket-normalized because a corpus audit found all all-caps entity display names are legitimate lab acronyms (`CAMS`, `PTSD`, `LUCID`). A Development-gated backfill (`research-entity:backfill-person-name-casing`, dry-run-first) heals existing raw-cased `researchers.displayName`; no Meilisearch rebuild is needed because entity search does not index person names and PI-card names resolve live from Mongo.
- `accessMaterializer.ts` - derives access `Signal`s from observations; contact action is derived at read time from official links, not stored. When the pipeline yields no source-backed (http-URL) ways-in, it falls back to an evidence-based `REACH_OUT_PLAUSIBLE` signal: a concrete faculty/lab home with an attached PI/director lead + official non-grant page, or an organizational home with an official page but no named director. Both skip duplicates, grant/ORCID-only sources, and programs, and require a supporting source observation.
- `workPlanner.ts` - per-entity field-level work planning
- `snapshotCache.ts` - caches fetched pages to avoid redundant HTTP requests
- `scraperEnvironment.ts` - enforces `SCRAPER_ENV` write guards
- `sourceCoverageRegistry.ts` - declares source priority, tier, and artifact types
- `cronRunner.ts` - cron-aware runner with distributed job locking (`ScrapeJobLock`)
- `confidenceResolver.ts` - pure-function aggregator that picks a winning observation value and computes a confidence score (no DB calls, fully testable)
- `observationRetention.ts` - TTL/cleanup for old observation rows
- `renderedFetch.ts` - headless-browser fetch helper for JS-rendered pages
- `utils/httpFetch.ts` - shared SSRF-guarded page fetch (`fetchPageWithPolicy`, wrapping `ssrfGuard`) with a per-host rate limiter and exponential backoff that retries 403/429/5xx and honors `Retry-After`; microsite LLM extractors fetch through it so exhaustive per-entity scrapes stop tripping host WAF 403s
- `runReport.ts` - structured report for a completed scrape run
- `scrapeJobLock.ts` - acquire/heartbeat/release helpers wrapping the `ScrapeJobLock` model
- `seedSources.ts` - populates active `Source` rows from the coverage registry and disables retained historical rows for retired sources
- `integrityGate.ts` - post-materialization integrity gate (duplicate entities/people, current members on archived entities, duplicate access signals, active artifacts on archived entities), with recommended CLI repair commands
- `cliHelpers.ts` / `scraperCliOutput.ts` / `types.ts` - CLI parsing, output formatting, shared types
- `scraplingBridge.py` - Python bridge for utilities requiring Python tooling

## Active source scrapers (`server/src/scrapers/sources/`)

All 38 sources below are registered in `registry.ts`. Descriptions are grouped by what they produce.

### Federal grant funding

| Scraper | Data |
|---------|------|
| `nsfAwardScraper.ts` | NSF grant awards. |
| `nihReporterScraper.ts` | NIH RePORTER grants. |
| `nehGrantScraper.ts` | NEH funded projects (Yale awardee): humanities/social-science analogue of the NIH/NSF grant lanes. Fetches per-decade open-data CSVs, filters to Yale awardees, groups by lead Project Director, and self-attaches a resolved PI to an existing home or mints a conservative `FACULTY_PROJECT` shell (never a STEM `LAB`). FUNDING_ACTIVITY enrichment only; fails closed on unreachable endpoint or schema drift (#1529). |
| `doeOstiGrantScraper.ts` | DOE physical-sciences funding lane: attributes DOE-funded Yale OSTI technical reports to their Yale faculty PI (fail-closed single-faculty match; USAspending/journal-collaboration sources rejected for weak attribution, #1534). |
| `federalAwardScraper.ts` | USAspending federal awards: attributes DOE/NASA/DoD-funded Yale research to the Yale faculty PI, emitting the same grant-evidence fields as NSF/NIH. Stricter PI attribution than the structured NSF/NIH APIs because USAspending is prime-recipient-level; FUNDING_ACTIVITY enrichment only, fail-closed on ambiguous PI. |

### Faculty rosters and official profiles

| Scraper | Data |
|---------|------|
| `departmentRosterScraper.ts` | Department faculty roster pages and official-profile enrichment. |
| `ysmAtoZScraper.ts` | Yale School of Medicine A-Z lab-website index. |
| `ysmFacultyDirectoryScraper.ts` | YSM faculty: walks the school-wide A-Z directory as a seed roster (~14k entries, mostly non-research staff/trainees), then cites each individual profile for identity, research home (FACULTY_RESEARCH_AREA, or LAB when the profile links its own site), governed MeSH areas, and official prose. Mints a lab-less FACULTY_RESEARCH_AREA home when a profile has research prose but no governed areas (#1933), and skips profiles with no lab website, no areas, and no research description. Fail-closed on contact; directory root never cited. |
| `yseFacultyDirectoryScraper.ts` | Yale School of the Environment faculty: crawls the directory as a seed roster, then cites each individual profile for identity, research home (FACULTY_RESEARCH_AREA, or LAB when the profile links its own site), areas, and official prose. |
| `yaleDirectoryScraper.ts` | Faculty roster via the Yalies API. |
| `officialResearchHomeRosterScraper.ts` | Disabled-by-default, allowlisted current non-lead research-home rosters with stable official-profile identities and bounded freshness. |
| `officialProfilePiBackfillScraper.ts` | Backfill scraper for PI official-profile data. |

### Centers, institutes, and organizational leads

| Scraper | Data |
|---------|------|
| `centersInstitutesScraper.ts` | Yale centers and institutes index. |
| `yseCentersScraper.ts` | Yale School of the Environment centers, programs, and initiatives. |
| `centerDirectorLLMExtractor.ts` | LLM extraction of the single named director of an organizational home from its official site and leadership pages. |
| `centerAffiliationLLMExtractor.ts` | LLM extraction of the faculty explicitly named on a CENTER/INSTITUTE/INITIATIVE/CORE_FACILITY official page for the heterogeneous long tail with no uniform roster; emits only `researchEntityRelationship` observations keyed by the center slug. The shared materializer resolves each name to an existing PI-led lab (`AFFILIATED_LAB`) or faculty-research-area entity and skips anyone who does not uniquely resolve, so hallucinated or ambiguous names never create an entity or edge. Never emits name-only member rows. |

### Topical research-area evidence

| Scraper | Data |
|---------|------|
| `bbsResearchTrackScraper.ts` | Combined Program in Biological & Biomedical Sciences (BBS) nine research-track directories as curated topical evidence; grafts each track's concise area label onto the PI's existing canonical home (resolved via the PI's own `/bbs/profile/<slug>` YSM profile + lab links, or a unique name-key), fail-closed on ambiguity, and mints a conservative FACULTY_RESEARCH_AREA home on the `ysm-faculty-<slug>` namespace only when none resolves (never a duplicate shell, #1390). Track roots are crawl seeds only; fail-closed on contact (#1703). |
| `departmentResearchAreasScraper.ts` | FAS science/quantitative department research-overview pages (physics/chem/mcdb/mbb/astronomy/applied-physics/statistics/eeb `/research`) as curated topical evidence; grafts each theme heading's area label onto the existing home of every faculty member listed under it, resolved by the member's own profile URL or a unique department-scoped name-key. Graft-only (never mints), cited to the member's own profile URL; the overview page and bare `/people` index are crawl seeds only. FAS analogue of `bbsResearchTrackScraper` (#1738/#1703). |
| `ysmMeshKeywordScraper.ts` | YSM research-by-keyword (MeSH) directory as a crawl seed; reads governed MeSH areas from each faculty's cited individual profile and attaches them to existing YSM entities. Fail-closed on contact; listing/facet pages never cited. |
| `researchAreaSourceExtractor.ts` | Deterministic recovery of approved research areas for empty-area entities from their official page (labeled Research Interests/Areas sections plus an approved-registry prose scan); emits approved `TaxonomyTerm` areas only, fail-closed. |

### Museums, collections, and archives

Discovery-only producers, mostly for the `ARCHIVE_OR_MUSEUM_PROJECT` entity type (`libraryCollectionsAsDataScraper.ts` mints `COLLECTIONS_INITIATIVE` and `dhLabProjectsScraper.ts` mints `DIGITAL_HUMANITIES_PROJECT`). Each walks an index only to enumerate homes, then cites each home's own page (never the index root) per the self-referential / index-page source guards (#516/#549), and fails closed on contact.

| Scraper | Data |
|---------|------|
| `peabodyCollectionsResearchScraper.ts` | Yale Peabody Museum "Collections & Research" divisions (Anthropology, Botany, Vertebrate Paleontology, ...), each led by the named "Curator-in-charge" resolved to a unique canonical `Researcher` before promoting a lead. Pilot producer for the museum/archive type (#1349/#1367). |
| `beineckeCuratorialUnitsScraper.ts` | Beinecke Rare Book & Manuscript Library curatorial units (Americana, the Osborn Collection, ...). Reads only a structured staff/contact curator credit, never body prose, so it fails closed on units with no structured lead. |
| `beineckeCollectionsResearchScraper.ts` | Yale Beinecke Library research fellowship programs; emits identity and official-page description only, fail-closed on contact, access claims, openings, and the awarded-fellow roster (#2040). |
| `yaleCenterBritishArtScraper.ts` | Yale Center for British Art curatorial departments and museum-run research programs; carries a curated seed of each department's own page because YCBA publishes no enumerable index. |
| `yaleUniversityArtGalleryScraper.ts` | Yale University Art Gallery curatorial areas (African Art, Ancient Art, ...); fetches through the shared rendered (headless) path to clear the Cloudflare interstitial, and fails closed when no rendered fetcher is configured. |
| `libraryCollectionsAsDataScraper.ts` | Yale University Library online exhibitions; reads the exhibits site API and extracts a structured "curated/organized by" credit as the lead. |
| `dhLabProjectsScraper.ts` | Yale Digital Humanities Lab projects catalog: mints `DIGITAL_HUMANITIES_PROJECT` homes from the curated `YaleDHLab/dhlab-site` `_projects` catalog (crawl seed), citing each project's own official URL; fails closed when a project has no citable own-page URL. The rendered dhlab.yale.edu catalog was retired in the library migration (#1345). |

### Undergraduate programs, courses, fellowships, and postings

| Scraper | Data |
|---------|------|
| `departmentUndergradResearchScraper.ts` | Department-level undergrad research opportunity/program pages. |
| `courseBasedResearchPathwayScraper.ts` | Per-department directed-research / independent-study / senior-essay / senior-thesis course pages, minted as discovery-only `COURSE_SEQUENCE` homes (identity + official URL + description only; fail-closed on contact; catalog/course-search index roots never cited). |
| `undergradResearchPostingScraper.ts` | Real apply-now undergraduate research postings from curated public Yale index pages, emitting `POSTED_OPENING` access evidence. Fail-closed: a posting is emitted only with a title, a resolvable hiring entity, an http(s) apply route, and an unexpired deadline; auth-gated aggregators (Handshake, Workday) are never configured (#1568/#1303/#1332). |
| `undergradFellowshipRecipientScraper.ts` | Undergrad fellowship recipient lists. |
| `yaleReuProgramsScraper.ts` | Yale-hosted NSF-REU and summer research programs (Dorrit Hoffleit Astronomy, SUMRY, ...) as `SUMMER_RESEARCH_PROGRAM` fellowships; cites each program's own official page, cross-checks discovery against the NSF REU Sites directory (crawl-seed-only, never cited), records the apply portal as a link, fail-closed on contact. |
| `yaleHealthSciencesSummerProgramsScraper.ts` | Application-based, deadline-driven summer research programs at YSM/YSPH/Yale Nursing and their institutes that admit undergraduates; the biomedical analogue of the REU lane on a distinct set of health-sciences host domains. Records the apply portal as a link; fail-closed on contact. |
| `studentGrantsDatabaseScraper.ts` | Yale Student Grants Database (studentgrants.yale.edu -> CommunityForce): enumerates public student-funding funds via the shared rendered (headless) fetch path (the ASP.NET grid needs JS), cites each fund's own FundDetails page, and fails closed when the rendered results/detail pages come back blocked or empty rather than minting funds from a login shell. |
| `yaleCollegeFellowshipsOfficeScraper.ts` | Yale College Fellowships Office public catalog. |

### Lab-microsite LLM extraction

| Scraper | Data |
|---------|------|
| `labMicrositeUndergradLLMExtractor.ts` | LLM extraction of undergrad-access signals and claim-specific logistics from lab microsites. |
| `labMicrositeDescriptionLLMExtractor.ts` | Research-home description extraction from microsites: prefers the home's own official prose (JSON-LD, meta, About/Overview/mission body) extracted deterministically, and falls back to verbatim LLM extraction gated by a deterministic grounding check. |

### Official directories

| Scraper | Data |
|---------|------|
| `yaleResearchOfficialScraper.ts` | Yale Research (provost/OVPR) official data. |

## Deprecated: bibliographic paper pipeline

The bibliographic ingestion implementations for arXiv, OpenAlex, ORCID works, Europe PMC/PubMed, and Crossref have been removed and cannot run via the CLI, cron, a sweep, or the work planner.
The official-profile publication producer and materializer retirement contract is documented in `docs/research-data-pipeline.md`.
Paper materialization and the `Paper` and `PaperAuthor` models and their readers are fully retired with no rollback opt-in; see `docs/scraper-deployment-runbook.md`.
The launch-trust gate no longer enforces paper-quality or research-activity checks.
Historical `paper` observations and source rows are retained as read-only archived evidence and are never materialized.
Verified Google Scholar and ORCID identity links stay on `Researcher`.
Stored `papers`/`paper_authors` collections remain only until the human-gated collection drop under issue #207; see `docs/research-model.md`.
