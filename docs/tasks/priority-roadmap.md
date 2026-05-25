# Priority Roadmap

Last updated: 2026-05-25

This is the single task source of truth for Yale Research. Keep it operational: the top sections should say what to do next, while the lower sections preserve stable context, completed milestones, and verification commands.

The roadmap follows the hard-pivot decision: keep runtime centered on canonical `ResearchEntity` infrastructure, finish Beta seeding and search confidence, then move deliberately toward production scraper rollout and post-Beta cleanup.

## How To Use

- Start with `Current Focus`, then work down the `Active Priority Queue`.
- Keep task notes compact here instead of creating new durable files under `docs/tasks/`.
- When a task completes, fold the stable outcome into `Completed Milestones` or the relevant workstream notes.
- Keep source acceptance notes brief and evidence-based; detailed scraper procedure belongs in `docs/scraper-deployment-runbook.md` and `docs/scraper-audit-guide.md`.
- After code, schema, scraper, architecture, or durable-doc changes, run `graphify update .`.

## Priority Scale

- `P0`: Required before trusted development data population.
- `P1`: Required before Beta seeding or Beta traffic.
- `P2`: Production readiness, rollout depth, or post-Beta cleanup.
- `P3`: Later workflow expansion.

## Current Focus

1. Before copying Beta to production, close the highest-trust Beta audit gaps: stale/broken external profile links, logged-in placeholder account repair, sparse student-facing pathway/contact coverage, and local Meili ResearchEntity query gaps.
2. Promote the accepted full Beta posture to production deliberately: confirm production backup, decide whether to copy Beta data or rerun guarded production deltas, sync Meili, and smoke-test.
3. Keep local validation pointed at the Beta MongoDB and local development Meili for now. The final Beta database audit passed against canonical collections; the old `research_groups` collection is intentionally absent after the hard migration.
4. Carry forward the publication-authorship rule: professor/lab paper lists should use only identity-backed authorship evidence in `paper_authors`; arXiv/Crossref-style metadata can enrich papers but must not create faculty links from names alone.
5. Carry forward the OpenAlex storage lesson: full OpenAlex Beta materialized `papers`, but raw OpenAlex observations were pruned after report capture to stay within the current 5GB Atlas storage tier.

Full Beta scraper validation is accepted as of 2026-05-14. Production writes/copy are not complete.

## Active Priority Queue

| Rank | Priority | Workstream                        | Next action                                                                                                                                                                | Done when                                                                                                                                                           |
| ---- | -------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | P2       | Beta data trust audit fixes       | Repair or explicitly suppress broken/stale profile links, invalid placeholder emails, and sparse pathway/contact coverage before copying Beta to production.                 | Beta trust audit has no high-confidence broken-link/contact placeholders and coverage gaps are either fixed or product-accepted as sparse.                          |
| 2    | P2       | Production scraper rollout        | Complete the auditable promotion gate: backup/restore drill, dataset version, copy-vs-delta decision, privacy payload gate, Meili sync/rollback plan, and smoke-route owner. | Production has the accepted Beta dataset or accepted guarded deltas, backup/rollback notes, dataset version, Meili sync, privacy-gated payloads, and smoke coverage; recurring jobs wait for trusted WorkPlanner coverage. |
| 3    | P2       | OpenAlex retention policy         | Production defaults to compact retention; dry-run `yarn scrape prune-observations` before enabling apply mode and keep saved run reports for broad sources.                   | Production OpenAlex rollout has accepted compact-retention counts or a deliberate Atlas storage upgrade, plus rollback notes.                                      |
| 4    | P2       | Publication source chunks         | Run ORCID, PubMed, and Europe PMC in Beta/production chunks before promotion if broader identity-backed biomedical/publication coverage is desired; keep Crossref chunked/as-needed. | New publication sources have accepted reports with zero materialization errors, or are explicitly left as implemented-but-not-promoted enrichment sources.           |
| 5    | P2       | Opportunity detail polish         | Complete as of 2026-05-14; keep regression tests green during later opportunity work.                                                                                      | Listing-bridged and scraper-derived posted opportunities show richer evidence, application state, and smoke coverage.                                               |
| 6    | P2       | Admin and data-quality operations | Blocked on concrete PI claim, Scholar disambiguation, and broader field-lock workflows; do not add admin UI without a review loop.                                         | Scraper QA artifacts, PI claim flow, Scholar disambiguation, source-health summaries, status reaper behavior, and broader field locks exist where needed.           |
| 7    | P2       | Post-Beta legacy cleanup          | Start only after production copy/smoke proves canonical surfaces with accepted Beta data.                                                                                   | Legacy `ResearchGroup`/lab naming, inert `researchGroupId` fields, owner denormalization, temporary migration scaffolding, and stale task files are removed safely. |
| 8    | P3       | Saved/advising workflow expansion | Complete as of 2026-05-14; revisit only when advisor accounts or richer sharing requirements become concrete.                                                              | Advising-share, reminders, saved pathway plus fellowship bundles, thesis planning, and outreach helpers have explicit privacy rules and no mass-email behavior.     |

## Workstream Notes

### P1: Beta Readiness Gate

- [x] Clear CSV-backed fellowship input for active configured programs. `/tmp/ylabs-accepted-inputs/fellowships/` now has ready accepted CSVs for STARS II, STARS Summer, Dean's/Rosenfeld, Tetelman, and Mellon Mays with `blockedRows = 0`.
- [x] Clear the Scholar accepted-file gate for a small high-confidence source-backed batch. `/tmp/ylabs-accepted-inputs/scholar/google-scholar-accepted.csv` validates in dry-run with 5 ready rows and `blockedRows = 0`.
- [x] Clear broader arXiv math, physics, and statistics ORCID input for the clean subset. `/tmp/ylabs-accepted-inputs/arxiv-math-physics-stat-orcids.txt` validates with 102 ready ORCIDs, `blockedRows = 0`, and the 12 ambiguous ORCIDs remain excluded.
- [x] Confirm Beta backup/canonical migration/source metadata posture. `SCRAPER_ENV=beta yarn --cwd server beta:readiness --confirm-beta-backup --accept-pathway-meili --strict` passed against `yalelabs0.ilyce1q.mongodb.net/Beta` with zero blocking gates.
- [x] Apply accepted Scholar IDs after target DB and backup posture were confirmed. The 5 accepted rows were applied to Beta and manually locked on `User.googleScholarId`.
- [x] Run Pathway Meili relevance review with real student-style queries. Divergences for `summer`, `data`, and `posted roles` were product-reviewed as acceptable because local Meili surfaced relevant evidence/postings that Mongo free-text missed.
- [x] Accept the explicit local Beta Meili posture. Beta/local validation uses `PATHWAY_SEARCH_BACKEND=meili`; rollback remains setting `PATHWAY_SEARCH_BACKEND=mongo`.

### P1: Beta Seed

- [x] Seed source metadata for Beta with `yarn scrape:seed-sources`; 23 source rows were updated and `yarn scrape list` has no Apify source.
- [x] Attempt active sources source-by-source, not as an all-scraper blast.
- [x] Materialize only accepted baseline runs. Accepted Beta runs all ended with `materialization.errors = 0`; caveats are recorded in the Beta seed acceptance snapshot below.
- [x] Bridge legacy listings into canonical posted opportunities. After accepted Beta writes, Beta has 1,419 posted opportunities and 1,709 entry pathways, with 1,707 pathway docs indexed locally.
- [x] Rebuild local Meili `pathways` and `researchentities` after accepted writes. After the full LLM pass, local indexes contain 1,707 pathway docs and 3,165 research entity docs.
- [x] Smoke-test `/research`, `/pathways`, `/opportunities/:id`, guarded admin access, and removed legacy routes. Research and Pathways search returned 200s, opportunity detail returned a listing-bridged payload, unauthenticated admin returned 401, and `/api/research-groups/search` returned 404.
- [x] Record compact source acceptance notes in this roadmap.

### P1: Full Beta Scraper Soak

- [x] Correct local scraper target posture to the Beta MongoDB. The local `.env` now points at the Beta database, and no secret URI is recorded in docs.
- [x] Confirm Beta is not empty under the canonical model. Current audited counts include `users=19413`, `research_entities=3165`, `entry_pathways=1707`, `posted_opportunities=1417`, `papers=296912`, `paper_authors=400396`, and `sources=24`; the legacy `research_groups` collection is absent by design.
- [x] Add a deliberate full-audit escape hatch for `lab-microsite-undergrad-llm` so a Beta soak can bypass WorkPlanner freshness with `--ignore-work-planner`.
- [x] Complete the full `lab-microsite-undergrad-llm` Beta pass. Run `6a05cc7196a7be7e3c03002a` processed 1,736 website candidates, succeeded for 1,725, materialized 1,725 updates, and ended with `materialization.errors = 0`.
- [x] Rebuild local Meili after the accepted full LLM pass. Local indexes now contain 1,707 pathway docs and 3,165 research entity docs.
- [x] Fix OpenAlex default candidate safety. Without `--discover-openalex-authors`, OpenAlex now targets only users with ORCID/OpenAlex identifiers instead of broad name-only faculty; the corrected Beta cohort is 6,701 candidates.
- [x] Make full OpenAlex operational for Beta. Added deterministic `--offset` chunking, batched OpenAlex observation emission, batched observation supersession, and fast paper materialization so the full source can run as resumable chunks.
- [x] Rerun OpenAlex across the full identifier-backed Beta cohort. Accepted chunks covered offsets `0`, `100`, `350`, `600`, `850`, `1100`, `1350`, `1850`, `2350`, `2850`, `3350`, `3850`, `4350`, `4850`, `5350`, `5850`, and `6350`, plus a targeted no-cache retry for `ceb88`; all accepted chunks had `materialization.errors = 0`.
- [x] Keep Beta under the current Atlas storage tier. OpenAlex emitted 5,582,929 raw observations across accepted full-soak runs, then materialized durable `papers` and pruned raw OpenAlex observations after run reports were captured in `/tmp/ylabs-beta-openalex-full/`.
- [x] Rebuild local Meili and rerun final source health after full OpenAlex closeout. ResearchEntity index rebuilt with 3,165 docs, Pathways index rebuilt with 1,707 docs, strict Beta readiness stayed ready; after adding ORCID/PubMed/Europe PMC/Crossref source roles and dry-run smokes, source health reports 15 ok, 9 warn, 0 error.
- [x] Audit Beta database usefulness and Production parity. The existing Mongo naming migration merged 700 legacy `researchareas` rows into canonical `research_areas`, 28 missing Production users were inserted without overwriting Beta users, and final parity shows Beta contains every Production user, listing, department, fellowship, and research area by `_id`. Canonical referential checks across pathways, opportunities, evidence, contact routes, listings, entity members, papers, observations, scrape runs, users, sources, and departments found zero broken links.
- [x] Convert professor/lab paper links to identity-backed authorship. Beta now has 400,396 `paper_authors` proof rows backfilled from legacy OpenAlex identity-backed links; 2,878 active arXiv author observations were superseded; 1,173 arXiv-only faculty links were cleared while preserving arXiv paper metadata; the paper-authorship audit now reports `unsupportedLegacyOrNameOnlyLinks = 0`.
- [x] Run the stricter post-improvement database audit with deletion permission. `yarn --cwd server papers:authorship-audit --apply --no-backfill-openalex --sample-limit=0` found and deleted zero remaining invalid records: invalid/orphan/duplicate `paper_authors = 0`, denormalized paper-author mismatches = 0, active direct author-field observations = 0, unidentified unlinked/linked papers = 0. Broader checks stayed clean: strict Beta readiness had no blocking gates, source health was 15 ok / 9 warn / 0 error, and `legacy:cleanup --verify` reported no legacy collection residue.
- [x] Run the broader autonomous Beta data/API/UX trust audit. Canonical required fields, canonical foreign keys, relationship drift, opportunity deadline states, negative metrics, and paper years were clean. Auto-repaired 9 posted-opportunity application URLs, 10 posted-opportunity source URLs, 10 listing website URLs, and 1 whitespace-padded user email. Remaining trust gaps before production copy: 36 invalid placeholder user emails, 1 invalid listing owner email, 1,766 active entities without pathways, 3,111 active entities without public contact routes, 3,165 entities with empty/very short `shortDescription`, duplicate same-name lab labels that need disambiguation context, and a sampled external-link pass with 8 confirmed 404s plus 3 network/timeouts out of 40 checked URLs.
- [x] Apply the follow-up Beta trust cleanup with deletion permission. Deleted 27 Beta-only placeholder users with no references or login activity, repaired 1 invalid listing owner email from its linked creator user, normalized 9 access-signal source URLs and 10 entry-pathway source URL arrays that lacked schemes, and pruned 68 stale `ownListings` refs plus 1 stale `favListings` ref from users. Post-cleanup verification reports zero canonical or paper-author orphan references, zero stale saved-listing/pathway/fellowship refs, zero invalid listing/contact emails, zero invalid pathway/access URL syntax, strict Beta readiness with no blocking gates, source health at 15 ok / 9 warn / 0 error, and paper-authorship audit counts unchanged with zero invalid/orphan/duplicate proof rows. Eight logged-in placeholder user accounts remain intentionally retained for account repair instead of deletion.

### P1: Pathway Meili Traffic Switch

- [x] Review Meili relevance for real Pathways queries and compare against Mongo behavior with `yarn --cwd server pathway:relevance-review`.
- [x] Accept divergent `summer`, `data`, and `posted roles` behavior for local Beta because reviewed Meili results were relevant and better covered listing/evidence text.
- [x] Keep operator rollback simple: set `PATHWAY_SEARCH_BACKEND=mongo`.
- [x] Confirm an environment can explicitly switch to `PATHWAY_SEARCH_BACKEND=meili` without client changes.
- [x] Update readiness tooling so strict Beta readiness can explicitly accept Meili with `--accept-pathway-meili` after review.

### P1: Baseline Beta Seed Acceptance Snapshot

All accepted Beta source runs below reported `materialization.errors = 0`. This is the baseline Beta seed, not yet the accepted full no-cap Beta soak.

- Source metadata: `yarn scrape:seed-sources` updated 24 sources in Beta after adding ORCID, Europe PMC, and Crossref publication roles; active scraper list excludes Apify.
- Entity discovery/profile metadata: `ysm-atoz-index` `6a0567107c6d4fba869fa81f`, `yse-centers-index` `6a0567a5cc0258656589245a`, `centers-institutes-index` `6a0567baf3b7414831ed1c4c`, `dept-faculty-roster` `6a05694914107ca43f8a18e0`, and `yale-directory` `6a056ccea4f7ab29ba5f79cc`.
- Research enrichment: bounded `openalex` `6a05780041458bad74743eee`, `nih-reporter` `6a057bc113fc60d57ec23e76`, `nsf-award-search` `6a057e6bfab31be25f981fdf`, and final accepted-list `arxiv` `6a058fbbdaf5da6369c0e458`.
- Access evidence: full `lab-microsite-undergrad-llm` `6a05cc7196a7be7e3c03002a` and `undergrad-fellowships-recipients` `6a058f98737fc05dd6399765`.
- Listing bridge: 1,419 legacy listings were attached to canonical entities and materialized into 1,419 posted opportunities.
- Accepted-input gates: fellowship rows are ready across five active programs with 34 accepted rows; Scholar has 5 applied accepted IDs; arXiv has 102 accepted ORCIDs.
- Full-soak OpenAlex: accepted full chunks and the `ceb88` retry emitted 5,582,929 observations before pruning, represented 348,550 works, created 291,889 paper rows, updated 56,493 paper rows, skipped 168 paper rows missing required fields, and ended with total `materialization.errors = 0`. Late offsets from `4350` onward were traversed and produced zero works because their raw identifier fields did not resolve to OpenAlex authors. Beta now has 296,912 `papers`.
- Final Beta database audit: Beta now contains every current Production `users`, `listings`, `departments`, `fellowships`, and `researchareas` row by `_id`; the canonical `research_areas` collection has 700 rows after migration. Referential checks across canonical runtime and scraper-audit collections found zero broken links. Audit reports were saved to `/tmp/ylabs-beta-final-db-audit-2026-05-14.json` and supporting parity reports under `/tmp/ylabs-beta-*-audit-2026-05-14.json`.
- Caveats for production promotion: OpenAlex raw observations do not remain in Beta after materialization because the current Atlas tier hit the 5GB storage quota; run logs under `/tmp/ylabs-beta-openalex-full/` preserve reports. Production should either provision storage for raw OpenAlex observations or explicitly keep this compact-retention policy. `dept-faculty-roster` and `arxiv` have materialization conflicts that were reviewed as non-fatal duplicate/conflict candidates; final `arxiv` fetched 46/103 targets before arXiv rate limiting/timeouts and should not be rerun immediately without backoff. Paper quality checks found 66 papers missing `year` and 339 duplicate DOI groups, but no duplicate OpenAlex IDs, no duplicate arXiv IDs, no missing titles, and no missing source labels. After the identity-backed cleanup, 295,739 papers remain faculty-linked through OpenAlex proof rows, 1,173 arXiv-only papers remain as unlinked preprint metadata, and no unsupported legacy/name-only faculty links remain.
- Beta trust-audit caveats before production copy: sampled stale profile/source links include Yale department URL redirects that now end in 404, eight logged-in placeholder user accounts still need account repair rather than deletion, and most entities still lack public contact routes/pathways. Playwright browser launch was blocked by missing host libraries (`libnspr4`, `libnss3`, `libasound2t64`) without passwordless sudo; the fallback UI verification used local API smokes, `yarn --cwd client build`, and `yarn --cwd client test:ci`.
- Local Meili: rebuilt `pathways` with 1,707 documents and `researchentities` with 3,165 documents from Beta data. Research search falls back to keyword search when local Meili lacks the semantic `default` embedder.
- 2026-05-25: Added `yarn --cwd server research:quality-search-review` as a read-only golden-query helper for Research/Search quality review. It reports sparse descriptions, missing lead/context, weak source URL/title/domain, duplicate/disambiguation warnings, thin pathway/contact evidence, and semantic explainability gaps across student-style research/pathway queries; it requires the target `MONGODBURL` and local/staging Meili availability to produce live rows.

### P2: Production Scraper Rollout

- [x] Wait for the full Beta scraper soak to pass. Full lab-microsite, fellowship, arXiv, and OpenAlex Beta source execution is accepted with zero materialization errors.
- [x] Add production cron safety guardrails. `yarn scrape cron --source <source-name> --release` now uses source-level locks, refuses disabled sources by default, materializes immediately, emits reports, and exits nonzero on materialization errors; `yarn scrape prune-observations` provides dry-run-first compact retention for old superseded observations.
- [x] Make the production promotion runbook executable. `docs/research-data-pipeline.md`, `docs/scraper-deployment-runbook.md`, and `docs/scraper-audit-guide.md` now define the single-lane gate, backup/rollback posture, Meili sync, smoke checklist, known warnings, local/VPN/Render constraints, and post-gate documentation requirements.
- [x] Restore the DB-backed production gate commands. `yarn --cwd server beta:data-quality --include-samples` and `yarn --cwd server scraper:integrity-gate --include-samples` are defined again and backed by focused unit coverage for data quality, scraper integrity, identity dedupe, PI dedupe, and archived artifact repair helpers.
- [x] Run the GStack production-gate dry run from isolated worktrees. Read-only source health reported 25 sources with `13 ok`, `12 warn`, and `0 error`; scraper integrity passed with warning-only duplicate person identity conflicts that still need review before production promotion. UI smoke found no blocking student/admin regressions under mocked read-only API data.
- [x] Prepare the operator decision packet and rollback drill. `docs/scraper-deployment-runbook.md` now has fillable gate fields for lane, Atlas restore point, rollback/smoke owners, Meili before/after backend, accepted warnings, run IDs, and rollback-tested status; Lane A and Lane B dry-run rollback drills are documented without choosing a lane.
- [x] Add first recurring-source cron acceptance criteria. The runbook now has a source-specific matrix for `ysm-atoz-index`, `department-undergrad-research`, `yale-college-fellowships-office`, `lab-microsite-undergrad-llm`, `openalex`, and `arxiv`, with hold conditions before unattended cron.
- [x] Classify read-only production-promotion data warnings into an operator queue. Gate outputs now attach `classification`, `owner`, and `nextCommand` metadata to warning records so warning-only runs are actionable instead of flat advisory output.

| Warning                            | Count | Classification              | Owner                     | Next command                                                                                  |
| ---------------------------------- | ----- | --------------------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| `sourceHealthWarnings`             | 12    | `must_fix_before_promotion` | scraper-source operator   | `yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` |
| `duplicateEntityNames`             | 269   | `must_fix_before_promotion` | data-quality operator     | `yarn --cwd server research-entity:dedupe-by-pi --limit=10000`                                |
| `suspiciousUserEmails`             | 4     | `must_fix_before_promotion` | identity/account operator | `yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` |
| `duplicatePersonIdentityConflicts` | 1329  | `must_fix_before_promotion` | identity/account operator | `yarn --cwd server users:dedupe-by-identity --limit=1000`                                     |
| `missingShortDescriptions`         | 2858  | `accepted_release_warning`  | content-quality operator  | `yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` |
| `coverageWithoutPathways`          | 1825  | `accepted_release_warning`  | pathway coverage operator | `yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` |
| `coverageWithoutAccessSignals`     | 1981  | `accepted_release_warning`  | pathway coverage operator | `yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` |
| `coverageWithoutContactRoutes`     | 3056  | `accepted_release_warning`  | contact coverage operator | `yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` |
| `weakShortDescriptions`            | 11    | `post_promotion_backlog`    | content-quality operator  | `yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` |

- [x] Add a reusable read-only production promotion smoke helper. `yarn --cwd client smoke:production-promotion` now checks public Research, Pathways, opportunity discovery/detail, config, and unauthenticated Operator Board API access without secrets or writes; optional Playwright UI checks use route interception instead of `/api/dev-login` so no analytics sessions are created. Current limitation: the Operator Board UI is mounted under admin `/analytics`, not a dedicated `/admin/operator-board` client route.
- [x] Restore the full client CI promotion gate on `new-foundation`. On 2026-05-25, `yarn --cwd client test:ci` passed with 69 files and 565 tests after aligning stale expectations with current pathway copy, canonical posted-opportunity props, and normalized ResearchEntity payloads; closed-access copy now renders `Not currently available`.
- [ ] Before any production write or copy, record the runbook gate: backup/restore drill owner and restore point, dataset version, copy-vs-delta lane, privacy payload acceptance, Meili sync/rollback plan, smoke-route owner, and confirmation that production cron/retention/broad paid writes remain off by default.
- [ ] Decide production promotion mechanism: copy the accepted Beta database to production, or run guarded production deltas only after the gate above is complete.
- [ ] If using guarded deltas, run production sources one at a time with `SCRAPER_ENV=production`, `CONFIRM_PROD_SCRAPE=true`, and `--release` posture; save each run ID and report under the promotion dataset version.
- [ ] Accept, materialize, sync Meili or keep Mongo rollback, smoke `/api/config`, `/api/research/search`, `/research/:slug`, `/api/pathways/search`, `/opportunities/:id`, `/programs` or `/fellowships`, unauthenticated admin `401`, and removed legacy routes, then document rollback posture per source or copy.
- [ ] Add source-specific staggered recurring jobs only after WorkPlanner behavior is trusted for broad or paid sources.

### P2: Product And Admin Polish

- [x] Polish `/opportunities/:id` evidence, sources, deadline state, application state, and listing-bridged versus scraper-derived provenance in the public payload and page.
- [x] Add smoke coverage for listing-bridged and scraper-derived posted opportunities.
- [x] Expand saved run artifacts where they help reviewed data quality.
- [x] Add source-health summaries for trusted data-quality review.
- [x] Add status reaper behavior for expired posted opportunities.
- [x] Add `department-undergrad-research` as the first deterministic source-expansion scraper for official department undergraduate research pages. It emits research entity/access/contact/application-route evidence and is covered by parser plus access-materializer tests; it must not create posted opportunities from generic department guidance.
- [x] Merge the `yale-college-fellowships-office` URL-hygiene and program-classification model into `new-foundation`. The scraper canonicalizes the moved Mellon Mays URL, skips gated CommunityForce fetches, emits program/source visibility evidence, and keeps fellowship funding separate from posted opportunity/pathway creation.
- [x] Add the canonical `/programs` API and Programs & Fellowships route while preserving `/fellowships` compatibility aliases during migration.
- [x] Add student visibility tiers and dry-run/apply backfill scripts for programs and research entities so student surfaces hide `operator_review` and `suppressed` records by default.
- [x] Gate public research/program/opportunity/pathway API detail and search surfaces to student-visible tiers by default; admin program detail can still read non-public program records for review.
- [x] Tighten the Programs public/admin visibility pipeline so service-level program search ignores non-public tier requests unless the route/controller marks the caller as admin; focused tests cover public filtering and admin inspection of review/suppressed rows.
- [x] Add a read-only Operator Board foundation to the admin panel. It summarizes source health, Trust Tier counts, review queues, latest dry/write runs, gate commands, Meili status placeholders, and a top-level promotion status without adding write buttons or worker execution.
- [x] Extend the Operator Board control-plane slice with source readiness rows, WorkPlanner freshness policies, queue-kind totals, discovery-candidate samples, and pending Meili-sync warnings from recent non-dry scraper runs. This keeps operators aware of stale/blocked/pending-search-sync posture without adding worker execution or write buttons.
- [ ] Add PI claim flow, Scholar disambiguation, and broader admin field-lock UI only when the workflow is clear.

### P2: Post-Beta Legacy Cleanup

- [ ] Remove remaining `ResearchGroup`, `lab`, and `researchGroupId` naming residue after Beta proves canonical surfaces.
- [ ] Rename legacy-named files/classes such as `ResearchGroupMember`, `ResearchGroupStats`, and `PaperGroupLink` once routes, analytics, and saved workflows are stable.
- [ ] Clean legacy `Listing.owner*` denormalization only after the pathway model has proven stable.
- [x] Keep `docs/tasks/priority-roadmap.md` as the only durable task file under `docs/tasks/`.

### P3: Saved And Advising Workflow Expansion

- [x] Add advising-share flows with explicit opt-in visibility.
- [x] Add deadline-aware reminders and saved pathway plus fellowship bundles.
- [x] Add thesis-planning views and outreach helpers with private notes kept private.
- [x] Avoid mass-email behavior; exploratory outreach should remain specific and evidence-based.

## Current Operating Baseline

### Verified Foundation

- `ResearchEntity` is canonical at runtime and uses the `research_entities` collection.
- `server/src/models/researchGroup.ts` keeps a reusable legacy-shaped schema only; no runtime `ResearchGroup` model registers on `research_groups`.
- `yarn --cwd server research-entity:migrate` supports `--dry-run`, `--apply`, `--verify`, and `--rollback-plan`.
- `yarn --cwd server legacy:cleanup` preserves leftover legacy `applications` rows in `student_applications`, verifies copy parity, and drops copied or empty legacy source collections.
- Runtime research browse/detail, admin review, opportunity detail, pathway search joins, lab-microsite refreshes, and entity materialization use canonical `ResearchEntity`.
- New scraper observations emit `researchEntity`; materializers still read historical `researchGroup` observations where needed.
- `/api/research-groups`, `/labs`, and `/labs/:slug` compatibility routes are removed from runtime routing.
- `/api/research`, `/api/pathways/search`, `/api/opportunities/:id`, and `/api/admin/access-review` use `research_entities`.
- Admin review records have review status, notes, reviewer metadata, and locked fields on pathway, access, contact, and opportunity records. Materializers respect record-level locked fields.
- Admin review UI includes record-level review updates, evidence drawers, lock controls, and conflict/gap filters for unreviewed, missing-evidence, guarded-contact, and archived records.
- Pathway Meilisearch has rebuild support, opt-in sync hooks, `PATHWAY_SEARCH_BACKEND=mongo|meili`, a Meili query path, and Mongo-vs-Meili filter/sort parity coverage. Local Beta validation currently accepts `PATHWAY_SEARCH_BACKEND=meili`; rollback remains `PATHWAY_SEARCH_BACKEND=mongo`.
- Production promotion must rebuild the `pathways` Meili index before enabling `PATHWAY_SEARCH_BACKEND=meili` so the index has current filterable fields such as `entityStudentVisibilityTier`; keep production Pathways on Mongo until rebuild and relevance review are accepted.
- ResearchEntity Meilisearch has a repeatable rebuild command: `yarn --cwd server meili:rebuild-research-entities --clear`.
- Publication materialization separates identity proof, authorship proof, and metadata enrichment. `paper_authors` is the durable proof layer, while `Paper.yaleAuthorIds` is a denormalized runtime field derived from `paperAuthorshipEvidence`.
- arXiv and Crossref are metadata-only unless another identity-backed source proves authorship. OpenAlex writes authorship only from accepted ORCID/OpenAlex author IDs; name-only OpenAlex discovery is review-only and does not lock `User.openAlexId`.
- `yarn --cwd server papers:authorship-audit` reports OpenAlex/ORCID/PubMed-EuropePMC/Semantic Scholar proof counts, arXiv-only metadata, and unsupported legacy/name-only links. The 2026-05-14 Beta apply backfilled 400,396 OpenAlex proof rows and left zero unsupported paper-author links.
- Optional Scrapling rendered fetch support is isolated behind `SCRAPLING_RENDERER_ENABLED=true`, `server/src/scrapers/renderedFetch.ts`, and `server/src/scrapers/scraplingBridge.py`.

### Known Incomplete

- Production copy/rollout has not been run. The accepted full Beta dataset is now the promotion candidate, subject to backup and storage-retention review.
- OpenAlex production retention/storage now defaults to compact retention unless an Atlas storage upgrade is deliberately chosen. The retention command is dry-run-first and deletes only old superseded observations while preserving active evidence and recent runs.
- ORCID, PubMed, and Europe PMC author-proof scrapers plus Crossref DOI hydration are implemented and dry-run smoked against Beta in small batches, but have not been promoted as full non-dry Beta/production chunks. Use `--offset`/`--limit` chunks; do not run full Crossref across all DOI papers as a single broad job.
- Recurring broad/paid scraper jobs are intentionally not enabled until WorkPlanner behavior is trusted in production posture.
- `yarn --cwd server pathway:relevance-review` compares Mongo and Meili across the current student-style query set and leaves rollback as `PATHWAY_SEARCH_BACKEND=mongo`; reviewed local Beta divergences for `summer`, `data`, and `posted roles` are accepted.
- Local Meilisearch service availability is no longer the immediate blocker in this workspace. The existing `ylabs-meilisearch` container on `http://localhost:7700` rebuilt local Beta `pathways` with 1,707 documents and `researchentities` with 3,165 documents after the full LLM pass.
- `yarn --cwd server beta:readiness` reports Beta target, accepted-input readiness, gated source posture, source metadata presence, canonical migration residue, and Pathway backend posture without writing data. Use `--accept-pathway-meili` only after product-reviewing the Meili switch.
- Beta audits should use canonical collections. `research_entities` is the runtime collection; the legacy `research_groups` collection is absent by design after hard migration and should not be used as the emptiness signal.
- Final Beta database parity is complete for current Production base data: all Production users, listings, departments, fellowships, and research areas are present in Beta by `_id`. Production analytics events were not copied into Beta because they are usage logs, not research-discovery seed data.
- Accepted-input tooling is ORCID-first: operator-facing accepted files use ORCID for external researcher identity, while netid/User ids remain internal compatibility targets after validation. `yarn --cwd server accepted-inputs` supports `status`, `orcid:crosswalk`, fellowship candidate/status/export commands, Scholar candidate/apply commands, and arXiv ORCID candidate/validate commands.
- Fellowship blocker now has source-backed intake tooling and accepted files for all active configured programs. `yarn --cwd server accepted-inputs fellowship:status` reports STARS II, STARS Summer, Dean's/Rosenfeld, Tetelman, and Mellon Mays as `ready`; the old Bass Writing placeholder was removed from active config because it is a tutoring program placeholder, not a discrete undergraduate research fellowship with a recipient list.
- Scholar accepted IDs now have a high-confidence source-backed starter file. `/tmp/ylabs-accepted-inputs/scholar/google-scholar-accepted.csv` validates with 5 ready rows and has been applied to Beta after target database and backup posture were explicit. Apify Scholar sources are retired; keep Scholar ID discovery as accepted-input/manual review work using official Yale profile evidence.
- arXiv ORCID accepted input is ready for the clean subset. `/tmp/ylabs-accepted-inputs/arxiv-math-physics-stat-orcids.candidates.txt` contains 114 candidates; the accepted file `/tmp/ylabs-accepted-inputs/arxiv-math-physics-stat-orcids.txt` contains the 102 validated ORCIDs from the review subset and excludes the 12 ambiguous ORCIDs attached to multiple users. Use the `scraperOnlyValues` from validation for the current arXiv scraper `--only` target list.
- Client file/component names still include lab-era naming; these are implementation residue, not product routes.
- Physical legacy fields such as `researchGroupId` remain as inert migration residue inside otherwise canonical collections until post-Beta cleanup.
- Legacy-named files/classes such as `ResearchGroupMember`, `ResearchGroupStats`, and `PaperGroupLink` point at canonical physical collections and can be renamed after Beta.
- Some listing surfaces still rely on legacy `Listing.owner*` denormalized fields; clean them only after production copy/smoke proves the Beta pathway model.
- PI claim flow, Scholar disambiguation UI, and broader admin field-lock UI remain intentionally unstarted until their human review workflows are concrete.
- Department ground-truth seed flow is dry-run verified but has not been applied. The 2026-05-13 dry run parsed 126 YCPS subjects, 30 YSM department labels, and 162 YSM acronyms; it reported one pending `SPAN` department update and unresolved department-string audit values in `research_entities`, `listings`, and user majors.

## Development Scraper Validation Snapshot

On 2026-05-13, the active scraper inventory was audited against the Development Mongo database only. No Beta or production writes were run.

- Source inventory matched `yarn scrape list`: `arxiv`, `openalex`, `ysm-atoz-index`, `yse-centers-index`, `yale-directory`, `dept-faculty-roster`, `nih-reporter`, `nsf-award-search`, `centers-institutes-index`, `undergrad-fellowships-recipients`, and `lab-microsite-undergrad-llm`. Apify Scholar sources are retired.
- Expanded official Yale roster/profile enrichment dry-run `6a05646183c1dc41569794ba` covered Math, Physics, Statistics, and Astronomy with `math=20`, `physics=88`, `statistics=34`, and `astronomy=25`, emitting 3,165 dry-run observations across 167 faculty and 130 inferred labs. Google Scholar links from official pages remain review-only candidate URLs.
- Baseline scraper tests and `npx tsc --noEmit -p server/tsconfig.json` passed before accepted Development writes.
- Accepted non-dry Development writes covered representative `dept-faculty-roster`, `centers-institutes-index`, `ysm-atoz-index`, `yse-centers-index`, `nih-reporter`, `nsf-award-search`, `openalex`, and `arxiv` scopes.
- All accepted non-dry writes reported `materializationErrors = 0`.
- Discovery/enrichment source runs produced `0` direct access artifacts from their own observations.
- Bounded credential-source smokes ran for `yale-directory` and `lab-microsite-undergrad-llm`; earlier Apify Scholar smokes produced zero reviewable Scholar value and the sources are now retired.
- Follow-up Development writes closed the LLM candidate-website gap and CS/Psych roster coverage gaps.
- Final Development audit re-ran `yarn scrape:seed-sources` against the current Development database after retiring Apify Scholar sources. This marked stale Apify source metadata retired and left the active source inventory aligned with `yarn scrape list`.
- The follow-up Development unblock pass has been folded into this roadmap. It confirmed `/tmp/ylabs-accepted-inputs/` had no accepted fellowship or broader arXiv files at that time; Scholar bootstrap dry runs `6a03ff25ba28917da8c512a1`, `6a04001152aa4982b012de06`, and `6a04008c4960f09dfb880652` produced 0 reviewable observations, which led to retiring the bootstrap source.
- Fellowship accepted-input tooling now generates review CSVs from official configured sources, extracts public STARS II PDF text into review candidates, writes manual-required templates for non-public programs, validates accepted rows, and exports scraper-consumable CSVs only after `reviewStatus=accepted`.
- ORCID-first accepted-input tooling now validates ORCID checksums, crosswalks ORCID to existing Yale-confirmed `User` rows, can persist `User.orcid` only from unambiguous source-backed evidence, applies accepted Scholar IDs as manual locks by ORCID, and validates arXiv accepted ORCID lists before producing internal scraper targets.
- Access-evidence accepted-input blockers are cleared for the active local gate: fellowship accepted CSVs validate ready, Scholar accepted IDs dry-run ready for a 5-row starter batch, and broader arXiv coverage is ready for the accepted 102-row subset. Ambiguous ORCIDs remain excluded rather than guessed.
- Local Meilisearch closeout rebuilt `pathways` with 1,442 documents and `researchentities` with 3,069 documents. Pathway runtime search remains on Mongo until relevance review passes.
- The Development unblock pass rebuilt `pathways` with 1,442 documents and `researchentities` with 3,069 documents again for shadow review; runtime stayed Mongo because free-text relevance still needs product acceptance.
- Live built-server smoke returned 200 for Research search/detail, Pathways search, and opportunity detail; removed legacy `/api/research-groups/search` and `/api/labs` routes returned 404; unauthenticated `/api/admin/access-review` returned 401.

## Completed Milestones

- 2026-05-13: Completed the Development hard-pivot `ResearchEntity` migration. `research_entities` is canonical, runtime code reads/writes `ResearchEntity`, `researchEntityId` refs are backfilled, `/api/research-groups` and `/labs` runtime compatibility are removed, and post-drop verification reports no canonical/ref drift.
- 2026-05-13: Completed Development legacy collection cleanup. `research_groups`, `research_group_members`, `research_group_stats`, `paper_group_links`, and `applications` are absent; useful `applications` data was preserved in `student_applications` before drop.
- 2026-05-13: Completed formalization model cleanup. Independent-study/course-credit evidence now materializes as `CREDIT_FORMALIZATION_POSSIBLE` or thesis/advising signals, not standalone entry pathways; past-undergrad fellowship evidence creates exploratory outreach plus `FELLOWSHIP_COMPATIBLE`, not `FELLOWSHIP_FUNDED_PROJECT` pathways; formalization-only legacy pathway types are hidden from Pathway search.
- 2026-05-13: Completed the Pre-Beta Development Core Complete pass for ResearchEntity/admin/search/scraper gates. Admin review has record-level review metadata, evidence drawers, review updates, lock controls, and conflict/gap filters; Pathway Meili has rebuild/sync/backend-switch infrastructure and Mongo-vs-Meili parity coverage; CS/Psych roster and lab-microsite LLM source-data blockers have accepted Development writes; Pathway and ResearchEntity Meili indexes were rebuilt; Development smoke checks passed without Beta or production writes.
- 2026-05-13: Completed the rendered-fetch/Scrapling pilot implementation. Rendered fetching is optional, domain parsing stays in TypeScript, CS department scraping first tries the official component data endpoint and can fall back to rendered HTML, lab-microsite LLM extraction can use rendered fallback for empty/script-heavy pages, and fetch metrics track mode, success, latency, memory delta, blocking, and selector breakage.
- 2026-05-13: Completed the source-backed department taxonomy and safe seed flow. `data-migration/departmentGroundTruth.ts` fetches and validates official YCPS, YSM department, and YSM acronym sources against the curated app overlay; `Department` stores aliases, source records, and code systems; `/config` continues to return only client-compatible department fields; `seedDepartments.ts` is dry-run-first with `--apply` writes, inactive marking for stale rows, local-only reporting, and unresolved-string audits.
- 2026-05-13: Added ORCID-first accepted-input tooling for the remaining local source blockers. The server CLI can generate fellowship review CSVs from official sources, extract STARS II PDF text into review candidates, emit manual-required templates for non-public programs, validate/export accepted fellowship rows, crosswalk ORCID to existing Yale-confirmed users without creating new users, apply accepted Google Scholar IDs by ORCID as manual locks, and validate arXiv ORCID lists before converting to current scraper-compatible internal targets; no Beta or production writes were run.
- 2026-05-13: Completed task source cleanup. Completed or superseded task files were folded into this roadmap, old scraper ship notes were superseded by current product/scraper docs, and the rendered-fetch pilot task was completed by the current implementation. The old `react-virtuoso` ship-note blocker is obsolete because the dependency is present in `client/package.json`.
- 2026-05-14: Added safe P1 operator commands for the Beta readiness gate and Pathway Mongo-vs-Meili relevance review. The commands report blockers, explicit deferrals, migration/source metadata posture, and relevance divergence without changing data.
- 2026-05-14: Polished `/opportunities/:id` by adding explicit deadline state, application state, listing-bridge versus scraper-derived provenance, and public contact-redacted evidence excerpts to the server payload and client page.
- 2026-05-14: Completed opportunity detail smoke coverage for listing-bridged open postings and scraper-derived closed postings.
- 2026-05-14: Added `yarn --cwd server source:health` for read-only source-health summaries. After hard-retiring Apify Scholar and reseeding source metadata, the final Development audit reported 23 active sources, 10 ok, 13 warn, and 0 error over the last 30 days; warnings are mostly no recent run, materialization conflicts needing report review, or missing coverage metadata.
- 2026-05-15: Completed a Playwright-driven detail-page trust pass for `/research/center-wu-tsai`. Research detail pages now dedupe official source URLs into one Sources section, pathway/evidence cards no longer repeat `Source 1` links, and Listings load failures render inline recovery instead of a blocking SweetAlert modal.
- 2026-05-15: Deprecated Listings as the primary UI surface. Authenticated `/` now redirects to `/research`, `/listings` remains as a temporary Posted Roles compatibility route, old `?listing=` links are preserved, and primary navigation no longer exposes Listings.
- 2026-05-14: Added `yarn --cwd server opportunities:reap-statuses` as a dry-run-first status reaper for expired posted opportunities. The Development dry run found 0 expired open posted opportunities.
- 2026-05-14: Added saved scraper QA artifacts through `yarn scrape report --run <scrapeRunId> --output <path>`.
- 2026-05-14: Completed saved/advising workflow expansion. Saved Pathways now supports explicit private-note opt-in for advising exports, deadline-aware reminders from posted opportunities and fellowship matches, fellowship bundle cues, thesis/outreach planning checklists, and source-only exports by default without mass-email behavior.
- 2026-05-14: Unblocked local Pathway Meili relevance review with the existing `ylabs-meilisearch` container, rebuilt `pathways` and `researchentities`, reviewed divergent `summer`, `data`, and `posted roles` results as acceptable for local Beta, and kept rollback as `PATHWAY_SEARCH_BACKEND=mongo`.
- 2026-05-14: Advanced accepted-input blocker artifacts without inventing accepted data. Generated fellowship review CSVs, `google-scholar-candidates.csv` with 6,674 ORCID-backed review rows, an arXiv candidate file with 114 ORCIDs, and a clean 102-row arXiv ready-for-review subset. Saved Scholar bootstrap dry-run report `6a054f13fc56b7ccd36dd96f` after it emitted 0 observations across 3 faculty.
- 2026-05-14: Retired `apify-google-scholar-bootstrap` from the active scraper registry, seed metadata, readiness gates, source coverage, WorkPlanner policies, and operator docs. Scholar candidate discovery now depends on official Yale profile evidence plus manual accepted-input review, not automated bootstrap discovery.
- 2026-05-14: Hard-retired the remaining `apify-google-scholar` source from active scraper code, seed metadata, readiness gates, source coverage, WorkPlanner policies, and operator docs. Official Yale profile evidence now feeds review-only Scholar candidate URLs; accepted Scholar IDs remain a manual `scholar:apply` workflow.
- 2026-05-14: Expanded `dept-faculty-roster` official profile enrichment to the first additional batch: Math, Physics, Statistics & Data Science, and Astronomy. The scraper extracts canonical Yale profile URLs, title/email, ORCID, lab/homepage URLs, bio/research summary, research interests/topics, and review-only Scholar candidate URLs without writing `googleScholarId`.
- 2026-05-14: Cleared the clean arXiv accepted-input gate by promoting the 102-row ready-for-review subset to `/tmp/ylabs-accepted-inputs/arxiv-math-physics-stat-orcids.txt` and validating status `ready` with `blockedRows = 0`. No database writes were run.
- 2026-05-14: Cleared the remaining local accepted-input gates without Beta or production writes. Fellowship accepted CSVs now validate ready for STARS II, STARS Summer, Dean's/Rosenfeld, Tetelman, and Mellon Mays; the non-existent Bass Writing research-fellowship placeholder was removed from active config; Scholar has a 5-row high-confidence accepted file that validates in dry-run; arXiv remains ready for the 102 clean ORCIDs.
- 2026-05-14: Folded the Development scraper validation pass into this roadmap and removed the separate task log so `docs/tasks/priority-roadmap.md` is again the only durable task file under `docs/tasks/`.
- 2026-05-14: Added the authenticated topic-first Yale Research frontend on the canonical `/research` route. The page introduces metadata-grouped topic clusters, grouped search sections, literal identity-confidence cards, and reusable evidence/source rows; client embeddings are still unavailable, so clusters are visibly labeled `Cluster: experimental` and `Cluster: metadata-grouped`.
- 2026-05-14: Polished the `/research` UX after review. The page now uses student-facing labels, a visible search label, no fake zero-count fallback cluster cards, explicit keyboard focus states, a flatter results layout, and cluster CTAs placed after evidence context.
- 2026-05-14: Completed a second `/research` UX iteration using progressive-disclosure and status-message guidance. Empty grouped-result scaffolding is hidden until search, search results now expose a live result-count summary, topic-row loading states are quieter, and pathway labels render as readable metadata.
- 2026-05-14: Collapsed the temporary versioned Research route back into the canonical `/research` surface. Future frontend iteration should happen in place on existing product routes or behind non-URL feature flags, not by adding `/v1`, `/v2`, or similarly versioned student-facing routes.
- 2026-05-14: Ran Playwright browser audits for `/research` across desktop, tablet, and mobile. Follow-up polish moved submitted search results directly below the search controls, fixed cluster and identity-card badge overflow, rebranded the shell/title/login/about copy to Yale Research, and confirmed no horizontal overflow or internal V1/V2 copy in the audited viewports.
- 2026-05-14: Replaced fixed example topic chips on `/research` with dynamic suggested searches derived from visible research profile metadata already loaded for the page. True cross-user trending remains a later analytics-backed feature because the current search-quality endpoint is admin-only.
- 2026-05-14: Ran a deeper Playwright clickthrough on `/research` covering empty search, suggestion chips, cluster exploration, source links, profile links, and the mobile drawer. Follow-up fixes disabled empty search submits and stopped passive favorite-list load failures from opening blocking SweetAlert modals over research detail pages.
- 2026-05-14: Prioritized desktop `/research` results after a 1440px Playwright audit. The primary desktop result layout now puts clusters beside evidence-backed pathways, moves people/contact identity matches below pathways, and hides the empty paper-results section until real paper records exist so the UI no longer says `0 papers via profiles` while cluster cards show paper-count signals.
- 2026-05-14: Backend/data feedback from the desktop Research audit: student-facing quality now depends on real paper-level search hits, a student-safe suggested/trending search API, identity confidence fields beyond contact names, source-backed pathway relevance by query, and cluster metadata that distinguishes real paper counts from paper records available for display.
- 2026-05-14: Live local API sampling found `/api/research/search` returning zero ResearchEntity hits for `Machine learning` and `AI safety`, while `/api/pathways/search` returned one `Machine learning` exploratory-outreach pathway. Before suggested/trending topics become prominent, backend search/indexing should align visible suggestions with successful ResearchEntity and Pathway results.
- 2026-05-14: Redesigned canonical `/research` around Yale research homes rather than internal clusters. The page now leads with `Matching Research Homes`, supports `Best Next Steps` through pathway action cards, hides raw cluster/pathway enum labels, keeps evidence/source context visible, and was re-verified with Playwright on desktop, tablet, and 375px mobile.
- 2026-05-14: Completed the baseline Beta seed against the Beta MongoDB and local development Meili, then corrected the roadmap to separate baseline seed from the user's requested full Beta scraper soak. Accepted baseline materialization runs had zero materialization errors, accepted-input gates were cleared and applied where appropriate, legacy listings were bridged into posted opportunities, strict Beta readiness passed with explicit Meili acceptance, and public/admin smokes passed. The full lab-microsite LLM pass later completed with zero materialization errors; the subsequent milestone records the OpenAlex full-soak closeout.
- 2026-05-14: Completed the full OpenAlex Beta scraper soak across the 6,701-candidate identifier-backed cohort using resumable offsets, no name-only discovery, and no per-author page cap. Accepted full-soak chunks emitted 5,582,929 observations before pruning, represented 348,550 works, created 291,889 papers, updated 56,493 papers, and had zero materialization errors. Raw OpenAlex observations were pruned after report capture to stay within the current 5GB Beta Atlas tier; durable publication data now lives in `papers`.
- 2026-05-14: Completed the final Beta database audit and Production parity pass. The Mongo naming migration merged 700 legacy `researchareas` rows into canonical `research_areas`, 28 missing Production users were copied into Beta without overwriting existing Beta records, strict Beta readiness stayed ready, source health reported 11 ok, 12 warn, 0 error, and canonical referential checks found zero broken links.
- 2026-05-14: Implemented identity-backed professor paper authorship. arXiv now upserts preprint metadata by `arxivId` without Yale author IDs; OpenAlex attaches authorship only from accepted ORCID/OpenAlex author IDs; ORCID public works plus PubMed/Europe PMC ORCID-backed discovery can emit `paperAuthorshipEvidence`; Crossref hydrates DOI metadata only; `paper_authors` stores durable proof; `yarn --cwd server papers:authorship-audit --apply` backfilled 400,396 OpenAlex proof rows in Beta, superseded 2,878 arXiv author observations, cleared 1,173 arXiv-only faculty links, and left zero unsupported legacy/name-only links.
- 2026-05-14: Completed the stricter post-authorship database audit. The enhanced `papers:authorship-audit` command now reports invalid/orphan/duplicate proof rows, direct author-field observations, denormalized drift, and identifierless paper clutter; apply mode found zero remaining records to delete after the prior cleanup.
- 2026-05-15: Implemented production cron readiness for scrapers. Added `ScrapeJobLock` source leases, `yarn scrape cron`, cron-triggered run metadata, disabled-source enforcement for cron, dry-run-first compact observation retention, and focused lock/cron/retention tests.

## Verification Commands

Use focused checks per slice. For broad migration closure:

```bash
npx -y corepack@0.34.7 yarn --cwd server test
npx -y corepack@0.34.7 yarn --cwd server legacy:cleanup --verify
npx -y corepack@0.34.7 yarn --cwd server test src/scripts/__tests__/acceptedInputsCore.test.ts src/acceptedInputs/__tests__/fellowshipInputs.test.ts
npx -y corepack@0.34.7 yarn --cwd server accepted-inputs status
npx -y corepack@0.34.7 yarn --cwd server accepted-inputs fellowship:status
npx -y corepack@0.34.7 yarn --cwd server accepted-inputs arxiv:validate --input /tmp/ylabs-accepted-inputs/arxiv-math-physics-stat-orcids.txt
npx -y corepack@0.34.7 yarn --cwd server accepted-inputs scholar:apply --dry-run
npx -y corepack@0.34.7 yarn --cwd server beta:readiness --confirm-beta-backup --accept-pathway-meili --strict
npx -y corepack@0.34.7 yarn --cwd server pathway:relevance-review
npx -y corepack@0.34.7 yarn --cwd server papers:authorship-audit
npx -y corepack@0.34.7 yarn --cwd server source:health
npx -y corepack@0.34.7 yarn --cwd server opportunities:reap-statuses
npx -y corepack@0.34.7 yarn --cwd client test:ci src/components/accounts/__tests__/SavedPathwaysSection.test.ts
npx -y corepack@0.34.7 yarn --cwd client test:ci
npx tsc --noEmit -p server/tsconfig.json
npx -y corepack@0.34.7 yarn build
graphify update .
```
