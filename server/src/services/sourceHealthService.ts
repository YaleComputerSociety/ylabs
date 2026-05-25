export type SourceHealthRisk = 'ok' | 'warn' | 'error';

export interface SourceHealthSourceInput {
  _id?: unknown;
  name: string;
  displayName?: string;
  enabled?: boolean;
  cadence?: string;
  coverage?: {
    priority?: number;
    tier?: string;
    artifactTypes?: string[];
    evidenceCategories?: string[];
    defaultConfidence?: string;
  };
}

export interface SourceHealthRunInput {
  _id?: unknown;
  sourceName: string;
  status: string;
  startedAt?: Date | string;
  finishedAt?: Date | string;
  observationCount?: number;
  materializationErrors?: number;
  materializationConflicts?: number;
  invalidated?: boolean;
}

export interface SourceHealthRow {
  sourceName: string;
  displayName: string;
  enabled: boolean;
  cadence?: string;
  coverageKnown: boolean;
  priority?: number;
  tier?: string;
  expectedArtifactTypes: string[];
  recentRuns: {
    total: number;
    success: number;
    partial: number;
    failure: number;
    running: number;
  };
  latestRun?: {
    id: string;
    status: string;
    startedAt?: string;
    finishedAt?: string;
    observationCount: number;
    materializationErrors: number;
    materializationConflicts: number;
  };
  risk: SourceHealthRisk;
  action: string;
}

const stringifyId = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && 'toString' in value) return String(value.toString());
  return '';
};

const iso = (value: Date | string | undefined): string | undefined => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const riskRank: Record<SourceHealthRisk, number> = {
  error: 0,
  warn: 1,
  ok: 2,
};

function riskForSource(
  source: SourceHealthSourceInput,
  latestRun?: SourceHealthRunInput,
): {
  risk: SourceHealthRisk;
  action: string;
} {
  if (!source.enabled) {
    return {
      risk: 'warn',
      action: 'Source is disabled; confirm this is intentional before rollout.',
    };
  }
  if (!source.coverage) {
    return {
      risk: 'warn',
      action: 'Add or seed source coverage metadata before trusting broad rollout.',
    };
  }
  if (!latestRun) {
    if (source.cadence === 'event' || source.coverage.tier === 'MANUAL_OVERRIDE') {
      return {
        risk: 'ok',
        action: 'Event-driven source; no scheduled scraper run is expected.',
      };
    }
    return {
      risk: 'warn',
      action: 'No recent run recorded; run a bounded dry run before seeding.',
    };
  }
  if (latestRun.status === 'failure') {
    return {
      risk: 'error',
      action: 'Latest run failed; inspect scraper report before rerunning.',
    };
  }
  if (latestRun.status === 'running') {
    return {
      risk: 'warn',
      action: 'Latest run is still marked running; verify it is not stale.',
    };
  }
  if ((latestRun.materializationErrors || 0) > 0) {
    return {
      risk: 'error',
      action: 'Materialization errors exist; fix or document before accepting output.',
    };
  }
  if (latestRun.status === 'partial' || (latestRun.materializationConflicts || 0) > 0) {
    return {
      risk: 'warn',
      action: 'Inspect partial run or materialization conflicts before promotion.',
    };
  }
  return {
    risk: 'ok',
    action: 'Latest run is acceptable for source-health purposes.',
  };
}

export function buildSourceHealthRows(
  sources: SourceHealthSourceInput[],
  runs: SourceHealthRunInput[],
): SourceHealthRow[] {
  const runsBySource = new Map<string, SourceHealthRunInput[]>();
  for (const run of runs) {
    if (run.invalidated) continue;
    const bucket = runsBySource.get(run.sourceName) || [];
    bucket.push(run);
    runsBySource.set(run.sourceName, bucket);
  }

  for (const bucket of runsBySource.values()) {
    bucket.sort((a, b) => {
      const aTime = new Date(a.startedAt || 0).getTime();
      const bTime = new Date(b.startedAt || 0).getTime();
      return bTime - aTime;
    });
  }

  return sources
    .map((source) => {
      const sourceRuns = runsBySource.get(source.name) || [];
      const latestRun = sourceRuns[0];
      const risk = riskForSource(source, latestRun);

      return {
        sourceName: source.name,
        displayName: source.displayName || source.name,
        enabled: source.enabled !== false,
        cadence: source.cadence || undefined,
        coverageKnown: Boolean(source.coverage),
        priority: source.coverage?.priority,
        tier: source.coverage?.tier,
        expectedArtifactTypes: source.coverage?.artifactTypes || [],
        recentRuns: {
          total: sourceRuns.length,
          success: sourceRuns.filter((run) => run.status === 'success').length,
          partial: sourceRuns.filter((run) => run.status === 'partial').length,
          failure: sourceRuns.filter((run) => run.status === 'failure').length,
          running: sourceRuns.filter((run) => run.status === 'running').length,
        },
        latestRun: latestRun
          ? {
              id: stringifyId(latestRun._id),
              status: latestRun.status,
              startedAt: iso(latestRun.startedAt),
              finishedAt: iso(latestRun.finishedAt),
              observationCount: latestRun.observationCount || 0,
              materializationErrors: latestRun.materializationErrors || 0,
              materializationConflicts: latestRun.materializationConflicts || 0,
            }
          : undefined,
        ...risk,
      };
    })
    .sort((a, b) => {
      if (riskRank[a.risk] !== riskRank[b.risk]) return riskRank[a.risk] - riskRank[b.risk];
      return (a.priority ?? 999) - (b.priority ?? 999) || a.sourceName.localeCompare(b.sourceName);
    });
}
