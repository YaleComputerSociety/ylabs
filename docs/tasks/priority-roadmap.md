# Priority Roadmap

Last updated: 2026-07-15

This is the single task source of truth for Yale Research.
Keep it operational and compact.
Temporary execution plans, worktree plans, screenshots, browser audit dumps, and long continuation logs should stay outside `docs/` unless the user explicitly asks to preserve them.

## How To Use

- Start with `Current Focus`, then work down the active queue.
- When work completes, record only stable outcomes and remaining work here.
- Put durable product direction in `docs/product-context.md`, model decisions in `docs/research-model.md`, architecture decisions in `docs/decisions.md`, and scraper procedure in the scraper docs.
- Refresh Graphify only in dedicated scheduled or manual maintenance after groups of Beta merges, not in feature PRs.

## Priority Scale

- `P0`: Required before trusted student traffic.
- `P1`: Required before broader Beta traffic.
- `P2`: Production readiness, rollout depth, or post-Beta cleanup.
- `P3`: Later workflow expansion.

## Current Focus

The near-term work is launch hardening and product trust.
Keep runtime centered on canonical `ResearchEntity` infrastructure and avoid adding new models, services, or planning documents unless they replace larger surface area.

Active themes:

- Make public research discovery reliable when Meilisearch or hybrid search is degraded.
- Decide and implement the logged-out read-only discovery posture for `/research`, `/research/:slug`, and `/about`.
- Validate launch observability across the client error boundary, server/client error tracking, and claim-specific research journey analytics.
- Improve evidence trust: dedupe repeated evidence, distinguish synthesized fallback from observed access evidence, and show observed/freshness dates.
- Keep the operator gate flow compact and artifact-driven without committing transient reports.
- Reduce maintenance surface by deleting obsolete docs, screenshots, proposals, dead routes, dead indexes, and unused dependencies.

## Active Priority Queue

| Priority | Work                                                                             | Done When                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Remove repo-root scratch/PII/secrets exposure and strengthen the secret scanner. | Scratch credential/PII files are gone, ignored by pattern, any exposed keys are rotated, and the scanner catches representative high-entropy/Yalies-style tokens. |
| P0       | Make `/research` degrade instead of failing closed on Meilisearch/hybrid errors. | Killing or misconfiguring Meilisearch locally leaves browse/search usable through a degraded path or shows an honest failure state, not "no matches."             |
| P0       | Decide logged-out discovery.                                                     | Logged-out users can read public research/about pages, or `docs/decisions.md` records why Yale-only access is intentional for the current phase.                  |
| P0       | Add error tracking and a top-level React error boundary.                         | A client render error and a server route error are captured with release/environment context, and the SPA shows a recovery UI instead of a white screen.          |
| P1       | Fix evidence trust UI.                                                           | Duplicate evidence chips are removed, synthesized access fallback is visually distinct from source-observed evidence, and evidence dates/freshness are visible.   |
| P1       | Add a faculty/student correction loop.                                           | Detail pages offer a claim/correction/report path that feeds an admin review queue with authenticated reporter context.                                           |
| P1       | Add URL-backed search state and evidence facets.                                 | Query and filters survive reload/share/back navigation, and facets use evidence/product-model concepts instead of legacy acceptance labels.                       |
| P2       | Add a minimal E2E smoke in CI or scheduled Beta checks.                          | Browse -> search -> detail -> save is exercised outside manual-only scripts.                                                                                      |
| P2       | Reduce frontend and API payload weight.                                          | Student routes are split out of the admin bundle path and browse cards use a smaller DTO.                                                                         |
| P2       | Move gate scorecards off fixed `/tmp` paths.                                     | Operator Board scorecards survive deploys/restarts through a durable store or explicitly documented external artifact path.                                       |
| P2       | Continue surface-area deletion.                                                  | Unused indexes, old listing-era paths, unused deps, and obsolete docs are removed when touched.                                                                   |

## Operating Baseline

- Canonical product concepts are `ResearchEntity`, `EntryPathway`, `PostedOpportunity`, `AccessSignal`, and `ContactRoute`.
- Treat `ResearchGroup`, `lab`, and `researchGroupId` names as migration residue unless the file is explicitly legacy or rollback support.
- Beta is the staging gate.
- Production promotion requires a human-reviewed Atlas restore point, guarded copy dry-run, rollback posture, and production smoke result.
- Scraper and repair writes must be evidence-first, dry-run-first, and fail closed on contact data.
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
