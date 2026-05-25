# Research Data Pipeline Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first control-plane slice for the Yale Research data pipeline so operators can see source readiness, recent runs, gate status, and review queues before moving from scripts/cron to workers.

**Architecture:** Keep existing source-specific CLI jobs, `ScrapeRun`, `Observation`, materializers, WorkPlanner, and quality gates. Add a read-only server service/API and an admin UI panel that join `Source`, latest `ScrapeRun`, source coverage metadata, and selected quality summaries into one operator view.

**Tech Stack:** Express/TypeScript, Mongoose, React/Vite, Vitest, Graphify, existing scraper/source models.

---

## Files

- Create: `server/src/services/pipelineStatusService.ts`
  - Build read-only source status rows from `Source`, latest `ScrapeRun`, and `sourceCoverageRegistry`.
- Create: `server/src/services/__tests__/pipelineStatusService.test.ts`
  - Unit-test readiness classification, latest-run projection, and source coverage fallback behavior with mocked Mongoose calls.
- Modify: `server/src/routes/admin.ts`
  - Add `GET /api/admin/pipeline/status` behind existing admin auth.
- Modify: `client/src/types/types.tsx`
  - Add `PipelineSourceStatus` and response types.
- Create: `client/src/components/admin/PipelineStatusPanel.tsx`
  - Render source readiness, latest run, expected artifacts, and next action.
- Create: `client/src/components/admin/__tests__/PipelineStatusPanel.test.tsx`
  - Verify statuses, stale/blocked/source-ready labels, and empty states.
- Modify: `client/src/pages/analytics.tsx`
  - Add a Pipeline section for admins.
- Modify: `docs/research-data-pipeline.md`
  - Mark the first slice as active/in-progress after implementation begins.
- Modify: `docs/tasks/priority-roadmap.md`
  - Link the control-plane slice from the active priority queue or production gate notes.

---

### Task 1: Server Pipeline Status Service

**Files:**
- Create: `server/src/services/pipelineStatusService.ts`
- Create: `server/src/services/__tests__/pipelineStatusService.test.ts`

- [ ] **Step 1: Write the service test for status classification**

Create `server/src/services/__tests__/pipelineStatusService.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../models/source', () => ({
  Source: {
    find: vi.fn(),
  },
}));

vi.mock('../../models/scrapeRun', () => ({
  ScrapeRun: {
    aggregate: vi.fn(),
  },
}));

vi.mock('../../scrapers/sourceCoverageRegistry', () => ({
  sourceCoverageRegistry: {
    'fixture-source': {
      priority: 2,
      tier: 'OFFICIAL_INDEX',
      artifactTypes: ['ResearchEntity', 'Observation'],
      evidenceCategories: ['ENTITY_IDENTITY'],
      defaultConfidence: 'HIGH',
      notes: 'Fixture source coverage.',
    },
  },
}));

import { Source } from '../../models/source';
import { ScrapeRun } from '../../models/scrapeRun';
import { getPipelineSourceStatuses } from '../pipelineStatusService';

describe('getPipelineSourceStatuses', () => {
  it('marks successful recent enabled sources as ready', async () => {
    vi.mocked(Source.find).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          {
            _id: 'source-1',
            name: 'fixture-source',
            displayName: 'Fixture Source',
            enabled: true,
            cadence: 'weekly',
            defaultWeight: 0.9,
            coverage: {},
          },
        ]),
      }),
    } as any);

    vi.mocked(ScrapeRun.aggregate).mockResolvedValue([
      {
        sourceName: 'fixture-source',
        latestRun: {
          _id: 'run-1',
          sourceName: 'fixture-source',
          status: 'success',
          startedAt: new Date('2026-05-25T00:00:00Z'),
          finishedAt: new Date('2026-05-25T00:05:00Z'),
          observationCount: 12,
          entitiesObserved: 3,
          materializationErrors: 0,
          materializationConflicts: 0,
          postMaterializationIntegrity: { status: 'pass' },
        },
      },
    ] as any);

    const result = await getPipelineSourceStatuses({
      now: new Date('2026-05-25T01:00:00Z'),
      staleAfterDays: 30,
    });

    expect(result.sources).toMatchObject([
      {
        sourceName: 'fixture-source',
        displayName: 'Fixture Source',
        enabled: true,
        readiness: 'ready',
        nextAction: 'Ready for gated use.',
        latestRun: {
          id: 'run-1',
          status: 'success',
          observationCount: 12,
          materializationErrors: 0,
        },
        coverage: {
          tier: 'OFFICIAL_INDEX',
          artifactTypes: ['ResearchEntity', 'Observation'],
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
yarn --cwd server test src/services/__tests__/pipelineStatusService.test.ts
```

Expected: fails because `pipelineStatusService.ts` does not exist.

- [ ] **Step 3: Implement the service**

Create `server/src/services/pipelineStatusService.ts`:

```ts
import { Source } from '../models/source';
import { ScrapeRun } from '../models/scrapeRun';
import { sourceCoverageRegistry } from '../scrapers/sourceCoverageRegistry';

export type PipelineReadiness =
  | 'disabled'
  | 'never-run'
  | 'failed'
  | 'blocked'
  | 'stale'
  | 'ready';

export interface PipelineStatusOptions {
  now?: Date;
  staleAfterDays?: number;
}

export interface PipelineLatestRun {
  id: string;
  status: string;
  startedAt?: Date;
  finishedAt?: Date;
  observationCount: number;
  entitiesObserved: number;
  materializationErrors: number;
  materializationConflicts: number;
  integrityStatus?: string;
}

export interface PipelineSourceStatus {
  sourceName: string;
  displayName: string;
  enabled: boolean;
  cadence: string;
  defaultWeight: number;
  readiness: PipelineReadiness;
  nextAction: string;
  latestRun: PipelineLatestRun | null;
  coverage: {
    priority?: number;
    tier?: string;
    artifactTypes: string[];
    evidenceCategories: string[];
    defaultConfidence?: string;
    notes: string;
  };
}

export interface PipelineStatusResponse {
  generatedAt: string;
  sources: PipelineSourceStatus[];
  summary: Record<PipelineReadiness, number>;
}

const emptySummary = (): Record<PipelineReadiness, number> => ({
  disabled: 0,
  'never-run': 0,
  failed: 0,
  blocked: 0,
  stale: 0,
  ready: 0,
});

const daysBetween = (later: Date, earlier?: Date) => {
  if (!earlier) return Number.POSITIVE_INFINITY;
  return Math.floor((later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24));
};

const runId = (run: any): string => String(run?._id || run?.id || '');

const projectLatestRun = (run: any): PipelineLatestRun | null => {
  if (!run) return null;
  return {
    id: runId(run),
    status: run.status || 'unknown',
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    observationCount: run.observationCount || 0,
    entitiesObserved: run.entitiesObserved || 0,
    materializationErrors: run.materializationErrors || 0,
    materializationConflicts: run.materializationConflicts || 0,
    integrityStatus: run.postMaterializationIntegrity?.status,
  };
};

const classifyReadiness = (
  source: any,
  latestRun: PipelineLatestRun | null,
  now: Date,
  staleAfterDays: number,
): { readiness: PipelineReadiness; nextAction: string } => {
  if (!source.enabled) {
    return { readiness: 'disabled', nextAction: 'Source is disabled.' };
  }
  if (!latestRun) {
    return { readiness: 'never-run', nextAction: 'Run a bounded dry-run before promotion.' };
  }
  if (latestRun.status === 'failure') {
    return { readiness: 'failed', nextAction: 'Inspect the latest run report and fix failures.' };
  }
  if (latestRun.materializationErrors > 0 || latestRun.integrityStatus === 'fail') {
    return {
      readiness: 'blocked',
      nextAction: 'Fix materialization or integrity failures before continuing.',
    };
  }
  if (daysBetween(now, latestRun.finishedAt || latestRun.startedAt) > staleAfterDays) {
    return { readiness: 'stale', nextAction: 'Refresh with a bounded source run.' };
  }
  return { readiness: 'ready', nextAction: 'Ready for gated use.' };
};

export async function getPipelineSourceStatuses(
  options: PipelineStatusOptions = {},
): Promise<PipelineStatusResponse> {
  const now = options.now || new Date();
  const staleAfterDays = options.staleAfterDays ?? 30;
  const sources = await Source.find({}).sort({ name: 1 }).lean();
  const latestRuns = await ScrapeRun.aggregate([
    { $sort: { startedAt: -1 } },
    { $group: { _id: '$sourceName', latestRun: { $first: '$$ROOT' } } },
    { $project: { _id: 0, sourceName: '$_id', latestRun: 1 } },
  ]);
  const latestBySource = new Map(latestRuns.map((row: any) => [row.sourceName, row.latestRun]));
  const summary = emptySummary();

  const rows = sources.map((source: any): PipelineSourceStatus => {
    const registryCoverage = (sourceCoverageRegistry as any)[source.name] || {};
    const sourceCoverage = source.coverage || {};
    const latestRun = projectLatestRun(latestBySource.get(source.name));
    const { readiness, nextAction } = classifyReadiness(source, latestRun, now, staleAfterDays);
    summary[readiness] += 1;

    return {
      sourceName: source.name,
      displayName: source.displayName,
      enabled: Boolean(source.enabled),
      cadence: source.cadence || '',
      defaultWeight: source.defaultWeight || 0,
      readiness,
      nextAction,
      latestRun,
      coverage: {
        priority: sourceCoverage.priority ?? registryCoverage.priority,
        tier: sourceCoverage.tier || registryCoverage.tier,
        artifactTypes: sourceCoverage.artifactTypes || registryCoverage.artifactTypes || [],
        evidenceCategories:
          sourceCoverage.evidenceCategories || registryCoverage.evidenceCategories || [],
        defaultConfidence: sourceCoverage.defaultConfidence || registryCoverage.defaultConfidence,
        notes: sourceCoverage.notes || registryCoverage.notes || '',
      },
    };
  });

  return {
    generatedAt: now.toISOString(),
    sources: rows,
    summary,
  };
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
yarn --cwd server test src/services/__tests__/pipelineStatusService.test.ts
```

Expected: pass.

---

### Task 2: Admin API Endpoint

**Files:**
- Modify: `server/src/routes/admin.ts`

- [ ] **Step 1: Add endpoint test if admin route tests exist for similar read-only endpoints**

Check:

```bash
rg -n "admin.*routes|/api/admin|scrape-runs|analytics" server/src/routes server/src/controllers server/src/**/__tests__
```

If a nearby route helper test exists, add a route assertion for `/pipeline/status`. If not, keep coverage in the service test and manually verify the endpoint after implementation.

- [ ] **Step 2: Wire the route**

In `server/src/routes/admin.ts`, import the service:

```ts
import { getPipelineSourceStatuses } from '../services/pipelineStatusService';
```

Add a read-only route near the existing scraper/admin status routes:

```ts
router.get('/pipeline/status', async (_req, res) => {
  res.json(await getPipelineSourceStatuses());
});
```

- [ ] **Step 3: Run server typecheck**

Run:

```bash
npx tsc --noEmit -p server/tsconfig.json
```

Expected: pass.

---

### Task 3: Client Types And Panel

**Files:**
- Modify: `client/src/types/types.tsx`
- Create: `client/src/components/admin/PipelineStatusPanel.tsx`
- Create: `client/src/components/admin/__tests__/PipelineStatusPanel.test.tsx`

- [ ] **Step 1: Add client types**

Add to `client/src/types/types.tsx`:

```ts
export interface PipelineLatestRun {
  id: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  observationCount: number;
  entitiesObserved: number;
  materializationErrors: number;
  materializationConflicts: number;
  integrityStatus?: string;
}

export interface PipelineSourceStatus {
  sourceName: string;
  displayName: string;
  enabled: boolean;
  cadence: string;
  defaultWeight: number;
  readiness: 'disabled' | 'never-run' | 'failed' | 'blocked' | 'stale' | 'ready';
  nextAction: string;
  latestRun: PipelineLatestRun | null;
  coverage: {
    priority?: number;
    tier?: string;
    artifactTypes: string[];
    evidenceCategories: string[];
    defaultConfidence?: string;
    notes: string;
  };
}

export interface PipelineStatusResponse {
  generatedAt: string;
  sources: PipelineSourceStatus[];
  summary: Record<PipelineSourceStatus['readiness'], number>;
}
```

- [ ] **Step 2: Write panel test**

Create `client/src/components/admin/__tests__/PipelineStatusPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PipelineStatusPanel from '../PipelineStatusPanel';
import type { PipelineStatusResponse } from '../../../types/types';

const response: PipelineStatusResponse = {
  generatedAt: '2026-05-25T00:00:00.000Z',
  summary: {
    ready: 1,
    stale: 0,
    blocked: 1,
    failed: 0,
    disabled: 0,
    'never-run': 0,
  },
  sources: [
    {
      sourceName: 'good-source',
      displayName: 'Good Source',
      enabled: true,
      cadence: 'weekly',
      defaultWeight: 0.9,
      readiness: 'ready',
      nextAction: 'Ready for gated use.',
      latestRun: {
        id: 'run-1',
        status: 'success',
        observationCount: 10,
        entitiesObserved: 2,
        materializationErrors: 0,
        materializationConflicts: 0,
      },
      coverage: {
        tier: 'OFFICIAL_INDEX',
        artifactTypes: ['ResearchEntity'],
        evidenceCategories: ['ENTITY_IDENTITY'],
        notes: 'Official source.',
      },
    },
    {
      sourceName: 'blocked-source',
      displayName: 'Blocked Source',
      enabled: true,
      cadence: 'manual',
      defaultWeight: 0.6,
      readiness: 'blocked',
      nextAction: 'Fix materialization or integrity failures before continuing.',
      latestRun: {
        id: 'run-2',
        status: 'success',
        observationCount: 4,
        entitiesObserved: 1,
        materializationErrors: 1,
        materializationConflicts: 0,
        integrityStatus: 'fail',
      },
      coverage: {
        tier: 'PRIMARY_OFFICIAL',
        artifactTypes: ['Observation'],
        evidenceCategories: ['TOPICS'],
        notes: 'Needs review.',
      },
    },
  ],
};

describe('PipelineStatusPanel', () => {
  it('renders readiness summaries and source next actions', () => {
    render(<PipelineStatusPanel data={response} loading={false} error="" />);

    expect(screen.getByText('Pipeline')).toBeTruthy();
    expect(screen.getByText('Good Source')).toBeTruthy();
    expect(screen.getByText('Blocked Source')).toBeTruthy();
    expect(screen.getByText('Ready for gated use.')).toBeTruthy();
    expect(screen.getByText('Fix materialization or integrity failures before continuing.')).toBeTruthy();
    expect(screen.getByText(/ResearchEntity/)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Implement the panel**

Create `client/src/components/admin/PipelineStatusPanel.tsx`:

```tsx
import type { PipelineStatusResponse, PipelineSourceStatus } from '../../types/types';

interface PipelineStatusPanelProps {
  data: PipelineStatusResponse | null;
  loading: boolean;
  error: string;
}

const readinessLabel: Record<PipelineSourceStatus['readiness'], string> = {
  ready: 'Ready',
  stale: 'Stale',
  blocked: 'Blocked',
  failed: 'Failed',
  disabled: 'Disabled',
  'never-run': 'Never run',
};

const readinessClass: Record<PipelineSourceStatus['readiness'], string> = {
  ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  stale: 'bg-amber-50 text-amber-700 border-amber-200',
  blocked: 'bg-red-50 text-red-700 border-red-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  disabled: 'bg-slate-50 text-slate-600 border-slate-200',
  'never-run': 'bg-slate-50 text-slate-700 border-slate-200',
};

const formatDate = (value?: string) => {
  if (!value) return 'No run';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
};

const PipelineStatusPanel = ({ data, loading, error }: PipelineStatusPanelProps) => {
  if (loading) {
    return <section className="yr-card p-4 text-sm text-slate-600">Loading pipeline status</section>;
  }

  if (error) {
    return <section className="yr-card p-4 text-sm text-red-700">{error}</section>;
  }

  if (!data) {
    return <section className="yr-card p-4 text-sm text-slate-600">No pipeline status available.</section>;
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Pipeline</h2>
        <p className="text-sm text-slate-600">
          Source readiness, latest runs, expected artifacts, and next operator action.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
        {Object.entries(data.summary).map(([key, count]) => (
          <div key={key} className="rounded-md border border-slate-200 bg-white p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {readinessLabel[key as PipelineSourceStatus['readiness']]}
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-950">{count}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.2fr_0.7fr_0.8fr_1.4fr] border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium uppercase text-slate-500">
          <span>Source</span>
          <span>Status</span>
          <span>Latest run</span>
          <span>Next action</span>
        </div>
        {data.sources.map((source) => (
          <div
            key={source.sourceName}
            className="grid grid-cols-[1.2fr_0.7fr_0.8fr_1.4fr] gap-3 border-b border-slate-100 px-3 py-3 text-sm last:border-b-0"
          >
            <div>
              <div className="font-medium text-slate-950">{source.displayName}</div>
              <div className="mt-1 text-xs text-slate-500">
                {source.coverage.tier || 'Unclassified'} · {source.coverage.artifactTypes.join(', ') || 'No artifacts'}
              </div>
            </div>
            <div>
              <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${readinessClass[source.readiness]}`}>
                {readinessLabel[source.readiness]}
              </span>
            </div>
            <div className="text-slate-600">
              <div>{source.latestRun?.status || 'No run'}</div>
              <div className="text-xs text-slate-500">{formatDate(source.latestRun?.finishedAt)}</div>
            </div>
            <div className="text-slate-700">{source.nextAction}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default PipelineStatusPanel;
```

- [ ] **Step 4: Run the focused client test**

Run:

```bash
yarn --cwd client test:ci src/components/admin/__tests__/PipelineStatusPanel.test.tsx
```

Expected: pass.

---

### Task 4: Analytics Page Integration

**Files:**
- Modify: `client/src/pages/analytics.tsx`

- [ ] **Step 1: Inspect existing analytics fetch pattern**

Run:

```bash
sed -n '1,220p' client/src/pages/analytics.tsx
```

Use the existing `axios`, loading, and error state conventions.

- [ ] **Step 2: Add pipeline status fetch**

Add state:

```tsx
const [pipelineStatus, setPipelineStatus] = useState<PipelineStatusResponse | null>(null);
const [pipelineLoading, setPipelineLoading] = useState(false);
const [pipelineError, setPipelineError] = useState('');
```

Add fetch effect:

```tsx
useEffect(() => {
  let active = true;
  setPipelineLoading(true);
  setPipelineError('');
  axios
    .get<PipelineStatusResponse>('/admin/pipeline/status')
    .then((response) => {
      if (active) setPipelineStatus(response.data);
    })
    .catch(() => {
      if (active) setPipelineError('Pipeline status could not be loaded.');
    })
    .finally(() => {
      if (active) setPipelineLoading(false);
    });
  return () => {
    active = false;
  };
}, []);
```

Render:

```tsx
<PipelineStatusPanel data={pipelineStatus} loading={pipelineLoading} error={pipelineError} />
```

- [ ] **Step 3: Run analytics-focused client tests**

Run:

```bash
yarn --cwd client test:ci src/pages/__tests__/analytics.test.tsx
```

If there is no analytics test file, run the panel test plus client type/build check for this slice.

---

### Task 5: Docs And Verification

**Files:**
- Modify: `docs/research-data-pipeline.md`
- Modify: `docs/tasks/priority-roadmap.md`
- Modify: `graphify-out/GRAPH_REPORT.md`
- Modify: `graphify-out/graph.json`

- [ ] **Step 1: Update docs**

In `docs/research-data-pipeline.md`, add a short implementation note under `First Implementation Slice`:

```md
Implementation note: the first slice exposes read-only pipeline status through the admin surface. It does not replace CLI/cron execution or add a worker queue.
```

In `docs/tasks/priority-roadmap.md`, keep the active queue pointed at the control-plane slice before workerization.

- [ ] **Step 2: Run verification**

Run:

```bash
yarn --cwd server test src/services/__tests__/pipelineStatusService.test.ts
yarn --cwd client test:ci src/components/admin/__tests__/PipelineStatusPanel.test.tsx
npx tsc --noEmit -p server/tsconfig.json
git diff --check
graphify update .
```

Expected: focused tests pass, server typecheck passes, diff check exits 0, Graphify refreshes.

---

## Self-Review Notes

- This plan deliberately does not introduce BullMQ, Temporal, Redis, or a separate worker service in the first slice. The control-plane data model should prove operator needs before workerization.
- This plan keeps student-facing routes unchanged. `/pathways` remains a compatibility redirect, and pipeline work improves the data feeding `/research`, `/research/:slug`, `/programs`, and `/account`.
- Programs/fellowships remain on the current `Fellowship` storage model in this first slice. A storage rename should wait until classification, visibility, and suppression behavior is stable.
