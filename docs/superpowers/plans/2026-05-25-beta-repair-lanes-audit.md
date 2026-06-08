# Beta Repair Lanes Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the highest-impact Beta launch-candidate repair lanes in order: source/description, PI identity, then action evidence.

**Architecture:** Keep `student-visibility:gate` as the source of truth for queue state and `launch:trust-contract` as the launch gate. Extend `visibilityRepairQueueService` only where deterministic, source-backed repairs can be proven; use scrapers/materializers for PI identity and action evidence instead of manual one-off database edits.

**Tech Stack:** TypeScript, Mongoose, MongoDB Atlas Beta, Meilisearch, Vitest, existing scraper/materializer pipeline.

---

## Current Baseline

Latest Beta audit:

- `student_ready`: 448
- `limited_but_safe`: 394
- held: 1,716
- suppressed: 51
- public visibility violations: 0
- repair lanes:
  - source/description: 1,696
  - PI identity: 100
  - action evidence: 292
  - review exceptions: 22
- research activity quality: pass
- scholarly link display quality: pass
- `beta:data-quality`: zero errors, seven warnings

Do not copy Beta to production until this plan either clears or explicitly accepts the remaining repair lanes.

## Files

- Modify: `server/src/services/visibilityRepairQueueService.ts`
  - Add deterministic source/description repair inputs beyond current `description`/`fullDescription` fallback.
  - Add stage-specific audit summaries so blocked items explain why no repair was possible.
- Modify: `server/src/services/__tests__/visibilityRepairQueueService.test.ts`
  - Cover new deterministic source/description repairs and blocked summaries.
- Modify: `server/src/services/researchEntityQuality.ts`
  - Only if the audit proves the quality classifier is too strict or misclassifies known-good official descriptions.
- Modify: `server/src/services/__tests__/researchEntityQuality.test.ts`
  - Cover any classifier adjustment.
- Modify: `server/src/scrapers/entityMaterializer.ts`
  - Add missing PI/member materialization from official observations if evidence exists but is not creating `research_entity_members`.
- Modify: `server/src/scrapers/__tests__/entityMaterializer.test.ts`
  - Cover official PI/member materialization.
- Modify: `server/src/services/studentVisibilityGateService.ts`
  - Only if queue classification needs a tighter repair stage after source/PI/action fixes.
- Modify: `server/src/services/__tests__/studentVisibilityGateService.test.ts`
  - Cover any queue-stage classifier change.
- Modify: `server/src/scripts/betaRepairQueue.ts`
  - Add optional report-output support if needed for repeatable before/after lane diffs.
- Modify: `docs/tasks/priority-roadmap.md`
  - Record accepted audit deltas and remaining blockers after each lane.

## Task 1: Snapshot And Freeze The Beta Queue Baseline

**Files:**
- Read: `server/src/services/visibilityRepairQueueService.ts`
- Read: `server/src/services/launchTrustContractService.ts`
- Modify: `docs/tasks/priority-roadmap.md`

- [ ] **Step 1: Capture the current launch contract JSON**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict > /tmp/ylabs-launch-trust-before.json
```

Expected: command exits non-zero while strict lanes remain. Confirm JSON still contains `publicVisibilityViolations: 0`.

- [ ] **Step 2: Capture queue item samples by stage**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --limit=250 > /tmp/ylabs-source-description-before.json
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=pi_identity --mode=dry-run --limit=250 > /tmp/ylabs-pi-identity-before.json
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=action_evidence --mode=dry-run --limit=250 > /tmp/ylabs-action-evidence-before.json
```

Expected: source/description has many `blocked` attempts; PI/action plans are `safeToAttempt: false` until deterministic materializers are added.

- [ ] **Step 3: Record only durable numbers in the roadmap**

Add a concise line to `docs/tasks/priority-roadmap.md` under P2 data-quality operations:

```markdown
- [ ] Continue Beta repair-lane closeout from `/tmp/ylabs-launch-trust-before.json`: source/description first, then PI identity, then action evidence. Public visibility violations are zero; remaining work is launch completeness.
```

- [ ] **Step 4: Verify no code changes yet**

Run:

```bash
git diff -- docs/tasks/priority-roadmap.md
```

Expected: only the roadmap line changed.

## Task 2: Expand Deterministic Source/Description Repair

**Files:**
- Modify: `server/src/services/visibilityRepairQueueService.ts`
- Modify: `server/src/services/__tests__/visibilityRepairQueueService.test.ts`

- [ ] **Step 1: Add a failing test for deriving copy from official profile fields**

In `server/src/services/__tests__/visibilityRepairQueueService.test.ts`, add:

```ts
it('repairs source description from source-backed profile fields', async () => {
  const deps = buildDeps({
    researchEntity: {
      _id: 'entity-1',
      name: 'Source Backed Lab',
      profile: {
        overview: 'This lab studies how students learn from official archival and field evidence across disciplines.',
      },
      websiteUrl: 'https://official.yale.edu/lab',
      sourceUrls: ['https://official.yale.edu/lab'],
    },
  });

  const report = await runVisibilityRepairQueue(
    {
      mode: 'dry-run',
      collection: 'research',
      stage: 'source_description',
      limit: 1,
    },
    deps,
  );

  expect(report.attempts[0]).toMatchObject({
    applied: true,
    status: 'repaired',
    patchSummary: expect.arrayContaining([
      'copied useful source-backed profile text into fullDescription',
    ]),
    repairSource: 'https://official.yale.edu/lab',
  });
});
```

If the local test helper is named differently, reuse the existing dependency-stub pattern already in the file.

- [ ] **Step 2: Run the failing test**

Run:

```bash
yarn --cwd server test src/services/__tests__/visibilityRepairQueueService.test.ts
```

Expected: the new test fails because `buildResearchSourceDescriptionPatch` does not inspect `profile.overview` yet.

- [ ] **Step 3: Implement deterministic text candidates**

In `server/src/services/visibilityRepairQueueService.ts`, add helpers near `textValue`:

```ts
const sourceBackedTextCandidates = (entity: Record<string, any>): Array<{ value: string; label: string }> => {
  const profile = entity.profile && typeof entity.profile === 'object' ? entity.profile : {};
  return [
    { value: textValue(entity.description), label: 'description' },
    { value: textValue(entity.fullDescription), label: 'fullDescription' },
    { value: textValue(profile.overview), label: 'profile text' },
    { value: textValue(profile.bio), label: 'profile bio' },
    { value: textValue(entity.bio), label: 'bio' },
  ].filter((candidate) => candidate.value.length > 0);
};
```

Then replace the duplicated `description`/`fullDescription` blocks in `buildResearchSourceDescriptionPatch` with a loop:

```ts
for (const candidate of sourceBackedTextCandidates(entity)) {
  if (!sourceEligible) continue;
  const candidateQuality = assessResearchEntityDescriptionQuality({
    fullDescription: candidate.value,
    shortDescription: candidate.value,
    sourceUrls,
    website: entity.website,
    websiteUrl: entity.websiteUrl,
  });
  const currentQuality = assessResearchEntityDescriptionQuality({
    fullDescription: patch.fullDescription || entity.fullDescription,
    shortDescription: patch.shortDescription || entity.shortDescription,
    sourceUrls,
    website: entity.website,
    websiteUrl: entity.websiteUrl,
  });

  if (candidateQuality.full.isUseful && !currentQuality.full.isUseful) {
    patch.fullDescription = candidate.value;
    summary.push(`copied useful source-backed ${candidate.label} into fullDescription`);
  }

  if (candidateQuality.full.isUseful && !currentQuality.short.isUseful) {
    const derivedShortDescription = deriveShortDescriptionFromFullDescription(candidate.value);
    if (derivedShortDescription) {
      patch.shortDescription = derivedShortDescription;
      summary.push(`derived shortDescription from source-backed ${candidate.label}`);
    }
  }
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
yarn --cwd server test src/services/__tests__/visibilityRepairQueueService.test.ts
```

Expected: visibility repair queue tests pass.

- [ ] **Step 5: Apply the source/description lane in bounded batches**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=apply --limit=250 > /tmp/ylabs-source-description-apply-1.json
SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=apply
```

Expected: repaired count is higher than the previous `3/100`; public visibility violations remain zero.

- [ ] **Step 6: Rebuild search indexes after successful repairs**

Run:

```bash
yarn --cwd server meili:rebuild-research-entities --clear
yarn --cwd server meili:rebuild-pathways --clear
```

Expected: both rebuilds exit 0.

## Task 3: PI Identity Repair From Official Evidence

**Files:**
- Modify: `server/src/scrapers/entityMaterializer.ts`
- Modify: `server/src/scrapers/__tests__/entityMaterializer.test.ts`
- Modify: `server/src/services/visibilityRepairQueueService.ts` only if a deterministic PI queue repair can be safely added after materializer support.

- [ ] **Step 1: Audit PI lane samples for evidence shape**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=research --stage=pi_identity --mode=dry-run --limit=100 > /tmp/ylabs-pi-identity-samples.json
```

Expected: samples show records blocked by `missing_lead` or `pi_identity_conflict`.

- [ ] **Step 2: Query matching official observations for PI samples**

Run a read-only Mongo query against 20 sample ids from `/tmp/ylabs-pi-identity-samples.json`:

```bash
node -e 'require("dotenv").config({path:"server/.env"}); process.env.MONGOSH_LOG_PATH="/tmp"; const ids=["REPLACE_WITH_SAMPLE_ID"]; const evalCode=`db.sourceobservations.find({"resolved.researchEntityId":{$in:ids}},{sourceName:1,sourceUrl:1,"payload.pi":1,"payload.lead":1,"payload.people":1,"payload.inferredPiUserId":1,resolved:1}).limit(50).toArray()`; require("child_process").spawnSync("mongosh",[process.env.MONGODBURL,"--quiet","--eval",evalCode],{stdio:"inherit",env:process.env});'
```

Expected: identify whether official observations already contain PI fields that the materializer is not turning into `research_entity_members`.

- [ ] **Step 3: Add a failing materializer test**

In `server/src/scrapers/__tests__/entityMaterializer.test.ts`, add a case shaped like the real observation found in Step 2:

```ts
it('materializes an official inferred PI into a research entity PI member', async () => {
  const observation = observationFixture({
    sourceName: 'ysm-atoz-index',
    artifactType: 'ResearchEntity',
    resolved: {
      researchEntityId: entityId,
      inferredPiUserId: userId,
    },
    payload: {
      name: 'Example Lab',
      sourceUrl: 'https://medicine.yale.edu/lab/example/',
    },
  });

  await materializeObservation(observation);

  expect(await ResearchGroupMember.findOne({
    researchEntityId: entityId,
    userId,
    role: 'PI',
  }).lean()).toMatchObject({
    sourceName: 'ysm-atoz-index',
  });
});
```

Use the existing fixture names in that test file; keep the assertion on canonical `research_entity_members`.

- [ ] **Step 4: Run the failing materializer test**

Run:

```bash
yarn --cwd server test src/scrapers/__tests__/entityMaterializer.test.ts
```

Expected: the new case fails because the materializer does not create the PI member for that observation shape.

- [ ] **Step 5: Implement official PI member materialization**

In `server/src/scrapers/entityMaterializer.ts`, route official `resolved.inferredPiUserId` or equivalent payload lead fields into the existing member upsert path. The patch must require:

```ts
const hasOfficialSource = /^https:\/\/[^/]*yale\.edu\//i.test(sourceUrl);
const hasResolvedEntity = Boolean(resolved.researchEntityId);
const hasResolvedUser = Boolean(resolved.inferredPiUserId || payload.inferredPiUserId);
```

Only upsert a PI member when all three are true.

- [ ] **Step 6: Run the materializer tests and the PI gate**

Run:

```bash
yarn --cwd server test src/scrapers/__tests__/entityMaterializer.test.ts
SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=research --mode=apply
SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict > /tmp/ylabs-launch-after-pi.json
```

Expected: strict launch may still fail, but the `pi_identity` lane count decreases and public visibility violations remain zero.

## Task 4: Action Evidence Repair Through Pathway/Contact/Access Materialization

**Files:**
- Modify: `server/src/scrapers/entityMaterializer.ts`
- Modify: `server/src/scrapers/__tests__/entityMaterializer.test.ts`
- Modify: `server/src/services/visibilityRepairQueueService.ts` only for reporting, not blind action-evidence writes.

- [ ] **Step 1: Audit action evidence samples**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=research --stage=action_evidence --mode=dry-run --limit=150 > /tmp/ylabs-action-evidence-samples.json
```

Expected: samples are records that have source-backed descriptions but lack entry pathways, access signals, contact routes, or posted opportunities.

- [ ] **Step 2: Check whether official observations contain access/contact evidence**

Run a read-only query against sampled ids:

```bash
node -e 'require("dotenv").config({path:"server/.env"}); process.env.MONGOSH_LOG_PATH="/tmp"; const ids=["REPLACE_WITH_SAMPLE_ID"]; const evalCode=`db.sourceobservations.find({"resolved.researchEntityId":{$in:ids}},{sourceName:1,sourceUrl:1,artifactType:1,"payload.undergrad":1,"payload.contact":1,"payload.applicationUrl":1,"payload.accessSignals":1,"payload.entryPathways":1,resolved:1}).limit(100).toArray()`; require("child_process").spawnSync("mongosh",[process.env.MONGODBURL,"--quiet","--eval",evalCode],{stdio:"inherit",env:process.env});'
```

Expected: separate records into:

- official evidence exists but not materialized
- no action evidence exists; needs scraper enrichment
- non-undergraduate or stale; candidate for suppression/review exception

- [ ] **Step 3: Add failing materializer tests for official action evidence**

Add tests for the actual evidence shape found in Step 2:

```ts
it('materializes official undergraduate access evidence into pathway, signal, and contact route', async () => {
  const observation = observationFixture({
    sourceName: 'lab-microsite-undergrad-llm',
    artifactType: 'AccessSignal',
    resolved: { researchEntityId: entityId },
    sourceUrl: 'https://official.yale.edu/lab/undergraduate-research',
    payload: {
      undergraduateRelevant: true,
      contactUrl: 'https://official.yale.edu/lab/contact',
      nextStep: 'Review the lab research page and contact the lab manager listed there.',
    },
  });

  await materializeObservation(observation);

  expect(await EntryPathway.countDocuments({ researchEntityId: entityId })).toBeGreaterThan(0);
  expect(await AccessSignal.countDocuments({ researchEntityId: entityId })).toBeGreaterThan(0);
  expect(await ContactRoute.countDocuments({ researchEntityId: entityId })).toBeGreaterThan(0);
});
```

Use existing model imports and fixtures from the test file.

- [ ] **Step 4: Implement only source-backed materialization**

In `server/src/scrapers/entityMaterializer.ts`, materialize action evidence only when:

```ts
const officialSourceUrl = typeof observation.sourceUrl === 'string' && /^https:\/\/[^/]*yale\.edu\//i.test(observation.sourceUrl);
const undergraduateRelevant = payload.undergraduateRelevant === true || payload.undergrad === true;
const hasConcreteRoute = Boolean(payload.contactUrl || payload.applicationUrl || payload.nextStep);
```

If any condition fails, leave the queue item blocked for scraper enrichment; do not fabricate generic outreach.

- [ ] **Step 5: Run tests and apply gate**

Run:

```bash
yarn --cwd server test src/scrapers/__tests__/entityMaterializer.test.ts
SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=research --mode=apply
```

Expected: action-evidence lane count decreases only where official route evidence exists.

## Task 5: Suppression And Review Exception Hygiene

**Files:**
- Modify: `docs/tasks/priority-roadmap.md`
- Modify: `server/src/services/visibilityRepairQueueService.ts` only if suppressible reasons are missing from the allowlist.

- [ ] **Step 1: Dry-run suppressible non-launch records**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=suppression --suppress-unsafe --mode=dry-run --limit=250 > /tmp/ylabs-suppression-dry-run.json
```

Expected: only `archive_review`, `content_page_risk`, `inactive_at_yale`, or `not_undergraduate_relevant` records are suppressible.

- [ ] **Step 2: Apply only if the dry-run contains no launch candidates**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --stage=suppression --suppress-unsafe --mode=apply --limit=250
SCRAPER_ENV=beta yarn --cwd server student-visibility:gate --collection=all --mode=apply
```

Expected: suppressed count may rise; public visibility violations stay zero.

- [ ] **Step 3: Leave review exceptions as explicit queue, not manual audit drift**

Record the remaining `review_exception` count in `docs/tasks/priority-roadmap.md` with this rule:

```markdown
Review exceptions are accepted only when they are hidden from launch or have a named source-backed reason; they are not production blockers if public visibility violations remain zero and the exception record is non-public.
```

## Task 6: Final Beta Repair Lane Verification

**Files:**
- Modify: `docs/tasks/priority-roadmap.md`
- Generated/updated by command: `graphify-out/GRAPH_REPORT.md`
- Generated/updated by command: `graphify-out/graph.json`

- [ ] **Step 1: Run final strict launch trust contract**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict > /tmp/ylabs-launch-trust-after.json
```

Expected: either pass, or fail only with documented residual repair lanes. It must have `publicVisibilityViolations: 0`, `researchActivity.pass: true`, and `paperQuality.pass: true`.

- [ ] **Step 2: Run data-quality and search-quality audits**

Run:

```bash
SCRAPER_ENV=beta yarn --cwd server beta:data-quality --include-samples > /tmp/ylabs-beta-data-quality-after.json
SCRAPER_ENV=beta yarn --cwd server research:quality-search-review --include-samples > /tmp/ylabs-research-quality-search-after.json
SCRAPER_ENV=beta yarn --cwd server source:health > /tmp/ylabs-source-health-after.json
```

Expected: `beta:data-quality` remains zero-error; source health has no `error`; search review has no `searchErrors`.

- [ ] **Step 3: Rebuild Meili**

Run:

```bash
yarn --cwd server meili:rebuild-research-entities --clear
yarn --cwd server meili:rebuild-pathways --clear
```

Expected: both commands exit 0 and report indexed document counts.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
yarn --cwd server test src/services/__tests__/visibilityRepairQueueService.test.ts src/scrapers/__tests__/entityMaterializer.test.ts
npx tsc --noEmit -p server/tsconfig.json
```

Expected: tests pass and server typecheck exits 0.

- [ ] **Step 5: Update durable docs**

In `docs/tasks/priority-roadmap.md`, add the final counts:

```markdown
- [x] Completed the Beta repair-lane audit pass. Source/description, PI identity, and action-evidence lanes were reduced through source-backed repairs only. Remaining launch blockers, if any, are explicitly typed queue records and not public visibility violations.
```

- [ ] **Step 6: Refresh Graphify**

Run:

```bash
graphify update .
```

Expected: graph updates successfully.

## Parallelization

Run these in separate worktrees when implementing:

1. Source/description lane:
   - Owns `visibilityRepairQueueService.ts` and its tests.
   - Can run immediately.
2. PI identity lane:
   - Owns `entityMaterializer.ts` PI/member behavior and tests.
   - Can run after Task 1 samples are captured.
3. Action evidence lane:
   - Owns materializer pathway/access/contact behavior and tests.
   - Can run in parallel with PI if it touches different test cases carefully.
4. Verification/docs lane:
   - Owns audit command runs, roadmap updates, Meili rebuild, and Graphify refresh.
   - Runs after code lanes land.

The main thread must integrate diffs, resolve conflicts, and run Task 6 before reporting completion.

## Acceptance Criteria

- Public visibility violations remain `0`.
- `beta:data-quality` has zero errors.
- Research activity and paper quality remain passing.
- Source/description lane count drops materially or blocked records explain the missing source evidence.
- PI identity lane count drops where official PI evidence exists; unresolved records remain hidden.
- Action evidence lane count drops only when official undergraduate access/contact/application evidence exists.
- No generic, unsourced outreach/pathway/contact data is fabricated.
- Meili indexes are rebuilt after successful Beta data changes.
- `docs/tasks/priority-roadmap.md` records final counts and remaining explicit blockers.
