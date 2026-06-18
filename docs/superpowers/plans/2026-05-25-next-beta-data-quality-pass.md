# Next Beta Data Quality Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the next Beta launch-candidate data-quality pass, clear deterministic hygiene issues, re-run automatic repair/gating, rebuild search, and leave a truthful readiness report for remaining blockers.

**Architecture:** Treat Beta as the launch-candidate dataset, not a throwaway staging copy. The pass is evidence-first: repair only deterministic, source-backed issues automatically; keep PI identity, source-description, action-evidence, suppression, and exception gaps queued when confidence is insufficient. Search indexes and docs must reflect the exact Beta state after writes.

**Tech Stack:** Yarn, TypeScript/tsx, Express/Mongoose, MongoDB Atlas Beta, Meilisearch, Vitest, Graphify.

---

## File Structure

- Modify: `docs/tasks/priority-roadmap.md`
  - Record stable Beta audit outcomes, remaining launch blockers, and explicit next data-quality work.
- No source changes expected unless verification exposes a code/test mismatch.
  - If code changes are required, add focused tests beside the touched service/script.
- Generated/local artifacts:
  - Do not commit `.audit/`, `.gstack/`, `.superpowers/`, or ad hoc audit output unless explicitly requested.
  - If a command needs persisted JSON, write it under `/tmp/ylabs-*.json`.

---

### Task 1: Confirm Target And Baseline State

**Files:**
- Read: `server/.env`
- Read: `docs/tasks/priority-roadmap.md`

- [ ] **Step 1: Confirm `.env` targets Beta without printing secrets**

Run:

```bash
grep -n '^MONGODBURL\|^SCRAPER_ENV\|^CONFIRM_PROD_SCRAPE' server/.env | sed 's/=.*/=<redacted>/'
```

Expected: `MONGODBURL=<redacted>` is present and the target audit commands later report `yalelabs0.ilyce1q.mongodb.net/Beta`.

- [ ] **Step 2: Run the strict Beta quality baseline**

Run:

```bash
yarn --cwd server beta:data-quality --include-samples --strict
```

Expected:
- Exit can be non-zero if hard errors remain.
- Capture `errorCount`, `warnCount`, and warning names.
- Any `emailSyntax`, `suspiciousUserEmails`, broken references, or invalid URL/email samples become first-priority deterministic repair candidates.

- [ ] **Step 3: Run the student visibility baseline**

Run:

```bash
yarn --cwd server student-visibility:gate --mode=dry-run --collection=all
```

Expected:
- Report includes `promoted`, `held`, `resolved`, `reasonCounts`, and `blockerCounts`.
- No writes occur in dry-run mode.

- [ ] **Step 4: Run the launch trust contract baseline**

Run:

```bash
yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict
```

Expected:
- Exit may be non-zero until launch blockers are cleared.
- Save the repair lane counts: `source_description`, `pi_identity`, `action_evidence`, `suppression`, and `review_exception`.
- Treat `limited_but_safe` as not launch-grade for this strict mode.

---

### Task 2: Repair Deterministic Identity Hygiene

**Files:**
- No code changes expected.

- [ ] **Step 1: Inspect any invalid or suspicious users before changing data**

For a sampled suspicious/invalid user id, run:

```bash
yarn --cwd server tsx -e 'import dotenv from "dotenv"; import mongoose from "mongoose"; import { initializeConnections } from "./src/db/connections"; import { User } from "./src/models/user"; (async()=>{ dotenv.config({ path: ".env" }); await initializeConnections(); const id=process.argv[1]; const user=await User.findById(id).select("netid email fname lname userType createdAt updatedAt").lean(); console.log(JSON.stringify({ db: mongoose.connection.name, user }, null, 2)); await mongoose.disconnect(); })().catch(async e=>{ console.error(e); await mongoose.disconnect().catch(()=>{}); process.exit(1); });' USER_ID_HERE
```

Expected:
- The command reports `db: "Beta"`.
- Decide whether the user is real and needs field repair, or synthetic/unreferenced and should be removed.

- [ ] **Step 2: Check references before deleting a synthetic user**

Run with the same id:

```bash
yarn --cwd server tsx -e 'import dotenv from "dotenv"; import mongoose from "mongoose"; import { initializeConnections } from "./src/db/connections"; import { User } from "./src/models/user"; import { Listing } from "./src/models/listing"; import { ResearchEntity } from "./src/models/researchEntity"; import { EntryPathway } from "./src/models/entryPathway"; import { AccessSignal } from "./src/models/accessSignal"; import { ContactRoute } from "./src/models/contactRoute"; (async()=>{ dotenv.config({ path: ".env" }); await initializeConnections(); const id=process.argv[1]; const counts={ listingsCreated: await Listing.countDocuments({ createdByUserId:id }), listingsOwner: await Listing.countDocuments({ ownerId:id }), researchClaimed: await ResearchEntity.countDocuments({ claimedByUserId:id }), researchReviewed: await ResearchEntity.countDocuments({ studentVisibilityReviewedByUserId:id }), pathwaysReviewed: await EntryPathway.countDocuments({ "review.reviewedByUserId":id }), signalsReviewed: await AccessSignal.countDocuments({ "review.reviewedByUserId":id }), contactsPerson: await ContactRoute.countDocuments({ personId:id }), contactsReviewed: await ContactRoute.countDocuments({ "review.reviewedByUserId":id }) }; const user=await User.findById(id).select("netid email fname lname userType createdAt updatedAt").lean(); console.log(JSON.stringify({ db: mongoose.connection.name, user, counts }, null, 2)); await mongoose.disconnect(); })().catch(async e=>{ console.error(e); await mongoose.disconnect().catch(()=>{}); process.exit(1); });' USER_ID_HERE
```

Expected:
- Delete only if all counts are `0` and the record is clearly synthetic.
- If referenced, repair fields instead of deleting.

- [ ] **Step 3: Delete a synthetic unreferenced user with a narrow predicate**

Run only after Step 2 proves it is unreferenced:

```bash
yarn --cwd server tsx -e 'import dotenv from "dotenv"; import mongoose from "mongoose"; import { initializeConnections } from "./src/db/connections"; import { User } from "./src/models/user"; (async()=>{ dotenv.config({ path: ".env" }); await initializeConnections(); const id=process.argv[1]; const before=await User.findById(id).select("netid email fname lname userType").lean(); if (!before) throw new Error("user not found"); const result=await User.deleteOne({ _id: id, netid: before.netid, email: before.email }); const after=await User.findById(id).lean(); console.log(JSON.stringify({ db: mongoose.connection.name, before, deletedCount: result.deletedCount, afterExists: !!after }, null, 2)); await mongoose.disconnect(); })().catch(async e=>{ console.error(e); await mongoose.disconnect().catch(()=>{}); process.exit(1); });' USER_ID_HERE
```

Expected:
- `deletedCount: 1`
- `afterExists: false`

---

### Task 3: Run Automatic Source-Description Repair

**Files:**
- No code changes expected.

- [ ] **Step 1: Apply the deterministic source-description lane**

Run:

```bash
yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=apply
```

Expected:
- Report includes `scanned`, `attempted`, `repaired`, `blocked`, and `resolvedByGate`.
- Only deterministic source-backed repairs are applied.
- Blocked records should remain queued with `remainingBlockers` and `nextRepairAction`.

- [ ] **Step 2: Interpret the repair result honestly**

Expected:
- If many records block, do not force-generate descriptions.
- Record that the root issue is source-depth, source URL, or profile-fallback quality, not simply missing materialization.

---

### Task 4: Re-Gate Public Visibility

**Files:**
- No code changes expected.

- [ ] **Step 1: Apply the visibility gate**

Run:

```bash
yarn --cwd server student-visibility:gate --mode=apply --collection=all
```

Expected:
- Records with launch-safe evidence move to `student_ready` or accepted public-safe tier.
- Records missing lead/source/action evidence remain hidden as `operator_review` or suppressed.

- [ ] **Step 2: Re-run the strict launch contract**

Run:

```bash
yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict
```

Expected:
- It may still fail.
- Remaining lanes become the next work queue.
- If `publicVisibilityViolations` remain, do not claim production readiness.

---

### Task 5: Rebuild Local Search From Beta

**Files:**
- No code changes expected.

- [ ] **Step 1: Rebuild ResearchEntity Meili**

Run:

```bash
yarn --cwd server meili:rebuild-research-entities
```

Expected:
- Output includes `indexName: "researchentities"` and the indexed document count.

- [ ] **Step 2: Rebuild Pathways Meili**

Run:

```bash
yarn --cwd server meili:rebuild-pathways
```

Expected:
- Output includes `indexName: "pathways"` and the indexed document count.

- [ ] **Step 3: Smoke local API/client availability**

Run:

```bash
curl -sS http://localhost:4000/api/config >/tmp/ylabs-config-smoke.json
curl -I http://localhost:3000/profile/tl324
```

Expected:
- Server config returns JSON.
- Client route returns `HTTP/1.1 200 OK`.

---

### Task 6: Audit PI Profile And Research Activity Quality

**Files:**
- No code changes expected unless the profile service regresses.

- [ ] **Step 1: Inspect `tl324` profile service output directly**

Run:

```bash
yarn --cwd server tsx -e 'import dotenv from "dotenv"; import mongoose from "mongoose"; import { initializeConnections } from "./src/db/connections"; import { getProfileByNetid } from "./src/services/profileService"; (async()=>{ dotenv.config({ path: ".env" }); await initializeConnections(); const p:any=await getProfileByNetid("tl324", false); console.log(JSON.stringify({ db: mongoose.connection.name, netid:p?.netid, name:[p?.fname,p?.lname].filter(Boolean).join(" "), image_url:p?.image_url, bio:p?.bio, researchInterestCount:p?.researchInterests?.length||0, researchInterests:p?.researchInterests, researchActivityCount:p?.researchActivity?.length||0, profileLinks:p?.profileLinks }, null, 2)); await mongoose.disconnect(); })().catch(async e=>{ console.error(e); await mongoose.disconnect().catch(()=>{}); process.exit(1); });'
```

Expected:
- `db` is `Beta`.
- `image_url` is present and official.
- `bio` is real prose, not placeholder text.
- `researchActivityCount` may remain `0`; this is a data gap if Beta has no identity-backed paper rows.

- [ ] **Step 2: Confirm research activity proof counts**

Run:

```bash
yarn --cwd server papers:authorship-audit --sample-limit=0
yarn --cwd server papers:quality-audit --sample-limit=0
```

Expected:
- Audits pass if there are zero bad rows.
- If counts are all zero, record that research activity is absent, not launch-complete.

- [ ] **Step 3: Probe OpenAlex for `tl324` without writing name-only authorship**

Run:

```bash
yarn --cwd server scrape run --source openalex --dry-run --only tl324 --discover-openalex-authors --max-openalex-pages-per-author 1
```

Expected:
- If output says `review-only OpenAlex author candidate`, do not attach papers automatically.
- Queue accepted identity work instead: ORCID crosswalk, accepted OpenAlex id review, or profile publication extraction.

---

### Task 7: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Re-run strict data-quality audit**

Run:

```bash
yarn --cwd server beta:data-quality --include-samples --strict
```

Expected:
- Exit `0` if hard errors are cleared.
- Remaining warnings should be launch-quality warnings with owners and next commands.

- [ ] **Step 2: Run focused service tests**

Run:

```bash
yarn --cwd server test src/services/__tests__/profileService.test.ts src/services/__tests__/studentVisibilityTier.test.ts src/services/__tests__/visibilityRepairQueueService.test.ts src/services/__tests__/researchEntityQuality.test.ts src/scrapers/__tests__/departmentRosterScraper.test.ts src/services/__tests__/paperQualityService.test.ts src/services/__tests__/launchTrustContractService.test.ts
```

Expected:
- All listed tests pass.

- [ ] **Step 3: Run server typecheck**

Run:

```bash
npx tsc --noEmit -p server/tsconfig.json
```

Expected:
- Exit `0`.

---

### Task 8: Update Durable Docs And Graphify

**Files:**
- Modify: `docs/tasks/priority-roadmap.md`
- Modify generated: `graphify-out/GRAPH_REPORT.md`
- Modify generated: `graphify-out/graph.json`

- [ ] **Step 1: Add the Beta pass outcome to the roadmap**

Add a concise bullet under `P2: Admin and Data-Quality Operations`:

```markdown
- [x] Run the Beta launch-candidate repair/gate pass after the PI/profile audit. A synthetic unreferenced test user was removed from Beta, clearing email syntax and suspicious-user hygiene errors. `beta:repair-queue --stage=source_description --mode=apply` repaired deterministic source-description items and blocked rows where official source evidence still lacked usable research descriptions. `student-visibility:gate --mode=apply --collection=all` was re-run, local Meili was rebuilt from Beta, and strict `beta:data-quality` now has zero errors. Remaining warnings are source-health conflicts, duplicate-name clusters, missing/weak descriptions, and pathway/access/contact coverage gaps.
```

Add the unresolved PI research-activity gap:

```markdown
- [ ] Add identity-backed humanities/profile publication extraction before treating PI research activity as launch-complete. The audited profile has official image and bio data, but research activity remains empty when Beta has no `papers`/`paper_authors`; name-only OpenAlex candidates must remain review-only until accepted identity proof exists.
```

- [ ] **Step 2: Refresh Graphify**

Run:

```bash
graphify update .
```

Expected:
- `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` update.
- If graph HTML is skipped because the graph is too large, that is acceptable.

- [ ] **Step 3: Final status check**

Run:

```bash
git status --short
```

Expected:
- Confirm only intended repo docs/generated graph files changed in this pass, plus pre-existing unrelated worktree changes.
- Do not revert unrelated files.

---

## Completion Criteria

- Beta strict data quality has zero hard errors.
- Synthetic/unreferenced user hygiene issues are removed or repaired with evidence.
- Automatic repair queue and visibility gate have been applied.
- Meili indexes are rebuilt from Beta.
- `tl324` or another audited PI profile has official image/bio verified, and research activity is either identity-backed or explicitly recorded as absent.
- Remaining launch blockers are named as warnings/repair lanes, not hidden behind "ready" language.
- Focused tests and server typecheck pass.
- `docs/tasks/priority-roadmap.md` and Graphify are updated.

## Self-Review

- Spec coverage: The plan covers baseline audit, deterministic repair, automatic queue/gate, search rebuild, PI profile/research-activity audit, verification, docs, and Graphify.
- Placeholder scan: No `TBD`, vague "handle edge cases", or missing commands remain.
- Type consistency: Commands use existing script names from `server/package.json`; fields match current audit outputs and profile service payloads.
