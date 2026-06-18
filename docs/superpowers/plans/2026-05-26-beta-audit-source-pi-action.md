# Beta Source/PI/Action Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push Beta closer to launch-candidate quality by auditing and repairing remaining visibility blockers in this order: source/description, PI identity, then action evidence.

**Architecture:** Keep `studentVisibilityTier` as the release gate and `VisibilityReleaseQueueItem` as the work queue. Deterministic repairs may promote records only when source-backed evidence is strong enough; otherwise records remain queued with sharper reasons and samples for later operator or scraper work.

**Tech Stack:** Node 20, TypeScript, Mongoose/MongoDB Atlas Beta via `SCRAPER_ENV=beta`, Meilisearch rebuild scripts, Vitest, Graphify.

---

## Current Beta Baseline

Use these numbers as the starting point from the previous repair pass:

- Strict launch eligible: `1,317`
- Public visibility violations: `0`
- Remaining launch lanes:
  - `source_description`: `1,019`
  - `pi_identity`: `86`
  - `action_evidence`: `135`
  - `review_exception`: `1`
- `beta:data-quality` still warns on 6 source-health sources, 6 duplicate normalized names, 1 suspicious user email, and residual missing coverage.

## File Map

- Modify: `server/src/services/visibilityRepairQueueService.ts`
  - Deterministic repair logic for queue lanes.
- Modify: `server/src/services/__tests__/visibilityRepairQueueService.test.ts`
  - Focused tests for new repair/blocking behavior.
- Likely modify: `server/src/scripts/betaRepairQueue.ts`
  - Add audit output flags only if existing report JSON is not enough.
- Likely modify: `server/src/scripts/betaDataQualityCore.ts`
  - Add lane-specific sample summaries only if needed for durable audit output.
- Modify: `docs/tasks/priority-roadmap.md`
  - Fold final result and residual blockers into the single durable roadmap.
- Generated local artifacts only: `/tmp/ylabs-*.json`
  - Store command outputs here; do not commit.

## Guardrails

- Always run with `SCRAPER_ENV=beta` for Beta reads/writes.
- Do not promote records by generic outreach. Action evidence must be backed by an official route, source-backed profile, access signal, posted opportunity, or another concrete source.
- Do not attach PI identity from name similarity alone. Use exact official profile URL or another unambiguous source-backed identity bridge.
- Source/description repair must not copy bios, CV fragments, publication abstracts, navigation chrome, or appointment-only text into student-facing descriptions.
- Leave blocked records blocked when evidence is insufficient. The goal is better data quality, not a bigger number at any cost.

---

### Task 1: Rebuild the Source/Description Audit Dataset

**Files:**
- Read: `server/src/services/visibilityRepairQueueService.ts`
- Read: `server/src/utils/researchEntityDescriptionQuality.ts`
- Output: `/tmp/ylabs-source-description-lane-audit.json`

- [ ] **Step 1: Capture current source/description lane samples**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict > /tmp/ylabs-launch-before-source-audit.json
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=1000 > /tmp/ylabs-source-description-lane-audit.json
```

Expected:

- `launch:trust-contract` may exit non-zero because strict launch is not yet passing.
- `beta:repair-queue` exits `0`.
- The dry-run JSON reports `scanned`, `repaired`, `blocked`, and sample attempts.

- [ ] **Step 2: Summarize repairable vs blocked source records**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const read = (p) => {
  const s = fs.readFileSync(p, 'utf8');
  return JSON.parse(s.slice(s.indexOf('{')));
};
const report = read('/tmp/ylabs-source-description-lane-audit.json');
const repaired = report.attempts.filter((a) => a.applied);
const blocked = report.attempts.filter((a) => !a.applied);
console.log(JSON.stringify({
  scanned: report.scanned,
  repaired: report.repaired,
  blocked: report.blocked,
  repairedSummaryCounts: repaired.reduce((acc, a) => {
    for (const item of a.patchSummary || []) acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {}),
  blockedReasonCounts: blocked.reduce((acc, a) => {
    for (const item of a.remainingBlockers || []) acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {}),
  blockedSamples: blocked.slice(0, 20).map((a) => ({
    label: a.plan.label,
    recordId: a.plan.recordId,
    reasons: a.remainingBlockers,
    repairSource: a.repairSource,
  })),
}, null, 2));
NODE
```

Expected:

- A readable summary showing whether the next change should improve description extraction or leave records blocked.

- [ ] **Step 3: Decide whether code changes are justified**

Proceed to Task 2 only if dry-run samples show a repeatable source-backed pattern currently blocked, such as:

- Official profile `profile.overview` exists but is not considered.
- Lead profile research interests are useful but ignored.
- Existing full description is useful but card description is missing.
- Official source URL variants are present but not normalized.

Do not change code for:

- Missing source URLs.
- Appointment-only text.
- NIH/NSF grant abstracts that do not describe the Yale research home.
- Profile synthesis without source backing.

---

### Task 2: Implement Source/Description Repairs First

**Files:**
- Modify: `server/src/services/visibilityRepairQueueService.ts`
- Modify: `server/src/services/__tests__/visibilityRepairQueueService.test.ts`

- [ ] **Step 1: Add or update failing source/description tests**

Add tests only for patterns seen in Task 1. Use this structure:

```ts
it('repairs source description from a trusted source-backed field', async () => {
  const deps = {
    findOpenQueueItems: vi.fn().mockResolvedValue([
      queueItem({ blockerReasons: ['missing_description'] }),
    ]),
    updateQueueItem: vi.fn(),
    findResearchEntity: vi.fn().mockResolvedValue({
      _id: 'entity-1',
      profile: {
        overview:
          'The lab studies cell signaling, tissue repair, and translational disease mechanisms.',
      },
      websiteUrl: 'https://medicine.yale.edu/profile/example-faculty/',
      sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
    }),
    updateResearchEntity: vi.fn(),
    findResearchEntityMembers: vi.fn().mockResolvedValue([]),
    findProgram: vi.fn(),
    updateProgram: vi.fn(),
    runGate: vi.fn(),
  };

  const report = await runVisibilityRepairQueue(
    { mode: 'dry-run', collection: 'research', stage: 'source_description', limit: 1 },
    deps,
  );

  expect(report.attempts[0]).toMatchObject({
    applied: true,
    status: 'repaired',
    repairSource: 'https://medicine.yale.edu/profile/example-faculty/',
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
yarn --cwd server test src/services/__tests__/visibilityRepairQueueService.test.ts
```

Expected:

- The new test fails for the specific missing behavior.
- Existing tests should not be broadly failing.

- [ ] **Step 3: Implement the minimal repair logic**

Update `visibilityRepairQueueService.ts` only around source candidate generation, URL normalization, or short-description derivation. Preserve these constraints:

```ts
const sourceEligible = sourceUrls.length > 0;
if (!sourceEligible) {
  return { patch: {}, summary: [], repairSource: '' };
}
```

Use `assessResearchEntityDescriptionQuality` before writing any text:

```ts
const candidateQuality = assessResearchEntityDescriptionQuality({
  fullDescription: candidate.value,
  shortDescription: candidate.shortValue || candidate.value,
  sourceUrls,
  website: entity.website,
  websiteUrl: entity.websiteUrl,
});
if (!candidateQuality.full.isUseful) continue;
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
yarn --cwd server test src/services/__tests__/visibilityRepairQueueService.test.ts
npx tsc --noEmit -p server/tsconfig.json
```

Expected:

- Test file passes.
- Server typecheck exits `0`.

- [ ] **Step 5: Apply source/description repairs to Beta**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=apply --retry-blocked --limit=1000 > /tmp/ylabs-source-description-apply.json
SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=apply > /tmp/ylabs-gate-after-source-description.json
SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict > /tmp/ylabs-launch-after-source-description.json
```

Expected:

- Apply exits `0`.
- Gate exits `0`.
- Strict launch may still exit non-zero, but `publicVisibilityViolations` must remain `0`.

---

### Task 3: Audit PI Identity After Source/Description

**Files:**
- Read/modify: `server/src/services/visibilityRepairQueueService.ts`
- Read/modify: `server/src/services/__tests__/visibilityRepairQueueService.test.ts`
- Output: `/tmp/ylabs-pi-identity-lane-audit.json`

- [ ] **Step 1: Capture current PI lane**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=research --stage=pi_identity --mode=dry-run --retry-blocked --limit=250 > /tmp/ylabs-pi-identity-lane-audit.json
```

Expected:

- Dry-run exits `0`.
- `repaired` is non-zero only for exact official profile URL matches.

- [ ] **Step 2: Summarize blocked PI records**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const s = fs.readFileSync('/tmp/ylabs-pi-identity-lane-audit.json', 'utf8');
const report = JSON.parse(s.slice(s.indexOf('{')));
console.log(JSON.stringify({
  scanned: report.scanned,
  repaired: report.repaired,
  blocked: report.blocked,
  repairedSamples: report.attempts.filter((a) => a.applied).slice(0, 20).map((a) => ({
    label: a.plan.label,
    recordId: a.plan.recordId,
    source: a.repairSource,
  })),
  blockedSamples: report.attempts.filter((a) => !a.applied).slice(0, 30).map((a) => ({
    label: a.plan.label,
    recordId: a.plan.recordId,
    reasons: a.remainingBlockers,
    source: a.repairSource,
  })),
}, null, 2));
NODE
```

Expected:

- A list of exact-match repair candidates and blocked identity gaps.

- [ ] **Step 3: Add tests only for exact-match identity bridges**

If samples show new profile URL variants, add a failing test for the variant. Example:

```ts
it('matches Yale Medicine subspecialty profile URLs to canonical profile users', async () => {
  const deps = {
    findOpenQueueItems: vi.fn().mockResolvedValue([
      queueItem({ blockerReasons: ['missing_lead'] }),
    ]),
    updateQueueItem: vi.fn().mockResolvedValue(undefined),
    findResearchEntity: vi.fn().mockResolvedValue({
      _id: 'entity-1',
      websiteUrl: 'https://medicine.yale.edu/cancer/profile/example-faculty/',
      sourceUrls: ['https://medicine.yale.edu/cancer/profile/example-faculty/'],
    }),
    updateResearchEntity: vi.fn(),
    findUserByProfileUrl: vi.fn().mockResolvedValue({
      _id: 'user-1',
      profileUrls: { medicine: 'https://medicine.yale.edu/profile/example-faculty/' },
    }),
    upsertResearchEntityMember: vi.fn().mockResolvedValue(undefined),
    findProgram: vi.fn(),
    updateProgram: vi.fn(),
    runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
  };

  const report = await runVisibilityRepairQueue(
    { mode: 'apply', collection: 'research', stage: 'pi_identity', limit: 1 },
    deps,
  );

  expect(report.repaired).toBe(1);
  expect(deps.upsertResearchEntityMember).toHaveBeenCalledWith(
    'entity-1',
    'user-1',
    expect.objectContaining({ sourceName: 'visibility-repair-queue' }),
  );
});
```

- [ ] **Step 4: Keep non-exact matches blocked**

Add or preserve this negative test:

```ts
expect(deps.upsertResearchEntityMember).not.toHaveBeenCalled();
```

Use it when `findUserByProfileUrl` returns `null`, multiple matches, or only a name similarity.

- [ ] **Step 5: Apply PI repairs**

Run:

```bash
yarn --cwd server test src/services/__tests__/visibilityRepairQueueService.test.ts
npx tsc --noEmit -p server/tsconfig.json
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=research --stage=pi_identity --mode=apply --retry-blocked --limit=250 > /tmp/ylabs-pi-identity-apply.json
SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=apply > /tmp/ylabs-gate-after-pi-identity.json
SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict > /tmp/ylabs-launch-after-pi-identity.json
```

Expected:

- Exact matches repair.
- Non-exact matches remain blocked.
- Public visibility violations remain `0`.

---

### Task 4: Audit Action Evidence Last

**Files:**
- Modify: `server/src/services/visibilityRepairQueueService.ts`
- Modify: `server/src/services/__tests__/visibilityRepairQueueService.test.ts`
- Read: `server/src/models/researchAccessTypes.ts`
- Read: `server/src/services/studentVisibilityTier.ts`

- [ ] **Step 1: Capture action-evidence lane after source and PI fixes**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=research --stage=action_evidence --mode=dry-run --retry-blocked --limit=250 > /tmp/ylabs-action-evidence-lane-audit.json
```

Expected:

- Dry-run exits `0`.
- Repairs are limited to records with concrete source-backed next-step evidence.

- [ ] **Step 2: Summarize action candidates and blocked records**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const s = fs.readFileSync('/tmp/ylabs-action-evidence-lane-audit.json', 'utf8');
const report = JSON.parse(s.slice(s.indexOf('{')));
console.log(JSON.stringify({
  scanned: report.scanned,
  repaired: report.repaired,
  blocked: report.blocked,
  repairedSamples: report.attempts.filter((a) => a.applied).slice(0, 20).map((a) => ({
    label: a.plan.label,
    recordId: a.plan.recordId,
    source: a.repairSource,
    summary: a.patchSummary,
  })),
  blockedSamples: report.attempts.filter((a) => !a.applied).slice(0, 30).map((a) => ({
    label: a.plan.label,
    recordId: a.plan.recordId,
    reasons: a.remainingBlockers,
    source: a.repairSource,
  })),
}, null, 2));
NODE
```

Expected:

- A concrete list of action records that can be repaired without generic outreach.

- [ ] **Step 3: Add action repair tests for any new concrete route**

Only add new repair logic for one of these evidence types:

- Official application URL.
- Official lab/program contact instruction.
- Official faculty profile route on a source-backed, lead-attached record.
- Existing access signal or posted opportunity that failed to attach to the entity.

Use this negative assertion for unsupported cases:

```ts
expect(deps.upsertEntryPathway).not.toHaveBeenCalled();
expect(deps.upsertAccessSignal).not.toHaveBeenCalled();
expect(deps.upsertContactRoute).not.toHaveBeenCalled();
```

- [ ] **Step 4: Implement minimal action materialization**

For official faculty profile fallback, keep the conservative existing shape:

```ts
{
  pathwayType: 'EXPLORATORY_CONTACT',
  status: 'PLAUSIBLE',
  evidenceStrength: 'WEAK',
  signalType: 'REACH_OUT_PLAUSIBLE',
  confidence: 'LOW',
  contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
}
```

Do not create `POSTED_ROLE`, `ACTIVE`, `DIRECT`, or application routes unless the source explicitly supports them.

- [ ] **Step 5: Apply action repairs**

Run:

```bash
yarn --cwd server test src/services/__tests__/visibilityRepairQueueService.test.ts
npx tsc --noEmit -p server/tsconfig.json
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=research --stage=action_evidence --mode=apply --retry-blocked --limit=250 > /tmp/ylabs-action-evidence-apply.json
SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=apply > /tmp/ylabs-gate-after-action-evidence.json
SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict > /tmp/ylabs-launch-after-action-evidence.json
```

Expected:

- Repairs apply only for source-backed concrete next steps.
- Remaining action-only records stay blocked if no trusted route exists.
- Public visibility violations remain `0`.

---

### Task 5: Final Beta Audit and Search Sync

**Files:**
- Modify: `docs/tasks/priority-roadmap.md`
- Output: `/tmp/ylabs-beta-data-quality-final.json`
- Output: `/tmp/ylabs-source-health-final.json`
- Output: `/tmp/ylabs-research-quality-search-review-final.json`

- [ ] **Step 1: Rebuild search indexes after Beta writes**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server meili:rebuild-research-entities > /tmp/ylabs-meili-rebuild-research-entities-final.log
SCRAPER_ENV=beta yarn --cwd server meili:rebuild-pathways > /tmp/ylabs-meili-rebuild-pathways-final.log
```

Expected:

- Both commands exit `0`.
- Logs include indexed document counts.

- [ ] **Step 2: Run final quality audits**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality > /tmp/ylabs-beta-data-quality-final.json
SCRAPER_ENV=beta yarn --cwd server source:health > /tmp/ylabs-source-health-final.json
SCRAPER_ENV=beta yarn --cwd server research:quality-search-review > /tmp/ylabs-research-quality-search-review-final.json
SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict > /tmp/ylabs-launch-final.json
```

Expected:

- `beta:data-quality` may remain `warn`; it must have `errorCount: 0`.
- `launch:trust-contract` may remain non-zero until all lanes are cleared; `publicVisibilityViolations` must be `0`.

- [ ] **Step 3: Summarize final audit state**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const read = (p) => {
  const s = fs.readFileSync(p, 'utf8');
  return JSON.parse(s.slice(s.indexOf('{')));
};
const launch = read('/tmp/ylabs-launch-final.json');
const beta = read('/tmp/ylabs-beta-data-quality-final.json');
console.log(JSON.stringify({
  launchCounts: launch.counts,
  repairLanes: launch.repairLanes.map((lane) => ({
    stage: lane.stage,
    count: lane.count,
  })),
  betaSummary: beta.summary,
}, null, 2));
NODE
```

Expected:

- Clear before/after counts for final response and roadmap.

- [ ] **Step 4: Update durable roadmap**

Append one concise milestone to `docs/tasks/priority-roadmap.md` with:

- Final launch eligible count.
- Final remaining lane counts.
- Meili document counts.
- Remaining `beta:data-quality` warnings.
- Explicit note that blocked records are intentionally held for missing evidence.

- [ ] **Step 5: Refresh Graphify**

Run:

```bash
graphify update .
```

Expected:

- Graphify exits `0`.
- `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` update.

---

## Completion Criteria

- Source/description lane is audited first and any safe deterministic repairs are applied.
- PI identity lane is audited second; only exact official identity bridges are applied.
- Action evidence lane is audited third; only concrete source-backed next steps are materialized.
- `publicVisibilityViolations` remains `0` after every gate.
- Focused Vitest and server typecheck pass.
- Meili search indexes are rebuilt after Beta writes.
- Final audit outputs are saved under `/tmp`.
- `docs/tasks/priority-roadmap.md` records the final state and residual blockers.
- `graphify update .` has run after code/doc changes.

## Self-Review

- Spec coverage: The plan implements source/description first, PI identity second, action evidence third, followed by final audit/search sync/docs.
- Placeholder scan: No TBD placeholders remain; every task has exact commands and expected outcomes.
- Type consistency: The plan uses existing persisted enum values: `EXPLORATORY_CONTACT`, `PLAUSIBLE`, `WEAK`, `REACH_OUT_PLAUSIBLE`, `LOW`, and `OFFICIAL_ROUTE_PREFERRED`.
