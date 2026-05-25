export const LEGACY_PAPER_AUTHORSHIP_CLEANUP_REASON =
  'compact_scholarly_links_materialized_v1';

export const LEGACY_PAPER_AUTHORSHIP_FIELDS = [
  'yaleAuthorIds',
  'yaleAuthorNetIds',
] as const;

export interface RetireLegacyPaperAuthorshipObservationsArgs {
  apply: boolean;
  sampleSize: number;
}

export interface LegacyPaperAuthorshipObservationSample {
  _id: unknown;
  entityId?: unknown;
  entityKey?: string | null;
  field: string;
  value?: unknown;
  sourceName: string;
  sourceUrl?: string | null;
  observedAt?: Date | string;
}

export interface LegacyPaperAuthorshipObservationRetirementSummaryInput {
  apply: boolean;
  now: Date;
  compactScholarlyLinkCount: number;
  targetCount: number;
  samples: LegacyPaperAuthorshipObservationSample[];
  modifiedCount?: number;
}

export interface LegacyPaperAuthorshipObservationRetirementSampleSummary {
  observationId: string;
  entityId?: string;
  entityKey?: string;
  field: string;
  value?: unknown;
  sourceName: string;
  sourceUrl?: string;
  observedAt?: string;
}

export interface LegacyPaperAuthorshipObservationRetirementSummary {
  generatedAt: string;
  mode: 'dry-run' | 'apply';
  cleanupReason: typeof LEGACY_PAPER_AUTHORSHIP_CLEANUP_REASON;
  compactScholarlyLinkCount: number;
  targetCount: number;
  samples: LegacyPaperAuthorshipObservationRetirementSampleSummary[];
  applied?: {
    modifiedCount: number;
  };
  nextStep: string;
}

export function parseRetireLegacyPaperAuthorshipObservationsArgs(
  argv: string[],
): RetireLegacyPaperAuthorshipObservationsArgs {
  const normalized = argv.filter((arg) => arg !== '--');
  const options: RetireLegacyPaperAuthorshipObservationsArgs = {
    apply: false,
    sampleSize: 10,
  };

  for (const arg of normalized) {
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (arg.startsWith('--sample-size=')) {
      const sampleSize = Number(arg.slice('--sample-size='.length));
      if (!Number.isInteger(sampleSize) || sampleSize < 0 || sampleSize > 100) {
        throw new Error('--sample-size must be an integer between 0 and 100.');
      }
      options.sampleSize = sampleSize;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function buildLegacyPaperAuthorshipObservationRetirementFilter() {
  return {
    entityType: 'paper',
    field: { $in: [...LEGACY_PAPER_AUTHORSHIP_FIELDS] },
    superseded: { $ne: true },
    sourceName: { $ne: 'manual' },
  };
}

export function buildLegacyPaperAuthorshipObservationRetirementUpdate(
  cleanupAppliedAt: Date,
) {
  return {
    $set: {
      superseded: true,
      cleanupReason: LEGACY_PAPER_AUTHORSHIP_CLEANUP_REASON,
      cleanupAppliedAt,
    },
  };
}

export function assertCompactScholarlyLinksExistForApply(args: {
  apply: boolean;
  compactScholarlyLinkCount: number;
}): void {
  if (args.apply && args.compactScholarlyLinkCount === 0) {
    throw new Error(
      'Refusing to retire legacy paper authorship observations: no compact scholarly links exist.',
    );
  }
}

function stringifyOptionalId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  return text ? text : undefined;
}

function stringifyOptionalDate(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function summarizeSample(
  sample: LegacyPaperAuthorshipObservationSample,
): LegacyPaperAuthorshipObservationRetirementSampleSummary {
  return {
    observationId: String(sample._id),
    entityId: stringifyOptionalId(sample.entityId),
    entityKey: sample.entityKey || undefined,
    field: sample.field,
    value: sample.value,
    sourceName: sample.sourceName,
    sourceUrl: sample.sourceUrl || undefined,
    observedAt: stringifyOptionalDate(sample.observedAt),
  };
}

export function summarizeLegacyPaperAuthorshipObservationRetirement(
  input: LegacyPaperAuthorshipObservationRetirementSummaryInput,
): LegacyPaperAuthorshipObservationRetirementSummary {
  return {
    generatedAt: input.now.toISOString(),
    mode: input.apply ? 'apply' : 'dry-run',
    cleanupReason: LEGACY_PAPER_AUTHORSHIP_CLEANUP_REASON,
    compactScholarlyLinkCount: input.compactScholarlyLinkCount,
    targetCount: input.targetCount,
    samples: input.samples.map(summarizeSample),
    applied: input.apply
      ? {
          modifiedCount: input.modifiedCount || 0,
        }
      : undefined,
    nextStep: input.apply
      ? 'Legacy paper authorship observations matching the target filter were retired.'
      : 'Review the target count and samples, then rerun with --apply after confirming compact scholarly links are materialized.',
  };
}
