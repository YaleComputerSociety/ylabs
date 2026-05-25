# Programs UI Pipeline Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the `/programs` experience clean by materializing program/fellowship classification in the data pipeline and exposing only student-safe, undergraduate-relevant records by default.

**Architecture:** The server owns classification, audience, confidence, review, and visibility. The `/programs` UI consumes a cleaned projection and only exposes simple journey labels, while low-confidence and non-undergraduate records remain available to admins through explicit review filters. This builds on the existing `Fellowship` collection for now instead of introducing a new collection.

**Tech Stack:** Express/TypeScript, Mongoose, React/Vite, Vitest, Playwright MCP for UX verification, Graphify for repo memory.

---

## Files

- Modify: `server/src/models/fellowship.ts`
  - Add materialized pipeline fields: `audience`, `visibility`, `reviewStatus`, `classificationVersion`, `classificationConfidence`, `classificationEvidence`, `suppressionReason`.
- Modify: `server/src/services/programClassifier.ts`
  - Return the new fields.
  - Classify graduate/professional/admin/catalog records as non-student-visible.
  - Keep structured research programs strict.
- Modify: `server/src/services/__tests__/programClassifier.test.ts`
  - Cover student visibility, graduate suppression, admin/catalog suppression, and known structured programs.
- Modify: `server/src/services/fellowshipService.ts`
  - Default search and filter options to student-visible records.
  - Allow admins to request review/suppressed records explicitly.
- Modify: `server/src/controllers/fellowshipController.ts`
  - Pass through `includeReview`, `includeSuppressed`, `audience`, `visibility`, and `reviewStatus` query params.
- Modify: `server/src/routes/fellowships.ts`
  - Ensure accepted query fields reach the controller.
- Modify: `server/src/scrapers/entityMaterializer.ts`
  - Persist the full classifier output.
- Modify: `server/src/scripts/backfillProgramClassifications.ts`
  - Backfill the new fields and print a quality report.
- Modify: `client/src/types/types.tsx`
  - Add the new materialized classification fields to `Fellowship` and filter options.
- Modify: `client/src/utils/programJourney.ts`
  - Categorize only visible records into student journey buckets.
  - Treat review/suppressed records as admin-only.
- Modify: `client/src/reducers/fellowshipSearchReducer.ts`
  - Replace technical quick filters with student-facing journey filters.
- Modify: `client/src/contexts/FellowshipSearchContext.ts`
  - Add audience/visibility/review filter state only if needed for admin mode.
- Modify: `client/src/providers/FellowshipSearchContextProvider.tsx`
  - Send default student-safe query params and admin-only override params.
- Modify: `client/src/pages/fellowships.tsx`
  - Remove visible `Archive / Review` from normal student journey.
  - Replace cycle summary counters with journey counters.
  - Keep compact card badges.
- Modify: `client/src/components/fellowship/FellowshipModal.tsx`
  - Show classification evidence only to admins or as a small source/evidence panel.
- Modify: focused tests under:
  - `client/src/pages/__tests__/fellowships.test.tsx`
  - `client/src/components/fellowship/__tests__/FellowshipModal.test.tsx`
  - `client/src/reducers/__tests__/fellowshipSearchReducer.test.ts`
  - `client/src/utils/__tests__/fellowshipCycle.test.ts`
- Modify: `docs/research-model.md`, `docs/product-context.md`, `docs/tasks/priority-roadmap.md`
  - Record the stable modeling decision.

---

## Task 1: Add Pipeline Visibility Fields

**Files:**
- Modify: `server/src/models/fellowship.ts`
- Modify: `client/src/types/types.tsx`

- [ ] **Step 1: Add server enum types**

Add these constants near the existing program classification enums in `server/src/models/fellowship.ts`:

```ts
export const programAudiences = [
  'YALE_COLLEGE_UNDERGRAD',
  'UNDERGRAD_GENERAL',
  'GRADUATE',
  'PROFESSIONAL',
  'UNKNOWN',
] as const;

export type ProgramAudience = (typeof programAudiences)[number];

export const programVisibilities = [
  'STUDENT_VISIBLE',
  'NEEDS_REVIEW',
  'OPERATOR_ONLY',
  'SUPPRESSED',
] as const;

export type ProgramVisibility = (typeof programVisibilities)[number];

export const programReviewStatuses = [
  'AUTO_CLASSIFIED',
  'NEEDS_REVIEW',
  'REVIEWED',
  'SUPPRESSED',
] as const;

export type ProgramReviewStatus = (typeof programReviewStatuses)[number];
```

- [ ] **Step 2: Add schema fields**

Add these fields to `fellowshipSchema` before `title`:

```ts
audience: {
  type: String,
  enum: programAudiences,
  default: 'UNKNOWN',
},
visibility: {
  type: String,
  enum: programVisibilities,
  default: 'NEEDS_REVIEW',
},
reviewStatus: {
  type: String,
  enum: programReviewStatuses,
  default: 'AUTO_CLASSIFIED',
},
classificationVersion: {
  type: String,
  default: 'program-classifier-v1',
},
classificationConfidence: {
  type: Number,
  min: 0,
  max: 1,
  default: 0,
},
classificationEvidence: {
  type: [String],
  default: [],
},
suppressionReason: {
  type: String,
  default: '',
},
```

- [ ] **Step 3: Add indexes**

Near the existing schema indexes, add:

```ts
fellowshipSchema.index({ visibility: 1, audience: 1, archived: 1 });
fellowshipSchema.index({ reviewStatus: 1, archived: 1 });
```

- [ ] **Step 4: Add client types**

Add these fields to `Fellowship` in `client/src/types/types.tsx`:

```ts
audience: string;
visibility: string;
reviewStatus: string;
classificationVersion: string;
classificationConfidence: number;
classificationEvidence: string[];
suppressionReason: string;
```

Add these filter fields to `FellowshipFilterOptions`:

```ts
audience: string[];
visibility: string[];
reviewStatus: string[];
```

- [ ] **Step 5: Run focused typecheck**

Run:

```bash
npx tsc --noEmit -p server/tsconfig.json
```

Expected: pass.

---

## Task 2: Tighten Classifier Output

**Files:**
- Modify: `server/src/services/programClassifier.ts`
- Modify: `server/src/services/__tests__/programClassifier.test.ts`

- [ ] **Step 1: Extend classifier return type**

Update `ProgramClassification` in `server/src/services/programClassifier.ts`:

```ts
audience: ProgramAudience;
visibility: ProgramVisibility;
reviewStatus: ProgramReviewStatus;
classificationVersion: string;
classificationConfidence: number;
classificationEvidence: string[];
suppressionReason?: string;
```

Import the new types from `../models/fellowship`.

- [ ] **Step 2: Add helper constructors**

Update `baseFundingClassification`, `archiveReviewClassification`, and `structuredProgram` so every return includes:

```ts
classificationVersion: 'program-classifier-v1',
classificationConfidence: 0.65,
classificationEvidence: [],
audience: 'UNKNOWN',
visibility: 'NEEDS_REVIEW',
reviewStatus: 'AUTO_CLASSIFIED',
```

Then override per category:

```ts
// Known Yale College undergraduate program
audience: 'YALE_COLLEGE_UNDERGRAD',
visibility: 'STUDENT_VISIBLE',
classificationConfidence: 0.9,

// Funding records likely useful after mentor/project
audience: 'YALE_COLLEGE_UNDERGRAD',
visibility: 'STUDENT_VISIBLE',
classificationConfidence: 0.75,

// Admin/catalog/graduate/professional records
visibility: 'SUPPRESSED',
reviewStatus: 'SUPPRESSED',
classificationConfidence: 0.9,
suppressionReason: 'Graduate, professional, administrative, generic catalog, or malformed source record.',
```

- [ ] **Step 3: Fix open graduate records before cycle grouping**

Ensure graduate/professional detection happens before any open-application logic can send a record to `Apply Now`. Add graduate/professional checks near the top of `classifyProgram`:

```ts
if (
  /graduate student|graduate students|professional students|law school|medical school|doctoral|pre-dissertation|dissertation/i.test(text)
) {
  return {
    ...archiveReviewClassification(),
    audience: 'GRADUATE',
    visibility: 'SUPPRESSED',
    reviewStatus: 'SUPPRESSED',
    classificationConfidence: 0.9,
    suppressionReason: 'Graduate or professional audience.',
    classificationEvidence: ['Detected graduate/professional eligibility language.'],
  };
}
```

- [ ] **Step 4: Make structured rules stricter**

Known structured programs should be student-visible only when the classifier has source-specific evidence, such as title/source URL matching STARS, Wu Tsai, WHRY, YCMD, CS research internship, Tobin RA, Mellon Mays, or Scarf. Generic text containing `internship`, `residence`, `foreign`, `journalism`, or `travel` must not become `STRUCTURED_PROGRAM` unless it matches a curated source rule.

- [ ] **Step 5: Add classifier tests**

Add tests that assert:

```ts
expect(classifyProgram({ title: 'STARS Summer Research Program' }).visibility).toBe('STUDENT_VISIBLE');
expect(classifyProgram({ title: 'Law School Fellowships Common Application' }).visibility).toBe('SUPPRESSED');
expect(classifyProgram({ title: 'Alternative Funding Options' }).visibility).toBe('SUPPRESSED');
expect(classifyProgram({ title: 'Council on African Studies - Graduate Student Conference/Research Award' }).audience).toBe('GRADUATE');
expect(classifyProgram({ title: 'Henry Hart Rice Foreign Residence Fellowship' }).programKind).toBe('FELLOWSHIP_FUNDING');
```

- [ ] **Step 6: Run classifier tests**

Run:

```bash
yarn --cwd server test src/services/__tests__/programClassifier.test.ts
```

Expected: pass.

---

## Task 3: Make Search Student-Safe by Default

**Files:**
- Modify: `server/src/services/fellowshipService.ts`
- Modify: `server/src/controllers/fellowshipController.ts`
- Modify: `server/src/routes/fellowships.ts`

- [ ] **Step 1: Extend service params**

Add these params to `searchFellowships`:

```ts
audience?: string[];
visibility?: string[];
reviewStatus?: string[];
includeReview?: boolean;
includeSuppressed?: boolean;
```

- [ ] **Step 2: Add default visibility filter**

After `const filter: any = { archived: false };`, add:

```ts
if (!includeReview && !includeSuppressed) {
  filter.visibility = 'STUDENT_VISIBLE';
  filter.audience = { $in: ['YALE_COLLEGE_UNDERGRAD', 'UNDERGRAD_GENERAL', 'UNKNOWN'] };
}

if (visibility.length > 0) {
  filter.visibility = { $in: visibility };
}
if (audience.length > 0) {
  filter.audience = { $in: audience };
}
if (reviewStatus.length > 0) {
  filter.reviewStatus = { $in: reviewStatus };
}
if (includeReview && !includeSuppressed && visibility.length === 0) {
  filter.visibility = { $in: ['STUDENT_VISIBLE', 'NEEDS_REVIEW', 'OPERATOR_ONLY'] };
}
if (includeSuppressed && visibility.length === 0) {
  delete filter.visibility;
}
```

- [ ] **Step 3: Filter options should match student defaults**

Update `getFilterOptions` to use the same default filter for non-admin calls or add an optional argument:

```ts
export const getFilterOptions = async (
  baseFilter: Record<string, any> = { archived: false, visibility: 'STUDENT_VISIBLE' },
) => { ... }
```

Then use `baseFilter` for all `distinct` calls.

- [ ] **Step 4: Controller query passthrough**

Parse query params into arrays/booleans in `server/src/controllers/fellowshipController.ts`, matching existing conventions, and pass them into `searchFellowships`.

- [ ] **Step 5: Add focused service/controller tests**

Add a test that default search excludes:

```ts
{ title: 'Law School Fellowships Common Application', visibility: 'SUPPRESSED' }
```

and includes:

```ts
{ title: 'STARS Summer Research Program', visibility: 'STUDENT_VISIBLE' }
```

- [ ] **Step 6: Run server tests**

Run:

```bash
yarn --cwd server test src/services/__tests__/programClassifier.test.ts
npx tsc --noEmit -p server/tsconfig.json
```

Expected: pass.

---

## Task 4: Persist Classifier Output in Materialization and Backfill

**Files:**
- Modify: `server/src/scrapers/entityMaterializer.ts`
- Modify: `server/src/scripts/backfillProgramClassifications.ts`
- Modify: `server/src/scrapers/__tests__/entityMaterializer.test.ts`

- [ ] **Step 1: Persist new fields**

Where `classifyProgram(...)` is called, spread the full classification output into the fellowship payload:

```ts
const classification = classifyProgram({
  title,
  competitionType,
  summary,
  description,
  applicationInformation,
  eligibility,
  additionalInformation,
  purpose,
  termOfAward,
  sourceUrl,
});

const fellowshipPayload = {
  ...existingFields,
  ...classification,
};
```

- [ ] **Step 2: Add backfill report counts**

Update `backfillProgramClassifications.ts` to print counts by:

```ts
programKind
studentFacingCategory
audience
visibility
reviewStatus
suppressionReason
```

Also print the first 10 suppressed titles and first 10 `NEEDS_REVIEW` titles.

- [ ] **Step 3: Add materializer test**

Assert that a known structured observation persists:

```ts
expect(saved.visibility).toBe('STUDENT_VISIBLE');
expect(saved.audience).toBe('YALE_COLLEGE_UNDERGRAD');
expect(saved.classificationVersion).toBe('program-classifier-v1');
```

- [ ] **Step 4: Run dry-run backfill**

Run:

```bash
yarn --cwd server programs:backfill-classification --limit=50
```

Expected: report shows suppressed/admin/graduate records separated from student-visible records.

---

## Task 5: Declutter `/programs` UI

**Files:**
- Modify: `client/src/utils/programJourney.ts`
- Modify: `client/src/pages/fellowships.tsx`
- Modify: `client/src/reducers/fellowshipSearchReducer.ts`
- Modify: `client/src/providers/FellowshipSearchContextProvider.tsx`
- Modify: `client/src/contexts/FellowshipSearchContext.ts`
- Modify: `client/src/pages/__tests__/fellowships.test.tsx`
- Modify: `client/src/reducers/__tests__/fellowshipSearchReducer.test.ts`

- [ ] **Step 1: Remove archive from student journey**

Change `ProgramJourneyCategory` to:

```ts
export type ProgramJourneyCategory =
  | 'applyNow'
  | 'structured'
  | 'fundingAfterMentor'
  | 'nextCycle';
```

Add a helper:

```ts
export function isStudentVisibleProgram(fellowship: Fellowship): boolean {
  return fellowship.visibility === 'STUDENT_VISIBLE';
}
```

- [ ] **Step 2: Guard journey assignment**

At the top of `getProgramJourneyStatus`, add:

```ts
if (!isStudentVisibleProgram(fellowship)) {
  return {
    category: 'nextCycle',
    label: 'Plan Next Cycle',
    description: 'Official past cycles that look recurring.',
  };
}
```

This path should only be reached for admin/review views after Task 3, but it keeps client logic resilient.

- [ ] **Step 3: Replace top summary counters**

In `client/src/pages/fellowships.tsx`, replace `StatusSummary` with a `JourneySummary` component that accepts:

```ts
applyNowCount
structuredCount
fundingAfterMentorCount
nextCycleCount
```

Labels:

```ts
Apply directly
Structured programs
Find mentor first
Plan next cycle
```

- [ ] **Step 4: Remove `Archive / Review` section**

Remove the `archive` entry from `journeySections`.

Remove `archive` from `visibleCount`.

Remove `archive` from `journeyGroups`.

- [ ] **Step 5: Simplify filters**

Remove visible filter tabs for:

```ts
Program Kind
Entry Mode
Legacy Type
```

Keep:

```ts
Journey
Year
Term
Purpose
Region
Citizenship
```

Keep technical classification fields out of the normal student filter drawer.

- [ ] **Step 6: Rename quick filters**

Use these quick filters:

```ts
{ label: 'Apply Directly', value: 'open' }
{ label: 'Structured', value: 'structured' }
{ label: 'Find Mentor First', value: 'mentorFirst' }
{ label: 'Plan Ahead', value: 'nextCycle' }
{ label: 'Recently Added', value: 'recent' }
```

- [ ] **Step 7: Add UI tests**

Update page tests to assert:

```ts
expect(screen.queryByText('Archive / Review')).not.toBeInTheDocument();
expect(screen.getByText('Apply directly')).toBeInTheDocument();
expect(screen.getByText('Structured programs')).toBeInTheDocument();
expect(screen.getByText('Find mentor first')).toBeInTheDocument();
```

- [ ] **Step 8: Run client tests**

Run:

```bash
yarn --cwd client test:ci src/pages/__tests__/fellowships.test.tsx src/reducers/__tests__/fellowshipSearchReducer.test.ts
```

Expected: pass.

---

## Task 6: Keep Evidence Out of the Card, Put It in Admin/Modal

**Files:**
- Modify: `client/src/components/fellowship/FellowshipModal.tsx`
- Modify: `client/src/components/fellowship/__tests__/FellowshipModal.test.tsx`
- Modify as needed: shared card component used by `BrowseGrid`

- [ ] **Step 1: Keep card badges compact**

Cards should show at most two program badges:

```ts
programKindLabel(fellowship.programKind)
entryModeLabel(fellowship.entryMode)
```

Do not add `classificationConfidence`, `visibility`, `reviewStatus`, or `suppressionReason` to normal cards.

- [ ] **Step 2: Show evidence in modal only when useful**

In `FellowshipModal.tsx`, show a compact source/evidence block:

```tsx
{fellowship.classificationEvidence?.length > 0 && (
  <section>
    <h3>Why this appears here</h3>
    <ul>
      {fellowship.classificationEvidence.slice(0, 3).map((evidence) => (
        <li key={evidence}>{evidence}</li>
      ))}
    </ul>
  </section>
)}
```

Keep it below the primary action and source link, not in the modal header.

- [ ] **Step 3: Add modal test**

Assert that evidence appears in the modal when present and that suppression fields are not shown for normal student-visible records.

- [ ] **Step 4: Run modal/card tests**

Run:

```bash
yarn --cwd client test:ci src/components/fellowship/__tests__/FellowshipModal.test.tsx src/components/shared/__tests__/BrowseCard.test.tsx
```

Expected: pass.

---

## Task 7: Verify with Playwright MCP

**Files:**
- No source edits unless verification finds a bug.

- [ ] **Step 1: Start or reuse the local app**

If no server is running, start:

```bash
yarn dev:server
```

- [ ] **Step 2: Open `/programs` with Playwright MCP**

Navigate to:

```text
http://localhost:4000/programs
```

Verify:

```text
Archive / Review is not visible.
Top counters are journey counters, not mixed cycle/archive counters.
Graduate/professional titles are absent from the default student page.
Structured Research Programs contains known structured programs.
Cards show no more than two compact classification badges.
```

- [ ] **Step 3: Test search and filters**

Search for:

```text
STARS
Law School
Alternative Funding Options
Graduate Student Conference
```

Expected:

```text
STARS appears.
Law School, Alternative Funding Options, and Graduate Student Conference do not appear in the default student view.
```

---

## Task 8: Documentation and Repo Memory

**Files:**
- Modify: `docs/research-model.md`
- Modify: `docs/product-context.md`
- Modify: `docs/tasks/priority-roadmap.md`

- [ ] **Step 1: Document the modeling decision**

Add a concise note to `docs/research-model.md`:

```md
Program/fellowship classification is a materialized pipeline output, not UI-only logic. The Fellowship collection currently carries student-facing classification fields for program kind, entry mode, audience, visibility, review status, classifier version, confidence, evidence, and suppression reason. The student UI consumes only `STUDENT_VISIBLE` undergraduate-relevant records by default.
```

- [ ] **Step 2: Document the product behavior**

Add to `docs/product-context.md`:

```md
The Programs & Fellowships page should feel like a cleaned student planning surface, not an administrative database. Pipeline fields may be rich, but the default UI should expose only journey categories and compact next-step cues.
```

- [ ] **Step 3: Update roadmap**

In `docs/tasks/priority-roadmap.md`, mark this work as completed or add the remaining follow-up:

```md
- Programs & Fellowships declutter: default student view now hides review/suppressed records and groups visible records by action-oriented journey.
```

- [ ] **Step 4: Run final verification**

Run:

```bash
yarn --cwd server test src/services/__tests__/programClassifier.test.ts src/scrapers/__tests__/entityMaterializer.test.ts
yarn --cwd client test:ci src/pages/__tests__/fellowships.test.tsx src/components/fellowship/__tests__/FellowshipModal.test.tsx src/reducers/__tests__/fellowshipSearchReducer.test.ts
npx tsc --noEmit -p server/tsconfig.json
yarn --cwd client build
```

Expected: all pass, with only existing non-fatal build warnings if present.

- [ ] **Step 5: Refresh Graphify**

Run:

```bash
graphify update .
```

Expected: graph update completes.

---

## Execution Notes

- Keep existing partial implementation work. Do not revert unrelated agent changes.
- Do not introduce a new `ProgramRecord` collection in this pass. The plan intentionally stabilizes the current `Fellowship`-backed implementation first.
- Treat `Archive / Review` as an operator concept, not a student-facing section.
- If data shows many records falling into `NEEDS_REVIEW`, prefer suppressing them from the default student view and adding review tooling later over leaking them into `/programs`.
- The UI wins when the pipeline is strict. Do not compensate for uncertain data by adding more visible filters.
