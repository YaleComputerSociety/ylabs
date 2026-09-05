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
- A lane that fetches a URL **discovered on a page** must establish that the fetched page is about the same subject before merging anything from it.
A host-level allowance is not enough: `sameOrSubdomain(host, 'yale.edu')` admits `medicine.yale.edu/about/`, which declares the dean, and #2385 attributed four departmental sites to one dean that way.
The check is whether the fetched page belongs to the subject the row is about, not whether a page was found - on a roster both the shared roster page and the chair's profile are "found".
`dept-faculty-roster` uses `profileBelongsToRosterPerson`: require a shared surname token with the page's declared name, and on a mismatch **keep the citation and drop only the enrichment**, because the citation is separately verifiable while the enrichment carries the wrong-person payload (name for placeholder rows, plus gap-filled title, email, bio and `researchAreas`).
A shared given name is not enough - "Nancy Ruddle" and the dean's "Nancy Brown" share `nancy` - so anchor identity on the surname token, and fold accents before tokenizing so an accent-rendering difference between roster and page does not read as a different person.
When the page declares no name at all, require positive evidence instead of enumerating section words: the URL's own slug or host label names the person (`/people/robin-roster`, `konezny.sites.yale.edu`), or the URL has the person-scoped shape `isPersonProfileOrDirectoryUrl` accepts.
That keeps an opaque leaf (`/profile/pf93/`) as absence of evidence rather than evidence of another subject, while refusing a department landing page (`/psychiatry/`) that no denylist of section words could enumerate.

## Infrastructure files

- `cli.ts` - CLI entrypoint (`scrape run`, `scrape materialize`, `scrape report`, etc.)
- `orchestrator.ts` - `ScraperOrchestrator` runs one named source per `run(name)` call: it resolves the source, opens a `ScrapeRun`, runs the scraper, and persists `Observation` rows as they are emitted. It is single-source by design (materialization is a separate step); the sweep runs many sources by spawning one subprocess each, not through an in-process loop here.
- `registry.ts` - registers all source scrapers
- `scripts/runScraperSweep.ts` - two sweep engines sharing one substrate (`scrape:sweep --mode=<mode>`). The research engine (`RESEARCH_SWEEP_SOURCES`, the `development-*` and `beta-*` modes) writes `ResearchEntity` for `/research`; the fellowship engine (`FELLOWSHIP_SWEEP_SOURCES`, the `fellowship-development-full` mode) writes `Fellowship` for `/programs`. `validateScraperSweepManifest` asserts every registered source is in exactly one engine except the manual-only `undergrad-fellowships-recipients` (`MANUAL_ONLY_SWEEP_SOURCES`); `department-undergrad-research` dual-writes but lives in the research engine because access-evidence is research-side (#2172). Each engine spawns one fault-isolated `scrape run --source <name>` subprocess per source, grouped into ordered phases (`identity`, `discovery`, `funding`, `relationships`, `content-access`; the `scholarly` phase is a reserved value in the type union with no active source) with bounded per-phase concurrency (the LLM phases capped at 2), then runs its own post-run stage chain. The research chain is a single declarative registry, `DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS`: each stage owns its command, args builder, enable predicate, and optional typed result contract, and both the plan builder and the runner derive from it. A stage that declares a result contract but exits successfully without a readable, valid result artifact fails loud rather than silently dropping its delta (#2050). The optional `researcher-dedupe`, `eponymous-fra-merge`, `url-identity-dedupe`, and merge-residue-deletion stages are each gated by a distinct `SCRAPER_SWEEP_*` env flag. The fellowship chain is `FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS`: it wires the existing `programs:*` backfills (apply) plus the `programs:audit-*` reports (report-only), and holds every `--output` stage to the same report contract (a successful exit with no readable JSON report fails loud; a stage that writes no report records no `artifactPath`). Two stages are opt-in and off by default: `official-sources-backfill` (`SCRAPER_SWEEP_APPLY_OFFICIAL_SOURCE_CHANGE_SET`, because with no `--input` it replays a committed one-shot curated change-set that would overwrite freshly scraped `sourceUrl` values) and the beta/prod-only `catalog-refresh` (`SCRAPER_SWEEP_REFRESH_FELLOWSHIPS`, which skips with a logged reason unless the requested target matches the sweep mode's own target, so opting in during a Development sweep cannot fail the sweep). All `SCRAPER_SWEEP_*` stage flags in both engines parse through `scripts/sweepStageFlags.ts` so their truthy and falsey vocabularies are identical. The sweep is resumable and observable (#2182): every source step and post-run stage is tracked in a durable checkpoint JSON at `<os.tmpdir>/ylabs-sweep-checkpoint-<mode>-<worktree-fingerprint>.json` written atomically after each `pending -> running -> done|failed` transition, so a plain re-invocation resumes (skips `done` steps, reuses the same output directory, re-runs the rest) and `--restart` wipes it. Resume is deliberately conservative, because a `done` marker alone is not evidence the work is still valid: the checkpoint key is scoped to the repo root so parallel worktrees never share one; the recorded flag set (`--force-llm`, `--prune-between-phases`) must match or the sweep starts fresh over the same path; on a matching-flag resume candidate a live owner pid with a `running` step refuses the start instead of interleaving two writers (the flag comparison runs first, so a flag-set change replaces a live checkpoint rather than refusing); a `done` step whose artifact is missing or invalid re-runs rather than reporting an empty delta as success (the #2050 contract holds on the resume path too); and if any source step is not `done` in the checkpoint, every `stage:` entry is cleared so the whole-database post-run chain re-runs over the new data instead of a resumed sweep reporting green with a re-fetched source missing from the projections or the Meili index. `docs/research-data-pipeline.md` owns the exact resume rules and their limits. Alongside `summary.json` it writes `runner.log`, `errors.log` (each failure's step id, exit code, and a bounded, `sanitizeLogValue`-scrubbed captured-output tail), and per-step `.log` files. `--force-llm` (off by default) threads `--force-llm` into every per-source `scrape run` child for a full LLM re-derivation, and `--prune-between-phases` (off by default) runs the gated `observations:prune-dead` between phases and as a final `dead-data-prune` post-run stage in both engines, restricted to the Development-database write modes (`isDeadObservationPruneSweepMode`), so a `--force-llm` run holds storage headroom without a separate watchdog and no Beta or Prod sweep ever deletes mid-run. Checkpoint and logging modules live in `scripts/scraperSweepCheckpoint.ts` and `scripts/scraperSweepLogging.ts`.
- `scripts/pruneDeadObservations.ts` (`observations:prune-dead`) - committed, gated dead-data prune reused by the sweep and runnable on demand. Deletes observations that are both superseded and unreferenced regardless of age (reusing `observationRetention.ts`: `buildSupersededObservationPruneFilter` with `cutoff = now`, plus `buildObservationReferencePipeline` over `OBSERVATION_REFERENCE_SPECS` to protect referenced ids) and can optionally drop the `scrape_snapshots` cache with `--drop-snapshot-cache`. Dropping the age floor does not drop run retention: it still keeps the last 3 runs per source (`keepRuns`, override with `--keep-runs=<n>`), because `supersededBy` protects only the newer target and the older predecessor is what `undergraduate-logistics-rollback` restores; `--keep-runs=0` explicitly forfeits claim-local rollback. Dry-run first; `--apply` requires `--confirm-prune-dead-observations` and routes through `applyObservationPruneEnvironmentGuards`, so env/Mongo-target coherence is enforced and a resolved production environment is blocked unconditionally, not merely when the database name looks production-like.
- `scripts/orphanObservationKeyAudit.ts` (`observations:audit-orphan-keys`) - read-only category split for live `researchEntity` observation keys that match no `research_entities.slug` and no `research_entity_redirects.mergedSlug` (#2383). Join on `mergedSlug`; there is no `fromSlug`, and ignoring the redirect table inflates the Development population from 1,508 keys to 1,931. It reports `category` (what the lane is) and `materializationReach` (whether materialization ever ran) as independent axes, because `materializeFromRun` is scoped to one `scrapeRunId` and is called only after the orchestrator returns, so an interrupted or failed run strands its observations permanently with no corpus-wide pass to recover them. Never prune a stranded lane before checking that axis, and never treat a redirect backfill as the safe default: a redirect turns a dormant lane into an active writer into the canonical, which is the #2378 graft channel. `docs/research-data-pipeline.md` owns the taxonomy and the per-category remedies.
- `scripts/catchUpMaterializeStrandedKeys.ts` (`observations:catch-up-materialize`) - the corpus-wide catch-up materialize that `materializeFromRun` cannot be (#2403). Enumerates by KEY rather than by run, taking its population from the #2401 audit and its eligible set from `ORPHAN_CATEGORY_REMEDY` so neither can drift. Routes every key through the ordinary `materializeEntity('researchEntity', { entityKey })` path so all existing guards still apply; it is not a new write path. Dry-run by default, `--apply` plus `--confirm-catch-up-materialize`, `--limit` bounded, `--category` refuses an ineligible category rather than ignoring it. A guard skip and a zero-field write are reported separately, because only the second is a defect. On Development all 560 eligible keys plan to mint (551 `FACULTY_RESEARCH_AREA`), about +8.7% on a 6,440-row corpus - guard acceptance is not evidence a row should exist, since `dept-ysph-*` enumerates staff and trainees too. `docs/research-data-pipeline.md` owns the contract.
- `observationStore.ts` - writes `Observation` rows. Supersession keys on `observationFingerprint`: a new observation supersedes prior non-superseded ones with the same fingerprint. Fingerprint = `(sourceName, entityType, entity, field)` and, for most fields, `value`. Fields in the authoritative `LATEST_WINS_FINGERPRINT_FIELDS` constant omit `value`, so a fresh snapshot supersedes the prior one despite content drift. Fellowship observations also omit `value` because the sole fellowship producer emits one source-owned snapshot row per (entity, field) per run. Only use latest-wins semantics when no source emits multiple rows per (entity, field) per run. Latest-wins for the guarded prose fields (`fullDescription`, `shortDescription`) has one exception: `isRegressiveProseRefresh` drops an incoming prose observation that is not useful (per `researchEntityDescriptionQuality`) when an existing active same-(source, entity, field) observation is useful, so a re-run that degrades to a flagged/unusable description can never supersede a previously clean, source-backed one (#2028). Clean-to-clean refreshes are guarded too as of #2232: `isWeakerProseRefresh` additionally drops an incoming prose value that IS useful but scores strictly lower than the clean incumbent on `prosePreferenceScore`, and `collapseLatestWins` applies the same comparison so the preference also holds under `C4_LOSSLESS_INGEST`. Ties pass, so a same-quality refresh keeps newest-wins and the corpus cannot freeze on its first capture. `docs/research-data-pipeline.md` owns the scoring rules and their rationale: which demotions `prosePreferenceScore` sums, why the kind-aware person-centric term and `researchSubjectSpecificityScore` are excluded, and why the collapse folds each key's rows oldest-first.
- `observationFieldSanitizer.ts` - shared ingest-time extraction sanitizer applied by `observationStore.appendObservations` to every observation from every source, so no scraper (present or future) can leak page furniture into a stored field (#1375).
  It composes the existing hygiene utilities rather than restating their rules:
  - a `user` `title` runs through `sanitizePersonTitle` (rejected when it is nav/section furniture);
  - a research-entity `name`/`displayName` is normalized and rejected when it is nav chrome, a section label, placeholder filler that identifies nothing (`isPlaceholderEntityName`: "n/a", "none", "unknown", "TBD"), a glued contact or street-address fragment, or literal HTML. The filler class is refused here, at the all-source choke point, rather than per source: #2367 had it guarded only inside the lab microsite extractor and a record reached students storing `name: "n/a"`. Extend the vocabulary in `isPlaceholderEntityName` (`utils/researchHomeNameIdentityAuthority.ts`), never in a scraper;
  - research-entity `researchAreas`/`topics`/`researchInterests` lists drop label/section leakage element-wise (rejected when nothing survives);
  - `fullDescription`/`shortDescription` are chrome-stripped and contact-redacted (rejected when only chrome remains);
  - the undergrad/contact evidence-quote fields are contact-redacted.
  Type-overloaded fields are scoped by `entityType` (a fellowship/paper `title` is a proper name, not a role, so the person-title cap never fires on it), and structured identifier fields (URLs, ids, enums, and the `email` kept for internal contact derivation) pass through untouched.
  This is the ingest half of the ingest/serve/coverage data-integrity triad (#1374 owns serve-time, #1376 owns coverage); the person/entity identity resolver half is already hardened in `personProfileEntityMatch.ts`/`piNameMatch.ts` (#562/#981/#1045/#1110).
  Name IDENTITY, as opposed to name hygiene, is judged one layer later, because it needs the target record and this sanitizer only sees the value.
  `personScopedResearchEntityNameNamesSomethingElse` in `utils/researchHomeNameIdentityAuthority.ts` refuses a person-scoped record's `name`/`displayName` when the value names an umbrella organization the person merely belongs to, or another person's lab, and it runs at three choke points rather than inside any one scraper: `projectFromLog` in `entityMaterializer.ts` at materialize, `sanitizeServedResearchEntityCopyFields` in `utils/researchEntityDescriptionText.ts` at serve (which is what covers the detail DTO, the summary DTO, saved-plan cards, and profile research-home lists at once), and `researchEntitySearchIndexService.ts` when building the Meilisearch document (#2234/#2351).
  `isPlaceholderEntityName` runs at all three of those choke points too, plus at ingest, so filler is refused on the way in, cleared off an already-stored document at materialize, withheld from the served `displayName`, and dropped from the searchable index document; keep the four in one vocabulary (#2367).
  Add the guard to the shared serve sanitizer rather than to one DTO: the saved-plan and profile paths build their own summaries and would otherwise keep titling their cards with the retired graft.
  `researchEntityDto.ts` applies the same predicate again on its own `displayName` accessor; the guard is idempotent, so the second pass is a fail-safe for a DTO input that never ran the sanitizer rather than a second policy.
  The materialize stage judges the EFFECTIVE served value (`set ?? entityDoc`), not only a freshly resolved one, so a graft heals on the next pass even when no observation resolves that field; that matters because retiring a graft observation never rewrote the document and no faculty-directory source emits `displayName`, which left 26 person-scoped records serving names whose observations had already been rolled back.
  Every candidate is judged against its OWN provenance `sourceUrl`, never the outgoing value's, because the foreign-lab rule needs the URL the candidate itself came from.
  `displayName` clears on failure since every serve path falls back to `name`; `name` only ever moves to a ranked candidate that also passes, so a record is never left nameless.
  A refused `name` with no passing candidate is therefore kept, and the `unusable_name` hard blocker in `studentVisibilityTier.ts` is what holds it at `operator_review` instead of serving it (see `docs/student-ready-definition.md`).
  `preferGenuineEntityNameGroups` in `confidenceResolver.ts` also treats filler as a low-quality name group, so it neither wins the field nor counts as the microsite brand that suppresses every roster candidate; without that the ranked list is empty and the materialize repair has nothing to fall through to, so extending `isPlaceholderEntityName` without it would make a stored placeholder hand-fixable only (#2367).
  Identity from a slug is weaker than identity from a lead's `personName`: slug tokens are topical, so a slug token only clears an organization name when it stands in the eponym position (`Rooney Center for ...`), never by bare word overlap (`cancer` in both `cancer-research-lab` and `Yale Cancer Center`).
  Refusing the link is only half the answer, because the profile slot is usually the corpus's ONLY edge to that lab, so dropping it leaves the real lab with an empty `websiteUrl` and no searchable name of its own (#2385).
  `observations:retarget-foreign-lab-websites` re-homes it instead: `labSiteDeclaredLeadExtractor.ts` asks the lab site who leads it, `utils/foreignLabWebsiteRetarget.ts` decides where the site belongs, and the website, its `sourceUrls` entry, and the site's branded name move to that lead's research home.
  Prefer the site's own declared lead over any name-shape heuristic here: a topical lab name ("APOLLO Lab", "Belief Lab") carries no person token at all, so name plus URL cannot tell a person's own lab from a collaborator's, and only the site can.
  A re-homed site gives back everything it wrote, not only the website: once it declares somebody else's lead it cannot describe this record either, so its description, methods, and undergrad evidence are retired with it and each field falls back to the newest surviving observation from another source rather than being blanked.
  Every step fails closed - an unresolved holder lead (never approximated from slug tokens, per #2384), a lead with no research home, an ambiguous lead, or a target that already states its own website all decline to move anything - because a wrong move grafts the same content onto a second innocent record.
- `entityMaterializer.ts` - derives `ResearchEntity`/`RoleAssignment` (the canonical roster; replaces the retired `ResearchGroupMember`).
  - `materializeInferredPiMembership` (labs, from grant-inferred PI keys) and `materializeInferredDirectorMembership` (organizational homes, from `center-director-llm`'s entity-level inferred-director observation) attach the entity **lead**.
  Each resolves the name to a canonical `Researcher` via `resolveResearcherIdForPersonName` (`researcherPersonNameResolver.ts`), and upserts a `PI`/`DIRECTOR` `RoleAssignment`.
  Promoting a director also lets the access materializer upgrade an organizational home from its "no named director" `DEPARTMENT_CONTACT` fallback to a named-lead `FACULTY_PI` ways-in on the same pass.
  - `inheritSchoolFromLeadPi` runs immediately after lead resolution on the same pass and fills a school-less entity's `school` (and `departments` when it has none) from that single lead's canonical department `OrgUnit`, fail-closed and provenance-stamped; the contract lives in `docs/research-data-pipeline.md`.
  - Official roster rows use stable profile identity and membership keys.
  Only a complete non-empty snapshot archives disappeared source-owned rows; failed, empty, partial, stale, or withheld snapshots preserve current history.
  - `materializeUserIdentityToResearcher` (directory/user identity enrichment) must not let one bad source row abort the rest of the source run: over-long resolved `profile` text is clamped to that field's own `researcherDisplayProfileSchema` `maxlength` instead of throwing a validation error, and an ORCID or netid another `Researcher` already holds is yielded to that holder with the enriched researcher's prior identifier restored and a conflict counted (the identity contract, including which netid may be stamped and when the observed email may join identity, lives in `docs/research-model.md`).
  Read bounds from the schema; never re-declare them here or in the materializer.
  It also replaces a stored `YALE_OFFICIAL` `profileLinks[]` entry when the composed official link supersedes it (`supersedesOfficialProfileUrl`), so a stored link is not append-only; `docs/research-data-pipeline.md` owns that supersession rule and its repair command.
  - After field resolution and canonicalization it derives `websiteUrl`, reusing `resolveBackfillWebsiteUrl` from `scripts/backfillResearchEntityWebsiteUrlsCore.ts` (the #404 backfill core) so every exclusion rule and the never-overwrite-a-usable-value rule stay single-sourced.
  A source-observed `websiteUrl` always wins.
  - The URL-exclusion rules are enforced by exported predicates rather than a frozen list here; consult those functions for the authoritative patterns.
  Listing/index and faculty-directory roster roots are rejected by `isListingOrIndexUrl` (whose directory-loader arm is `isDirectoryLoaderUrl` and whose faceted/section-index arm is `isFacetedOrSectionIndexUrl`), while a genuine single-person profile or named directory slug is kept as a PI fallback only when the entity does not already cite that same destination in its own `sourceUrls` (#549/#556/#560/#569, #2352).
  Generic CMS/platform boilerplate hosts are rejected by `isBoilerplatePlatformHostUrl`, the sibling arm of `isDisallowedResearchEntitySourceUrl` (#572).
  Roots of shared academic hosts that publish one page per tenant under `~user` are rejected by `isMultiTenantAcademicHostRootUrl`, because such a root names the host organization rather than the tenant being resolved: `csl.yale.edu` is the Computer Systems Lab, a cross-department umbrella whose people page lists 13 faculty, and its root was serving as one professor's lab website (#2359).
  The host lookup normalizes a leading `www.` away, so an alias root cannot slip past it.
  Only the root is rejected, so a `~user` tenant page stays promotable: `isMultiTenantAcademicHostTenantPageUrl` is what carries it through `sourceUrlToResearchHomeWebsiteUrl`, which otherwise rejects every multi-label Yale host such as `gauss.math.yale.edu`.
  The rejection is skipped for the host organization's own entity, judged by `researchEntityOwnsMultiTenantAcademicHost` from the entity's own name, so the Computer Systems Lab entity keeps `csl.yale.edu/` instead of being stripped along with its tenants.
  Stored roots are repaired by the website-url backfill, whose selector matches `MULTI_TENANT_ACADEMIC_HOST_ROOT_URL_PATTERN`, and suppressed at read time in `researchEntityDto.ts` until it runs.
  File-share and direct-document links (Drive/Docs, Dropbox, Box, OneDrive, bare office/PDF paths) are rejected by `isFileShareOrDocumentUrl`, which also short-circuits `sourceUrlToResearchHomeWebsiteUrl` and the `isPromotableWebsiteUrl` path so a dead share or stray `.pdf` can never become the "Visit lab website" CTA (#730).
  An existing `websiteUrl` that is a listing page or a file link is re-picked to a genuine research home when evidence has one, and otherwise cleared (fail closed to no website, #510/#518/#730).
  A profile-page `websiteUrl` with no research home in evidence is cleared when the entity already cites that same destination in `sourceUrls`, so a PI profile page stops being served as both the "Website" CTA and the official-profile CTA (#2352).
  The citation match folds scheme, `www.`, trailing slash, and case (`normalizeWebsiteUrlIdentityKey`), and it ignores citations the detail page refuses to render - the legacy `website` field and department-roster provenance pages (`isDepartmentRosterProvenanceUrl`, mirrored from `client/src/utils/researchDetailSources.ts`) - so clearing never leaves an entity with no link at all.
  `websiteUrl` derivation runs after the #613 lead-profile `sourceUrls` projection on the same pass, so a freshly projected profile citation is visible to the clear decision immediately instead of one materialization later.
- `canonicalResearchHomeResolver.ts` - lets NIH, NSF, and DOE grant sources enrich one existing official research home for an unambiguous PI. It permits a synthetic shell only when no research-home membership exists, and fails closed for ambiguous identities plus archived, non-current, or grant-only candidates.
- `orgUnitCanonicalization.ts` - ingest-time department/school canonicalization.
  `entityMaterializer` calls `applyResearchEntityOrgUnitCanonicalization` to rewrite a research entity's `school` and `departments[]` to canonical `OrgUnit` names using a deterministic normalized-name/alias match (`orgUnitMatchKey` reuses `slugify` and collapses "Department of X"/"X Department" qualifiers).
  `departments[]` **fails closed against the catalog**: only a value that resolves to a `DEPARTMENT` or `DIVISION` `OrgUnit` becomes a department, because the field is a browse facet and a facet value is an assertion about Yale's org chart (#2194).
  Sources hand over one flat list of everything near a person's appointment - a real department, a clinical section, a center, a hospital system, a graduate program track, a donor society, sometimes a lab name or a job title - so a kept-raw value made `Yale Medicine` (346 served rows), `Yale New Haven Health System` (314), and `Yale Ventures` (290) outrank `Internal Medicine` (298) at the head of the facet.
  Everything that is not a canonical department moves to `orgAffiliationLabels[]`, which is in `searchableAttributes` but deliberately not in `filterableAttributes`, so those names stay findable by search without being offered as a department.
  The `school` scalar still keeps an unresolved value raw: `Yale West Campus` is the corpus's only non-canonical school, and 22 of its 26 entities have no other school or department, so failing it closed would remove them from both facets (#2277).
  - Two student-facing-quality passes run first: `isDroppedAdministrativeOrgUnit` removes reviewed administrative/non-research units (the `ADMINISTRATIVE_ORG_UNIT_VALUES` denylist: Provost/FAS-admin/`NONE`/all-caps division buckets), and `denoiseOrgUnitValue` strips an opaque leading Yale HR org code (e.g. `MEDCCC Medical Oncology`) so the affiliation label reads clean.
  - A School/Department boundary guard drops any `departments[]` entry that resolves against the `SCHOOL_KINDS` index `canonicalizeSchool` uses (e.g. `Yale School of Medicine`/`YSM` leaking into `departments[]`), rather than affiliating it, because the school facet already carries it; it reuses the existing resolver/index and is distinct from the admin-code drop (#837).
  - Fail-closed is suspended when the resolver index carries no department rows at all, so an unseeded or half-restored `org_units` collection degrades to keep-raw instead of emptying `departments[]` corpus-wide.
  - The canonical `OrgUnit` set is seeded from an org-unit ground-truth list (Yale schools + the reused department ground truth, plus an `orgUnitAliasOverlay` mapping HR-coded/all-caps variants onto canonical units).
  `org-units:seed-catalog-gaps` (dry-run-first, `--confirm-org-unit-seed`) is the checked-in, idempotent closer for gaps the curated `DEFAULT_DEPT_CONFIGS` roster map asserts: every row it adds cites the roster config that justifies it, so the catalog never grows on recollection of Yale's org chart.
  - `org-units:department-facet-audit` is read-only and ranks the labels sources presented as departments that no `OrgUnit` names, by served-row count.
  Most are legitimately not departments, so it is catalog debt to triage by volume rather than a count to drive to zero; a label stops appearing once a catalog row covers it.
  - `research-homes:backfill-org-units` (dry-run-first, `--confirm-org-units`) re-applies canonicalization + admin-drop across the corpus and writes `orgAffiliationLabels[]`; rebuild the Meilisearch index afterward so the `school`/`departments` facets pick up canonical values. Seed/apply on real data is human-gated.
  - Facet display is finished client-side by `client/src/utils/departmentNames.ts`, whose abbreviation-prefix stripper only fires on a spaced `ABBR - Name` separator so plain hyphenated names (`RADIATION-DIAGNOSTIC/ONCOLOGY`) are never truncated.
- `researchAreaCanonicalization.ts` - ingest-time research-area canonicalization.
  `entityMaterializer` calls `applyResearchEntityResearchAreaCanonicalization` to rewrite `researchAreas[]` to canonical `TaxonomyTerm` (`taxonomy_terms`) names using a deterministic normalized-name/alias match (`researchAreaMatchKey` reuses `slugify`).
  Only approved terms canonicalize: the resolver reads active, non-archived `TOPIC`/`METHOD` terms with `reviewStatus: APPROVED`, so seeded-but-unratified groupings stay `UNREVIEWED` and inert until a human approves them (issue #208 option A - the registry never becomes a `ResearchEntity` reference; areas stay canonical strings).
  It **fails closed**: an unresolved value is kept as its raw string, never guessed, so a guess can never collapse two distinct topics.
  - A scraper-label stop-list (`isResearchAreaLabelLeakage`) drops non-topic extraction artifacts (section headers, role/status labels, publication chrome) so they never become an area or pollute the review queue.
  Its `isNonTopicResearchAreaChip` arm additionally rejects only unambiguous non-topics that can leak public PII or prose (protocol/HIC/IRB ids, publication URLs, list markers, person-award lines, leading-lowercase prose, sentence fragments, first-person bio prose, lab-blurb sentences, and run-on multi-topic concatenations >= 15 words) while preserving legitimate multi-word topics below that ceiling so no real area is dropped (#624/#948).
  A companion repair in `stripResearchAreaSourceChrome` strips a stray leading coordinating conjunction (`and Optical Physics` -> `Optical Physics`) so a split fragment is fixed rather than dropped (#948).
  - The registry was originally seeded from the research-area ground truth; approved rows canonicalize immediately and candidate rows land `UNREVIEWED`.
  - **`taxonomy_terms` now has a reader but no writer.** `data-migration/seedTaxonomyTerms.ts` was the only writer and was deleted with the whole `data-migration/` package in #2186, so nothing in the repository can seed the registry or promote a term's `reviewStatus`.
  Two consequences follow.
  First, the approved vocabulary is frozen at whatever an environment already holds (Development: 5,291 terms, 638 `APPROVED`, verified 2026-08-29), so `research-area-source-extractor` can never widen beyond those 638 terms and the 4,653 `UNREVIEWED` rows are unreachable.
  This is a known, accepted limitation rather than a defect.
  Second, and this is a hard precondition: **seed `taxonomy_terms` before any sweep against Beta or a fresh environment.** Beta was empty (0 collections) as of 2026-08-29.
  On an unseeded registry `research-area-source-extractor` is fail-closed and emits nothing at all, and every other source's `researchAreas[]` passes through raw and un-canonicalized, which degrades silently rather than failing the run.
  Re-seeding needs a new wired command under `server/src/scripts/`; #2186 recorded that gap without filing it.
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
- `utils/hostConcurrencyLimiter.ts` - the single per-host slot-and-spacing core (`HostConcurrencyLimiter`) plus the `HOST_THROTTLE_OVERRIDES` map.
  Both fetch paths share this one core: the axios request interceptor that gates the `renderedFetch`/sweep path, and `httpFetch`'s `HostRateLimiter`, which delegates its per-host slot and spacing here rather than reimplementing them.
  Keying is by lowercased `hostname` (`hostnameForLimiter`), so an explicit port never splits a host's budget or bypasses its override.
  `resolveHostThrottle` only ever tightens the caller's base throttle (lower concurrency, longer interval), so an override can never loosen what a caller asked for, and an operator raising `SCRAPER_PER_HOST_CONCURRENCY` cannot lift an overridden host's cap.
  `medicine.yale.edu` and `ysph.yale.edu` are empirically rate/concurrency throttled, not IP-banned: a 403 storm at high concurrency recovers instantly on the next single request, whereas a ban would persist.
  Both are therefore pinned to concurrency 2 with a 400ms minimum inter-request interval, which measured clean across a 60-profile batch, and that unblocks direct YSM scraping (`ysm-faculty-directory` and the medicine-hosted lab-microsite fetches).
  Add a further rate-limited host by adding one entry to `HOST_THROTTLE_OVERRIDES`.
  Absent an override, the sweep path leaves a host at `DEFAULT_PER_HOST_CONCURRENCY` with no spacing, while the `httpFetch` shared limiter already defaults *every* host to concurrency 2 and 400ms, so on that path these two overrides only matter when a caller passes looser `HostRateLimiterOptions`.
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
| `departmentRosterScraper.ts` | Department faculty roster pages and official-profile enrichment. Mints a research home when the roster row has an off-directory lab website (`LAB`) **or** when it has no lab website but its own official profile carries research evidence (a useful grounded description or research interests), in which case it mints a lab-less `FACULTY_RESEARCH_AREA` citing that profile page, mirroring `ysm-faculty-directory` (#1933). Requiring a lab website was why the School of Art and the School of Architecture materialized almost nothing: their faculty publish research on their own profile and run no separate lab site, so 218 of 224 enumerated people were dropped before any observation was written (#2274). A lab-less mint never cites the shared roster listing root, never fires for a slug-placeholder name, and still respects `emitPersonalResearchEntities: false` and `officialProfileOnly`. |
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

### Museums, collections, and archives (retired, #2202)

This whole family was retired: `peabodyCollectionsResearchScraper`, `beineckeCuratorialUnitsScraper`, `beineckeCollectionsResearchScraper`, `yaleCenterBritishArtScraper`, `yaleUniversityArtGalleryScraper`, `libraryCollectionsAsDataScraper`, and `dhLabProjectsScraper`, together with the `ARCHIVE_OR_MUSEUM_PROJECT`, `COLLECTIONS_INITIATIVE`, and `DIGITAL_HUMANITIES_PROJECT` entity types.

They were discovery-only by design (identity plus an official-page description, fail-closed on contact), and that is exactly why they failed the student: an unled unit still reached `student_ready` on an organizational ways-in with no lead, no roster, no affiliated-lab edge, and no contact email.
Do not reintroduce a discovery-only lane whose output cannot route a student to a person or to a lab.

### Undergraduate programs, courses, fellowships, and postings

| Scraper | Data |
|---------|------|
| `departmentUndergradResearchScraper.ts` | Department-level undergrad research opportunity/program pages. |
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
| `labMicrositeDescriptionLLMExtractor.ts` | Research-home description extraction from microsites: prefers the home's own official prose (JSON-LD, meta, About/Overview body) extracted deterministically, and falls back to verbatim LLM extraction gated by a deterministic grounding check. It also crawls the site's own research page (`researchSubPageCrawlUrls`, same-host, published anchors only, never blind path probes) because a home page often carries only a mission or welcome blurb while `/research` carries the research prose. A crawled page may only ADD a description or replace an off-topic one: it must score strictly better than the primary page's own candidate (`scoreResearchHomeDescriptionCandidate`), and an off-topic crawled candidate is discarded outright. Ties go to the primary page. This conservatism is load-bearing - a dry-run over the 504 homepage-sourced entities showed that preferring a research page whenever one exists regresses about a third of them onto figure captions, single-project leads, textbook background, and CV/contact blocks (#2176). A primary page that is a JS shell yields no candidate at all, and a crawled page must not win that comparison by default: when the primary page has neither deterministic prose nor groundable LLM prose, a crawled page may only FILL a description, never replace a stored one worth keeping, where "worth keeping" means the stored text clears the selection floor itself (at least 120 characters and `describesResearchHome`), so stored directory-index chrome or a stored figure caption stays replaceable (#2180). |

#### Measuring a description-prompt change before shipping it

`yarn --cwd server scraper-llm:description-ab` (`server/src/scripts/descriptionPromptAbHarness.ts`) A/B tests a candidate extraction prompt against the live one.
Read-only against Mongo, writes only its report.
Both arms run against identical cached page text, so the prompt is the only variable.
Candidate prompts live inside the harness, never in `src/scrapers/prompts/`, so measuring one never changes what the sweep runs.
Everything around the prompt must stay production-identical or the guardrail rates describe nothing: the sample picks its page through `candidateDescriptionLabsFromDocs`, resolves person-vs-organization identity through `isFacultyResearchTextEntity` with both `entityType` and `kind`, and redacts contact details before the call exactly as `defaultCallLLM` does.

Keep the metric split it enforces: grant corroboration and blind pairwise preference are win metrics, while non-empty rate and grounding rate are guardrails.
A stricter prompt can always look better by blanking the corpus, so a run that improves the win metrics while collapsing coverage is a failed run.
Include the regression anchors (`dept-mcdb-valerie-horsley` for #2176, `dept-seas-michael-hatridge` for #2180) and look them up by slug only: Horsley is `archived` and Hatridge is `operator_review`, so filtering the named sample by tier or `archived` silently drops both.

Prompt wording is not the lever for off-topic descriptions, and #2183 has the data.
A candidate that gated on a named research subject instead of on the page section the text came from changed 25 of 42 outputs while fixing none of its target cases, and its attribution judgement was unstable enough across runs to false-reject a known-good description.
Horsley's real prose sits on a subpage, and the parent-org cases turn on knowing which record is being extracted for, which the page text never states.
Test acquisition (which page is read) and record identity before spending a cycle on prompt text.
The scoring the rejected gate used survives in `server/src/utils/researchSubjectSpecificity.ts`, and nothing in extraction or serving calls it: it exists for the harness, so re-measure before wiring `judgeResearchSubject` into either path.

Do not add an eleventh source-type predicate to `researchEntityDescriptionText.ts`.
Across the served corpus the existing ten fire once in total, while fluent, well-formed, research-adjacent prose that names no subject passes all of them.
Source type is also the wrong axis: most served descriptions containing "Our Mission" name a real subject and are good, so demoting the category discards more good prose than bad.

#### FACULTY_RESEARCH_AREA descriptions are a synthesis problem, not an extraction problem

An FRA usually has no lab site, so its only source is the professor's official Yale profile page, and the main prose block there is a biography.
The description prompt requires an exact contiguous substring, so on a page where research is interleaved with credentials the only copyable span is bio-shaped.
That is why 464 served FRA descriptions read as person bios: a structural limit of copying, not a ranking bug.
A probe of 27 such profile pages found research prose on 27 of 27 and an appointment line on 27 of 27, while the deterministic extractor produced prose on 0 of 27.

`research-entity:fra-profile-synthesis` (`fraProfileSynthesis.ts`, the pure `fraProfileSynthesisCore.ts`, and the DB-facing per-entity step in `fraProfileSynthesisLane.ts`) handles this cohort.
It scopes to unlocked, non-archived `FACULTY_RESEARCH_AREA` entities whose stored description is a career biography and which have a `/profile/` source URL (checked per entity, so a `--slug` pointing at the LAB the same profile page also mints is skipped rather than written to), skips any entity that already has a recorded non-bio description that actually describes research, harvests research sentences from that page, strips career, credential, and navigation sentences before synthesis, reuses `synthesizeCoverageDescription` (passing `entityType` and `researchAreas` so the topic-label and area-echo quality flags actually fire), repairs orphan pronoun subjects, and fails closed when the output still reads as a biography or keeps a dangling pronoun.
Dry-run by default and needs `OPENAI_API_KEY` in either mode; apply requires `--confirm-fra-profile-synthesis`, `SCRAPER_ENV=development`, a Mongo URL whose database matches the configured development database name, and the `fra-profile-research-synthesis` source row already seeded (`scrape:seed-sources`).
Measured against the stored extract on 25 entities, bio signal fell from 100% to 10% with names-a-research-subject holding at 100% (#2200).

A synthesis lane cannot outrank a biography on confidence alone.
Every such lane deliberately ranks below official-profile extraction (0.55) so a genuine verbatim research statement still wins, but the bio it exists to replace is emitted by that same official extraction at 0.55 and re-emitted weekly, so weight alone leaves the replacement permanently losing.
`confidenceResolver` therefore sorts biography `fullDescription` value groups last (`demotePersonBioProseGroups`), mirroring how it demotes synthesized-source prose and bare person names.
That demotion has to stay at least as wide as whatever a bio-replacing lane selects on, so it treats a group as a biography when `isHighConfidencePersonBio` **or** `isCareerBiographyDescription` fires: while it keyed on person-voice shape alone, an endowed-chair or joined-the-faculty bio re-emitted weekly at 0.55 outranked the 0.48 replacement forever, so the lane reported success while the biography stayed served (#2200).
Two scoping rules keep that from re-ranking the whole corpus.
The demotion only fires when the useful non-bio alternative comes from a source in `BIO_REPLACING_DESCRIPTION_SOURCES`, because `isHighConfidencePersonBio` also flags genuine organization prose ("Professor Jane Doe's laboratory investigates ...") that several scrapers emit with no write-time bio guard, and a field-wide rule promoted a bare grant abstract over an authoritative official description on labs and centers this lane never touches.
The bio is demoted, never dropped: `entityMaterializer` walks the ranked list when its own content gates reject the winner, and removing the bio left that walk with no last resort and blanked descriptions that had been served.
A sole bio is still served rather than blanked, and a non-bio alternative that fails the quality bar never displaces one.
Do not "fix" a lane that cannot displace a bio by raising its confidence above official extraction; that trades a real verbatim research statement away.

Do not reach for the grant-corpus lane here: only 12 of the 464 bio-shaped FRAs have any grant at all, so #2191 reaches 3% of the cohort.

Traps this lane already paid for:

- Do not select rewrite targets with `isHighConfidencePersonBio`.
It is the right check on this lane's OUTPUT (a synthesized description should carry no person-voiced prose at all) and the wrong one for choosing what to rewrite: it fires on name-framed research prose that is already exactly what a student needs, over-reports roughly four to one on the served corpus, and scoping selection to it replaced 99 already-good descriptions on Development before they were reverted.
Select on career facts instead (`isCareerBiographyDescription` in `server/src/utils/careerBiographyDescription.ts`, which also owns the shared sentence splitter), and keep `confidenceResolver`'s bio demotion at least as wide as whatever that selector accepts.
- Do not gate on snippet count as a proxy for output quality.
A two-snippet floor skipped 6 of 12 entities in a dry run, most of which synthesized cleanly.
The precise control is the post-synthesis bio check.
- Repair orphan pronouns in **every** sentence, not just the lead.
Repairing only the first sentence left "Investigates histories of slavery and medicine. She directs a community partnership ..." on a real entity, moving the dangling pronoun out of view of the check rather than fixing it.
The pronoun-verb list is deliberately an allowlist of research-activity verbs: a general pattern would rewrite "She is a professor of history" into "Is a professor of history", laundering a biography past the bio check.
Because the allowlist is intentionally incomplete, repair cannot be the only defence: `hasResidualPronounLead` rejects any description that still opens a sentence with a pronoun, scanning the raw text as well as the split sentences so the defence does not depend on the splitter being perfect.
Keep the possessive and non-possessive patterns on one shared verb list; a verb present in only one of them is how "Her group leads ..." shipped intact.
- Split sentences with the abbreviation-aware `splitSentences`, never a bare `/(?<=[.!?])\s+/`.
A bare split cut "the epidemiology of HIV in the U.S. and develop statistical methods" into two sub-floor fragments and dropped both, reporting zero snippets for a page that plainly stated the research.
The abbreviation guard needs its own escape hatch for a capitalised pronoun on the right-hand side: the single-capital rule also suppressed the boundary in "the immunology of hepatitis C. She directs ...", hiding an orphan pronoun from both the repair pass and the residual check.
- Keep the `scraper-llm:fra-synthesis-ab` harness (`fraResearchSynthesisAbHarness.ts`) on the production pieces (`profileResearchSnippets`, `repairPronounLead`, `hasResidualPronounLead`, and the same `entityType`/`researchAreas` passed to the synthesizer).
When the arm is looser than the lane, its guardrail rate overstates coverage and its bio signal is measured on text the lane would never write.

The professor's appointment title is **not** stored structurally anywhere (`contactRole` and `contactName` are empty across the whole cohort), and extracting it by regex over flattened page text matches site navigation instead.
It survives only inside the profile-bio observation, which append-only storage retains after synthesis outranks it.
Capture it from a structured region before anything starts deleting bio observations.

#### Never roll back one description field alone

`fullDescription` and `shortDescription` are coupled through a materializer guard, and treating either in isolation blanks the other.
Any rollback or replacement of one must revert or re-derive the other in the same operation, then re-materialize.

The `winnerFullUseful` guard in `server/src/scrapers/entityMaterializer.ts` accepts a resolved winner only when `fullDescriptionQuality(...).isUseful` holds **and** `isFullDescriptionRestatementOfShortDescription(...)` does not, so a winner that restates the stored short is rejected and the ranked walk can end having written nothing.
The guard only clears `fullDescription`, which makes the failure invisible to the visibility gate: the short survives, the record looks complete, and the tier stays `student_ready` while the detail page serves no prose.

Attribution, not duplication, decides whether a pair is stable, which is why a source must never emit one string as both fields under two different attributions.
The `studentReadyDescription` emit block in `sources/labMicrositeUndergradLLMExtractor.ts` pushes one string as `fullDescription` and the same string again as `shortDescription` when it is card-length; both pushes share one `...base`, so the two rows carry the same `sourceName` and `sourceUrl`, the materializer reads the projected short as self-derived from the full, the guard is skipped, and the row keeps serving.
Re-attribute that same string across two URLs or two sources and the short reads as independent evidence, so the guard fires and blanks the full - and no data repair holds until the emitting source stops producing it.

`server/src/scripts/descriptionPairRollbackCore.ts` encodes the rollback contract (`descriptionPairObservationFilter`, `planDescriptionPairRollback`, `describeDescriptionPairRisk`); build any description rollback or repair from it rather than hand-writing the query or re-specifying the guard's predicates.
`docs/scraper-deployment-runbook.md` (`Rollback` -> `Rolling back a written description`) owns the operator procedure and the incident it came from.

#### Detecting grafted prose deterministically

Byte-identical `fullDescription` across more than one served entity is definitionally wrong for at least one of them, so it needs no sampling, no judgement, and no LLM spend.
On the Development corpus this found 39 entities across 15 groups, e.g. one PI's lab description propagating onto five lab members' individual records.
Treat it as a floor rather than a total: a center's description on a single person's row with no duplicate elsewhere stays invisible to it.
Three distinct upstream mechanisms produce wrong-attribution prose and a single repair lane will be designed for the wrong shape if they are conflated: an affiliated-center name taken as the entity name, group prose propagating onto members, and department boilerplate.

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
