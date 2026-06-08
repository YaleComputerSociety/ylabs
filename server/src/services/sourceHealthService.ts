export type SourceHealthRisk = 'ok' | 'warn' | 'error';
export type SourceHealthReviewArtifactReason =
  | 'latest_failure'
  | 'materialization_errors'
  | 'materialization_conflicts';

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
    reportCommand?: string;
    reportOutputPath?: string;
  };
  risk: SourceHealthRisk;
  action: string;
  nextCommand?: string;
  reviewArtifact?: {
    required: boolean;
    reason: SourceHealthReviewArtifactReason;
    command: string;
    outputPath: string;
    materializationConflicts: number;
    materializationErrors: number;
  };
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
const BETA_ENV_PREFIX = 'SCRAPER_ENV=beta';

function reportOutputPath(sourceName: string, runId: string): string {
  const safeSourceName = sourceName.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '');
  return `/tmp/ylabs-scraper-reports/${safeSourceName || 'source'}-${runId}.json`;
}

function reportCommand(sourceName: string, runId: string): string {
  return betaCommand(
    `yarn --cwd server scrape report --run ${runId} --output ${reportOutputPath(sourceName, runId)}`,
  );
}

function reviewArtifactForRun(args: {
  sourceName: string;
  runId: string;
  reason: SourceHealthReviewArtifactReason;
  materializationConflicts?: number;
  materializationErrors?: number;
}): SourceHealthRow['reviewArtifact'] {
  return {
    required: true,
    reason: args.reason,
    command: reportCommand(args.sourceName, args.runId),
    outputPath: reportOutputPath(args.sourceName, args.runId),
    materializationConflicts: args.materializationConflicts || 0,
    materializationErrors: args.materializationErrors || 0,
  };
}

function noRecentRunCommand(sourceName: string): string {
  if (sourceName === 'visibility-repair-queue') {
    return 'SCRAPER_ENV=beta yarn --cwd server beta:repair-queue --collection=all --mode=dry-run --limit=100 --output /tmp/ylabs-visibility-repair-queue-dry-run.json';
  }
  return `SCRAPER_ENV=beta yarn --cwd server scrape run --source ${sourceName} --dry-run --limit 25`;
}

function betaCommand(command: string): string {
  return command.startsWith(`${BETA_ENV_PREFIX} `) ? command : `${BETA_ENV_PREFIX} ${command}`;
}

function riskForSource(
  source: SourceHealthSourceInput,
  latestRun?: SourceHealthRunInput,
): {
  risk: SourceHealthRisk;
  action: string;
  nextCommand?: string;
} {
  const latestRunId = stringifyId(latestRun?._id);
  const latestRunReportCommand = latestRunId ? reportCommand(source.name, latestRunId) : undefined;
  const latestRunReviewArtifact = (
    reason: SourceHealthReviewArtifactReason,
  ) =>
    latestRunId
      ? {
          reviewArtifact: reviewArtifactForRun({
            sourceName: source.name,
            runId: latestRunId,
            reason,
            materializationConflicts: latestRun?.materializationConflicts,
            materializationErrors: latestRun?.materializationErrors,
          }),
        }
      : {};

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
    if (source.name === 'visibility-repair-queue') {
      return {
        risk: 'ok',
        action: 'Manual visibility repair queue; no scheduled scraper run is expected.',
      };
    }
    if (source.cadence === 'event' || source.coverage.tier === 'MANUAL_OVERRIDE') {
      return {
        risk: 'ok',
        action: 'Event-driven source; no scheduled scraper run is expected.',
      };
    }
    return {
      risk: 'warn',
      action: 'No recent run recorded; run a bounded dry run before seeding.',
      nextCommand: noRecentRunCommand(source.name),
    };
  }
  if (latestRun.status === 'failure') {
    return {
      risk: 'error',
      action: 'Latest run failed; inspect scraper report before rerunning.',
      nextCommand: latestRunReportCommand,
      ...latestRunReviewArtifact('latest_failure'),
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
      action: 'Materialization errors exist; run the latest scraper report and fix or document before accepting output.',
      nextCommand: latestRunReportCommand,
      ...latestRunReviewArtifact('materialization_errors'),
    };
  }
  if (latestRun.status === 'partial') {
    return {
      risk: 'warn',
      action: 'Inspect this partial run with the latest scraper report before promotion.',
      nextCommand: latestRunReportCommand,
      ...latestRunReviewArtifact('materialization_conflicts'),
    };
  }
  // Resolved materialization conflicts are cross-source value disagreements that the confidence
  // resolver already adjudicates (it picks a winner and flags hasConflict). They are a normal,
  // expected condition for any entity described by 2+ sources and are surfaced in reviewSummary
  // as an informational review signal. They are NOT a source-health risk or a promotion blocker.
  // Only run failures (status:'failure') and materializationErrors gate promotion.
  return {
    risk: 'ok',
    action:
      (latestRun.materializationConflicts || 0) > 0
        ? 'Latest run resolved cross-source conflicts; see materialization conflict review (informational, non-blocking).'
        : 'Latest run is acceptable for source-health purposes.',
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
      const latestRunId = stringifyId(latestRun?._id);

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
              id: latestRunId,
              status: latestRun.status,
              startedAt: iso(latestRun.startedAt),
              finishedAt: iso(latestRun.finishedAt),
              observationCount: latestRun.observationCount || 0,
              materializationErrors: latestRun.materializationErrors || 0,
              materializationConflicts: latestRun.materializationConflicts || 0,
              ...(latestRunId
                ? {
                    reportCommand: reportCommand(source.name, latestRunId),
                    reportOutputPath: reportOutputPath(source.name, latestRunId),
                  }
                : {}),
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
