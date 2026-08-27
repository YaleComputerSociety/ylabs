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
  -> ResearchEntity / RoleAssignment (roster) / Researcher / User / Grant / Fellowship records
  -> Signal (access types) when evidence supports it
  -> Signal (logistics types) when exact official evidence supports an independent logistics claim
  -> student visibility gate promotes public-safe records or opens release queue items
  -> beta repair queue applies deterministic trusted-source repairs and re-gates records
  -> Meilisearch rebuild or sync (the gate resyncs its changed entities itself)
  -> Research, Programs, and admin/operator surfaces
```

The materializer resolves a legacy `User` to a canonical `Researcher` (via `resolveResearcherIdForLegacyUser`) before writing roster rows, so `RoleAssignment.personId` is always a `Researcher` id even though most other identity fields still live on `User`.
See [`docs/research-model.md`](./research-model.md) for the current collection shapes.

### Scraper sweep and recurring stages

The pipeline is orchestrated end to end by one phased sweep, `yarn --cwd server scrape:sweep --mode=<mode>` (`server/src/scripts/runScraperSweep.ts`), rather than by running each source by hand.
The registered sources in `SCRAPER_SWEEP_SOURCES` are grouped into ordered phases that run in sequence in the order the phases first appear in the manifest: `identity`, `discovery`, `funding`, `relationships`, and `content-access`.
The `scholarly` phase is declared in the source-phase contract but currently carries no registered sources, so it does not run.
Sources inside a phase run with bounded concurrency, and the two LLM-heavy phases (`relationships`, `content-access`) are capped at concurrency 2 by `PHASE_CONCURRENCY_CAPS` regardless of the requested `--concurrency`.
The two exhaustive Development modes default the network-bound discovery phase to cross-source concurrency 8; to stay polite to any single host, the sweep sets each source child process a `SCRAPER_PER_HOST_CONCURRENCY` cap that shrinks as cross-source concurrency rises, so the combined per-host request budget across concurrent children stays bounded, and an operator `SCRAPER_PER_HOST_CONCURRENCY` override can only tighten that per-child cap, never loosen it.
The dept-roster and dept-undergrad sources stay effectively serial because they page through their own in-loop `--limit`.

The sweep modes fix the environment, database, write posture, and confirmation flag together, so a single `--mode` cannot straddle environments:

| Mode | Env / DB | Writes | Auto-materialize | Confirmation flag |
| --- | --- | --- | --- | --- |
| `development-plan` | development / Development | no | no | none (dry-run, `--limit 100 --use-cache`) |
| `development-sample` | development / Development | yes | yes | none (`--limit 100 --use-cache`) |
| `development-full` | development / Development | yes | yes | `--confirm-development-full-sweep` (`--exhaustive --ignore-work-planner`) |
| `development-incremental` | development / Development | yes | yes | `--confirm-development-incremental-sweep` (`--exhaustive --use-cache`) |
| `beta-plan` | beta / Beta | no | no | none (dry-run, stop-on-failure) |
| `beta-fetch` | beta / Beta | yes | no (Render materializes) | `--confirm-beta-release-candidate` (`--exhaustive`, stop-on-failure) |

Development modes require a local Meilisearch host and an empty `MEILISEARCH_INDEX_PREFIX`; the sweep refuses a non-local Development Meili target.
Beta modes fetch observations into the `Beta` database and emit per-source `betaRenderCommands` (dry-run materialize plan plus apply) so the Beta Render service materializes the recorded run ID; local Beta runs never materialize.

The two exhaustive Development modes (`development-full`, `development-incremental`) run a fixed chain of post-run stages after every source has fetched and materialized:

1. `faculty-projection` (`research-entity:project-faculty`, `--concurrency 12`)
2. `researcher-dedupe` (on by default in Dev sweeps; disable with `SCRAPER_SWEEP_DEDUPE_RESEARCHERS=0`)
3. `eponymous-fra-merge` (on by default in Dev sweeps; disable with `SCRAPER_SWEEP_AUTO_MERGE_FRA=0`)
4. `url-identity-dedupe` (opt-in, only when `SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES` is set)
5. `visibility-gate` (`student-visibility:gate --collection=all --apply`)
6. `search-rebuild` (`meili:rebuild-research-entities --clear`)
7. `coverage-audit`
8. `data-quality` (`beta:data-quality --strict`)
9. `integrity-gate` (`scraper:integrity-gate --include-claim-gate`)
10. `trust-contract` (`launch:trust-contract --mode=student-ready-only --strict`)
11. `archived-cleanup` (`research-entity:cleanup-archived --merge-residue-only`; residue is deleted by default in Dev sweeps, disable with `SCRAPER_SWEEP_DELETE_MERGE_RESIDUE=0`)

The `researcher-dedupe`, `eponymous-fra-merge`, and merge-residue deletion stages run by default on the two exhaustive Development modes so the Dev pipeline auto-dedupes every run. Each can be disabled independently by setting its environment flag to a falsey value (`0`, `false`, `no`, `n`, `off`, `disable`, or `disabled`): `SCRAPER_SWEEP_DEDUPE_RESEARCHERS`, `SCRAPER_SWEEP_AUTO_MERGE_FRA`, and `SCRAPER_SWEEP_DELETE_MERGE_RESIDUE`. The `url-identity-dedupe` stage is opt-in and stays off unless `SCRAPER_SWEEP_MERGE_URL_IDENTITY_DUPLICATES` is set to a truthy value (`1` or `true`), so a routine sweep never silently merges by shared profile URL. These post-run stages never run on Beta or Prod sweeps, so those paths are unaffected.

The post-run chain is defined once as a declarative registry (`DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS` in `runScraperSweep.ts`, issue #2050): each stage owns its command, args builder, enable predicate, and optional typed result contract, and both the plan builder and the runner derive from it.
A stage that declares a result contract but exits successfully without a readable, valid result artifact fails loud rather than silently dropping its delta.

### Faculty new-model projection

`research-entity:project-faculty` (`server/src/services/facultyResearcherProjection.ts`) is a recurring sweep stage that keeps a canonical `Researcher` spine for every active faculty member, independent of whether any scraped membership has resolved them yet.
It reads active faculty `User` rows (`userType` in {`professor`, `faculty`}, not archived, not `dedupedIntoUserId`), skips organizational mailboxes, and resolves-or-creates the canonical `Researcher` id for each identity via `resolveOrCreateResearcherIdForIdentity`.
It is dry-run by default; apply requires `--apply --confirm-faculty-projection`.
Concurrency is bounded (default 10, max 32); the sweep runs it at 12.

### Eponymous FRA-to-lab merge and durable redirects

The `eponymous-fra-merge` sweep stage (`research-entity:merge-eponymous-fra`, on by default in Dev sweeps, disable with `SCRAPER_SWEEP_AUTO_MERGE_FRA=0`) collapses only the high-confidence eponymous case: a `faculty-research-area-*` shell that shadows the same PI's concrete lab home.
Selection filters to the `profile_area_shell_with_concrete_home` dedupe category and refuses a `CENTER`/`INSTITUTE` canonical (issue #1957), then relinks references onto the canonical, recomputes student visibility, and force-resyncs the canonical to Meilisearch.
Every merge records a durable `ResearchEntityRedirect` (`researchEntityMergeRedirectService.ts`) keyed on the shell slug/id and pointing at the live canonical, so a later re-scrape resolves the old shell to its canonical instead of re-minting a duplicate; resolution follows redirect and `canonicalGroupId` chains and never depends on the shell row still existing.
The `archived-cleanup` stage enforces a fail-closed redirect invariant (issue #2039): in `--merge-residue-only` mode it refuses to delete any residue whose durable redirect is absent (`missing_redirect`) or that still has live references (`has_live_references`).

### Ingest-time observation-store guards

`observationStore.appendObservations` (`server/src/scrapers/observationStore.ts`) is the single ingest choke point, and it applies several guards before any observation is stored:

- Ingest sanitization runs `observationFieldSanitizer` over every field from every source so page furniture, contact leakage, and chrome cannot enter a stored field (#1375).
- Supersession keys on `observationFingerprint`; fields in `LATEST_WINS_FINGERPRINT_FIELDS` (including the first-class `methods` field, see below) omit `value` so a fresh snapshot supersedes the prior one despite content drift.
- The regressive-prose guard `isRegressiveProseRefresh` (#2035) protects the quality-guarded prose fields (`fullDescription`, `shortDescription`): when the incoming value is judged not useful by the description-quality checks but an active same-`(source, entity, field)` value is useful, the incoming observation is dropped, so a degraded re-scrape can never overwrite a clean source-backed description. Clean-to-clean refreshes are unaffected.
- `retireObservations` (#1966) is a primitive that bulk-supersedes the observations matching a filter (for example an entity's active rows) and stamps a `rollback` marker with an audit reason, without deleting evidence.

Microsite LLM extractors are gated on a versioned content hash (#2025).
Each extractor computes a SHA-256 hash over the exact fetched page bytes plus the extraction contract that would consume them (the extractor's prompt content hash and model id, and for the description extractor also the card model and card-synthesis prompt content hash), compares it against the last stored `sourceContentHash` bookkeeping observation for that `(source, entity)`, and skips the paid LLM call entirely when both the bytes and the contract are unchanged.
Prompt text lives in editable `.md` files under `server/src/scrapers/prompts/`, and each `*_PROMPT_HASH` is the sha256 of its file content (#2099), so editing a prompt `.md` changes the contract hash and re-extracts exactly the affected entities on the next run with no manual version bump, while unchanged pages still skip.
The `--force-llm` flag is the only bypass; the gate is read directly by the extractor so it also holds under `--exhaustive` and `--ignore-work-planner`.

At materialization, `entityMaterializer` clears stale observation-only fields on rematerialize (#1963): for `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS` (`methods`, `inferredPiUserId`) it unsets the field and its `confidenceByField` entry when the field is not manually locked, is not written this run, and has no live observation this run, so a value no source still supports is removed rather than lingering.
`methods` is a first-class `string[]` of grounded research techniques (#1954, #1947): the microsite description extractor emits it (grounded through `utils/methodGrounding.ts` to drop vague fillers), the work planner targets it alongside descriptions and areas, and the materializer writes it latest-wins.

Scrapers collect evidence. They should not create unsupported student-facing conclusions such as "accepting undergrads." Materializers derive product records from observed evidence, source confidence, stable keys, and manual locks. The student visibility gate is the public-release boundary: it promotes records that satisfy the visibility rules and holds the rest in the release queue with root repair reasons. In Beta, `operator_review` is an automatic repair state: queued records should be repaired from trusted source evidence where deterministic, then re-gated until they become `student_ready`, `limited_but_safe`, `suppressed`, or an explicit exception.

Research description visibility is assessed after the same lead-aware sanitization used by the public detail response.
A `student_ready` entity must have useful public full and card descriptions after sanitization, and an operator override cannot bypass that invariant.

### One serve-time description sanitizer

Every HTTP path that serves research-entity copy runs one canonical function, `sanitizeServedResearchEntityCopyFields` in `server/src/utils/researchEntityDescriptionText.ts`.
It composes the full guard union in a fixed, idempotent order: the text-transform layer (subjectless-lead repair, first-person re-voicing, mismatched-name-prefix correction, the non-person-org biography guard, and the `publicResearchEntityDescriptionText` fail-closed gate), then the faculty and research-home self-reference relabel passes, then the `descriptionHygiene` layer (chrome and dump stripping, contact-block/publications/center-blurb/HTML fail-close, and the length clamp).
The public research-entity DTO (`toPublicResearchEntityDto`, `toPublicResearchEntitySummaryDto`) routes through it, so browse and search cards get the same guard set the detail page already applied, rather than the `descriptionHygiene` subset alone.
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

For YSM lab entities, `ysm-atoz-index` uses the current official index at `https://medicine.yale.edu/about/a-to-z-index/lab-websites/`. It is not only an index discovery source: it fetches the official lab homepage and emits source-backed `fullDescription` and `shortDescription` observations from Yale's embedded page metadata when available. It follows an exact lab `Research Faculty` page link and emits a named `director` member only when that page has exactly one profile card; profile URLs are canonicalized to `medicine.yale.edu/profile/<slug>/`, and the scraper does not fabricate a `User` when no existing user match is available. Materialization records per-field provenance from the winning observation so detail pages can be audited back to the exact source URL.

Research-entity `sourceUrls` are durable home/profile/grant evidence pointers, not a dump of every supporting page. Materialization keeps raw observation evidence intact, but filters article, news, event, blog, podcast, video, and webinar paths out of materialized `sourceUrls` so content pages cannot make a valid lab or center look like a leaked article record.
Materialization also promotes a lead's official profile page into `sourceUrls` so the detail-page official-profile CTA can find it: `officialLeadProfileSourceUrl` picks the highest-confidence lead-identity observation (only `inferredPiUserId`/`inferredPiUserKey`/`inferredDirectorName`) whose `sourceUrl` passes `isLikelyOfficialPersonProfileUrl`, and `materializeEntity` unions that URL in after website derivation, deduped by `normalizeOfficialProfileDestination` and skipped when `sourceUrls` is manually locked (issue #613). It is intentionally lead-scoped so roster and department entities do not flood `sourceUrls` with every cited profile, and `websiteUrl` derivation is unaffected because it already excludes profile/faculty URLs.
Our own site is never valid evidence for an entity, so self-referential URLs (`yalelabs.io` and the deploy hosts, per `isSelfReferentialUrl` in `utils/urlSafety`) are dropped defense-in-depth: `observationStore.appendObservations` fails closed and never stores them as provenance, `sanitizeResearchEntitySourceUrlsForMaterialization` strips them from materialized `sourceUrls`, and the public `/research/:slug` payload assembly filters them out server-side at read time via `isDisallowedResearchEntitySourceUrl` in `utils/researchHomeWebsiteUrl` (which also excludes A-Z / lab-website index pages, faceted/section-index roots, and generic CMS/platform boilerplate hosts such as `wordpress.org` "Powered by" footer links, #572) across group `sourceUrls`, access-signal source URLs, and undergraduate-logistics evidence, so bad sources stop rendering everywhere without a data write.

Research detail membership and lead identity resolve from the canonical roster (`RoleAssignment` joined to `Researcher`), so the earlier `User` versus `FacultyMember` identity divergence no longer applies.
Each roster member is a single canonical `Researcher`, and the public detail payload shows that identity rather than falling back to a separate scraper-backed `FacultyMember` record.
Because canonical identity is unified there is no `facultyMemberId` conflict to detect, so the student visibility gate no longer raises `pi_identity_conflict` from roster leads and strong-lead detection relies on the roster member's presence and name.
A lead `RoleAssignment` that resolves to a `Researcher` counts as attached lead evidence.

The `official-research-home-roster` source acquires non-lead current membership only from an allowlisted official page and explicitly configured current section.
Each materialized row requires a source-specific official profile identity, an honestly mapped role, a recent page publish date, an observation date, and a bounded refresh-expiry date.
Names alone never resolve a `User` or merge membership rows.
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
The gate and `student-visibility:backfill` fail closed on an empty-roster state: once enough lead-requiring research entities are scanned and nearly all of them resolve zero canonical leads, apply is refused with an explicit blocker instead of mass-suppressing the directory, so an accidental recompute against a mid-migration empty roster cannot hide public records.
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

For action-evidence repair, official deterministic department undergraduate research pages are the first repair lane before targeted LLM extraction. The `department-undergrad-research` source emits program records that materialize into `Fellowship` records on `/programs` (never a `PROGRAM` research entity, which no longer exists) plus per-faculty `LAB` `ResearchEntity` evidence, undergraduate access evidence, and guarded contact/application-route observations when the page itself supports them; generic guidance pages must not be materialized as active access `Signal` rows.

Faculty profile data should prefer official department profile evidence before publication-derived or same-name signals. Department roster/profile scrapes emit official profile URL, image, title, email, and bio observations, but Yale email observations must be person-specific for the profile name; reject generic contacts and wrong-person page emails even when the email is on a Yale-controlled page. Yale Medicine profile extraction must prefer the explicit `Biography` section, then explicit Research `Overview` text, over patient cards, page chrome, contact paragraphs, appointment-only copy, office addresses, course listings, publication-link text, citation metrics, center/program labels, credential-only education lists, leading author-list publication entries, or article headlines. Public profile shaping hides those non-biographical snippets, metric topics, and h-index values when no supported research identity or explicit interests back them, clips long public bios at a sentence boundary, expands clean official `Research Areas`/`Fields of Interest` snippets into readable source-attributed bios, can use official profile `researchInterests` arrays as a presentation-only source-attributed fallback when stored prose is empty or appointment-only, and accepts legitimate Yale profile URL variants such as compact compound surnames, first-name-prefix slugs, short same-person given-name slugs, explicit-first-initial slugs, or standalone first-initial slugs. A Yale profile URL that still fails name matching may stop suppressing the bio only when the stored bio starts with the exact current professor name, when it starts with first name + middle initial(s) + last name, or when title-stripped official bio prose starts with a verified multi-token given-name variant plus the stored last name; keep hiding the mismatched URL itself unless the URL independently matches the person. When a personal bio is still empty, public profile shaping may derive a presentation-only fallback from trusted membership-backed research homes only if the person is a lead of a concrete non-individual home with its own non-profile website and useful source-backed research prose; do not materialize guessed `User.bio` values from that fallback, and do not use ORCID/grant-only, individual faculty-research-area, first-person, or person-named shell summaries as biographies. Same-name contaminated profile URLs, profile bios, topics, papers, and research entities must not leak into public profiles; same-prefix or same-initial wrong-person URLs still count as contamination.

The `official-profile-pi-backfill` scraper is a targeted official Yale profile repair source. It can emit `user` identity/profile observations when canonical URL, name, Yale email/NetID, and faculty title all validate. For already-linked public professor profiles, the visible bio lane may use the known `User.netid` after canonical URL, name, faculty title, and same-person URL matching validate, so missing profile email does not block bio repair; large visible-profile batches throttle repeated profile fetches to reduce 403s from official profile hosts. That visible-bio-only lane may also read official department person pages, such as Engineering faculty-directory or department `/people/` pages, when the URL path matches the linked user's name, may fetch official `/profile/` slugs made from a multi-token given-name variant when fetched identity validation still matches the linked user, and may target weak faculty users directly when their own profile URL is a same-person official Yale profile even if no public research-home membership supplied that URL. Visible bio materialization should emit only profile enrichment fields such as bio, image, interests/topics, and ORCID, not broad identity fields like `userType`, names, titles, or profile verification. Queued PI identity, research-home, and description repair lanes remain limited to canonical official profile URLs. When a grant shell already has an attached Yale lead but no stored profile URL, the profile-description lane may generate bounded `medicine.yale.edu/profile/<first-last>/` and `ysph.yale.edu/profile/<first-last>/` candidates from the lead identity; those URLs are fetch candidates only, and observations are emitted only after the existing canonical URL, name/email, and expected-person validation passes. Expected-person validation fails closed on an email disagreement instead of falling back to a bare name-token match, and a guessed `medicine.yale.edu`/`ysph.yale.edu` profile is rejected as an entity's official-profile identity when no expected email confirms it and the entity's own recorded school/departments affirmatively rule out medicine, so a same-name medical professor's areas and website cannot graft onto an unrelated humanities or social-science entity (the same never-attach-on-name-alone invariant as #562, applied at the research-area/website official-profile-identity step, issue #585). It can also use official profile bio text for bounded source-description repair, expand terse official research-interest snippets into readable source-attributed user bios, and use an attached lead member's official profile to emit same-entity `ResearchEntity` name/type/website/source observations when person-scoped JSON-LD affiliations or profile-body links show a leadership-backed lab, center, institute, program, or initiative. The extracted research-home name is truncated to its head-noun phrase, dropping a trailing description clause that begins right after a `Lab`/`Center`/`Institute`/`Program`-style head noun with a pronoun, article, or study/investigate/develop-style verb, so linked-lab prose can no longer glue a first description sentence onto the name; legitimate multi-word names such as `Center for Molecular Biology` and `Institute of Sacred Music` are preserved because only clause-starters are cut, never connectives like `for`/`of`/`on`/`in`/`and` (#624). It must reject profile chrome, navigation-panel links, broad department/org labels, generic institutional centers, parent organizations named only through subarea leadership, and outside-Yale/deputy-director affiliations as automatic research-home replacements. Directory news/card titles, appointment labels, degree/education credential lines, generic voluntary-faculty boilerplate, single-study clinical-trial abstracts, publication-count blurbs, Google Scholar/link prompts, broad MeSH/taxonomy buckets, and generic field headings must not be converted into profile bios, research-interest observations, topics, or title evidence; standalone noun `research` is too broad to validate a faculty title without a real role phrase. The source-url website lane must also reject scholarly or social directory hosts such as Academia.edu and ISPU scholar listings as direct research-home websites. A named Google Sites lab or personal academic site (`sites.google.com/view/<lab>`, `sites.google.com/site/<name>`, or a domain-scoped `sites.google.com/<org>/<name>` path) is a genuine research home and is preferred over a faculty-directory or `/profile/` stub for the primary `websiteUrl`, while a bare `sites.google.com` host with no named site stays rejected (#537). The materializer and public profile shaper must ignore active official-profile bio observations that are known non-bio snippets, including credential-only education lists, leading author-list or single-citation publication entries, appointment-only title lists, grant/project metadata blocks, clinical-profile calls to action, email-bearing contact text, external scholar-profile callouts such as `Google Scholar profile`, profile CTA text such as `Watch a video` or `Learn more about Dr...`, and trailing or glued `Last Updated` metadata, so stale address/title/news/citation/contact observations cannot beat later source-backed values. When otherwise useful official profile prose contains contact chrome, strip inline email parentheticals and leading `Email:`/`Phone:` header blocks before observation emission; if contact text remains, reject the bio or fall back to source-attributed official interests instead of exposing emails or phone numbers. Long official bios should clip at real sentence boundaries without cutting at dangling honorific abbreviations such as `Dr.` or `Prof.`. This lets NIH-style PI shells such as `Albert Sinusas Lab` resolve to a real research home like Yale Translational Research Imaging Center when the official profile and center page support it. It must not emit access/action evidence, research membership, department/org labels, or contact observations from profile chrome alone.

For queued PI repair, official-profile identity fallback may create a missing Yale user only when the page itself validates as the same canonical Yale profile, exposes a person-specific `@yale.edu` email, has a matching display name, and carries a supported research/faculty/director title. In that case the scraper emits `user` observations keyed by the email local part and an `inferredPiUserKey` observation; the materializer creates or enriches the user first, then resolves the key into a PI member. Keep this path bounded to real profile/person pages: lab, center, institute, initiative, research-home, and broad directory URLs must not be treated as profile candidates.

For stale official profile URLs, fix deterministic upstream URL patterns before broad backfill. The visible-bio lane canonicalizes the confirmed Sociology migration from `sociology.yale.edu/people/<slug>` to `sociology.yale.edu/profile/<slug>/`, and profile fetches try the preferred official candidate first, then same-person validated alternates instead of letting one 404 block the whole target. Bio observations must still pass quality gates: do not emit short topic fragments or semicolon-delimited topic lists as `User.bio`, even from official profile pages.

Action-evidence repair must prefer official/profile-quality entity source URLs over grant, identifier, or ORCID provenance when creating low-confidence exploratory outreach artifacts. Grant-member provenance can identify a funding relationship, but it should not be the public next-step URL once an official Yale profile or research-home source has been materialized.

When no official profile bio exists, trusted personal or lab homepages may support reviewed user-bio backfill only when the page contains person-specific narrative evidence. Keep this as a guarded review lane unless a deterministic extractor can prove identity and narrative quality. Do not synthesize `User.bio` from WTI-style roster pages, contact pages, generic lab slogans, title-only pages, person-named shells, or pages where the only evidence is a broad research-home summary.

Explicit `View Lab Website` links on official Yale profiles are a stronger research-home signal than broad profile affiliations. This path may accept a non-Yale lab domain when the official profile card itself labels the target as a lab website; the materialized lab name should use the profile person's name plus `Lab`, with credential suffixes such as `PhD` stripped. These lab-card links still must not be confused with profile chrome, academic-publication concept links, social/profile services, or broader center/department pages.

The department-roster scraper no longer extracts official-profile publications or linked publication lists, and the entity materializer ignores historical `officialProfilePublications` observations instead of creating `research_scholarly_links`.
The standalone official-profile publication-pointer repair command is also retired.
Paper Observation materialization and the `Paper` and `PaperAuthor` models and their readers are fully retired, with no rollback opt-in.
Historical `paper` observations are retained as read-only archived evidence and are never materialized.
Stored observations and scholarly sidecars remain available only for the human-gated `papers`/`paper_authors` collection-drop step in issue #207.

Description extraction should follow newly discovered official research-home websites before falling back to older profile/source URLs. `lab-microsite-description-llm` prefers non-profile `websiteUrl`/`website` values over profile source URLs, and non-profile official page descriptions carry higher confidence than profile-page descriptions so center/lab pages can replace biographical profile fallback copy. Profile-page extraction stays lower confidence and should not override better official research-home pages. The same non-profile microsite extraction also emits the research home's own real `name`/`displayName` at high confidence when the page states a proper or branded name, though it rejects governance/umbrella-org titles (Council, Committee, Consortium, Commission, Task Force, Working Group, Senate, Assembly, Office of, Board of) that are never a lab's own branded name so a shared center landing page cannot overwrite distinct person-lab names (#785), while the NIH/NSF grant scrapers emit their `<PI> Lab` fallback only as a low-confidence placeholder, so any real-name source wins during field resolution. Selecting the embedded lab-page description block is entity-type-aware: for lab, center, institute, program, or project entities it picks the research home's research prose and rejects the PI biography, administrative CV, and welcome/navigation boilerplate, while for faculty-research-area and other person entities it keeps a research-focused bio; a page that offers no research-focus prose yields no description rather than materializing a stub. When the path emits a good `fullDescription` but no card, it also ships a grounded one-line `shortDescription` at ingestion (issue #557): it synthesizes a card grounded in that same full description and gated by the `shortDescriptionQuality` bar. When prose yields no groundable, quality-passing summary, the materializer falls back to a deterministic card built from the entity's own trusted `researchAreas` (oxford-joined, capped at four topics, gated on shape rather than full-description grounding), and only when no clean structured topic survives does it fail closed to no card rather than a weak one (issue #952). The same quality bar now rejects vacuous generic summaries such as `Studies the field.` unconditionally, so a bare verb-plus-generic-noun template can never win over an entity's already-populated `researchAreas`. One unreachable or broken page must be logged and skipped without aborting the remaining bounded extraction batch.

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

### Museum and collections research homes

The `peabody-collections-research` source is the pilot producer for the museum/collections research-home type `ARCHIVE_OR_MUSEUM_PROJECT` (issue #1349).
It walks the Yale Peabody Museum "Collections & Research" divisions index only to enumerate divisions, then fetches and cites each individual division page (for example `https://peabody.yale.edu/explore/collections/vertebrate-paleontology`), never the index root, per the self-referential and index-page source guards (#516/#549).
It is discovery-only: it emits division identity, an official-page description, and the single named Curator-in-charge as an entity-level `inferredDirector*` observation, reusing the existing `materializeInferredDirectorMembership` path so the curator is resolved to a unique Yale User before any lead is written and no new access logic is introduced.
It fails closed on contact data and never emits contact routes, undergraduate-access claims, or posted openings; a division that names no Curator-in-charge yields no lead rather than a fabricated one.
A division with a resolved curatorial lead plus its official page lands on the `IDENTIFIED_LEAD_WAYS_IN` path in the access materializer with no new derivation.

The `beinecke-curatorial-units` source extends the same `ARCHIVE_OR_MUSEUM_PROJECT` path to the Beinecke Rare Book & Manuscript Library curatorial units (issue #1457), reusing the Peabody producer's shape and complementing the separate Beinecke research-fellowships producer (#1455).
It walks the Beinecke curatorial-units index (`https://beinecke.library.yale.edu/beinecke/collections`) only to enumerate units, then fetches and cites each individual unit page (for example `https://beinecke.library.yale.edu/beinecke/collections/osborn-collection`), never the index root.
It is discovery-only: it emits unit identity and the unit's own official-page summary description.
Verified live during #1457, the migrated Beinecke site (now under `library.yale.edu/beinecke`) publishes no structured named-curator credit on its unit pages; every "curator" mention is historical body prose ("former curator ...", "served as curator ...").
The curatorial-lead extractor therefore reads only a structured staff/contact credit block and never body prose, so it fails closed on the current unit pages rather than promoting a prose name.
Because `ARCHIVE_OR_MUSEUM_PROJECT` is an organizational research home (`ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES`), an unled Beinecke unit still earns the organizational `REACH_OUT_PLAUSIBLE` ways-in from its official page rather than an identified named lead - contrary to the issue's initial hypothesis that Beinecke units would clear the identified-lead gate like Peabody's curators-in-charge.

Sibling museum/collections acquisition gaps remain open follow-ups once these pilots prove the path, each its own issue:
Yale University Art Gallery and Yale Center for British Art curatorial departments.
The reserved `COLLECTIONS_INITIATIVE` sibling now has a producer via the `library-collections-as-data` source below (#1360).
This note sits alongside the digital-humanities `DIGITAL_HUMANITIES_PROJECT` pilot follow-up tracked in issue #1345.

### Collections-as-data research homes

The `library-collections-as-data` source is the pilot producer for the collections-as-data / digital-scholarship research-home type `COLLECTIONS_INITIATIVE` (issue #1360).
It enumerates Yale University Library online exhibitions through the Omeka sites API (`onlineexhibits.library.yale.edu/api/sites`) only to discover exhibitions, then cites each individual exhibition page (for example `https://onlineexhibits.library.yale.edu/s/prospectsofempire`), never the sites index or the browse landing site, per the self-referential and index-page source guards (#516/#549).
It is discovery-only: it emits exhibition identity, the official-page summary as a description, and, where an exhibition publishes a "curated by" credit, the named curator as an entity-level `inferredDirector*` observation, reusing the existing `materializeInferredDirectorMembership` path so the curator is resolved to a unique Yale User before any lead is written and no new access logic is introduced.
It fails closed on contact data and never emits contact routes, undergraduate-access claims, or posted openings; an exhibition with no unambiguous curator credit yields no lead rather than a fabricated one.
A faculty-curated exhibition whose lead resolves lands on the identified-faculty-lead ways-in; a librarian- or externally-curated exhibition whose lead does not resolve still earns an organizational ways-in from its official page, because `COLLECTIONS_INITIATIVE` is an organizational research home (`ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES`).

Sibling collections/archive acquisition gaps remain open follow-ups once these pilots prove the path, each its own issue:
Yale University Art Gallery and Yale Center for British Art collections.
This note sits alongside the DHLab `DIGITAL_HUMANITIES_PROJECT` pilot (#1345), the Peabody `ARCHIVE_OR_MUSEUM_PROJECT` pilot (#1349), and the Beinecke `ARCHIVE_OR_MUSEUM_PROJECT` pilot (#1457).

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
