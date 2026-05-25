# GStack Production Promotion Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current read-only production-gate dry run into an operator-ready production promotion package with clear lane selection, repaired blockers, Meili readiness, and smoke evidence.

**Architecture:** Work from `new-foundation` in isolated worktrees. Use parallel agents for independent discovery and fixes, then have the main Codex thread integrate only reviewed diffs back into `new-foundation`. Keep all production actions read-only until the operator explicitly approves a copy lane or guarded production delta.

**Tech Stack:** Git worktrees, GStack skills, Graphify, Express/TypeScript server, React/Vite client, MongoDB Atlas, Meilisearch, Vitest, Playwright.

---

## Branch And Worktree Setup

Base branch: `new-foundation` at or after commit `1321937`.

Create one integration worktree and four agent worktrees:

- Integration: `~/.config/superpowers/worktrees/ylabs/new-foundation-prod-promo`
- Agent A: `~/.config/superpowers/worktrees/ylabs/prod-promo-data-repair`
- Agent B: `~/.config/superpowers/worktrees/ylabs/prod-promo-meili`
- Agent C: `~/.config/superpowers/worktrees/ylabs/prod-promo-smoke`
- Agent D: `~/.config/superpowers/worktrees/ylabs/prod-promo-operator-runbook`

Use the existing global worktree location. Do not create nested worktrees from `/home/quntaoz/ylabs`, because that checkout is on `hallmark-audit-more` and may be dirty.

Baseline in every worktree:

```bash
git status --short
npx tsc --noEmit -p server/tsconfig.json --pretty false
yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts src/routes/__tests__/adminRoutes.test.ts
```

Expected: clean status before edits, typecheck passes, focused tests pass.

---

## Agent A: Data Repair And Gate Classification

**Owner:** Data-quality agent  
**Worktree:** `prod-promo-data-repair`  
**Goal:** Turn warning-only gate output into a prioritized operator queue, with safe repair scripts only where the fix is deterministic.

**Files:**
- Modify: `server/src/scripts/betaDataQualityCore.ts`
- Modify: `server/src/scripts/__tests__/betaDataQualityCore.test.ts`
- Modify: `server/src/scrapers/integrityGate.ts`
- Modify: `server/src/scripts/__tests__/dedupeUsersByIdentityCore.test.ts`
- Modify: `docs/tasks/priority-roadmap.md`

- [ ] Re-run read-only gates with local env loaded from `/home/quntaoz/ylabs/server/.env` without printing secrets.

```bash
node -e "require('dotenv').config({path:'/home/quntaoz/ylabs/server/.env'}); const cp=require('child_process').spawnSync('yarn',['--cwd','server','beta:data-quality','--include-samples'],{stdio:'inherit',env:process.env}); process.exit(cp.status ?? 1);"
node -e "require('dotenv').config({path:'/home/quntaoz/ylabs/server/.env'}); const cp=require('child_process').spawnSync('yarn',['--cwd','server','scraper:integrity-gate','--include-samples'],{stdio:'inherit',env:process.env}); process.exit(cp.status ?? 1);"
```

Expected: `beta:data-quality` stays `warn` with `errorCount: 0`; scraper integrity stays `pass`.

- [ ] Classify each current warning as `must_fix_before_promotion`, `accepted_release_warning`, or `post_promotion_backlog`.

Current known warnings to classify:

```txt
sourceHealthWarnings: 12
duplicateEntityNames: 269
missingShortDescriptions: 2858
weakShortDescriptions: 11
coverageWithoutPathways: 1825
coverageWithoutAccessSignals: 1981
coverageWithoutContactRoutes: 3056
suspiciousUserEmails: 4
duplicatePersonIdentityConflicts: 1329
```

- [ ] Add or adjust tests so the gate output exposes classification metadata and recommended next commands.

Run:

```bash
yarn --cwd server test src/scripts/__tests__/betaDataQualityCore.test.ts src/scripts/__tests__/dedupeUsersByIdentityCore.test.ts
```

- [ ] Update `docs/tasks/priority-roadmap.md` with the classification table and exact follow-up owner for each warning.

- [ ] Commit in the agent worktree.

```bash
git add server/src/scripts/betaDataQualityCore.ts server/src/scripts/__tests__/betaDataQualityCore.test.ts server/src/scrapers/integrityGate.ts server/src/scripts/__tests__/dedupeUsersByIdentityCore.test.ts docs/tasks/priority-roadmap.md
git commit -m "Classify production data-quality warnings"
```

---

## Agent B: Meili Rebuild And Search Parity Gate

**Owner:** Search/API agent  
**Worktree:** `prod-promo-meili`  
**Goal:** Prove the new `entityStudentVisibilityTier` pathway index field is populated and that Mongo/Meili pathway results remain safe.

**Files:**
- Modify: `server/src/services/pathwaySearchIndexService.ts`
- Modify: `server/src/services/__tests__/pathwaySearchIndexService.test.ts`
- Modify: `server/src/scripts/pathwayRelevanceReview.ts` if present
- Modify: `docs/scraper-deployment-runbook.md`
- Modify: `docs/tasks/priority-roadmap.md`

- [ ] Inspect the existing Meili rebuild and relevance review commands.

```bash
rg -n "meili:rebuild-pathways|pathway:relevance-review|PATHWAY_SEARCH_BACKEND|entityStudentVisibilityTier" server package.json docs
```

- [ ] Add a focused test that fails if `buildPathwaySearchIndexDocument()` omits `entityStudentVisibilityTier` for public entities.

Run:

```bash
yarn --cwd server test src/services/__tests__/pathwaySearchIndexService.test.ts
```

- [ ] Run a read-only search parity review against the safe local/staging env when Meili env vars are available.

```bash
node -e "require('dotenv').config({path:'/home/quntaoz/ylabs/server/.env'}); const cp=require('child_process').spawnSync('yarn',['--cwd','server','pathway:relevance-review'],{stdio:'inherit',env:process.env}); process.exit(cp.status ?? 1);"
```

Expected: no public result contains `operator_review` or `suppressed`; if Meili is unavailable, record the exact missing env/service blocker.

- [ ] Document that production Meili must be rebuilt after promotion before enabling `PATHWAY_SEARCH_BACKEND=meili`.

- [ ] Commit in the agent worktree.

```bash
git add server/src/services/pathwaySearchIndexService.ts server/src/services/__tests__/pathwaySearchIndexService.test.ts docs/scraper-deployment-runbook.md docs/tasks/priority-roadmap.md
git commit -m "Verify pathway Meili visibility gate"
```

---

## Agent C: Live UI And API Smoke Gate

**Owner:** UI smoke agent  
**Worktree:** `prod-promo-smoke`  
**Goal:** Replace mocked UI-only confidence with a repeatable smoke script that can run against local, staging, or production read-only APIs.

**Files:**
- Create: `tmp/ui-smoke/production-promotion-smoke.mjs` for local ignored artifact only, or promote to `client/scripts/productionPromotionSmoke.mjs` if reusable.
- Modify: `docs/scraper-deployment-runbook.md`
- Modify: `docs/tasks/priority-roadmap.md`

- [ ] Start client and server only against safe non-production env. Do not write scraper data.

```bash
yarn dev:server
VITE_APP_SERVER=http://localhost:4000 yarn --cwd client dev --host 127.0.0.1
```

- [ ] Smoke these routes with Playwright or the GStack browse skill:

```txt
/research
/research/:known-public-slug
/pathways
/opportunities/:known-public-id
/programs
/admin/operator-board
/account
```

- [ ] Assert student routes do not display these internal labels:

```txt
operator_review
suppressed
studentVisibilityTier
Operator Board
```

- [ ] Assert admin routes require auth and the Operator Board renders only for admin/dev-admin state.

- [ ] Save screenshots and a JSON report under ignored `tmp/ui-smoke/`.

- [ ] Commit only reusable script/docs changes. Do not commit screenshots unless explicitly requested.

```bash
git add docs/scraper-deployment-runbook.md docs/tasks/priority-roadmap.md
git commit -m "Document production promotion smoke gate"
```

---

## Agent D: Operator Decision Packet And Rollback Drill

**Owner:** Runbook/operator agent  
**Worktree:** `prod-promo-operator-runbook`  
**Goal:** Produce the final go/no-go packet for choosing Lane A accepted Beta copy or Lane B guarded production delta.

**Files:**
- Modify: `docs/scraper-deployment-runbook.md`
- Modify: `docs/research-data-pipeline.md`
- Modify: `docs/tasks/priority-roadmap.md`
- Modify: `docs/decisions.md` only if a lane decision is actually made.

- [ ] Create a checklist section in the runbook for the operator to fill before production:

```txt
Promotion lane:
Atlas backup / restore point:
Rollback owner:
Smoke owner:
Meili backend before gate:
Meili backend after gate:
Accepted warnings:
Run IDs:
Rollback tested:
```

- [ ] Define the dry-run rollback drill for both lanes:

```txt
Lane A rollback drill: identify backup, identify collections restored, identify Meili rebuild command.
Lane B rollback drill: disable source, stop additional source runs, restore pre-run backup if broad materialization is bad, set PATHWAY_SEARCH_BACKEND=mongo.
```

- [ ] Add a source-specific cron acceptance matrix for the first recurring jobs:

```txt
ysm-atoz-index
department-undergrad-research
yale-college-fellowships-office
lab-microsite-undergrad-llm
openalex
arxiv
```

- [ ] Commit docs-only changes.

```bash
git add docs/scraper-deployment-runbook.md docs/research-data-pipeline.md docs/tasks/priority-roadmap.md docs/decisions.md
git commit -m "Prepare production promotion operator packet"
```

---

## Main Integration Thread

**Owner:** Lead Codex thread  
**Worktree:** `new-foundation-prod-promo`  
**Goal:** Review, integrate, verify, and merge agent outputs back to `new-foundation`.

- [ ] Wait for all four agents and inspect their diffs.

```bash
git diff new-foundation..prod-promo-data-repair --stat
git diff new-foundation..prod-promo-meili --stat
git diff new-foundation..prod-promo-smoke --stat
git diff new-foundation..prod-promo-operator-runbook --stat
```

- [ ] Cherry-pick or manually apply only reviewed commits. Prefer manual application for overlapping docs.

- [ ] Run final focused verification.

```bash
npx tsc --noEmit -p server/tsconfig.json --pretty false
yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts src/routes/__tests__/adminRoutes.test.ts src/services/__tests__/pathwaySearchIndexService.test.ts src/scripts/__tests__/betaDataQualityCore.test.ts src/scripts/__tests__/dedupeUsersByIdentityCore.test.ts src/scrapers/__tests__/sourceCoverageRegistry.test.ts
yarn --cwd client test:ci src/components/__tests__/Navbar.test.tsx src/__tests__/AppRouting.test.tsx src/components/admin/__tests__/AdminOperatorBoard.test.tsx src/pages/__tests__/fellowships.test.tsx
git diff --check
```

- [ ] Run read-only DB-backed gates one final time.

```bash
node -e "require('dotenv').config({path:'/home/quntaoz/ylabs/server/.env'}); const cp=require('child_process').spawnSync('yarn',['--cwd','server','source:health'],{stdio:'inherit',env:process.env}); process.exit(cp.status ?? 1);"
node -e "require('dotenv').config({path:'/home/quntaoz/ylabs/server/.env'}); const cp=require('child_process').spawnSync('yarn',['--cwd','server','scraper:integrity-gate','--include-samples'],{stdio:'inherit',env:process.env}); process.exit(cp.status ?? 1);"
node -e "require('dotenv').config({path:'/home/quntaoz/ylabs/server/.env'}); const cp=require('child_process').spawnSync('yarn',['--cwd','server','beta:data-quality','--include-samples'],{stdio:'inherit',env:process.env}); process.exit(cp.status ?? 1);"
```

- [ ] Refresh Graphify after code/docs changes.

```bash
graphify update .
git restore graphify-out/graph.html
```

- [ ] Commit the integrated result on `new-foundation`.

```bash
git add docs server client graphify-out
git commit -m "Prepare production promotion gate"
```

---

## Go / No-Go Criteria

Go only if:

- Server typecheck passes.
- Focused server and client tests pass.
- `source:health` has `0 error`.
- `scraper:integrity-gate` status is `pass`.
- `beta:data-quality` has `errorCount: 0`.
- Every warning is classified in the roadmap as accepted, must-fix, or backlog.
- Production lane, backup identifier, rollback owner, smoke owner, and Meili backend posture are recorded.

No-go if:

- Any gate has hard errors.
- `yale-college-fellowships-office` still has a stale running run with no operator explanation.
- Public smoke exposes `operator_review`, `suppressed`, private contacts, or admin-only routes.
- Production Meili cannot be rebuilt and the plan does not explicitly keep `PATHWAY_SEARCH_BACKEND=mongo`.

---

## Self-Review

Spec coverage: The plan covers worktree isolation, parallel agents, data gates, Meili/search, UI smoke, operator runbook, final integration, verification, docs, and Graphify refresh.

Placeholder scan: No `TBD` or unspecified implementation placeholders remain. Each agent has exact files, commands, expected outcomes, and commit scope.

Type consistency: The plan uses existing command names and model language from `new-foundation` after commit `1321937`, including `ResearchEntity`, `EntryPathway`, `AccessSignal`, `ContactRoute`, `PostedOpportunity`, `studentVisibilityTier`, and `entityStudentVisibilityTier`.
