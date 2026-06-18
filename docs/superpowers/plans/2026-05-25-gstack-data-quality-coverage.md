# GStack Data Quality Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn gstack into the repeatable data-quality/coverage iteration loop for Yale Research: source health -> blocker classification -> dry-run repair yield -> Playwright UX verification -> controlled apply.

**Architecture:** Keep `new-foundation` as the integration source of truth. Each implementation lane runs from its own worktree and writes read-only artifacts first; the main thread integrates only reviewed diffs back into `new-foundation`. The product rule is that more data only matters when it repairs a concrete blocker on a student-facing research home.

**Tech Stack:** TypeScript, Express/Mongoose, existing scraper CLI, existing quality scripts, Playwright MCP for UX verification, Graphify for repo memory, gstack worktree/subagent workflow.

---

## Coordination Rules

- Source of truth branch: `new-foundation`.
- Do not edit `/home/quntaoz/ylabs` while it is on `hallmark-audit-more`.
- Use `/home/quntaoz/.config/superpowers/worktrees/ylabs/new-foundation-merge` as the integration worktree unless the main thread creates more isolated worktrees.
- Each agent gets a separate branch/worktree named after its lane:
  - `gstack-source-conflict-lane`
  - `gstack-search-ux-lane`
  - `gstack-paper-activity-lane`
  - `gstack-operator-loop-lane`
- Main thread reviews every diff before merge. Do not auto-merge broad changes from agent branches.
- After code or durable-doc changes, run `graphify update .` from the integration worktree.

## Current Evidence Snapshot

Read-only checks from 2026-05-25:

```bash
yarn --cwd server source:health
yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality-current.json
yarn --cwd server papers:quality-audit --sample-limit=0
```

Observed:

- Source health: `18 ok`, `6 warn`, `0 error`.
- Warning sources: `lab-microsite-undergrad-llm`, `centers-institutes-index`, `dept-faculty-roster`, `ysm-atoz-index`, `nih-reporter`, `nsf-award-search`.
- Beta quality: warning state, no hard errors.
- Coverage gaps: `1131` missing short descriptions, `1270` without pathways, `1120` without access signals, `1933` without contact routes.
- Duplicate entity-name clusters: `6`.
- Suspicious dev user email: `test123@example.invalid`.
- Paper quality audit returned `0 active papers`, which should be treated as a target/filter sanity issue before claiming paper activity coverage is healthy.

## Files And Responsibilities

- `server/src/services/sourceHealthService.ts`: enrich source-health rows with conflict summary and operator lane metadata.
- `server/src/services/__tests__/sourceHealthService.test.ts`: focused tests for new conflict summaries.
- `server/src/scripts/researchQualitySearchReviewCore.ts`: keep golden-query warning semantics stable; only adjust if UX review needs explicit lab-page fields.
- `server/src/scripts/__tests__/researchQualitySearchReviewCore.test.ts`: tests for any new warning fields.
- `server/src/services/paperQualityService.ts`: distinguish "zero active papers" from "paper quality passed".
- `server/src/services/__tests__/paperQualityService.test.ts`: tests for zero-active-paper warning and normal pass/fail behavior.
- `server/src/services/adminOperatorBoardService.ts`: surface the next recommended gstack lane from existing quality outputs.
- `client/src/components/admin/AdminOperatorBoard.tsx`: only update if backend payload adds operator lane fields.
- `docs/research-data-pipeline.md`: stable operator loop and source-selection rules.
- `docs/tasks/priority-roadmap.md`: single task source of truth for completion notes and remaining blockers.

## Task 1: Create Clean Worktree Lanes

**Files:**
- No repo files modified.

- [ ] **Step 1: Confirm current checkout state**

Run from `/home/quntaoz/ylabs`:

```bash
git worktree list
git status --short --branch
```

Expected: `/home/quntaoz/ylabs` is on `hallmark-audit-more`; `new-foundation` exists at `/home/quntaoz/.config/superpowers/worktrees/ylabs/new-foundation-merge`.

- [ ] **Step 2: Create source-conflict worktree**

Run from `/home/quntaoz/.config/superpowers/worktrees/ylabs/new-foundation-merge`:

```bash
git worktree add /home/quntaoz/.config/superpowers/worktrees/ylabs/gstack-source-conflict-lane -b gstack-source-conflict-lane
```

Expected: new worktree exists on branch `gstack-source-conflict-lane`.

- [ ] **Step 3: Create search-UX worktree**

Run:

```bash
git worktree add /home/quntaoz/.config/superpowers/worktrees/ylabs/gstack-search-ux-lane -b gstack-search-ux-lane
```

Expected: new worktree exists on branch `gstack-search-ux-lane`.

- [ ] **Step 4: Create paper-activity worktree**

Run:

```bash
git worktree add /home/quntaoz/.config/superpowers/worktrees/ylabs/gstack-paper-activity-lane -b gstack-paper-activity-lane
```

Expected: new worktree exists on branch `gstack-paper-activity-lane`.

- [ ] **Step 5: Create operator-loop worktree**

Run:

```bash
git worktree add /home/quntaoz/.config/superpowers/worktrees/ylabs/gstack-operator-loop-lane -b gstack-operator-loop-lane
```

Expected: new worktree exists on branch `gstack-operator-loop-lane`.

## Task 2: Source Conflict Lane

**Goal:** Make the six warning sources actionable by classifying materialization conflicts instead of leaving the operator with "inspect conflicts".

**Files:**
- Modify: `server/src/services/sourceHealthService.ts`
- Test: `server/src/services/__tests__/sourceHealthService.test.ts`
- Docs: `docs/tasks/priority-roadmap.md`

- [ ] **Step 1: Write failing test for conflict lane metadata**

Add a test case to `server/src/services/__tests__/sourceHealthService.test.ts` that builds a source-health row from a latest run with materialization conflicts and expects:

```ts
expect(row.queueType).toBe('conflict-review');
expect(row.owner).toBe('scraper-source operator');
expect(row.nextCommand).toContain('source:health');
expect(row.action).toMatch(/materialization conflicts/i);
```

Run:

```bash
yarn --cwd server test src/services/__tests__/sourceHealthService.test.ts
```

Expected before implementation: FAIL because `queueType`, `owner`, or `nextCommand` is missing.

- [ ] **Step 2: Implement lane metadata**

In `server/src/services/sourceHealthService.ts`, extend warning rows so materialization conflicts include:

```ts
{
  queueType: 'conflict-review',
  owner: 'scraper-source operator',
  nextCommand: `yarn --cwd server source:health --include-samples --source=${source.name}`,
}
```

If `source:health` does not support `--include-samples` or `--source`, use the existing supported command:

```ts
nextCommand: 'yarn --cwd server source:health'
```

and add a test that matches the exact supported command.

- [ ] **Step 3: Verify source-health tests**

Run:

```bash
yarn --cwd server test src/services/__tests__/sourceHealthService.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run live read-only source health**

Run:

```bash
yarn --cwd server source:health
```

Expected: command exits `0`; six warning sources remain warnings unless source data changed, but each warning has clearer operator action.

- [ ] **Step 5: Commit source-conflict lane**

Run:

```bash
git add server/src/services/sourceHealthService.ts server/src/services/__tests__/sourceHealthService.test.ts docs/tasks/priority-roadmap.md
git commit -m "chore: classify source health conflict lanes"
```

## Task 3: Search And Lab UX Review Lane

**Goal:** Use gstack/Playwright to test whether top search results produce useful lab/research-home pages.

**Files:**
- Modify: `server/src/scripts/researchQualitySearchReviewCore.ts` only if warning fields are missing.
- Test: `server/src/scripts/__tests__/researchQualitySearchReviewCore.test.ts`
- Docs: `docs/research-data-pipeline.md`, `docs/tasks/priority-roadmap.md`

- [ ] **Step 1: Run current golden query review**

Run:

```bash
yarn --cwd server research:quality-search-review --output /tmp/ylabs-research-quality-current.json
```

Expected: JSON report with warning rows for golden queries. If local Meili is unavailable, record that as an environment blocker in the roadmap instead of changing code.

- [ ] **Step 2: Playwright MCP sample top pages**

Use Playwright MCP with local dev auth interception for `/api/check` only. Load at least these routes if they appear in quality/search samples:

```txt
http://localhost:3000/research/ysm-yachiho
http://localhost:3000/research/<top-warning-slug-1>
http://localhost:3000/research/<top-warning-slug-2>
```

For each page, capture:

```txt
title
h1/h2/h3 hierarchy
presence of "What this lab studies"
presence of PI/lead link
presence of research activity
presence of access/pathway/contact evidence
whether the page is hidden/not found
```

Write findings into `/tmp/ylabs-lab-ux-review-current.md`, not into repo docs yet.

- [ ] **Step 3: Add warning field only if needed**

If the report cannot identify the route slug, lead state, action evidence, or source domain, add the missing field to `ResearchQualitySearchReviewRow` in `server/src/scripts/researchQualitySearchReviewCore.ts`.

Test shape:

```ts
expect(row.facts.leadCount).toBe(0);
expect(row.facts.pathwayCount).toBe(0);
expect(row.sourceDomains).toEqual(['medicine.yale.edu']);
expect(row.warningCodes).toContain('THIN_PATHWAY_EVIDENCE');
```

Run:

```bash
yarn --cwd server test src/scripts/__tests__/researchQualitySearchReviewCore.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit search-UX lane**

Run:

```bash
git add server/src/scripts/researchQualitySearchReviewCore.ts server/src/scripts/__tests__/researchQualitySearchReviewCore.test.ts docs/research-data-pipeline.md docs/tasks/priority-roadmap.md
git commit -m "chore: tighten research quality search review"
```

If no code changes were needed, do not commit temporary `/tmp` artifacts.

## Task 4: Paper Activity Sanity Lane

**Goal:** Prevent `0 active papers` from being misread as a healthy research-activity pipeline.

**Files:**
- Modify: `server/src/services/paperQualityService.ts`
- Test: `server/src/services/__tests__/paperQualityService.test.ts`
- Docs: `docs/research-data-pipeline.md`, `docs/tasks/priority-roadmap.md`

- [ ] **Step 1: Write failing zero-active-paper test**

Add this test to `server/src/services/__tests__/paperQualityService.test.ts`:

```ts
it('flags zero active papers as a coverage warning instead of a launch-quality pass', () => {
  const report = buildPaperQualityReportFromCounts({
    totalActivePapers: 0,
    missingTitle: 0,
    genericTitle: 0,
    htmlTitle: 0,
    missingInspectableLink: 0,
    missingYearOrDate: 0,
    invalidYear: 0,
    negativeCitationCount: 0,
    missingSourceLabel: 0,
    duplicateDoiGroups: 0,
    duplicateOpenAlexGroups: 0,
    duplicateArxivGroups: 0,
    duplicateSemanticScholarGroups: 0,
  });

  expect(report.pass).toBe(false);
  expect(report.warning).toMatch(/zero active papers/i);
  expect(report.fixCommands).toContain('Verify paper materialization target DB and active-paper filter before relying on research activity.');
});
```

Run:

```bash
yarn --cwd server test src/services/__tests__/paperQualityService.test.ts
```

Expected before implementation: FAIL because zero active papers currently passes.

- [ ] **Step 2: Implement zero-active-paper warning**

In `buildPaperQualityReportFromCounts`, compute:

```ts
const zeroActivePaperCoverageGap = counts.totalActivePapers === 0;
const pass = total === 0 && !zeroActivePaperCoverageGap;
```

Add fix command:

```ts
if (zeroActivePaperCoverageGap) {
  fixCommands.push('Verify paper materialization target DB and active-paper filter before relying on research activity.');
}
```

Set warning:

```ts
warning: zeroActivePaperCoverageGap
  ? 'Zero active papers found; paper activity coverage may be missing or pointed at the wrong target.'
  : total > 0
    ? 'Paper quality launch blockers remain.'
    : '',
```

- [ ] **Step 3: Verify paper tests and live audit**

Run:

```bash
yarn --cwd server test src/services/__tests__/paperQualityService.test.ts
yarn --cwd server papers:quality-audit --sample-limit=0
```

Expected: test passes; live audit exits with non-pass warning if the current DB still has zero active papers.

- [ ] **Step 4: Commit paper-activity lane**

Run:

```bash
git add server/src/services/paperQualityService.ts server/src/services/__tests__/paperQualityService.test.ts docs/research-data-pipeline.md docs/tasks/priority-roadmap.md
git commit -m "fix: flag empty paper activity coverage"
```

## Task 5: Operator Loop Lane

**Goal:** Make the next gstack action visible from existing quality outputs.

**Files:**
- Modify: `server/src/services/adminOperatorBoardService.ts`
- Test: `server/src/services/__tests__/adminOperatorBoardService.test.ts`
- Modify if needed: `client/src/components/admin/AdminOperatorBoard.tsx`
- Test if client changes: `client/src/components/admin/__tests__/AdminOperatorBoard.test.tsx`

- [ ] **Step 1: Write backend test for recommended lane**

In `server/src/services/__tests__/adminOperatorBoardService.test.ts`, add a case where:

```ts
sourceRiskCounts.warn = 6;
pendingMeiliSync = false;
```

Expected action list includes:

```ts
expect(actions).toContain('Run bounded dry runs for warning sources before promotion.');
expect(actions).toContain('Run scraper integrity and data-quality gates before any production promotion.');
```

Run:

```bash
yarn --cwd server test src/services/__tests__/adminOperatorBoardService.test.ts
```

Expected: PASS if existing behavior already covers it; if not, FAIL before implementation.

- [ ] **Step 2: Add explicit gstack loop labels if missing**

If the operator board payload lacks a clear next lane, add a derived field:

```ts
gstackNextLane: {
  lane: 'source-conflict-review',
  command: 'yarn --cwd server source:health',
  rationale: 'Warning sources need materialization conflict review before broad writes.',
}
```

Only add this when source warnings are present. Keep the board read-only.

- [ ] **Step 3: Update client only if payload changes**

If `gstackNextLane` is added to the API payload, render it in `client/src/components/admin/AdminOperatorBoard.tsx` as a compact read-only row under existing next actions. Do not add worker buttons.

Test expectation:

```ts
expect(screen.getByText(/source-conflict-review/i)).toBeInTheDocument();
expect(screen.queryByRole('button', { name: /run/i })).not.toBeInTheDocument();
```

Run:

```bash
yarn --cwd client test:ci src/components/admin/__tests__/AdminOperatorBoard.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit operator-loop lane**

Run:

```bash
git add server/src/services/adminOperatorBoardService.ts server/src/services/__tests__/adminOperatorBoardService.test.ts client/src/components/admin/AdminOperatorBoard.tsx client/src/components/admin/__tests__/AdminOperatorBoard.test.tsx
git commit -m "chore: surface gstack data quality lane"
```

If no client files changed, omit them from `git add`.

## Task 6: Integration And Verification

**Goal:** Merge reviewed lanes into `new-foundation` without pulling unrelated work from active agents.

**Files:**
- Modify: `docs/tasks/priority-roadmap.md`
- Modify: `docs/research-data-pipeline.md`
- Modify: `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.json`

- [ ] **Step 1: Review each branch diff**

Run from integration worktree:

```bash
git fetch --all
git diff new-foundation..gstack-source-conflict-lane --stat
git diff new-foundation..gstack-search-ux-lane --stat
git diff new-foundation..gstack-paper-activity-lane --stat
git diff new-foundation..gstack-operator-loop-lane --stat
```

Expected: each diff touches only its lane files.

- [ ] **Step 2: Merge one lane at a time**

Run:

```bash
git merge --no-ff gstack-source-conflict-lane
git merge --no-ff gstack-paper-activity-lane
git merge --no-ff gstack-search-ux-lane
git merge --no-ff gstack-operator-loop-lane
```

Expected: no conflicts. If conflicts occur, stop and resolve by preserving `new-foundation` product rules.

- [ ] **Step 3: Run focused verification**

Run:

```bash
yarn --cwd server test src/services/__tests__/sourceHealthService.test.ts src/services/__tests__/paperQualityService.test.ts src/services/__tests__/adminOperatorBoardService.test.ts src/scripts/__tests__/researchQualitySearchReviewCore.test.ts
npx tsc --noEmit -p server/tsconfig.json --pretty false
yarn --cwd server source:health
yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality-after-gstack-loop.json
yarn --cwd server papers:quality-audit --sample-limit=0
git diff --check
```

Expected: tests and typecheck pass. Read-only quality gates may still return warnings, but warnings should be classified into concrete lanes.

- [ ] **Step 4: Run Playwright MCP UX spot-check**

Use Playwright MCP dev auth interception for `/api/check` only. Check:

```txt
http://localhost:3000/research/ysm-yachiho
```

Expected:

```txt
title: Ya-Chi Ho Lab | Yale Research
page is research-home-first
PI/profile links are secondary deep-dives
missing research activity/access evidence is visible as a quality gap, not hidden by fake copy
```

- [ ] **Step 5: Update durable docs**

In `docs/tasks/priority-roadmap.md`, add a completed note with:

```txt
2026-05-25: Added the gstack data-quality loop: source conflict lanes, search/UX review, paper-activity sanity, and operator-board next-lane guidance. Current quality warnings remain data repair work, not code regressions.
```

In `docs/research-data-pipeline.md`, ensure the operator loop is stated as:

```txt
source health -> data quality -> dry-run repair yield -> Playwright UX verification -> controlled apply
```

- [ ] **Step 6: Refresh Graphify**

Run:

```bash
graphify update .
```

Expected: `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` update.

- [ ] **Step 7: Final status**

Run:

```bash
git status --short --branch
```

Expected: only intentional files modified or a clean committed integration branch.

## Agent Handoff Prompts

Use these prompts when dispatching agents:

```txt
You are in the gstack-source-conflict-lane worktree. Implement Task 2 from docs/superpowers/plans/2026-05-25-gstack-data-quality-coverage.md only. Do not edit client files. Run the focused test and source:health before reporting back.
```

```txt
You are in the gstack-search-ux-lane worktree. Implement Task 3 from docs/superpowers/plans/2026-05-25-gstack-data-quality-coverage.md only. Use Playwright MCP for dev-mode lab page evidence. Keep artifacts in /tmp unless durable docs need stable conclusions.
```

```txt
You are in the gstack-paper-activity-lane worktree. Implement Task 4 from docs/superpowers/plans/2026-05-25-gstack-data-quality-coverage.md only. Focus on making zero active papers a coverage warning. Run the focused paper quality test and audit.
```

```txt
You are in the gstack-operator-loop-lane worktree. Implement Task 5 from docs/superpowers/plans/2026-05-25-gstack-data-quality-coverage.md only. Keep the Operator Board read-only. Do not add worker buttons.
```

## Acceptance Criteria

- Source warnings are classified into concrete gstack lanes.
- Zero active papers is no longer treated as a clean research-activity pass.
- Golden-query UX review is repeatable and tied to lab detail page evidence.
- Operator Board remains read-only but points to the next quality lane.
- No branch merges into `new-foundation` without main-thread diff review.
- Final verification includes focused tests, server typecheck, read-only quality gates, Playwright MCP spot-check, `git diff --check`, and `graphify update .`.
