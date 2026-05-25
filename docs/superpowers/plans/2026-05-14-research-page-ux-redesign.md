# Research Page UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/research` feel like a student-facing research advisor: clear about what to search, which research homes match, what evidence supports them, and what action a student should take next.

**Architecture:** Keep the existing `/research` search orchestration and API contracts. Add small client-side presentation helpers that translate raw clusters/pathways/evidence into student-facing language, then refactor the page into focused cards and sections. Avoid backend schema work in this slice unless Playwright exposes a contract gap that cannot be handled defensively on the client.

**Tech Stack:** React 19, Vite, TypeScript, TailwindCSS, Vitest, Testing Library, Playwright through `scripts/with-playwright-libs.sh`.

---

## Product Direction

The current design is useful but still exposes too much of the data model. The target experience should answer, in this order:

1. What can I search?
2. Which Yale research homes match?
3. Can I actually join, contact, apply, or plan around this?
4. What should I do next?
5. What source makes this trustworthy?

Student-facing language should prefer:

- `Research homes` or `Matching research homes` instead of `Clusters`.
- `Evidence` instead of raw signal labels.
- `Best next step` instead of internal pathway/status terminology.
- Department or Yale unit names as browse anchors, with topics/methods as tags.

Keep these ideas from the current page:

- Search-first layout.
- Suggested topic/department chips.
- Evidence-backed results.
- Pathways as the practical “how to act” layer.
- Cards that expose source links without overpromising.

Remove or de-emphasize:

- `Cluster: experimental`.
- `Cluster: metadata-grouped`.
- Raw labels like `REACH_OUT_PLAUSIBLE`, `POSTED_OPENING`, and uppercase enum values as primary UI text.
- Copy that says the page is grouped by “metadata” before explaining user value.

## Files And Responsibilities

- Modify `client/src/utils/researchDiscoveryAdapters.ts`
  - Own all `/research` display normalization: grouping labels, evidence copy, next-step copy, relevance filtering, and result summaries.
- Modify `client/src/utils/__tests__/researchDiscoveryAdapters.test.ts`
  - Cover student-facing label translation, department-first grouping, next-step prioritization, and hiding internal labels.
- Modify `client/src/pages/research.tsx`
  - Own page layout, section hierarchy, request orchestration, and composition of cards.
- Modify `client/src/components/research/TopicClusterCard.tsx`
  - Either evolve into a student-facing research-home card or replace with a new `ResearchHomeCard` if the diff is cleaner.
- Create `client/src/components/research/PathwayActionCard.tsx`
  - Own pathway presentation inside `/research`: best next step, research home, evidence strength, deadline/application cue, and source link.
- Create `client/src/components/research/__tests__/PathwayActionCard.test.tsx`
  - Verify pathway labels hide raw enums and prioritize next action.
- Modify `client/src/components/research/EvidenceSourceRow.tsx`
  - Keep source display compact and readable; avoid raw enum language.
- Modify `docs/ux-audit-log.md`
  - Record before/after Playwright findings and screenshots.
- Modify `docs/ui-ux-direction.md`
  - Add durable guidance for Research, Pathways, Evidence, and Best Next Step language.

## Task 1: Lock Student-Facing Vocabulary In Adapter Tests

**Files:**
- Modify: `client/src/utils/researchDiscoveryAdapters.ts`
- Modify: `client/src/utils/__tests__/researchDiscoveryAdapters.test.ts`

- [ ] **Step 1: Write failing tests for hidden internal cluster labels**

Add a test that expects student-facing labels instead of internal cluster labels:

```ts
it('presents research-home labels without internal cluster badges', () => {
  const clusters = buildMetadataClusters([
    entity({
      _id: 'a',
      slug: 'neuro-a',
      name: 'Neuro A',
      departments: ['Neuroscience'],
      researchAreas: ['Brain imaging'],
      sourceUrls: ['https://example.yale.edu/neuro'],
    }),
  ]);

  expect(clusters[0].labels).toEqual(['Evidence-backed grouping']);
  expect(clusters[0].matchReason).toBe('Shared department: Neuroscience');
  expect(clusters[0].description).toBe(
    'Research homes connected by Yale department metadata for Neuroscience.',
  );
});
```

- [ ] **Step 2: Run the adapter test and verify failure**

Run:

```bash
yarn --cwd client test --run src/utils/__tests__/researchDiscoveryAdapters.test.ts
```

Expected: FAIL because the current labels still include `Cluster: experimental` and `Cluster: metadata-grouped`.

- [ ] **Step 3: Replace internal cluster badges in the adapter**

Change:

```ts
export const CLUSTER_EXPERIMENTAL_LABEL = 'Cluster: experimental';
export const CLUSTER_METADATA_LABEL = 'Cluster: metadata-grouped';
```

to:

```ts
export const RESEARCH_HOME_GROUPING_LABEL = 'Evidence-backed grouping';
```

Update the `labels` field in `buildMetadataClusters`:

```ts
labels: [RESEARCH_HOME_GROUPING_LABEL],
```

Update the fallback description:

```ts
description:
  entities[0]?.description ||
  `Research homes connected by Yale ${MATCH_LABEL_BY_TYPE[matchType]} metadata for ${label}.`,
```

- [ ] **Step 4: Run adapter tests**

Run:

```bash
yarn --cwd client test --run src/utils/__tests__/researchDiscoveryAdapters.test.ts
```

Expected: PASS after updating any old assertions that intentionally expected the internal labels.

- [ ] **Step 5: Commit this slice**

Run:

```bash
git add client/src/utils/researchDiscoveryAdapters.ts client/src/utils/__tests__/researchDiscoveryAdapters.test.ts
git commit -m "ux: clarify research home grouping labels"
```

## Task 2: Make Search Results Hierarchy Student-First

**Files:**
- Modify: `client/src/pages/research.tsx`
- Test: Playwright screenshots at desktop and 375px mobile.

- [ ] **Step 1: Update section names and summary copy**

In `client/src/pages/research.tsx`, change the result summary wording:

```ts
const resultSummary = (
  results: GroupedResearchResults,
  query: string,
  loading: boolean,
): string => {
  if (loading) return `Searching Yale Research for ${query}.`;
  const parts = [
    pluralize(results.clusters.length, 'research home'),
    pluralize(results.pathways.length, 'next-step pathway'),
  ];
  if (results.people.length > 0) {
    parts.push(pluralize(results.people.length, 'contact', 'contacts'));
  }
  if (results.papers.length > 0) {
    parts.push(`${pluralize(results.papers.length, 'paper')} via profiles`);
  }
  return parts.join(', ');
};
```

Change section headings:

```tsx
<SectionHeading count={activeResults.clusters.length}>Matching Research Homes</SectionHeading>
<SectionHeading count={activeResults.pathways.length}>Best Next Steps</SectionHeading>
<SectionHeading count={activeResults.people.length}>People and Contacts</SectionHeading>
<SectionHeading>{hasSubmittedSearch ? 'Keep Exploring' : 'Browse Research Areas'}</SectionHeading>
```

- [ ] **Step 2: Update hero copy**

Replace the current paragraph:

```tsx
Search by idea, method, paper, professor, or pathway. Clusters are grouped from
visible Yale metadata, with confidence labels kept literal.
```

with:

```tsx
Search by topic, method, professor, program, or question. Results connect you to
Yale research homes, evidence, and practical next steps.
```

Replace the trust panel copy:

```tsx
Same names are not merged. Identity, source evidence, and cluster confidence remain visible.
```

with:

```tsx
Every suggestion keeps its source context visible, so you can tell whether it is a posted role,
a recurring route, or exploratory evidence.
```

- [ ] **Step 3: Run a desktop Playwright screenshot**

Run a headed browser with mock auth:

```bash
NODE_PATH=/tmp/pw-driver/node_modules bash scripts/with-playwright-libs.sh node - <<'EOF'
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await context.request.get('http://localhost:4000/api/dev-login?redirect=/api/check');
  await page.goto('http://localhost:3000/research', { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: 'docs/ux-screenshots/research-hierarchy-desktop.png', fullPage: true });
  await browser.close();
})();
EOF
```

Expected: no visible `Clusters`, no visible `Cluster: experimental`, no unrelated modal.

- [ ] **Step 4: Run a mobile Playwright screenshot**

Use viewport `{ width: 375, height: 812 }`.

Expected: no horizontal overflow, search input/button readable, suggested chips wrap cleanly.

- [ ] **Step 5: Commit this slice**

Run:

```bash
git add client/src/pages/research.tsx docs/ux-screenshots docs/ux-audit-log.md
git commit -m "ux: make research search hierarchy student-first"
```

## Task 3: Introduce A Student-Facing Pathway Action Card

**Files:**
- Create: `client/src/components/research/PathwayActionCard.tsx`
- Create: `client/src/components/research/__tests__/PathwayActionCard.test.tsx`
- Modify: `client/src/pages/research.tsx`
- Modify: `client/src/components/research/EvidenceSourceRow.tsx` if evidence copy still exposes raw enums.

- [ ] **Step 1: Write failing card tests**

Create `client/src/components/research/__tests__/PathwayActionCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import PathwayActionCard from '../PathwayActionCard';
import type { PathwaySearchHit } from '../../../types/pathway';

const pathway = (overrides: Partial<PathwaySearchHit> = {}): PathwaySearchHit => ({
  _id: 'pathway-1',
  pathwayType: 'POSTED_ROLE',
  status: 'ACTIVE',
  evidenceStrength: 'DIRECT',
  studentFacingLabel: 'Posted research role',
  bestNextStep: 'Apply through the posted listing.',
  bestNextStepCategory: 'apply',
  confidence: 1,
  sourceUrls: ['https://example.yale.edu/posting'],
  researchEntity: {
    _id: 'entity-1',
    slug: 'mccormick-lab',
    name: 'McCormick Lab',
    departments: ['Neuroscience'],
    researchAreas: ['Systems neuroscience'],
  },
  activePostedOpportunity: {
    _id: 'opportunity-1',
    title: 'Spring RA role',
    status: 'OPEN',
    applicationUrl: 'https://example.yale.edu/apply',
  },
  evidence: [
    {
      signalType: 'POSTED_OPENING',
      confidence: 'HIGH',
      confidenceScore: 1,
      sourceUrl: 'https://example.yale.edu/posting',
      excerpt: 'Posted listing: David A. McCormick',
    },
  ],
  ...overrides,
});

describe('PathwayActionCard', () => {
  it('prioritizes the best next step and hides raw enum labels', () => {
    render(
      <MemoryRouter>
        <PathwayActionCard pathway={pathway()} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Best next step')).toBeInTheDocument();
    expect(screen.getByText('Apply through the posted listing.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'McCormick Lab' })).toHaveAttribute(
      'href',
      '/research/mccormick-lab',
    );
    expect(screen.queryByText('POSTED_OPENING')).not.toBeInTheDocument();
    expect(screen.queryByText('POSTED_ROLE')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the new test and verify failure**

Run:

```bash
yarn --cwd client test --run src/components/research/__tests__/PathwayActionCard.test.tsx
```

Expected: FAIL because `PathwayActionCard` does not exist.

- [ ] **Step 3: Create the card component**

Create `client/src/components/research/PathwayActionCard.tsx`:

```tsx
import { Link } from 'react-router-dom';

import EvidenceSourceRow from './EvidenceSourceRow';
import type { PathwaySearchHit } from '../../types/pathway';
import type { EvidenceSourceRowData } from '../../utils/researchDiscoveryAdapters';

interface PathwayActionCardProps {
  pathway: PathwaySearchHit;
}

const pathwayTypeLabel = (value?: string): string => {
  switch (value) {
    case 'POSTED_ROLE':
      return 'Posted role';
    case 'EXPLORATORY_CONTACT':
      return 'Exploratory outreach';
    case 'STRUCTURED_PROGRAM':
      return 'Structured program';
    case 'FACULTY_SUPERVISION':
      return 'Faculty supervision';
    default:
      return 'Pathway';
  }
};

const evidenceStrengthLabel = (value?: string): string => {
  switch (value) {
    case 'DIRECT':
    case 'SOURCE_BACKED':
      return 'Direct evidence';
    case 'STRONG':
      return 'Strong evidence';
    case 'MODERATE':
      return 'Moderate evidence';
    case 'WEAK':
      return 'Early signal';
    default:
      return 'Evidence available';
  }
};

const evidenceForPathway = (pathway: PathwaySearchHit): EvidenceSourceRowData[] => {
  const evidence = pathway.evidence?.[0];
  return [
    {
      claim:
        pathway.explanation ||
        pathway.studentFacingLabel ||
        'This pathway is connected to the current search.',
      sourceType: evidenceStrengthLabel(pathway.evidenceStrength),
      url: evidence?.sourceUrl || pathway.sourceUrls?.[0],
      excerpt: evidence?.excerpt,
      observedDate: evidence?.observedAt || pathway.lastObservedAt,
      confidence: evidence?.confidenceScore ?? pathway.confidence,
    },
  ];
};

const PathwayActionCard = ({ pathway }: PathwayActionCardProps) => {
  const researchEntity = pathway.researchEntity;
  const researchEntityLabel =
    researchEntity?.displayName || researchEntity?.name || 'Research profile';
  const researchEntityLink = researchEntity?.slug ? `/research/${researchEntity.slug}` : '/research';

  return (
    <article className="rounded-md border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
        <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
          {pathwayTypeLabel(pathway.pathwayType)}
        </span>
        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
          {evidenceStrengthLabel(pathway.evidenceStrength)}
        </span>
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        Best next step
      </p>
      <h3 className="mt-1 text-base font-semibold leading-snug text-gray-950">
        {pathway.bestNextStep || pathway.studentFacingLabel}
      </h3>

      <Link
        to={researchEntityLink}
        className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
      >
        {researchEntityLabel}
      </Link>

      {pathway.activePostedOpportunity?.applicationUrl && (
        <a
          href={pathway.activePostedOpportunity.applicationUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex min-h-[44px] items-center rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          Open application
        </a>
      )}

      <div className="mt-3">
        <EvidenceSourceRow evidence={evidenceForPathway(pathway)} compact />
      </div>
    </article>
  );
};

export default PathwayActionCard;
```

- [ ] **Step 4: Use the card from `/research`**

In `client/src/pages/research.tsx`, import the new component:

```ts
import PathwayActionCard from '../components/research/PathwayActionCard';
```

Replace the inline pathway `<article>` map with:

```tsx
{activeResults.pathways.map((pathway) => (
  <PathwayActionCard key={pathway._id} pathway={pathway} />
))}
```

Remove now-unused helpers from `research.tsx` if TypeScript flags them.

- [ ] **Step 5: Run tests**

Run:

```bash
yarn --cwd client test --run src/components/research/__tests__/PathwayActionCard.test.tsx
yarn --cwd client test --run src/utils/__tests__/researchDiscoveryAdapters.test.ts
```

Expected: PASS.

- [ ] **Step 6: Verify with Playwright search flow**

Mock-auth into `/research`, search `Neuroscience`, and screenshot:

```txt
docs/ux-screenshots/research-next-steps-desktop.png
docs/ux-screenshots/research-next-steps-mobile.png
```

Expected: pathway cards start with `Best next step`, no raw enum labels are visible in card titles or badges, and application routes have a clear CTA when available.

- [ ] **Step 7: Commit this slice**

Run:

```bash
git add client/src/components/research/PathwayActionCard.tsx client/src/components/research/__tests__/PathwayActionCard.test.tsx client/src/pages/research.tsx docs/ux-audit-log.md docs/ux-screenshots
git commit -m "ux: emphasize best next steps in research pathways"
```

## Task 4: Reframe Research Home Cards

**Files:**
- Modify: `client/src/components/research/TopicClusterCard.tsx`
- Test: `client/src/components/research/__tests__/TopicClusterCard.test.tsx`

- [ ] **Step 1: Update card test expectations**

In `TopicClusterCard.test.tsx`, replace assertions for internal labels:

```ts
expect(container.textContent).toContain('Evidence-backed grouping');
expect(container.textContent).not.toContain('Cluster: experimental');
expect(container.textContent).not.toContain('Cluster: metadata-grouped');
```

Add an assertion for clearer section copy:

```ts
expect(container.textContent).toContain('Why this matches');
expect(container.textContent).toContain('Research homes');
```

- [ ] **Step 2: Run the card test and verify failure**

Run:

```bash
yarn --cwd client test --run src/components/research/__tests__/TopicClusterCard.test.tsx
```

Expected: FAIL until the component copy changes.

- [ ] **Step 3: Update card copy**

In `TopicClusterCard.tsx`, change:

```tsx
Profiles in this cluster
Why matched
Explore cluster
```

to:

```tsx
Research homes
Why this matches
Explore this area
```

Keep the actual component name for this slice to minimize churn.

- [ ] **Step 4: Run card tests**

Run:

```bash
yarn --cwd client test --run src/components/research/__tests__/TopicClusterCard.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Verify with Playwright**

Open `/research` and screenshot the default state plus a searched state.

Expected: a first-time user sees “Research homes” and “Why this matches,” not “cluster” language.

- [ ] **Step 6: Commit this slice**

Run:

```bash
git add client/src/components/research/TopicClusterCard.tsx client/src/components/research/__tests__/TopicClusterCard.test.tsx docs/ux-audit-log.md docs/ux-screenshots
git commit -m "ux: reframe clusters as research homes"
```

## Task 5: Add Focused Page-Level Regression Coverage

**Files:**
- Create or modify: `client/src/pages/__tests__/research.test.tsx`

- [ ] **Step 1: Write a render test for the default page language**

Create a test that mocks `axios.post` for `/research/search` and confirms the page renders the new hierarchy:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import Research from '../research';
import axios from '../../utils/axios';

vi.mock('../../utils/axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

describe('Research page', () => {
  it('uses student-facing research-home language', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        researchEntities: [],
        estimatedTotalHits: 0,
      },
    });

    render(
      <MemoryRouter>
        <Research />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /Map an idea/i })).toBeInTheDocument();
    expect(screen.getByText(/Yale research homes, evidence, and practical next steps/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Browse Research Areas/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run the page test**

Run:

```bash
yarn --cwd client test --run src/pages/__tests__/research.test.tsx
```

Expected: PASS after Task 2 copy changes are complete.

- [ ] **Step 3: Run the full focused research suite**

Run:

```bash
yarn --cwd client test --run src/pages/__tests__/research.test.tsx src/components/research/__tests__/TopicClusterCard.test.tsx src/components/research/__tests__/PathwayActionCard.test.tsx src/utils/__tests__/researchDiscoveryAdapters.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit this slice**

Run:

```bash
git add client/src/pages/__tests__/research.test.tsx
git commit -m "test: cover research page UX language"
```

## Task 6: Final Browser Audit And Documentation

**Files:**
- Modify: `docs/ux-audit-log.md`
- Modify: `docs/ui-ux-direction.md`
- Refresh: `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.json`, `graphify-out/graph.html`

- [ ] **Step 1: Run final Playwright pass**

Using mock auth:

1. Open `/research` at `1280x900`.
2. Search `Neuroscience`.
3. Click a suggested search.
4. Click `Explore this area`.
5. Open at `375x812`.
6. Check no horizontal overflow.
7. Check all visible buttons/links used as actions are at least `44px` high.

Expected: no modal blockers, no raw internal labels in primary card text, and screenshots saved under `docs/ux-screenshots/`.

- [ ] **Step 2: Update audit log**

Append a concise entry to `docs/ux-audit-log.md`:

```md
### 14) `/research` hierarchy now prioritizes homes, evidence, and next steps
- **Observed behavior**
  - Earlier page language exposed cluster and metadata internals.
- **User impact**
  - First-time students had to translate system concepts before deciding what to click.
- **Root cause**
  - UI mirrored the internal grouping model instead of the student decision model.
- **Severity**
  - Medium.
- **Fix implemented**
  - Reframed clusters as research homes, emphasized best next steps, normalized evidence labels, and verified desktop/mobile flows with Playwright.
- **Status**
  - Fixed.
```

- [ ] **Step 3: Update durable UX direction**

Add this compact rule to `docs/ui-ux-direction.md`:

```md
## Research Page Language

The `/research` page should lead with research homes, evidence, and best next steps. Avoid exposing cluster/version/metadata implementation labels in primary student-facing UI.
```

- [ ] **Step 4: Run build**

Run:

```bash
yarn --cwd client build
```

Expected: PASS. Existing chunk-size warning is acceptable unless it changes materially.

- [ ] **Step 5: Refresh Graphify**

Run:

```bash
graphify update .
```

Expected: Graphify rebuilds successfully.

- [ ] **Step 6: Commit documentation and graph refresh**

Run:

```bash
git add docs/ux-audit-log.md docs/ui-ux-direction.md graphify-out
git commit -m "docs: record research page UX direction"
```

## Rollout Guardrails

- Do not change backend search contracts in this slice.
- Do not remove Pathways from `/research`; make them easier to understand.
- Do not hide evidence/source links.
- Do not use “open opportunity” language unless `activePostedOpportunity` exists.
- Keep `/pathways` unchanged unless Playwright shows a regression caused by shared components.
- Keep screenshots for before/after comparisons in `docs/ux-screenshots/`.

## Verification Checklist

- `yarn --cwd client test --run src/utils/__tests__/researchDiscoveryAdapters.test.ts`
- `yarn --cwd client test --run src/components/research/__tests__/TopicClusterCard.test.tsx`
- `yarn --cwd client test --run src/components/research/__tests__/PathwayActionCard.test.tsx`
- `yarn --cwd client test --run src/pages/__tests__/research.test.tsx`
- `yarn --cwd client build`
- Playwright desktop `/research`
- Playwright mobile `/research`
- `graphify update .`
