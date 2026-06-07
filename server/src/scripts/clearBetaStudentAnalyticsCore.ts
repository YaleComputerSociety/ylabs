export interface ClearBetaStudentAnalyticsArgs {
  apply: boolean;
  confirmClearStudentAnalytics?: boolean;
  limit: number;
  limitProvided?: boolean;
  sampleSize: number;
  output?: string;
}

export interface ClearBetaStudentAnalyticsSample {
  netid: string;
  userType?: string;
  eventType?: string;
  count: number;
  firstEventAt?: Date | string | null;
  lastEventAt?: Date | string | null;
}

export interface ClearBetaStudentAnalyticsSummary {
  mode: 'dry-run' | 'apply';
  candidateEventCount: number;
  distinctNetids: number;
  sampledGroups: number;
  deletedEvents: number;
  promotionReady: boolean;
  nextCommand?: string;
  nextAction: string;
  samples: Array<{
    netid: string;
    userType?: string;
    eventType?: string;
    count: number;
    firstEventAt?: string;
    lastEventAt?: string;
  }>;
}

const DEFAULT_LIMIT = 1000;
const DEFAULT_SAMPLE_SIZE = 25;
const DEFAULT_OUTPUT = '/tmp/ylabs-beta-student-analytics-cleanup.json';

export const BETA_STUDENT_ANALYTICS_USER_TYPES = [
  'student',
  'undergraduate',
  'graduate',
] as const;

export function buildClearBetaStudentAnalyticsApplyCommand(limit: number): string {
  return `SCRAPER_ENV=beta yarn --cwd server beta:clear-student-analytics --apply --confirm-clear-student-analytics --limit=${limit} --output ${DEFAULT_OUTPUT}`;
}

function parseRequiredPath(value: string | undefined, flag: '--output'): string {
  const pathValue = value?.trim();
  if (!pathValue || pathValue.startsWith('--')) {
    throw new Error(`${flag} requires a path`);
  }
  return pathValue;
}

function parsePositiveIntegerOption(
  value: string | undefined,
  flag: '--limit' | '--sample-size',
): number {
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a number`);
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseClearBetaStudentAnalyticsArgs(
  argv: string[],
): ClearBetaStudentAnalyticsArgs {
  const args: ClearBetaStudentAnalyticsArgs = {
    apply: false,
    limit: DEFAULT_LIMIT,
    sampleSize: DEFAULT_SAMPLE_SIZE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--confirm-clear-student-analytics') {
      args.confirmClearStudentAnalytics = true;
      continue;
    }
    if (arg === '--mode=dry-run' || arg === '--dry-run') {
      args.apply = false;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      args.limit = parsePositiveIntegerOption(arg.slice('--limit='.length), '--limit');
      args.limitProvided = true;
      continue;
    }
    if (arg === '--limit') {
      args.limit = parsePositiveIntegerOption(argv[index + 1], '--limit');
      args.limitProvided = true;
      index += 1;
      continue;
    }
    if (arg.startsWith('--sample-size=')) {
      args.sampleSize = parsePositiveIntegerOption(
        arg.slice('--sample-size='.length),
        '--sample-size',
      );
      continue;
    }
    if (arg === '--sample-size') {
      args.sampleSize = parsePositiveIntegerOption(argv[index + 1], '--sample-size');
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = parseRequiredPath(arg.slice('--output='.length), '--output');
      continue;
    }
    if (arg === '--output') {
      args.output = parseRequiredPath(argv[index + 1], '--output');
      index += 1;
      continue;
    }
    throw new Error(`Unknown beta:clear-student-analytics option: ${arg}`);
  }

  return args;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function buildClearBetaStudentAnalyticsSummary(args: {
  apply: boolean;
  totalCount: number;
  distinctNetids: string[];
  sampleSize: number;
  samples: ClearBetaStudentAnalyticsSample[];
  deletedCount?: number;
}): ClearBetaStudentAnalyticsSummary {
  const candidateEventCount = Math.max(0, args.totalCount);
  const deletedEvents = Math.max(0, args.deletedCount || 0);
  const promotionReady =
    candidateEventCount === 0 || (args.apply && deletedEvents >= candidateEventCount);

  return {
    mode: args.apply ? 'apply' : 'dry-run',
    candidateEventCount,
    distinctNetids: new Set(args.distinctNetids.filter(Boolean)).size,
    sampledGroups: Math.min(args.samples.length, args.sampleSize),
    deletedEvents,
    promotionReady,
    ...(promotionReady
      ? {}
      : { nextCommand: buildClearBetaStudentAnalyticsApplyCommand(candidateEventCount) }),
    nextAction: promotionReady
      ? 'Re-run beta:data-quality to confirm the betaStudentAnalyticsEvents blocker is clear.'
      : 'Review the sampled real-student Beta telemetry, then run the guarded apply command to clear it from Beta before production-copy review.',
    samples: args.samples.slice(0, args.sampleSize).map((sample) => ({
      netid: sample.netid,
      ...(sample.userType ? { userType: sample.userType } : {}),
      ...(sample.eventType ? { eventType: sample.eventType } : {}),
      count: sample.count,
      ...(toIsoString(sample.firstEventAt)
        ? { firstEventAt: toIsoString(sample.firstEventAt) }
        : {}),
      ...(toIsoString(sample.lastEventAt)
        ? { lastEventAt: toIsoString(sample.lastEventAt) }
        : {}),
    })),
  };
}
