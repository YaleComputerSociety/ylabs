# Current Execution Plan

## Objective

Continue autonomous roadmap execution from the highest-priority feasible non-production work without production writes, production copy, destructive actions, irreversible migrations, data deletion, or secret-dependent actions.

## Current Understanding

The active roadmap priority is the launch trust contract, Beta repair queue, and Beta data-trust blockers. Strict launch is safety-clean but incomplete: the refreshed artifact has 1,453 launch-eligible, 109 limited-but-safe, 1,046 held, 58 suppressed, 0 public visibility violations, and remaining lanes source/description 998, PI identity 65, action evidence 0, and review exceptions 92. Launch-trust deterministic repair-lane recommendations are dry-run-first and write JSON artifacts before any Beta apply decision. Scraper integrity now fails only on same-PI same-name research entities; duplicate exploratory pathways, duplicate research papers, duplicate access signals, and active artifacts on archived entities have been cleared. Production promotion is blocked on true production/external requirements: Atlas restore point, real Production guarded copy dry-run review, rollback-tested status, and production smoke verification. Codex autonomous operator owns routine gate coordination, routine smoke coordination, and routine dry-run review fields, but that does not verify the external production facts. No production write, production copy, retention apply, or recurring production scraper work should run in this plan.

## Files And Docs Read

- `AGENTS.md`
- `CLAUDE.md`
- `graphify-out/GRAPH_REPORT.md`
- `docs/tasks/priority-roadmap.md`
- `docs/product-context.md`
- `docs/research-model.md`
- `docs/decisions.md`
- `docs/codex-workflow.md`
- `docs/scraper-deployment-runbook.md`
- `server/package.json`
- `server/src/services/launchTrustContractService.ts`
- `server/src/services/__tests__/launchTrustContractService.test.ts`

## Milestones

- [x] Confirm the intended target is Beta/local validation without printing secrets.
- [x] Run read-only launch baseline commands against Beta.
- [x] Generate the current PI/action acquisition report.
- [x] Run dry-run repair lanes only if the report or roadmap indicates a possible deterministic candidate.
- [x] Update `docs/tasks/priority-roadmap.md` with current exact counts, blocker categories, and next action.
- [x] Run focused verification for changed scripts/docs when applicable.
- [x] Run `graphify update .` after durable doc changes.

## Progress Log

- 2026-05-29 00:00: Started autonomous roadmap continuation. Worktree was already heavily dirty across docs, client, server, Graphify, and untracked files; treat those as pre-existing and avoid reverting them.
- 2026-05-29 00:00: Read repo instructions, Graphify report, roadmap, product/model/decision/workflow docs, and command definitions. Selected launch trust contract/Beta repair queue as the highest-priority feasible work. Production promotion remains externally blocked.
- 2026-05-29 01:15: Confirmed target without printing secrets: `SCRAPER_ENV=beta`, Mongo host `yalelabs0.ilyce1q.mongodb.net`, database `Beta`, no Meili host configured in the current shell.
- 2026-05-29 01:15: Ran strict launch trust contract. It failed for completeness, not safety: 1,319 launch-eligible, 235 limited-but-safe, 1,010 held, 58 suppressed, 0 public visibility violations; research activity and paper quality passed.
- 2026-05-29 01:15: Ran `beta:data-quality --include-samples`. It was warn-only with 0 errors and 8 warnings: 5 source-health warnings, 6 duplicate normalized-name clusters, 680 missing short descriptions, 71 weak short descriptions, 741 without pathways, 594 without access signals, 1,404 without contact routes, and 1 synthetic `devadmin@example.invalid` account.
- 2026-05-29 01:15: Ran `scraper:integrity-gate --include-samples`. It passed with zero failures and zero warnings.
- 2026-05-29 01:16: Ran `launch:acquisition-report --stage=all --limit=250 --sample-limit=10`. It found 0 exact PI/user matches, 0 source-backed route materialization candidates, 62 missing official profile URLs, 21 ambiguous or mismatched user cases, 111 action rows with source observations but no undergraduate access evidence, and 82 with untrusted external route evidence.
- 2026-05-29 01:16: Ran `beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=500`. It scanned 500, attempted 500, repaired 0, blocked 500. No apply-mode repair lane is safe in this pass.
- 2026-05-29 01:17: Updated `docs/tasks/priority-roadmap.md` with the refreshed read-only baseline and ran `graphify update .`. No source code changed, so no unit test target was required.
- 2026-05-29 01:23: Completed the OpenAlex compact-retention dry-run against Beta only: `SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3`. Result: `apply=false`, `candidates=0`, `deleted=0`, `sourceName=openalex`, kept run ids `6a14da44040c7df99b78b403`, `6a0fb08f103539aa8880115d`, and `6a0fb053a957079343631be1`.
- 2026-05-29 01:24: Regenerated the five source-health warning reports under `/tmp/ylabs-scraper-reports/`. All commands exited 0 and saved JSON reports; each reported `status=success` and `materialization.errors=0`. Conflict counts were 37 for centers/institutes, 9 for department roster, 64 for YSM A-to-Z, 19 for NIH RePORTER, and 36 for NSF Award Search.
- 2026-05-29 01:25: Updated the production promotion gate docs to assign routine owner/reviewer fields to `Codex autonomous operator` while keeping the true blockers explicit: no Atlas restore point, no Production dry-run review, no rollback-tested status, and no production smoke result. Production writes/copy remain blocked.
- 2026-05-29 21:35: Completed a substantial production-gate hardening milestone. Added focused tests for the guarded Lane A copy command, then refactored `promoteAcceptedBetaCopy.ts` so pure option parsing and safety guards are exported without executing the CLI on import. Verified red/green with `yarn --cwd server test src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts` and ran `npx tsc --noEmit -p server/tsconfig.json` successfully.
- 2026-05-29 21:50: Completed the next production-gate hardening milestone. Added a pure `buildPromotionSummary` helper for `production:promote-beta-copy`, moved the CLI onto it, and covered redacted targets, collection category totals, synthetic-user exclusions, and blocked synthetic-user references in focused tests. Verified with `yarn --cwd server test src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 21:52: Fixed a Lane A copy allowlist gap before production use. Added `research_scholarly_links` and `research_scholarly_attributions` to the guarded copy set so accepted Beta research activity survives promotion, and added focused allowlist coverage. Verified with `yarn --cwd server test src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 21:53: Made Lane A dry-run review blockers explicit. The promotion summary now reports `applyBlockers` and `syntheticReferenceBlockersClear`, with tests covering synthetic-user reference blockers without claiming production readiness. Verified with `yarn --cwd server test src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 21:54: Added focused coverage for the unblocked Lane A dry-run summary path, asserting `syntheticReferenceBlockersClear=true`, no apply blockers, and zero synthetic-user exclusions when the plan has no blocked references. Verified with `yarn --cwd server test src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 21:57: Unified Lane A dry-run and apply blocker logic. Apply mode now calls the same summary blocker assertion surfaced in dry-run output, preventing synthetic-user reference blocker drift between review and execution. Verified with `yarn --cwd server test src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:00: Extracted pure production-promotion smoke core helpers for config parsing, cookie-safe report initialization, and internal-label detection. Verified with `yarn --cwd client test:ci src/utils/__tests__/productionPromotionSmokeCore.test.ts` and `node --check client/scripts/productionPromotionSmoke.mjs`. A deliberately closed-port script run failed with `fetch failed`/`bad port`, so it was not used as verification; no production or external API was contacted.
- 2026-05-29 22:03: Added pre-network production-promotion smoke target validation. The smoke helper now rejects runbook placeholders like `https://<host>/api` and non-http(s) targets with a structured `smoke.config.validTargets` failure before API/browser work. Verified with `yarn --cwd client test:ci src/utils/__tests__/productionPromotionSmokeCore.test.ts`, `node --check client/scripts/productionPromotionSmoke.mjs`, and a placeholder CLI check that exited before network calls.
- 2026-05-29 22:05: Added a pure production-promotion smoke report summarizer and wired both normal and config-blocked script exits through it. Focused tests now cover failure/warning extraction for review artifacts. Verified with `yarn --cwd client test:ci src/utils/__tests__/productionPromotionSmokeCore.test.ts`, `node --check client/scripts/productionPromotionSmoke.mjs`, and the placeholder CLI check.
- 2026-05-29 22:07: Made `beta:data-quality` content-page leak warnings operator-actionable. `researchEntityContentPageLeaks` now carries `must_fix_before_promotion`, owner, and repeatable read-only command metadata in the promotion warning queue. Verified with `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:09: Added first-class `promotionBlockerCount` and `promotionBlockers` fields to the `beta:data-quality` summary, derived from warnings classified as `must_fix_before_promotion`. Strict mode remains hard-error-only. Verified with `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:12: Added machine-readable `promotionReady` to `beta:data-quality`, false when hard errors or must-fix promotion warnings remain and true when only accepted release warnings remain. Verified with `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:14: Extended Operator Board pure promotion helpers with optional data-quality readiness inputs. `derivePromotionStatus` now blocks when `dataQualityPromotionReady=false`, and recommended actions can surface an explicit data-quality blocker count. Verified with `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:16: Added a pure Operator Board data-quality gate mapper. `deriveDataQualityGate` preserves the current manual fallback when no persisted audit exists and can map available data-quality summaries to `blocked` or `ready`. Verified with `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:18: Rendered Operator Board gate status labels for automatic repair, data quality, and scraper integrity so blocked data-quality states are visible in the admin surface. Verified with `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` and `yarn --cwd client test:ci src/utils/__tests__/productionPromotionSmokeCore.test.ts`.
- 2026-05-29 22:23: Wired saved `beta:data-quality` scorecards into the Operator Board without production access. The service now reads `/tmp/ylabs-beta-quality.json` or `BETA_DATA_QUALITY_SCORECARD_PATH` when present, maps `promotionReady`/`promotionBlockerCount` into the data-quality gate and top-level promotion posture, and treats malformed artifacts as manual gate work. Verified with `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:25: Added `promotionBlockersByOwner` to `beta:data-quality` summaries so review queues can see must-fix promotion blockers grouped by operator owner. Verified with `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:27: Preserved and rendered data-quality promotion blocker owner groups in the Operator Board. Saved scorecard artifacts now carry owner counts and blocker names through the gate payload, and the admin UI renders them in the data-quality gate card. Verified with `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`, `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:31: Added stale scorecard protection for Operator Board data-quality gates. Saved artifacts older than 48 hours are now manual gate work instead of readiness inputs, and the admin gate card shows stale artifact age. Verified with `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`, `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:35: Added saved scraper-integrity artifact support to the Operator Board. The service now reads `/tmp/ylabs-scraper-integrity.json` or `SCRAPER_INTEGRITY_SCORECARD_PATH`, maps pass/watch/failure/manual states with the same 48-hour stale guard, and the admin card renders integrity notes, warnings, artifact age, and failure names. Verified with `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`, `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:38: Added `--output <path>` support to `scraper:integrity-gate` so the Operator Board artifact can be produced directly without hand-copying CLI JSON. The helper tests cover parsing and artifact writing without MongoDB, and stdout/exit semantics remain unchanged. Verified with `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts`, `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:40: Added `--output <path>` support to `launch:trust-contract` so pre-promotion launch trust artifacts can be saved directly. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/launchTrustContract.test.ts`, `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts`, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:46: Wired saved `launch:trust-contract` artifacts into the Operator Board without production access. The service now reads `/tmp/ylabs-launch-trust-contract.json` or `LAUNCH_TRUST_SCORECARD_PATH`, applies the 48-hour stale guard, and the admin UI shows held rows, public visibility violations, repair lanes, artifact age, and failure notes. Verified with `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`, `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:50: Added the `student-decision-llm` scraper source foundation for precomputed Best Next Step guidance. The source selects action-evidence-backed candidates, builds source-constrained prompts, validates output through `publicStudentDecisionExplanation`, and emits safe `studentDecisionExplanation` observations. Focused scraper tests passed with `yarn --cwd server test src/scrapers/__tests__/studentDecisionLLMExtractor.test.ts`.
- 2026-05-29 22:51: Fixed the resulting server typecheck blocker in `departmentRosterScraper.ts` by replacing the stale `cheerio.Element` type annotation with `domhandler`'s `AnyNode`, matching Cheerio's current `.contents()` node types. Verified with `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:52: Made the `student-decision-llm` provider call independently testable. The default OpenAI caller is now exported and covered by a mock-HTTP test that asserts the strict JSON schema request and response parsing without using credentials or network. Verified with `yarn --cwd server test src/scrapers/__tests__/studentDecisionLLMExtractor.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:54: Added safe cache-only replay for `student-decision-llm`. When `--use-cache` has a saved payload, the source can emit validated observations without `OPENAI_API_KEY`; cache misses still skip live calls and log the missing key. Verified with `yarn --cwd server test src/scrapers/__tests__/studentDecisionLLMExtractor.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:55: Added a regression test tying the `student-decision-llm` strict response schema enum to the public student-decision validator actions, preventing future LLM outputs from drifting into validator-rejected action names. Verified with `yarn --cwd server test src/scrapers/__tests__/studentDecisionLLMExtractor.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:57: Added cost-control selection for `student-decision-llm`: entities that already have a materialized `studentDecisionExplanation` are no longer selected for new LLM calls. Verified with `yarn --cwd server test src/scrapers/__tests__/studentDecisionLLMExtractor.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 22:59: Added WorkPlanner policy metadata for `student-decision-llm`, marking it as paid/manual and targeting `studentDecisionExplanation` freshness for operator cost control. Verified with `yarn --cwd server test src/scrapers/__tests__/workPlanner.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:02: Added `--output <path>` support to `launch:acquisition-report` so the PI/action lane map can be saved as a review artifact without hand-copying stdout. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/launchAcquisitionReport.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:04: Added `--output <path>` support to `beta:repair-queue` so dry-run lane reports can be saved as review artifacts while preserving stdout and apply-mode guards. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/betaRepairQueue.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:06: Added `--output <path>` support to `student-visibility:gate` so visibility release results can be saved as review artifacts while preserving stdout and apply-mode guards. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/studentVisibilityGate.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:08: Added `--output <path>` support to `pathways:dedupe-exploratory` so duplicate-pathway dry-runs can be saved as review artifacts while preserving stdout and apply-mode guards. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/dedupeExploratoryContactPathways.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:10: Added `--output <path>` support to `research-entity:dedupe-by-pi` so entity dedupe dry-runs can be saved as review artifacts while preserving stdout and apply-mode guards. Verified with `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:17: Wired saved `beta:repair-queue` artifacts into the Operator Board without production access. The service now reads `/tmp/ylabs-beta-repair-source-description.json` or `BETA_REPAIR_QUEUE_REPORT_PATH`, applies the 48-hour stale guard, and the admin UI shows open queue items, scanned rows, repairable rows, blocked rows, and stale artifact age. Verified with `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`, `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:18: Added `--output <path>` support to `source:health` so source-health reports can be saved as review artifacts while preserving stdout and strict-mode exit semantics. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:20: Added `--output <path>` support to `pathway:quality-audit` so pathway/access/contact gap audits can be saved as review artifacts while preserving stdout. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/pathwayQualityAuditCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:22: Added `--output <path>` support to `application-routes:backfill-pathways` so official-application route backfill dry-runs and applies can be saved as review artifacts while preserving stdout and dry-run-first behavior. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/applicationRoutePathwayBackfillCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:24: Added `--output <path>` support to `posted-opportunities:backfill` and `opportunities:reap-statuses` so opportunity maintenance dry-runs and applies can be saved as review artifacts while preserving stdout and dry-run-first behavior. Both scripts now guard main execution on import and export pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/postedOpportunityMaintenanceCli.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:26: Added `--output <path>` support to `research:quality-search-review` so search-quality golden-query audits can be saved as review artifacts while preserving stdout and strict-mode semantics. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB or Meili. Verified with `yarn --cwd server test src/scripts/__tests__/researchQualitySearchReviewCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:27: Added `--output <path>` support to `profile-image:quality-audit` so profile image trust audits can be saved as review artifacts while preserving stdout and strict-mode semantics. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/profileImageQualityAuditCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:31: Added `--output <path>` support to `research-entity:coverage-audit` so research coverage gap audits can be saved as review artifacts while preserving stdout. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/researchEntityCoverageAudit.test.ts`, `yarn --cwd server test src/scripts/__tests__/claimGate.test.ts src/services/__tests__/claimValidation.test.ts`, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:34: Added `--output <path>` support to `papers:quality-audit` / `scholarly-links:quality-audit` so research-activity display-quality audits can be saved as review artifacts while preserving stdout and strict-mode semantics. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Also fixed the `scraper:integrity-gate --include-claim-gate` result type so the claim-gate extension remains compatible with the integrity gate failure checker. Verified with `yarn --cwd server test src/services/__tests__/paperQualityService.test.ts`, `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts`, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:36: Added `--output <path>` support to `scholarly-links:provenance-audit` and `scholarly-links:suppression-audit` so research-activity provenance/suppression dry-runs and applies can be saved as review artifacts while preserving stdout and existing apply guards. Both scripts now guard main execution on import and export pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/scholarlyLinkAuditCli.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:38: Added `--output <path>` support to `beta:readiness` so Beta readiness gates can be saved as review artifacts while preserving stdout and strict-mode semantics. The script now guards main execution on import and exports pure parse/write helpers for focused tests without MongoDB. Verified with `yarn --cwd server test src/scripts/__tests__/betaReadinessGate.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-29 23:39: Stopping only for a practical context/turn boundary after a large verified artifact-hardening batch. Production promotion remains blocked on true external production facts; feasible non-production work remains. Exact next target: continue review-artifact hardening or pick the next roadmap code-bearing item, starting with remaining JSON-emitting helpers such as `accepted-inputs status`, `pathway:relevance-review`, `papers:authorship-audit`, or read-only rebuild/audit scripts where `--output` and import guards are still missing.
- 2026-05-31 11:14: Resumed after an interrupted continuation. Verified current `accepted-inputs` artifact-helper work already present in the worktree: parser/writer exports, direct-run guard, and JSON artifact writes for report-style commands while preserving CSV/text candidate-output semantics. Verified with `yarn --cwd server test src/scripts/__tests__/acceptedInputs.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 11:16: Verified current `pathway:relevance-review` artifact-helper work already present in the worktree: parser/writer exports, direct-run guard, and JSON artifact writes while preserving strict-mode behavior and Mongo rollback guidance. Verified with `yarn --cwd server test src/scripts/__tests__/pathwayRelevanceReview.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 11:18: Verified current `papers:authorship-audit` artifact-helper work already present in the worktree: parser/writer exports, direct-run guard, and JSON artifact writes while preserving dry-run/apply behavior. Verified with `yarn --cwd server test src/scripts/__tests__/paperAuthorshipAudit.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 11:21: Added `--output <path>` support to `meili:rebuild-pathways` and `meili:rebuild-research-entities` so search-index rebuild results can be saved as review artifacts while preserving stdout and clear/page-size behavior. Verified red/green with `yarn --cwd server test src/scripts/__tests__/searchIndexRebuildCli.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 11:23: Added `--output <path>` support to `student-visibility:backfill` so visibility backfill dry-runs and applies can be saved as review artifacts while preserving stdout, collection selection, and apply-safety blockers. Verified red/green with `yarn --cwd server test src/scripts/__tests__/studentVisibilityBackfillReport.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 11:25: Added `--output <path>` support to `repairListingResearchEntityProfiles` so listing-backed ResearchEntity repair dry-runs and applies can be saved as review artifacts while preserving stdout and existing apply guards. Verified red/green with `yarn --cwd server test src/scripts/__tests__/repairListingResearchEntityProfiles.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 11:27: Added `--output <path>` support to `backfillProgramClassifications` so program-classification dry-runs and applies can be saved as review artifacts while preserving stdout and existing apply guards. Verified red/green with `yarn --cwd server test src/scripts/__tests__/backfillProgramClassifications.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 11:30: Added `--output <path>` support to `research-entity:audit-rename` so the canonical rename readiness audit can be saved as a review artifact while preserving stdout and read-only behavior. Verified red/green with `yarn --cwd server test src/scripts/__tests__/auditResearchEntityRename.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 11:33: Added `--output <path>` support to the guarded Lane A `production:promote-beta-copy` dry-run summary so real Production review can save the redacted collection/category/synthetic-user blocker artifact without hand-copying stdout. Verified red/green with `yarn --cwd server test src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`; no production copy or production write was run.
- 2026-05-31 11:37: Added Operator Board consumption for saved Lane A copy dry-run artifacts. The board reads `/tmp/ylabs-lane-a-promotion-dry-run.json` or `PROMOTION_COPY_DRY_RUN_REPORT_PATH`, treats stale/invalid/missing artifacts as manual work, maps apply blockers to blocked status, and uses `review_required` for blocker-free dry-runs so production readiness is not implied. Verified with `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`, `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 11:48: Rechecked the research-detail professor audit gap. A read-only DB probe found `dept-astronomy-frank-van-den-bosch` now has current PI member rows linked to user `fcv3`. The first `AUDIT_LIMIT=100 yarn audit:research-detail-professors` pass audited 44 public profiles and found only one false-positive name warning where the expected display name appeared in `document.title`.
- 2026-05-31 11:49: Added an import-safe `research-detail-professor-audit-core.mjs` helper so the audit treats expected entity names in body text, `h1`, or `document.title` as valid page identity evidence. Verified with `yarn --cwd server test src/scripts/__tests__/researchDetailProfessorAuditCore.test.ts`, `node --check scripts/research-detail-professor-audit.mjs`, `node --check scripts/research-detail-professor-audit-core.mjs`, and a rerun of `AUDIT_LIMIT=100 yarn audit:research-detail-professors` that passed with 44 audited profiles and 0 findings.
- 2026-05-31 11:50: Fixed the analytics validation bug surfaced during the local audit: `AnalyticsEvent.userType` now accepts canonical `student` values used by auth/dev-login flows. Also removed the duplicate ascending `timestamp` schema index warning while preserving the TTL retention index. Verified red/green with `yarn --cwd server test src/models/__tests__/analytics.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 11:56: Added the missing dry-run `users:dedupe-by-identity` CLI wrapper for the identity/account warning queue. The command reuses the existing safe planner, writes `--output` review artifacts, and blocks `--apply` until merge/reference-rewrite behavior is implemented and reviewed. Updated scraper integrity recommendations to the dry-run command instead of unsupported apply mode. Verified with `yarn --cwd server test src/scripts/__tests__/dedupeUsersByIdentityCli.test.ts`, `yarn --cwd server test src/scripts/__tests__/dedupeUsersByIdentityCore.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, and `yarn --cwd server users:dedupe-by-identity --limit=1 --sample-size=1 --output /tmp/ylabs-user-dedupe-smoke.json`.
- 2026-05-31 11:59: Ran the current identity/account queue dry-run with `yarn --cwd server users:dedupe-by-identity --limit=1000 --sample-size=10 --output /tmp/ylabs-user-dedupe-identity-review.json`. It found `candidateGroups=0`, `plannedGroups=0`, `duplicateUsers=0`, and `warningGroups=0`, so older duplicate-person warning counts appear stale in the current local/Beta target pending a fresh full `beta:data-quality` artifact.
- 2026-05-31 12:05: Added the dry-run `users:email-hygiene` CLI wrapper and pure helpers for the suspicious user email warning queue. The command writes a review artifact, blocks apply mode, and the shared detector now catches `test123`-style synthetic accounts plus `@example.invalid`. Verified red/green with `yarn --cwd server test src/scripts/__tests__/userEmailHygiene.test.ts`, `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts`, combined focused tests, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 12:06: Ran `yarn --cwd server users:email-hygiene --limit=1000 --sample-size=10 --output /tmp/ylabs-user-email-hygiene.json`. It found 2 suspicious users, `devadmin@example.invalid` and `test123@example.invalid`, and made no writes.
- 2026-05-31 12:06: Ran refreshed `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`. The new scorecard is `status=error` with `referenceIntegrity` count 1 because `research_entity_members.userId` has 1 orphaned present reference. Warnings are source health 7, duplicate entity names 34, missing short descriptions 699, weak short descriptions 73, coverage without pathways 648, coverage without access signals 501, coverage without contact routes 1,320, and suspicious user emails 2. Next selected task: make that reference-integrity hard failure sample/actionable without production writes or data deletion.
- 2026-05-31 12:11: Made reference-integrity hard failures sample/actionable in `beta:data-quality --include-samples`. The scorecard now includes bounded `referenceIntegrity.items[].samples` for missing required refs and orphaned scalar/array refs. Verified with `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, and a refreshed local/Beta scorecard; the current orphan sample is member row `6a191173dd73647909b517a6` pointing at missing user `698995e560e4ebc1849d16bf`.
- 2026-05-31 12:18: Added `research-entity-members:audit-user-refs` as a dry-run orphan member reference planner. It finds missing-user `research_entity_members.userId` refs, infers candidate person names from member/entity labels, proposes exact relinks when exactly one existing user matches, and blocks apply mode. Verified with `yarn --cwd server test src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts`, `yarn --cwd server test src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts src/scripts/__tests__/betaDataQualityCore.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, refreshed `beta:data-quality`, and `yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json`.
- 2026-05-31 12:18: The member-reference audit found 1 orphaned member user ref and 1 exact non-applied relink proposal: member `6a191173dd73647909b517a6` on `nih-pi-nancy-brown` currently points at missing user `698995e560e4ebc1849d16bf`; the proposed replacement is existing professor user `nb653` / `67d891da50621bcef4347e99`. No repair write was run.
- 2026-05-31 12:22: Surfaced data-quality hard errors in the Operator Board. Saved `beta:data-quality` artifacts now preserve `summary.errors`, `deriveDataQualityGate` notes hard errors separately from must-fix warning blockers, and the admin UI renders hard error names/owners/next commands. Verified with `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`, `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 12:33: Fixed the member-reference planner after a guarded Beta apply exposed a duplicate-key collision. The planner now detects existing active target memberships and plans `archive_orphan_duplicate_member` instead of relinking into an existing `{researchEntityId,userId,role}` tuple. Verified red/green with `yarn --cwd server test src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 12:35: Ran the guarded non-production Beta repair: `SCRAPER_ENV=beta yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --max-apply=1 --apply --confirm-exact-relink --output /tmp/ylabs-member-user-ref-audit-apply.json`. It archived duplicate member row `6a191173dd73647909b517a6` and left canonical member `6a077e83555ea7318665efbd` linked to professor user `nb653` / `67d891da50621bcef4347e99`.
- 2026-05-31 12:35: Post-apply dry-run `research-entity-members:audit-user-refs` reported `orphanedMemberUserRefs=0`, `plannedExactRelinks=0`, and `plannedDuplicateArchives=0`.
- 2026-05-31 12:36: Ran the post-write loop. `student-visibility:gate --collection=all --mode=apply` exited 0 with `changed=0`; `meili:rebuild-research-entities` indexed 3,267 docs; `meili:rebuild-pathways` indexed 1,692 hits; strict `launch:trust-contract` exited 1 for remaining launch completeness lanes but kept `publicVisibilityViolations=0`, research activity pass, and paper quality pass.
- 2026-05-31 12:38: Fixed `beta:data-quality` reference integrity to scope `research_entity_members.userId` to non-archived owner rows, matching the repair/audit semantics. Verified with `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 12:38: Refreshed `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`. The scorecard now reports `status=warn`, `errorCount=0`, `referenceIntegrity.hardFailureTotal=0`, and 3 warning-class promotion blockers: `sourceHealthWarnings`, `duplicateEntityNames`, and `suspiciousUserEmails`. Next selected task: inspect the duplicate-entity warning queue with the existing PI-dedupe dry-run and implement only deterministic non-production hardening if the report exposes one.
- 2026-05-31 12:44: Ran `yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --output /tmp/ylabs-research-entity-dedupe.json`. It found 32 deterministic same-PI duplicate entity archive plans and 0 duplicate-current-member repairs.
- 2026-05-31 12:45: Hardened `research-entity:dedupe-by-pi` before any entity repair write. The script now parses `--max-apply` with default 10, blocks apply batches above the bound, emits `maxApply` in the report, and refuses archive-mode conflict paths that would delete reference rows. Verified red/green with `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, refreshed dry-run output, and a blocked `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --apply --output /tmp/ylabs-research-entity-dedupe-apply-blocked.json` probe.
- 2026-05-31 12:48: Tried the planned `yarn --cwd server source-health --help` command and confirmed it was stale: there is no `source-health` package script. The correct script is `source:health`.
- 2026-05-31 12:50: Made source-health blocker routing concrete in `beta:data-quality`. `sourceHealthWarnings.nextCommand` now points to `yarn --cwd server source:health --output /tmp/ylabs-source-health.json`, and duplicate-name routing points to the saved dedupe artifact command. Verified with `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 12:51: Generated `/tmp/ylabs-source-health.json` with `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`. It reports 28 sources, 21 ok, 7 warn, and 0 error. Warning rows are six latest-run materialization-conflict report commands plus `visibility-repair-queue`, which has no recent run recorded.
- 2026-05-31 12:52: Refreshed `/tmp/ylabs-beta-quality.json` with `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`. It remains `status=warn` with `errorCount=0`, `referenceIntegrity.hardFailureTotal=0`, and three promotion blockers: `sourceHealthWarnings`, `duplicateEntityNames`, and `suspiciousUserEmails`. Next selected task: keep the suspicious-user email queue non-destructive but more reviewable by surfacing copy-exclusion/readiness status instead of implying deletion.
- 2026-05-31 12:55: Hardened `users:email-hygiene` so the review artifact distinguishes suspicious users already excluded by the guarded Lane A copy filter from suspicious users that need review before copy. The current local/Beta artifact still finds 2 suspicious users, and both are `excluded_from_lane_a_users_copy`; no user deletion or production copy was run. Verified red/green with `yarn --cwd server test src/scripts/__tests__/userEmailHygiene.test.ts`, full server typecheck, and `yarn --cwd server users:email-hygiene --limit=1000 --sample-size=10 --output /tmp/ylabs-user-email-hygiene.json`.
- 2026-05-31 12:58: Made `visibility-repair-queue` source-health warnings actionable. `source:health` now emits `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --mode=dry-run --limit=100 --output /tmp/ylabs-visibility-repair-queue-dry-run.json` for no-recent-run visibility repair rows instead of a null `nextCommand`. Verified red/green with `yarn --cwd server test src/services/__tests__/sourceHealthService.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 12:59: Regenerated `/tmp/ylabs-source-health.json`; it still reports 28 sources, 21 ok, 7 warn, and 0 error, and now the `visibility-repair-queue` row has the bounded Beta repair-queue dry-run command.
- 2026-05-31 13:00: Ran the new bounded dry-run: `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --mode=dry-run --limit=100 --output /tmp/ylabs-visibility-repair-queue-dry-run.json`. It scanned 88, attempted 88, found 77 deterministic repairs and 11 blocked rows across source-description and PI-identity stages.
- 2026-05-31 13:01: Applied the same bounded non-production repair slice: `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --mode=apply --limit=100 --output /tmp/ylabs-visibility-repair-queue-apply.json`. It repaired 77 rows, blocked 11, and resolved 63 by gate; no production access, production copy, retention apply, or data deletion was run.
- 2026-05-31 13:03: Ran the post-write loop. `student-visibility:gate --collection=all --mode=apply` scanned 2,669, promoted 1,442, held 1,227, and changed 0; `meili:rebuild-research-entities` indexed 3,267 docs; `meili:rebuild-pathways` indexed 1,781 hits; strict `launch:trust-contract` still exits 1 for completeness but has 0 public visibility violations, research activity pass, and paper quality pass; refreshed `beta:data-quality` is warn-only with `errorCount=0`.
- 2026-05-31 13:05: Generated the post-visibility `launch:acquisition-report`. It found 2 exact PI/user matches, no source-backed route materialization candidates, and 9 action-evidence blockers.
- 2026-05-31 13:06: Ran the matching PI-only dry-run and bounded non-production apply: `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=research --stage=pi_identity --mode=dry-run --retry-blocked --limit=250 --output /tmp/ylabs-beta-repair-pi-identity.json` and `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=research --stage=pi_identity --mode=apply --retry-blocked --limit=250 --output /tmp/ylabs-beta-repair-pi-identity-apply.json`. Both scanned 67 and attempted 67; apply repaired 2, blocked 65, and resolved 1 by the visibility gate.
- 2026-05-31 13:07: Completed the PI post-write loop. `student-visibility:gate --collection=all --mode=apply` scanned 2,669, promoted 1,443, held 1,226, and changed 0; `meili:rebuild-research-entities` indexed 3,267 docs; `meili:rebuild-pathways` indexed 1,783 hits; strict `launch:trust-contract --output /tmp/ylabs-launch-trust-contract.json` still exits 1 for completeness but remains safety-clean with 0 public visibility violations, research activity pass, and paper quality pass.
- 2026-05-31 13:08: Refreshed `/tmp/ylabs-beta-quality.json`. It remains warning-only with `errorCount=0`, `referenceIntegrity.hardFailureTotal=0`, and 3 must-fix promotion blockers: `sourceHealthWarnings`, `duplicateEntityNames`, and `suspiciousUserEmails`.
- 2026-05-31 13:09: Regenerated `/tmp/ylabs-launch-acquisition-report.json` after the PI apply. It now has 0 exact PI/user matches and 0 source-backed route materialization candidates; remaining PI/action gaps require new official source evidence, source materialization logic, or manual disambiguation rather than another blind apply.
- 2026-05-31 13:12: Found and fixed a duplicate-entity safety bug before broad apply. `archiveOrDeleteDuplicateDocument` could fall through to `deleteOne` after duplicate-key conflicts even in archive mode; it now blocks archive-mode conflict deletion, and apply groups run sequentially so a conflict stops later groups from starting. Verified red/green with `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 13:13: Regenerated `/tmp/ylabs-research-entity-dedupe.json`; it found 32 same-PI duplicate archive plans. The unbounded `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --apply --output /tmp/ylabs-research-entity-dedupe-apply-blocked.json` probe still exited before writes with `Apply would modify 32 rows, above --max-apply.`
- 2026-05-31 13:14: Ran narrower duplicate queue dry-runs. `--funding-only` and `--official-lab-url-only` had 0 planned groups. `--reviewed-profile-area-only` had 3 legacy profile-area duplicates, so a bounded Beta apply was attempted with `--max-apply=3`. The new deletion guard stopped on an `entry_pathways` duplicate-key conflict instead of deleting the conflicting row; because the old script had already started groups in parallel, this produced partial non-deleting Beta repairs.
- 2026-05-31 13:15: Follow-up `--reviewed-profile-area-only` dry-run now has 0 planned groups, showing the 3 reviewed profile-area duplicates were archived or otherwise no longer active candidates. The broader same-PI queue now has 29 planned archive rows.
- 2026-05-31 13:16: Ran the post-write loop after the partial duplicate-profile cleanup. `student-visibility:gate --collection=all --mode=apply` scanned 2,666, promoted 1,442, held 1,224, and changed 0; `meili:rebuild-research-entities` indexed 3,267 docs; `meili:rebuild-pathways` indexed 1,782 hits; strict `launch:trust-contract --output /tmp/ylabs-launch-trust-contract.json` still exits 1 for completeness but has 0 public visibility violations, research activity pass, and paper quality pass; refreshed `beta:data-quality` is warning-only with `errorCount=0` and `referenceIntegrity.hardFailureTotal=0`.
- 2026-05-31 13:20: Tightened duplicate-entity conflict recovery further. Archive-mode duplicate artifact conflicts now retry as archive-only updates without forcing `researchEntityId` to the canonical id, avoiding duplicate-key collisions while preserving data and still blocking deletion. Verified red/green with `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.
- 2026-05-31 13:22: Made the duplicate-entity dry-run artifact more reviewable. `/tmp/ylabs-research-entity-dedupe.json` now includes `reviewBreakdown`; the current artifact reports 29 remaining groups, all cross-department and all with merged research areas, with 10 high research-area merges, 1 funding-source group, and 0 reviewed-profile-area groups. Verified red/green with `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, and a refreshed dry-run artifact.
- 2026-05-31 13:25: Made source-health conflict warnings more reviewable without relaxing the gate. `source:health` now adds `reviewArtifact` metadata to latest-run failure/error/conflict rows, including required report command, output path, materialization conflict count, and error count. Regenerated `/tmp/ylabs-source-health.json` and `/tmp/ylabs-beta-quality.json`; source-health remains 21 ok / 7 warn / 0 error, and data quality remains warning-only with `errorCount=0`.
- 2026-05-31 13:34: Made `yarn scrape report` materialization-conflict artifacts independently reviewable. Reports for runs with nonzero conflicts now include `quality.materializationConflictReview`, built from a bounded active-Observation scan for touched entities with field/source counts, direct-contact redaction in value previews, and capped samples. Verified red/green with `yarn --cwd server test src/scrapers/__tests__/runReport.test.ts`, full server typecheck, and regenerated the six current source-health report artifacts under `/tmp/ylabs-scraper-reports/`.
- 2026-05-31 13:39: Fixed materializer-managed timestamp conflict noise. Entity and paper materialization now ignore `lastObservedAt` observation fields during resolver conflict counting because the materializer sets that timestamp itself. The scraper report conflict review mirrors the same exclusion. Verified red/green with `yarn --cwd server test src/scrapers/__tests__/entityMaterializer.test.ts`, `yarn --cwd server test src/scrapers/__tests__/runReport.test.ts`, full server typecheck, and regenerated the six current source-health report artifacts.
- 2026-05-31 13:42: Added machine-readable conflict categories to scraper report artifacts. `quality.materializationConflictReview` now includes `categoryCounts`, `actionableConflictCount`, and sample-level `reviewCategory` values for additive metadata, identity/routing, content, access-evidence, funding-context, and other conflicts. Verified with focused report tests, full server typecheck, and regenerated the six current source-health report artifacts.
- 2026-05-31 13:48: Made duplicate normalized-name warnings implementation-ready without applying merges. `beta:data-quality` now attaches `duplicateEntityNames.reviewSummary` and sample-level `reviewCategory` values. The refreshed `/tmp/ylabs-beta-quality.json` still reports 34 duplicate-name clusters, now classified as 20 shared-website merge reviews, 8 cross-department same-person reviews, and 6 same-label disambiguation reviews. Verified red/green with `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts`, full server typecheck, and a refreshed Beta scorecard.
- 2026-05-31 13:54: Made the broad `beta:data-quality` email warning production-copy aware without deleting users or relaxing the gate. `hygiene.emails.suspiciousUserEmails` now includes Lane A exclusion posture and sample-level production-copy dispositions; the refreshed `/tmp/ylabs-beta-quality.json` reports 2 suspicious users, both sampled as `excluded_from_lane_a_users_copy`, while `promotionReady` remains false because source-health and duplicate-name blockers remain. Verified red/green with `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts`, focused email/data-quality tests, full server typecheck, and a refreshed Beta scorecard.
- 2026-05-31 13:58: Added a dedicated read-only duplicate normalized-name review command. `research-entity:duplicate-name-review` writes `/tmp/ylabs-duplicate-entity-name-review.json`, blocks apply mode, omits contact emails, and `beta:data-quality` now routes the `duplicateEntityNames` blocker to that command instead of the broader same-PI dedupe dry-run. The refreshed review artifact reports 34 clusters / 68 entities split into 20 shared-website merge reviews, 8 cross-department same-person reviews, and 6 same-label disambiguation reviews. Verified red/green with `yarn --cwd server test src/scripts/__tests__/duplicateEntityNameReview.test.ts src/scripts/__tests__/betaDataQualityCore.test.ts`, full server typecheck, the dry-run artifact command, and a refreshed Beta scorecard.
- 2026-05-31 14:02: Made `source:health` summarize saved scraper report conflict reviews in its own artifact. `/tmp/ylabs-source-health.json` now has `reviewSummary` with 7 warning rows, 6 available report artifacts, 6 conflict reviews, 445 active observation conflicts, 313 actionable conflicts, and category totals across additive metadata, identity/routing, content, funding context, other, and access evidence. Verified red/green with `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts`, full server typecheck, and a refreshed source-health artifact.
- 2026-05-31 14:06: Surfaced the source-health review summary in the Operator Board. `sourceFreshness.reviewSummary` now flows from backend source-health rows to the admin UI, where reviewers can see report artifact availability, actionable conflict count, and top conflict categories without opening `/tmp/ylabs-source-health.json`. Verified red/green with `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`, and full server typecheck.
- 2026-05-31 14:09: Embedded the source-health conflict review packet in the broad Beta data-quality scorecard. `/tmp/ylabs-beta-quality.json` now includes `sourceHealth.reviewSummary` with the same six report-artifact availability checks, 445 active observation conflicts, 313 actionable conflicts, and category totals as `/tmp/ylabs-source-health.json`. Verified with focused source-health/data-quality tests, full server typecheck, and a refreshed Beta scorecard.
- 2026-05-31 14:16: Partitioned source-health conflict reviews into priority/context/metadata queues without relaxing the source-health gate. `sourceHealth.reviewSummary` now reports 226 priority-review conflicts, 87 context-review conflicts, and 132 metadata-review conflicts, with per-row primary queues. The Operator Board renders the queue split. Verified red/green with `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts`, `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, full server typecheck, and refreshed `/tmp/ylabs-source-health.json` plus `/tmp/ylabs-beta-quality.json`.
- 2026-05-31 14:20: Prioritized scraper report conflict samples by review queue. `quality.materializationConflictReview.samples` now includes `reviewQueue` and sorts priority-review samples ahead of context/metadata samples before the sample cap. Regenerated all six saved source-health report artifacts; `dept-faculty-roster` now starts with `name` identity/routing samples and `ysm-atoz-index` starts with PI/access samples. Verified red/green with `yarn --cwd server test src/scrapers/__tests__/runReport.test.ts`, full server typecheck, a report-sample inspection command, and a refreshed `/tmp/ylabs-source-health.json`.
- 2026-05-31 14:26: Added source-scope counts to materialization conflict reviews. Scraper reports now expose same-source versus cross-source conflict totals and sample-level `sourceConflictScope`; `source:health`, `beta:data-quality`, and the Operator Board surface the aggregate scope split. Refreshed artifacts report 370 same-source conflicts and 75 cross-source conflicts, with `dept-faculty-roster` entirely same-source and `department-undergrad-research` the largest cross-source review lane. Verified red/green with focused report/source-health/admin-board tests, full server typecheck, six regenerated report artifacts, refreshed source-health, and refreshed Beta data-quality.
- 2026-05-31 14:34: Added a dry-run-only stale same-source observation conflict review command. `observations:stale-conflict-review` blocks apply mode, keeps the newest same-source value as the proposed survivor, redacts value previews, and writes bounded artifacts without superseding observations. Verified red/green with `yarn --cwd server test src/scripts/__tests__/staleObservationConflictReview.test.ts`, full server typecheck, and Beta dry-run artifacts for `dept-faculty-roster` plus `centers-institutes-index`.
- 2026-05-31 14:37: Made the stale same-source review source-health aligned. The command now supports `--queue`, `--category`, and `--field` filters, emits category and review-queue summaries, and annotates samples with `reviewCategory`/`reviewQueue`. Queue-filtered Beta artifacts found `dept-faculty-roster` has 444 priority identity/routing groups and `centers-institutes-index` has 40 priority identity/routing groups.
- 2026-05-31 14:40: Wired source-health rows to exact stale-observation review commands. Rows with same-source conflicts now include `staleObservationReview` command/output metadata, and refreshed `/tmp/ylabs-source-health.json` plus `/tmp/ylabs-beta-quality.json` carry those pointers without accepting the warning gate.
- 2026-05-31 14:43: Added bounded supersession plans to the stale same-source review. The command now separates samples from full dry-run operation plans via `--plan-limit`, includes keep/supersede ids per plan, and keeps apply mode explicitly blocked. Verified against Beta with a truncated `dept-faculty-roster` priority plan artifact.
- 2026-05-31 14:47: Added bounded dry-run plans to the duplicate normalized-name review command. `research-entity:duplicate-name-review` now accepts `--category` and `--plan-limit`, emits `planSummary`, lists entity ids/slugs and shared website URLs when present, and still leaves apply mode unavailable.
- 2026-05-31 14:50: Added reference-impact counts to duplicate-name plans. Plans now count active pathways, signals, contact routes, members, research activity links/attributions, opportunities, listings, and active research-entity observations by entity before any merge/archive path is considered.
- 2026-05-31 14:55: Added compact duplicate-name plan guidance to `beta:data-quality`. The scorecard now carries `duplicateEntityNames.planReview` with category counts and exact bounded dry-run plan artifact commands, while keeping full plans and reference-impact detail in the standalone duplicate-name review artifacts. Verified with red/green `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts`, full server typecheck, and a refreshed `/tmp/ylabs-beta-quality.json`.
- 2026-05-31 15:06: Added a read-only cross-source observation conflict review command and wired source-health rows to it. `observations:cross-source-conflict-review` groups active observations across sources for a bounded source, redacts value previews, emits source/field plans with observation ids by source, and blocks apply mode. Verified with red/green focused tests, full server typecheck, successful Beta dry-runs for `department-undergrad-research` and `ysm-atoz-index`, and refreshed `/tmp/ylabs-source-health.json` plus `/tmp/ylabs-beta-quality.json`.
- 2026-05-31 15:10: Added `fieldCounts` and `sourcePairCounts` to cross-source observation conflict artifacts. Regenerated artifacts show `department-undergrad-research` concentrated in description, website, entity-type, and access-evidence fields across department/LLM/faculty-roster source pairs, while `ysm-atoz-index` is a small name-conflict queue against `lab-microsite-undergrad-llm`.
- 2026-05-31 15:13: Added policy-bucket classification to cross-source observation conflict artifacts. Regenerated artifacts now split `department-undergrad-research` into description-policy, routing/entity-type, and access-evidence policy buckets, while `ysm-atoz-index` is a `name_precedence_review` queue. Apply remains blocked.
- 2026-05-31 15:19: Made `source:health` summarize exact saved stale/cross-source review artifacts per row. Rows now show `artifactAvailable=false` for missing same-source stale-review artifacts and, when exact cross-source artifacts exist, candidate/plan counts, truncation status, categories, and policy buckets. Verified with a red/green focused source-health test, full server typecheck, refreshed `/tmp/ylabs-source-health.json`, refreshed `/tmp/ylabs-beta-quality.json`, and a JSON status inspection showing `department-undergrad-research` and `ysm-atoz-index` cross-source artifacts available while stale artifacts remain absent.
- 2026-05-31 15:22: Added top-level `reviewArtifactStatus` to `source:health` so missing stale/cross-source follow-up artifacts are counted and their exact commands are listed without scanning rows. The refreshed source-health packet reports 6 stale-review artifacts total, 0 available, 6 missing, and 2 cross-source artifacts total/available with 0 missing. Verified with a red/green focused source-health test, full server typecheck, refreshed `/tmp/ylabs-source-health.json`, refreshed `/tmp/ylabs-beta-quality.json`, and a JSON status inspection.
- 2026-05-31 15:26: Added `fieldCounts` and `policyBucketCounts` to stale same-source review artifacts, generated all six exact stale-review dry-run artifacts listed by source-health, and reran source-health. The refreshed source-health packet reports stale-review artifacts 6 total / 6 available / 0 missing and cross-source artifacts 2 total / 2 available / 0 missing. Apply mode and supersession remain blocked pending review.
- 2026-05-31 15:29: Bridged saved review-artifact field rollups into `source:health` rows for both stale same-source and cross-source reviews. Rows now carry exact field counts from available artifacts, so operators can review source-health conflict concentration without opening every JSON file. Verified with focused source-health/stale-review tests, full server typecheck, refreshed `/tmp/ylabs-source-health.json`, refreshed `/tmp/ylabs-beta-quality.json`, and JSON inspection of the row-level field counts.
- 2026-05-31 15:33: Added compact top-level `reviewArtifactRollups` to `source:health`, aggregating field and policy-bucket counts across all available stale and cross-source review artifacts. The refreshed source-health artifact still reports 21 ok / 7 warn / 0 error, exact stale artifacts 6/6 available, exact cross artifacts 2/2 available, stale policy buckets led by `stale_identity_or_routing_review=494`, and cross-source policy buckets led by `description_policy_review=23`. Verified red/green with focused source-health tests, full server typecheck, source-health regeneration, Beta data-quality regeneration, and JSON inspection.
- 2026-05-31 15:35: Surfaced `reviewArtifactRollups` in the Operator Board source-freshness card. The admin UI now renders top stale/cross fields and policy buckets while preserving the blocked/review posture for source-health warnings. Verified red/green with `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`.
- 2026-05-31 15:39: Added duplicate-name review preflight metadata without enabling apply. `research-entity:duplicate-name-review` plans now include `reviewPreflight`, and plan summaries include counts of merge-preflight-ready versus manual-disambiguation plans, total impacted references, and required reviewer decisions. The refreshed all-plan artifact has 20 planned clusters, 10 merge-preflight-ready, 10 manual-disambiguation-required, and 361 impacted references; the refreshed shared-website artifact has 20/20 merge-preflight-ready clusters and 281 impacted references. Apply remains blocked. Verified red/green with focused duplicate-name tests, full server typecheck, refreshed artifacts, and JSON inspection.
- 2026-05-31 15:41: Made broad duplicate-name scorecard guidance preflight-aware without embedding full plans. `duplicateEntityNames.planReview.preflightGuidance` now names the expected artifact fields, points shared-website reviewers to the exact category artifact, and lists required reviewer decisions. The refreshed `/tmp/ylabs-beta-quality.json` still reports 34 duplicate-name clusters and keeps `promotionReady=false`. Verified red/green with focused data-quality core tests, full server typecheck, refreshed Beta data-quality, and JSON inspection.
- 2026-05-31 15:47: Surfaced duplicate-name preflight guidance in the Operator Board data-quality gate. Saved `beta:data-quality` artifacts now pass the preflight summary through `adminOperatorBoardService`, and the admin UI renders shared-website cluster count, exact artifact path, reviewer decisions, and manual-review categories while preserving the blocked gate posture. Verified red/green with `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`, and full server typecheck. Next selected engineering task: add dry-run-only duplicate-name reviewer-decision validation so accepted decision files can be checked without enabling apply.
- 2026-05-31 15:51: Added dry-run-only accepted-decision validation to `research-entity:duplicate-name-review`. The command now parses `--accepted-decisions=<path>`, accepts a JSON array or `{ "decisions": [...] }`, validates decisions against generated plan ids, canonical ids, duplicate plan decisions, unmatched plans, and merge-preflight status, and emits `reviewDecisionValidation` while keeping apply mode blocked. Verified red/green with `yarn --cwd server test src/scripts/__tests__/duplicateEntityNameReview.test.ts`, full server typecheck, a read-only Beta CLI probe using an empty decisions artifact, and JSON inspection of the validation summary. Next selected engineering task: surface the decision-validation command shape in the broad `beta:data-quality` duplicate-name plan guidance.
- 2026-05-31 15:53: Surfaced accepted-decision validation guidance in the broad Beta data-quality scorecard. `duplicateEntityNames.planReview.preflightGuidance.acceptedDecisionValidation` now lists the expected accepted-decision JSON fields, input/output paths, exact dry-run validation command, and expected `reviewDecisionValidation` artifact field. Verified red/green with `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts`, full server typecheck, refreshed `/tmp/ylabs-beta-quality.json`, and JSON inspection. Next selected engineering task: add a sample accepted-decision template generator or artifact stub so reviewers can prepare decisions without hand-authoring JSON from scratch.
- 2026-05-31 15:57: Added reviewer decision-template generation to `research-entity:duplicate-name-review` and scorecard guidance. The command now accepts `--decision-template-output <path>` and writes plan-derived stubs with plan ids, entity ids/slugs, shared website, preflight status, reference-impact totals, required reviewer decisions, and blank decision fields. `beta:data-quality` advertises the matching `acceptedDecisionTemplate` command beside the validation command. Verified red/green with focused duplicate-name and data-quality tests, full server typecheck, a read-only Beta template probe, refreshed `/tmp/ylabs-beta-quality.json`, and JSON inspection. Next selected engineering task: evaluate whether any remaining feasible non-production roadmap item can further reduce duplicate-name/source-health blockers without real reviewer decisions.
- 2026-05-31 16:03: Added dry-run reviewer templates and accepted-decision validation to `observations:stale-conflict-review`. The command now accepts `--decision-template-output` and `--accepted-decisions`, writes plan-derived keep/supersede stubs, validates accepted decisions against plan ids and exact keep/supersede observation ids, and emits `reviewDecisionValidation` without enabling apply. Verified red/green with focused stale-review tests, full server typecheck, a read-only Beta probe for `dept-faculty-roster` priority plans, and JSON inspection of the template plus empty-decision validation summary. Next selected engineering task: surface stale-observation template/validation commands from `source:health` or `beta:data-quality` so source-health reviewers can find them without inspecting CLI code.
- 2026-05-31 16:09: Surfaced stale-observation reviewer handoff commands directly from `source:health`. Rows with `staleObservationReview` now carry `acceptedDecisionTemplate` and `acceptedDecisionValidation` metadata, and the embedded `beta:data-quality` source-health packet carries the same paths. Verified red/green with `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts`, full server typecheck, refreshed `/tmp/ylabs-source-health.json`, refreshed `/tmp/ylabs-beta-quality.json`, and JSON inspection. Next selected engineering task: add the same template/validation scaffold to `observations:cross-source-conflict-review` so cross-source reviewers can validate accepted precedence decisions without parsing plans by hand.
- 2026-05-31 16:17: Added dry-run reviewer templates and accepted-decision validation to `observations:cross-source-conflict-review`, then surfaced those template/validation commands through `source:health` rows and the embedded `beta:data-quality` source-health packet. Verification covered red/green cross-source and source-health tests, full server typecheck, a read-only Beta empty-decision probe, refreshed `/tmp/ylabs-source-health.json`, refreshed `/tmp/ylabs-beta-quality.json`, and JSON inspection. Next selected engineering task: render stale/cross-source accepted-decision handoff paths in the Operator Board source-freshness card so reviewers can find the template/validation artifacts from the admin surface.
- 2026-05-31 16:21: Rendered stale and cross-source accepted-decision handoff paths in the Operator Board Source Freshness card. The admin UI now shows the handoff source plus template and validation artifact paths from saved `sourceHealth.reviewSummary.rows` metadata without changing gate readiness. Verified red/green with `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`. Next selected engineering task: make source-health accepted-decision validation output status independently visible when validation artifacts exist, so review completion can be checked without parsing validation JSON by hand.
- 2026-06-02 23:35: Completed shared legacy V4 migration utility safety hardening. `data-migration/v4MigrationUtils.ts` now has testable option parsing for `--apply`/`--live`, `--limit`, and `--output`, a reusable production-apply guard, and an artifact metadata wrapper. Verification ran `yarn --cwd server test src/scripts/__tests__/dataMigrationV4Utils.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, and a blocked production guard probe with `SCRAPER_ENV=production yarn --cwd data-migration migrate:v4:grants --apply --limit=1`; the probe exited before the migration banner or Mongo connection with the expected `CONFIRM_PROD_SCRAPE=true` blocker. No V4 apply, production write, production copy, destructive action, irreversible migration, or data deletion was run. Next selected task: rescan the roadmap for any remaining feasible non-production code-bearing item before stopping.
- 2026-06-02 23:53: Fixed the shared V4 migration utility to load the server Mongoose instance through `createRequire`, preserving the model/connection pairing for V4 scripts that import server models while keeping server typecheck green. Then hardened `data-migration/BackfillV4Grants.ts` so it is import-safe, output-aware, and testable; the agency normalizer now recognizes full National Science Foundation and Department of Defense names. Verification ran red/green `yarn --cwd server test src/scripts/__tests__/dataMigrationV4GrantBackfill.test.ts`, reran `yarn --cwd server test src/scripts/__tests__/dataMigrationV4Utils.test.ts`, ran `npx tsc --noEmit -p server/tsconfig.json`, and reran the guarded production apply probe with `--output`. No V4 grant apply, production write, production copy, destructive action, irreversible migration, or data deletion was run.
- 2026-06-02 23:57: Completed live-model V4 identity backfill safety hardening. `BackfillV4FacultyMembers.ts`, `BackfillV4StudentProfiles.ts`, and `BackfillV4ResearchGroupMembers.ts` are now import-safe, use the shared V4 parser/connection/production-write guard, and support saved `--output` artifacts. Verification ran red/green `yarn --cwd server test src/scripts/__tests__/dataMigrationV4IdentityBackfills.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, and guarded production apply probes for all three scripts with `SCRAPER_ENV=production --apply --limit=1 --output <path>`; each probe reached the expected `CONFIRM_PROD_SCRAPE=true` guard before connection output. No V4 identity apply, production write, production copy, destructive action, irreversible migration, or data deletion was run.
- 2026-06-02 23:41: Completed legacy user migration copy safety hardening. `data-migration/MigrateUsers.ts` is now import-safe, dry-run-first, supports `--apply`, `--replace-existing`, and `--output`, wraps review artifacts with source/target database labels, and blocks production apply mode before any database connection. Verification ran red/green `yarn --cwd server test src/scripts/__tests__/userMigrationCliSafety.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, and a guarded production apply probe with a fake migration target. The first probe stopped because local `MONGODBURL_MIGRATION` is unset; the fake-target probe reached the expected `CONFIRM_PROD_SCRAPE=true` guard before source/target connection output. No user copy, production write, production copy, destructive action, irreversible migration, or data deletion was run. Next selected task: rescan for remaining feasible legacy data-migration safety hardening or stop only if all remaining items are truly blocked.
- 2026-06-02 23:44: Completed legacy department migration safety hardening. `data-migration/MigrateDepartments.ts` is now import-safe, dry-run-first, supports `--apply`/`--live`, `--dry-run`, and `--output`, wraps review artifacts with source/target database labels, and blocks production apply mode before any database connection. Verification ran red/green `yarn --cwd server test src/scripts/__tests__/departmentMigrationCliSafety.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, and `SCRAPER_ENV=production MONGODBURL_MIGRATION=mongodb+srv://example.invalid/ProductionMigration yarn --cwd data-migration migrate:departments:live --output /tmp/ylabs-department-migration-prod-blocked.json`; the probe reached the expected `CONFIRM_PROD_SCRAPE=true` guard before source/target connection output. No department migration apply, production write, production copy, destructive action, irreversible migration, or data deletion was run. Next selected task: rescan for remaining feasible legacy data-migration safety hardening or stop only if all remaining items are truly blocked.
- 2026-06-02 23:48: Completed legacy embedded-publications migration safety hardening. `data-migration/MigratePublicationsToPapers.ts` is now import-safe, dry-run-first, supports `--apply`/`--live`, `--dry-run`, and `--output`, uses raw `users`/`papers` collections after one guarded connection instead of stale non-exported schema imports, and blocks production apply mode before Mongo connection. Verification ran red/green `yarn --cwd server test src/scripts/__tests__/publicationMigrationCliSafety.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, and `SCRAPER_ENV=production yarn --cwd data-migration tsx MigratePublicationsToPapers.ts --apply --output /tmp/ylabs-publication-migration-prod-blocked.json`; the probe reached the expected `CONFIRM_PROD_SCRAPE=true` guard before connection output. No publication migration apply, production write, production copy, destructive action, irreversible migration, or data deletion was run. Next selected task: rescan for remaining feasible legacy data-migration safety hardening or stop only if all remaining items are truly blocked.
- 2026-06-02 23:59: Completed legacy root-data import safety hardening. `data-migration/ImportRootDataFiles.ts` is now import-safe, dry-run-first, supports `--apply`/`--live`, `--dry-run`, `--delete-source-files`, `--limit`, and `--output`, wraps review artifacts with source row counts, import stats, and verification counts, and blocks production apply mode before Mongo connection. Verification ran red/green `yarn --cwd server test src/scripts/__tests__/rootDataImportCliSafety.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, and `SCRAPER_ENV=production yarn --cwd data-migration migrate:root-data-files --apply --output /tmp/ylabs-root-data-import-prod-blocked.json`; the probe reached the expected `CONFIRM_PROD_SCRAPE=true` guard before connection output. No root-data import apply, local source-file deletion, production write, production copy, destructive action, irreversible migration, or data deletion was run. Next selected task: consolidate verification, refresh Graphify, then stop only if the remaining roadmap work is blocked by production facts, reviewer decisions/source evidence, post-production cleanup gates, deleted V4 models, or system limits.
- 2026-06-02 00:06: Converted the removed-surface V4 paper graph and stats scripts into explicit blocked artifact runners. `BackfillV4PaperGraph.ts` and `BackfillV4ResearchGroupStats.ts` no longer import deleted `PaperGroupLink` or `ResearchGroupStats` models; they are import-safe, support `--output`, and exit nonzero with structured `status=blocked` artifacts before Mongo connection. Verification ran red/green `yarn --cwd server test src/scripts/__tests__/dataMigrationV4DeprecatedBackfills.test.ts`, `npx tsc --noEmit -p server/tsconfig.json`, and guarded production apply probes for both scripts with `SCRAPER_ENV=production --apply --output <path>`; each wrote a blocked artifact and made no production write, production copy, destructive action, irreversible migration, or data deletion. Next selected task: run consolidated focused tests, whitespace check, Graphify update, then rerun the roadmap feasibility scan.

## Risks And Unknowns

- Risk: Beta commands depend on private MongoDB and Meili environment values from local `.env`; do not print secrets.
- Risk: Applying repair lanes without deterministic candidates could promote weak source evidence. Use read-only reports first.
- Unknown: Current Beta data may have changed since the roadmap snapshot; read-only commands should establish the current baseline.
- Assumption: `SCRAPER_ENV=beta` commands are acceptable because the roadmap explicitly lists them as safe next commands and they are read-only unless `--mode=apply` is used.

## Verification Steps

- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples`
- `SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10`
- Focused tests only if code changes are made.
- `graphify update .` after durable doc changes.
- `yarn --cwd server test src/scrapers/__tests__/runReport.test.ts`
- `yarn --cwd server test src/scrapers/__tests__/entityMaterializer.test.ts`
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts`
- `yarn --cwd server test src/scripts/__tests__/userEmailHygiene.test.ts src/scripts/__tests__/betaDataQualityCore.test.ts`
- `yarn --cwd server test src/scripts/__tests__/duplicateEntityNameReview.test.ts src/scripts/__tests__/betaDataQualityCore.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --output /tmp/ylabs-duplicate-entity-name-review.json`
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts src/scripts/__tests__/betaDataQualityCore.test.ts`
- Six `yarn --cwd server scrape report --run <runId> --output /tmp/ylabs-scraper-reports/<source>-<runId>.json` commands for the current source-health conflict rows.
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `yarn --cwd server test src/scripts/__tests__/staleObservationConflictReview.test.ts` (red first for bounded supersession plans, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=dept-faculty-roster --queue=priority_review --limit=50 --sample-size=3 --plan-limit=5 --output /tmp/ylabs-stale-observation-conflicts-dept-faculty-roster-priority-plan.json`
- `yarn --cwd server test src/scripts/__tests__/duplicateEntityNameReview.test.ts` (red first for category-specific plan output, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --category=shared_website_merge_review --plan-limit=10 --output /tmp/ylabs-duplicate-entity-name-review-shared-website-plan.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --output /tmp/ylabs-duplicate-entity-name-review.json`
- `yarn --cwd server test src/scripts/__tests__/duplicateEntityNameReview.test.ts` (red first for reference-impact counts, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --category=shared_website_merge_review --plan-limit=10 --output /tmp/ylabs-duplicate-entity-name-review-shared-website-plan.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --output /tmp/ylabs-duplicate-entity-name-review.json`
- `yarn --cwd server test src/scripts/__tests__/staleObservationConflictReview.test.ts` (red first for missing implementation, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=dept-faculty-roster --limit=1000 --sample-size=10 --output /tmp/ylabs-stale-observation-conflicts-dept-faculty-roster.json`
- `SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=centers-institutes-index --limit=1000 --sample-size=10 --output /tmp/ylabs-stale-observation-conflicts-centers-institutes-index.json`
- `yarn --cwd server test src/scripts/__tests__/staleObservationConflictReview.test.ts` (red first for queue/category filters, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=dept-faculty-roster --queue=priority_review --limit=500 --sample-size=3 --output /tmp/ylabs-stale-observation-conflicts-dept-faculty-roster-priority.json`
- `SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=centers-institutes-index --queue=priority_review --limit=500 --sample-size=3 --output /tmp/ylabs-stale-observation-conflicts-centers-institutes-index-priority.json`
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` (red first for stale-review row pointers, then green)
- `yarn --cwd server test src/scripts/__tests__/staleObservationConflictReview.test.ts src/scripts/__tests__/sourceHealth.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` (red first for exact review-artifact status, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- Node JSON status inspection of `/tmp/ylabs-source-health.json` review artifact availability
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` (red first for top-level missing-command artifact status, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- Node JSON status inspection of `/tmp/ylabs-source-health.json` `reviewArtifactStatus`
- `yarn --cwd server test src/scripts/__tests__/staleObservationConflictReview.test.ts`
- Six exact `SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=<source> --queue=<queue> --limit=1000 --sample-size=20 --output /tmp/ylabs-stale-observation-conflicts-<source>-<queue>.json` dry-runs for `centers-institutes-index`, `department-undergrad-research`, `dept-faculty-roster`, `ysm-atoz-index`, `nih-reporter`, and `nsf-award-search`
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts src/scripts/__tests__/staleObservationConflictReview.test.ts`
- JSON inspection of `/tmp/ylabs-source-health.json` row-level `fieldCounts`, `policyBucketCounts`, and `reviewArtifactStatus`
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` (red first for missing `reviewArtifactRollups`, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- JSON inspection of `/tmp/ylabs-source-health.json` `reviewSummary.reviewArtifactRollups`
- `yarn --cwd server test src/scripts/__tests__/dataMigrationV4Utils.test.ts`
- `SCRAPER_ENV=production yarn --cwd data-migration migrate:v4:grants --apply --limit=1` (expected pre-connection production-write guard failure)
- `yarn --cwd server test src/scripts/__tests__/dataMigrationV4GrantBackfill.test.ts`
- `SCRAPER_ENV=production yarn --cwd data-migration migrate:v4:grants --apply --limit=1 --output /tmp/ylabs-v4-grants-prod-blocked.json` (expected pre-connection production-write guard failure)
- `yarn --cwd server test src/scripts/__tests__/dataMigrationV4IdentityBackfills.test.ts`
- `SCRAPER_ENV=production yarn --cwd data-migration migrate:v4:faculty-members --apply --limit=1 --output /tmp/ylabs-v4-faculty-prod-blocked.json` (expected pre-connection production-write guard failure)
- `SCRAPER_ENV=production yarn --cwd data-migration migrate:v4:student-profiles --apply --limit=1 --output /tmp/ylabs-v4-students-prod-blocked.json` (expected pre-connection production-write guard failure)
- `SCRAPER_ENV=production yarn --cwd data-migration migrate:v4:research-group-members --apply --limit=1 --output /tmp/ylabs-v4-members-prod-blocked.json` (expected pre-connection production-write guard failure)
- `yarn --cwd server test src/scripts/__tests__/userMigrationCliSafety.test.ts`
- `SCRAPER_ENV=production MONGODBURL_MIGRATION=mongodb+srv://example.invalid/ProductionMigration yarn --cwd data-migration migrate:users --apply --replace-existing --output /tmp/ylabs-user-migration-prod-blocked.json` (expected pre-connection production-write guard failure)
- `yarn --cwd server test src/scripts/__tests__/departmentMigrationCliSafety.test.ts`
- `SCRAPER_ENV=production MONGODBURL_MIGRATION=mongodb+srv://example.invalid/ProductionMigration yarn --cwd data-migration migrate:departments:live --output /tmp/ylabs-department-migration-prod-blocked.json` (expected pre-connection production-write guard failure)
- `yarn --cwd server test src/scripts/__tests__/publicationMigrationCliSafety.test.ts`
- `SCRAPER_ENV=production yarn --cwd data-migration tsx MigratePublicationsToPapers.ts --apply --output /tmp/ylabs-publication-migration-prod-blocked.json` (expected pre-connection production-write guard failure)
- `yarn --cwd server test src/scripts/__tests__/rootDataImportCliSafety.test.ts`
- `SCRAPER_ENV=production yarn --cwd data-migration migrate:root-data-files --apply --output /tmp/ylabs-root-data-import-prod-blocked.json` (expected pre-connection production-write guard failure)
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing rollup lines, then green)
- `yarn --cwd server test src/scripts/__tests__/duplicateEntityNameReview.test.ts` (red first for missing preflight metadata, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --output /tmp/ylabs-duplicate-entity-name-review.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --category=shared_website_merge_review --plan-limit=20 --output /tmp/ylabs-duplicate-entity-name-review-shared-website-plan.json`
- JSON inspection of duplicate-name `planSummary.preflightSummary`
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (red first for missing duplicate-name preflight guidance, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- JSON inspection of `/tmp/ylabs-beta-quality.json` `duplicateEntityNames.planReview.preflightGuidance`
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing duplicate-name preflight rendering, then green)
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server test src/scripts/__tests__/duplicateEntityNameReview.test.ts` (red first for missing accepted-decision parsing/validation, then green)
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --category=shared_website_merge_review --plan-limit=5 --accepted-decisions=/tmp/ylabs-duplicate-name-decisions-empty.json --output /tmp/ylabs-duplicate-entity-name-review-decision-validation.json`
- JSON inspection of `/tmp/ylabs-duplicate-entity-name-review-decision-validation.json` `reviewDecisionValidation`
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (red first for missing scorecard accepted-decision validation guidance, then green)
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- JSON inspection of `/tmp/ylabs-beta-quality.json` `duplicateEntityNames.planReview.preflightGuidance.acceptedDecisionValidation`
- `yarn --cwd server test src/scripts/__tests__/duplicateEntityNameReview.test.ts` (red first for missing decision-template parsing/writing, then green)
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --category=shared_website_merge_review --plan-limit=3 --decision-template-output /tmp/ylabs-duplicate-entity-name-review-decision-template.json --output /tmp/ylabs-duplicate-entity-name-review-template-probe.json`
- JSON inspection of `/tmp/ylabs-duplicate-entity-name-review-decision-template.json`
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (red first for missing scorecard template guidance, then green)
- JSON inspection of `/tmp/ylabs-beta-quality.json` `duplicateEntityNames.planReview.preflightGuidance.acceptedDecisionTemplate`
- `yarn --cwd server test src/scripts/__tests__/staleObservationConflictReview.test.ts` (red first for missing stale-observation accepted-decision/template support, then green)
- `SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=dept-faculty-roster --queue=priority_review --limit=50 --sample-size=3 --plan-limit=3 --accepted-decisions=/tmp/ylabs-stale-observation-decisions-empty.json --decision-template-output /tmp/ylabs-stale-observation-conflicts-dept-faculty-roster-decision-template.json --output /tmp/ylabs-stale-observation-conflicts-dept-faculty-roster-decision-validation.json`
- JSON inspection of `/tmp/ylabs-stale-observation-conflicts-dept-faculty-roster-decision-template.json`
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` (red first for missing stale accepted-decision handoff metadata, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- JSON inspection of `/tmp/ylabs-source-health.json` and `/tmp/ylabs-beta-quality.json` stale `acceptedDecisionTemplate` / `acceptedDecisionValidation`
- `yarn --cwd server test src/scripts/__tests__/crossSourceObservationConflictReview.test.ts` (red first for missing cross-source accepted-decision/template support, then green)
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` (red first for missing cross-source accepted-decision handoff metadata, then green)
- `yarn --cwd server test src/scripts/__tests__/crossSourceObservationConflictReview.test.ts src/scripts/__tests__/sourceHealth.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server observations:cross-source-conflict-review --source=department-undergrad-research --queue=priority_review --limit=50 --sample-size=3 --plan-limit=3 --accepted-decisions=/tmp/ylabs-cross-source-decisions-empty.json --decision-template-output /tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-decision-template.json --output /tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json`
- JSON inspection of `/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-decision-template.json` and `/tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority_review-decision-validation.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- JSON inspection of `/tmp/ylabs-source-health.json` and `/tmp/ylabs-beta-quality.json` cross-source `acceptedDecisionTemplate` / `acceptedDecisionValidation`
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing source-freshness decision handoff paths, then green)

## Substantial Milestone Completed

The guarded Lane A production-copy command is now test-covered at its safety boundary. The implementation keeps CLI behavior intact while allowing focused unit tests to validate dry-run planning, apply-mode restore/confirmation requirements, and explicit observation-skip behavior without connecting to MongoDB or touching production.

The Lane A dry-run summary is also independently testable. The CLI now uses a pure summary builder that reports redacted Beta/Production targets, collection category totals, synthetic-user exclusion counts, and blocked synthetic-user references without requiring MongoDB connections in tests.

The Lane A copy allowlist now includes the canonical research activity collections, `research_scholarly_links` and `research_scholarly_attributions`, so production promotion will not drop the accepted Beta research-activity surface.

The Lane A dry-run summary now has explicit `applyBlockers` and `syntheticReferenceBlockersClear` fields for production review. A dry-run with synthetic-user references is machine-reviewable without hand-parsing the lower-level reference array, while avoiding any false production-readiness claim.

Apply mode now uses the same summary blocker assertion, so dry-run review output and copy execution share one synthetic-user reference decision path.

The guarded Lane A dry-run summary can now be saved directly with `--output <path>`, preserving the same redacted stdout payload as the review artifact without running production copy.

The Operator Board can now consume that saved Lane A dry-run artifact without production access. Clean artifacts surface as `review_required`, not `ready`, while stale, invalid, missing, or blocker-bearing artifacts keep promotion visibly gated.

The research-detail professor click audit has an import-safe core helper for page identity checks, and the 100-profile local audit now passes with zero findings. The previously recorded Astronomy gap is stale in the current local/Beta data because the entity now has current PI member rows linked to `fcv3`.

Analytics events now accept the canonical `student` user type used by auth flows, preventing validation errors during local smoke/audit dev-login paths. The same model test also guards against reintroducing the duplicate ascending timestamp index warning.

The identity/account warning queue now has an executable dry-run command. `users:dedupe-by-identity` can produce review artifacts without writes, while apply mode remains intentionally blocked until user merge and reference rewrite behavior is implemented and reviewed. Scraper integrity repair recommendations now point to that dry-run form.

The suspicious user email warning queue now has an executable dry-run command. `users:email-hygiene` produces review artifacts for synthetic-looking accounts, blocks apply mode, and feeds the `suspiciousUserEmails` data-quality next command. The current local/Beta artifact identifies `devadmin@example.invalid` and `test123@example.invalid`.

The broad `beta:data-quality` scorecard now carries the same suspicious-user Lane A exclusion posture. The current `/tmp/ylabs-beta-quality.json` reports 2 suspicious users with `sampledExcludedByDefault=2`, `sampledNeedsReviewBeforeCopy=0`, and sample-level `productionCopyDisposition=excluded_from_lane_a_users_copy`; this does not claim production readiness because other promotion blockers remain.

Reference-integrity hard failures in `beta:data-quality --include-samples` are now reviewable from the saved artifact. Missing required refs and orphaned scalar/array refs include bounded sample rows with collection, field, owning document id, failure type, and referenced value.

Orphaned research-entity member user references now have a dry-run planner. `research-entity-members:audit-user-refs` can produce review artifacts with exact-name relink proposals, but apply mode remains blocked until a repair path is explicitly reviewed.

The Operator Board now shows data-quality hard errors from saved scorecards, including owner and next command metadata. This prevents `referenceIntegrity` errors from being hidden behind warning-only owner groups.

The orphaned member user-reference queue now has a duplicate-aware guarded repair path. The planner detects when an exact replacement user already has an active membership for the same entity and role, then archives the orphan duplicate member row instead of relinking into a unique-index collision. The current Beta orphan duplicate for `nih-pi-nancy-brown` was archived without data deletion, and the follow-up member-reference audit reports zero active orphan member user references.

`beta:data-quality` now scopes the `research_entity_members.userId` reference check to non-archived owner rows. This matches runtime/query semantics and prevents archived repair artifacts from keeping the reference-integrity gate in hard-error state. The refreshed Beta scorecard is warning-only with `referenceIntegrity.hardFailureTotal=0`.

`research-entity:dedupe-by-pi` now has bounded apply safety for the duplicate-entity warning queue. Dry-runs include `maxApply`, apply mode blocks batches larger than the explicit bound, and archive-mode reference conflicts fail instead of deleting non-archivable rows. The current Beta dry-run has 32 same-PI duplicate entity archive plans and no duplicate current-member repairs; the unbounded apply probe was blocked before writes.

The client production-promotion smoke helper now has a pure core module for argument parsing, report initialization, and internal-label detection. Focused tests verify that smoke cookies are not serialized into reports and that Operator Board copy is only allowed in explicit admin-board contexts.

The smoke helper also validates configured targets before any network call. Runbook placeholders and malformed targets now create a structured `smoke.config.validTargets` failure report instead of being mistaken for a real smoke attempt.

Smoke CLI output is now summarized through a pure helper shared by normal and config-blocked exits, so failure and warning lists used in promotion review are covered by focused tests.

`beta:data-quality` now treats active research-entity content-page leaks as an actionable pre-promotion queue item instead of an unlabeled warning. The warning carries owner/classification/next-command metadata for operator review.

`beta:data-quality` also exposes must-fix warning rows as first-class `promotionBlockers`, so production review can inspect blocker count and blocker rows without re-filtering the full warning list.

`beta:data-quality` now emits `promotionReady`, making the pre-production audit outcome machine-readable without treating accepted release warnings as blockers.

Operator Board status/action helpers now understand data-quality readiness inputs, preparing the admin surface to consume persisted or injected promotion-audit results without guessing from generic warning text.

Operator Board data-quality gate status is now mapped through a pure helper, preserving current manual behavior while supporting `blocked` and `ready` states when data-quality promotion summaries are available.

The Operator Board UI now displays each gate status explicitly, so a blocked data-quality state is visible next to its command and note instead of hidden inside backend fields.

The Operator Board can now consume the saved Beta data-quality scorecard artifact produced by `yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`. When the artifact is present and well formed, `promotionReady` and `promotionBlockerCount` feed the data-quality gate, top-level promotion status, and recommended next actions; malformed artifacts stay manual rather than creating false readiness.

`beta:data-quality` now emits owner-grouped promotion blockers in `promotionBlockersByOwner`, giving the review packet a machine-readable owner queue without parsing the full warning list.

The Operator Board now carries those owner-grouped blockers from saved scorecard artifacts into the data-quality gate card, so operators can see which owner queue has which must-fix blocker names before production promotion.

Saved Beta data-quality scorecards older than 48 hours are treated as stale manual gate work, not promotion-readiness evidence. The gate payload includes artifact age and the admin UI renders it so stale review inputs are visible before promotion.

Saved scraper integrity gate artifacts now follow the same Operator Board pattern. A fresh `/tmp/ylabs-scraper-integrity.json` can drive pass/watch/failure state without production access, while stale or malformed artifacts remain manual gate work.

`scraper:integrity-gate` can now write that artifact directly with `--output /tmp/ylabs-scraper-integrity.json`, preserving JSON stdout for existing workflows.

`launch:trust-contract` now has the same output-file pattern for `/tmp/ylabs-launch-trust-contract.json`, preserving stdout and strict failure exit semantics.

`pathway:quality-audit` now has the same output-file pattern for pathway/access/contact quality reports, preserving stdout while producing a saved review artifact.

`application-routes:backfill-pathways` now has a testable output-file pattern for official-application route backfill review artifacts, preserving dry-run-first behavior and stdout.

Posted-opportunity maintenance commands now share the review-artifact pattern. `posted-opportunities:backfill` and `opportunities:reap-statuses` can save dry-run/apply outputs without hand-copying stdout and can be imported in tests without opening a MongoDB connection.

`research:quality-search-review` now shares the same artifact pattern for golden-query search confidence reports, with pure parser/writer coverage that does not require MongoDB or Meili.

`profile-image:quality-audit` now shares the same artifact pattern for public profile image trust reports, with pure parser/writer coverage that does not require MongoDB.

`research-entity:coverage-audit` now shares the same artifact pattern for source/action/contact coverage reports, with pure parser/writer coverage that does not require MongoDB.

`papers:quality-audit` / `scholarly-links:quality-audit` now shares the same artifact pattern for launch research-activity display-quality reports, with pure parser/writer coverage that does not require MongoDB. The scraper-integrity artifact path also keeps its claim-gate extension type-safe under full server typecheck.

`scholarly-links:provenance-audit` and `scholarly-links:suppression-audit` now share the same artifact pattern for research-activity provenance and cleanup review reports, with pure parser/writer coverage that does not require MongoDB.

`beta:readiness` now shares the same artifact pattern for readiness gate packets, with pure parser/writer coverage that does not require MongoDB.

`accepted-inputs` now shares the artifact pattern for status and validation/report commands without repurposing `--output` for commands where it already means the generated CSV/text candidate file.

`pathway:relevance-review` now shares the artifact pattern for Mongo-vs-Meili relevance review packets, preserving strict-mode behavior and rollback guidance without requiring MongoDB or Meili in helper tests.

`papers:authorship-audit` now shares the artifact pattern for identity-backed paper proof audits, preserving dry-run/apply behavior without requiring MongoDB in helper tests.

`meili:rebuild-pathways` and `meili:rebuild-research-entities` now share the artifact pattern for search-index rebuild reports, preserving clear/page-size behavior without requiring MongoDB or Meili in helper tests.

`student-visibility:backfill` now shares the artifact pattern for visibility dry-run/apply reports, preserving collection selection and apply-safety blockers without requiring MongoDB in helper tests.

`repairListingResearchEntityProfiles` now shares the artifact pattern for listing-backed ResearchEntity profile repair reports, preserving dry-run/apply behavior without requiring MongoDB in helper tests.

`backfillProgramClassifications` now shares the artifact pattern for program-classification dry-run/apply reports, preserving apply guards without requiring MongoDB in helper tests.

`research-entity:audit-rename` now shares the artifact pattern for canonical rename readiness reports, preserving the read-only audit behavior without requiring MongoDB in helper tests.

Exact source-health follow-up artifacts are now complete for the current warning set. Stale same-source and cross-source observation review artifacts are dry-run-only, include field/category/policy rollups, and are summarized directly in `source:health`; the latest wrapper artifact reports all 6 stale-review artifacts and both cross-source artifacts available, with no apply or supersession performed.

`source:health` now also exposes compact top-level review artifact rollups across the available stale and cross-source artifacts. The rollup lets operators see which fields and policy buckets dominate the source-health blocker without scanning each per-source artifact.

The Operator Board source-freshness card now renders those source-health rollups, so the admin surface shows which stale/cross fields and policy buckets dominate the blocker without opening `/tmp/ylabs-source-health.json`.

Duplicate-name review artifacts now carry merge/archive preflight metadata without enabling apply mode. The current shared-website queue is implementation-ready for reviewer decisions, not production-ready: all 20 shared-website plans still require confirmation that the shared website is one research home, canonical entity selection, and guarded reference rewrite/archive behavior.

The broad Beta data-quality scorecard now includes compact duplicate-name preflight guidance, pointing reviewers to the exact category artifact and expected preflight fields while keeping full plan details out of the weekly scorecard.

Shared legacy V4 migration utility guardrails are now independently testable. `connectForMigration` blocks production apply mode through the shared production-write guard before Mongo connection, and focused tests cover option parsing, production apply blocking, and artifact metadata wrapping without running legacy migrations.

The V4 grant backfill is now import-safe and review-artifact-aware. It reuses the shared V4 output wrapper, can be imported in tests without opening Mongo, and keeps production apply mode blocked before connection.

The removed-surface V4 paper graph and stats scripts are now explicit blocked artifact runners instead of deleted-model import crashes. `BackfillV4PaperGraph.ts` and `BackfillV4ResearchGroupStats.ts` do not connect to Mongo; they write structured `status=blocked` artifacts explaining that any future migration must be redesigned against current paper-authorship, research-activity, analytics, or operator-report semantics.

The live-model V4 identity backfills are now import-safe and review-artifact-aware. Faculty, student, and research-group-member backfills no longer open Mongo on import, and each blocks production apply mode before connection through the shared V4 guard.

The legacy user migration copy script is now independently testable and dry-run-first. Importing it no longer copies or deletes users, apply mode is blocked in production without `CONFIRM_PROD_SCRAPE=true`, and clearing existing target users requires an explicit `--replace-existing` flag after reviewing a dry-run artifact.

The legacy department migration script is now independently testable and dry-run-first. Importing it no longer opens source/target connections or updates listings, apply mode is blocked in production without `CONFIRM_PROD_SCRAPE=true`, and saved artifacts include source/target labels plus parsed options.

The legacy embedded-publications migration is now independently testable and dry-run-first. Importing it no longer opens Mongo, stale non-exported schema imports were removed in favor of raw collection access after connection, and production apply mode is blocked without `CONFIRM_PROD_SCRAPE=true`.

The legacy root-data import is now independently testable and dry-run-first. Importing it no longer opens Mongo or touches loose source files, apply mode is blocked in production without `CONFIRM_PROD_SCRAPE=true`, and optional source-file deletion remains apply-only after clean verification.

## Blocked Work

- Production promotion remains blocked on a fresh Atlas restore point, guarded copy dry-run review against the real Production target, rollback-tested status, and production smoke verification.
- Production writes/copy, `SCRAPER_ENV=production`, retention `--apply`, and production cron remain blocked.
- PI claim flow, Scholar disambiguation, and broader admin field-lock UI remain blocked until workflow requirements are concrete.
- Post-Beta legacy cleanup remains blocked until production copy/smoke proves canonical surfaces.

## Currently In Progress

Continuing from the warning-only Beta data-quality state after clearing the active member-reference hard failure, bounding duplicate-entity applies, fixing stale source-health routing, making the suspicious-user email artifacts copy-aware, adding duplicate-name and observation-conflict review artifacts, summarizing source-health conflict reviews, applying the bounded visibility repair-queue slice, hardening legacy seed/import utilities, hardening shared V4/live-model backfill guards, hardening the legacy user/departments/embedded-publication/root-data migration scripts, and converting removed-surface V4 paper graph/stats scripts into explicit blocked artifact runners. Production promotion itself remains blocked on true external production requirements; the remaining launch/data-quality repair queues are blocked on reviewer decisions or new official source evidence.

## Exact Next Command Or Task

Next selected engineering task: rescan `docs/tasks/priority-roadmap.md` and the remaining unchecked/blocker work for any feasible non-production code-bearing item that does not require production writes, production copy, destructive actions, data deletion, credentials, paid services, accepted reviewer decisions, or new official source evidence. Do not run production smoke or production copy without the missing external gate facts.

```bash
yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts
```

Do not run apply mode or production copy while the restore point, Production dry-run review, rollback-tested status, and production smoke verification remain unrecorded.

## Files Modified

- `docs/scraper-deployment-runbook.md`
- `docs/tasks/priority-roadmap.md`
- `docs/tasks/current-execution-plan.md`
- `server/src/scripts/promoteAcceptedBetaCopy.ts`
- `server/src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts`
- `server/src/services/adminOperatorBoardService.ts`
- `server/src/services/__tests__/adminOperatorBoardService.test.ts`
- `client/src/components/admin/AdminOperatorBoard.tsx`
- `client/src/components/admin/__tests__/AdminOperatorBoard.test.tsx`
- `client/scripts/productionPromotionSmoke.mjs`
- `client/scripts/productionPromotionSmokeCore.mjs`
- `client/src/utils/__tests__/productionPromotionSmokeCore.test.ts`
- `server/src/scripts/betaDataQualityCore.ts`
- `server/src/scripts/__tests__/betaDataQualityCore.test.ts`
- `server/src/scripts/betaDataQuality.ts`
- `server/src/scripts/betaDataQualityCore.ts`
- `server/src/scripts/researchEntityMemberReferenceAuditCore.ts`
- `server/src/scripts/researchEntityMemberReferenceAudit.ts`
- `server/src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts`
- `server/src/models/researchGroupMember.ts`
- `server/src/scripts/dedupeResearchEntitiesByPi.ts`
- `server/src/scripts/__tests__/researchEntityPiDedupeCore.test.ts`
- `server/src/services/adminOperatorBoardService.ts`
- `server/src/services/__tests__/adminOperatorBoardService.test.ts`
- `client/src/components/admin/AdminOperatorBoard.tsx`
- `client/src/components/admin/__tests__/AdminOperatorBoard.test.tsx`
- `server/src/scripts/scraperIntegrityGate.ts`
- `server/src/scripts/__tests__/scraperIntegrityGate.test.ts`
- `server/src/scripts/launchTrustContract.ts`
- `server/src/scripts/__tests__/launchTrustContract.test.ts`
- `server/src/scripts/launchAcquisitionReport.ts`
- `server/src/scripts/__tests__/launchAcquisitionReport.test.ts`
- `server/src/scripts/betaRepairQueue.ts`
- `server/src/scripts/__tests__/betaRepairQueue.test.ts`
- `server/src/scripts/studentVisibilityGate.ts`
- `server/src/scripts/__tests__/studentVisibilityGate.test.ts`
- `server/src/scripts/dedupeExploratoryContactPathways.ts`
- `server/src/scripts/__tests__/dedupeExploratoryContactPathways.test.ts`
- `server/src/scripts/dedupeResearchEntitiesByPi.ts`
- `server/src/scripts/__tests__/researchEntityPiDedupeCore.test.ts`
- `server/src/scripts/sourceHealth.ts`
- `server/src/scripts/__tests__/sourceHealth.test.ts`
- `server/src/scripts/pathwayQualityAudit.ts`
- `server/src/scripts/__tests__/pathwayQualityAuditCore.test.ts`
- `server/src/scripts/backfillApplicationRoutePathways.ts`
- `server/src/scripts/__tests__/applicationRoutePathwayBackfillCore.test.ts`
- `server/src/scripts/backfillPostedOpportunitiesFromListings.ts`
- `server/src/scripts/reapPostedOpportunityStatuses.ts`
- `server/src/scripts/__tests__/postedOpportunityMaintenanceCli.test.ts`
- `server/src/scripts/researchQualitySearchReview.ts`
- `server/src/scripts/__tests__/researchQualitySearchReviewCore.test.ts`
- `server/src/scripts/profileImageQualityAudit.ts`
- `server/src/scripts/__tests__/profileImageQualityAuditCore.test.ts`
- `server/src/scripts/researchEntityCoverageAudit.ts`
- `server/src/scripts/__tests__/researchEntityCoverageAudit.test.ts`
- `server/src/scripts/paperQualityAudit.ts`
- `server/src/services/__tests__/paperQualityService.test.ts`
- `server/src/scripts/scraperIntegrityGate.ts`
- `server/src/scripts/scholarlyLinkProvenanceAudit.ts`
- `server/src/scripts/scholarlyLinkSuppressionAudit.ts`
- `server/src/scripts/__tests__/scholarlyLinkAuditCli.test.ts`
- `server/src/scripts/betaReadinessGate.ts`
- `server/src/scripts/__tests__/betaReadinessGate.test.ts`
- `server/src/scripts/acceptedInputs.ts`
- `server/src/scripts/__tests__/acceptedInputs.test.ts`
- `server/src/scripts/pathwayRelevanceReview.ts`
- `server/src/scripts/__tests__/pathwayRelevanceReview.test.ts`
- `server/src/scripts/paperAuthorshipAudit.ts`
- `server/src/scripts/__tests__/paperAuthorshipAudit.test.ts`
- `server/src/scripts/rebuildPathwaySearchIndex.ts`
- `server/src/scripts/rebuildResearchEntitySearchIndex.ts`
- `server/src/scripts/__tests__/searchIndexRebuildCli.test.ts`
- `server/src/scripts/backfillStudentVisibilityTiers.ts`
- `server/src/scripts/__tests__/studentVisibilityBackfillReport.test.ts`
- `server/src/scripts/repairListingResearchEntityProfiles.ts`
- `server/src/scripts/__tests__/repairListingResearchEntityProfiles.test.ts`
- `server/src/scripts/backfillProgramClassifications.ts`
- `server/src/scripts/__tests__/backfillProgramClassifications.test.ts`
- `server/src/scripts/auditResearchEntityRename.ts`
- `server/src/scripts/__tests__/auditResearchEntityRename.test.ts`
- `scripts/research-detail-professor-audit.mjs`
- `scripts/research-detail-professor-audit-core.mjs`
- `server/src/scripts/__tests__/researchDetailProfessorAuditCore.test.ts`
- `server/src/models/analytics.ts`
- `server/src/models/__tests__/analytics.test.ts`
- `server/src/scripts/dedupeUsersByIdentity.ts`
- `server/src/scripts/__tests__/dedupeUsersByIdentityCli.test.ts`
- `server/src/scripts/__tests__/dedupeUsersByIdentityCore.test.ts`
- `server/src/scripts/userEmailHygieneCore.ts`
- `server/src/scripts/userEmailHygiene.ts`
- `server/src/scripts/__tests__/userEmailHygiene.test.ts`
- `server/src/services/sourceHealthService.ts`
- `server/src/services/__tests__/sourceHealthService.test.ts`
- `server/src/scripts/researchEntityMemberReferenceAuditCore.ts`
- `server/src/scripts/researchEntityMemberReferenceAudit.ts`
- `server/src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts`
- `server/src/scrapers/integrityGate.ts`
- `server/package.json`
- `server/src/scrapers/sources/studentDecisionLLMExtractor.ts`
- `server/src/scrapers/workPlanner.ts`
- `server/src/scrapers/__tests__/workPlanner.test.ts`
- `server/src/scrapers/sources/departmentRosterScraper.ts`
- `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` after Graphify refresh

## Checks Run

- `SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3`
- Five `SCRAPER_ENV=beta yarn --cwd server scrape report --run <runId> --output /tmp/ylabs-scraper-reports/<source>-<runId>.json` commands
- Node JSON summary check for the five saved source-health reports
- `yarn --cwd server test src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`
- `yarn --cwd client test:ci src/utils/__tests__/productionPromotionSmokeCore.test.ts`
- `node --check client/scripts/productionPromotionSmoke.mjs`
- `node client/scripts/productionPromotionSmoke.mjs --ui=false --api-base 'https://<host>/api' --app-base https://app.example.test --out tmp/production-smoke-placeholder-check` exited 1 with only `smoke.config.validTargets` and no network smoke.
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts`
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts`
- `yarn --cwd server test src/scripts/__tests__/launchTrustContract.test.ts`
- `yarn --cwd server test src/scripts/__tests__/launchAcquisitionReport.test.ts`
- `yarn --cwd server test src/scripts/__tests__/betaRepairQueue.test.ts`
- `yarn --cwd server test src/scripts/__tests__/studentVisibilityGate.test.ts`
- `yarn --cwd server test src/scripts/__tests__/dedupeExploratoryContactPathways.test.ts`
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts`
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts`
- `yarn --cwd server test src/scripts/__tests__/pathwayQualityAuditCore.test.ts`
- `yarn --cwd server test src/scripts/__tests__/applicationRoutePathwayBackfillCore.test.ts`
- `yarn --cwd server test src/scripts/__tests__/postedOpportunityMaintenanceCli.test.ts`
- `yarn --cwd server test src/scripts/__tests__/researchQualitySearchReviewCore.test.ts`
- `yarn --cwd server test src/scripts/__tests__/profileImageQualityAuditCore.test.ts`
- `yarn --cwd server test src/scripts/__tests__/researchEntityCoverageAudit.test.ts`
- `yarn --cwd server test src/scripts/__tests__/claimGate.test.ts src/services/__tests__/claimValidation.test.ts`
- `yarn --cwd server test src/services/__tests__/paperQualityService.test.ts`
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts`
- `yarn --cwd server test src/scripts/__tests__/scholarlyLinkAuditCli.test.ts`
- `yarn --cwd server test src/scripts/__tests__/betaReadinessGate.test.ts`
- `yarn --cwd server test src/scripts/__tests__/acceptedInputs.test.ts`
- `yarn --cwd server test src/scripts/__tests__/pathwayRelevanceReview.test.ts`
- `yarn --cwd server test src/scripts/__tests__/paperAuthorshipAudit.test.ts`
- `yarn --cwd server test src/scripts/__tests__/searchIndexRebuildCli.test.ts`
- `yarn --cwd server test src/scripts/__tests__/studentVisibilityBackfillReport.test.ts`
- `yarn --cwd server test src/scripts/__tests__/repairListingResearchEntityProfiles.test.ts`
- `yarn --cwd server test src/scripts/__tests__/backfillProgramClassifications.test.ts`
- `yarn --cwd server test src/scripts/__tests__/auditResearchEntityRename.test.ts`
- `yarn --cwd server test src/scripts/__tests__/researchDetailProfessorAuditCore.test.ts`
- `node --check scripts/research-detail-professor-audit.mjs`
- `node --check scripts/research-detail-professor-audit-core.mjs`
- `AUDIT_LIMIT=100 yarn audit:research-detail-professors` (passed with 44 audited profiles, 0 findings after the audit helper fix)
- `yarn --cwd server test src/models/__tests__/analytics.test.ts`
- `yarn --cwd server test src/scripts/__tests__/dedupeUsersByIdentityCli.test.ts`
- `yarn --cwd server test src/scripts/__tests__/dedupeUsersByIdentityCore.test.ts`
- `yarn --cwd server users:dedupe-by-identity --limit=1 --sample-size=1 --output /tmp/ylabs-user-dedupe-smoke.json`
- `yarn --cwd server users:dedupe-by-identity --limit=1000 --sample-size=10 --output /tmp/ylabs-user-dedupe-identity-review.json`
- `yarn --cwd server test src/scripts/__tests__/userEmailHygiene.test.ts`
- `yarn --cwd server test src/scripts/__tests__/userEmailHygiene.test.ts` (red first for production-copy exclusion fields, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server users:email-hygiene --limit=1000 --sample-size=10 --output /tmp/ylabs-user-email-hygiene.json`
- `yarn --cwd server source-health --help` (failed: no script named `source-health`; correct script is `source:health`)
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts`
- `yarn --cwd server test src/scripts/__tests__/userEmailHygiene.test.ts src/scripts/__tests__/betaDataQualityCore.test.ts`
- `yarn --cwd server users:email-hygiene --limit=1000 --sample-size=10 --output /tmp/ylabs-user-email-hygiene.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `yarn --cwd server test src/services/__tests__/sourceHealthService.test.ts` (red first for `visibility-repair-queue` next command, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --mode=dry-run --limit=100 --output /tmp/ylabs-visibility-repair-queue-dry-run.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --mode=apply --limit=100 --output /tmp/ylabs-visibility-repair-queue-apply.json`
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=apply --output /tmp/ylabs-student-visibility-gate.json`
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities`
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict --output /tmp/ylabs-launch-trust-contract.json` (expected exit 1 for remaining completeness lanes; 0 public visibility violations)
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10 --output /tmp/ylabs-launch-acquisition-report.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=research --stage=pi_identity --mode=dry-run --retry-blocked --limit=250 --output /tmp/ylabs-beta-repair-pi-identity.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=research --stage=pi_identity --mode=apply --retry-blocked --limit=250 --output /tmp/ylabs-beta-repair-pi-identity-apply.json`
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=apply --output /tmp/ylabs-student-visibility-gate.json`
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities`
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict --output /tmp/ylabs-launch-trust-contract.json` exited 1 because launch completeness lanes remain; public visibility violations stayed 0 and research activity/paper quality passed.
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10 --output /tmp/ylabs-launch-acquisition-report.json` (after PI apply; 0 exact PI/user matches and 0 source-backed route materialization candidates)
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` (red first for no-delete archive conflict policy, then green)
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` (red first for sequential group apply, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --output /tmp/ylabs-research-entity-dedupe.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --apply --output /tmp/ylabs-research-entity-dedupe-apply-blocked.json` exited 1 before writes with `Apply would modify 32 rows, above --max-apply.`
- `yarn --cwd server research-entity:dedupe-by-pi --funding-only --limit=10000 --output /tmp/ylabs-research-entity-dedupe-funding-only.json`
- `yarn --cwd server research-entity:dedupe-by-pi --reviewed-profile-area-only --limit=10000 --output /tmp/ylabs-research-entity-dedupe-reviewed-profile-area.json`
- `yarn --cwd server research-entity:dedupe-by-pi --official-lab-url-only --limit=10000 --output /tmp/ylabs-research-entity-dedupe-official-lab-url.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --reviewed-profile-area-only --limit=10000 --max-apply=3 --apply --output /tmp/ylabs-research-entity-dedupe-reviewed-profile-area-apply.json` exited 1 after the new guard blocked deletion on an `entry_pathways` duplicate-key conflict; subsequent dry-run showed 0 reviewed-profile-area plans.
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=apply --output /tmp/ylabs-student-visibility-gate.json`
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities`
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict --output /tmp/ylabs-launch-trust-contract.json` exited 1 because launch completeness lanes remain; public visibility violations stayed 0 and research activity/paper quality passed.
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --output /tmp/ylabs-research-entity-dedupe.json` (after profile-area cleanup; 29 planned duplicate entities remain)
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` (red first for archive-only conflict retry, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` (red first for duplicate-review breakdown, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --output /tmp/ylabs-research-entity-dedupe.json` (with `reviewBreakdown`: 29 cross-department groups, 10 high research-area merge groups, 1 funding-source group, 0 reviewed-profile-area groups)
- `yarn --cwd server test src/services/__tests__/sourceHealthService.test.ts` (red first for source-health `reviewArtifact`, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (after reference-integrity sample helpers)
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` (after reference-integrity sample helpers)
- `yarn --cwd server test src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts`
- `yarn --cwd server test src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts src/scripts/__tests__/betaDataQualityCore.test.ts`
- `yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --max-apply=1 --apply --confirm-exact-relink --output /tmp/ylabs-member-user-ref-audit-apply.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity-members:audit-user-refs --limit=1000 --output /tmp/ylabs-member-user-ref-audit-after-apply.json`
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=apply --output /tmp/ylabs-student-visibility-gate.json`
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities`
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict --output /tmp/ylabs-launch-trust-contract.json` exited 1 because launch completeness lanes remain; public visibility violations stayed 0 and research activity/paper quality passed.
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` (after archived-owner reference filtering; status warn, errorCount 0)
- `yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --output /tmp/ylabs-research-entity-dedupe.json`
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --apply --output /tmp/ylabs-research-entity-dedupe-apply-blocked.json` exited 1 before writes with `Apply would modify 32 rows, above --max-apply.`
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx`
- `yarn --cwd server test src/scrapers/__tests__/studentDecisionLLMExtractor.test.ts`
- `yarn --cwd server test src/scrapers/__tests__/workPlanner.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `node --check scripts/research-detail-professor-audit.mjs`
- `AUDIT_LIMIT=3 yarn audit:research-detail-professors`
- `AUDIT_LIMIT=25 yarn audit:research-detail-professors`
- `yarn --cwd client test:ci src/pages/__tests__/labDetail.test.tsx`
- `yarn --cwd server test src/services/__tests__/profileService.test.ts`
- `yarn --cwd server test src/services/__tests__/researchGroupService.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json` (passed after the scraper report conflict-review change)

## Latest Continuation

2026-05-31: Continued the Beta trust-audit warning queues. The member-reference hard failure was converted from a dry-run relink proposal into a duplicate-aware guarded repair. A first apply attempt failed safely on Mongo's `{researchEntityId,userId,role}` unique index, which exposed the correct root cause: the orphan row duplicated an existing active Nancy Brown PI member row. The planner now proposes `archive_orphan_duplicate_member`, the bounded Beta apply archived row `6a191173dd73647909b517a6`, and the follow-up member-reference dry-run reports zero active orphan member user references.

The refreshed broad `beta:data-quality` artifact at `/tmp/ylabs-beta-quality.json` is now warning-only with `errorCount=0` and `referenceIntegrity.hardFailureTotal=0`. Remaining warning-class promotion blockers are `sourceHealthWarnings`, `duplicateEntityNames`, and `suspiciousUserEmails`. The duplicate-entity queue dry-run currently has 32 same-PI archive plans, but apply is bounded by default and deletion-on-conflict is blocked in archive mode.

The visibility repair queue and the follow-up exact PI lane have been exhausted for deterministic non-production applies. The latest acquisition artifact has no exact PI/user matches and no source-backed route materialization candidates; remaining PI/action rows require new source acquisition, improved materializer logic, or manual disambiguation.

The duplicate-entity queue is safer but still not fully clear. Three reviewed profile-area duplicate shells were removed from the active plan without deletion, and the code now blocks archive-mode conflict deletion, retries duplicate artifact conflicts as archive-only updates, applies groups sequentially, and emits a review breakdown. The broader same-PI queue still has 29 planned archive rows; the current breakdown marks all of them as cross-department research-area merges, so they need review before any further apply.

The duplicate normalized-name warning is now split into review categories in `/tmp/ylabs-beta-quality.json`: 20 `shared_website_merge_review`, 8 `cross_department_same_person_review`, and 6 `same_label_disambiguation`. This makes the warning implementation-ready for a future review/apply path but does not authorize blind merging or deletion.

The duplicate normalized-name queue also has a standalone read-only artifact command. `research-entity:duplicate-name-review` writes the categorized queue to `/tmp/ylabs-duplicate-entity-name-review.json`, blocks apply mode entirely, and avoids emitting contact emails. `beta:data-quality` now points the `duplicateEntityNames` blocker to this command.

The duplicate normalized-name command now also emits bounded dry-run plans. The shared-website-only artifact planned 10 of 20 shared-website clusters; the main artifact planned 20 of 34 clusters across categories. Plans do not choose canonical entities and carry an explicit blocked-apply reason, so the queue is more implementation-ready without authorizing merges, archives, or deletion.

Those duplicate-name plans now include reference-impact counts by entity and total. The counts cover active pathways, access signals, contact routes, members, research scholarly links/attributions, posted opportunities, listings, and active research-entity observations, so reviewers can see whether a proposed merge/archive would be low-impact or require broader relinking work before any write path exists.

The broad Beta data-quality artifact now exposes compact duplicate-name plan guidance under `duplicateEntityNames.planReview`. It lists category counts and exact commands for the all-categories, shared-website, cross-department same-person, and same-label-disambiguation dry-run artifacts, without embedding the full plan list in the weekly scorecard. Apply remains blocked until a guarded merge/archive path exists.

Duplicate-name plans now also include preflight readiness metadata. The all-plan artifact summarizes 10 merge-preflight-ready clusters, 10 manual-disambiguation-required clusters, and 361 impacted references in the first 20 plans; the shared-website artifact summarizes 20 merge-preflight-ready clusters and 281 impacted references. This remains review metadata only.

The broad Beta data-quality artifact now exposes duplicate-name preflight guidance under `duplicateEntityNames.planReview.preflightGuidance`, including the expected preflight fields and shared-website reviewer decisions. It points to the standalone artifacts rather than embedding plans.

The Operator Board now surfaces duplicate-name preflight guidance from saved Beta data-quality artifacts inside the data-quality gate. Reviewers can see the shared-website plan artifact path, cluster count, required reviewer decisions, and manual-review categories without opening the broad scorecard by hand. This remains review metadata only and does not clear the data-quality or production-promotion blocker.

The duplicate-name review command now also validates accepted reviewer-decision artifacts without enabling writes. `--accepted-decisions=<path>` accepts either a JSON array or `{ "decisions": [...] }`; validation checks generated plan ids, canonical ids, duplicate plan decisions, unmatched plan ids, and whether `merge_into_canonical` is limited to `merge_preflight_ready_for_review` plans. The verification artifact used an empty decisions file, so no human decision has been asserted.

The broad Beta data-quality scorecard now points to that accepted-decision validation path directly. Its duplicate-name preflight guidance lists the accepted-decision JSON fields, default input/output paths, exact validation command, and expected `reviewDecisionValidation` output field so the next operator does not have to infer the command from CLI code.

The duplicate-name review command also writes accepted-decision templates. `--decision-template-output <path>` produces one stub per generated plan, preserving the plan id, entity ids/slugs, shared website, preflight status, reference-impact totals, and required reviewer decisions while leaving decision fields blank. The broad scorecard now advertises that template command next to the validation command.

The stale same-source observation review command now has the same dry-run reviewer scaffold. Templates preserve each plan's keep observation and supersede observation ids, and accepted-decision validation rejects unmatched plans or keep/supersede drift before any guarded supersession apply path exists. The Beta verification used an empty decisions file and accepted no supersessions.

`source:health` now exposes that stale reviewer scaffold in the saved source-health packet itself. Each same-source `staleObservationReview` row includes exact accepted-decision template and validation commands, expected JSON fields, and default `/tmp/ylabs-stale-observation-conflicts-<source>-<queue>-...` paths. The broad `beta:data-quality` source-health embedding carries the same metadata, so reviewers do not need to infer the handoff from CLI code. This is still dry-run metadata only; no stale observation supersession was accepted or applied.

The suspicious-user warning is also copy-aware inside `/tmp/ylabs-beta-quality.json`: both sampled synthetic-looking users are marked `excluded_from_lane_a_users_copy`. This reduces review ambiguity but does not clear the promotion blocker until the full production dry-run review confirms no copied record references excluded users.

The source-health queue is still warning-blocked, but the warning rows are now more implementation-ready. The six materialization-conflict rows carry structured report-review metadata, and their regenerated scraper report artifacts now include bounded active-observation conflict reviews under `quality.materializationConflictReview`. Materializer-managed `lastObservedAt` observations are no longer counted in future resolver conflicts or report conflict samples, and report artifacts classify remaining conflicts by additive metadata, identity/routing, content, access-evidence, funding-context, or other categories. `visibility-repair-queue` still warns because it is a repair queue with no source run, even though its bounded repair artifacts exist.

The source-health artifact itself now summarizes those saved scraper reports. The current `/tmp/ylabs-source-health.json` review summary reports all six conflict report artifacts available, 445 active observation conflicts, 313 actionable conflicts, and category totals: additive metadata 132, identity/routing 129, content 60, funding context 47, other 40, and access evidence 37.

The source-health artifact now also partitions those categories into review queues: 226 priority-review conflicts (identity/routing, content, access evidence), 87 context-review conflicts (funding or uncategorized context), and 132 metadata-review conflicts (additive metadata). Per-row `primaryReviewQueue` values make `centers-institutes-index`, `department-undergrad-research`, `dept-faculty-roster`, and `ysm-atoz-index` the priority review lane, while `nih-reporter` and `nsf-award-search` are context review lanes. The six saved scraper report artifacts now include `reviewQueue` on samples and sort priority-review samples first.

The conflict review artifacts now also split same-source from cross-source conflicts. Current totals are 370 same-source and 75 cross-source conflicts. `dept-faculty-roster` has 168 same-source / 0 cross-source conflicts, which points toward a future stale same-source observation cleanup path; `department-undergrad-research` has 23 same-source / 55 cross-source conflicts and likely needs field/source-specific review rather than a blanket supersession policy.

The Operator Board now surfaces that source-health review summary inside Source Freshness when present, including report artifact availability, actionable conflict count, top conflict categories, and the priority/context/metadata queue split.

The broad Beta data-quality artifact also embeds the same source-health review summary under `sourceHealth.reviewSummary`, so weekly scorecards and admin review packets can see the warning category totals and review queue split without opening a separate source-health file.

The same-source observation cleanup path now has a concrete read-only artifact command. `observations:stale-conflict-review` found `dept-faculty-roster` still capped at 1000 candidate groups with 1213 candidate supersede observations, and `centers-institutes-index` has 69 candidate groups with 69 candidate supersede observations. It now supports source-health-aligned queue/category/field filtering; the first priority-queue artifacts found 444 `dept-faculty-roster` identity/routing groups and 40 `centers-institutes-index` identity/routing groups. `source:health` now embeds exact stale-review commands for same-source conflict rows, and the broad Beta data-quality artifact carries the same pointers. The command also emits bounded `plans` with proposed keep/supersede ids and blocked-apply reasons. Apply mode remains blocked; these artifacts make the next implementation step a guarded supersession policy rather than hand-parsed CLI JSON.

The cross-source observation review path now has an executable dry-run command. `observations:cross-source-conflict-review` is source-scoped to avoid unbounded aggregation, keeps only resolver-confirmed mixed-source conflicts, redacts direct-contact previews, and emits plans by entity/field with observation ids grouped by source. The latest artifacts found 47 priority-review candidates for `department-undergrad-research` and 7 for `ysm-atoz-index`; source-health and broad Beta data-quality now expose exact `crossSourceObservationReview` commands for those rows. The artifacts include field, source-pair, and policy-bucket rollups, which show the first queue is mostly department versus description-LLM description policy plus routing/entity-type and access-evidence policy work, while the second is a small name-precedence queue. Apply remains blocked because no source-precedence or field-lock policy has been reviewed.

The cross-source observation review command now also has a dry-run reviewer scaffold. Templates preserve plan id, source names, contributing sources, observation ids by source, and blank decision fields; accepted-decision validation checks plan ids, preferred sources, source-name drift, and observation-id drift before any guarded source-precedence or field-policy path exists. The Beta verification used an empty decisions file and accepted no precedence decisions.

`source:health` now exposes the cross-source reviewer scaffold in the saved source-health packet itself. Each `crossSourceObservationReview` row includes exact accepted-decision template and validation commands, expected JSON fields, and default `/tmp/ylabs-cross-source-observation-conflicts-<source>-<queue>-...` paths. The broad `beta:data-quality` source-health embedding carries the same metadata. This is still dry-run metadata only; no cross-source observation winner was chosen or applied.

The Operator Board Source Freshness card now renders those stale and cross-source handoff paths from saved source-health metadata. It shows the handoff source plus template and validation artifact paths, making the reviewer workflow visible without opening `/tmp/ylabs-source-health.json`; this does not mark the source-health warning, data-quality gate, or production gate ready.

`source:health` now reports whether the exact stale/cross-source follow-up artifacts it recommends are present. It keeps missing stale-review artifacts visible with `artifactAvailable=false`, and attaches candidate/plan/truncation plus category/policy-bucket rollups for available cross-source artifacts. The current Beta packet shows `department-undergrad-research` and `ysm-atoz-index` cross-source artifacts available, while all exact stale-review artifacts remain absent.

`source:health` now also has a compact top-level `reviewArtifactStatus` block. It reports exact missing follow-up commands for the six absent stale-review artifacts and confirms that both cross-source review artifacts are available, so the next dry-run packet generation step no longer requires manual row scanning.

The accepted-decision validation handoff is now self-reporting as well. `source:health` reads the exact stale/cross-source validation artifact paths it recommends and annotates `acceptedDecisionValidation` metadata with artifact availability plus `totalDecisions`, `validDecisionCount`, `invalidDecisionCount`, and `unreviewedPlanCount` when a `reviewDecisionValidation` artifact exists. The refreshed `/tmp/ylabs-source-health.json` and embedded `/tmp/ylabs-beta-quality.json` both detected the existing `department-undergrad-research` cross-source empty-decision validation artifact with 0 decisions, 0 invalid decisions, and 3 unreviewed plans. This is status visibility only; no stale supersession or cross-source precedence decision was accepted or applied.

Focused checks for this validation-status milestone:
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` (red first for missing validation status, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- JSON inspection of the source-health and Beta artifacts confirmed cross-source `acceptedDecisionValidation.artifactAvailable=true`, `totalDecisions=0`, `invalidDecisionCount=0`, and `unreviewedPlanCount=3`.

The Operator Board now renders that accepted-decision validation status beside Source Freshness handoff paths. The client fixture covers a missing stale validation artifact and a loaded cross-source validation artifact with 0 valid, 0 invalid, and 3 unreviewed plans, so reviewers can see whether JSON handoff validation has actually run without opening the artifact by hand. Focused check: `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` failed first on missing validation status text, then passed after the component change.

`source:health` now also aggregates accepted-decision validation status at `reviewSummary.reviewDecisionValidationStatus`. The stale and cross-source rollups report total/available/missing validation artifacts, valid/invalid/unreviewed decision counts, artifacts with invalid decisions, artifacts with unreviewed plans, and exact missing validation commands. Focused checks: `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` failed first on the missing rollup, then passed; `npx tsc --noEmit -p server/tsconfig.json` passed; refreshed `/tmp/ylabs-source-health.json` and `/tmp/ylabs-beta-quality.json` both show stale validation `0/6` available and cross-source validation `1/2` available with 3 unreviewed plans.

The Operator Board Source Freshness card now renders those top-level validation rollups as compact stale/cross summary lines. It shows loaded/missing validation artifact counts plus invalid and unreviewed totals, so operators can see review progress without opening every handoff row. Focused check: `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` failed first on the missing stale/cross rollup lines, then passed after the component change.

The stale and cross-source review CLIs now support `--allow-empty-decisions` for validation probes. When that flag is present, a missing accepted-decisions JSON file is treated as an empty decision list, allowing operators to generate validation artifacts and unreviewed-plan counts without manually creating `{ "decisions": [] }` files. Source-health accepted-decision validation commands now include the flag. Focused checks: `yarn --cwd server test src/scripts/__tests__/staleObservationConflictReview.test.ts src/scripts/__tests__/crossSourceObservationConflictReview.test.ts src/scripts/__tests__/sourceHealth.test.ts` failed first on the missing flag/reader behavior, then passed; `npx tsc --noEmit -p server/tsconfig.json` passed. A bounded Beta probe for `centers-institutes-index` wrote `/tmp/ylabs-stale-observation-conflicts-centers-institutes-index-priority_review-decision-validation.json` with 0 decisions and 3 unreviewed plans while apply remained blocked. Refreshed source-health and Beta artifacts now show stale validation `1/6` available and remaining missing validation commands include `--allow-empty-decisions`.

The Operator Board now renders the first missing stale and cross-source validation probe commands from `reviewDecisionValidationStatus.missingCommands`, including the `--allow-empty-decisions` flag. This gives operators a direct next dry-run validation command from the admin surface without exposing any write action. Focused check: `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` failed first on missing probe command text, then passed after the component change.

`research-entity:audit-rename` now separates canonical live readiness from legacy/inactive residue. It emits `legacyResidue` with migration versus runtime-cleanup classifications for checked legacy `researchGroupId`/`researchGroup` surfaces, and the live member reference check now matches runtime semantics by scoping `research_entity_members.researchEntityId` to current, non-archived rows. A first read-only Beta audit exposed 22 dangling retired PI member rows (`isCurrentMember=false`), so the audit filter was tightened after a direct Beta probe confirmed `currentDangling=0`. The refreshed `/tmp/ylabs-research-entity-rename-audit.json` reports legacy `research_groups` and `research_group_members` absent, live canonical references clean, `research_entity_members` source documents 2315 with 0 dangling references, and `legacyResidue.totalDocumentsWithResidue=0`.

Focused checks for this rename-audit milestone:
- `yarn --cwd server test src/scripts/__tests__/auditResearchEntityRename.test.ts` (red first for missing current-member scope, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:audit-rename --output /tmp/ylabs-research-entity-rename-audit.json`

The Operator Board now carries suspicious-user production-copy posture from saved `beta:data-quality` artifacts. `adminOperatorBoardService` reads `hygiene.emails.suspiciousUserEmails.productionCopyExclusion`, preserves only counts and Lane A/sample-coverage status, and the client data-quality gate renders those counts without exposing email samples. This keeps the suspicious-user warning reviewable from the admin surface while the data-quality summary decides blocker status from full sampled Lane A exclusion coverage.

Focused checks for this Operator Board milestone:
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing suspicious-user copy posture, then green)
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing UI copy posture, then green)
- `npx tsc --noEmit -p server/tsconfig.json`

The Operator Board now also carries duplicate-name accepted-decision handoff commands from saved `beta:data-quality` artifacts. `adminOperatorBoardService` normalizes `duplicateEntityNames.planReview.preflightGuidance.acceptedDecisionTemplate` and `acceptedDecisionValidation`, and the client Data Quality card renders the template/validation paths and validation command beside the duplicate-name preflight summary. This makes the duplicate-name blocker review workflow visible from the admin surface while keeping apply blocked and without asserting any reviewer decisions.

Focused checks for this duplicate-name handoff milestone:
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing duplicate-name decision handoff fields, then green)
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing duplicate-name decision handoff UI, then green)
- `npx tsc --noEmit -p server/tsconfig.json`

Duplicate-name accepted-decision validation status is now visible from the Operator Board too. When the saved validation output path exists, `adminOperatorBoardService` reads the artifact's `reviewDecisionValidation` field and preserves loaded/missing status plus total/valid/invalid/unreviewed counts; the Data Quality card renders those counts beside the duplicate-name validation command. This mirrors the source-health validation-status pattern and still does not accept decisions or enable a merge/archive apply path.

Focused checks for this duplicate-name validation-status milestone:
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing validation-status fields, then green)
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing validation-status UI, then green)
- `npx tsc --noEmit -p server/tsconfig.json`

The launch acquisition lane map is now an Operator Board gate. Saved `launch:acquisition-report` artifacts are read from `/tmp/ylabs-launch-acquisition-report.json` (or `LAUNCH_ACQUISITION_REPORT_PATH`), normalized into scanned blocker counts, PI/action blocker totals, deterministic exact PI matches, source-backed route candidates, and non-deterministic blocker categories. The current saved artifact has 75 scanned blockers, 65 PI blockers, 10 action blockers, 0 exact PI matches, and 0 source-backed route candidates, so the board marks the lane blocked on new source evidence, materializer logic, or manual disambiguation instead of implying another blind repair apply is useful.

Focused checks for this launch-acquisition gate milestone:
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing launch acquisition artifact functions, then green)
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing Launch Acquisition card, then green)
- `npx tsc --noEmit -p server/tsconfig.json`

`launch:acquisition-report` now includes `generatedAt` so the Operator Board stale guard can evaluate saved lane-map freshness. The refreshed Beta read-only artifact at `/tmp/ylabs-launch-acquisition-report.json` has `generatedAt=2026-05-31T21:05:01.048Z`, `scanned=75`, `piIdentity.total=65`, `actionEvidence.total=10`, `exactSingleUserMatch=0`, and `sourceBackedRouteNotLaunchMaterialized=0`; this confirms the current lane map has no deterministic PI/action repair candidates.

Focused checks for this acquisition freshness milestone:
- `yarn --cwd server test src/services/__tests__/launchAcquisitionReportService.test.ts src/scripts/__tests__/launchAcquisitionReport.test.ts` (red first for missing `generatedAt`, then green)
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10 --output /tmp/ylabs-launch-acquisition-report.json`

`launch:trust-contract` now includes freshness metadata in saved artifacts. The CLI wraps the audit report with `generatedAt`, `environment`, and `db`, so Operator Board stale checks can evaluate `/tmp/ylabs-launch-trust-contract.json` without relying on stdout capture. The refreshed Beta artifact has `generatedAt=2026-05-31T21:08:53.730Z`, `pass=false`, `launchEligible=1442`, `limitedButSafe=119`, `held=1047`, `suppressed=58`, `publicVisibilityViolations=0`, and four remaining repair lanes: source/description `999`, PI identity `65`, action evidence `10`, and review exceptions `92`. Production promotion remains blocked only on the true external gate facts; this command was read-only and non-production.

Focused checks for this launch trust freshness milestone:
- `yarn --cwd server test src/scripts/__tests__/launchTrustContract.test.ts` (red first for missing output builder, then green)
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --output /tmp/ylabs-launch-trust-contract.json`
- JSON inspection of `/tmp/ylabs-launch-trust-contract.json` confirmed `generatedAt`, incomplete-but-safe counts, and repair-lane counts.

`beta:repair-queue` now includes freshness metadata in saved dry-run/apply artifacts. The CLI wraps repair reports with `generatedAt`, `environment`, and `db`, and the Operator Board automatic-repair gate now carries loaded artifact age into `artifactAgeHours` for `/tmp/ylabs-beta-repair-source-description.json`. The refreshed Beta source-description dry-run artifact has `generatedAt=2026-05-31T21:12:02.287Z`, `mode=dry-run`, `scanned=500`, `attempted=500`, `repaired=26`, `blocked=474`, and `resolvedByGate=0`; no apply-mode repair or production write was run.

Focused checks for this Beta repair artifact freshness milestone:
- `yarn --cwd server test src/scripts/__tests__/betaRepairQueue.test.ts` (red first for missing output builder, then green)
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=500 --output /tmp/ylabs-beta-repair-source-description.json`
- JSON inspection of `/tmp/ylabs-beta-repair-source-description.json` confirmed `generatedAt` and dry-run queue counts.

2026-05-31 continuation update: Applied the matching deterministic source-description Beta repair queue after the saved dry-run reported 26 repairable rows. Command: `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=apply --retry-blocked --limit=500 --output /tmp/ylabs-beta-repair-source-description.json`. Result: `mode=apply`, `scanned=500`, `attempted=500`, `repaired=26`, `blocked=474`, `resolvedByGate=1`.

Implemented and ran a guarded archived-entity artifact repair path. New files: `server/src/scripts/repairArchivedEntityArtifacts.ts` and `server/src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts`; `server/package.json` now exposes `research-entity:repair-archived-artifacts`. Dry-run found 4 active artifacts pointing at archived entities with canonical targets; apply merged 1 canonical artifact, archived 4 merged duplicates, and deleted no data. Focused checks passed: `yarn --cwd server test src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts src/scripts/__tests__/repairArchivedEntityArtifactsCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`.

Completed duplicate exploratory pathway cleanup in Beta. Command: `SCRAPER_ENV=beta yarn --cwd server pathways:dedupe-exploratory --limit=1000 --apply --output /tmp/ylabs-dedupe-exploratory-pathways.json`. Result: 574 applied groups, 604 archived duplicate pathways, 63 relinked/modified access signals, 0 contact routes modified. Follow-up `scraper:integrity-gate --include-samples --output /tmp/ylabs-scraper-integrity.json` now has only `samePiSameNameResearchEntities=9`; `duplicateExploratoryContactPathways=0` and `activeArtifactsOnArchivedEntities=0`.

Refreshed post-write artifacts. `student-visibility:gate --collection=all --mode=apply --output /tmp/ylabs-student-visibility-gate.json` scanned 2,666 records with `promoted=1443`, `held=1223`, and `changed=0`. `meili:rebuild-research-entities --output /tmp/ylabs-meili-researchentities-rebuild.json` indexed 3,267 docs; `meili:rebuild-pathways --output /tmp/ylabs-meili-pathways-rebuild.json` indexed 1,436 docs. `launch:trust-contract --output /tmp/ylabs-launch-trust-contract.json` remains incomplete but safety-clean with 0 public visibility violations, research activity pass, and paper quality pass. `beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` remains warn-only with `errorCount=0`, `referenceIntegrity.hardFailureTotal=0`, 7 source-health warnings, 34 duplicate-name warnings, 697 missing short descriptions, 70 weak short descriptions, 646 without pathways, 499 without access signals, 1,317 without contact routes, and 2 suspicious user emails.

Verified the remaining same-PI blocker is not safe for autonomous apply. Broad `research-entity:dedupe-by-pi --limit=10000 --output /tmp/ylabs-research-entity-dedupe.json` still has 29 plans, all cross-department with merged research areas, 10 high research-area merge groups, and 1 funding-source group. Narrow dry-runs for `--reviewed-profile-area-only`, `--funding-only`, and `--official-lab-url-only` each plan 0 rows. Treat this as review-first and do not run broad `--apply` without accepted reviewer decisions.

Focused verification for this continuation:
- `yarn --cwd server test src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts src/scripts/__tests__/repairArchivedEntityArtifactsCore.test.ts src/scripts/__tests__/betaRepairQueue.test.ts src/scripts/__tests__/launchTrustContract.test.ts src/scripts/__tests__/dedupeExploratoryContactPathways.test.ts src/services/__tests__/adminOperatorBoardService.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`

Files changed in this continuation: `server/src/scripts/betaRepairQueue.ts`, `server/src/scripts/__tests__/betaRepairQueue.test.ts`, `server/src/scripts/launchTrustContract.ts`, `server/src/scripts/__tests__/launchTrustContract.test.ts`, `server/src/services/adminOperatorBoardService.ts`, `server/src/services/__tests__/adminOperatorBoardService.test.ts`, `server/src/scripts/repairArchivedEntityArtifacts.ts`, `server/src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts`, `server/package.json`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: inspect the remaining P2 non-production work for a code-bearing path that does not require production access or reviewer decisions. The most likely next safe target is source-health review hardening around stale/cross-source conflict validation or an independently testable guard for duplicate-name accepted decisions; do not broad-apply same-PI dedupe, production copy, production smoke, retention apply, or destructive cleanup.

2026-05-31 duplicate-name validation hardening: Added `--allow-empty-decisions` to `research-entity:duplicate-name-review`, matching the stale/cross-source review CLI pattern. `readDuplicateEntityNameReviewDecisions(path, { allowEmpty: true })` now returns an empty decision list when the accepted-decisions artifact is missing, and `beta:data-quality` advertises the duplicate-name validation command with the flag. Focused TDD checks passed: `yarn --cwd server test src/scripts/__tests__/duplicateEntityNameReview.test.ts src/scripts/__tests__/betaDataQualityCore.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`. The Beta probe `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=20 --accepted-decisions=/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json --allow-empty-decisions --output /tmp/ylabs-duplicate-entity-name-review-decision-validation.json` wrote a validation artifact with 0 decisions, 0 invalid decisions, and 20 unreviewed plans. Refreshed `/tmp/ylabs-beta-quality.json` now points to the same command. No reviewer decisions, merge/archive apply path, production write, or data deletion was performed.

Files changed for duplicate-name validation hardening: `server/src/scripts/duplicateEntityNameReview.ts`, `server/src/scripts/__tests__/duplicateEntityNameReview.test.ts`, `server/src/scripts/betaDataQualityCore.ts`, `server/src/scripts/__tests__/betaDataQualityCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: continue P2 data-trust hardening without production access. Prefer a code-bearing guard that improves review readiness, such as making duplicate-name validation status available in a top-level scorecard rollup or extending source-health validation probes, before considering any reviewer-gated apply path.

2026-05-31 duplicate-name validation-status scorecard: `beta:data-quality` now reads the duplicate-name accepted-decision validation artifact path it advertises and carries `artifactAvailable`, `totalDecisions`, `validDecisionCount`, `invalidDecisionCount`, and `unreviewedPlanCount` on `duplicateEntityNames.planReview.preflightGuidance.acceptedDecisionValidation`. The implementation uses injectable validation paths for deterministic tests and keeps the runtime `/tmp/ylabs-duplicate-entity-name-review-decision-validation.json` path. Focused checks passed: `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts src/scripts/__tests__/duplicateEntityNameReview.test.ts` and `npx tsc --noEmit -p server/tsconfig.json`. Refreshed `/tmp/ylabs-beta-quality.json` reports the validation artifact loaded with 0 total decisions, 0 invalid decisions, and 20 unreviewed plans.

Files changed for duplicate-name validation-status scorecard: `server/src/scripts/betaDataQualityCore.ts`, `server/src/scripts/__tests__/betaDataQualityCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: keep reducing review ambiguity in P2 Beta trust blockers without enabling reviewer-gated applies. A likely safe target is generating the remaining source-health empty validation artifacts or adding a top-level duplicate-name validation rollup to the Operator Board if the current data-quality gate does not make the loaded status prominent enough.

2026-05-31 same-PI dedupe review hardening: Added dry-run-only accepted-decision scaffolding to `research-entity:dedupe-by-pi`. The command now parses `--decision-template-output`, `--accepted-decisions`, and `--allow-empty-decisions`, writes a same-PI reviewer template, and emits `reviewDecisionValidation` with total/valid/invalid/unreviewed counts while keeping accepted decisions validation-only. The Beta probe `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json` stayed dry-run-only and reported 29 planned groups, 29 duplicate entities, 0 decisions, 0 invalid decisions, and 29 unreviewed plans. The template artifact has 29 decision stubs. No broad same-PI apply, production write, deletion, or reviewer acceptance was performed.

Focused checks for same-PI dedupe review hardening:
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` (red first for missing parser/template/validation helpers, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- The dry-run Beta command above plus JSON inspection of `/tmp/ylabs-research-entity-dedupe.json` and `/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json`

Files changed for same-PI dedupe review hardening: `server/src/scripts/dedupeResearchEntitiesByPi.ts`, `server/src/scripts/__tests__/researchEntityPiDedupeCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: continue P2 non-production hardening by making same-PI dedupe validation status visible in the broad Beta data-quality scorecard or Operator Board, so the remaining scraper-integrity blocker can be reviewed without opening the raw dedupe JSON.

2026-05-31 same-PI scorecard and Operator Board visibility: `beta:data-quality` now embeds `samePiDedupeReview` with the same dry-run validation command, accepted-decision input path, decision-template output path, 29 planned groups, 29 planned duplicate entities, cross-department/high-research-area/funding-source review flags, and loaded validation counts from `/tmp/ylabs-research-entity-dedupe.json`. `adminOperatorBoardService` preserves that block in the Data Quality gate, and `AdminOperatorBoard` renders the same-PI plan counts, artifact paths, command, and `Same-PI validation: loaded · 0 valid · 0 invalid · 29 unreviewed`. This is review metadata only; no broad same-PI apply, production write, deletion, or reviewer acceptance was performed.

Focused checks for same-PI scorecard and Operator Board visibility:
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing same-PI data-quality gate payload, then green)
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing same-PI card content, then green)
- `npx tsc --noEmit -p server/tsconfig.json`

Files changed for same-PI scorecard and Operator Board visibility: `server/src/scripts/betaDataQualityCore.ts`, `server/src/scripts/__tests__/betaDataQualityCore.test.ts`, `server/src/scripts/betaDataQuality.ts`, `server/src/services/adminOperatorBoardService.ts`, `server/src/services/__tests__/adminOperatorBoardService.test.ts`, `client/src/components/admin/AdminOperatorBoard.tsx`, `client/src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: inspect `scraper:integrity-gate` and its tests so the remaining `samePiSameNameResearchEntities` failure points operators at the accepted-decision template/validation workflow instead of only the older broad dedupe dry-run.

2026-05-31 scraper-integrity same-PI recommendation hardening: `runPostMaterializationIntegrityGate` now builds recommended commands from actual failure names instead of one global command list. A `samePiSameNameResearchEntities` failure now recommends the same review-first `research-entity:dedupe-by-pi --accepted-decisions ... --allow-empty-decisions --decision-template-output ... --output /tmp/ylabs-research-entity-dedupe.json` workflow and no longer recommends `research-entity:dedupe-by-pi --limit=10000 --apply`. Other existing dry-run recommendations, including user identity dedupe, remain covered. Refreshed `/tmp/ylabs-scraper-integrity.json` still exits non-zero because `samePiSameNameResearchEntities=9`, but its `recommendedCommands` now contain only the review-first same-PI validation/template command for that failure.

Focused checks for scraper-integrity same-PI recommendation hardening:
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts` (red first for old broad apply recommendation, then green)
- `yarn --cwd server test src/scripts/__tests__/dedupeUsersByIdentityCore.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples --output /tmp/ylabs-scraper-integrity.json` (expected exit 1 because the review-first same-PI failure remains; artifact was written)

Files changed for scraper-integrity same-PI recommendation hardening: `server/src/scrapers/integrityGate.ts`, `server/src/scripts/__tests__/scraperIntegrityGate.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: inspect whether the refreshed scraper-integrity recommendation is surfaced in the Operator Board scraper-integrity card. If the card only shows failure names, add a compact recommended-command line from saved artifacts without changing readiness.

2026-05-31 Operator Board scraper-integrity recommendation surface: saved scraper-integrity artifacts now carry `recommendedCommands` through `readScraperIntegrityGateArtifact` and `deriveScraperIntegrityGate`. The Scraper Integrity card renders the first recommended command, so the admin surface now shows the review-first same-PI validation/template dry-run command beside the failure/warning state. This only displays saved artifact guidance and does not mark the gate ready or run apply mode.

Focused checks for Operator Board scraper-integrity recommendation surface:
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing `recommendedCommands` carry-through, then green)
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing recommendation rendering, then green)
- `npx tsc --noEmit -p server/tsconfig.json`

Files changed for Operator Board scraper-integrity recommendation surface: `server/src/services/adminOperatorBoardService.ts`, `server/src/services/__tests__/adminOperatorBoardService.test.ts`, `client/src/components/admin/AdminOperatorBoard.tsx`, `client/src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: inspect the remaining data-trust blockers for another code-bearing review-readiness improvement that does not require reviewer decisions or production access. Start with duplicate-name accepted-decision validation/status or source-health warning visibility if the roadmap has no higher-priority feasible code-bearing item.

2026-05-31 scraper-integrity artifact freshness metadata: `scraper:integrity-gate --output` now wraps saved artifacts with `generatedAt`, `environment`, and `db` while preserving the integrity summary shape and exit semantics. This lets the existing Operator Board stale guard evaluate `/tmp/ylabs-scraper-integrity.json` freshness instead of treating missing timestamps as perpetually current. Refreshed Beta artifact wrote `generatedAt=2026-05-31T22:07:29.448Z`, `environment=beta`, `db=Beta`, and `status=failure` with `samePiSameNameResearchEntities=9`; the non-zero exit is expected because the review-first blocker remains.

Focused checks for scraper-integrity artifact freshness metadata:
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples --output /tmp/ylabs-scraper-integrity.json` (expected exit 1 while writing the refreshed artifact)

Files changed for scraper-integrity artifact freshness metadata: `server/src/scripts/scraperIntegrityGate.ts`, `server/src/scripts/__tests__/scraperIntegrityGate.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: inspect whether any remaining review-first blocker can be made more implementation-ready without reviewer decisions. Prefer source-health accepted-decision status or duplicate-name decision-status summarization over any apply/write path.

2026-05-31 scraper-integrity duplicate-paper detector: the `duplicateResearchPapers` integrity failure type no longer uses a stubbed empty loader. It now scans active `papers` by stable top-level identifiers (`openAlexId`, `semanticScholarId`, `arxivId`, and `doi`) and reports duplicate paper ids by repeated identifier value. The focused pure helper filters empty identifiers and singleton groups. Refreshed Beta integrity output reports `duplicateResearchPapers=0`, so this did not introduce a new blocker.

Focused checks for scraper-integrity duplicate-paper detector:
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts` (red first for missing duplicate-paper grouping helper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples --output /tmp/ylabs-scraper-integrity.json` (expected exit 1 because same-PI review remains; artifact confirmed `duplicateResearchPapers=0`)

Files changed for scraper-integrity duplicate-paper detector: `server/src/scrapers/integrityGate.ts`, `server/src/scripts/__tests__/scraperIntegrityGate.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: inspect the remaining integrity failure types with empty or weak non-production review guidance, especially `duplicateAccessSignals`, and add dry-run-only detection/helper coverage where a stable identifier exists.

2026-05-31 scraper-integrity duplicate-access-signal helper coverage: `duplicateAccessSignals` detection now uses an exported pure grouping helper for repeated access-signal identities (`derivationKey`, `sourceEvidenceId`, or `observationId`) and filters singleton groups, missing research-entity ids, missing signal types, missing identity values, and empty signal ids. The DB loader now maps aggregate rows through the helper. Refreshed Beta integrity output reports `duplicateAccessSignals=0`, so this did not introduce a new blocker.

Focused checks for scraper-integrity duplicate-access-signal helper coverage:
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts` (red first for missing access-signal grouping helper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples --output /tmp/ylabs-scraper-integrity.json` (expected exit 1 because same-PI review remains; artifact confirmed `duplicateAccessSignals=0`)

Files changed for scraper-integrity duplicate-access-signal helper coverage: `server/src/scrapers/integrityGate.ts`, `server/src/scripts/__tests__/scraperIntegrityGate.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: re-read the active roadmap queue and inspect whether any non-production source-health, duplicate-name, or launch-trust hardening remains feasible without reviewer decisions or production access.

2026-05-31 scraper-integrity duplicate-review artifact command: Added a read-only `scraper:integrity-duplicates-review` CLI for duplicate paper and duplicate access-signal integrity failures. The command writes freshness metadata, `mode=dry-run`, `applyBlocked=true`, counts, and grouped duplicate identities for `--type=research-papers`, `--type=access-signals`, or `--type=all`; it has no apply path. `scraper:integrity-gate` now recommends type-specific duplicate-review artifact commands if `duplicateResearchPapers` or `duplicateAccessSignals` ever fail. The Beta all-types probe wrote `/tmp/ylabs-integrity-duplicates-review.json` with `duplicateResearchPapers=0` and `duplicateAccessSignals=0`. The refreshed scraper-integrity artifact still exits non-zero only because `samePiSameNameResearchEntities=9` remains review-first.

Focused checks for scraper-integrity duplicate-review artifact command:
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityDuplicateReview.test.ts src/scripts/__tests__/scraperIntegrityGate.test.ts` (red first for missing module/recommendations, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-duplicates-review --type=all --limit=1000 --output /tmp/ylabs-integrity-duplicates-review.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples --output /tmp/ylabs-scraper-integrity.json` (expected exit 1 because the same-PI review blocker remains)

Files changed for scraper-integrity duplicate-review artifact command: `server/src/scripts/scraperIntegrityDuplicateReview.ts`, `server/src/scripts/__tests__/scraperIntegrityDuplicateReview.test.ts`, `server/src/scrapers/integrityGate.ts`, `server/src/scripts/__tests__/scraperIntegrityGate.test.ts`, `server/package.json`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: re-read the active roadmap queue after Graphify refresh and continue only if a feasible non-production code-bearing item remains that does not require production access, reviewer decisions, destructive cleanup, or secrets.

2026-05-31 deterministic action-evidence Beta repair: The fresh read-only repair-lane probes found no PI identity repairs and no source-description repairs, but `beta:repair-queue --collection=research --stage=action_evidence --mode=dry-run --retry-blocked --limit=250` found 10 deterministic official-profile/route repairs. Applied the matching non-production Beta lane with `mode=apply`; it repaired all 10 rows and resolved 10 gate markers by creating low-confidence exploratory pathways, reach-out-plausible access signals, and public contact routes. No production write/copy, deletion, destructive cleanup, or same-PI apply was performed.

Post-write verification for action-evidence repair:
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=apply --output /tmp/ylabs-student-visibility-gate.json` -> `promoted=1453`, `held=1213`, `changed=0`.
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities --output /tmp/ylabs-meili-researchentities-rebuild.json` -> `indexedDocumentCount=3267`.
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways --output /tmp/ylabs-meili-pathways-rebuild.json` -> `indexedDocumentCount=1446`.
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --output /tmp/ylabs-launch-trust-contract.json` -> incomplete but safety-clean: `launchEligible=1453`, `limitedButSafe=109`, `held=1046`, `suppressed=58`, `publicVisibilityViolations=0`, action evidence lane `0`.
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` -> warn-only, `errorCount=0`, `referenceIntegrity.hardFailureTotal=0`, 3 must-fix promotion blocker groups remained at that point.
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples --output /tmp/ylabs-scraper-integrity.json` -> expected exit 1 only for review-first `samePiSameNameResearchEntities=9`.
- `SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10 --output /tmp/ylabs-launch-acquisition-report.json` -> `scanned=65`, PI identity `65`, action evidence `0`, exact PI matches `0`.

Files changed for action-evidence repair documentation: `docs/tasks/priority-roadmap.md` and `docs/tasks/current-execution-plan.md`; Beta data changed through the guarded non-production repair lane and search indexes were rebuilt.

Next selected engineering task: inspect the remaining non-production roadmap queue again. Current feasible write lane status is blocked: source-description dry-run repaired `0`, PI identity dry-run repaired `0`, action evidence is now `0`, same-PI/duplicate-name/source-health need accepted reviewer decisions, and production promotion needs external production facts.

2026-05-31 launch-trust dry-run-first repair commands: The launch trust contract no longer recommends direct `beta:repair-queue --mode=apply` for deterministic repair lanes. Source-description, PI identity, action-evidence, and suppression lanes now emit `--mode=dry-run --retry-blocked --limit ... --output /tmp/...` commands, so the saved launch artifact points operators to reviewable JSON artifacts before any guarded Beta apply. Refreshed `/tmp/ylabs-launch-trust-contract.json` shows source-description and PI identity dry-run commands; action evidence remains 0 but is covered by focused tests.

Focused checks for launch-trust dry-run-first repair commands:
- `yarn --cwd server test src/services/__tests__/launchTrustContractService.test.ts` (red first for direct apply commands, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --output /tmp/ylabs-launch-trust-contract.json`
- JSON inspection of `/tmp/ylabs-launch-trust-contract.json` repair lane commands.

Files changed for launch-trust dry-run-first repair commands: `server/src/services/launchTrustContractService.ts`, `server/src/services/__tests__/launchTrustContractService.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: inspect the highest-priority remaining non-production blockers for a code-bearing hardening task that does not require reviewer decisions, production access, deletion, or secrets.

2026-05-31 launch-trust review-exception apply wording hardening: The `review_exception` repair lane no longer says to apply source-backed fixes or run `student-visibility:gate --mode=apply`. It now tells operators to record accepted reviewer decisions and rerun `launch:trust-contract` with a saved output artifact. This keeps formalization-only/review-exception rows in review-first posture and does not mark the gate ready.

Focused checks for launch-trust review-exception apply wording:
- `yarn --cwd server test src/services/__tests__/launchTrustContractService.test.ts` (red first for apply wording, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --output /tmp/ylabs-launch-trust-contract.json`
- JSON inspection of `/tmp/ylabs-launch-trust-contract.json` repair lane commands.

Files changed for launch-trust review-exception apply wording: `server/src/services/launchTrustContractService.ts`, `server/src/services/__tests__/launchTrustContractService.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: inspect whether the top-level `requiredCommands` still overstates apply readiness and either harden it or move to the next highest-priority non-production blocker.

2026-05-31 Operator Board launch-trust recommendation surface: Saved launch-trust artifacts now carry repair-lane commands through `readLaunchTrustGateArtifact` and `deriveLaunchTrustGate`, and the admin Launch Trust card renders the first recommendation. The board now exposes the dry-run source/PI/action repair command from the saved artifact without requiring operators to open `/tmp/ylabs-launch-trust-contract.json`; this does not change gate status or imply readiness.

Focused checks for Operator Board launch-trust recommendation surface:
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing `repairLaneCommands`, then green)
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing recommendation rendering, then green)
- `npx tsc --noEmit -p server/tsconfig.json`

Files changed for Operator Board launch-trust recommendation surface: `server/src/services/adminOperatorBoardService.ts`, `server/src/services/__tests__/adminOperatorBoardService.test.ts`, `client/src/components/admin/AdminOperatorBoard.tsx`, `client/src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: re-read the active priority queue and inspect whether another feasible non-production code-bearing blocker remains.

2026-05-31 launch-trust required-commands dry-run hardening: The launch trust contract no longer places `student-visibility:gate --mode=apply` at the front of `requiredCommands`. The top-level visibility command is now `student-visibility:gate --mode=dry-run --output /tmp/ylabs-student-visibility-gate.json`, while lane-specific dry-run repair commands and review-exception decision instructions remain in the same artifact. This makes launch-trust output review-first at both the lane and top-level command layers.

Focused checks for launch-trust required-command hardening:
- `yarn --cwd server test src/services/__tests__/launchTrustContractService.test.ts` (red first for apply-mode required command, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --output /tmp/ylabs-launch-trust-contract.json`

Files changed for launch-trust required-command hardening: `server/src/services/launchTrustContractService.ts`, `server/src/services/__tests__/launchTrustContractService.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: continue from the active priority queue, preferring data-trust blocker implementation-readiness that does not require accepted reviewer decisions or production access.

2026-05-31 suspicious-user data-quality blocker downgrade: `beta:data-quality` now classifies `suspiciousUserEmails` as `accepted_release_warning` only when `--include-samples` proves the full suspicious-user set is sampled and excluded by the Lane A production-copy filter. The sampled-coverage helper now treats truncated samples as incomplete, so future larger suspicious-user sets stay must-fix until reviewed. The refreshed `/tmp/ylabs-beta-quality.json` remains warn-only with `promotionBlockerCount=2` (`sourceHealthWarnings`, `duplicateEntityNames`); the 2 suspicious synthetic users are still visible as warnings and excluded-copy metadata, not deletion work.

Focused checks for suspicious-user data-quality blocker downgrade:
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (red first for static blocker classification and truncated sample coverage, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- JSON inspection of `/tmp/ylabs-beta-quality.json` summary and `hygiene.emails.suspiciousUserEmails.productionCopyExclusion`.

Files changed for suspicious-user data-quality blocker downgrade: `server/src/scripts/betaDataQualityCore.ts`, `server/src/scripts/__tests__/betaDataQualityCore.test.ts`, `server/src/scripts/betaDataQuality.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: inspect the remaining two data-quality promotion blockers. Source-health and duplicate-name both have validation/template scaffolds, so continue only where a non-production code-bearing improvement remains possible without reviewer decisions.

2026-05-31 launch review-exception validation CLI hardening: Added a read-only `launch:review-exceptions` command that writes a reviewer decision template and validates accepted decisions for launch-trust review-exception rows without any apply path. A Beta probe initially exposed a selector bug: evidence-backed `student_ready` rows fell through the generic `review_exception` classifier, producing `reviewExceptionCount=1560`. The helper now first applies the same student-ready launch-violation criteria as `launch:trust-contract`, excluding launch-eligible and hidden-suppressed plans before classifying repair stage. The corrected Beta artifact at `/tmp/ylabs-launch-review-exceptions.json` now reports `reviewExceptionCount=92`, `plannedCount=92`, `planTruncated=false`, `validDecisionCount=0`, and `unreviewedPlanCount=92`; no reviewer decisions were asserted and no write path exists.

Focused checks for launch review-exception validation CLI:
- `yarn --cwd server test src/scripts/__tests__/launchReviewExceptions.test.ts` (red first for the broad selector bug, then green)
- `SCRAPER_ENV=beta yarn --cwd server launch:review-exceptions --collection=all --limit=500 --decision-template-output /tmp/ylabs-launch-review-exceptions-template.json --accepted-decisions=/tmp/ylabs-launch-review-exceptions-decisions.json --allow-empty-decisions --output /tmp/ylabs-launch-review-exceptions.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --output /tmp/ylabs-launch-trust-contract.json`
- JSON inspection of `/tmp/ylabs-launch-review-exceptions.json` and `/tmp/ylabs-launch-trust-contract.json`
- `yarn --cwd server test src/scripts/__tests__/launchReviewExceptions.test.ts src/services/__tests__/launchTrustContractService.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`

Files changed for launch review-exception validation CLI: `server/src/scripts/launchReviewExceptions.ts`, `server/src/scripts/__tests__/launchReviewExceptions.test.ts`, `server/package.json`, `server/src/services/launchTrustContractService.ts`, `server/src/services/__tests__/launchTrustContractService.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: refresh Graphify for the code/docs changes, then continue inspecting the highest-priority feasible non-production blocker. Remaining launch/data-quality blockers still require new official source evidence, accepted reviewer decisions, or production/external facts before they can be cleared.

2026-05-31 Operator Board launch review-exception status surface: The admin Operator Board now reads `/tmp/ylabs-launch-review-exceptions.json` or `LAUNCH_REVIEW_EXCEPTIONS_REPORT_PATH`, maps the saved validation artifact into the Launch Trust gate, and renders review-exception count plus valid/invalid/unreviewed decision counts. This keeps the 92 formalization-only review plans visible from the admin surface without accepting any decisions, enabling apply, or marking launch trust ready.

Focused checks for Operator Board launch review-exception status:
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing artifact reader/gate payload, then green)
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing Launch Trust card status, then green)
- `npx tsc --noEmit -p server/tsconfig.json`

Files changed for Operator Board launch review-exception status: `server/src/services/adminOperatorBoardService.ts`, `server/src/services/__tests__/adminOperatorBoardService.test.ts`, `client/src/components/admin/AdminOperatorBoard.tsx`, `client/src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: refresh Graphify, then inspect whether any remaining high-priority non-production launch/data-quality blocker can be reduced with code. If not, mark the specific need for new source evidence or accepted reviewer decisions and continue down the priority queue.

2026-05-31 read-only launch/data-quality refresh: Polled or recovered the saved artifacts from the latest Beta read-only checks. `launch:acquisition-report` now scans 65 PI blockers and 0 action blockers, with 0 exact PI matches and 0 source-backed action-route materialization candidates. The latest dry-run repair artifacts show source-description scanned 500 / repaired 0 / blocked 500, PI identity scanned 65 / repaired 0 / blocked 65, and action evidence scanned 0 / repaired 0. After the full-scope source-health review refresh, `source:health` and the embedded `beta:data-quality` packet have stale accepted-decision validation artifacts 6/6 loaded with 575 unreviewed plans and cross-source validation artifacts 2/2 loaded with 54 unreviewed plans; no accepted reviewer decisions were asserted. `scraper:integrity-gate` still fails only on `samePiSameNameResearchEntities=9`, and `beta:data-quality` remains warn-only with `promotionBlockerCount=2` (`sourceHealthWarnings`, `duplicateEntityNames`).

2026-05-31 Operator Board recommended actions surface: The server already returned `recommendedNextActions`, but the admin client did not type or render that field. Added a red client test for top-level recommended actions, then rendered a compact "Recommended Next Actions" section near the top of `AdminOperatorBoard`. This is an operator visibility fix only; it does not change gate status.

Focused checks for Operator Board recommended actions:
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first on missing `Recommended Next Actions`, then green).

Files changed for Operator Board recommended actions: `client/src/components/admin/AdminOperatorBoard.tsx`, `client/src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

2026-05-31 Operator Board recommended action specificity: `buildRecommendedNextActions` now accepts launch held rows, launch review-exception unreviewed plans, source-health unreviewed conflict plans, duplicate-name unreviewed plans, and same-PI dedupe unreviewed plans from saved artifacts. `buildAdminOperatorBoard` passes those counts when loaded, so the newly rendered top action list names concrete internal blockers instead of only generic gate work. This is display guidance only and does not clear any launch, source-health, duplicate-name, scraper-integrity, or production gate.

Focused checks for recommended action specificity:
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing launch/source-review actions, then green).
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing duplicate-name/same-PI actions, then green).
- `npx tsc --noEmit -p server/tsconfig.json`.

Files changed for recommended action specificity: `server/src/services/adminOperatorBoardService.ts`, `server/src/services/__tests__/adminOperatorBoardService.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: refresh Graphify for the code/docs changes, then re-read the active roadmap queue. Remaining high-priority launch/data-quality blockers currently require new official source evidence/materializer logic, accepted reviewer decisions, or true production/external gate facts; continue only if another non-production code-bearing hardening task remains.

2026-05-31 retention dry-run output artifact: Added `--output <path>` support to `yarn --cwd server scrape prune-observations` by sharing a small tested JSON output helper with scraper CLI report writing. The OpenAlex retention dry-run can now save the candidate/deleted counts and retained run ids directly into the promotion packet. Verified against Beta only with `SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-openalex-prune-dry-run.json`; result was `apply=false`, `candidates=0`, `deleted=0`, kept run ids `6a14da44040c7df99b78b403`, `6a0fb08f103539aa8880115d`, and `6a0fb053a957079343631be1`. No apply, deletion, production write, or production copy was run.

Focused checks for retention output artifact:
- `yarn --cwd server test src/scrapers/__tests__/scraperCliOutput.test.ts` (red first for missing helper module, then green).
- `npx tsc --noEmit -p server/tsconfig.json`.
- `yarn --cwd server scrape help`.
- `SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-openalex-prune-dry-run.json`.
- JSON inspection of `/tmp/ylabs-openalex-prune-dry-run.json`.

Files changed for retention output artifact: `server/src/scrapers/scraperCliOutput.ts`, `server/src/scrapers/__tests__/scraperCliOutput.test.ts`, `server/src/scrapers/cli.ts`, `docs/scraper-deployment-runbook.md`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

2026-05-31 data-quality retention command alignment: Added `buildBetaDataQualityRecommendedCommands` so the broad scorecard advertises the saved-output retention dry-run command instead of the old stdout-only command. Refreshed `/tmp/ylabs-beta-quality.json`; it remains warn-only with `promotionBlockerCount=2` (`sourceHealthWarnings`, `duplicateEntityNames`) and now carries `recommendedCommands.retentionDryRun = "SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-openalex-prune-dry-run.json"`.

Focused checks for data-quality retention command alignment:
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (red first for missing helper, then green).
- `npx tsc --noEmit -p server/tsconfig.json`.
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`.

Files changed for data-quality retention command alignment: `server/src/scripts/betaDataQualityCore.ts`, `server/src/scripts/__tests__/betaDataQualityCore.test.ts`, `server/src/scripts/betaDataQuality.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: refresh Graphify, then inspect whether publication source chunks have any feasible local-only hardening left. Production promotion, retention apply mode, launch/source/duplicate acceptance, and post-Beta cleanup remain blocked by production facts, reviewer decisions, source evidence, or post-promotion prerequisites.

2026-05-31 scraper run report output: Added `--output <path>` support to normal `yarn --cwd server scrape run` so bounded ORCID/PubMed/Europe PMC/Crossref chunks can save accepted ScrapeRun reports directly instead of requiring a second `scrape report --run` command. Cron and report output now share the same JSON output helper. Verified with a Beta dry-run that matched no ORCID users: `SCRAPER_ENV=beta yarn --cwd server scrape run --source orcid --dry-run --only __codex_no_such_netid__ --output /tmp/ylabs-orcid-empty-dry-run-report.json`; it created a dry-run ScrapeRun with `observationCount=0`, saved the report artifact, and did not emit observations or call external ORCID records.

Focused checks for scraper run report output:
- `npx tsc --noEmit -p server/tsconfig.json`.
- `yarn --cwd server scrape help`.
- `SCRAPER_ENV=beta yarn --cwd server scrape run --source orcid --dry-run --only __codex_no_such_netid__ --output /tmp/ylabs-orcid-empty-dry-run-report.json`.
- JSON inspection of `/tmp/ylabs-orcid-empty-dry-run-report.json`.

Files changed for scraper run report output: `server/src/scrapers/cli.ts`, `docs/scraper-deployment-runbook.md`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

2026-05-31 19:25: Resumed after the previous blocked-state handoff and found one feasible non-production hardening gap in the publication/source-reporting lane: `yarn --cwd server scrape run --output` was manually verified but its optional artifact-writing path was still hand-rolled across scraper CLI commands.

2026-05-31 19:25 scraper CLI optional-output hardening: Added a focused `writeOptionalJsonOutput` helper and refactored `yarn --cwd server scrape run`, `cron`, `report`, and `prune-observations` to use the shared saved-artifact path. This keeps run-report output behavior independently testable without broad publication-source promotion, production writes, or deletion.

Focused checks for scraper CLI optional-output hardening:
- `yarn --cwd server test src/scrapers/__tests__/scraperCliOutput.test.ts` (red first for missing `writeOptionalJsonOutput`, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server scrape help`
- `SCRAPER_ENV=beta yarn --cwd server scrape run --source orcid --dry-run --only __codex_no_such_netid__ --output /tmp/ylabs-orcid-empty-dry-run-report.json`
- JSON inspection of `/tmp/ylabs-orcid-empty-dry-run-report.json`

Files changed for scraper CLI optional-output hardening: `server/src/scrapers/scraperCliOutput.ts`, `server/src/scrapers/__tests__/scraperCliOutput.test.ts`, `server/src/scrapers/cli.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

2026-05-31 19:27 scraper CLI import-safety hardening: Added a direct-run guard to `server/src/scrapers/cli.ts` and exported `parseArgs`, `parseScraperOptions`, and `parseIntegerFlag` so parser behavior can be tested without executing the CLI or touching MongoDB on import. This matches the newer script pattern and keeps future scraper CLI changes safer.

Focused checks for scraper CLI import-safety hardening:
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts` (red first because importing `cli.ts` printed help text, then green)
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts src/scrapers/__tests__/scraperCliOutput.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server scrape help`

Files changed for scraper CLI import-safety hardening: `server/src/scrapers/cli.ts`, `server/src/scrapers/__tests__/cli.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

2026-05-31 19:30: Refreshed Graphify after scraper CLI and durable-doc changes. Re-read the active roadmap queue and unchecked roadmap items. No remaining feasible non-production code-bearing roadmap item was identified without new official source evidence, accepted reviewer-decision artifacts, production/external facts, or a post-production-copy cleanup prerequisite.

## Current Stop Reason

Stopping this continuation because the remaining inspected roadmap work is blocked by true external/review-gated prerequisites after safe local hardening was completed.

Completed substantial work in this continuation:
- Centralized optional scraper CLI artifact writing through `writeOptionalJsonOutput` and reused it from `run`, `cron`, `report`, and `prune-observations`.
- Made `server/src/scrapers/cli.ts` import-safe and exported parser helpers so scraper CLI behavior can be tested without running the CLI or touching MongoDB on import.
- Added `yarn --cwd server scrape materialize --run <runId> --output <path>` so standalone materialization review packets can be saved without parsing stdout.
- Changed cron `--output` to save the full `RunScraperCronResult` envelope, including lock-skip outcomes, scrape result, materialization result, optional visibility gate result, and ScrapeRun report, instead of only the nested run report.

Blocked work:
- Production promotion remains blocked on a fresh Atlas restore point, real Production guarded-copy dry-run review, rollback-tested status, and production smoke results.
- Launch trust/Beta repair lanes remain blocked on new official source evidence, accepted non-launch posture, materializer logic, or reviewer decisions: latest known blockers are source/description, PI identity, and 92 launch review exceptions.
- Data-quality promotion remains blocked on `sourceHealthWarnings` and `duplicateEntityNames`; validation/template scaffolding exists, but real reviewer decisions are not recorded.
- OpenAlex retention apply mode remains blocked because it is deletion/retention apply work; only dry-run evidence is allowed in this operator run.
- Publication source promotion remains blocked on an explicit broader-coverage decision; broad ORCID/PubMed/Europe PMC/Crossref chunks were not run.
- Admin PI claim, Scholar disambiguation, and broader field-lock UI remain intentionally unstarted until the workflow is clear.
- Post-Beta legacy cleanup remains blocked until production copy/smoke proves canonical surfaces with accepted Beta data.

Current in-progress task: none.

Exact next safe status-refresh command:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json
```

Files modified in this continuation: `server/src/scrapers/cli.ts`, `server/src/scrapers/scraperCliOutput.ts`, `server/src/scrapers/__tests__/cli.test.ts`, `server/src/scrapers/__tests__/scraperCliOutput.test.ts`, `docs/scraper-deployment-runbook.md`, `docs/tasks/priority-roadmap.md`, `docs/tasks/current-execution-plan.md`, `graphify-out/GRAPH_REPORT.md`, and `graphify-out/graph.json`.

Checks run in this continuation:
- `yarn --cwd server test src/scrapers/__tests__/scraperCliOutput.test.ts` (red first, then green)
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts` (red first, then green)
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts src/scrapers/__tests__/scraperCliOutput.test.ts`
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts src/scrapers/__tests__/scraperCliOutput.test.ts src/scrapers/__tests__/cronRunner.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server scrape help`
- `SCRAPER_ENV=beta yarn --cwd server scrape run --source orcid --dry-run --only __codex_no_such_netid__ --output /tmp/ylabs-orcid-empty-dry-run-report.json`
- JSON inspection of `/tmp/ylabs-orcid-empty-dry-run-report.json`
- `SCRAPER_ENV=beta yarn --cwd server scrape materialize --run 6a1cc371b669cda0ddfe4507 --dry-run --output /tmp/ylabs-orcid-empty-materialize-dry-run-report.json`
- JSON inspection of `/tmp/ylabs-orcid-empty-materialize-dry-run-report.json`
- `git diff --check`
- `graphify update .`
- Post-cron roadmap self-check: unchecked roadmap items are blocked on true production/external facts, accepted reviewer decisions/new source evidence, unclear PI-claim/admin workflow, or post-production-copy cleanup prerequisites.

Recommended next engineering task: if accepted reviewer decisions or new official source evidence become available, validate the relevant artifact (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, or `launch:review-exceptions`) and then design a bounded guarded apply path only when validation has `invalidDecisionCount=0`.

2026-05-31 19:33 materialize artifact output: Continued from the active goal and found one feasible non-production hardening item in the production-rollout scraper path. `yarn --cwd server scrape materialize --run` now accepts `--output <path>` and saves a review artifact containing the materialization result, optional student-visibility gate result, and ScrapeRun report. No production materialization or write was run; verification used a Beta `--dry-run` materialization against the existing no-match ORCID dry-run.

Focused checks for materialize artifact output:
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts` (red first for missing `buildMaterializeOutputPayload`, then green)
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts src/scrapers/__tests__/scraperCliOutput.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server scrape help`
- `SCRAPER_ENV=beta yarn --cwd server scrape materialize --run 6a1cc371b669cda0ddfe4507 --dry-run --output /tmp/ylabs-orcid-empty-materialize-dry-run-report.json`
- JSON inspection of `/tmp/ylabs-orcid-empty-materialize-dry-run-report.json`

Files changed for materialize artifact output: `server/src/scrapers/cli.ts`, `server/src/scrapers/__tests__/cli.test.ts`, `docs/scraper-deployment-runbook.md`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: validate real reviewer-decision artifacts or new official source evidence when available; otherwise only run read-only status refreshes. Do not claim production readiness; the same production/external and reviewer-decision blockers still apply.

2026-05-31 19:45 cron full-result artifact output: Continued from the active goal and found another feasible non-production hardening item in the production-rollout scraper path. `yarn --cwd server scrape cron --source <source> --release --output <path>` now saves the full cron result envelope rather than only the nested ScrapeRun report, preserving lock-skip outcomes plus completed scrape/materialization/visibility/report data for review. No production cron command, production write, or production smoke was run.

Focused checks for cron full-result artifact output:
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts` (red first for missing `buildCronOutputPayload`, then green)
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts src/scrapers/__tests__/scraperCliOutput.test.ts src/scrapers/__tests__/cronRunner.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json` (initially failed on incomplete cron test fixture shape, then passed after the fixture matched `RunScraperCronResult`)
- `yarn --cwd server scrape help`

Files changed for cron full-result artifact output: `server/src/scrapers/cli.ts`, `server/src/scrapers/__tests__/cli.test.ts`, `docs/scraper-deployment-runbook.md`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: reassess the roadmap for any remaining feasible non-production code-bearing item. Production promotion is still blocked on the real Atlas restore point, real Production guarded-copy dry-run review, rollback-tested status, and production smoke results.

2026-05-31 19:55 duplicate-name full-scope validation cap: Continued from the active goal and found a feasible non-production bug in the duplicate-name blocker handoff. `beta:data-quality` was still building duplicate-name review/template/validation commands with the older 20-plan default even though the current blocker has 34 clusters. `buildDuplicateEntityPlanReviewSummary` now defaults to the full duplicate-cluster count unless a caller explicitly passes a smaller `planLimit`, and the refreshed artifacts show `planLimit=34`, 34 planned clusters, `planTruncated=false`, 0 accepted decisions, 0 invalid decisions, and 34 unreviewed plans. This does not assert reviewer approval or enable merge/archive apply.

Focused checks for duplicate-name full-scope validation:
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (red first for the old 20-plan default, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=34 --accepted-decisions=/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json --output /tmp/ylabs-duplicate-entity-name-review-decision-validation.json`
- JSON inspection of `/tmp/ylabs-beta-quality.json` and `/tmp/ylabs-duplicate-entity-name-review-decision-validation.json`

Files changed for duplicate-name full-scope validation: `server/src/scripts/betaDataQualityCore.ts`, `server/src/scripts/__tests__/betaDataQualityCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: inspect the roadmap and saved Beta artifacts for another feasible non-production code-bearing hardening item. Production promotion remains blocked on the real Atlas restore point, real Production guarded-copy dry-run review, rollback-tested status, and production smoke results.

2026-05-31 20:03 source-health full-scope review handoff: Continued from the active goal and found another feasible non-production blocker-hardening gap. Source-health accepted-decision validation artifacts were present but two review outputs were plan-truncated, so the top-level unreviewed count understated current review scope. `source:health` now adds `--plan-limit=1000` to stale and cross-source review, template, and validation commands, matching the existing read-only `--limit=1000` candidate bound. Regenerated all six stale and two cross-source review/empty-validation artifacts; all now report `planTruncated=false`. The refreshed source-health and broad Beta scorecards show stale validation `6/6` loaded with 575 unreviewed plans and cross-source validation `2/2` loaded with 54 unreviewed plans, with 0 accepted decisions and 0 invalid decisions. This remains review scaffolding only and does not assert source-health acceptance, supersession, source-precedence decisions, or any apply path.

Focused checks for source-health full-scope review handoff:
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` (red first for missing `--plan-limit`, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- Regenerated the six stale and two cross-source source-health review artifacts plus matching empty-decision validation artifacts from the source-health recommended commands, all read-only.
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- JSON inspection of `/tmp/ylabs-source-health.json` and `/tmp/ylabs-beta-quality.json`

Files changed for source-health full-scope review handoff: `server/src/scripts/sourceHealth.ts`, `server/src/scripts/__tests__/sourceHealth.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: inspect the roadmap again for any remaining feasible non-production code-bearing item. Production promotion remains blocked on the real Atlas restore point, real Production guarded-copy dry-run review, rollback-tested status, and production smoke results; source-health, duplicate-name, same-PI, and launch-review gates remain blocked on accepted reviewer decisions.

## Previous Stop Reason

Stopping because the remaining inspected roadmap items are blocked by true external or review-gated requirements, not by local implementation gaps found in this pass.

- Production promotion remains blocked on a fresh Atlas restore point, real Production guarded-copy dry-run review, rollback-tested status, and production smoke results. No production write/copy/smoke was run.
- Launch trust/Beta repair lanes are blocked on new official source evidence, materializer logic, accepted non-launch posture, or reviewer decisions: source-description dry-run repaired `0/500`, PI identity repaired `0/65`, action evidence has `0` current blockers, and review exceptions have `92` unreviewed plans.
- Data-quality promotion remains blocked on `sourceHealthWarnings` and `duplicateEntityNames`. Source-health validation scaffolding is complete but has `629` unreviewed conflict plans; duplicate-name and same-PI artifacts have `34` and `29` unreviewed decision plans respectively.
- OpenAlex retention apply mode remains blocked because deletion/production retention apply is not allowed in this operator run. Dry-run artifact saving is implemented and verified.
- Publication source chunks remain blocked on an explicit decision that broader identity-backed biomedical/publication enrichment is desired; broad external chunks were not run.
- Post-Beta legacy cleanup remains blocked until production copy/smoke proves canonical surfaces with accepted Beta data.

Exact next command for a future non-production status refresh:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json
```

Exact next engineering task if reviewer decisions or source evidence appear: validate the accepted decision artifact for the relevant blocker (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, or `launch:review-exceptions`) and only then design a bounded guarded apply path if the validation artifact has `invalidDecisionCount=0`.

## Recommended Next Roadmap Item

The next roadmap item remains Production scraper rollout, but only after the external production gate facts are recorded. Until then, the next feasible local action is reviewer-decision validation for the existing source-health, duplicate-name, same-PI, or launch-review exception artifacts; no production copy, production smoke, production scraper writes, destructive repair, or data deletion should run.

## Current Stop Reason

2026-05-31 20:08 self-check: After completing the duplicate-name full-scope validation cap and source-health full-scope review handoff, I re-read the active priority queue and inspected the saved Beta artifacts. No remaining highest-priority non-production code-bearing item is currently feasible without new official source evidence, accepted reviewer decisions, or external production facts.

- Launch trust and Beta repair lanes: the current acquisition and repair artifacts show no deterministic PI/action/source-description repair candidates; remaining rows need new source evidence, explicit non-launch acceptance, or reviewer decisions.
- Data-quality blockers: source-health validation has 629 unreviewed conflict plans, duplicate-name validation has 34 unreviewed plans, same-PI dedupe has 29 unreviewed plans, and launch review exceptions have 92 unreviewed plans. All have 0 invalid decisions, but also 0 accepted decisions; no apply path should be designed until actual reviewer decisions exist.
- Production promotion: still blocked on the real Atlas restore point, real Production guarded-copy dry-run review, rollback-tested status, and production smoke results. No production copy, production smoke, production scraper write, retention apply, destructive action, or data deletion was run.
- Remaining roadmap rows: OpenAlex retention apply is deletion-gated, publication chunks require an explicit broader-coverage decision, admin PI claim/Scholar/field-lock workflows are intentionally blocked until concrete workflow decisions exist, and post-Beta legacy cleanup waits for production copy/smoke.

Exact next safe command for status refresh:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json
```

Exact next engineering task if inputs appear: validate the relevant accepted-decision artifact (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, or `launch:review-exceptions`) and design a bounded guarded apply path only if validation has `invalidDecisionCount=0` and actual accepted decisions are present.

2026-05-31 20:12 same-PI accepted-decision apply guard: Resumed from the active goal and found one feasible non-production safety hardening item in the same-PI dedupe review path. `research-entity:dedupe-by-pi` already exposed accepted-decision validation, but `--apply --accepted-decisions` did not explicitly fail even though accepted decisions are validation-only and not used to filter apply groups. Added a guard so same-PI dedupe apply refuses accepted-decision artifacts until a real decision-filtered apply path exists. Dry-run template/validation remains available, and the refreshed `/tmp/ylabs-research-entity-dedupe.json` records the new blocked-apply reason with 29 unreviewed plans, 0 accepted decisions, and 0 invalid decisions. No same-PI apply, production write, deletion, or destructive repair was run.

Focused checks for same-PI accepted-decision apply guard:
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` (red first for missing accepted-decision apply guard, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10 --output /tmp/ylabs-launch-acquisition-report.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples --output /tmp/ylabs-scraper-integrity.json` (expected failure only on `samePiSameNameResearchEntities=9`)
- `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json`

Files changed for same-PI accepted-decision apply guard: `server/src/scripts/dedupeResearchEntitiesByPi.ts`, `server/src/scripts/__tests__/researchEntityPiDedupeCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: continue the roadmap self-check for any remaining feasible non-production code-bearing hardening item. Current inspected blockers remain reviewer decisions/source evidence for launch/data-quality queues and external production facts for promotion.

2026-05-31 20:17 claim-gate artifact metadata: Found another feasible local hardening item in existing admin/data-quality tooling. The standalone `scraper:claim-gate` command wrote validation reports but did not annotate the saved artifact with the target environment, database label, or command scope. Added `buildClaimGateOutput` and wired the CLI through it so saved claim-gate review packets include `environment`, `db`, and `options` while remaining read-only. Verified with a tiny Beta probe that wrote `/tmp/ylabs-claim-gate.json` with `environment=beta`, `db=Beta`, and the requested limit/options. No admin UI, production access, write path, or workflow decision was added.

Focused checks for claim-gate artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/claimGate.test.ts` (red first for missing `buildClaimGateOutput`, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:claim-gate --limit=1 --include-samples --output /tmp/ylabs-claim-gate.json`

Files changed for claim-gate artifact metadata: `server/src/scripts/claimGate.ts`, `server/src/scripts/__tests__/claimGate.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: continue the final roadmap self-check. Production promotion, reviewer-decision apply design, source acquisition, broad publication chunks, retention apply, admin PI/Scholar/field-lock UI, and post-production legacy cleanup remain blocked by the known external or workflow prerequisites unless another local safety/testability gap is found.

2026-05-31 20:25 same-PI apply-blocked reason handoff: Found a feasible non-production handoff gap after the same-PI apply guard. The same-PI dry-run artifact recorded the blocked apply reason, but the broad `beta:data-quality` scorecard, Operator Board service normalization, and admin UI did not carry it through. `samePiDedupeReview.applyBlockedReason` now appears in `beta:data-quality`, is preserved by saved scorecard loading, and is rendered in the Operator Board so reviewers can see the precise reason `--apply --accepted-decisions` is blocked until decision-filtered apply exists. The refreshed Beta scorecard remains non-production read-only and still reports `promotionReady=false`, `promotionBlockerCount=2`, source-health warnings, and duplicate-name review blockers. No production copy, production smoke, same-PI apply, destructive action, or data deletion was run.

Focused checks for same-PI apply-blocked reason handoff:
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (red first for missing `applyBlockedReason`, then green)
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (also fixed fresh-artifact tests to pass explicit `now` so the 48-hour stale guard is deterministic)
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing UI text, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- JSON inspection of `/tmp/ylabs-beta-quality.json`
- `git diff --check`

Files changed for same-PI apply-blocked reason handoff: `server/src/scripts/betaDataQualityCore.ts`, `server/src/scripts/__tests__/betaDataQualityCore.test.ts`, `server/src/services/adminOperatorBoardService.ts`, `server/src/services/__tests__/adminOperatorBoardService.test.ts`, `client/src/components/admin/AdminOperatorBoard.tsx`, `client/src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Next selected engineering task: refresh Graphify for the code/docs changes, then re-inspect the roadmap for any remaining feasible non-production code-bearing item. Known production/external blockers remain unchanged.

## Current Stop Reason

2026-05-31 20:26 self-check after same-PI handoff: Re-read the unchecked roadmap rows and refreshed status after Graphify. The completed substantial engineering milestone in this run is the same-PI apply-blocked reason handoff across `beta:data-quality`, saved Operator Board normalization, and the admin UI. Focused tests, server typecheck, `git diff --check`, a refreshed read-only Beta scorecard, and Graphify refresh completed.

Remaining unchecked roadmap rows are currently blocked by true external or explicitly deferred requirements:
- Production promotion needs a real Atlas restore point, real Production guarded-copy dry-run review, rollback-tested status, and production smoke results. No production copy, production write, production smoke, or deployment was run.
- Lane B production sources, post-copy materialization/search/smoke, and recurring production jobs are production operations and remain blocked by the same gate.
- PI claim flow, Scholar disambiguation, and broader field-lock UI remain intentionally deferred until the workflow is clear enough to avoid building the wrong admin UX.
- Post-Beta legacy naming and denormalization cleanup remains gated until production copy/smoke proves canonical surfaces and saved workflows are stable.
- Current data-quality and launch blocker apply paths still require actual accepted reviewer decisions or new official source evidence; existing source-health, duplicate-name, same-PI, and launch-review artifacts have unreviewed plans but no accepted decisions to apply.

Exact next command if only a status refresh is needed:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json
```

Exact next engineering task if inputs appear: validate the relevant accepted-decision artifact (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, or `launch:review-exceptions`) and design a bounded guarded apply path only if actual accepted decisions are present and validation has `invalidDecisionCount=0`.

2026-06-01 repair-queue blocked-reason rollup: Resumed from the active goal and completed a feasible non-production hardening item in the Beta repair queue and Operator Board path. `beta:repair-queue` now writes `blockedReasonCounts` for blocked attempts, the Operator Board service preserves that rollup from saved artifacts, and the admin Automatic repair gate renders the compact blocker list. The refreshed read-only source-description dry-run at `/tmp/ylabs-beta-repair-source-description.json` scanned 500, repaired 0, blocked 500, and summarized blockers as `missing_description=393`, `missing_action_evidence=269`, `missing_lead=130`, `missing_source_url=93`, `profile_fallback_only=40`, `missing_card_description=38`, and `thin_description=29`. No Beta apply, production write, production copy, destructive action, retention apply, or data deletion was run.

Focused checks for repair-queue blocked-reason rollup:
- `yarn --cwd server test src/scripts/__tests__/betaRepairQueue.test.ts` (red first for missing `blockedReasonCounts`, then green)
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing saved-artifact/gate propagation, then green)
- `yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx` (red first for missing UI text, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=500 --output /tmp/ylabs-beta-repair-source-description.json`
- JSON inspection of `/tmp/ylabs-beta-repair-source-description.json`

Files changed for repair-queue blocked-reason rollup: `server/src/scripts/betaRepairQueue.ts`, `server/src/scripts/__tests__/betaRepairQueue.test.ts`, `server/src/services/adminOperatorBoardService.ts`, `server/src/services/__tests__/adminOperatorBoardService.test.ts`, `client/src/components/admin/AdminOperatorBoard.tsx`, `client/src/components/admin/__tests__/AdminOperatorBoard.test.tsx`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: none.

2026-06-01 Graphify/status refresh: `graphify update .` completed after the repair-queue code and durable-doc changes, rebuilding `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md`. The active roadmap self-check found no further feasible non-production code-bearing item in the unchecked queue after the repair-queue rollup.

Remaining blocked work after safe recovery/self-check:
- Production promotion and Lane B/recurring production operations require true external production facts: real Atlas restore point, real Production guarded-copy dry-run review, rollback-tested status, and production smoke results.
- Data-quality and launch blocker apply paths require actual accepted reviewer decisions or new official source evidence; current source-health, duplicate-name, same-PI, and launch-review artifacts still have unreviewed plans and no accepted decisions.
- PI claim flow, Scholar disambiguation, and broader field-lock UI remain intentionally deferred until workflow requirements are concrete enough to avoid building the wrong admin surface.
- Post-Beta `ResearchGroup`/`lab`/`Listing.owner*` cleanup remains gated until production copy/smoke proves canonical surfaces and saved workflows are stable.

Current in-progress task: none.

Exact next command if only a status refresh is needed:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json
```

Exact next recommended engineering task if inputs appear: validate the relevant accepted-decision artifact (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, or `launch:review-exceptions`) and design a bounded guarded apply path only if actual accepted decisions are present and validation has `invalidDecisionCount=0`.

2026-06-01 department ground-truth seed hardening: Continued the resumed roadmap scan and selected the remaining known-incomplete department seed flow because it was dry-run verified but still ran on import and lacked the standard review artifact/production guard pattern. Added pure parser, output, and apply-guard helpers to `data-migration/seedDepartments.ts`; direct execution is now guarded, saved artifacts include `generatedAt`, `environment`, `db`, and parsed `options`, and Production apply mode requires `CONFIRM_PROD_SCRAPE=true` before Mongo access. A read-only Beta dry-run wrote `/tmp/ylabs-department-ground-truth-seed.json` with `environment=beta`, `db=Beta`, `apply=false`, 126 YCPS subjects, 30 YSM department labels, 162 YSM acronyms, 3 creates, 102 updates, 3 stale deactivations, and 255 unresolved department strings. No department apply, production write/copy, destructive action, or data deletion was run.

Focused checks for department ground-truth seed hardening:
- `yarn --cwd server test src/services/__tests__/departmentGroundTruth.test.ts` (red first for missing seed helpers and import side effect, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server tsx ../data-migration/seedDepartments.ts --output /tmp/ylabs-department-ground-truth-seed.json`
- JSON inspection of `/tmp/ylabs-department-ground-truth-seed.json`

Files changed for department ground-truth seed hardening: `data-migration/seedDepartments.ts`, `server/src/services/__tests__/departmentGroundTruth.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the department seed code/docs changes, then continue the feasibility scan. Next candidate area: inspect remaining lower-priority read-only/audit scripts for target metadata gaps only if they are roadmap-relevant and can be improved without production access or reviewer decisions.

2026-06-01 department ground-truth Beta apply: Continued from the hardened dry-run path and completed the known-incomplete Beta seed application without production access. Verified the canonical replacement rows preserve old abbreviations as aliases (`AFAM` -> `BLST`, `CEE` -> `CENG`, `SPAN/PORT` -> `SPAN`), then ran `SCRAPER_ENV=beta yarn --cwd server tsx ../data-migration/seedDepartments.ts --apply --output /tmp/ylabs-department-ground-truth-seed-apply.json`. The apply inserted 3 rows, modified 102 rows, and marked 3 stale rows inactive. A post-apply dry-run wrote `/tmp/ylabs-department-ground-truth-seed-post-apply.json` and reported 0 creates, 0 updates, 0 deactivations, and 105 unchanged active departments. A direct Beta read confirmed 105 active and 3 inactive departments, with `BLST`, `CENG`, and `SPAN` active and old `AFAM`, `CEE`, and `SPAN/PORT` inactive. No production write/copy, destructive action, data deletion, or department-row deletion was run. One read-only inline TypeScript probe failed because shell expansion stripped `$in`; it was rerun with the Mongo operator safely quoted.

Focused checks for department ground-truth Beta apply:
- `yarn --cwd server test src/services/__tests__/departmentGroundTruth.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server tsx ../data-migration/seedDepartments.ts --apply --output /tmp/ylabs-department-ground-truth-seed-apply.json`
- `SCRAPER_ENV=beta yarn --cwd server tsx ../data-migration/seedDepartments.ts --output /tmp/ylabs-department-ground-truth-seed-post-apply.json`
- JSON inspection of `/tmp/ylabs-department-ground-truth-seed-apply.json` and `/tmp/ylabs-department-ground-truth-seed-post-apply.json`
- Read-only Beta `Department` query for active/inactive canonical replacement rows.

Files changed for the department seed apply documentation: `docs/tasks/priority-roadmap.md` and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after the department seed docs change, then continue the roadmap feasibility scan. Remaining high-priority blockers still appear to be reviewer decisions/new source evidence or true production/external facts.

2026-06-01 department resolver audit-noise fix: Continued from the Beta seed apply and found a code-level cleanup path in the unresolved department-string audit. The resolver recognized canonical display names and raw aliases, but not legacy alias display labels such as `AFAM - Black Studies`, `CEE - Chemical & Environmental Engineering`, `SPAN/PORT - Spanish & Portuguese`, or `ASTR - Astronomy`, so the post-apply audit still counted those as unresolved even though the aliases were source-backed. Added failing resolver coverage first, then expanded `buildResolverKeys()` to pair code-like aliases with canonical/alias labels. A refreshed read-only Beta dry-run wrote `/tmp/ylabs-department-ground-truth-seed-resolver.json` with 0 seed diff and unresolved values reduced from 255 to 221. Remaining unresolved samples are mostly org/unit labels and student majors, so they need a separate normalization/source-cleanup task rather than another blind alias expansion. No data write, production write/copy, destructive action, or data deletion was run for this resolver fix.

Focused checks for department resolver audit-noise fix:
- `yarn --cwd server test src/services/__tests__/departmentGroundTruth.test.ts` (red first for missing legacy alias display keys, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server tsx ../data-migration/seedDepartments.ts --output /tmp/ylabs-department-ground-truth-seed-resolver.json`
- JSON inspection of `/tmp/ylabs-department-ground-truth-seed-resolver.json`

Files changed for department resolver audit-noise fix: `data-migration/departmentGroundTruth.ts`, `server/src/services/__tests__/departmentGroundTruth.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after the resolver code/docs changes, then continue the roadmap feasibility scan.

2026-06-01 department unresolved-string categorization: Continued from the resolver fix and made the remaining department cleanup backlog more implementation-ready. Added `classifyUnresolvedDepartmentString()` plus per-source and top-level category rollups to the seed audit artifact. A refreshed read-only Beta dry-run wrote `/tmp/ylabs-department-ground-truth-seed-categorized.json` with 0 seed diff and 221 unresolved values categorized as 77 administrative units, 38 research centers/programs, 27 medical specialties/subdepartments, 17 student majors, and 62 unclassified strings. This clarifies that the next cleanup should separate department aliases from org units, centers/programs, and majors instead of blindly adding aliases. No data write, production write/copy, destructive action, or data deletion was run for this categorization pass.

Focused checks for department unresolved-string categorization:
- `yarn --cwd server test src/services/__tests__/departmentGroundTruth.test.ts` (red first for missing classifier, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server tsx ../data-migration/seedDepartments.ts --output /tmp/ylabs-department-ground-truth-seed-categorized.json`
- JSON inspection of `/tmp/ylabs-department-ground-truth-seed-categorized.json`

Files changed for department unresolved-string categorization: `data-migration/seedDepartments.ts`, `server/src/services/__tests__/departmentGroundTruth.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after the categorized-audit code/docs changes, then continue scanning for the next feasible roadmap item.

2026-06-02 refreshed Beta review packets after `continue goals`: Re-ran `git status --short`, re-read `AGENTS.md`, `graphify-out/GRAPH_REPORT.md`, `docs/tasks/priority-roadmap.md`, and this plan. Then refreshed the read-only Beta source-health and data-quality packets and regenerated the one missing cross-source review artifact plus all stale/cross-source accepted-decision validation artifacts with `--allow-empty-decisions`. The final `/tmp/ylabs-source-health.json` reports 21 ok / 7 warn / 0 error, scraper report artifacts 6/6 available, stale review artifacts 6/6 available, cross-source review artifacts 2/2 available, validation artifacts 8/8 available, 0 accepted decisions, 0 invalid decisions, 575 unreviewed stale plans, and 54 unreviewed cross-source plans. The final `/tmp/ylabs-beta-quality.json` remains warn-only with `errorCount=0`, `promotionReady=false`, and `promotionBlockerCount=2` (`sourceHealthWarnings`, `duplicateEntityNames`). `scraper:integrity-gate` still fails only on `samePiSameNameResearchEntities=9`. The refreshed same-PI dedupe validation has 29 unreviewed plans and 0 accepted decisions; duplicate-name review has 34 planned clusters, 20 merge-preflight-ready, 14 manual-disambiguation-required, and 517 impacted references. No production write/copy, apply mode, destructive action, data deletion, or reviewer decision acceptance was run.

Read-only checks/artifacts refreshed in this pass:
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server observations:cross-source-conflict-review --source=ysm-atoz-index --queue=priority_review --limit=1000 --sample-size=20 --plan-limit=1000 --output /tmp/ylabs-cross-source-observation-conflicts-ysm-atoz-index-priority_review.json`
- Six stale-observation accepted-decision validation commands for `centers-institutes-index`, `department-undergrad-research`, `dept-faculty-roster`, `ysm-atoz-index`, `nih-reporter`, and `nsf-award-search`, all with `--allow-empty-decisions`.
- Two cross-source accepted-decision validation commands for `department-undergrad-research` and `ysm-atoz-index`, both with `--allow-empty-decisions`.
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples --output /tmp/ylabs-scraper-integrity.json` (expected failure on review-first same-PI duplicates only)
- `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=34 --decision-template-output /tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json --output /tmp/ylabs-duplicate-entity-name-review.json`
- Node JSON inspection of `/tmp/ylabs-beta-quality.json`, `/tmp/ylabs-source-health.json`, `/tmp/ylabs-scraper-integrity.json`, `/tmp/ylabs-research-entity-dedupe.json`, and `/tmp/ylabs-duplicate-entity-name-review.json`.

Blocked production/external work remains unchanged: no fresh Atlas restore point, no real Production guarded-copy dry-run review, no rollback-tested status, and no production smoke result. Blocked non-production apply work is now reviewer-input-bound: source-health stale/cross-source queues, duplicate-name clusters, same-PI duplicate entity plans, and launch review exceptions all need accepted decisions before any guarded apply path should be designed. Current in-progress task: run final diff/check/Graphify refresh after this docs update, then stop only if the final roadmap self-check still finds no feasible non-production code-bearing item.

2026-06-01 user-email hygiene blocked-apply hardening: Continued the active roadmap goal after re-reading startup docs and scanning the remaining package-exposed script surfaces. Found one feasible non-production safety gap: `users:email-hygiene --apply` was blocked, but the direct-run wrapper reached `initializeConnections()` before parsing and rejecting the flag. Changed the parser to represent `apply=true`, added `assertUserEmailHygieneApplyAllowed()` backed by the shared production write guard, and moved the direct-run guard before Mongo connection. The command remains dry-run-only; apply mode is still blocked, and production apply mistakes now fail before DB access. No production write/copy, destructive action, data deletion, user deletion, or external-service action was run.

Focused checks for user-email hygiene blocked-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/userEmailHygiene.test.ts` (red first for missing guard/preconnection behavior, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server users:email-hygiene --limit=5 --sample-size=5 --output /tmp/ylabs-user-email-hygiene.json`
- `SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=false yarn --cwd server users:email-hygiene --apply` (expected guard failure before any DB connection banner)

Files changed for user-email hygiene blocked-apply hardening: `server/src/scripts/userEmailHygiene.ts`, `server/src/scripts/userEmailHygieneCore.ts`, `server/src/scripts/__tests__/userEmailHygiene.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the code/docs change, then continue the feasibility scan for another non-production code-bearing item. Known production blockers remain the real Atlas restore point, real Production guarded-copy dry-run review, rollback-tested status, and production smoke result.

2026-06-01 stale-observation review blocked-apply hardening: Continued the package-exposed script scan and found the same preconnection gap in `observations:stale-conflict-review`. The command was dry-run-only and used the shared guard for metadata, but direct execution called `initializeConnections().then(main)`, so a mistaken `--apply` was rejected only after opening Mongo. Added `apply` to parsed args, exported `assertStaleObservationConflictReviewApplyAllowed()`, moved the direct-run guard before `initializeConnections()`, and kept the command read-only with apply mode blocked. No observation supersession apply, production write/copy, destructive action, data deletion, or external-service action was run.

Focused checks for stale-observation review blocked-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/staleObservationConflictReview.test.ts` (red first for missing guard/preconnection behavior, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=dept-faculty-roster --limit=5 --sample-size=2 --plan-limit=2 --output /tmp/ylabs-stale-observation-conflicts-guard-probe.json`
- `SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=false yarn --cwd server observations:stale-conflict-review --apply` (expected guard failure before any DB connection banner)

Files changed for stale-observation review blocked-apply hardening: `server/src/scripts/staleObservationConflictReview.ts`, `server/src/scripts/__tests__/staleObservationConflictReview.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after the stale-review code/docs change, then re-run the preconnection scan for any remaining non-production code-bearing hardening item.

2026-06-01 scraper CLI preconnection guard hardening: Continued the preconnection scan after `users:email-hygiene` and `observations:stale-conflict-review` were fixed. The remaining general scraper CLI opened Mongo before applying environment guards for `run`, `cron`, `materialize`, and `prune-observations`. Added `buildScraperCliPreflight()` and wired `main()` so those guards are computed from parsed flags before `mongoose.connect()`, then reused after connection for unchanged execution/artifact behavior. This makes mistaken production scraper write/prune invocations fail before DB access. No production write/copy, production scrape, retention apply, destructive action, or data deletion was run.

Focused checks for scraper CLI preconnection guard hardening:
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts` (red first for missing preflight helper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server scrape help`
- `SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-openalex-prune-dry-run-cli-preflight.json`
- `SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=false yarn --cwd server scrape run --source orcid --release` (expected guard failure before any DB connection banner)

Files changed for scraper CLI preconnection guard hardening: `server/src/scrapers/cli.ts`, `server/src/scrapers/__tests__/cli.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after the scraper CLI code/docs change, then re-run the roadmap/source feasibility scan. Known true blockers remain production restore/dry-run/rollback/smoke facts and accepted reviewer decisions for source-health/duplicate-name/same-PI queues.

2026-06-01 scholarly audit command target hardening: Continued the command-surface feasibility scan and found two remaining generated scholarly audit repair commands that could appear unscoped in saved artifacts. `buildScholarlyActivityAuditReportFromCounts` now emits the provenance repair command as `SCRAPER_ENV=beta yarn --cwd server scholarly-links:provenance-audit --apply` when provenance blockers exist, and `buildScholarlyLinkSuppressionAuditOutput` normalizes suppression-audit `fixCommand` values to the same explicit Beta target. Verification used red/green focused tests, nearby command-artifact regression tests, server typecheck, and read-only Beta provenance/suppression audit probes. The live Beta probes found provenance and suppression audits currently pass with empty fix commands, so failure-path command normalization is covered by tests. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for scholarly audit command target hardening:
- `yarn --cwd server test src/services/__tests__/scholarlyActivityAuditService.test.ts src/scripts/__tests__/scholarlyLinkAuditCli.test.ts` (red first for unscoped fix commands, then green)
- `yarn --cwd server test src/services/__tests__/scholarlyActivityAuditService.test.ts src/scripts/__tests__/scholarlyLinkAuditCli.test.ts src/scripts/__tests__/betaReadinessGate.test.ts src/services/__tests__/launchTrustContractService.test.ts src/scripts/__tests__/scraperIntegrityGate.test.ts src/services/__tests__/adminOperatorBoardService.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scholarly-links:provenance-audit --sample-limit=0 --output /tmp/ylabs-scholarly-link-provenance.json`
- `SCRAPER_ENV=beta yarn --cwd server scholarly-links:suppression-audit --sample-limit=0 --output /tmp/ylabs-scholarly-link-suppression.json`

Files changed for scholarly audit command target hardening: `server/src/services/scholarlyActivityAuditService.ts`, `server/src/services/__tests__/scholarlyActivityAuditService.test.ts`, `server/src/scripts/scholarlyLinkSuppressionAudit.ts`, `server/src/scripts/__tests__/scholarlyLinkAuditCli.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the scholarly audit code/docs changes, then continue scanning remaining generated command surfaces for true unscoped artifact gaps.

2026-06-01 final self-check after scholarly command hardening: `git diff --check` passed and `graphify update .` refreshed the graph after the scholarly audit code/docs changes. A saved-artifact command scan across `/tmp/ylabs-beta-readiness.json`, `/tmp/ylabs-launch-trust-contract.json`, `/tmp/ylabs-scraper-integrity.json`, `/tmp/ylabs-beta-quality.json`, `/tmp/ylabs-source-health.json`, `/tmp/ylabs-scholarly-link-provenance.json`, and `/tmp/ylabs-scholarly-link-suppression.json` found 186 command strings and 0 unprefixed operator commands. Re-ran read-only `source:health` and `beta:data-quality`; source health remains 21 ok / 7 warn / 0 error, with all stale/cross-source review artifacts and validation artifacts present but 0 accepted decisions and 629 unreviewed plans, while data quality remains warn-only with `errorCount=0`, `promotionBlockerCount=2`, and blockers only `sourceHealthWarnings` and `duplicateEntityNames`. Checked the package-exposed apply-capable script surfaces that still appeared in the raw write scan; `student-visibility:gate`, `student-visibility:backfill`, `programs:backfill-classification`, `repairListingResearchEntityProfiles`, `pathways:dedupe-exploratory`, and `scraper:claim-gate` already use target-aware artifacts and/or the shared production write guard where writes are possible. Legacy direct scripts such as `importFaculty.ts` and `cleanDepartments.ts` are not package-exposed roadmap commands and are not selected for broad cleanup while post-Beta legacy work is gated.

Blocked work after this scan:
- Production promotion remains blocked on the true external facts: real Atlas restore point, Production guarded-copy dry-run review, rollback-tested status, and production smoke results.
- Source-health cleanup remains blocked on accepted stale/cross-source reviewer decisions; the current validation artifacts have 0 accepted decisions and 629 unreviewed plans.
- Duplicate normalized-name cleanup remains blocked on accepted duplicate-name reviewer decisions plus a reviewed guarded apply path; the current data-quality artifact still has 34 duplicate-name clusters.
- Same-PI dedupe remains validation-only with 29 unreviewed plans; `--apply --accepted-decisions` is intentionally blocked until a decision-filtered apply path exists.
- Launch source/description and PI lanes have no current deterministic source-backed repairs in the latest accepted reports; further repair needs new official source evidence or materializer logic.
- PI claim, Scholar disambiguation, and broader field-lock UI remain deferred until the workflow is concrete.
- Post-Beta legacy naming cleanup remains gated on production copy/smoke stability.

Current in-progress task: none. Exact next recommended engineering task if new inputs appear: validate the relevant accepted-decision artifact first (`source:health` stale/cross-source decisions, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, or `launch:review-exceptions`), and design a bounded guarded apply path only when validation reports `invalidDecisionCount=0` with actual accepted decisions. Without new inputs or production facts, the next safe command is a status refresh: `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`.

2026-06-01 Operator Board command target hardening: Continued the roadmap run after finding a remaining non-production code-bearing gap in the admin gate surface. `adminOperatorBoardService` now normalizes non-production server/scraper follow-up commands to explicit `SCRAPER_ENV=beta` targets for default gates and saved artifact handoffs, including data-quality, repair-queue, scraper-integrity, launch-trust, duplicate-name, hard-error, same-PI, and launch repair-lane commands. The Lane A production-copy dry-run command is intentionally left unprefixed and still blocked on external production facts. No production write/copy, destructive action, data deletion, retention apply, or production smoke was run.

Focused checks for Operator Board command target hardening:
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts` (red first for missing Beta prefixes, then green)
- `npx tsc --noEmit -p server/tsconfig.json`

Files changed for Operator Board command target hardening: `server/src/services/adminOperatorBoardService.ts`, `server/src/services/__tests__/adminOperatorBoardService.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the code/docs changes, then continue the roadmap self-check for any remaining feasible non-production code-bearing item before considering a final stop.

2026-06-01 scraper-integrity recommendation target hardening: The follow-up command scan found that `scraper:integrity-gate` still generated unprefixed remediation commands in its own saved artifacts, even though downstream admin normalization had been hardened. Added a Beta command helper in `server/src/scrapers/integrityGate.ts` and covered same-PI, duplicate-paper/access-signal, and duplicate-person warning recommendations. A read-only Beta artifact refresh exited nonzero as expected because `samePiSameNameResearchEntities=9` is still a real failure, but the saved `/tmp/ylabs-scraper-integrity.json` recommendation is now `SCRAPER_ENV=beta`-prefixed. No apply mode, production write/copy, destructive action, data deletion, retention apply, or production smoke was run.

Focused checks for scraper-integrity recommendation target hardening:
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts` (red first for missing Beta prefixes, then green)
- `yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts src/scripts/__tests__/scraperIntegrityGate.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples --output /tmp/ylabs-scraper-integrity.json` (expected exit 1 because same-PI failures remain; artifact written with prefixed recommendation)

Files changed for scraper-integrity recommendation target hardening: `server/src/scrapers/integrityGate.ts`, `server/src/scripts/__tests__/scraperIntegrityGate.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the scraper-integrity code/docs changes, then continue the command-surface scan. Remaining unprefixed source hits need inspection because some are usage text, production/legacy commands, or already wrapped by local helpers.

2026-06-01 launch-trust command target hardening: Continued the command-surface scan and found that the saved `launch:trust-contract` artifact still emitted unprefixed repair-lane, required visibility-gate, and research/paper audit commands. Added command normalization inside `buildLaunchTrustContractReport()` so server/scraper commands are `SCRAPER_ENV=beta`-prefixed while non-command guidance strings remain unchanged. Refreshed the read-only Beta launch-trust artifact; it remains incomplete (`pass=false`, 1,453 launch-eligible, 109 limited-but-safe, 1,046 held, 58 suppressed, 0 public visibility violations) but all command fields in repair lanes, `requiredCommands`, `researchActivity.command`, and `paperQuality.command` are now Beta-targeted. No apply mode, production write/copy, destructive action, data deletion, retention apply, or production smoke was run.

Focused checks for launch-trust command target hardening:
- `yarn --cwd server test src/services/__tests__/launchTrustContractService.test.ts` (red first for missing Beta prefixes, then green)
- `yarn --cwd server test src/services/__tests__/launchTrustContractService.test.ts src/services/__tests__/adminOperatorBoardService.test.ts src/scripts/__tests__/scraperIntegrityGate.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --output /tmp/ylabs-launch-trust-contract.json`

Files changed for launch-trust command target hardening: `server/src/services/launchTrustContractService.ts`, `server/src/services/__tests__/launchTrustContractService.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the launch-trust code/docs changes, then continue inspecting remaining command-surface hits.

2026-06-01 beta-readiness command target hardening: Continued the command-surface scan and found that the saved `beta:readiness` command packet still mixed target-explicit commands with unprefixed server commands. Added a pure `buildBetaReadinessCommands()` helper and wired the CLI through it so readiness artifacts now emit `SCRAPER_ENV=beta` for source seeding/runs, relevance review, paper authorship audit, Meili rebuilds, and accepted-Meili readiness. A read-only Beta readiness probe wrote `/tmp/ylabs-beta-readiness.json` with `environment=beta`, `db=Beta`, `readyForUnblockedBetaSeed=false` only because `--confirm-beta-backup` was intentionally not supplied in this probe, and all command strings target Beta. No production write/copy, destructive action, data deletion, retention apply, or production smoke was run.

Focused checks for beta-readiness command target hardening:
- `yarn --cwd server test src/scripts/__tests__/betaReadinessGate.test.ts` (red first for missing command builder, then green)
- `yarn --cwd server test src/scripts/__tests__/betaReadinessGate.test.ts src/services/__tests__/launchTrustContractService.test.ts src/scripts/__tests__/scraperIntegrityGate.test.ts src/services/__tests__/adminOperatorBoardService.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:readiness --output /tmp/ylabs-beta-readiness.json`

Files changed for beta-readiness command target hardening: `server/src/scripts/betaReadinessGate.ts`, `server/src/scripts/__tests__/betaReadinessGate.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the beta-readiness code/docs changes, then continue scanning remaining command-surface hits for true generated artifact gaps.

2026-06-01 Beta scorecard command target hardening: Continued after the `continue goals` refresh and found a feasible non-production safety/testability gap in the Beta review packets. The broad `beta:data-quality` scorecard, embedded source-health rows, and same-PI dedupe review guidance emitted several follow-up commands without `SCRAPER_ENV=beta`, even though the roadmap's safe commands require an explicit Beta target. Added focused failing tests first, then prefixed generated weekly/strict data-quality commands, warning next commands, duplicate-name handoff commands, source-health report commands, and same-PI narrow review commands with `SCRAPER_ENV=beta`. Refreshed `/tmp/ylabs-source-health.json`, `/tmp/ylabs-research-entity-dedupe.json`, and `/tmp/ylabs-beta-quality.json`; a recursive JSON scan found 99 command strings and 0 unprefixed operator commands. The refreshed scorecard remains warn-only with `promotionBlockerCount=2` (`sourceHealthWarnings`, `duplicateEntityNames`) and 0 accepted reviewer decisions. No apply mode, production write/copy, retention apply, destructive action, data deletion, or reviewer-decision acceptance was run.

Focused checks for Beta scorecard command target hardening:
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (red first for missing `SCRAPER_ENV=beta` prefixes, then green)
- `yarn --cwd server test src/services/__tests__/sourceHealthService.test.ts src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` (red first for missing nested prefixes, then green)
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts src/services/__tests__/sourceHealthService.test.ts src/scripts/__tests__/researchEntityPiDedupeCore.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- Recursive JSON command scan of `/tmp/ylabs-beta-quality.json`
- `git diff --check`

Files changed for Beta scorecard command target hardening: `server/src/scripts/betaDataQualityCore.ts`, `server/src/scripts/__tests__/betaDataQualityCore.test.ts`, `server/src/services/sourceHealthService.ts`, `server/src/services/__tests__/sourceHealthService.test.ts`, `server/src/scripts/dedupeResearchEntitiesByPi.ts`, `server/src/scripts/__tests__/researchEntityPiDedupeCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the code/docs changes, then continue the roadmap feasibility scan. Known blockers remain accepted reviewer decisions for source-health/duplicate-name/same-PI/launch-review queues and real production restore/dry-run/rollback/smoke facts.

2026-06-01 student visibility gate artifact metadata: Continued artifact-target hardening from the roadmap. `student-visibility:gate` already wrote saved artifacts, but the saved packet did not identify the target database or parsed command scope. Added a pure `buildStudentVisibilityGateOutput` helper and wired stdout/output artifacts through it so review packets include `environment`, `db`, and `options` while preserving dry-run/apply behavior. A read-only Beta dry-run probe wrote `/tmp/ylabs-student-visibility-gate-options.json` with `environment=beta`, `db=Beta`, `collection=all`, `mode=dry-run`, `limit=5`, `scanned=10`, and `changed=0`. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for student visibility gate artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/studentVisibilityGate.test.ts` (red first for missing output builder, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=dry-run --limit=5 --output /tmp/ylabs-student-visibility-gate-options.json`
- JSON inspection of `/tmp/ylabs-student-visibility-gate-options.json`

Files changed for student visibility gate artifact metadata: `server/src/scripts/studentVisibilityGate.ts`, `server/src/scripts/__tests__/studentVisibilityGate.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the student visibility gate code/docs changes, then continue scanning artifact-producing scripts for another feasible non-production hardening item.

2026-06-01 archived-entity artifact repair metadata: Continued the artifact-target scan with `research-entity:repair-archived-artifacts`. The command already had the shared production apply guard and target labels, but saved packets did not include parsed options. Added a pure `buildRepairArchivedEntityArtifactsOutput` helper and wired the CLI through it so review artifacts include `environment`, `db`, and `options` while preserving dry-run/apply behavior. A read-only Beta dry-run wrote `/tmp/ylabs-archived-artifact-repair-options.json` with `environment=beta`, `db=Beta`, `apply=false`, `limit=5`, `maxApply=25`, `scannedArtifacts=0`, and `plannedWrites=0`. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for archived-entity artifact repair metadata:
- `yarn --cwd server test src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts` (red first for missing output builder, then green with core tests)
- `yarn --cwd server test src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts src/scripts/__tests__/repairArchivedEntityArtifactsCore.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:repair-archived-artifacts --limit=5 --output /tmp/ylabs-archived-artifact-repair-options.json`
- JSON inspection of `/tmp/ylabs-archived-artifact-repair-options.json`

Files changed for archived-entity artifact repair metadata: `server/src/scripts/repairArchivedEntityArtifacts.ts`, `server/src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify, then continue the artifact/writability hardening scan for another feasible non-production item.

2026-06-01 scholarly-link audit artifact metadata: Continued with the research-activity audit CLIs. `scholarly-links:provenance-audit` and `scholarly-links:suppression-audit` already supported `--output` and used the shared apply guard, but saved packets lacked generated-at/options metadata. Added pure `buildScholarlyLinkProvenanceAuditOutput` and `buildScholarlyLinkSuppressionAuditOutput` helpers and wired both CLIs through them so artifacts include `generatedAt`, `environment`, `db`, and parsed `options`. Read-only Beta probes with `--sample-limit=0` wrote `/tmp/ylabs-scholarly-link-provenance-options.json` and `/tmp/ylabs-scholarly-link-suppression-options.json`; provenance passed with 43,190 active scholarly links, 0 null-target attributions, 0 orphan attributions, 0 ownerless links, and suppression found 0 dataset/title/duplicate blockers. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for scholarly-link audit artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/scholarlyLinkAuditCli.test.ts` (red first for missing output builders, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scholarly-links:provenance-audit --sample-limit=0 --output /tmp/ylabs-scholarly-link-provenance-options.json`
- `SCRAPER_ENV=beta yarn --cwd server scholarly-links:suppression-audit --sample-limit=0 --output /tmp/ylabs-scholarly-link-suppression-options.json`
- JSON inspection of both saved artifacts

Files changed for scholarly-link audit artifact metadata: `server/src/scripts/scholarlyLinkProvenanceAudit.ts`, `server/src/scripts/scholarlyLinkSuppressionAudit.ts`, `server/src/scripts/__tests__/scholarlyLinkAuditCli.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify, then continue scanning for remaining feasible non-production artifact/writability gaps.

2026-06-01 final artifact-hardening self-check: Completed the remaining feasible non-production artifact metadata pass found by the roadmap/Graphify/source scan. Substantial code-bearing milestones in this continuation added or completed target/options metadata and focused tests for `student-visibility:gate`, `research-entity:repair-archived-artifacts`, `scholarly-links:provenance-audit`, `scholarly-links:suppression-audit`, `papers:quality-audit`, `pathways:dedupe-exploratory`, `scraper:integrity-duplicates-review`, and `scraper:integrity-gate`. Each change had a red/green focused test, server typecheck, a bounded read-only Beta artifact probe where applicable, `git diff --check`, roadmap notes, and Graphify refreshes. The Lane A promotion-copy scan hit was intentionally left unchanged because raw parsed options include Mongo URLs; the summary already records redacted targets plus source/target environment roles without exposing secrets.

Blocked production/external work remains unchanged:
- Production promotion packet still needs a real Atlas restore point, guarded copy dry-run review against Production, rollback-tested status, and production smoke results.
- Lane B production sources, post-copy materialization/search sync/smoke, recurring production jobs, retention applies, and production copy/write actions require production access and explicit production operations.
- PI claim flow, Scholar disambiguation, and broader field-lock UI remain deferred until the review workflow is concrete.
- Post-Beta legacy naming cleanup remains gated on production copy/smoke stability and accepted canonical surfaces.

Checks run in this final artifact-hardening pass:
- `yarn --cwd server test src/scripts/__tests__/studentVisibilityGate.test.ts`
- `yarn --cwd server test src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts src/scripts/__tests__/repairArchivedEntityArtifactsCore.test.ts`
- `yarn --cwd server test src/scripts/__tests__/scholarlyLinkAuditCli.test.ts`
- `yarn --cwd server test src/scripts/__tests__/paperQualityAudit.test.ts src/services/__tests__/paperQualityService.test.ts`
- `yarn --cwd server test src/scripts/__tests__/dedupeExploratoryContactPathways.test.ts`
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityDuplicateReview.test.ts`
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json` after each code-bearing checkpoint
- Bounded read-only Beta probes for the listed artifact commands; `scraper:integrity-gate` exited nonzero as expected because `samePiSameNameResearchEntities` remains a review-first failure.
- `git diff --check`
- `graphify update .` after code/docs changes

Files changed in this continuation: `server/src/scripts/studentVisibilityGate.ts`, `server/src/scripts/__tests__/studentVisibilityGate.test.ts`, `server/src/scripts/repairArchivedEntityArtifacts.ts`, `server/src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts`, `server/src/scripts/scholarlyLinkProvenanceAudit.ts`, `server/src/scripts/scholarlyLinkSuppressionAudit.ts`, `server/src/scripts/__tests__/scholarlyLinkAuditCli.test.ts`, `server/src/scripts/paperQualityAudit.ts`, `server/src/scripts/__tests__/paperQualityAudit.test.ts`, `server/src/scripts/dedupeExploratoryContactPathways.ts`, `server/src/scripts/__tests__/dedupeExploratoryContactPathways.test.ts`, `server/src/scripts/scraperIntegrityDuplicateReview.ts`, `server/src/scripts/__tests__/scraperIntegrityDuplicateReview.test.ts`, `server/src/scripts/scraperIntegrityGate.ts`, `server/src/scripts/__tests__/scraperIntegrityGate.test.ts`, `docs/tasks/priority-roadmap.md`, `docs/tasks/current-execution-plan.md`, and Graphify outputs.

Exact next recommended engineering task: if accepted reviewer-decision artifacts appear, validate the relevant queue first (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, or `launch:review-exceptions`) and only then design a bounded guarded apply path. If production inputs appear, start by filling the Atlas restore point and running a real Production guarded Lane A dry-run review without apply.

Why execution must stop now: after the final roadmap scan, every remaining unchecked roadmap item requires production writes/copy/smoke/restore facts, external credentials or production access, a concrete human/admin workflow decision, or post-production stability. No additional feasible non-production code-bearing roadmap item is visible without those inputs.

2026-06-01 scraper integrity gate artifact metadata: Continued with the central `scraper:integrity-gate` saved gate packet. It already wrote `generatedAt`, `environment`, and `db`, but omitted parsed options. Added a named `ScraperIntegrityGateCliOptions` type and carried `options` through `buildScraperIntegrityGateOutput`. A read-only Beta probe wrote `/tmp/ylabs-scraper-integrity-options.json` with `environment=beta`, `db=Beta`, `includeSamples=true`, `includeClaimGate=false`, `limit=5`, and `status=failure` for the known review-first `samePiSameNameResearchEntities` queue; duplicate exploratory pathways, duplicate access signals, duplicate research papers, and active artifacts on archived entities remained `0`. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for scraper integrity gate artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts` (red first for missing options metadata, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --include-samples --limit=5 --output /tmp/ylabs-scraper-integrity-options.json` (expected nonzero because same-PI review queue remains)
- JSON inspection of `/tmp/ylabs-scraper-integrity-options.json`

Files changed for scraper integrity gate artifact metadata: `server/src/scripts/scraperIntegrityGate.ts`, `server/src/scripts/__tests__/scraperIntegrityGate.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify, then continue scanning for remaining feasible non-production artifact/writability gaps.

2026-06-01 scraper integrity duplicate-review artifact metadata: Continued with `scraper:integrity-duplicates-review`. The command was already read-only and emitted freshness/target/apply-blocked metadata, but the saved report omitted parsed `type`, `limit`, and `output` options. Extended `buildScraperIntegrityDuplicateReviewReport` so artifacts include `options`. A read-only Beta probe wrote `/tmp/ylabs-integrity-duplicates-review-options.json` with `environment=beta`, `db=Beta`, `type=all`, `limit=5`, `applyBlocked=true`, `duplicateResearchPapers=0`, and `duplicateAccessSignals=0`. No apply path, production write/copy, destructive action, or data deletion was run.

Focused checks for scraper integrity duplicate-review artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityDuplicateReview.test.ts` (red first for missing options metadata, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-duplicates-review --type=all --limit=5 --output /tmp/ylabs-integrity-duplicates-review-options.json`
- JSON inspection of `/tmp/ylabs-integrity-duplicates-review-options.json`

Files changed for scraper integrity duplicate-review artifact metadata: `server/src/scripts/scraperIntegrityDuplicateReview.ts`, `server/src/scripts/__tests__/scraperIntegrityDuplicateReview.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify, then continue scanning for remaining feasible non-production artifact/writability gaps.

2026-06-01 exploratory pathway dedupe artifact metadata: Continued with `pathways:dedupe-exploratory`. The command already supported output artifacts and production apply guards, but the saved packet had no freshness timestamp or parsed options. Added a pure `buildDedupeExploratoryContactPathwaysOutput` helper and wired the CLI through it so artifacts include `generatedAt`, `environment`, `db`, and `options`. A read-only Beta dry-run wrote `/tmp/ylabs-dedupe-exploratory-options.json` with `environment=beta`, `db=Beta`, `apply=false`, `limit=5`, `plannedGroups=0`, and `plannedDuplicatePathways=0`. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for exploratory pathway dedupe artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/dedupeExploratoryContactPathways.test.ts` (red first for missing output builder, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server pathways:dedupe-exploratory --mode=dry-run --limit=5 --output /tmp/ylabs-dedupe-exploratory-options.json`
- JSON inspection of `/tmp/ylabs-dedupe-exploratory-options.json`

Files changed for exploratory pathway dedupe artifact metadata: `server/src/scripts/dedupeExploratoryContactPathways.ts`, `server/src/scripts/__tests__/dedupeExploratoryContactPathways.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify, then continue scanning for remaining feasible non-production artifact/writability gaps.

2026-06-01 paper quality audit artifact metadata: Continued with `papers:quality-audit` / `scholarly-links:quality-audit`. The service report already included `generatedAt`, but the CLI wrapper did not include parsed options in saved artifacts. Added a pure `buildPaperQualityAuditOutput` helper and wired the CLI through it so artifacts preserve the service freshness timestamp and include target `environment`, `db`, and parsed `options`. A read-only Beta probe wrote `/tmp/ylabs-paper-quality-options.json` with `environment=beta`, `db=Beta`, `sampleLimit=0`, `strict=false`, `pass=true`, `totalActiveScholarlyLinks=43190`, and `qualityFailureTotal=0`. No production write/copy, destructive action, data deletion, or apply mode was run.

Focused checks for paper quality audit artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/paperQualityAudit.test.ts` (red first for missing output builder, then green with service tests)
- `yarn --cwd server test src/scripts/__tests__/paperQualityAudit.test.ts src/services/__tests__/paperQualityService.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server papers:quality-audit --sample-limit=0 --output /tmp/ylabs-paper-quality-options.json`
- JSON inspection of `/tmp/ylabs-paper-quality-options.json`

Files changed for paper quality audit artifact metadata: `server/src/scripts/paperQualityAudit.ts`, `server/src/scripts/__tests__/paperQualityAudit.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify, then continue scanning for remaining feasible non-production artifact/writability gaps.

2026-06-01 program classification artifact options: Continued the inline target-field artifact scan and selected `programs:backfill-classification`, which already had target environment/db fields and production apply guards but did not persist parsed CLI options. Added a pure `buildBackfillProgramClassificationsOutput()` wrapper and routed reports through it. A read-only Beta dry-run wrote `/tmp/ylabs-program-classifications.json` with `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `options.apply=false`, `options.limit=5`, `scanned=5`, and category counts `Archive / review=3`, `Funding after mentor=1`, and `Research travel funding=1`. The first verification attempt used the wrong script alias (`backfill:program-classifications`) and failed with "Couldn't find a script"; the correct package script is `programs:backfill-classification`. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for program classification artifact options:
- `yarn --cwd server test src/scripts/__tests__/backfillProgramClassifications.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server programs:backfill-classification --limit=5 --output /tmp/ylabs-program-classifications.json`
- JSON inspection of `/tmp/ylabs-program-classifications.json`

Files changed for program classification artifact options: `server/src/scripts/backfillProgramClassifications.ts`, `server/src/scripts/__tests__/backfillProgramClassifications.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after the program-classification code/docs change, then continue checking remaining inline target-field scripts for missing parsed options.

2026-06-01 listing-profile repair artifact options: Continued the adjacent artifact-metadata scan and selected `repairListingResearchEntityProfiles`, which already supported output files, target fields, and apply guards but did not persist parsed CLI options. Added a pure `buildRepairListingResearchEntityProfilesOutput()` wrapper and routed reports through it. There is no package script alias, so the read-only Beta probe used `yarn --cwd server tsx src/scripts/repairListingResearchEntityProfiles.ts --limit=5 --output /tmp/ylabs-repair-listing-entities.json`; it wrote `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `options.apply=false`, `options.limit=5`, and `repairCount=0`. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for listing-profile repair artifact options:
- `yarn --cwd server test src/scripts/__tests__/repairListingResearchEntityProfiles.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server tsx src/scripts/repairListingResearchEntityProfiles.ts --limit=5 --output /tmp/ylabs-repair-listing-entities.json`
- JSON inspection of `/tmp/ylabs-repair-listing-entities.json`

Files changed for listing-profile repair artifact options: `server/src/scripts/repairListingResearchEntityProfiles.ts`, `server/src/scripts/__tests__/repairListingResearchEntityProfiles.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after the listing-profile code/docs change, then continue the feasibility scan for another non-production code-bearing item.

2026-06-01 repair-queue artifact options: Continued the active launch repair handoff hardening. `beta:repair-queue` already saved freshness, target environment/db, and blocked-reason rollups, but artifacts did not persist the parsed lane options. Added parsed `options` to `buildBetaRepairQueueOutput()` and passed the CLI options through the saved/stdout report. A read-only Beta dry-run wrote `/tmp/ylabs-beta-repair-options.json` with `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `options.mode=dry-run`, `options.collection=all`, `options.stage=source_description`, `options.retryBlocked=true`, `options.limit=5`, `scanned=5`, `blocked=5`, and blocker rollups led by `missing_description=4` and `missing_action_evidence=3`. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for repair-queue artifact options:
- `yarn --cwd server test src/scripts/__tests__/betaRepairQueue.test.ts` (red first for missing `options`, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=5 --output /tmp/ylabs-beta-repair-options.json`
- JSON inspection of `/tmp/ylabs-beta-repair-options.json`

Files changed for repair-queue artifact options: `server/src/scripts/betaRepairQueue.ts`, `server/src/scripts/__tests__/betaRepairQueue.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after the repair-queue code/docs change, then continue scanning older artifact writers for missing parsed options or production-write guards.

2026-06-01 launch-trust artifact options: Continued with the top-level launch gate artifact. `launch:trust-contract` already saved freshness and target environment/db metadata, but the saved packet did not include the parsed audit scope flags. Added parsed `options` to `buildLaunchTrustContractOutput()` and passed the CLI options through the saved/stdout report. A non-strict read-only Beta probe wrote `/tmp/ylabs-launch-trust-contract-options.json` with `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `options.collection=all`, `options.mode=student-ready-only`, `includeResearchActivity=true`, `includePaperQuality=true`, `strict=false`, `pass=false`, `launchEligible=1453`, `held=1046`, `publicVisibilityViolations=0`, and repair lanes source/description `998`, PI identity `65`, and review exceptions `92`. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for launch-trust artifact options:
- `yarn --cwd server test src/scripts/__tests__/launchTrustContract.test.ts` (red first for missing `options`, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --output /tmp/ylabs-launch-trust-contract-options.json`
- JSON inspection of `/tmp/ylabs-launch-trust-contract-options.json`

Files changed for launch-trust artifact options: `server/src/scripts/launchTrustContract.ts`, `server/src/scripts/__tests__/launchTrustContract.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after the launch-trust code/docs change, then continue scanning older artifact writers for missing parsed options or production-write guards.

2026-06-01 launch review-exception artifact options: Continued with the companion launch review artifact. `launch:review-exceptions` already generated templates and validation artifacts with target environment/db metadata, but the wrapper was internal and did not persist parsed CLI options. Exported `buildLaunchReviewExceptionOutput()`, added parsed `options`, and routed the CLI through it. A read-only Beta validation/template probe wrote `/tmp/ylabs-launch-review-exceptions-options.json` with `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `options.collection=all`, `options.limit=500`, `options.allowEmptyDecisions=true`, `reviewExceptionCount=92`, `plannedCount=92`, `invalidDecisionCount=0`, `unreviewedPlanCount=92`, and `applyBlocked=true`. No reviewer decision was accepted, no apply path was enabled, and no production write/copy, destructive action, or data deletion was run.

Focused checks for launch review-exception artifact options:
- `yarn --cwd server test src/scripts/__tests__/launchReviewExceptions.test.ts` (red first for missing output builder/options, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:review-exceptions --collection=all --limit=500 --decision-template-output /tmp/ylabs-launch-review-exceptions-options-template.json --accepted-decisions=/tmp/ylabs-launch-review-exceptions-decisions.json --allow-empty-decisions --output /tmp/ylabs-launch-review-exceptions-options.json`
- JSON inspection of `/tmp/ylabs-launch-review-exceptions-options.json`

Files changed for launch review-exception artifact options: `server/src/scripts/launchReviewExceptions.ts`, `server/src/scripts/__tests__/launchReviewExceptions.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after the launch review-exception code/docs change, then continue scanning lower-priority audit artifacts for missing parsed options or production-write guards.

2026-06-01 pathway quality artifact metadata: Continued the artifact-target scan and verified `pathway:quality-audit` now wraps saved/stdout artifacts with target `environment`, `db`, and parsed `options` while preserving the pathway-quality report shape. The focused pathway-quality test covers the output wrapper, server typecheck passed, and a read-only Beta probe wrote `/tmp/ylabs-pathway-quality.json` with `environment=beta`, `db=Beta`, `activePathways=2008`, `weakPathwaysNeedingEvidence=523`, `routesWithoutLinkedPathway=8`, and `missingSourceUrls=145`. No apply mode, production write/copy, destructive action, data deletion, or reviewer decision was run.

Focused checks for pathway quality artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/pathwayQualityAuditCore.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server pathway:quality-audit --sample-limit=5 --output /tmp/ylabs-pathway-quality.json`

Files changed for pathway quality artifact metadata: `server/src/scripts/pathwayQualityAudit.ts`, `server/src/scripts/__tests__/pathwayQualityAuditCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the pathway-quality doc/code changes, then continue the artifact-target scan with the next feasible non-production item (`pathway:relevance-review` or `research:quality-search-review`) if it still lacks target metadata.

2026-06-01 pathway relevance artifact metadata: Continued with `pathway:relevance-review`, which already had `--output` support but did not identify the artifact target. Added a pure `buildPathwayRelevanceReviewOutput()` helper and wired both success and Meili-unavailable outputs to include target `environment`, `db`, and parsed `options` while preserving strict-mode exit behavior and Mongo rollback guidance. A read-only Beta/local Meili probe wrote `/tmp/ylabs-pathway-relevance-review.json` with `environment=beta`, `db=Beta`, `cases=12`, and `divergentCases=7`; the recommendation remains to keep `PATHWAY_SEARCH_BACKEND=mongo` until divergent cases are reviewed. No apply mode, production write/copy, destructive action, data deletion, or production Meili change was run.

Focused checks for pathway relevance artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/pathwayRelevanceReview.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server pathway:relevance-review --page-size=3 --top-k=2 --output /tmp/ylabs-pathway-relevance-review.json`
- JSON inspection of `/tmp/ylabs-pathway-relevance-review.json`

Files changed for pathway relevance artifact metadata: `server/src/scripts/pathwayRelevanceReview.ts`, `server/src/scripts/__tests__/pathwayRelevanceReview.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the pathway-relevance code/docs changes, then continue the artifact-target scan with `research:quality-search-review` if it still lacks target metadata.

2026-06-01 research quality search artifact metadata: Continued with `research:quality-search-review`, another search-confidence review packet used for launch/search posture. Added a pure `buildResearchQualitySearchReviewOutput()` helper and wired the CLI so saved/stdout artifacts include target `environment`, `db`, and parsed `options` while preserving read-only search logic and strict-mode semantics. A bounded Beta/local Meili probe wrote `/tmp/ylabs-research-quality-search-review.json` for the `data science` golden query with `environment=beta`, `db=Beta`, `reviewedEntities=1`, `searchErrors=[]`, and a single `WEAK_SOURCE_TITLE` warning. No apply mode, production write/copy, destructive action, data deletion, or production Meili change was run.

Focused checks for research quality search artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/researchQualitySearchReviewCore.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research:quality-search-review --query="data science" --limit=5 --top-k=3 --output /tmp/ylabs-research-quality-search-review.json`
- JSON inspection of `/tmp/ylabs-research-quality-search-review.json`

Files changed for research quality search artifact metadata: `server/src/scripts/researchQualitySearchReview.ts`, `server/src/scripts/__tests__/researchQualitySearchReviewCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the research search-quality code/docs changes, then continue scanning remaining review artifacts for target metadata.

2026-06-01 beta readiness artifact metadata: Continued with `beta:readiness`, whose saved gate packets are part of the Beta readiness record. Added a pure `buildBetaReadinessGateOutput()` helper and wired the CLI so saved/stdout artifacts include target `environment`, `db`, and parsed `options` while preserving the existing gate logic and strict-mode behavior. A non-strict read-only Beta probe wrote `/tmp/ylabs-beta-readiness.json` with `environment=beta`, `db=Beta`, `readyForUnblockedBetaSeed=true`, `blockingGateNames=[]`, `researchEntities=2479`, `entryPathways=2008`, and `postedOpportunities=0`. This did not verify any production restore point, production dry-run review, rollback drill, production smoke, production copy, or production write.

Focused checks for beta readiness artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/betaReadinessGate.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:readiness --confirm-beta-backup --accept-pathway-meili --output /tmp/ylabs-beta-readiness.json`
- JSON inspection of `/tmp/ylabs-beta-readiness.json`

Files changed for beta readiness artifact metadata: `server/src/scripts/betaReadinessGate.ts`, `server/src/scripts/__tests__/betaReadinessGate.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the beta-readiness code/docs changes, then continue scanning remaining review artifacts for target metadata.

2026-06-01 profile image quality artifact metadata: Continued with `profiles:image-audit`, a read-only public-profile trust audit. Added a pure `buildProfileImageQualityAuditOutput()` helper and wired the CLI so saved/stdout artifacts include target `environment`, `db`, and parsed `options` while preserving strict-mode failure conditions. A read-only Beta probe wrote `/tmp/ylabs-profile-image-quality.json` with `environment=beta`, `db=Beta`, `userCount=7125`, `usersWithImageCount=7125`, `nonPersonImageCount=443`, `duplicateImageGroupCount=529`, and `duplicateImageUserCount=1528`. This records the current review queue only; no profile image repair, production write/copy, destructive action, data deletion, or public exposure change was run.

Focused checks for profile image quality artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/profileImageQualityAuditCore.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server profiles:image-audit --sample-limit=5 --output /tmp/ylabs-profile-image-quality.json`
- JSON inspection of `/tmp/ylabs-profile-image-quality.json`

Files changed for profile image quality artifact metadata: `server/src/scripts/profileImageQualityAudit.ts`, `server/src/scripts/__tests__/profileImageQualityAuditCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the profile-image code/docs changes, then continue scanning remaining review artifacts for target metadata.

2026-06-01 research-entity rename audit artifact metadata: Continued with `research-entity:audit-rename`, a read-only canonical migration-readiness report. Added a pure `buildResearchEntityRenameAuditOutput()` helper and wired the CLI so saved/stdout artifacts include target `environment`, `db`, and parsed `options` while preserving the existing no-write audit behavior. A read-only Beta probe wrote `/tmp/ylabs-research-entity-rename-audit.json` with `environment=beta`, `db=Beta`, canonical `research_entities` present, legacy `research_groups`/`research_group_members` absent, zero live dangling references, and `legacyResidue.totalDocumentsWithResidue=0`. No migration apply, cleanup/drop mode, production write/copy, destructive action, or data deletion was run.

Focused checks for research-entity rename audit artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/auditResearchEntityRename.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:audit-rename --output /tmp/ylabs-research-entity-rename-audit.json`
- JSON inspection of `/tmp/ylabs-research-entity-rename-audit.json`

Files changed for research-entity rename audit artifact metadata: `server/src/scripts/auditResearchEntityRename.ts`, `server/src/scripts/__tests__/auditResearchEntityRename.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the rename-audit code/docs changes, then run the roadmap feasibility scan before deciding whether all remaining non-production code-bearing work is blocked/deferred.

2026-06-01 Meili rebuild artifact metadata and production guard: The artifact scan found `meili:rebuild-pathways` and `meili:rebuild-research-entities` still wrote raw rebuild JSON without target labels, and the commands were write-capable against Meili without the shared production confirmation guard. Added pure output builders and production-write guard helpers for both scripts. Production rebuild writes now require `SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true`; Beta/local rebuild artifacts include target `environment`, `db`, and parsed `options`. Non-clear Beta/local probes refreshed the local indexes and wrote `/tmp/ylabs-meili-researchentities-rebuild.json` with `indexedDocumentCount=3267` and `/tmp/ylabs-meili-pathways-rebuild.json` with `indexedDocumentCount=1446`, both `environment=beta`, `db=Beta`, and `clearedExisting=false`. The runbook Meilisearch gate now shows the guarded production command shape with saved artifact paths. No production Meili write, production copy, destructive action, data deletion, or production traffic switch was run.

Focused checks for Meili rebuild artifact metadata and production guard:
- `yarn --cwd server test src/scripts/__tests__/searchIndexRebuildCli.test.ts` (red first for missing output wrappers/guards, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities --page-size=2000 --output /tmp/ylabs-meili-researchentities-rebuild.json`
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways --page-size=2000 --output /tmp/ylabs-meili-pathways-rebuild.json`
- JSON inspection of both rebuild artifacts

Files changed for Meili rebuild artifact metadata and production guard: `server/src/scripts/rebuildPathwaySearchIndex.ts`, `server/src/scripts/rebuildResearchEntitySearchIndex.ts`, `server/src/scripts/__tests__/searchIndexRebuildCli.test.ts`, `docs/scraper-deployment-runbook.md`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the Meili rebuild code/docs changes, then continue the feasibility scan for remaining independently testable non-production hardening.

2026-06-01 Lane A dry-run summary environment roles: Checked the guarded `production:promote-beta-copy` summary after the artifact scan. It already redacted Beta and Production targets and remained dry-run-first, but reviewers still had to infer environment roles from field names. Added explicit `sourceEnvironment='beta'` and `targetEnvironment='production'` fields to the pure `buildPromotionSummary()` output. Verification used a red/green focused script test plus server typecheck only. No Production dry-run was executed, no production write/copy was run, and the production promotion gate remains blocked on the real Atlas restore point, real Production dry-run review, rollback drill, and production smoke.

Focused checks for Lane A dry-run summary environment roles:
- `yarn --cwd server test src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts` (red first for missing environment-role fields, then green)
- `npx tsc --noEmit -p server/tsconfig.json`

Files changed for Lane A dry-run summary environment roles: `server/src/scripts/promoteAcceptedBetaCopy.ts`, `server/src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the Lane A summary code/docs change, then continue the feasibility scan for remaining non-production code-bearing work.

2026-06-01 student visibility backfill artifact options: Continued the remaining output-writer scan and selected `student-visibility:backfill`, which had target `environment`/`db` and production apply guards but did not persist parsed CLI options in saved artifacts. Added a pure `buildStudentVisibilityBackfillOutput()` wrapper and routed the report through it, preserving tier computation and apply-safety logic. A read-only Beta dry-run wrote `/tmp/ylabs-student-visibility-backfill.json` with `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `options.apply=false`, `options.collection=research`, `options.limit=5`, 5 scanned research rows, and no apply-safety blockers. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for student visibility backfill artifact options:
- `yarn --cwd server test src/scripts/__tests__/studentVisibilityBackfillReport.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:backfill --collection=research --limit=5 --output /tmp/ylabs-student-visibility-backfill.json`
- JSON inspection of `/tmp/ylabs-student-visibility-backfill.json`

Files changed for student visibility backfill artifact options: `server/src/scripts/backfillStudentVisibilityTiers.ts`, `server/src/scripts/__tests__/studentVisibilityBackfillReport.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the student-visibility code/docs change, then continue checking the remaining inline target-field scripts for missing parsed options.

2026-06-01 program classification artifact options: Continued with `programs:backfill-classification`, another apply-capable maintenance command that already had target labels and production guards but did not persist parsed CLI options. Added a pure `buildBackfillProgramClassificationsOutput()` wrapper and routed reports through it. The first probe used a stale alias (`backfill:program-classifications`) and failed before running code; the corrected read-only Beta command wrote `/tmp/ylabs-program-classifications.json` with `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `options.apply=false`, `options.limit=5`, 5 scanned fellowship/program rows, and counts split across Archive/review, Funding after mentor, and Research travel funding. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for program classification artifact options:
- `yarn --cwd server test src/scripts/__tests__/backfillProgramClassifications.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server backfill:program-classifications --limit=5 --output /tmp/ylabs-program-classifications.json` (failed: package script alias does not exist)
- `SCRAPER_ENV=beta yarn --cwd server programs:backfill-classification --limit=5 --output /tmp/ylabs-program-classifications.json`
- JSON inspection of `/tmp/ylabs-program-classifications.json`

Files changed for program classification artifact options: `server/src/scripts/backfillProgramClassifications.ts`, `server/src/scripts/__tests__/backfillProgramClassifications.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run `git diff --check`, refresh Graphify after the program-classification code/docs change, then continue checking remaining inline target-field scripts for missing parsed options.

2026-06-01 user-email hygiene artifact metadata: Continued non-production roadmap hardening after the duplicate-name artifact metadata checkpoint. `users:email-hygiene` already blocked apply mode and reported Lane A copy exclusion posture, but saved artifacts did not identify the target. Added a pure `buildUserEmailHygieneOutput` helper and wired the CLI to wrap stdout/output artifacts with `environment`, `db`, and parsed `options`. The refreshed Beta dry-run still found 2 suspicious users, both excluded by Lane A's guarded copy filter, and made no writes. No production write/copy, destructive action, data deletion, or user deletion was run.

Focused checks for user-email hygiene artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/userEmailHygiene.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server users:email-hygiene --limit=1000 --sample-size=10 --output /tmp/ylabs-user-email-hygiene.json`
- JSON inspection of `/tmp/ylabs-user-email-hygiene.json`

Files changed for user-email hygiene artifact metadata: `server/src/scripts/userEmailHygiene.ts`, `server/src/scripts/__tests__/userEmailHygiene.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the user-email artifact metadata change, then continue the scan with the source-health review commands (`observations:stale-conflict-review` and `observations:cross-source-conflict-review`) if they still lack target metadata.

2026-06-01 source-health review artifact metadata: Hardened the two remaining source-health review commands that lacked target labels. `observations:stale-conflict-review` and `observations:cross-source-conflict-review` now have pure output wrapper helpers and their stdout/saved artifacts include `environment`, `db`, and parsed `options` while preserving `applyBlocked=true` and refusing `--apply`. Small Beta read-only probes verified the metadata on one stale priority-review artifact (`dept-faculty-roster`, 50 candidates, 3 planned groups, truncated) and one cross-source priority-review artifact (`department-undergrad-research`, 30 candidates, 3 planned groups, truncated). No supersession apply, source-precedence apply, production write/copy, destructive action, or data deletion was run.

Focused checks for source-health review artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/staleObservationConflictReview.test.ts src/scripts/__tests__/crossSourceObservationConflictReview.test.ts` (red first for missing output wrappers, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --source=dept-faculty-roster --queue=priority_review --limit=50 --sample-size=2 --plan-limit=3 --output /tmp/ylabs-stale-observation-conflicts-dept-faculty-roster-priority-metadata.json`
- `SCRAPER_ENV=beta yarn --cwd server observations:cross-source-conflict-review --source=department-undergrad-research --queue=priority_review --limit=50 --sample-size=2 --plan-limit=3 --output /tmp/ylabs-cross-source-observation-conflicts-department-undergrad-research-priority-metadata.json`
- JSON inspection of both metadata probe artifacts

Files changed for source-health review artifact metadata: `server/src/scripts/staleObservationConflictReview.ts`, `server/src/scripts/crossSourceObservationConflictReview.ts`, `server/src/scripts/__tests__/staleObservationConflictReview.test.ts`, `server/src/scripts/__tests__/crossSourceObservationConflictReview.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after source-health review metadata changes, then rerun the write/metadata scan to see whether any feasible non-production script hardening remains.

2026-06-01 scraper CLI output target metadata: Confirmed the general `yarn scrape` CLI already uses scraper environment guards, so the static write-guard scan was a false positive. Found a feasible output-review gap instead: saved scraper CLI artifacts relied on console logs for target labels. Added a pure `buildScraperCliOutputPayload` helper and wrapped `run`, `cron`, `materialize`, `report`, and `prune-observations` output payloads with command, target `environment`, `db`, and parsed `options` while preserving existing payload fields. A read-only Beta OpenAlex retention dry-run verified `environment=beta`, `db=Beta`, `command=prune-observations`, `apply=false`, `candidates=0`, and `deleted=0`. No retention apply, deletion, production write/copy, destructive action, or external production action was run.

Focused checks for scraper CLI output target metadata:
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts` (red first for missing output wrapper, then green)
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts src/scrapers/__tests__/scraperCliOutput.test.ts`
- `npx tsc --noEmit -p server/tsconfig.json`
- `yarn --cwd server scrape help`
- `SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-openalex-prune-dry-run-metadata.json`
- JSON inspection of `/tmp/ylabs-openalex-prune-dry-run-metadata.json`

Files changed for scraper CLI output target metadata: `server/src/scrapers/cli.ts`, `server/src/scrapers/__tests__/cli.test.ts`, `docs/scraper-deployment-runbook.md`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after scraper CLI output metadata changes, then inspect whether any remaining feasible non-production code-bearing roadmap item exists.

2026-06-01 core Beta trust scorecard target metadata: The broader output-artifact scan found `beta:data-quality` and `source:health` still wrote high-priority promotion packet artifacts without explicit `environment`/`db` labels. Added pure output wrapper helpers for both scorecards and wired the read-only CLIs to include target `environment`, `db`, and parsed `options` while preserving their existing top-level fields. Refreshed Beta artifacts show `/tmp/ylabs-source-health.json` with `environment=beta`, `db=Beta`, `riskCounts=21 ok / 7 warn / 0 error`, and `/tmp/ylabs-beta-quality.json` with `environment=beta`, `db=Beta`, `status=warn`, and `promotionBlockerCount=2` (`sourceHealthWarnings`, `duplicateEntityNames`). No production write/copy, repair apply, destructive action, data deletion, retention apply, or reviewer-decision acceptance was run.

Focused checks for core Beta trust scorecard target metadata:
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts src/scripts/__tests__/sourceHealth.test.ts` (red first for missing output wrappers, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- JSON inspection of `/tmp/ylabs-source-health.json` and `/tmp/ylabs-beta-quality.json`

Files changed for core Beta trust scorecard target metadata: `server/src/scripts/betaDataQuality.ts`, `server/src/scripts/betaDataQualityCore.ts`, `server/src/scripts/sourceHealth.ts`, `server/src/scripts/__tests__/betaDataQualityCore.test.ts`, `server/src/scripts/__tests__/sourceHealth.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the core scorecard metadata changes, then continue the output-artifact scan for the next highest-priority feasible non-production item.

2026-06-01 launch acquisition report target metadata: The remaining high-priority launch lane artifact `launch:acquisition-report` wrote review JSON without target labels. Added a pure output wrapper and wired the read-only CLI so stdout/saved artifacts include `environment`, `db`, and parsed `options` while preserving the existing lane-map shape. The refreshed Beta artifact at `/tmp/ylabs-launch-acquisition-report.json` has `environment=beta`, `db=Beta`, `scanned=65`, `piIdentity.total=65`, `actionEvidence.total=0`, and still no deterministic PI/action repair candidate. No repair apply, production write/copy, destructive action, data deletion, or reviewer decision was run.

Focused checks for launch acquisition report target metadata:
- `yarn --cwd server test src/scripts/__tests__/launchAcquisitionReport.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10 --output /tmp/ylabs-launch-acquisition-report.json`
- JSON inspection of `/tmp/ylabs-launch-acquisition-report.json`

Files changed for launch acquisition report target metadata: `server/src/scripts/launchAcquisitionReport.ts`, `server/src/scripts/__tests__/launchAcquisitionReport.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the acquisition-report metadata change, then continue the output-artifact scan.

2026-06-01 research-entity coverage audit target metadata: The coverage-gap audit used for source/action/contact review wrote artifacts without target labels. Added a pure `buildResearchEntityCoverageAuditOutput` helper and wired the read-only CLI so saved/stdout artifacts include `environment`, `db`, and parsed `options`. A small Beta audit wrote `/tmp/ylabs-research-entity-coverage-audit.json` with `environment=beta`, `db=Beta`, `totalEntitiesScanned=2479`, `flaggedEntities=1934`, and 5 sampled rows. No repair apply, production write/copy, destructive action, data deletion, or reviewer decision was run.

Focused checks for research-entity coverage audit target metadata:
- `yarn --cwd server test src/scripts/__tests__/researchEntityCoverageAudit.test.ts` (red first for missing output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:coverage-audit --limit=5 --output /tmp/ylabs-research-entity-coverage-audit.json`
- JSON inspection of `/tmp/ylabs-research-entity-coverage-audit.json`

Files changed for research-entity coverage audit target metadata: `server/src/scripts/researchEntityCoverageAudit.ts`, `server/src/scripts/__tests__/researchEntityCoverageAudit.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the coverage-audit metadata change, then continue scanning the remaining lower-priority output artifacts.

2026-06-01 Mongo naming migration safety hardening: Continued the roadmap self-check by auditing remaining package-exposed write/drop scripts. `migrate:mongo-naming` was still a direct one-time migration: importing it attempted to connect to MongoDB, the default command performed writes/drops, and there was no target-aware output artifact or shared production guard. Added focused failing tests first, then made the script import-safe, dry-run-first, artifact-capable with `environment`, `db`, and parsed `options`, and guarded production applies through `CONFIRM_PROD_SCRAPE=true`. A read-only Beta dry-run wrote `/tmp/ylabs-mongo-naming-migration.json`; it reported canonical target collections already present, one empty `researchareas` source collection that would be merged/dropped only under `--apply`, and 13 user documents with legacy top-level field names that would be updated only under `--apply`. No migration apply, collection rename, drop, production write/copy, destructive action, or data deletion was run.

Focused checks for Mongo naming migration safety hardening:
- `yarn --cwd server test src/scripts/__tests__/legacyMigrationCliSafety.test.ts` (red first for missing helpers and import side effect, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server migrate:mongo-naming --dry-run --output /tmp/ylabs-mongo-naming-migration.json`

Files changed for Mongo naming migration safety hardening: `server/src/scripts/migrateMongoNaming.ts`, `server/src/scripts/__tests__/legacyMigrationCliSafety.test.ts`, `docs/decisions.md`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the Mongo naming migration code/docs changes, then continue scanning for any remaining feasible non-production code-bearing hardening item.

2026-06-01 same-PI dedupe artifact metadata: Continued the post-Graphify write-path scan and found that `research-entity:dedupe-by-pi` had production/apply safety guards, but its saved review artifact still lacked target metadata. Added `buildResearchEntityPiDedupeOutput()` and wired the CLI so stdout/output artifacts now include `generatedAt`, `environment`, `db`, and parsed `options`. The refreshed read-only Beta accepted-decision validation dry-run wrote `/tmp/ylabs-research-entity-dedupe.json` with `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `plannedGroups=29`, `plannedDuplicateEntities=29`, `invalidDecisionCount=0`, and `unreviewedPlanCount=29`. No same-PI apply, production write/copy, destructive action, or data deletion was run.

Focused checks for same-PI dedupe artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` (red first for missing target-aware output builder, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json`

Files changed for same-PI dedupe artifact metadata: `server/src/scripts/dedupeResearchEntitiesByPi.ts`, `server/src/scripts/__tests__/researchEntityPiDedupeCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after same-PI artifact metadata changes, then continue scanning for remaining feasible non-production code-bearing hardening.

2026-06-01 source seeding guard and dry-run artifact: Continued the package-exposed write-path scan and found `scrape:seed-sources` still wrote Source registry rows by default, ran on import, and had no production write guard or saved review artifact. Added parser/guard/output helpers, made imports safe, preserved default apply behavior for existing non-production seed commands, added `--dry-run --output <path>`, and required `CONFIRM_PROD_SCRAPE=true` for Production source seeding through the shared guard. A read-only Beta dry-run wrote `/tmp/ylabs-seed-sources-dry-run.json` with `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `sourceCount=27`, all current sources marked `would_update`, and retired-source `matchedCount=0`. No seed apply, production write/copy, destructive action, or data deletion was run.

Focused checks for source seeding guard and dry-run artifact:
- `yarn --cwd server test src/scrapers/__tests__/seedSources.test.ts` (red first for missing helpers, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server scrape:seed-sources --dry-run --output /tmp/ylabs-seed-sources-dry-run.json`

Files changed for source seeding guard and dry-run artifact: `server/src/scrapers/seedSources.ts`, `server/src/scrapers/__tests__/seedSources.test.ts`, `docs/scraper-deployment-runbook.md`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after source seeding code/docs changes, then continue the feasibility scan.

2026-06-01 duplicate-name review artifact metadata: Continued with the active data-quality blocker handoff. `research-entity:duplicate-name-review` was already read-only and apply-blocked, but its saved artifacts carried only a raw `mongoTarget` string instead of the standard `environment`, `db`, and parsed `options` fields used by other promotion packets. Added `buildDuplicateEntityNameReviewOutput()` and wired the CLI through it. The refreshed read-only Beta artifact `/tmp/ylabs-duplicate-entity-name-review.json` now includes `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `planLimit=34`, `clusterCount=34`, `plannedClusterCount=34`, and `applyBlocked=true`. No duplicate-name apply path, production write/copy, destructive action, or data deletion was run.

Focused checks for duplicate-name review artifact metadata:
- `yarn --cwd server test src/scripts/__tests__/duplicateEntityNameReview.test.ts` (red first for missing target-aware output wrapper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=34 --decision-template-output /tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json --output /tmp/ylabs-duplicate-entity-name-review.json`

Files changed for duplicate-name review artifact metadata: `server/src/scripts/duplicateEntityNameReview.ts`, `server/src/scripts/__tests__/duplicateEntityNameReview.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after duplicate-name metadata changes, then continue the feasibility scan.

2026-06-01 retention scorecard scope alignment: Continued the active goal by refreshing the read-only Beta scorecards. `source:health` still reports 21 ok / 7 warn / 0 error, with all stale/cross-source review and validation artifacts present but 0 accepted decisions and 629 unreviewed plans. `beta:data-quality` still has 0 errors and 2 promotion blocker groups (`sourceHealthWarnings`, `duplicateEntityNames`). The refresh surfaced a feasible code-bearing consistency gap: `recommendedCommands.retentionDryRun` was OpenAlex-scoped, but the embedded `scraperRetention` summary still called retention without `sourceName`, so it listed kept run IDs across many sources. Added `buildBetaDataQualityRetentionOptions()` and wired `buildBetaDataQualityScorecard()` through it so the summary and command share `sourceName=openalex`, `olderThanDays=30`, and `keepRuns=3`. Verification used red/green focused tests, server typecheck, refreshed read-only Beta data-quality, and JSON inspection confirming `scraperRetention.sourceName=openalex`, exactly 3 kept OpenAlex run ids, `candidates=0`, `deleted=0`, and the matching `--source openalex` command. No retention apply, deletion, production write/copy, destructive action, or external-service action was run.

Focused checks for retention scorecard scope alignment:
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` before the fix, to identify the broad embedded retention summary
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (red first for missing retention-options helper, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- JSON inspection of `/tmp/ylabs-beta-quality.json` retention scope.

Files changed for retention scorecard scope alignment: `server/src/scripts/betaDataQuality.ts`, `server/src/scripts/betaDataQualityCore.ts`, `server/src/scripts/__tests__/betaDataQualityCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the retention scorecard scope code/docs changes, then repeat the feasibility scan. Remaining known blockers are still accepted-review decisions or production/external facts unless the scan finds another independently testable inconsistency.

2026-06-01 post-retention feasibility scan: Refreshed Graphify after the retention scorecard scope change and re-ran the roadmap/guard scans. The remaining unchecked roadmap rows are still production/external or intentionally deferred: production packet/Production copy-dry-run/rollback/smoke, Lane B/post-copy/recurring production work, PI claim/Scholar/broader field-lock UI pending concrete workflow requirements, and post-production legacy naming cleanup gated on production copy/smoke stability. The raw write-guard scan still reports only `server/src/scripts/dedupeUsersByIdentityCore.ts`, which remains a scanner false positive because the `users:dedupe-by-identity` wrapper rejects `--apply` through the shared guard before Mongo connection and dry-run artifacts carry target metadata. `git diff --check` passed after the retention change. Current in-progress task: none.

Exact next recommended engineering task: if continuing without production facts, rerun the read-only refresh pair (`SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json` and `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`) and inspect for newly surfaced inconsistencies or accepted reviewer decisions. Current refreshed artifacts still have 0 accepted decisions and 629 unreviewed source-conflict plans; do not design apply paths until accepted decisions validate cleanly.

2026-06-01 member-reference repair safety hardening: Continued after the previous self-check and found one more feasible non-production write-guard gap in the already guarded orphan member-reference repair path. `research-entity-members:audit-user-refs --apply` had bounded confirmation and manual-review checks, but it did not use the shared production write guard and saved artifacts did not carry target metadata. Added a pure target guard plus artifact output builder, wired the CLI to guard before DB connection, and saved `environment`, `db`, and parsed `options` in stdout/output artifacts. Verification used red/green focused tests, server typecheck, and a read-only Beta dry-run probe with `--limit=5 --output /tmp/ylabs-member-reference-audit.json`, which reported `orphanedMemberUserRefs=0`, `environment=beta`, and `db=Beta`. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for member-reference repair safety hardening:
- `yarn --cwd server test src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts` (red first for missing target guard/output builder, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity-members:audit-user-refs --limit=5 --output /tmp/ylabs-member-reference-audit.json`
- JSON inspection of `/tmp/ylabs-member-reference-audit.json`

Files changed for member-reference repair safety hardening: `server/src/scripts/researchEntityMemberReferenceAudit.ts`, `server/src/scripts/researchEntityMemberReferenceAuditCore.ts`, `server/src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the member-reference code/docs changes, then continue scanning the remaining write-capable scripts. The remaining unguarded scan candidates are legacy cleanup/migration scripts and user dedupe core; inspect wrappers before assuming any one is feasible.

2026-06-01 user identity dedupe artifact hardening: Continued the write-capable script scan and selected the only remaining non-destructive feasible candidate. `users:dedupe-by-identity` is dry-run-only because user merge/reference rewrite apply mode is intentionally blocked, but its review artifacts lacked target metadata and `--apply` was rejected after the old direct-run wrapper opened Mongo. Added `assertDedupeUsersByIdentityApplyAllowed` backed by the shared production write guard, moved the direct-run wrapper so blocked apply fails before DB connection, and wrapped dry-run artifacts with `environment`, `db`, and parsed `options`. Verification used red/green focused tests, server typecheck, and a read-only Beta dry-run probe with `--limit=5 --output /tmp/ylabs-user-identity-dedupe.json`, which reported `candidateGroups=0`, `environment=beta`, and `db=Beta`. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for user identity dedupe artifact hardening:
- `yarn --cwd server test src/scripts/__tests__/dedupeUsersByIdentityCli.test.ts` (red first for missing output builder/apply guard, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server users:dedupe-by-identity --limit=5 --output /tmp/ylabs-user-identity-dedupe.json`
- JSON inspection of `/tmp/ylabs-user-identity-dedupe.json`

Files changed for user identity dedupe artifact hardening: `server/src/scripts/dedupeUsersByIdentity.ts`, `server/src/scripts/__tests__/dedupeUsersByIdentityCli.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the user identity dedupe code/docs changes, then re-run the feasibility scan. Remaining raw guard-scan hits are expected to be legacy cleanup and canonical migration scripts, which require extra caution because apply modes are destructive or irreversible.

2026-06-01 legacy migration/cleanup CLI safety hardening: Completed a safety-only code-bearing pass on the remaining legacy raw guard-scan hits. Added parser/output/guard helpers to `legacy:cleanup`, `research-entity:migrate`, and `research-entity:cleanup-collections`; apply/drop modes now call the shared production write guard before Mongo connection, and all three CLIs can save target-aware JSON artifacts with `environment`, `db`, and parsed `options`. Verification used red/green focused helper tests, server typecheck, and safe read-only Beta probes only. `legacy:cleanup --verify` wrote `/tmp/ylabs-legacy-cleanup-verify.json` with `verification.ok=true`. `research-entity:migrate --verify` and `research-entity:cleanup-collections --verify` wrote target-aware artifacts but reported `verification.ok=false` because Beta currently has 23 dangling `research_entity_members.researchEntityId` references. No apply mode, drop mode, production write/copy, destructive action, or data deletion was run.

Focused checks for legacy migration/cleanup CLI safety hardening:
- `yarn --cwd server test src/scripts/__tests__/legacyMigrationCliSafety.test.ts` (red first for missing helpers, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server legacy:cleanup --verify --output /tmp/ylabs-legacy-cleanup-verify.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:migrate --verify --output /tmp/ylabs-research-entity-migrate-verify.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:cleanup-collections --verify --output /tmp/ylabs-research-entity-collections-verify.json`
- JSON inspection of all three verify artifacts for `environment`, `db`, `options`, and dangling member-reference counts.

Files changed for legacy migration/cleanup CLI safety hardening: `server/src/scripts/cleanupLegacyMongoCollections.ts`, `server/src/scripts/migrateResearchEntities.ts`, `server/src/scripts/migrateResearchEntityCollections.ts`, `server/src/scripts/__tests__/legacyMigrationCliSafety.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the legacy CLI code/docs changes, then investigate the 23 dangling `research_entity_members.researchEntityId` references as the next feasible non-production integrity item. First determine whether they are archived residue that verify should classify separately or live rows requiring a bounded repair path.

2026-06-01 live-member migration verify scope fix: Investigated the 23 dangling `research_entity_members.researchEntityId` references reported by the read-only migration verify artifacts. A read-only Beta query showed all 23 are PI memberships with `isCurrentMember=false`; 22 are not archived but non-current, and 1 is archived/non-current. Existing runtime/member readiness code scopes active membership to `archived != true` and `isCurrentMember != false`, and `research-entity:audit-rename` already uses that scope. Added the same live-current member filter to `research-entity:migrate --verify` and `research-entity:cleanup-collections --verify` so inactive residue no longer fails live migration readiness. Verification used red/green focused tests, server typecheck, and refreshed read-only Beta verify artifacts. Both refreshed migration artifacts now report `verification.ok=true`; `research-entity:migrate` shows the member check scope/filter and `danglingReferences=0`, while `research-entity:cleanup-collections` reports member `danglingReferences=0`. No apply mode, drop mode, production write/copy, destructive action, or data deletion was run.

Focused checks for live-member migration verify scope fix:
- Read-only Beta diagnostic query for dangling member refs by `archived`/`isCurrentMember` state (initial probe failed due shell `$` interpolation; rerun with single-quoted eval code succeeded)
- `yarn --cwd server test src/scripts/__tests__/legacyMigrationCliSafety.test.ts` (red first for missing live-member scope helpers, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:migrate --verify --output /tmp/ylabs-research-entity-migrate-verify.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:cleanup-collections --verify --output /tmp/ylabs-research-entity-collections-verify.json`
- JSON inspection confirming `verification.ok=true`, `environment=beta`, `db=Beta`, and zero live member dangling references.

Files changed for live-member migration verify scope fix: `server/src/scripts/migrateResearchEntities.ts`, `server/src/scripts/migrateResearchEntityCollections.ts`, `server/src/scripts/__tests__/legacyMigrationCliSafety.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the migration verify scope fix, then re-run the roadmap feasibility scan. Remaining production-promotion work is still blocked on real production restore/dry-run/rollback/smoke facts; continue only with non-production code-bearing or independently testable hardening.

2026-06-01 stopping self-check: Ran the final feasible-work scan after the member-reference, user identity dedupe, legacy CLI safety, and live-member migration verify fixes. The raw write-guard scan has one remaining hit, `server/src/scripts/dedupeUsersByIdentityCore.ts`, but it is a scanner false positive: the wrapper `users:dedupe-by-identity` now rejects `--apply` through `assertDedupeUsersByIdentityApplyAllowed` before DB connection and wraps dry-run artifacts with target metadata. `git diff --check` passed. Fresh focused regression tests for the three touched script areas passed with 30/30 tests, and server typecheck passed. Graphify was refreshed after the last code/docs change. The unchecked roadmap rows are all blocked or intentionally deferred: production promotion needs real Atlas restore point, Production guarded copy dry-run review, rollback-tested status, and production smoke; Lane B/post-copy/recurring work requires production operations; PI claim/Scholar/broader field-lock UI is deferred until the workflow is clear; remaining legacy naming cleanup is gated on canonical surfaces being stable after production copy/smoke. Current in-progress task: none.

Exact next recommended engineering task: when production/external blockers are unavailable but new non-production work is desired, refresh `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` and `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`, then look for newly surfaced code-bearing gaps. If accepted reviewer-decision artifacts appear, validate them first (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, or `launch:review-exceptions`) before designing any bounded guarded apply path.

2026-06-01 posted-opportunity maintenance safety hardening: Resumed the active goal and found a feasible non-production code-bearing gap in the posted-opportunity maintenance CLIs. `posted-opportunities:backfill` and `opportunities:reap-statuses` were dry-run-first and artifact-capable, but apply mode did not use the production write guard and saved artifacts did not identify target environment/DB. Added pure output builders plus apply guard helpers for both commands; apply mode against `SCRAPER_ENV=production` now requires `CONFIRM_PROD_SCRAPE=true`, and saved/stdout artifacts include `environment`, `db`, and parsed `options`. Verification used red/green focused tests, server typecheck, and read-only Beta dry-run probes for both artifact paths. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for posted-opportunity maintenance safety hardening:
- `yarn --cwd server test src/scripts/__tests__/postedOpportunityMaintenanceCli.test.ts` (red first for missing output builders/guards, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server opportunities:reap-statuses --dry-run --limit=5 --output /tmp/ylabs-posted-opportunity-reaper.json`
- `SCRAPER_ENV=beta yarn --cwd server posted-opportunities:backfill --dry-run --limit=5 --output /tmp/ylabs-posted-opportunity-backfill.json`
- JSON inspection of `/tmp/ylabs-posted-opportunity-reaper.json` and `/tmp/ylabs-posted-opportunity-backfill.json`

Files changed for posted-opportunity maintenance safety hardening: `server/src/scripts/backfillPostedOpportunitiesFromListings.ts`, `server/src/scripts/reapPostedOpportunityStatuses.ts`, `server/src/scripts/__tests__/postedOpportunityMaintenanceCli.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after code/docs changes, then continue the roadmap self-check for another feasible non-production code-bearing item.

2026-06-01 application-route backfill safety hardening: Found the same production-write safety gap in `application-routes:backfill-pathways`. The command was dry-run-first and wrote artifacts, but apply mode lacked the shared production guard and artifacts did not identify the target environment/DB. Added pure output and guard helpers, wired main through `assertScriptApplyAllowed`, and saved `environment`, `db`, and parsed `options` in stdout/output artifacts. Verification used red/green focused tests, server typecheck, and a read-only Beta dry-run probe that scanned 5 route candidates, blocked 4 untrusted application URLs, and wrote `/tmp/ylabs-application-route-backfill.json` with `environment=beta` and `db=Beta`. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for application-route backfill safety hardening:
- `yarn --cwd server test src/scripts/__tests__/applicationRoutePathwayBackfillCore.test.ts` (red first for missing output builder/guard, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server application-routes:backfill-pathways --dry-run --limit=5 --output /tmp/ylabs-application-route-backfill.json`
- JSON inspection of `/tmp/ylabs-application-route-backfill.json`

Files changed for application-route backfill safety hardening: `server/src/scripts/backfillApplicationRoutePathways.ts`, `server/src/scripts/__tests__/applicationRoutePathwayBackfillCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the application-route code/docs changes, then continue scanning write-capable non-production maintenance scripts for guard/metadata gaps.

2026-06-01 accepted-inputs safety hardening: Found another operator-facing write path without the shared production guard. `accepted-inputs --apply` can write Scholar/ORCID accepted identifiers to users, so the CLI now calls `assertScriptApplyAllowed` and requires `CONFIRM_PROD_SCRAPE=true` when `SCRAPER_ENV=production`. JSON status/validation/apply outputs are wrapped with `environment`, `db`, and parsed `options`; CSV/text candidate outputs remain command-specific files. Verification used red/green focused tests, server typecheck, and a read-only Beta `accepted-inputs status --output /tmp/ylabs-accepted-inputs-status.json` probe that verified `environment=beta` and `db=Beta`. The status probe reported missing files under the default `/tmp/ylabs-accepted-inputs` root, which is local ephemeral artifact state and was not treated as a production-readiness claim. No accepted-input apply, production write/copy, destructive action, or data deletion was run.

Focused checks for accepted-inputs safety hardening:
- `yarn --cwd server test src/scripts/__tests__/acceptedInputs.test.ts` (red first for missing output builder/guard, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server accepted-inputs status --output /tmp/ylabs-accepted-inputs-status.json`
- JSON inspection of `/tmp/ylabs-accepted-inputs-status.json`

Files changed for accepted-inputs safety hardening: `server/src/scripts/acceptedInputs.ts`, `server/src/scripts/__tests__/acceptedInputs.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the accepted-inputs code/docs changes, then continue the write-guard scan for any remaining feasible non-production hardening gap.

2026-06-01 paper-authorship audit safety hardening: Found another write-capable audit utility without the shared production guard. `papers:authorship-audit --apply` can upsert OpenAlex proof rows, clear unsupported links, supersede direct-author observations, reconcile denormalized arrays, and delete invalid/unidentified rows, so apply mode now requires the shared production guard (`CONFIRM_PROD_SCRAPE=true` when `SCRAPER_ENV=production`). Saved/stdout artifacts also include `environment`, `db`, and parsed `options`. Verification used red/green focused tests, server typecheck, and a conservative read-only Beta probe with `--no-backfill-openalex --sample-limit=0 --output /tmp/ylabs-paper-authorship-audit.json`. The probe verified artifact metadata but found zero papers in the current local/Beta target, so it was not used as a dataset-quality assertion. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for paper-authorship audit safety hardening:
- `yarn --cwd server test src/scripts/__tests__/paperAuthorshipAudit.test.ts` (red first for missing output builder/guard, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server papers:authorship-audit --no-backfill-openalex --sample-limit=0 --output /tmp/ylabs-paper-authorship-audit.json`
- JSON inspection of `/tmp/ylabs-paper-authorship-audit.json`

Files changed for paper-authorship audit safety hardening: `server/src/scripts/paperAuthorshipAudit.ts`, `server/src/scripts/__tests__/paperAuthorshipAudit.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: refresh Graphify after the paper-authorship code/docs changes, then continue the write-guard scan while avoiding legacy destructive migration/cleanup applies.

2026-06-01 continuation self-check after `continue goals`: Re-ran `git status --short`, re-read `AGENTS.md`, `graphify-out/GRAPH_REPORT.md`, the roadmap, and this execution plan, and scanned unchecked roadmap rows. The only unchecked rows remain: production promotion packet and production operations, intentionally deferred PI claim/Scholar/field-lock admin UI, and post-Beta legacy cleanup gated on production copy/smoke stability. `git diff --check` passed before this note. No new production write/copy, retention apply, destructive action, data deletion, or external-service action was run. Current in-progress task: none.

2026-06-01 OpenAlex retention command scoping: Continued the roadmap self-check after the repair-queue rollup and refreshed read-only Beta artifacts. Acquisition and launch-trust still have no deterministic PI/action repairs; `beta:data-quality` remains warn-only with `promotionBlockerCount=2` (`sourceHealthWarnings`, `duplicateEntityNames`). Found a feasible code-bearing safety gap in the data-quality retention handoff: the scorecard recommended a broad observation prune dry-run even though the roadmap's compact-retention policy is OpenAlex-scoped. `buildBetaDataQualityRecommendedCommands` now emits `SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-openalex-prune-dry-run.json`. The refreshed `/tmp/ylabs-beta-quality.json` carries that command, and the matching read-only Beta dry-run wrote `/tmp/ylabs-openalex-prune-dry-run.json` with `apply=false`, `sourceName=openalex`, `candidates=0`, `deleted=0`, `keepRuns=3`, and 3 retained run ids. No retention apply, deletion, production write, production copy, or production smoke was run.

Focused checks for OpenAlex retention command scoping:
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (red first for missing OpenAlex source scope, red again for missing `SCRAPER_ENV=beta`, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10 --output /tmp/ylabs-launch-acquisition-report.json`
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict --output /tmp/ylabs-launch-trust-contract.json` (expected strict incompleteness)
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`
- `SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --source openalex --older-than-days 30 --keep-runs 3 --output /tmp/ylabs-openalex-prune-dry-run.json`
- JSON inspection of `/tmp/ylabs-beta-quality.json` and `/tmp/ylabs-openalex-prune-dry-run.json`

Files changed for OpenAlex retention command scoping: `server/src/scripts/betaDataQualityCore.ts`, `server/src/scripts/__tests__/betaDataQualityCore.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: none.

2026-06-01 final self-check after OpenAlex command scoping: Focused tests, server typecheck, `git diff --check`, and `graphify update .` completed after the retention-command change. The unchecked roadmap rows are unchanged: production promotion/Lane B/post-copy/recurring production work require production facts or production operations; PI claim, Scholar disambiguation, and broader field-lock UI remain workflow-deferred; post-Beta legacy cleanup remains gated on production copy/smoke stability. Refreshed read-only artifacts show no deterministic launch repair candidates: acquisition scanned 65 PI blockers with 0 exact matches and 0 action blockers; strict launch remains incomplete but safety-clean with 0 public visibility violations; data quality remains warn-only with 2 promotion blockers (`sourceHealthWarnings`, `duplicateEntityNames`). No additional feasible non-production code-bearing item is currently visible without accepted reviewer decisions, new official source evidence, concrete admin workflow requirements, or production/external facts.

Current in-progress task: none.

2026-06-02 continuation refresh after `continue goals`: Re-ran `git status --short`, re-read `AGENTS.md`, `graphify-out/GRAPH_REPORT.md`, `docs/tasks/priority-roadmap.md`, and this execution plan, then refreshed the safe Beta artifacts. `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json` passed with 21 ok / 7 warn / 0 error, all stale/cross-source review artifacts present, and all accepted-decision validation artifacts present but still empty: 0 accepted decisions, 0 invalid decisions, 575 unreviewed stale-observation plans, and 54 unreviewed cross-source plans. `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` passed with `status=warn`, `errorCount=0`, `promotionReady=false`, and `promotionBlockerCount=2` for `sourceHealthWarnings` and `duplicateEntityNames`; suspicious synthetic users remain sampled and excluded from Lane A copy by default. The unchecked roadmap rows remain production/external work, concrete workflow-deferred admin UI, or post-production legacy cleanup. No production write/copy, repair apply, accepted reviewer decision, destructive action, data deletion, or external-service action was run.

Current in-progress task: none.

Checks after the continuation refresh: `git diff --check` passed, and `graphify update .` refreshed `graphify-out/graph.json` plus `graphify-out/GRAPH_REPORT.md`.

Exact next command if only a status refresh is needed:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json
```

Exact next recommended engineering task if inputs appear: validate the relevant accepted-decision artifact (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, or `launch:review-exceptions`) and design a bounded guarded apply path only if actual accepted decisions are present and validation has `invalidDecisionCount=0`.

2026-06-01 research-area seed safety hardening: Continued after the repeated blocker audit by inspecting package-exposed data-migration scripts and selected the remaining feasible non-production safety gap in `data-migration/seedResearchAreas.ts`. The script previously wrote on default execution and ran on import. Added parse/output/guard helpers, made imports safe, changed the CLI to dry-run-first with explicit `--apply`, added `--output <path>`, and blocked Production applies through the shared `CONFIRM_PROD_SCRAPE=true` guard before Mongo connection. A read-only Beta dry-run wrote `/tmp/ylabs-research-area-seed-dry-run.json` with `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `plannedCount=639`, `creates=0`, `matches=639`, `upserts=0`, and projected `totalAfter=700`; a Production apply probe exited with the expected guard error before any `Connected to MongoDB` output. No apply mode, production write/copy, destructive action, or data deletion was run.

Focused checks for research-area seed safety hardening:
- `yarn --cwd server test src/services/__tests__/departmentGroundTruth.test.ts` (red first for missing helpers/import safety, then green with 14/14 tests)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd data-migration seed:research-areas --output /tmp/ylabs-research-area-seed-dry-run.json`
- `SCRAPER_ENV=production yarn --cwd data-migration seed:research-areas --apply --output /tmp/ylabs-research-area-seed-prod-blocked.json` (expected guard failure before DB connection)
- JSON inspection of `/tmp/ylabs-research-area-seed-dry-run.json`

Files changed for research-area seed safety hardening: `data-migration/seedResearchAreas.ts`, `server/src/services/__tests__/departmentGroundTruth.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run whitespace checks, refresh Graphify after the research-area seed code/docs change, then continue scanning remaining package-exposed data-migration scripts for a feasible non-destructive hardening item. `importFellowships.ts` still deletes/replaces data and should not be run; only consider making its parsing/output helpers testable if it is still relevant to the roadmap.

2026-06-01 fellowship CSV import safety hardening: Continued the package-exposed data-migration scan and selected `data-migration/importFellowships.ts`, which previously ran on import and deleted/replaced existing fellowship rows by default after a delay. Added dynamic-import safety tests first, then made the script import-safe, dry-run-first, added explicit `--apply` plus `--replace-existing`, supported `--csv <path>` and `--output <path>`, exported parse/transform/output/guard helpers, and blocked Production applies through the shared `CONFIRM_PROD_SCRAPE=true` guard before Mongo connection. A read-only Beta dry-run against `/tmp/ylabs-fellowships-import.csv` wrote `/tmp/ylabs-fellowships-import-dry-run.json` with `environment=beta`, `db=yalelabs0.ilyce1q.mongodb.net/Beta`, `rowCount=1`, `validCount=1`, `existingCount=187`, `deletedCount=0`, and `insertedCount=0`; a Production apply probe exited with the expected guard error before any `Connecting to MongoDB` output. No fellowship apply, production write/copy, destructive action, or data deletion was run.

Focused checks for fellowship CSV import safety hardening:
- `yarn --cwd server test src/scripts/__tests__/fellowshipImportCliSafety.test.ts` (red first for import-time CLI execution/missing helpers, then green with 5/5 tests)
- `npx tsc --noEmit -p server/tsconfig.json`
- temporary `/tmp/ylabs-fellowships-import.csv` one-row fixture generation for CLI verification
- `SCRAPER_ENV=beta yarn --cwd data-migration import:fellowships --csv /tmp/ylabs-fellowships-import.csv --output /tmp/ylabs-fellowships-import-dry-run.json`
- `SCRAPER_ENV=production yarn --cwd data-migration import:fellowships --apply --replace-existing --csv /tmp/ylabs-fellowships-import.csv --output /tmp/ylabs-fellowships-import-prod-blocked.json` (expected guard failure before DB connection)
- JSON inspection of `/tmp/ylabs-fellowships-import-dry-run.json`

Files changed for fellowship CSV import safety hardening: `data-migration/importFellowships.ts`, `server/src/scripts/__tests__/fellowshipImportCliSafety.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Current in-progress task: run focused regression checks, whitespace checks, and Graphify after the fellowship import code/docs change, then continue scanning the remaining data-migration scripts. Treat legacy V4 migrations and department migration applies as destructive/deferred unless a safe import/test/output hardening gap is found without running writes.

2026-06-02 removed-surface V4 backfill blocker hardening: Continued the data-migration feasibility scan after the legacy V4 and migration-safety work. The remaining V4 paper graph and research-group-stats scripts were package-exposed but imported models removed by the canonical cleanup. Added a failing import-safety/blocker-artifact test first, then replaced `BackfillV4PaperGraph.ts` and `BackfillV4ResearchGroupStats.ts` with explicit blocked artifact runners. They now support `--output`, emit `status=blocked` with a concrete redesign path, exit nonzero, and never connect to Mongo. The blocker is implementation, not access: any future migration must be redesigned against current `paper_authors`, `research_scholarly_links`, `research_scholarly_attributions`, analytics, or operator-report semantics. No production write/copy, destructive action, irreversible migration, data deletion, or production readiness assertion was run.

Focused checks for removed-surface V4 blocker hardening:
- `yarn --cwd server test src/scripts/__tests__/dataMigrationV4DeprecatedBackfills.test.ts` (red first on deleted imports, then green)
- `SCRAPER_ENV=production yarn --cwd data-migration migrate:v4:paper-graph --apply --output /tmp/ylabs-v4-paper-graph-blocked.json` (expected blocked artifact, no Mongo connection)
- `SCRAPER_ENV=production yarn --cwd data-migration migrate:v4:research-group-stats --apply --output /tmp/ylabs-v4-research-group-stats-blocked.json` (expected blocked artifact, no Mongo connection)
- Consolidated focused suite: `yarn --cwd server test src/scripts/__tests__/dataMigrationV4Utils.test.ts src/scripts/__tests__/dataMigrationV4GrantBackfill.test.ts src/scripts/__tests__/dataMigrationV4IdentityBackfills.test.ts src/scripts/__tests__/dataMigrationV4DeprecatedBackfills.test.ts src/scripts/__tests__/userMigrationCliSafety.test.ts src/scripts/__tests__/departmentMigrationCliSafety.test.ts src/scripts/__tests__/publicationMigrationCliSafety.test.ts src/scripts/__tests__/rootDataImportCliSafety.test.ts src/scripts/__tests__/fellowshipImportCliSafety.test.ts src/services/__tests__/departmentGroundTruth.test.ts` (10 files, 49 tests passed)
- `npx tsc --noEmit -p server/tsconfig.json`
- `git diff --check`
- `graphify update .`

Files changed for this final milestone: `data-migration/BackfillV4PaperGraph.ts`, `data-migration/BackfillV4ResearchGroupStats.ts`, `server/src/scripts/__tests__/dataMigrationV4DeprecatedBackfills.test.ts`, `docs/tasks/priority-roadmap.md`, `docs/tasks/current-execution-plan.md`, and Graphify output files.

Final feasibility scan after Graphify: Remaining unchecked roadmap rows and active blockers require true production/external facts, accepted reviewer decisions/new official source evidence, concrete PI-claim/Scholar/admin field-lock workflow requirements, or post-production-copy/smoke stability. Package-exposed raw write-scan hits inspected in this pass (`scholarly-links:suppression-audit`, `scholarly-links:provenance-audit`, `opportunities:reap-statuses`, and `posted-opportunities:backfill`) already have direct-run guards, output paths, target metadata, and shared apply guards where relevant. Dormant non-package legacy utilities such as `importFaculty.ts` and `cleanDepartments.ts` are not current roadmap surfaces. No additional feasible non-production code-bearing roadmap item is visible without new inputs.

Current in-progress task: none.

Exact next safe status-refresh command:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json
```

Exact next recommended engineering task if inputs appear: validate the relevant accepted-decision artifact first (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, or `launch:review-exceptions`) and only design a bounded guarded apply path when actual accepted decisions exist and validation reports `invalidDecisionCount=0`. If production inputs appear, fill the Atlas restore point and run a real Production guarded Lane A dry-run review without apply before any production copy or smoke-readiness claim.

2026-06-02 department unresolved-string classifier hardening: Continued the roadmap feasibility scan and selected the explicit department normalization/source-cleanup backlog because active production/launch blockers still require external facts or reviewer decisions. Hardened `classifyUnresolvedDepartmentString()` so the department seed dry-run separates legacy unit-coded department labels (`EASCPS Computer Science`, `FASERM Ethnicity, Race & Migration`), admin/support units, research centers/programs, and medical specialties/subdepartments instead of leaving them in the generic unclassified bucket. This is classification-only for review artifacts; it does not add Department aliases, rewrite data, or claim unresolved values are real departments. The refreshed read-only Beta dry-run remained idempotent with `creates=0`, `updates=0`, `deactivates=0`, and `unchanged=105`; unresolved values stayed 221 total but unclassified strings fell from 62 to 2 (`NONE`, `SOCIAL SCIENCES`).

Focused checks for department unresolved-string classifier hardening:
- `yarn --cwd server test src/services/__tests__/departmentGroundTruth.test.ts` (red first for missing categories, then green)
- `npx tsc --noEmit -p server/tsconfig.json`
- `SCRAPER_ENV=beta yarn --cwd data-migration seed:departments --output /tmp/ylabs-department-ground-truth-seed-categorized.json` (dry-run only, no writes)
- JSON inspection of `/tmp/ylabs-department-ground-truth-seed-categorized.json`: `environment=beta`, `db=Beta`, `categoryCounts={ administrative_unit: 94, legacy_unit_coded_department: 7, medical_specialty_or_subdepartment: 45, research_center_or_program: 56, student_major: 17, unclassified: 2 }`

Files changed for this milestone: `data-migration/seedDepartments.ts`, `server/src/services/__tests__/departmentGroundTruth.test.ts`, `docs/tasks/priority-roadmap.md`, and `docs/tasks/current-execution-plan.md`.

Post-milestone checks: `git diff --check` passed and `graphify update .` refreshed `graphify-out/graph.json` plus `graphify-out/GRAPH_REPORT.md`.

2026-06-02 final feasibility scan after department classifier hardening: Re-ran the roadmap unchecked-row scan and inspected package-exposed write-capable script surfaces. The remaining unchecked roadmap rows are true production/external operations, reviewer-decision/source-evidence queues, workflow-deferred admin UI, or post-production cleanup gates. Production promotion remains blocked on a real Atlas restore point, real Production guarded Lane A dry-run review, rollback-tested status, and production smoke results. Source-health, duplicate-name, same-PI, stale-observation, cross-source, and launch-review queues remain blocked on actual accepted reviewer decisions or new official source evidence; current validation artifacts still contain no accepted decisions. PI claim, Scholar disambiguation, and broader admin field-lock UI remain blocked on concrete human review workflows. Post-Beta legacy naming cleanup remains gated on production copy/smoke stability. Package-exposed script hits checked in this pass, including the V4 identity backfills and previously scanned scholarly/posting maintenance commands, already have import guards, output artifacts, target metadata, and shared production-apply guards or explicit blocked artifacts where relevant. Dormant non-package utilities such as `importFaculty.ts` and `cleanDepartments.ts` are not current roadmap surfaces.

Current in-progress task: none.

Exact next safe status-refresh command:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json
```

Exact next recommended engineering task if inputs appear: validate the relevant accepted-decision artifact first (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, `observations:stale-conflict-review`, `observations:cross-source-conflict-review`, or `launch:review-exceptions`) and design a bounded guarded apply path only after actual accepted decisions exist and validation reports `invalidDecisionCount=0`. If production inputs appear, fill the Atlas restore point and run a real Production guarded Lane A dry-run review without apply before any production copy or smoke-readiness claim.

2026-06-02 blocker audit continuation after `continue goals`: Re-ran the startup loop, Graphify query, source-health, duplicate-name, same-PI, and broad Beta data-quality review artifacts. `source:health` is unchanged at 21 ok / 7 warn / 0 error; stale-observation validation has 6/6 artifacts loaded with 0 decisions, 0 invalid decisions, and 575 unreviewed plans; cross-source validation has 2/2 artifacts loaded with 0 decisions, 0 invalid decisions, and 54 unreviewed plans. The broad `beta:data-quality` scorecard remains `status=warn`, `errorCount=0`, `promotionReady=false`, and `promotionBlockerCount=2` for `sourceHealthWarnings` and `duplicateEntityNames`. Generated the exact expected duplicate-name empty-decision validation artifact at `/tmp/ylabs-duplicate-entity-name-review-decision-validation.json`, then refreshed the broad scorecard so duplicate-name validation is loaded with 0 decisions, 0 invalid decisions, and 34 unreviewed plans. Refreshed same-PI validation at `/tmp/ylabs-research-entity-dedupe.json`; it remains loaded with 0 decisions, 0 invalid decisions, and 29 unreviewed plans. Graphify query surfaced `research-entity:repair-archived-artifacts`; source/test/docs inspection confirmed that command already has import safety, output artifacts, target metadata, max-apply guarding, and shared production apply guard coverage, so it is not a new code-bearing gap. No production write, production copy, repair apply, accepted reviewer decision, destructive action, data deletion, or external-service action was run.

Checks and commands in this continuation:
- `git status --short`
- `graphify query "package-exposed non-production maintenance scripts production guard output artifact remaining roadmap work"`
- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --accepted-decisions=/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-duplicate-entity-name-review-accepted-decisions-template.json --output /tmp/ylabs-duplicate-entity-name-review.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=34 --accepted-decisions=/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json --allow-empty-decisions --output /tmp/ylabs-duplicate-entity-name-review-decision-validation.json`
- `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json`
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`

Final checks in this continuation: `rg -n "\[ \]" docs/tasks/priority-roadmap.md` still shows only the eight unchecked roadmap rows at the production gate, workflow-deferred PI/Scholar/admin UI, and post-Beta legacy cleanup gates. Direct roadmap review of those sections confirmed no hidden non-production code-bearing item remains: lines 425/427/428/429 require production restore/dry-run/smoke/copy or post-smoke recurring jobs; line 522 requires a clearer human workflow; lines 530/531/532 are explicitly gated on Beta/prod surface stability. `git diff --check` passed, and `graphify update .` refreshed `graphify-out/graph.json` plus `graphify-out/GRAPH_REPORT.md` after the roadmap/execution-plan updates.

Current in-progress task: none. The next run should only resume implementation if new accepted reviewer decisions, new official source evidence, concrete PI/Scholar/admin workflow requirements, or production gate facts are available.

2026-06-02 blocked-goal audit after automatic goal continuation: Re-ran the startup loop from current state, including `git status --short`, `AGENTS.md`, `graphify-out/GRAPH_REPORT.md`, `docs/tasks/priority-roadmap.md`, this execution plan, unchecked roadmap row scan, and a Graphify query for remaining feasible non-production code-bearing work. The unchecked roadmap rows are unchanged and still fall into true production operations, workflow-deferred PI claim/Scholar/admin field-lock UI, or post-Beta cleanup gated on production copy/smoke stability. Refreshed current Beta artifacts without writes:

- `SCRAPER_ENV=beta yarn --cwd server source:health --output /tmp/ylabs-source-health.json`: 21 ok / 7 warn / 0 error; stale decision validation 6/6 available with 0 decisions, 0 invalid decisions, 575 unreviewed plans; cross-source validation 2/2 available with 0 decisions, 0 invalid decisions, 54 unreviewed plans.
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --limit=10000 --plan-limit=34 --accepted-decisions=/tmp/ylabs-duplicate-entity-name-review-accepted-decisions.json --allow-empty-decisions --output /tmp/ylabs-duplicate-entity-name-review-decision-validation.json`: 34 clusters, 68 entities, 20 merge-preflight-ready clusters, 14 manual-disambiguation clusters, 517 impacted references, 0 accepted decisions, and apply still blocked.
- `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --output /tmp/ylabs-research-entity-dedupe.json`: 29 same-PI plans, 0 decisions, 0 invalid decisions, 29 unreviewed plans, and accepted-decision apply remains validation-only.
- `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json`: `status=warn`, `errorCount=0`, `promotionReady=false`, and `promotionBlockerCount=2` for `sourceHealthWarnings=7` and `duplicateEntityNames=34`.

No production write, production copy, production dry-run review, repair apply, accepted reviewer decision, destructive action, irreversible migration, data deletion, paid/external service action, or secret-dependent action was run. This is the third consecutive goal-turn audit with the same blocker state after safe blocker recovery had already been attempted through read-only validation artifacts and package-exposed script hardening. The active goal should be marked blocked unless new accepted decisions, official source evidence, concrete PI/Scholar/admin workflow requirements, or production gate facts appear.

2026-06-02 resumed audit after user `continue`: `get_goal` reported the long-running objective is `paused`, so this is a fresh resumed blocked-audit pass rather than a completion claim. Re-ran `git status --short`, checked for leftover long-running commands (`ps -ef | rg "(graphify|yarn|tsx|node|mongosh|vite|vitest|tsc)"`), re-read Graphify, the roadmap, and this execution plan, and scanned package-exposed script surfaces for missing import guards, output artifacts, target metadata, and production-apply guards. The running `yarn dev:client` and `yarn dev:server` processes appear pre-existing from the shared workspace. A reducer over `server/package.json` and `data-migration/package.json` surfaced apparent gaps, but source/test inspection showed they are false positives or already intentionally gated: `research-entity-members:audit-user-refs`, `users:dedupe-by-identity`, and `users:email-hygiene` parse `--output` in core helpers and wrap target metadata; the V4 identity/grant backfills use `v4MigrationUtils` for `--output`, target metadata, and pre-connection production apply guards; `production:promote-beta-copy` already exposes the Lane A dry-run artifact and remains blocked on true production facts. The unchecked roadmap rows remain the same: production packet/copy/smoke/recurring work, workflow-deferred PI claim/Scholar/admin field-lock UI, and post-Beta legacy cleanup gated on production copy/smoke stability. No code-bearing roadmap item is visible in this resumed audit without accepted reviewer decisions, new official source evidence, concrete workflow requirements, or production gate facts.

2026-06-02 resumed audit artifact refresh: Completed the pending read-only artifact refresh after the resumed audit. `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --output /tmp/ylabs-research-entity-dedupe.json` passed with 29 same-PI plans, 0 accepted decisions, 0 invalid decisions, 29 unreviewed plans, and accepted-decision apply still blocked as validation-only. `SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json` passed with `status=warn`, `errorCount=0`, `promotionReady=false`, and `promotionBlockerCount=2` for `sourceHealthWarnings=7` and `duplicateEntityNames=34`. The current `/tmp/ylabs-source-health.json` from this resumed audit reports 21 ok / 7 warn / 0 error, but local scraper report artifacts are not present in this shell (`reportArtifacts.available=0`, `missing=6`), so stale/cross-source decision rollups are empty in this artifact set and should not be treated as readiness evidence. Duplicate-name validation remains 34 clusters, 0 accepted decisions, 0 invalid decisions, and 34 unreviewed plans. No production write, production copy, guarded Production dry-run review, repair apply, accepted reviewer decision, destructive action, irreversible migration, data deletion, paid/external service action, or secret-dependent action was run.

Current in-progress task: none. This is blocker-audit repetition 1 after the previously blocked goal was resumed from `paused`; do not mark restore point, rollback test, smoke test, dry-run review, production readiness, or roadmap completion unless new evidence is actually verified.

Exact next safe status-refresh command:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json
```

Exact next recommended engineering task if inputs appear: validate the relevant accepted-decision artifact first (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, `observations:stale-conflict-review`, `observations:cross-source-conflict-review`, or `launch:review-exceptions`) and design a bounded guarded apply path only after actual accepted decisions exist and validation reports `invalidDecisionCount=0`. If production inputs appear, record the real Atlas restore point and run a real Production guarded Lane A dry-run review without apply before any production copy or smoke-readiness claim.

2026-06-02 resumed audit artifact hardening: Rebuilt the missing local `/tmp` source-health evidence packet with read-only Beta commands. Root `SCRAPER_ENV=beta yarn scrape report ...` failed before scraper execution because the root Yarn workspace reports `rdb@workspace:.` as absent from the lockfile; using the server package entrypoint (`SCRAPER_ENV=beta yarn --cwd server scrape report ...`) succeeded. Regenerated the six expected scraper run reports under `/tmp/ylabs-scraper-reports`, refreshed `source:health`, then generated all six stale-observation review artifacts and both cross-source review artifacts. Finally ran the generated empty-decision validation commands with `--allow-empty-decisions` for all eight review packets and refreshed source-health again.

Final refreshed source-health artifact `/tmp/ylabs-source-health.json` was generated at `2026-06-03T01:22:33.649Z` and reports:
- `riskCounts={ok:21,warn:7,error:0}`
- `reportArtifacts={available:6,missing:0,withConflictReview:6}`
- active observation conflicts: 445 total, 313 actionable, 370 same-source, 75 cross-source
- review queues: 226 priority-review conflicts, 87 context-review conflicts, 132 metadata-review conflicts
- stale-observation review artifacts: 6/6 available, 0 missing; decision validations: 6/6 available, 0 missing, 0 decisions, 0 valid decisions, 0 invalid decisions, 575 unreviewed plans
- cross-source review artifacts: 2/2 available, 0 missing; decision validations: 2/2 available, 0 missing, 0 decisions, 0 valid decisions, 0 invalid decisions, 54 unreviewed plans

No production write, production copy, guarded Production dry-run review, repair apply, accepted reviewer decision, destructive action, irreversible migration, data deletion, paid/external service action, or secret-dependent action was run. The artifact gap is now closed for this shell; the active blocker is the absence of accepted reviewer decisions and production gate facts, not missing local report artifacts. Current in-progress task: none. This remains blocker-audit repetition 1 after the previously blocked goal was resumed from `paused`.

2026-06-02 source-health command hardening after resumed audit: Investigated the root `SCRAPER_ENV=beta yarn scrape report ...` failure from the artifact hardening pass. The command fails before scraper execution because root `package.json` declares Yarn 4 while the root lockfile is Yarn v1 and lacks the root workspace entry (`rdb@workspace:.`). Rather than running a broad dependency install in the dirty shared workspace, updated `sourceHealthService` to emit server-scoped scraper commands (`SCRAPER_ENV=beta yarn --cwd server scrape report ...` and `SCRAPER_ENV=beta yarn --cwd server scrape run ...`). Also updated `beta:data-quality` retention guidance to emit `SCRAPER_ENV=beta yarn --cwd server scrape prune-observations ...` for the same reason. Focused service/data-quality tests now assert the server-scoped operator commands. Regenerated `/tmp/ylabs-source-health.json` and verified its warning/report commands use `yarn --cwd server`; executing one generated report command for `centers-institutes-index` succeeded and saved the expected report artifact. Refreshed `/tmp/ylabs-beta-quality.json` so the broad scorecard carries the server-scoped retention command. Updated the scraper runbook, scraper audit guide, and roadmap command examples to match the working server-scoped entrypoint. No production write, production copy, repair apply, accepted reviewer decision, destructive action, or dependency install was run.

2026-06-03 seed package script hardening: Continued the resumed roadmap scan and found a feasible operator-safety gap in `data-migration/package.json`: legacy `seed:dev`, `seed:prod`, `seed:all`, and `seed:departments:apply` scripts still used positional `dev`/`prod`/`both` arguments or direct apply naming, while the hardened seed CLIs now derive targets from `SCRAPER_ENV`/`.env` and are dry-run-first. Added failing parser tests first, then updated `parseDepartmentSeedArgs` and `parseResearchAreaSeedArgs` to reject unknown positional arguments before Mongo connection. Removed the stale dev/prod/direct-apply package scripts and changed `seed:all` to run the two current dry-run seed commands without positional targets. Runtime probes confirmed `SCRAPER_ENV=beta yarn --cwd data-migration seed:departments prod` and `SCRAPER_ENV=beta yarn --cwd data-migration seed:research-areas both` now fail before DB connection. Read-only Beta dry-runs wrote `/tmp/ylabs-department-ground-truth-seed-cli-hardening.json` (`creates=0`, `updates=0`, `deactivates=0`, `unchanged=105`) and `/tmp/ylabs-research-area-seed-cli-hardening.json` (`creates=0`, `matches=639`, `upserts=0`, `totalAfter=700`). No apply, production write/copy, destructive action, data deletion, or dependency install was run.

Focused checks for seed package script hardening:
- `yarn --cwd server test src/services/__tests__/departmentGroundTruth.test.ts` (red first for ignored positional seed arguments, then green with 14/14 tests).
- `SCRAPER_ENV=beta yarn --cwd data-migration seed:departments prod` (expected unknown-argument failure before DB connection).
- `SCRAPER_ENV=beta yarn --cwd data-migration seed:research-areas both` (expected unknown-argument failure before DB connection).
- `SCRAPER_ENV=beta yarn --cwd data-migration seed:departments --output /tmp/ylabs-department-ground-truth-seed-cli-hardening.json`.
- `SCRAPER_ENV=beta yarn --cwd data-migration seed:research-areas --output /tmp/ylabs-research-area-seed-cli-hardening.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-03 legacy department migration alias hardening: Continued the package-exposed data-migration safety scan and found the same stale direct-apply posture on `migrate:departments:live`. The department migration CLI was already dry-run-first and production-guarded, but its parser still ignored unknown positional arguments and the package alias encouraged direct live/apply execution. Added a failing parser test first, then made `parseDepartmentMigrationArgs` reject unknown positional arguments before source/target database connections. Removed `migrate:departments:live` from `data-migration/package.json` and changed the CLI post-dry-run hint to recommend the explicit `migrate:departments --apply --output /tmp/ylabs-department-migration-apply.json` command after artifact review. Runtime probe `SCRAPER_ENV=beta yarn --cwd data-migration migrate:departments prod` now fails with `Unknown legacy department migration argument: prod` before connection output. No department migration apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for legacy department migration alias hardening:
- `yarn --cwd server test src/scripts/__tests__/departmentMigrationCliSafety.test.ts` (red first for ignored positional argument, then green with 4/4 tests).
- `SCRAPER_ENV=beta yarn --cwd data-migration migrate:departments prod` (expected unknown-argument failure before source/target DB connections).

2026-06-03 legacy migration parser hardening sweep: Continued the data-migration package scan after the department alias fix. Found the same tolerance in the remaining package-exposed migration parsers: `MigrateUsers.ts`, `MigratePublicationsToPapers.ts`, `ImportRootDataFiles.ts`, and shared `v4MigrationUtils.ts` ignored unknown positional arguments, while root-data and V4 limit parsing silently dropped malformed values. Added failing parser tests first, then made all four parsers reject unknown arguments before DB access and require positive integer `--limit` values where limits are supported. `ImportRootDataFiles.ts` also no longer parses `process.argv` during module import, keeping helper imports independent of caller argv. Runtime probes confirmed `migrate:users prod`, `migrate:root-data-files prod`, `migrate:v4:grants prod`, `migrate:root-data-files --limit=bad`, and `migrate:v4:grants --limit bad` all fail before connection output. No migration apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for legacy migration parser hardening sweep:
- `yarn --cwd server test src/scripts/__tests__/userMigrationCliSafety.test.ts src/scripts/__tests__/publicationMigrationCliSafety.test.ts src/scripts/__tests__/rootDataImportCliSafety.test.ts src/scripts/__tests__/dataMigrationV4Utils.test.ts` (red first for tolerated unknown/malformed args, then green with 16/16 tests).
- `SCRAPER_ENV=beta yarn --cwd data-migration migrate:users prod`.
- `SCRAPER_ENV=beta yarn --cwd data-migration migrate:root-data-files prod`.
- `SCRAPER_ENV=beta yarn --cwd data-migration migrate:v4:grants prod`.
- `SCRAPER_ENV=beta yarn --cwd data-migration migrate:root-data-files --limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd data-migration migrate:v4:grants --limit bad`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-03 aggregate migration alias hardening: Continued the package-exposed data-migration safety scan after parser hardening. Found that `data-migration/package.json` still advertised aggregate migration aliases (`migrate:all`, `migrate:v4:identity`, and `migrate:v4:all`) even though current migration posture is per-step dry-run review with saved artifacts, and the V4 all path includes intentionally blocked removed-surface runners. Added a failing package-script test first, then removed those aliases while leaving individual dry-run-first migration commands available. No migration apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for aggregate migration alias hardening:
- `yarn --cwd server test src/scripts/__tests__/dataMigrationPackageScripts.test.ts` (red first for exposed aggregate aliases, then green with 1/1 tests).

2026-06-03 Meili rebuild parser hardening: Continued the package-exposed server script safety scan and found the two search-index rebuild CLIs tolerated unknown positional arguments and silently ignored malformed `--page-size` values. Added failing parser assertions first, then made `meili:rebuild-pathways` and `meili:rebuild-research-entities` reject unknown arguments and require positive integer page sizes before connection or Meili rebuild work. Runtime probes confirmed `prod` and `--page-size=bad` fail in parser code for both commands. No Meili rebuild, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for Meili rebuild parser hardening:
- `yarn --cwd server test src/scripts/__tests__/searchIndexRebuildCli.test.ts` (red first for tolerated unknown/malformed args, then green with 8/8 tests).
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways prod`.
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities prod`.
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways --page-size=bad`.
- `SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities --page-size=bad`.

2026-06-03 posted-opportunity maintenance parser hardening: Continued the package-exposed server script safety scan and found `posted-opportunities:backfill` and `opportunities:reap-statuses` tolerated unknown positional arguments and silently ignored malformed `--limit` values. Added failing parser assertions first, then made both parsers reject unknown arguments and require positive integer limits before DB work. Runtime probes confirmed `prod` and `--limit=bad` fail in parser code for both commands. No posted-opportunity backfill/reap apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for posted-opportunity maintenance parser hardening:
- `yarn --cwd server test src/scripts/__tests__/postedOpportunityMaintenanceCli.test.ts` (red first for tolerated unknown/malformed args, then green with 8/8 tests).
- `SCRAPER_ENV=beta yarn --cwd server posted-opportunities:backfill prod`.
- `SCRAPER_ENV=beta yarn --cwd server opportunities:reap-statuses prod`.
- `SCRAPER_ENV=beta yarn --cwd server posted-opportunities:backfill --limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server opportunities:reap-statuses --limit=bad`.

2026-06-03 coverage/pathway audit parser hardening: Continued the read-only operator script parser scan and found `research-entity:coverage-audit` and `pathway:quality-audit` tolerated unknown positional arguments and silently ignored malformed numeric filters. Added failing parser assertions first, then made coverage audit reject unknown arguments, require positive integer `--limit`, and require non-negative integer `--min-score`; made pathway quality audit reject unknown arguments and require non-negative integer `--sample-limit`. Runtime probes confirmed bad positional and malformed numeric arguments fail before DB work. No production write/copy, repair apply, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for coverage/pathway audit parser hardening:
- `yarn --cwd server test src/scripts/__tests__/researchEntityCoverageAudit.test.ts` (red first for tolerated unknown/malformed args, then green with 8/8 tests).
- `yarn --cwd server test src/scripts/__tests__/pathwayQualityAuditCore.test.ts` (red first for tolerated unknown/malformed args, then green with 4/4 tests).
- `SCRAPER_ENV=beta yarn --cwd server research-entity:coverage-audit prod`.
- `SCRAPER_ENV=beta yarn --cwd server pathway:quality-audit prod`.
- `SCRAPER_ENV=beta yarn --cwd server research-entity:coverage-audit --limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server pathway:quality-audit --sample-limit=bad`.

2026-06-03 review-quality parser hardening: Continued the read-only review CLI parser scan and found `profiles:image-audit`, `research:quality-search-review`, and `pathway:relevance-review` tolerated unknown positional arguments and silently ignored malformed numeric filters. Added failing parser assertions first, then made profile image audit reject unknown arguments and require non-negative `--sample-limit`; made research quality search review reject unknown arguments and require positive `--limit`/`--top-k`; made pathway relevance review reject unknown arguments and require positive `--page-size`/`--top-k`. Runtime probes confirmed bad positional and malformed numeric arguments fail before DB work. No production write/copy, repair apply, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for review-quality parser hardening:
- `yarn --cwd server test src/scripts/__tests__/profileImageQualityAuditCore.test.ts` (red first for tolerated unknown/malformed args, then green with 6/6 tests).
- `yarn --cwd server test src/scripts/__tests__/researchQualitySearchReviewCore.test.ts` (red first for tolerated unknown/malformed args, then green with 7/7 tests).
- `yarn --cwd server test src/scripts/__tests__/pathwayRelevanceReview.test.ts` (red first for tolerated unknown/malformed args, then green with 3/3 tests).
- `SCRAPER_ENV=beta yarn --cwd server profiles:image-audit prod`.
- `SCRAPER_ENV=beta yarn --cwd server research:quality-search-review prod`.
- `SCRAPER_ENV=beta yarn --cwd server pathway:relevance-review prod`.
- `SCRAPER_ENV=beta yarn --cwd server profiles:image-audit --sample-limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server research:quality-search-review --limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server pathway:relevance-review --top-k=bad`.

2026-06-03 program classification parser hardening: Continued the package-exposed write-capable script parser scan and found `programs:backfill-classification` tolerated unknown positional arguments and converted malformed `--limit` values into an unbounded run. Added failing parser assertions first, then made the parser reject unknown arguments and require positive integer limits before DB work. Runtime probes confirmed `prod` and `--limit=bad` fail in parser code. No program classification apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for program classification parser hardening:
- `yarn --cwd server test src/scripts/__tests__/backfillProgramClassifications.test.ts` (red first for tolerated unknown/malformed args, then green with 3/3 tests).
- `SCRAPER_ENV=beta yarn --cwd server programs:backfill-classification prod`.
- `SCRAPER_ENV=beta yarn --cwd server programs:backfill-classification --limit=bad`.

2026-06-03 Beta readiness parser hardening: Continued the production-gate-adjacent script parser scan and found `beta:readiness` tolerated unknown positional arguments and accepted bare `--root` without a value. Added failing parser assertions first, then made the parser reject unknown arguments and require non-empty root paths before DB work. Runtime probes confirmed `prod` and bare `--root` fail in parser code. No production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for Beta readiness parser hardening:
- `yarn --cwd server test src/scripts/__tests__/betaReadinessGate.test.ts` (red first for tolerated unknown/missing args, then green with 5/5 tests).
- `SCRAPER_ENV=beta yarn --cwd server beta:readiness prod`.
- `SCRAPER_ENV=beta yarn --cwd server beta:readiness --root`.

2026-06-03 application-route backfill parser hardening: Continued the write-capable repair/backfill parser scan and found `application-routes:backfill-pathways` tolerated unknown positional arguments and silently ignored malformed `--limit` values. Added failing parser assertions first, then made the parser reject unknown arguments and require positive integer limits before DB work. Runtime probes confirmed `prod` and `--limit=bad` fail in parser code. No application-route backfill apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for application-route backfill parser hardening:
- `yarn --cwd server test src/scripts/__tests__/applicationRoutePathwayBackfillCore.test.ts` (red first for tolerated unknown/malformed args, then green with 9/9 tests).
- `SCRAPER_ENV=beta yarn --cwd server application-routes:backfill-pathways prod`.
- `SCRAPER_ENV=beta yarn --cwd server application-routes:backfill-pathways --limit=bad`.

2026-06-03 source-health parser hardening: Continued the promotion-blocker report parser scan and found `source:health` tolerated unknown positional arguments and silently ignored malformed `--days` values. Added failing parser assertions first, then made the parser reject unknown arguments and require positive integer day windows before DB work. Runtime probes confirmed `prod` and `--days=bad` fail in parser code. No production write/copy, repair apply, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for source-health parser hardening:
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` (red first for tolerated unknown/malformed args, then green with 6/6 tests).
- `SCRAPER_ENV=beta yarn --cwd server source:health prod`.
- `SCRAPER_ENV=beta yarn --cwd server source:health --days=bad`.

2026-06-03 ResearchEntity rename audit parser hardening: Continued the package-exposed read-only audit parser scan and found `research-entity:audit-rename` accepted unknown positional arguments while preserving `--output` artifact support. Added a failing parser assertion first, then made `parseResearchEntityRenameAuditArgs` reject unknown arguments before connection initialization. Runtime probe confirmed `SCRAPER_ENV=beta yarn --cwd server research-entity:audit-rename prod` fails in parser code before DB work. No production write/copy, repair apply, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for ResearchEntity rename audit parser hardening:
- `yarn --cwd server test src/scripts/__tests__/auditResearchEntityRename.test.ts` (red first for tolerated unknown args, then green with 6/6 tests).
- `SCRAPER_ENV=beta yarn --cwd server research-entity:audit-rename prod`.

2026-06-03 same-PI entity dedupe parser hardening: Continued the package-exposed repair parser scan and found `research-entity:dedupe-by-pi` ignored unknown positional arguments and treated malformed `--limit` values as the default limit. Added failing parser assertions first, then replaced the ad hoc `argv.find` parser with a strict flag loop that preserves existing dry-run, apply-bound, narrow-mode, output, accepted-decision, and decision-template flags. Runtime probes confirmed `prod` and `--limit=bad` fail in parser code before DB work. No same-PI dedupe apply, production write/copy, repair apply, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for same-PI entity dedupe parser hardening:
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` (red first for tolerated unknown/malformed args, then green with 33/33 tests).
- `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi prod`.
- `SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --limit=bad`.

2026-06-03 archived-entity artifact repair parser hardening: Continued the package-exposed repair parser scan and found `research-entity:repair-archived-artifacts` ignored unknown positional arguments and treated bare paired numeric flags as defaults. Added failing parser assertions first, then replaced the find-based parser with a strict flag loop that preserves dry-run/apply mode, output, limit, and max-apply handling. Runtime probes confirmed `prod` and `--limit=bad` fail in parser code before DB work. No archived-artifact repair apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for archived-entity artifact repair parser hardening:
- `yarn --cwd server test src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts` (red first for tolerated unknown/missing/malformed args, then green with 5/5 tests).
- `SCRAPER_ENV=beta yarn --cwd server research-entity:repair-archived-artifacts prod`.
- `SCRAPER_ENV=beta yarn --cwd server research-entity:repair-archived-artifacts --limit=bad`.

2026-06-03 guarded production-promotion copy parser hardening: Continued the gate-adjacent parser scan and found `production:promote-beta-copy` ignored unknown positional arguments before safety/env validation. Added a failing parser assertion first, then changed `parsePromotionOptions` to strict token parsing while preserving dry-run default mode, `--apply`, dataset-version and restore-point env fallbacks, `--skip-observations`, and output artifacts. Runtime probe `yarn --cwd server production:promote-beta-copy prod` now fails with the unknown-argument error before requiring Mongo URLs. No production dry-run review, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for guarded production-promotion copy parser hardening:
- `yarn --cwd server test src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts` (red first for tolerated unknown args, then green with 10/10 tests).
- `yarn --cwd server production:promote-beta-copy prod`.

2026-06-03 fellowship import and production smoke parser hardening: Continued the package-exposed parser scan outside `server/src/scripts` and found two remaining permissive CLIs. `import:fellowships` ignored unknown positional arguments after parsing `--csv`/`--output`, and the client `smoke:production-promotion` helper skipped bare positional tokens while treating missing paired values as boolean `true`. Added failing parser assertions first, then made fellowship import reject unknown arguments and missing paired paths before DB work; made the smoke parser allow only the documented flags and reject unknown or missing paired values before any network requests. Runtime probes confirmed `SCRAPER_ENV=beta yarn --cwd data-migration import:fellowships prod` and `yarn --cwd client smoke:production-promotion prod` fail in parser code. No fellowship import apply, production smoke request, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for fellowship import and production smoke parser hardening:
- `yarn --cwd server test src/scripts/__tests__/fellowshipImportCliSafety.test.ts` (red first for tolerated unknown args, then green with 5/5 tests).
- `yarn --cwd client test:ci src/utils/__tests__/productionPromotionSmokeCore.test.ts` (red first for tolerated unknown/missing args, then green with 5/5 tests; existing baseline-browser-mapping freshness warning remains).
- `SCRAPER_ENV=beta yarn --cwd data-migration import:fellowships prod`.
- `yarn --cwd client smoke:production-promotion prod`.

2026-06-03 paper audit parser hardening: Continued the package-exposed audit parser scan and found `papers:quality-audit` silently ignored malformed `--sample-limit` values, while `papers:authorship-audit` ignored unknown positional arguments and malformed `--sample-limit` values. Added failing parser assertions first, then made both commands require non-negative integer sample limits; authorship audit now also rejects unsupported tokens. Runtime probes confirmed bad arguments fail in parser code before DB work. No paper quality audit DB run, paper authorship apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for paper audit parser hardening:
- `yarn --cwd server test src/scripts/__tests__/paperQualityAudit.test.ts src/scripts/__tests__/paperAuthorshipAudit.test.ts` (red first for tolerated malformed/unknown args, then green with 9/9 tests).
- `SCRAPER_ENV=beta yarn --cwd server papers:quality-audit --sample-limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server papers:authorship-audit prod`.
- `SCRAPER_ENV=beta yarn --cwd server papers:authorship-audit --sample-limit=bad`.

2026-06-03 scholarly-link audit parser hardening: Continued the package-exposed audit parser scan and found `scholarly-links:provenance-audit` and `scholarly-links:suppression-audit` silently ignored malformed `--sample-limit` values. Added failing parser assertions first, then made both commands require non-negative integer sample limits before DB work; paired `--output` now also rejects missing or flag-looking paths. Runtime probes confirmed malformed sample limits fail in parser code before connection output. No scholarly-link audit DB run, suppression/provenance apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for scholarly-link audit parser hardening:
- `yarn --cwd server test src/scripts/__tests__/scholarlyLinkAuditCli.test.ts` (red first for tolerated malformed sample limits, then green with 9/9 tests).
- `SCRAPER_ENV=beta yarn --cwd server scholarly-links:provenance-audit --sample-limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server scholarly-links:suppression-audit --sample-limit=bad`.

2026-06-03 launch report parser hardening: Continued the package-exposed launch-report parser scan and found `launch:trust-contract` silently ignored malformed `--limit`, while `launch:acquisition-report` silently ignored malformed `--limit` and `--sample-limit`. Added failing parser assertions first, then made the bounds strict positive integers and tightened paired `--output` values so flag-looking paths are rejected. Runtime probes confirmed malformed bounds fail in parser code before DB work. No launch trust DB audit, acquisition report DB run, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for launch report parser hardening:
- `yarn --cwd server test src/scripts/__tests__/launchTrustContract.test.ts src/scripts/__tests__/launchAcquisitionReport.test.ts` (red first for tolerated malformed bounds, then green with 8/8 tests).
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --limit=bad`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --limit=bad`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --sample-limit=bad`.

2026-06-03 visibility gate and repair queue parser hardening: Continued the package-exposed gate/repair parser scan and found `student-visibility:gate` and `beta:repair-queue` silently ignored malformed `--limit` values. Added failing parser assertions first, then made both commands require strict positive integer limits and tightened paired `--output` values so flag-looking paths are rejected. Runtime probes confirmed malformed limits and flag-looking output paths fail in parser code before DB work. No visibility gate DB run, Beta repair queue DB run/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for visibility gate and repair queue parser hardening:
- `yarn --cwd server test src/scripts/__tests__/studentVisibilityGate.test.ts` (red first for tolerated malformed bounds, then green with 4/4 tests).
- `yarn --cwd server test src/scripts/__tests__/betaRepairQueue.test.ts` (red first for tolerated malformed bounds, then green with 4/4 tests).
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --output --apply`.
- `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --output --apply`.

2026-06-03 exploratory dedupe and launch review parser hardening: Continued the package-exposed review/repair parser scan and found `pathways:dedupe-exploratory` and `launch:review-exceptions` silently ignored malformed `--limit` values. Added failing parser assertions first, then made both commands require strict positive integer limits; paired artifact path flags now also reject flag-looking values before DB work. Runtime probes confirmed malformed limits and flag-looking paired paths fail in parser code. No exploratory pathway dedupe DB run/apply, launch review-exception DB run, reviewer-decision acceptance, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for exploratory dedupe and launch review parser hardening:
- `yarn --cwd server test src/scripts/__tests__/dedupeExploratoryContactPathways.test.ts src/scripts/__tests__/launchReviewExceptions.test.ts` (red first for tolerated malformed bounds, then green with 12/12 tests).
- `SCRAPER_ENV=beta yarn --cwd server pathways:dedupe-exploratory --limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server pathways:dedupe-exploratory --output --apply`.
- `SCRAPER_ENV=beta yarn --cwd server launch:review-exceptions --limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server launch:review-exceptions --accepted-decisions --allow-empty-decisions`.

2026-06-03 student visibility backfill parser hardening: Continued the package-exposed visibility parser scan and found `student-visibility:backfill` silently treated malformed `--limit` values as unbounded `Infinity`. Added failing parser assertions first, then made `--limit` require a strict positive integer and tightened paired `--output` so flag-looking values are rejected before DB work. Runtime probes confirmed malformed limit and flag-looking output fail in parser code. No student visibility backfill DB run/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for student visibility backfill parser hardening:
- `yarn --cwd server test src/scripts/__tests__/studentVisibilityBackfillReport.test.ts` (red first for tolerated malformed bounds, then green with 8/8 tests).
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:backfill --limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:backfill --output --apply`.

2026-06-03 accepted-inputs parser hardening: Continued the package-exposed artifact-helper parser scan and found `accepted-inputs` silently treated malformed `--limit` as unbounded `Infinity`, ignored unknown positional arguments, and accepted missing/flag-looking paired values. Added failing parser assertions first, then made `--limit` require a strict positive integer and made value flags reject empty, missing, or flag-looking values; unsupported tokens now fail before DB work. Runtime probes confirmed malformed limit, unknown positional input, and flag-looking output fail in parser code. No accepted-inputs DB run/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for accepted-inputs parser hardening:
- `yarn --cwd server test src/scripts/__tests__/acceptedInputs.test.ts` (red first for tolerated malformed/unknown args, then green with 5/5 tests).
- `SCRAPER_ENV=beta yarn --cwd server accepted-inputs status --limit=bad`.
- `SCRAPER_ENV=beta yarn --cwd server accepted-inputs status prod`.
- `SCRAPER_ENV=beta yarn --cwd server accepted-inputs status --output --apply`.

2026-06-03 claim gate and duplicate review parser hardening: Continued the package-exposed review parser scan and found `scraper:claim-gate` and `scraper:integrity-duplicates-review` consumed flag-looking tokens as paired values, so later flags could be swallowed as output/type/collection values. Added failing parser assertions first, then made both parsers reject missing, empty, and flag-looking paired values while preserving existing strict collection/type and positive-integer validation. Runtime probes confirmed flag-looking output paths fail in parser code before DB work. No claim-gate DB audit, duplicate integrity DB review, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for claim gate and duplicate review parser hardening:
- `yarn --cwd server test src/scripts/__tests__/claimGate.test.ts src/scripts/__tests__/scraperIntegrityDuplicateReview.test.ts` (red first for tolerated flag-looking output values, then green with 10/10 tests).
- `SCRAPER_ENV=beta yarn --cwd server scraper:claim-gate --output --include-samples`.
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-duplicates-review --output --type=all`.

2026-06-03 scraper integrity gate parser hardening: Continued the package-exposed gate parser scan and found `scraper:integrity-gate` consumed flag-looking tokens as paired values, so later flags could be swallowed as `--output`, `--source-run`, or `--limit` values. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking paired values while preserving strict positive-integer validation and unknown-argument rejection. Runtime probe confirmed flag-looking output fails in parser code before DB work. No scraper integrity DB audit, claim-gate embedded audit, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for scraper integrity gate parser hardening:
- `yarn --cwd server test src/scripts/__tests__/scraperIntegrityGate.test.ts` (red first for tolerated flag-looking output values, then green with 9/9 tests).
- `SCRAPER_ENV=beta yarn --cwd server scraper:integrity-gate --output --include-samples`.

2026-06-03 user identity dedupe parser hardening: Continued the package-exposed identity/account parser scan and found `users:dedupe-by-identity` consumed flag-looking tokens as paired values, so later flags could be swallowed as `--output`, `--identity-field`, `--limit`, `--sample-size`, or `--max-apply-groups` values. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking paired values while preserving strict positive-integer validation, identity-field validation, dry-run/apply parsing, and unknown-argument rejection. The focused suite also had stale expectations for Beta-targeted recommended commands; those are now aligned with the current `SCRAPER_ENV=beta` recommendation posture. Runtime probe confirmed flag-looking output fails in parser code before DB work. No user dedupe DB review, apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for user identity dedupe parser hardening:
- `yarn --cwd server test src/scripts/__tests__/dedupeUsersByIdentityCore.test.ts` (red first for tolerated flag-looking output values and stale Beta-command expectations, then green with 16/16 tests).
- `SCRAPER_ENV=beta yarn --cwd server users:dedupe-by-identity --output --apply`.

2026-06-03 member-reference audit parser hardening: Continued the package-exposed member-reference parser scan and found `research-entity-members:audit-user-refs` consumed flag-looking tokens as paired values, so later flags could be swallowed as `--output`, `--limit`, or `--max-apply` values. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking paired values while preserving strict positive-integer validation, dry-run/apply parsing, confirmation flags, and unknown-argument rejection. Runtime probe confirmed flag-looking output fails in parser code before DB work. No member-reference DB audit, apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for member-reference audit parser hardening:
- `yarn --cwd server test src/scripts/__tests__/researchEntityMemberReferenceAudit.test.ts` (red first for tolerated flag-looking output values, then green with 15/15 tests).
- `SCRAPER_ENV=beta yarn --cwd server research-entity-members:audit-user-refs --output --apply`.

2026-06-03 user email hygiene parser hardening: Continued the package-exposed identity/account parser scan and found `users:email-hygiene` consumed flag-looking tokens as paired values, so later flags could be swallowed as `--output`, `--limit`, or `--sample-size` values. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking paired values while preserving strict positive-integer validation, dry-run/apply parsing, and unknown-argument rejection. Runtime probe confirmed flag-looking output fails in parser code before DB work. No user email hygiene DB review, apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for user email hygiene parser hardening:
- `yarn --cwd server test src/scripts/__tests__/userEmailHygiene.test.ts` (red first for tolerated flag-looking output values, then green with 10/10 tests).
- `SCRAPER_ENV=beta yarn --cwd server users:email-hygiene --output --apply`.

2026-06-03 duplicate-name review parser hardening: Continued the package-exposed production-gate review parser scan and found `research-entity:duplicate-name-review` consumed flag-looking tokens as paired values, so later flags could be swallowed as output paths, accepted-decision paths, decision-template paths, category values, or numeric bounds. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking paired values while preserving read-only apply blocking, strict positive-integer validation, category validation, accepted-decision/template options, and unknown-argument rejection. Runtime probe confirmed flag-looking output fails in parser code before DB work. No duplicate-name DB review, reviewer-decision acceptance, apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for duplicate-name review parser hardening:
- `yarn --cwd server test src/scripts/__tests__/duplicateEntityNameReview.test.ts` (red first for tolerated flag-looking output values, then green with 8/8 tests).
- `SCRAPER_ENV=beta yarn --cwd server research-entity:duplicate-name-review --output --apply`.

2026-06-03 stale observation conflict review parser hardening: Continued the package-exposed production-gate review parser scan and found `observations:stale-conflict-review` consumed flag-looking tokens as paired values, so later flags could be swallowed as output paths, accepted-decision paths, decision-template paths, source/filter values, or numeric bounds. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking paired values while preserving read-only apply blocking, strict positive-integer validation, queue/category validation, accepted-decision/template options, and unknown-argument rejection. Runtime probe confirmed flag-looking output fails in parser code before DB work. No stale-observation DB review, reviewer-decision acceptance, apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for stale observation conflict review parser hardening:
- `yarn --cwd server test src/scripts/__tests__/staleObservationConflictReview.test.ts` (red first for tolerated flag-looking values, then green with 12/12 tests).
- `SCRAPER_ENV=beta yarn --cwd server observations:stale-conflict-review --output --allow-empty-decisions`.

2026-06-03 cross-source observation conflict review parser hardening: Continued the package-exposed production-gate review parser scan and found `observations:cross-source-conflict-review` consumed flag-looking tokens as paired values, so later flags could be swallowed as output paths, accepted-decision paths, decision-template paths, source/filter values, or numeric bounds. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking paired values while preserving read-only apply blocking, strict positive-integer validation, queue/category validation, accepted-decision/template options, and unknown-argument rejection. Runtime probe confirmed flag-looking output fails in parser code before DB work. No cross-source DB review, reviewer-decision acceptance, apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for cross-source observation conflict review parser hardening:
- `yarn --cwd server test src/scripts/__tests__/crossSourceObservationConflictReview.test.ts` (red first for tolerated flag-looking values, then green with 10/10 tests).
- `SCRAPER_ENV=beta yarn --cwd server observations:cross-source-conflict-review --output --allow-empty-decisions`.

2026-06-03 launch trust parser value hardening: Continued the package-exposed launch-gate parser scan and found `launch:trust-contract` accepted inline flag-looking `--output=--strict` as a path and silently accepted empty `--source=` / `--record-id=` filters. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking output/source/record values while preserving strict positive-integer `--limit`, collection/mode flags, strict mode, and optional embedded research/paper audits. Runtime probe confirmed malformed inline output fails in parser code before DB work. No launch trust DB audit, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for launch trust parser value hardening:
- `yarn --cwd server test src/scripts/__tests__/launchTrustContract.test.ts` (red first for tolerated flag-looking output value, then green with 5/5 tests).
- `SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --output=--strict`.

2026-06-03 launch acquisition report parser value hardening: Continued the package-exposed launch-gate parser scan and found `launch:acquisition-report` accepted inline flag-looking `--output=--stage=all` as a path. Added a failing parser assertion first, then made output parsing reject missing, empty, and flag-looking output values while preserving stage filters and strict positive-integer `--limit` / `--sample-limit` validation. Runtime probe confirmed malformed inline output fails in parser code before DB work. No launch acquisition DB audit, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for launch acquisition report parser value hardening:
- `yarn --cwd server test src/scripts/__tests__/launchAcquisitionReport.test.ts` (red first for tolerated flag-looking output value, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server launch:acquisition-report --output=--stage=all`.

2026-06-03 ResearchEntity migration parser value hardening: Continued the package-exposed migration parser scan and found `research-entity:migrate` and `research-entity:cleanup-collections` accepted flag-looking `--output` values such as `--output=--apply` or `--output --drop-legacy`. Added failing parser assertions first, then made both parsers reject missing, empty, and flag-looking output paths while preserving their dry-run/apply/verify/drop modes and production write guards. Runtime probes confirmed malformed output values fail in parser code before DB work. No ResearchEntity migration, dependent collection migration/drop, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for ResearchEntity migration parser value hardening:
- `yarn --cwd server test src/scripts/__tests__/legacyMigrationCliSafety.test.ts` (red first for tolerated flag-looking output values, then green with 16/16 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:migrate --output=--apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:cleanup-collections --output --drop-legacy`.

2026-06-03 legacy Mongo migration parser value hardening: Continued the package-exposed migration parser scan and found `migrate:mongo-naming` and `legacy:cleanup` accepted flag-looking `--output` values such as `--output=--apply` or `--output --drop-legacy`. Added failing parser assertions first, then made both parsers reject missing, empty, and flag-looking output paths while preserving their dry-run/apply/verify/drop modes and production write guards. Runtime probes confirmed malformed output values fail in parser code before DB work. No Mongo naming migration, legacy cleanup/drop, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for legacy Mongo migration parser value hardening:
- `yarn --cwd server test src/scripts/__tests__/legacyMigrationCliSafety.test.ts` (red first for tolerated flag-looking output values, then green with 18/18 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server migrate:mongo-naming --output=--apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server legacy:cleanup --output --drop-legacy`.

2026-06-03 listing ResearchEntity profile repair parser hardening: Continued the write-capable helper parser scan and found `repairListingResearchEntityProfiles` treated malformed `--limit=bad` as unbounded and accepted flag-looking output values. Added failing parser assertions first, then made `--limit` require a positive integer and made `--output` reject missing, empty, and flag-looking paths before DB work. Runtime probes used the direct `tsx` entrypoint because this helper has no package-script alias; both malformed probes failed in parser code before any DB connection. No listing repair DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for listing ResearchEntity profile repair parser hardening:
- `yarn --cwd server test src/scripts/__tests__/repairListingResearchEntityProfiles.test.ts` (red first for tolerated malformed limit/output values, then green with 4/4 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server tsx src/scripts/repairListingResearchEntityProfiles.ts --limit=bad`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server tsx src/scripts/repairListingResearchEntityProfiles.ts --output --apply`.

2026-06-03 program classification backfill parser hardening: Continued the write-capable package parser scan and found `programs:backfill-classification` accepted flag-looking output values such as `--output --apply`. Added failing parser assertions first, then made `--output` reject missing, empty, and flag-looking paths before DB work while preserving existing apply, limit, artifact metadata, and production write guard behavior. Runtime probe confirmed malformed output fails in parser code before any DB connection. No program classification DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for program classification backfill parser hardening:
- `yarn --cwd server test src/scripts/__tests__/backfillProgramClassifications.test.ts` (red first for tolerated flag-looking output values, then green with 4/4 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server programs:backfill-classification --output --apply`.

2026-06-03 fellowship import parser value hardening: Continued the package-exposed data-migration parser scan and found `import:fellowships` accepted inline flag-looking `--csv=--output` and `--output=--apply` values as paths. Added failing parser assertions first, then made the importer reject missing, empty, and flag-looking CSV/output paths before DB work while preserving dry-run/apply, replace-existing, artifact metadata, and production write guard behavior. Runtime probe confirmed malformed inline output fails in parser code before any DB connection. No fellowship import dry-run/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for fellowship import parser value hardening:
- `yarn --cwd server test src/scripts/__tests__/fellowshipImportCliSafety.test.ts` (red first for tolerated inline flag-looking path values, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration import:fellowships --output=--apply`.

2026-06-03 shared V4 migration parser value hardening: Continued the package-exposed data-migration parser scan and found shared `v4MigrationUtils.ts` accepted inline flag-looking `--output=--apply` values as artifact paths for the V4 backfill scripts. Added a failing parser assertion first, then made the shared parser reject missing, empty, and flag-looking output paths before DB work while preserving dry-run/apply, strict positive-integer limits, artifact metadata, and production write guard behavior. Runtime probe used `migrate:v4:grants` and confirmed malformed inline output fails in shared parser code before any DB connection. No V4 backfill dry-run/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for shared V4 migration parser value hardening:
- `yarn --cwd server test src/scripts/__tests__/dataMigrationV4Utils.test.ts` (red first for tolerated inline flag-looking output value, then green with 3/3 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration migrate:v4:grants --output=--apply`.

2026-06-03 data-migration seed parser value hardening: Continued the package-exposed seed parser scan and found `seed:departments` and `seed:research-areas` accepted flag-looking `--output` values, so an operator typo could swallow later apply/dry-run flags as artifact paths. Added a new failing import-safe parser test first, then made both seed parsers reject missing, empty, and flag-looking output paths before Mongo work while preserving dry-run defaults, explicit apply/live flags, output artifacts, and production write guard behavior. Runtime probes confirmed malformed paired and inline output values fail in parser code before any DB connection. No department/research-area seed dry-run/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for data-migration seed parser value hardening:
- `yarn --cwd server test src/scripts/__tests__/seedCliSafety.test.ts` (red first for tolerated flag-looking output values, then green with 2/2 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration seed:departments --output --apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration seed:research-areas --output=--apply`.

2026-06-03 legacy department migration parser value hardening: Continued the package-exposed data-migration parser scan and found `migrate:departments` accepted flag-looking `--output` values, so an operator typo could swallow `--apply` as an artifact path. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking output paths before source/target Mongo connection setup while preserving dry-run defaults, explicit apply/live flags, output artifacts, and production write guard behavior. Runtime probe confirmed malformed paired output fails in parser code before DB work. No department migration dry-run/apply, source/target DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for legacy department migration parser value hardening:
- `yarn --cwd server test src/scripts/__tests__/departmentMigrationCliSafety.test.ts` (red first for tolerated flag-looking output values, then green with 4/4 tests).
- `MONGODBURL=mongodb://example.invalid/Source MONGODBURL_MIGRATION=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration migrate:departments --output --apply`.

2026-06-03 legacy user/publication/root-data migration parser value hardening: Continued the package-exposed data-migration parser scan and found `migrate:users`, `MigratePublicationsToPapers.ts`, and `migrate:root-data-files` accepted flag-looking `--output` values, so later apply/delete flags could be swallowed as artifact paths. Added failing parser assertions first across the existing safety suites, then made all three parsers reject missing, empty, and flag-looking output paths before source/target Mongo setup while preserving dry-run defaults, explicit apply/live flags, replacement/delete guards, output artifacts, and production write guard behavior. Runtime probes confirmed malformed output values fail in parser code before DB work. No user copy, publication migration, root-data import, local source-file deletion, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for legacy user/publication/root-data migration parser value hardening:
- `yarn --cwd server test src/scripts/__tests__/userMigrationCliSafety.test.ts src/scripts/__tests__/publicationMigrationCliSafety.test.ts src/scripts/__tests__/rootDataImportCliSafety.test.ts` (red first for tolerated flag-looking output values, then green with 13/13 tests).
- `MONGODBURL=mongodb://example.invalid/Source MONGODBURL_MIGRATION=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration migrate:users --output --apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration migrate:root-data-files --output=--apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration tsx MigratePublicationsToPapers.ts --output --apply`.

2026-06-03 application-route pathway backfill parser hardening: Continued the write-capable package parser scan and found `application-routes:backfill-pathways` accepted flag-looking `--output` values, so an operator typo could swallow `--apply` as an artifact path. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking output paths before apply guard or Mongo connection setup while preserving dry-run defaults, strict positive-integer limits, output artifacts, and production write guard behavior. Runtime probe confirmed malformed paired output fails in parser code before DB work. No application-route pathway backfill dry-run/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for application-route pathway backfill parser hardening:
- `yarn --cwd server test src/scripts/__tests__/applicationRoutePathwayBackfillCore.test.ts` (red first for tolerated flag-looking output values, then green with 9/9 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server application-routes:backfill-pathways --output --apply`.

2026-06-03 posted-opportunity maintenance parser hardening: Continued the write-capable package parser scan and found `posted-opportunities:backfill` and `opportunities:reap-statuses` accepted flag-looking `--output` values, so an operator typo could swallow `--apply` as an artifact path. Added failing parser assertions first, then made both parsers reject missing, empty, and flag-looking output paths before apply guard or Mongo connection setup while preserving dry-run defaults, strict positive-integer limits, output artifacts, and production write guard behavior. Runtime probes confirmed malformed paired and inline output values fail in parser code before DB work. No posted-opportunity backfill/status-reaper dry-run/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for posted-opportunity maintenance parser hardening:
- `yarn --cwd server test src/scripts/__tests__/postedOpportunityMaintenanceCli.test.ts` (red first for tolerated flag-looking output values, then green with 8/8 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server posted-opportunities:backfill --output --apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server opportunities:reap-statuses --output=--apply`.

2026-06-04 source-health parser hardening: Continued the read-only artifact CLI parser scan and found `source:health` accepted flag-looking `--output` values, so an operator typo could swallow `--strict` as an artifact path. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking output paths before write-guard or Mongo connection setup while preserving strict mode, disabled-source inclusion, strict positive-integer day windows, and output artifact behavior. Runtime probe confirmed malformed paired output fails in parser code before DB work. No source-health DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for source-health parser hardening:
- `yarn --cwd server test src/scripts/__tests__/sourceHealth.test.ts` (red first for tolerated flag-looking output values, then green with 6/6 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server source:health --output --strict`.

2026-06-04 pathway quality audit parser hardening: Continued the read-only artifact CLI parser scan and found `pathway:quality-audit` accepted flag-looking `--output` values, so an operator typo could swallow `--sample-limit=0` as an artifact path. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking output paths before write-guard or Mongo connection setup while preserving strict non-negative `--sample-limit` handling and output artifact behavior. Runtime probe confirmed malformed paired output fails in parser code before DB work. No pathway quality DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for pathway quality audit parser hardening:
- `yarn --cwd server test src/scripts/__tests__/pathwayQualityAuditCore.test.ts` (red first for tolerated flag-looking output values, then green with 4/4 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server pathway:quality-audit --output --sample-limit=0`.

2026-06-04 research entity coverage audit parser hardening: Continued the read-only artifact CLI parser scan and found `research-entity:coverage-audit` accepted flag-looking `--output` values, so an operator typo could swallow `--all` as an artifact path. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking output paths before write-guard or Mongo connection setup while preserving slug/all/archive filters, strict numeric bounds, and output artifact behavior. Runtime probe confirmed malformed paired output fails in parser code before DB work. No coverage DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for research entity coverage audit parser hardening:
- `yarn --cwd server test src/scripts/__tests__/researchEntityCoverageAudit.test.ts` (red first for tolerated flag-looking output values, then green with 8/8 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:coverage-audit --output --all`.

2026-06-04 research quality search review parser hardening: Continued the read-only artifact CLI parser scan and found `research:quality-search-review` accepted flag-looking `--output` values, so an operator typo could swallow `--strict` as an artifact path. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking output paths before write-guard or Mongo/Meili setup while preserving strict mode, query filters, strict positive numeric parsing, artifact metadata, and output artifact behavior. Runtime probe confirmed malformed paired output fails in parser code before DB work. No search-quality DB scan, Meili query, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for research quality search review parser hardening:
- `yarn --cwd server test src/scripts/__tests__/researchQualitySearchReviewCore.test.ts` (red first for tolerated flag-looking output values, then green with 7/7 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research:quality-search-review --output --strict`.

2026-06-04 profile image quality audit parser hardening: Continued the read-only artifact CLI parser scan and found `profiles:image-audit` accepted flag-looking `--output` values, so an operator typo could swallow `--strict` as an artifact path. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking output paths before write-guard or Mongo setup while preserving strict mode, strict non-negative `--sample-limit` parsing, artifact metadata, and output artifact behavior. Runtime probe confirmed malformed paired output fails in parser code before DB work. No profile-image DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for profile image quality audit parser hardening:
- `yarn --cwd server test src/scripts/__tests__/profileImageQualityAuditCore.test.ts` (red first for tolerated flag-looking output values, then green with 6/6 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server profiles:image-audit --output --strict`.

2026-06-04 pathway relevance review parser hardening: Completed the review-quality artifact CLI trio by hardening `pathway:relevance-review`, which accepted flag-looking `--output` values and could swallow `--strict` as an artifact path. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking output paths before write-guard, Mongo, or Meili setup while preserving strict mode, strict positive `--page-size`/`--top-k` parsing, artifact metadata, and output artifact behavior. Runtime probe confirmed malformed paired output fails in parser code before DB or Meili work. No pathway relevance DB scan, Meili query, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for pathway relevance review parser hardening:
- `yarn --cwd server test src/scripts/__tests__/pathwayRelevanceReview.test.ts` (red first for tolerated flag-looking output values, then green with 3/3 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server pathway:relevance-review --output --strict`.

2026-06-04 scholarly audit inline output parser hardening: Continued the audit-artifact parser scan and found `scholarly-links:quality-audit`, `scholarly-links:provenance-audit`, and `scholarly-links:suppression-audit` already rejected missing and paired flag-looking `--output` values, but still accepted inline flag-looking values such as `--output=--apply`. Added failing parser assertions first, then made the inline output branches reject missing, empty, and flag-looking paths before write-guard or Mongo setup while preserving strict sample-limit parsing, dry-run/apply guards, artifact metadata, and output artifact behavior. Runtime probes confirmed malformed inline output fails in parser code before DB work. No paper/scholarly-link DB scan, suppression/provenance apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for scholarly audit inline output parser hardening:
- `yarn --cwd server test src/scripts/__tests__/paperQualityAudit.test.ts src/scripts/__tests__/scholarlyLinkAuditCli.test.ts` (red first for tolerated inline flag-looking output values, then green with 13/13 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scholarly-links:quality-audit --output=--strict`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scholarly-links:provenance-audit --output=--apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scholarly-links:suppression-audit --output=--apply`.

2026-06-04 ResearchEntity rename audit parser value hardening: Continued the read-only audit parser scan and found `research-entity:audit-rename` accepted flag-looking `--output` values, so an operator typo could swallow a later flag as an artifact path. Added failing parser assertions first, then made the parser reject missing, empty, and flag-looking output paths before write-guard or Mongo setup while preserving read-only rename readiness checks, legacy-residue summaries, target metadata, and artifact output behavior. Runtime probe confirmed malformed paired output fails in parser code before DB work. No rename audit DB scan, migration apply, cleanup/drop mode, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for ResearchEntity rename audit parser value hardening:
- `yarn --cwd server test src/scripts/__tests__/auditResearchEntityRename.test.ts` (red first for tolerated flag-looking output values, then green with 6/6 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:audit-rename --output --strict`.

2026-06-04 Beta readiness parser value hardening: Continued the gate-adjacent parser scan and found `beta:readiness` accepted flag-looking `--root` and `--output` values, so an operator typo could swallow `--strict` as a path. Added failing parser assertions first, then made both path flags reject missing, empty, and flag-looking values before Mongo setup while preserving strict mode, beta backup/meili confirmations, target metadata, and target-explicit follow-up commands. Runtime probes confirmed malformed paired output and root values fail in parser code before DB work. No Beta readiness DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for Beta readiness parser value hardening:
- `yarn --cwd server test src/scripts/__tests__/betaReadinessGate.test.ts` (red first for tolerated flag-looking root/output values, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server beta:readiness --output --strict`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server beta:readiness --root --strict`.

2026-06-04 visibility gate and repair queue inline output parser hardening: Continued the gate/repair parser scan and found `student-visibility:gate` and `beta:repair-queue` already rejected paired flag-looking `--output` values, but still accepted inline flag-looking values such as `--output=--apply`. Added failing parser assertions first, then made the inline output branches reject missing, empty, and flag-looking paths before Mongo setup while preserving dry-run/apply modes, strict positive limit parsing, target metadata, and artifact output behavior. Runtime probes confirmed malformed inline output fails in parser code before DB work. No visibility gate DB run, Beta repair queue DB run/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for visibility gate and repair queue inline output parser hardening:
- `yarn --cwd server test src/scripts/__tests__/studentVisibilityGate.test.ts src/scripts/__tests__/betaRepairQueue.test.ts` (red first for tolerated inline flag-looking output values, then green with 8/8 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --output=--apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --output=--apply`.

2026-06-04 paper authorship audit inline output parser hardening: Continued the write-capable audit parser scan and found `papers:authorship-audit` already rejected paired flag-looking `--output` values, but still accepted inline flag-looking values such as `--output=--apply`. Added a failing parser assertion first, then made the inline output branch reject missing, empty, and flag-looking paths before Mongo setup or apply guard logic while preserving dry-run/apply mode, OpenAlex backfill toggle, strict sample-limit parsing, target metadata, and output artifact behavior. Runtime probe confirmed malformed inline output fails in parser code before DB work. No paper authorship DB scan/apply, OpenAlex backfill, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for paper authorship audit inline output parser hardening:
- `yarn --cwd server test src/scripts/__tests__/paperAuthorshipAudit.test.ts` (red first for tolerated inline flag-looking output value, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server papers:authorship-audit --output=--apply`.

2026-06-04 archived-entity artifact repair inline output parser hardening: Continued the write-capable repair parser scan and found `research-entity:repair-archived-artifacts` already rejected paired flag-looking `--output` values, but still accepted inline flag-looking values such as `--output=--apply`. Added a failing parser assertion first, then made the inline output branch reject missing, empty, and flag-looking paths before Mongo setup or apply guard logic while preserving dry-run/apply mode, strict limit/max-apply parsing, target metadata, and output artifact behavior. Runtime probe confirmed malformed inline output fails in parser code before DB work. No archived-artifact repair DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for archived-entity artifact repair inline output parser hardening:
- `yarn --cwd server test src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts` (red first for tolerated inline flag-looking output value, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:repair-archived-artifacts --output=--apply`.

2026-06-04 same-PI dedupe path parser hardening: Continued the review-first duplicate-entity parser scan and found `research-entity:dedupe-by-pi` accepted flag-looking output, accepted-decision, and decision-template paths, so an operator typo could swallow `--apply` as a path before validation. Added failing parser assertions first, then made all three path flags reject missing, empty, and flag-looking values before Mongo setup while preserving dry-run/apply mode, max-apply bounds, narrow-mode flags, accepted-decision validation, target metadata, and artifact output behavior. Runtime probes confirmed malformed path values fail in parser code before DB work. No same-PI dedupe DB scan/apply, accepted reviewer decision, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for same-PI dedupe path parser hardening:
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` (red first for tolerated flag-looking path values, then green with 33/33 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --output --apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --accepted-decisions=--apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --decision-template-output --apply`.

2026-06-04 launch review-exception path parser hardening: Continued the review-first launch parser scan and found `launch:review-exceptions` already rejected paired flag-looking paths, but still accepted inline flag-looking output, decision-template, and accepted-decision paths. Added failing parser assertions first, then made all three path flags reject missing, empty, and flag-looking values before Mongo setup while preserving collection filters, strict limit parsing, reviewer template generation, accepted-decision validation, target metadata, and blocked-apply semantics. Runtime probes confirmed malformed path values fail in parser code before DB work. No launch review-exception DB scan, reviewer decision acceptance, apply path, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for launch review-exception path parser hardening:
- `yarn --cwd server test src/scripts/__tests__/launchReviewExceptions.test.ts` (red first for tolerated inline flag-looking path values, then green with 8/8 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server launch:review-exceptions --output=--collection=all`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server launch:review-exceptions --decision-template-output=--collection=all`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server launch:review-exceptions --accepted-decisions=--allow-empty-decisions`.

2026-06-04 exploratory pathway dedupe inline output parser hardening: Continued the write-capable repair parser scan and found `pathways:dedupe-exploratory` already rejected paired flag-looking `--output` values, but still accepted inline flag-looking values such as `--output=--apply`. Added a failing parser assertion first, then made the inline output branch reject missing, empty, and flag-looking paths before Mongo setup or apply guard logic while preserving dry-run/apply mode, strict limit parsing, target metadata, and output artifact behavior. Runtime probe confirmed malformed inline output fails in parser code before DB work. No exploratory pathway dedupe DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for exploratory pathway dedupe inline output parser hardening:
- `yarn --cwd server test src/scripts/__tests__/dedupeExploratoryContactPathways.test.ts` (red first for tolerated inline flag-looking output value, then green with 4/4 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server pathways:dedupe-exploratory --output=--apply`.

2026-06-04 Meili rebuild output parser hardening: Continued the search-index rebuild parser scan and found `meili:rebuild-pathways` and `meili:rebuild-research-entities` accepted flag-looking `--output` values, so an operator typo could swallow `--clear` as an artifact path. Added failing parser assertions first, then made both output parsers reject missing, empty, and flag-looking paths before Mongo/Meili setup while preserving clear/page-size behavior, target metadata, and production rebuild guard behavior. Runtime probes confirmed malformed output values fail in parser code before DB/Meili work. No Meili rebuild, DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for Meili rebuild output parser hardening:
- `yarn --cwd server test src/scripts/__tests__/searchIndexRebuildCli.test.ts` (red first for tolerated flag-looking output values, then green with 8/8 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways --output --clear`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities --output=--clear`.

2026-06-04 guarded Lane A production-copy output parser hardening: Continued the gate-adjacent parser scan and found `production:promote-beta-copy` already rejected paired flag-looking `--output` values, but still accepted inline flag-looking values such as `--output=--apply`. Added a failing parser assertion first, then made inline output parsing reject missing, empty, and flag-looking paths before environment validation, Mongo setup, or copy planning while preserving dry-run/apply mode, dataset-version and restore-point fallbacks, observation-skip behavior, and redacted review artifact output. Runtime probe confirmed malformed inline output fails in parser code before DB work. No production copy, production dry-run review, DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for guarded Lane A production-copy output parser hardening:
- `yarn --cwd server test src/scripts/__tests__/promoteAcceptedBetaCopy.test.ts` (red first for tolerated inline flag-looking output value, then green with 11/11 tests).
- `BETA_MONGODBURL=mongodb://example.invalid/Beta PRODUCTION_MONGODBURL=mongodb://prod.invalid/Production PROMOTION_DATASET_VERSION=prod-promote-2026-06-04-lane-a-beta-copy yarn --cwd server production:promote-beta-copy --output=--apply`.

2026-06-04 student visibility backfill inline output parser hardening: Continued the visibility parser scan and found `student-visibility:backfill` already rejected paired flag-looking `--output` values, but still accepted inline flag-looking values such as `--output=--apply`. Added a failing parser assertion first, then made inline output parsing reject missing, empty, and flag-looking paths before Mongo setup while preserving dry-run/apply mode, collection selection, limit parsing, apply-safety blockers, target metadata, and review artifact output. Runtime probe confirmed malformed inline output fails in parser code before DB work. No student-visibility backfill DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for student visibility backfill inline output parser hardening:
- `yarn --cwd server test src/scripts/__tests__/studentVisibilityBackfillReport.test.ts` (red first for tolerated inline flag-looking output value, then green with 8/8 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server student-visibility:backfill --output=--apply`.

2026-06-04 Beta data-quality output parser hardening: Continued the scorecard artifact parser scan and found `beta:data-quality` accepted paired and inline flag-looking `--output` values, so an operator typo could swallow `--strict` as an artifact path. Added failing parser assertions first, then made both output forms reject missing, empty, and flag-looking paths before write-guard or Mongo setup while preserving strict mode, live-link sampling, sample inclusion, positive integer day/sample parsing, target metadata, and review artifact output. Runtime probes confirmed malformed paired and inline output values fail in parser code before DB work. No Beta data-quality DB scan, live-link check, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for Beta data-quality output parser hardening:
- `yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts` (red first for tolerated flag-looking output values, then green with 32/32 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server beta:data-quality --output --strict`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server beta:data-quality --output=--strict`.

2026-06-04 source seeder output parser hardening: Continued the write-capable scraper command parser scan and found `scrape:seed-sources` accepted paired and inline flag-looking `--output` values, so an operator typo could swallow `--apply` as an artifact path. Added failing parser assertions first, then made both output forms reject missing, empty, and flag-looking paths before write-guard or Mongo setup while preserving dry-run/apply mode, reset handling, Production confirmation guards, target metadata, and source seeding artifact output. Runtime probes confirmed malformed paired and inline output values fail in parser code before DB work. No source seeding run, DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for source seeder output parser hardening:
- `yarn --cwd server test src/scripts/__tests__/seedCliSafety.test.ts` (red first for tolerated flag-looking output values, then green with 3/3 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape:seed-sources --output --apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape:seed-sources --output=--apply`.

2026-06-04 accepted-inputs inline value parser hardening: Continued the accepted-input artifact/apply parser scan and found `accepted-inputs` already rejected paired flag-looking values, but still accepted inline flag-looking values such as `--output=--apply`, `--root=--apply`, `--input=--apply`, and `--program=--apply`. Added failing parser assertions first, then made the shared inline value consumer reject missing, empty, and flag-looking values before DB setup or accepted-input apply/import/status work while preserving status/report commands, dry-run/apply defaults, limit parsing, production write guards, target metadata, and CSV/text candidate output behavior. Runtime probes confirmed malformed inline values fail in parser code before DB work. No accepted-input status/import/apply run, DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for accepted-inputs inline value parser hardening:
- `yarn --cwd server test src/scripts/__tests__/acceptedInputs.test.ts` (red first for tolerated inline flag-looking values, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server accepted-inputs status --output=--apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server accepted-inputs status --root=--apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server accepted-inputs import-programs --input=--apply`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server accepted-inputs status --program=--apply`.

2026-06-04 scraper CLI inline value parser hardening: Continued the package-exposed scraper CLI parser scan and found the shared `yarn --cwd server scrape` parser did not understand inline `--flag=value` values, so `--source=orcid` and `--output=/tmp/report.json` became boolean flag names and malformed `--output=--dry-run` or `--output --dry-run` could be ignored instead of failing. Added failing parser assertions first, then made `parseArgs` support inline values and reject missing, empty, or flag-looking values for path/source/run/numeric selector flags before Mongo setup while preserving boolean flags, write preflight guards, target metadata, and saved artifact behavior for `run`, `cron`, `materialize`, `report`, and `prune-observations`. Runtime probes confirmed malformed paired and inline output values fail in parser code before DB work. A valid inline parse smoke against `example.invalid` reached normal Mongo connection setup and failed on DNS only; no data was scanned or written. No scraper run/report/materialize/prune DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for scraper CLI inline value parser hardening:
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts` (red first for unparsed inline values and tolerated unknown positional arguments, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape report --output --dry-run`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape report --output=--dry-run`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape run prod --source=orcid --dry-run`.

2026-06-04 scraper CLI run-bound parser hardening: Continued the shared scraper CLI parser scan and found `parseScraperOptions` used `parseInt` for `--limit`, `--offset`, and `--max-openalex-pages-per-author`, so values such as `--limit=12abc` could be truncated and malformed values could reach scraper preflight as `NaN`. Added failing parser assertions first, then made run-bound parsing require strict positive integers for `--limit` and `--max-openalex-pages-per-author`, and strict non-negative integers for `--offset`, before Mongo setup. Runtime probes confirmed malformed bounds fail in parser/preflight code before DB work. No scraper run, DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for scraper CLI run-bound parser hardening:
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts` (red first for tolerated truncated numeric values, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape run --source=orcid --dry-run --limit=12abc`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape run --source=orcid --dry-run --offset=bad`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape run --source=orcid --dry-run --max-openalex-pages-per-author=0`.

2026-06-04 scraper CLI prune-bound parser hardening: Continued the shared scraper CLI numeric parser scan and found `parseIntegerFlag` still used `Number` plus `Math.floor` for prune bounds, so values such as `--keep-runs=2.5` could be rounded before retention preflight. Added failing parser assertions first, then made prune-bound parsing require whole integer text and enforce the existing minimums for `--keep-runs` and `--older-than-days` before Mongo setup. Runtime probes confirmed malformed prune bounds fail in parser/preflight code before DB work. No observation prune dry-run/apply, DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for scraper CLI prune-bound parser hardening:
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts` (red first for tolerated rounded prune bounds, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --dry-run --keep-runs=2.5`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --dry-run --older-than-days=30days`.

2026-06-05 scraper CLI boolean-value parser hardening: Continued the shared scraper CLI parser scan and found known boolean flags still accepted values, so `--apply=false`, `--release=false`, or `--apply false` could be interpreted as truthy instead of failing loudly. Added failing parser assertions first, then made known boolean flags reject inline values and leave following positional values to the unknown-argument guard while preserving bare boolean flags, inline value flags, strict numeric bounds, write preflight guards, target metadata, and saved artifact behavior. Runtime probes confirmed malformed boolean values fail in parser code before DB work. No observation prune apply, scraper run, DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for scraper CLI boolean-value parser hardening:
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts` (red first for tolerated valued boolean flags, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --apply=false`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape prune-observations --apply false`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape run --source=orcid --release=false`.

2026-06-05 scraper CLI cron boolean parser hardening: Continued the shared scraper CLI boolean scan and found the documented cron `--force-disabled` recovery flag was missing from the known boolean list, so `--force-disabled=false` could still be interpreted as truthy. Added failing parser assertions first, then included `force-disabled` in the known boolean set while preserving bare `--force-disabled` cron behavior. Runtime probes confirmed valued `--force-disabled` forms fail in parser code before DB work. No scraper cron run, DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for scraper CLI cron boolean parser hardening:
- `yarn --cwd server test src/scrapers/__tests__/cli.test.ts` (red first for tolerated `--force-disabled=false`, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape cron --source=orcid --release --force-disabled=false`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape cron --source=orcid --release --force-disabled false`.

2026-06-05 Beta review artifact refresh after scraper CLI parser hardening: Regenerated the read-only Beta support packets recommended by source-health. First refreshed `/tmp/ylabs-source-health.json`, `/tmp/ylabs-beta-quality.json`, `/tmp/ylabs-scraper-integrity.json`, `/tmp/ylabs-launch-acquisition-report.json`, and `/tmp/ylabs-research-entity-dedupe.json`. Then regenerated six missing scraper reports under `/tmp/ylabs-scraper-reports`, six stale-observation review artifacts, two cross-source review artifacts, and all eight empty-decision validation artifacts with `--allow-empty-decisions`. The final `/tmp/ylabs-source-health.json` reports 21 ok / 7 warn / 0 error, report artifacts 6/6 available, stale review artifacts 6/6 available, cross-source review artifacts 2/2 available, stale validation artifacts 6/6 available with 0 decisions / 0 invalid / 575 unreviewed plans, and cross-source validation artifacts 2/2 available with 0 decisions / 0 invalid / 54 unreviewed plans. The final `/tmp/ylabs-beta-quality.json` remains `status=warn`, `errorCount=0`, `promotionReady=false`, and `promotionBlockerCount=2` for `sourceHealthWarnings=7` and `duplicateEntityNames=34`; same-PI validation remains loaded with 29 plans, 0 accepted decisions, 0 invalid decisions, and 29 unreviewed plans. No production write/copy, repair apply, reviewer-decision acceptance, destructive action, data deletion, or external-service action was run.

Exact next recommended engineering task if inputs appear: validate the relevant accepted-decision artifact first (`source:health`, `research-entity:duplicate-name-review`, `research-entity:dedupe-by-pi`, `observations:stale-conflict-review`, `observations:cross-source-conflict-review`, or `launch:review-exceptions`) and design a bounded guarded apply path only after actual accepted decisions exist and validation reports `invalidDecisionCount=0`. If no accepted decisions, new official source evidence, or production dry-run inputs appear, the remaining rows are not locally code-bearing.

2026-06-05 archived-artifact repair numeric parser hardening: Continued the package-exposed repair parser scan and found `research-entity:repair-archived-artifacts` used `Number` plus `Math.floor` for positive-integer bounds, so `--limit=1.5` and `--max-apply=1.5` could be accepted and rounded before planning or apply guards. Added failing parser assertions first, then made the shared bound parser require whole positive-integer text and a safe integer before Mongo setup while preserving dry-run/apply mode, max-apply guarding, output artifacts, target metadata, and production write guards. Runtime probe confirmed malformed fractional bounds fail in parser code before DB work. No archived-artifact repair DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for archived-artifact repair numeric parser hardening:
- `yarn --cwd server test src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts` (red first for tolerated fractional bounds, then green with 5/5 tests).
- `SCRAPER_ENV=beta yarn --cwd server research-entity:repair-archived-artifacts --limit=1.5 --output /tmp/ylabs-archived-artifact-repair-bad-limit.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 program-classification bounded-apply hardening: Continued the package-exposed write-command scan and found `programs:backfill-classification` defaulted to `limit=Infinity`, so `--apply` without `--limit` could update every active fellowship/program classification after the shared environment guard. Added a failing helper assertion first, then introduced `assertBackfillProgramClassificationsApplyAllowed()` and wired the CLI through it. Apply mode now requires an explicit finite `--limit` before Mongo setup while preserving dry-run defaults, output artifacts, target metadata, and the shared production write guard for bounded applies. Runtime probe confirmed unbounded apply fails before DB work. No program-classification DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for program-classification bounded-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/backfillProgramClassifications.test.ts` (red first for the missing bounded-apply guard, then green with 5/5 tests).
- `SCRAPER_ENV=beta yarn --cwd server programs:backfill-classification --apply --output /tmp/ylabs-program-classifications-unbounded-apply.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 student-visibility backfill bounded-apply hardening: Continued the package-exposed write-command scan and found `student-visibility:backfill` also defaulted to `limit=Infinity`, so `--apply` without `--limit` could update all active research entities and programs after the shared environment guard and distribution safety checks. Added a failing helper assertion first, then introduced `assertStudentVisibilityBackfillApplyAllowed()` and wired the CLI through it. Apply mode now requires an explicit finite `--limit` before Mongo setup while preserving dry-run defaults, collection selection, output artifacts, target metadata, existing distribution safety blockers, and the shared production write guard for bounded applies. Runtime probe confirmed unbounded apply fails before DB work. No student-visibility backfill DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for student-visibility backfill bounded-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/studentVisibilityBackfillReport.test.ts` (red first for the missing bounded-apply guard, then green with 9/9 tests).
- `SCRAPER_ENV=beta yarn --cwd server student-visibility:backfill --apply --output /tmp/ylabs-student-visibility-backfill-unbounded-apply.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 accepted-inputs apply-command hardening: Continued the package-exposed write-command scan and found `accepted-inputs` already does not use `--limit` for its database apply commands, but it still accepted `--apply` on commands without apply semantics such as `fellowship:candidates`. Added a failing helper assertion first, then introduced a small allowlist so only `orcid:crosswalk` and `scholar:apply` can run with `--apply`; unsupported commands now fail before Mongo setup while preserving the shared production write guard for supported apply commands. Runtime probe confirmed unsupported apply fails before DB work. No accepted-input candidate generation, accepted-input DB apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for accepted-inputs apply-command hardening:
- `yarn --cwd server test src/scripts/__tests__/acceptedInputs.test.ts` (red first for unsupported `--apply`, then green with 6/6 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server accepted-inputs fellowship:candidates --apply --root /tmp/ylabs-accepted-inputs`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 listing-profile repair bounded-apply hardening: Continued the direct write-helper scan and found `repairListingResearchEntityProfiles` defaulted to `limit=Infinity`, so its direct `tsx` apply mode could update every eligible listing-backed research entity after the shared environment guard. Added a failing helper assertion first, then introduced `assertRepairListingResearchEntityProfilesApplyAllowed()` and routed the CLI through it. Apply mode now requires an explicit finite `--limit` before Mongo setup while preserving dry-run defaults, output artifacts, target metadata, and the shared production write guard for bounded applies. Runtime probe confirmed unbounded apply fails before DB work. No listing-profile repair DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for listing-profile repair bounded-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/repairListingResearchEntityProfiles.test.ts` (red first for the missing bounded-apply guard, then green with 5/5 tests).
- `SCRAPER_ENV=beta yarn --cwd server tsx src/scripts/repairListingResearchEntityProfiles.ts --apply --output /tmp/ylabs-repair-listing-entities-unbounded-apply.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 legacy V4 migration bounded-apply hardening: Continued the package-exposed migration script scan and found the shared `data-migration/v4MigrationUtils.ts` helper allowed legacy V4 backfills to run `--apply` without a finite `--limit`. Added a failing shared-helper assertion first, then made `assertV4MigrationApplyAllowed()` require an explicit finite limit before the shared production write guard and before Mongo connection. This covers package-exposed legacy V4 faculty, student-profile, research-group-member, paper-graph, grants, and research-group-stats backfills while preserving dry-run defaults, output artifacts, target metadata, and the shared production write guard for bounded applies. Runtime probe confirmed unbounded apply fails before DB work. No legacy V4 migration DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for legacy V4 migration bounded-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/dataMigrationV4Utils.test.ts` (red first for the missing bounded-apply guard, then green with 4/4 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration migrate:v4:research-group-members --apply --output /tmp/ylabs-v4-rg-members-unbounded-apply.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 root-data import bounded-apply hardening: Continued the package-exposed data-migration write scan and found `migrate:root-data-files` accepted `--apply` without a finite `--limit`, even though the command can import loose root files into departments, faculty members, research groups, and sources and can optionally delete source files after a clean apply. Added a failing helper assertion first, then made `assertRootDataImportApplyAllowed()` require an explicit finite limit before the shared production write guard and before Mongo setup. Bounded applies still use the existing production guard, and `--delete-source-files` remains separately blocked unless apply and verification are clean. Runtime probe confirmed unbounded apply fails before DB work. No root-data import DB scan/apply, source-file deletion, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for root-data import bounded-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/rootDataImportCliSafety.test.ts` (red first for the missing bounded-apply guard, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration migrate:root-data-files --apply --output /tmp/ylabs-root-data-unbounded-apply.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 fellowship import explicit-CSV apply hardening: Continued the package-exposed data-migration write scan and found `import:fellowships` could run `--apply` from its implicit default CSV path. The command already guards production writes and blocks delete-and-replace when existing rows are present unless `--replace-existing` is supplied, but apply mode still needed an operator-selected input artifact. Added a failing helper assertion first, then made `assertFellowshipImportApplyAllowed()` require an explicit `--csv` path before the shared production write guard and before DB setup. Dry-runs can still use the default path for inspection. Runtime probe confirmed missing `--csv` apply fails before DB work. No fellowship import DB scan/apply, fellowship deletion/replacement, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for fellowship import explicit-CSV apply hardening:
- `yarn --cwd server test src/scripts/__tests__/fellowshipImportCliSafety.test.ts` (red first for the missing explicit-CSV apply guard, then green with 6/6 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration import:fellowships --apply --output /tmp/ylabs-fellowship-import-missing-csv.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 legacy user migration same-target apply hardening: Continued the package-exposed data-migration copy scan and found `migrate:users` copies from `MONGODBURL` to `MONGODBURL_MIGRATION` and can delete existing target users when `--replace-existing` is supplied. Added a failing helper assertion first, then made `assertUserMigrationApplyAllowed()` reject apply mode when the source and target Mongo URLs are identical before the shared production write guard and before any DB connection. This preserves dry-run copy review, target replacement acknowledgement, saved artifacts, and the shared production write guard for distinct targets. Runtime probe confirmed same-target apply fails before DB work. No user copy, user deletion/replacement, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for legacy user migration same-target apply hardening:
- `yarn --cwd server test src/scripts/__tests__/userMigrationCliSafety.test.ts` (red first for the missing same-target guard, then green with 6/6 tests).
- `MONGODBURL=mongodb://example.invalid/Same MONGODBURL_MIGRATION=mongodb://example.invalid/Same SCRAPER_ENV=beta yarn --cwd data-migration migrate:users --apply --replace-existing --output /tmp/ylabs-user-migration-same-target.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 legacy department migration same-target apply hardening: Continued the package-exposed data-migration source/target scan and found `migrate:departments` reads departments from `MONGODBURL` and updates listing departments in `MONGODBURL_MIGRATION`. Added a failing helper assertion first, then made `assertDepartmentMigrationApplyAllowed()` reject apply mode when the source and target Mongo URLs are identical before the shared production write guard and before any DB connection. This preserves dry-run listing-change review, manual mapping validation, saved artifacts, and the shared production write guard for distinct targets. Runtime probe confirmed same-target apply fails before DB work. No department migration DB scan/apply, listing update, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for legacy department migration same-target apply hardening:
- `yarn --cwd server test src/scripts/__tests__/departmentMigrationCliSafety.test.ts` (red first for the missing same-target guard, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Same MONGODBURL_MIGRATION=mongodb://example.invalid/Same SCRAPER_ENV=beta yarn --cwd data-migration migrate:departments --apply --output /tmp/ylabs-department-migration-same-target.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 legacy publication migration bounded-apply hardening: Continued the legacy data-migration write scan and found `MigratePublicationsToPapers.ts` apply mode scanned every user with embedded publications and bulk-upserted papers without a bounded user scan. Added failing parser and helper assertions first, then added `--limit` parsing, made `assertPublicationMigrationApplyAllowed()` require an explicit finite limit for apply mode, and applied the limit to the users query before paper grouping. Dry-runs can still inspect the full legacy embedded publication set. Runtime probe confirmed unbounded apply fails before DB work. No publication migration DB scan/apply, paper upsert, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for legacy publication migration bounded-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/publicationMigrationCliSafety.test.ts` (red first for missing `--limit` support and apply guard, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta npx tsx MigratePublicationsToPapers.ts --apply --output /tmp/ylabs-publication-migration-unbounded-apply.json` from `data-migration/`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 ResearchEntity migration bounded-apply hardening: Continued the package-exposed migration write scan and found `research-entity:migrate --apply` copied every legacy `research_groups` row into `research_entities` before backfilling dependent references. Added failing parser and helper assertions first, then added `--limit` parsing, made `assertResearchEntityMigrationWriteAllowed()` require an explicit finite limit for apply mode, and applied the limit to the source cursor. Dry-run, verify, and rollback-plan modes can still run without a limit. Runtime probe confirmed unbounded apply fails before DB work. No ResearchEntity migration DB scan/apply, dependent-reference backfill, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for ResearchEntity migration bounded-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/legacyMigrationCliSafety.test.ts` (red first for missing `--limit` support and apply guard, then green with 19/19 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:migrate --apply --output /tmp/ylabs-research-entity-migration-unbounded-apply.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 legacy collection drop confirmation hardening: Continued the package-exposed cleanup scan and found `legacy:cleanup --drop-legacy` and `research-entity:cleanup-collections --drop-legacy` could drop verified legacy collections with only the shared environment write guard. Added failing parser/helper assertions first, then added `--confirm-drop-legacy` to both CLIs and made drop mode require that explicit confirmation before the shared production guard and before Mongo setup. Dry-run, apply, verify, and non-drop production guards remain unchanged. Runtime probes confirmed unconfirmed drop commands fail before DB work. No legacy collection drop, DB scan/apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for legacy collection drop confirmation hardening:
- `yarn --cwd server test src/scripts/__tests__/legacyMigrationCliSafety.test.ts` (red first for missing `--confirm-drop-legacy` support and guard, then green with 21/21 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server legacy:cleanup --drop-legacy --output /tmp/ylabs-legacy-cleanup-drop-unconfirmed.json`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:cleanup-collections --drop-legacy --output /tmp/ylabs-research-entity-cleanup-collections-drop-unconfirmed.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 Mongo naming migration apply confirmation hardening: Continued the package-exposed migration scan and found `migrate:mongo-naming --apply` could rename collections, merge/drop legacy collections, and unset legacy user fields with only the shared environment write guard. Added failing parser/helper assertions first, then added `--confirm-mongo-naming` and made apply mode require that explicit confirmation before the shared production guard and before Mongo setup. Dry-run mode remains unchanged. Runtime probe confirmed unconfirmed apply fails before DB work. No Mongo naming migration DB scan/apply, collection rename/drop, user field update, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for Mongo naming migration apply confirmation hardening:
- `yarn --cwd server test src/scripts/__tests__/legacyMigrationCliSafety.test.ts` (red first for missing `--confirm-mongo-naming` support and guard, then green with 22/22 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server migrate:mongo-naming --apply --output /tmp/ylabs-mongo-naming-unconfirmed-apply.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 seed apply confirmation hardening: Continued the package-exposed seed scan and found `seed:departments` and `seed:research-areas` could apply broad department ground-truth/default research-area seed changes with only the shared environment write guard. Added failing parser/helper assertions first, then added `--confirm-seed-apply` to both CLIs and made apply mode require that explicit confirmation before the shared production guard, before official-source fetches, and before Mongo setup. Dry-run mode remains unchanged. Runtime probes confirmed unconfirmed applies fail before source fetch/DB work. No seed apply, source fetch, DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for seed apply confirmation hardening:
- `yarn --cwd server test src/scripts/__tests__/seedCliSafety.test.ts` (red first for missing `--confirm-seed-apply` support and guard, then green with 3/3 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration seed:departments --apply --output /tmp/ylabs-department-seed-unconfirmed-apply.json`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd data-migration seed:research-areas --apply --output /tmp/ylabs-research-area-seed-unconfirmed-apply.json`.
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 posted-opportunity/application-route bounded-apply hardening: Continued the package-exposed server script write scan and found `application-routes:backfill-pathways`, `posted-opportunities:backfill`, and `opportunities:reap-statuses` had finite dry-run defaults but did not require the operator to choose a bound explicitly before apply mode. Added failing helper assertions first, then tracked whether `--limit` was supplied and made all three apply guards require an explicit finite limit before the shared production write guard and before Mongo setup. Dry-runs keep their existing default bounds. Runtime probes confirmed unbounded applies fail before DB work. No application-route backfill, posted-opportunity backfill, status reaping apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for posted-opportunity/application-route bounded-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/applicationRoutePathwayBackfillCore.test.ts` (red first for missing explicit-limit apply guard, then green with 10/10 tests).
- `yarn --cwd server test src/scripts/__tests__/postedOpportunityMaintenanceCli.test.ts` (red first for missing explicit-limit apply guards, then green with 10/10 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server application-routes:backfill-pathways --apply --output /tmp/ylabs-application-route-unbounded-apply.json`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server posted-opportunities:backfill --apply --output /tmp/ylabs-posted-opportunity-unbounded-apply.json`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server opportunities:reap-statuses --apply --output /tmp/ylabs-posted-opportunity-reaper-unbounded-apply.json`.

2026-06-05 scholarly-link audit apply confirmation hardening: Continued the package-exposed server script write scan and found `scholarly-links:provenance-audit` and `scholarly-links:suppression-audit` could bulk archive or update scholarly activity records with only the shared environment write guard. Added failing helper assertions first, then added `--confirm-scholarly-link-apply` to both CLIs and made apply mode require that explicit confirmation before the shared production write guard and before Mongo setup. Dry-run mode remains unchanged. Runtime probes confirmed unconfirmed applies fail before DB work. No scholarly-link provenance/suppression apply, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for scholarly-link audit apply confirmation hardening:
- `yarn --cwd server test src/scripts/__tests__/scholarlyLinkAuditCli.test.ts` (red first for missing `--confirm-scholarly-link-apply` support and guard, then green with 11/11 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scholarly-links:provenance-audit --apply --output /tmp/ylabs-scholarly-link-provenance-unconfirmed-apply.json`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scholarly-links:suppression-audit --apply --output /tmp/ylabs-scholarly-link-suppression-unconfirmed-apply.json`.

2026-06-05 paper authorship audit apply confirmation hardening: Continued the package-exposed server script write scan and found `papers:authorship-audit --apply` can backfill identity-backed authorship rows, supersede direct-author observations, repair denormalized paper authors, and delete unsupported cleanup rows with only the shared environment write guard. Added a failing helper assertion first, then added `--confirm-paper-authorship-apply` and made apply mode require that explicit confirmation before the shared production write guard and before Mongo setup. Dry-run mode remains unchanged. Runtime probe confirmed unconfirmed apply fails before DB work. No paper-authorship audit apply, authorship backfill, observation supersession, paper deletion, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for paper authorship audit apply confirmation hardening:
- `yarn --cwd server test src/scripts/__tests__/paperAuthorshipAudit.test.ts` (red first for missing `--confirm-paper-authorship-apply` support and guard, then green with 6/6 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server papers:authorship-audit --apply --output /tmp/ylabs-paper-authorship-unconfirmed-apply.json`.

2026-06-05 paper/scholarly repair-command confirmation guidance: Followed up on the new apply confirmation flags and found generated repair guidance could still recommend now-incomplete apply commands. Added failing command-output assertions first, then updated `papers:authorship-audit` warning guidance to emit `SCRAPER_ENV=beta yarn --cwd server papers:authorship-audit --apply --confirm-paper-authorship-apply`, updated scholarly provenance fix commands to include `--confirm-scholarly-link-apply`, and made scholarly suppression fix-command normalization add the same confirmation flag even when an older bare apply command is passed into the artifact wrapper. No apply mode, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for paper/scholarly repair-command confirmation guidance:
- `yarn --cwd server test src/scripts/__tests__/paperAuthorshipAudit.test.ts` (red first for missing confirmed fix-command helper, then green with 7/7 tests).
- `yarn --cwd server test src/scripts/__tests__/scholarlyLinkAuditCli.test.ts src/services/__tests__/scholarlyActivityAuditService.test.ts src/services/__tests__/launchTrustContractService.test.ts src/scripts/__tests__/paperAuthorshipAudit.test.ts` (red first for stale scholarly provenance command guidance, then green with 27/27 tests).
- `npx tsc --noEmit -p server/tsconfig.json`.

2026-06-05 exploratory pathway dedupe apply confirmation hardening: Continued the package-exposed server script write scan and found `pathways:dedupe-exploratory --apply` can archive duplicate exploratory-contact pathways and relink access signals with only a limit plus the shared environment write guard. Added a failing helper assertion first, then added `--confirm-exploratory-dedupe-apply` and made apply mode require that explicit confirmation before the shared production write guard and before Mongo setup. Dry-run mode remains unchanged. Runtime probe confirmed unconfirmed apply fails before DB work. No exploratory pathway dedupe apply, access-signal relink, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for exploratory pathway dedupe apply confirmation hardening:
- `yarn --cwd server test src/scripts/__tests__/dedupeExploratoryContactPathways.test.ts` (red first for missing `--confirm-exploratory-dedupe-apply` support and guard, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server pathways:dedupe-exploratory --apply --limit=1`.

2026-06-05 student visibility gate apply confirmation hardening: Continued the package-exposed server script write scan and found `student-visibility:gate --mode=apply` can bulk update research/program visibility tiers and release-queue state with only the shared environment write guard. Added a failing helper assertion first, then added `--confirm-student-visibility-apply` and made apply mode require that explicit confirmation before the shared production write guard and before Mongo setup. Updated durable operator guidance so future post-write gate commands include the confirmation flag. Dry-run mode remains unchanged. Runtime probe confirmed unconfirmed apply fails before DB work. No visibility gate apply, release-queue update, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for student visibility gate apply confirmation hardening:
- `yarn --cwd server test src/scripts/__tests__/studentVisibilityGate.test.ts` (red first for missing `--confirm-student-visibility-apply` support and guard, then green with 5/5 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=apply --output /tmp/ylabs-student-visibility-gate-unconfirmed.json`.
- `npx tsc --noEmit -p server/tsconfig.json` (also fixed visibility dedupe-row serializer typing in the gate and backfill helpers so optional `ResearchEntityPiDedupeRow.entities[]` fields narrow correctly).
- `yarn --cwd server test src/scrapers/__tests__/officialProfilePiBackfillScraper.test.ts` (kept the dirty official-profile helper/test state typecheck-clean after removing duplicate local helper declarations).
- `git diff --check`.

2026-06-05 Beta repair queue reviewed-artifact apply hardening: Continued the package-exposed server script write scan and found `beta:repair-queue --mode=apply` could still run direct bounded applies even though current durable guidance says to apply only from a reviewed fresh Beta dry-run artifact. Added a failing helper assertion first, then added `assertBetaRepairQueueApplyReviewedArtifact()` and made apply mode require `--apply-from <dry-run-artifact>` before the shared production write guard and before Mongo setup. The existing apply-from validator still enforces Beta target, dry-run mode, freshness, option matching, and dry-run-positive record ids before repairs run. Runtime probe confirmed direct apply fails before DB work. No Beta repair apply, release-queue update, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for Beta repair queue reviewed-artifact apply hardening:
- `yarn --cwd server test src/scripts/__tests__/betaRepairQueue.test.ts` (red first for missing reviewed-artifact apply guard, then green with 8/8 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --mode=apply --limit=1 --output /tmp/ylabs-beta-repair-unreviewed-apply.json`.

2026-06-05 archived-artifact repair bounded-apply hardening: Continued the package-exposed server script write scan and found `research-entity:repair-archived-artifacts --apply` had dry-run defaults for scan bounds and only enforced `--max-apply` after connecting to Mongo and planning writes. Added a failing helper assertion first, then tracked whether `--limit` was supplied and made apply mode require an explicit finite limit before the shared production write guard and before Mongo setup. Dry-run mode keeps its default scan limit, and apply mode still enforces `--max-apply` after planning. Runtime probe confirmed unbounded apply fails before DB work. No archived-artifact repair apply, artifact relink/archive, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for archived-artifact repair bounded-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/repairArchivedEntityArtifacts.test.ts` (red first for missing explicit-limit apply guard, then green with 6/6 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:repair-archived-artifacts --apply --output /tmp/ylabs-archived-artifact-repair-unbounded-apply.json`.

2026-06-05 same-PI entity dedupe bounded-apply hardening: Continued the package-exposed server script write scan and found `research-entity:dedupe-by-pi --apply` had a dry-run default `--limit=10000` and only enforced `--max-apply` after connecting to Mongo and planning writes. Added a failing helper assertion first, then tracked whether `--limit` was supplied and made apply mode require an explicit finite limit before the shared production write guard and before Mongo setup. Dry-run mode keeps its default scan limit, accepted-decision validation remains unchanged, and apply mode still enforces `--max-apply` after planning. Runtime probe confirmed unbounded apply fails before DB work. No same-PI dedupe apply, entity archive/delete, member relink/retirement, artifact relink/archive, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for same-PI entity dedupe bounded-apply hardening:
- `yarn --cwd server test src/scripts/__tests__/researchEntityPiDedupeCore.test.ts` (red first for missing explicit-limit apply guard, then green with 40/40 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --apply --output /tmp/ylabs-same-pi-unbounded-apply.json`.

2026-06-05 Beta student analytics apply confirmation hardening: Continued the package-exposed server script write scan and found `beta:clear-student-analytics --apply` deletes residual real-student Beta telemetry with only the Beta environment guard and post-query `--limit` cap. Added failing parser/helper/next-command assertions first, then added `--confirm-clear-student-analytics`, made apply mode require that explicit confirmation before the shared production write guard and before Mongo setup, and updated the generated next command. Dry-run mode and the Beta-only environment requirement remain unchanged. Runtime probe confirmed unconfirmed apply fails before DB work. No analytics deletion, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for Beta student analytics apply confirmation hardening:
- `yarn --cwd server test src/scripts/__tests__/clearBetaStudentAnalytics.test.ts` (red first for missing confirmation flag/guard/next-command text, then green with 8/8 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server beta:clear-student-analytics --apply --output /tmp/ylabs-beta-student-analytics-unconfirmed.json`.

2026-06-05 source registry seed dry-run-first hardening: Continued the package-exposed scraper write scan and found `scrape:seed-sources` still defaulted to apply mode, so a bare package script could update active source metadata and retire legacy source rows after only the shared environment write guard. Added failing parser/helper assertions first, then made `parseSeedSourcesArgs([])` dry-run-first, added `--confirm-seed-apply`, and made apply mode require that explicit confirmation before the shared production write guard and before Mongo setup. Updated scraper operator docs to show dry-run artifact review followed by confirmed apply. Runtime probe confirmed unconfirmed apply fails before DB work. No source registry seed apply, source metadata update/retirement, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for source registry seed dry-run-first hardening:
- `yarn --cwd server test src/scripts/__tests__/seedCliSafety.test.ts` (red first for default apply/missing confirmation guard, then green with 3/3 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server scrape:seed-sources --apply --output /tmp/ylabs-seed-sources-unconfirmed.json`.

2026-06-05 Meili rebuild confirmation hardening: Continued the package-exposed external-write scan and found `meili:rebuild-pathways` and `meili:rebuild-research-entities` could rebuild Meilisearch indexes with only the shared environment write guard. Added failing parser/helper assertions first, then added `--confirm-meili-rebuild` to both CLIs and made rebuilds require that explicit confirmation before the shared production write guard, Mongo setup, or Meili work. Updated Beta readiness generated commands plus production runbook/roadmap command examples to include the new flag. Runtime probes confirmed unconfirmed rebuilds fail before DB/Meili work. No Meili rebuild, DB scan, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for Meili rebuild confirmation hardening:
- `yarn --cwd server test src/scripts/__tests__/searchIndexRebuildCli.test.ts` (red first for missing `--confirm-meili-rebuild` support and guard, then green with 8/8 tests).
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways --output /tmp/ylabs-meili-pathways-unconfirmed.json`.
- `MONGODBURL=mongodb://example.invalid/Beta SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities --output /tmp/ylabs-meili-researchentities-unconfirmed.json`.

2026-06-05 hardened-command guidance cleanup: Followed up on the new source-seed and Meili confirmation flags and found the production cron missing-source error still recommended a bare `yarn scrape:seed-sources` command. Added a failing cron-runner assertion first, then updated the error to direct operators to the reviewed dry-run artifact and confirmed apply flow. Updated current decisions for repeatable Meili rebuild/source retirement command shapes. No cron run, source seed apply, Meili rebuild, production write/copy, destructive action, irreversible migration, data deletion, or dependency install was run.

Focused checks for hardened-command guidance cleanup:
- `yarn --cwd server test src/scrapers/__tests__/cronRunner.test.ts` (red first for stale missing-source guidance, then green with 5/5 tests).
2026-06-05 scraper observation retention confirmation guard: Hardened the package-exposed compact-retention apply path. `yarn --cwd server scrape prune-observations --apply` now fails before Mongo setup unless `--confirm-observation-prune` is also supplied, while dry-run artifacts remain unchanged. The saved prune artifact metadata records `confirmObservationPrune` so review packets show whether the delete confirmation was present. No observation prune apply, data deletion, production write, production copy, or destructive action was run.

2026-06-05 standalone scraper materialize confirmation guard: Hardened `yarn --cwd server scrape materialize --run <id>` so standalone materialization writes fail before Mongo setup unless `--confirm-materialize` is present. Dry-run materialization remains unchanged and write-enabled artifacts now include `confirmMaterialize` in parsed options. No materialization write, visibility-gate apply, production write, production copy, destructive action, or data deletion was run.

2026-06-05 accepted-inputs apply confirmation guard: Hardened the supported accepted-file DB apply workflows. `accepted-inputs scholar:apply --apply` and `accepted-inputs orcid:crosswalk --apply` now require `--confirm-accepted-inputs-apply` before Mongo setup in addition to the existing supported-command allowlist and shared environment write guard. Dry-run validation, candidate generation, and report artifacts remain unchanged. No accepted-input apply, production write, production copy, destructive action, or data deletion was run.

2026-06-05 surname-lab disambiguation apply hardening: Hardened the package-exposed `research-entity:disambiguate-surname-labs` apply path. Apply mode now requires `--confirm-surname-lab-disambiguation` plus an explicit finite `--limit` before Mongo setup, while `--limit` and `--max-apply` reject malformed values such as `10abc` or `1.5`. Runtime fake-Beta probes against `example.invalid` confirmed unconfirmed and unbounded apply invocations fail in preflight before DB connection. No surname-lab apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 direct listing-profile repair confirmation guard: Hardened `repairListingResearchEntityProfiles` apply mode. The script already required an explicit finite `--limit`; it now also requires `--confirm-listing-profile-repair` before Mongo setup. A fake-Beta probe against `example.invalid` confirmed unconfirmed apply fails in preflight before DB connection. No listing-profile repair apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 application-route and posted-opportunity maintenance confirmation guard: Hardened the bounded apply paths for `application-routes:backfill-pathways`, `posted-opportunities:backfill`, and `opportunities:reap-statuses`. These commands already required explicit finite `--limit` values before apply; they now also require `--confirm-application-route-backfill`, `--confirm-posted-opportunity-backfill`, and `--confirm-posted-opportunity-status-reaper` respectively before the shared production write guard and before Mongo setup. Focused tests covered parser defaults, no-value confirmation flags, production blocking, missing-limit blocking, and missing-confirmation blocking. No application-route backfill, posted-opportunity backfill, status reaper apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 program and visibility backfill confirmation guard: Hardened the bounded apply paths for `programs:backfill-classification` and `student-visibility:backfill`. These commands already required explicit finite `--limit` values before apply; they now also require `--confirm-program-classification-backfill` and `--confirm-student-visibility-backfill` before the shared production write guard and before Mongo setup. Focused tests covered parser defaults, no-value confirmation flags, missing-limit blocking, and missing-confirmation blocking. No program classification backfill, student visibility backfill, production write/copy, destructive action, or data deletion was run.

2026-06-05 archived artifact repair confirmation guard: Hardened `research-entity:repair-archived-artifacts` apply mode. The command already required an explicit finite `--limit` and enforced `--max-apply`; it now also requires `--confirm-archived-artifact-repair` before planned writes can proceed. Focused tests covered parser defaults, no-value confirmation flags, missing-limit blocking, max-apply blocking, and missing-confirmation blocking. No archived-artifact repair apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 same-PI research-entity dedupe confirmation guard: Hardened `research-entity:dedupe-by-pi` apply mode. The command already required an explicit finite `--limit` and enforced `--max-apply`; it now also requires `--confirm-research-entity-pi-dedupe` before the shared production write guard and before Mongo setup. Accepted-decision review flows remain available, but apply still needs the purpose-specific confirmation. Focused tests covered parser defaults, no-value confirmation flags, missing-limit blocking, max-apply blocking, accepted-decision filtering, and missing-confirmation blocking. No same-PI dedupe apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 duplicate-name review confirmation guard: Hardened `research-entity:duplicate-name-review` apply mode. The command already required an explicit finite `--limit`, an accepted-decision artifact, and `--max-apply`; it now also requires `--confirm-duplicate-entity-name-review` before the shared production write guard and before Mongo setup. Dry-run validation, decision templates, and accepted-decision review artifacts remain unchanged. No duplicate-name review apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 research entity migration confirmation guard: Hardened `research-entity:migrate` apply mode. The command already required an explicit finite `--limit`; it now also requires `--confirm-research-entity-migration` before the shared production write guard and before Mongo setup. Rollback-plan, verify, and dry-run modes remain confirmation-free. No research-entity migration apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 legacy V4 migration confirmation guard: Hardened the shared legacy V4 migration helper used by `migrate:v4:faculty-members`, `migrate:v4:student-profiles`, `migrate:v4:research-group-members`, `migrate:v4:paper-graph`, `migrate:v4:grants`, and `migrate:v4:research-group-stats`. These scripts already required explicit finite `--limit` values before apply; they now also require `--confirm-v4-migration` before the shared production write guard and before Mongo setup. Dry-run mode remains unchanged. No V4 migration apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 legacy user/department migration confirmation guard: Hardened `migrate:users --apply` and `migrate:departments --apply` so they now require `--confirm-legacy-user-migration` and `--confirm-legacy-department-migration` respectively before the shared production write guard and before Mongo setup. Dry-run copy/listing review, target replacement acknowledgement, same-source/target blocking, saved artifacts, and the shared production write guard remain unchanged. Fake-Beta unconfirmed apply probes stopped at the new confirmation guards before DB connection. No user copy, department migration apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 official-profile publication-pointer repair bounded-apply guard: Hardened `scholarly-links:repair-official-profile-pointers` apply mode. The script already required `--confirm-official-profile-publication-repair`; it now also requires an explicit `--limit` before Mongo setup instead of relying on the dry-run default scan bound. A fake-Beta probe against `example.invalid` confirmed confirmed-but-unbounded apply fails in preflight before DB connection. No publication-pointer repair apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 fellowship import confirmation guard: Hardened `import:fellowships --apply` so the CSV import now requires `--confirm-fellowship-import` in addition to the existing explicit `--csv` path before the shared production write guard and before CSV filesystem/Mongo work. Dry-run import review, saved artifacts, target replacement acknowledgement, and the shared production write guard remain unchanged. A fake-Beta unconfirmed apply probe stopped at the new confirmation guard before DB connection. No fellowship import apply, fellowship delete/replace, production write/copy, destructive action, or data deletion was run.

2026-06-05 legacy publication/root-data migration confirmation guard: Hardened legacy publication migration apply mode and `migrate:root-data-files --apply` so bounded applies now also require `--confirm-legacy-publication-migration` and `--confirm-legacy-root-data-import` respectively before the shared production write guard and before Mongo setup. Dry-run review, explicit `--limit` bounds, saved artifacts, and root-data delete-source verification remain unchanged. Fake-Beta unconfirmed apply probes stopped at the new confirmation guards before DB connection. No publication migration apply, root-data import apply, source-file deletion, production write/copy, destructive action, or data deletion was run.

2026-06-05 stale observation supersession confirmation guard: Hardened `observations:stale-conflict-review --apply` so accepted-decision supersession applies now require `--max-apply` and `--confirm-stale-observation-supersession` in addition to the accepted decisions artifact and shared production write guard, all before Mongo setup. Dry-run review, decision-template generation, empty-decision validation, and saved artifacts remain unchanged. A fake-Beta unconfirmed apply probe stopped at the new confirmation guard before DB connection. No stale-observation supersession apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 Beta repair queue apply confirmation guard: Hardened `beta:repair-queue --mode=apply` so reviewed-artifact applies now require `--confirm-beta-repair-queue-apply` in addition to the fresh Beta `--apply-from` dry-run artifact, before artifact read and before Mongo setup. Apply-from validation still enforces Beta target, dry-run mode, freshness, option matching, and dry-run-positive record ids. A fake-Beta unconfirmed apply-from probe stopped at the new confirmation guard before DB connection. No Beta repair queue apply, visibility queue write, production write/copy, destructive action, or data deletion was run.

2026-06-05 profile-description conflict repair bounded-apply guard: Hardened `observations:repair-profile-description-conflicts --apply` so the observation supersession repair now requires `--confirm-profile-description-conflict-repair` plus an explicit finite `--limit` before the shared production write guard and before Mongo setup. The existing post-plan `--max-apply` cap still limits the number of superseded observations after planning. A fake-Beta confirmed-but-unbounded apply probe stopped at the new limit guard before DB connection. No profile-description conflict repair apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 member-reference audit bounded-apply guard: Hardened `research-entity-members:audit-user-refs --apply` so exact-relink/member-archive repairs now require `--confirm-exact-relink` plus an explicit finite `--limit` before the shared production write guard and before Mongo setup. The existing manual-review blocker and `--max-apply` cap still apply after planning. A fake-Beta confirmed-but-unbounded apply probe stopped at the new limit guard before DB connection. No member-reference repair apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 user identity dedupe bounded-apply guard: Hardened `users:dedupe-by-identity --apply` so same-person user merges now require `--confirm-user-identity-dedupe`, an explicit finite `--limit`, and `--max-apply-groups` before the shared production write guard and before Mongo setup. The post-plan group-count cap still limits accepted merge groups. A fake-Beta confirmed-but-unbounded apply probe stopped at the new limit guard before DB connection. No user identity dedupe apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 scholarly-link suppression max-apply guard: Hardened `scholarly-links:suppression-audit --apply` so dataset-like suppression, duplicate scholarly-link suppression, and HTML-title repair applies now require `--confirm-scholarly-link-apply` plus `--max-apply` before Mongo setup. The CLI computes planned suppressions/repairs after read-only counts and stops before mutation when the plan exceeds the cap; dry-run fix guidance now includes the computed `--max-apply=<planned>` value. A fake-Beta confirmed apply without `--max-apply` stopped at the new preflight guard before DB connection. No scholarly-link suppression apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 scholarly-link provenance max-apply guard: Hardened `scholarly-links:provenance-audit --apply` so null-target attribution suppression, orphan attribution suppression, and ownerless scholarly-link suppression now require `--confirm-scholarly-link-apply` plus `--max-apply` before Mongo setup. The CLI computes planned provenance suppressions after read-only counts and stops before mutation when the plan exceeds the cap; shared scholarly activity fix guidance now includes the computed `--max-apply=<qualityFailureTotal>` value. A fake-Beta confirmed apply without `--max-apply` stopped at the new preflight guard before DB connection. No scholarly-link provenance apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 paper authorship audit max-apply guard: Hardened `papers:authorship-audit --apply` so OpenAlex proof backfills, arXiv/direct-author observation supersession, unsupported denormalized-link cleanup, invalid/orphan/duplicate `paper_authors` deletion, unidentified paper deletion, and denormalized author-array reconciliation now require `--confirm-paper-authorship-apply` plus `--max-apply` before Mongo setup. Apply mode computes planned mutations from the dry-run audit and OpenAlex backfill candidate count, then stops before mutation when the plan exceeds the cap. A fake-Beta confirmed apply without `--max-apply` stopped at the new preflight guard before DB connection. No paper authorship audit apply, production write/copy, destructive action, or data deletion was run.

2026-06-05 Beta student analytics explicit-limit guard: Tightened `beta:clear-student-analytics --apply` so residual Beta telemetry deletion now requires `--confirm-clear-student-analytics` plus an explicit finite `--limit` before Mongo setup instead of relying on the default cap. The dry-run summary now emits an apply command with `--limit=<candidateEventCount>`, so the apply fails if more matching analytics rows appear after review. No analytics deletion, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 exploratory pathway dedupe max-apply guard: Hardened `pathways:dedupe-exploratory --apply` so duplicate exploratory pathway repair now requires `--confirm-exploratory-dedupe-apply`, an explicit finite `--limit`, and `--max-apply` before writes. The CLI computes the post-plan cap from archived duplicate pathways plus relinked access signals and contact routes, then stops before mutation if planned row changes exceed `--max-apply`. No pathway dedupe apply, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 student visibility gate max-apply guard: Hardened `student-visibility:gate --apply` so broad visibility and release-queue recomputation now requires `--confirm-student-visibility-apply` plus `--max-apply`. The CLI plans once, builds the dry-run report, caps planned visibility records against `--max-apply`, and only then calls the existing bulk apply helper. No visibility gate apply, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 hardened-command docs cleanup: Updated current operator guidance after the visibility-gate and paper-authorship max-apply guards. Durable docs now say to run `student-visibility:gate` dry-run first, review the scanned count, then apply only with `--confirm-student-visibility-apply --max-apply=<reviewedScannedCount>`. The paper-authorship decision note now includes `--confirm-paper-authorship-apply --max-apply=<plannedChanges>` after dry-run review. No visibility gate apply, paper-authorship apply, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 config deployment env typecheck repair: While verifying the hardened-command docs cleanup, server typecheck failed because `configService` modeled deployment fingerprint input as a `Pick<NodeJS.ProcessEnv, ...>`, which made selected env keys required and rejected extra env keys in object-literal tests. Updated the type to a partial environment map with arbitrary string keys, matching `process.env` and the public deployment-fingerprint tests without exposing additional config fields. Focused config-service tests and server typecheck now pass.

2026-06-05 paper-quality suppression repair command guidance: Improved `buildPaperQualityReportFromCounts` so paper-quality blockers that `scholarly-links:suppression-audit` can repair now emit a target-explicit, hardened command: `SCRAPER_ENV=beta yarn --cwd server scholarly-links:suppression-audit --apply --max-apply=<planned> --confirm-scholarly-link-apply`. The cap is computed from dataset-like links, HTML-title repairs, and duplicate loser-row counts when available, while duplicate groups remain the blocker metric; remaining unsupported quality issues still emit their specific manual/backfill guidance. No paper-quality audit DB run, scholarly-link suppression apply, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 paper-quality duplicate-group sample artifacts: Improved read-only `papers:quality-audit` sample output so nonzero sample runs include duplicate OpenAlex, arXiv, and URL scholarly-link groups with the shared owner id, duplicate identifier value, count, and representative link rows. This makes the current duplicate scholarly-link launch blocker reviewable from the audit artifact before deciding whether to run the guarded suppression-audit apply. No paper-quality audit DB run, scholarly-link suppression apply, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 scholarly-link suppression dry-run sample sections: Improved `scholarly-links:suppression-audit` dry-run artifacts so sample output is split by planned action: dataset-like links to suppress, HTML-title rows with proposed cleaned titles, and duplicate scholarly-link groups with owner/value metadata, the kept link, and sampled suppressed rows. This keeps the guardrail dry-run reviewable before the existing `--confirm-scholarly-link-apply --max-apply` apply path. No scholarly-link suppression audit DB run, suppression apply, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 Beta data-quality phase diagnostics: Added `diagnostics.phaseDurationsMs`, `diagnostics.totalMeasuredDurationMs`, and `diagnostics.slowestPhase` to completed `beta:data-quality` scorecards. `beta:data-quality --progress` now also emits phase start/finish lines to stderr, and the scorecard's generated weekly/strict audit commands include that flag, giving operators evidence about which section is active if a slow scorecard run stalls before writing its JSON artifact. This preserves the existing parallel read-only audit behavior. No Beta data-quality DB run, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 Operator Board data-quality command handoff: Saved `beta:data-quality` artifacts now carry their generated recommended commands through `readDataQualityGateArtifact`, `deriveDataQualityGate`, and the admin Operator Board data-quality card. The surfaced recommendation preserves explicit `SCRAPER_ENV=beta` targeting and the `--progress` weekly/strict audit guidance, so operators can rerun the slow-scorecard-aware command from the admin surface without opening `/tmp/ylabs-beta-quality.json`. No Beta data-quality DB run, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 source-description profile URL identity guard: Tightened `visibilityRepairQueueService` so source-description repairs no longer attach or derive from mismatched lead person-profile URLs. Lead-member source URL collection and lead research-interest description candidates now require profile-like URLs to match the lead's name, preserving the existing name-matched official profile repair path while blocking wrong-person profile evidence on source-less legacy rows. No Beta repair apply, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 Beta repair partial-patch replay guard: Tightened `beta:repair-queue --apply-from` validation so `--include-blocked-patches` only replays blocked dry-run attempts that include a non-empty `patchSummary`. Repaired attempts remain eligible as before, but hand-edited or malformed blocked rows without visible patch evidence no longer become apply-positive record ids. No Beta repair apply, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 profile bio coverage faculty-URL classifier: Tightened the read-only `profiles:bio-coverage-audit` source bucket classifier so Yale department `/faculty/<person>` pages count with Yale people/faculty profile URLs, external `/faculty/<person>` pages count as other profile-like URLs, and non-person pages such as `/faculty-resources`, generic `/faculty`, and generic `/faculty-directory` stay in the no-official-profile bucket. This keeps the remaining professor bio source-acquisition queue classified by actual person-profile URL shape. No Beta audit DB run, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 visible-profile faculty-page backfill: Tightened `official-profile-pi-backfill --only visible-profile-bio-backfill` so already-linked public faculty users can use Yale department `/faculty/<person>` pages as official person-profile sources. Generic `/faculty` roster/list pages remain excluded by the existing person-slug guard. No visible-profile backfill run, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 visibility repair faculty-profile identity guard: Tightened `visibilityRepairQueueService` person-profile URL detection so exact Yale `/faculty/<person>` and `faculty-directory` URLs go through the same lead-name match guard as `/people/` and `/profile/` URLs. Mismatched faculty person pages can no longer feed source-description repairs while name-matched profile evidence remains eligible. No Beta repair apply, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 official profile bio chrome cleanup: Tightened official/public profile bio clipping so trailing `Last Updated` / `Updated` profile metadata is stripped and sentence clipping no longer stops at dangling honorific abbreviations such as `Dr.` or `Prof.`. This keeps stored official profile observations and presentation-only public bios from ending with page-maintenance chrome or title fragments. No visible-profile backfill run, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 source-description generic directory guard: Tightened `visibilityRepairQueueService` so generic listing URLs such as `/faculty-directory` and metadata-only URLs such as ORCID/NIH/NSF/OpenAlex/Crossref/DOI links are kept out of source-description source acquisition unless at least one description-eligible URL is present. Person-scoped `/faculty-directory/<name>` pages remain eligible through the person-profile guard. Generic roster or metadata provenance can remain visible as diagnostic context, but it no longer attaches `sourceUrls`, derives descriptions, or marks a source-less row repaired by itself. No Beta repair apply, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 public profile official-directory fallback: Public profile shaping now treats same-person Yale `/people/<name>`, `/faculty/<name>`, and `/faculty-directory/<name>` pages as official Yale profile evidence for presentation-only research-interest and research-area fallback bios. Generic roster endpoints remain excluded, and same-name contamination checks still suppress mismatched profiles. No raw `User.bio` rewrite, Beta repair apply, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 listing update trust-boundary hardening: Tightened `updateListing` so normal authenticated listing updates strip collaborator identity fields, owner identity fields, and research entity binding fields even if a future self-service caller bypasses the controller allowlist. Admin/seed `noAuth` update paths keep their broader payload behavior. No listing DB write, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 listing update state-boundary hardening: Tightened generic authenticated `updateListing` calls so self-service content updates also strip `confirmed` and `archived`; explicit archive/unarchive and user-confirmation helpers opt into those state fields, and admin/seed `noAuth` paths keep broad payload behavior. No listing DB write, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-05 official-profile lead-website selector typecheck repair: Fixed `officialProfilePiBackfillScraper` lead-direct website target selection so it initializes its per-entity URL map locally and returns from the already-loaded entity list instead of referencing source-URL-selector locals. This restores server typecheck without running any backfill, production write/copy, destructive action, irreversible migration, or data deletion.

2026-06-06 profile publication payload allowlist: Tightened `getPublications` so authenticated profile publication readers receive a public embedded-publication summary instead of raw legacy `User.publications` rows. The endpoint preserves the existing client-facing title/DOI/year/venue/citation/open-access/source shape and omits source evidence ids, owner/contact fields, confidence, archive state, raw scrape payloads, and other internal metadata. No DB write, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-06 research detail member payload allowlist: Tightened `getResearchGroupDetail` so public research detail members receive an allowlisted presentation summary instead of raw selected `User`/`FacultyMember` identity rows. The endpoint preserves name, netid, title, image, and primary department fields while omitting direct email, faculty identity ids, profile URL maps, secondary departments, scholarly ids, account flags, and raw scrape payloads. No DB write, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-06 pathway search contact redaction: Tightened pathway search payload normalization so Mongo-backed `/api/pathways/search` redacts direct email/phone text and drops `mailto:`/non-HTTP URLs from pathway labels, explanations, best-next-step text, active posted-opportunity summaries, evidence excerpts/source URLs, and public contact-route labels/rationale. The Meili pathway index builder now redacts top-level pathway and display text before indexing so optional Meili-backed search follows the same public contract. No DB write, Meili write/rebuild, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-06 saved program payload allowlist: Tightened account saved-program payloads so `/api/users/savedPrograms` and the legacy saved-fellowship response return allowlisted public program summaries instead of raw fellowship/program records. The responses preserve client-facing program metadata, application details, deadlines, eligibility, source label/URL, and official contact fields while omitting source keys/fingerprints, visibility override/review internals, archive/audit state, counters, and operator notes. No DB write, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-06 public program payload allowlist: Tightened public program and legacy fellowship browse/detail/view/favorite payloads so normal readers receive the shared allowlisted program summary instead of raw fellowship/program records. `/api/programs/search`, `/api/programs/:id`, `/api/programs/:id/view`, `/api/programs/:id/favorite`, `/api/fellowships/search`, `/api/fellowships/:id`, `/api/fellowships/:id/view`, and `/api/fellowships/:id/favorite` preserve client-facing program/application/deadline/eligibility/source/contact fields while omitting source keys/fingerprints, visibility override/review internals, archive/audit state, counters, and operator notes. Admin inspection paths keep broader service payloads where explicitly requested. No DB write, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-06 saved pathway funding-match contact redaction: Tightened saved pathway funding-match payloads so fellowship `contactOffice` text is redacted for direct email/phone strings before it appears in top-level match rows or nested application-cycle evidence. Raw fellowship `contactEmail` remains omitted from public cycle evidence, while public office/context text, source URLs, deadline state, application route evidence, and match rationale are preserved. No DB write, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-06 listing view payload allowlist: Tightened authenticated listing view tracking so `/api/listings/:id/view` returns the same allowlisted listing summary used by listing search/detail instead of the raw post-increment `Listing` document. The response preserves client-facing listing copy and metadata while omitting owner/collaborator emails and ids, creator ids, counters, audit/review flags, archive/confirmation state, and embeddings. No DB write, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-06 program source-verification timestamp omission: Tightened the shared public program mapper so program/fellowship browse, detail, view/favorite, and saved-program account payloads omit `sourceLastVerifiedAt` and `sourceLastChangedAt` along with source keys/fingerprints and review internals. The responses still preserve public source label/URL and client-facing application/contact/deadline fields. No DB write, production write/copy, destructive action, irreversible migration, or data deletion was run.

2026-06-06 listing reader error fallback: Tightened authenticated listing detail and view tracking handlers so unexpected service failures return fixed fallback messages instead of propagating raw internal error text through non-production error responses. Not-found errors still return 404 with their domain message, while generic listing detail/view failures return `Failed to fetch listing` and `Failed to update listing view count`. No DB write, production write/copy, destructive action, irreversible migration, or data deletion was run.
