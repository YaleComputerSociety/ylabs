# Priority Roadmap

Last updated: 2026-08-02

This is the single task source of truth for Yale Research.
Keep it operational and compact.
Temporary execution plans, worktree plans, screenshots, browser audit dumps, and long continuation logs should stay outside `docs/` unless the user explicitly asks to preserve them.

## How To Use

- Start with `Current Focus`, then work down the active queue.
- When work completes, record only stable outcomes and remaining work here.
- Put durable product direction in `docs/product-context.md`, model decisions in `docs/research-model.md`, architecture decisions in `docs/decisions.md`, and scraper procedure in the scraper docs.
- Keep Graphify output local and untracked, and run `yarn graphify:ensure` before broad architecture navigation.

## Priority Scale

- `P0`: Required before trusted student traffic.
- `P1`: Required before broader Beta traffic.
- `P2`: Production readiness, rollout depth, or post-Beta cleanup.
- `P3`: Later workflow expansion.

## Current Focus

The near-term work is completing the research-model refactor's Phase 0 exit without weakening launch hardening or product trust.
Keep runtime centered on canonical `ResearchEntity` infrastructure and avoid adding new models, services, or planning documents unless they replace larger surface area.

Active themes:

- Complete private Development review and capture the Beta and ProductionCopy inventory, identity-collision, search-baseline, query-cost, and rollback evidence required by the Phase 0 exit.
- After Phase 0 acceptance, validate Phase 1 coexistence and proceed through identity, publication, research/access, evidence, and compatibility cutovers in dependency order.
- Exercise the completed MongoDB research-search fallback in launch-like outage checks and retain private operational evidence.
- Decide and implement the logged-out read-only discovery posture for `/research`, `/research/:slug`, and `/about`.
- Validate configured-environment delivery across the completed client error boundary, server/client Sentry integrations, and claim-specific research journey analytics.
- Improve evidence trust: dedupe repeated evidence, distinguish synthesized fallback from observed access evidence, and show observed/freshness dates.
- Keep the operator gate flow compact and artifact-driven without committing transient reports.
- Reduce maintenance surface by deleting obsolete docs, screenshots, proposals, dead routes, dead indexes, and unused dependencies.
- Keep research coverage source-driven, remove faculty-authored submission surfaces, and repair missing professors through bounded targeted backfills.

## Completed Repository Foundations

These foundations are present in current Beta source and focused tests.
They do not claim configured private environments, delivered telemetry, outage exercises, or other operational acceptance.

| Priority | Repository foundation                                                                                                                                   | Source and test evidence                                                                                                                                                                                                                         | Remaining operational evidence                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Research discovery falls back from failed Meilisearch requests to a visibility-filtered, paginated MongoDB search and reports the response as degraded. | `server/src/services/researchGroupService.ts` preserves bounded filters, facets, pagination, and visibility in the MongoDB path; focused service tests exercise total failure, fallback matching, and bounded hybrid/sort degradation.           | Exercise a controlled launch-like outage against a configured environment and retain the private smoke and monitoring result.                                                    |
| P0       | The React root has a recovery error boundary, and client/server Sentry adapters support environment and release context.                                | `client/src/index.tsx`, `client/src/components/ErrorBoundary.tsx`, both error-tracking utilities, the server startup/global error paths, and their focused tests cover initialization, capture, recovery UI, request context, and startup flush. | Configure the deployment-owned Sentry settings and privately verify one client render error and one server route error arrive with the expected environment and release context. |

## Active Priority Queue

| Priority | Work                                                                             | Done When                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Complete research-model refactor Phase 0.                                        | Development, Beta, and ProductionCopy inventory, identity-collision, search-baseline, and query-cost evidence, collision-class owners and dispositions, the phase ownership map, and rollback evidence are reviewed under the [Phase 0 runbook](../research-model-refactor-phase0.md), and the [migration execution status](../research-model-refactor.md#migration-execution-status) records the accepted exit. |
| P0       | Remove repo-root scratch/PII/secrets exposure and strengthen the secret scanner. | Scratch credential/PII files are gone, ignored by pattern, any exposed keys are rotated, and the scanner catches representative high-entropy/Yalies-style tokens.                                                                                                                                                                                                                                                |
| P0       | Validate degraded research discovery operationally.                              | A controlled launch-like Meilisearch outage confirms that visible browse/search results, filters, facets, and pagination remain usable through the completed MongoDB fallback, and private monitoring evidence distinguishes degraded service from an honest empty result.                                                                                                                                       |
| P0       | Decide logged-out discovery.                                                     | Logged-out users can read public research/about pages, or `docs/decisions.md` records why Yale-only access is intentional for the current phase.                                                                                                                                                                                                                                                                 |
| P0       | Validate launch observability operationally.                                     | In configured private environments, one client render error and one server route error reach Sentry with expected release/environment context, the completed recovery UI is exercised, and claim-specific research journey events are confirmed without publishing payloads or environment evidence.                                                                                                             |
| P1       | Fix evidence trust UI.                                                           | Duplicate evidence chips are removed, synthesized access fallback is visually distinct from source-observed evidence, and evidence dates/freshness are visible.                                                                                                                                                                                                                                                  |
| P1       | Add a faculty/student correction loop.                                           | Detail pages offer a claim/correction/report path that feeds an admin review queue with authenticated reporter context.                                                                                                                                                                                                                                                                                          |
| P1       | Validate and enable trustworthy current research-home rosters.                   | The disabled-by-default official roster source passes its structural audit and attributable sampled-precision review, then only reviewed allowlist entries are enabled.                                                                                                                                                                                                                                          |
| P1       | Add URL-backed search state and evidence facets.                                 | Query and filters survive reload/share/back navigation, and facets use evidence/product-model concepts instead of legacy acceptance labels.                                                                                                                                                                                                                                                                      |
| P2       | Add a minimal E2E smoke in CI or scheduled Beta checks.                          | Browse -> search -> detail -> save is exercised outside manual-only scripts.                                                                                                                                                                                                                                                                                                                                     |
| P2       | Reduce frontend and API payload weight.                                          | Student routes are split out of the admin bundle path and browse cards use a smaller DTO.                                                                                                                                                                                                                                                                                                                        |
| P2       | Move gate scorecards off fixed `/tmp` paths.                                     | Operator Board scorecards survive deploys/restarts through a durable store or explicitly documented external artifact path.                                                                                                                                                                                                                                                                                      |
| P2       | Continue surface-area deletion.                                                  | Unused indexes, old listing-era paths, unused deps, and obsolete docs are removed when touched.                                                                                                                                                                                                                                                                                                                  |

## Operating Baseline

- Canonical product concepts are `ResearchEntity`, `EntryPathway`, `PostedOpportunity`, `AccessSignal`, and `ContactRoute`.
- Treat `ResearchGroup`, `lab`, and `researchGroupId` names as migration residue unless the file is explicitly legacy or rollback support.
- Beta is the staging gate.
- Production promotion requires a human-reviewed Atlas restore point, guarded copy dry-run, rollback posture, and production smoke result.
- Scraper and repair writes must be evidence-first, dry-run-first, and fail closed on contact data.
- Research homes and opportunities are source-discovered.
  Yale Research does not host faculty-authored submissions, while verified official application URLs remain outbound student actions.
- Bibliographic ingestion and publication-derived ranking are retired.
  Official Yale, Google Scholar, and ORCID profiles are outbound links under the accepted research-model boundary, and later cleanup remains gated by the migration execution status.
- Do not run production writes, production copies, destructive migrations, retention apply jobs, or data deletion without explicit user direction.

## Verification Commands

Use focused checks for the changed area.

```bash
yarn --cwd server test
yarn --cwd client test:ci
npx tsc --noEmit -p server/tsconfig.json
yarn build
```

Known caveat: client `tsc --noEmit` is not a clean CI gate unless the current task explicitly addresses that cleanup.
