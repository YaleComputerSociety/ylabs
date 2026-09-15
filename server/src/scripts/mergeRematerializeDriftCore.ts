import {
  REMATERIALIZE_TRACKED_FIELDS,
  researchEntityFieldIsStranded,
  type RematerializeFieldChange,
} from './rematerializeResearchEntitiesCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

/**
 * A merge copies a fixed field list onto the survivor, so every field outside that
 * list keeps the survivor's own value however thin it is. The audit compares that
 * stored row against what a re-projection from the survivor's own observations,
 * which after a merge include every archived twin's evidence, would produce. The
 * audited set is therefore the tracked rematerialization fields plus the fields the
 * merge carry writes plus the undergraduate-hosting fields the product serves.
 */
export const MERGE_REMATERIALIZE_AUDITED_FIELDS = Array.from(
  new Set([
    ...REMATERIALIZE_TRACKED_FIELDS,
    'departments',
    'school',
    'schools',
    'entityType',
    'location',
    'contactEmail',
    'contactName',
    'contactRole',
    'undergradEvidenceQuote',
    'typicalUndergradRoles',
    'prerequisiteCourses',
    'creditOptions',
    'fundingPrograms',
    'offersIndependentStudy',
    'fundingAgencies',
    'recentGrantCount',
  ]),
);

export type MergeRematerializeDriftKind = 'recovered' | 'emptied' | 'replaced';

export function classifyMergeRematerializeChange(
  change: RematerializeFieldChange,
): MergeRematerializeDriftKind {
  const beforeIsEmpty = researchEntityFieldIsStranded(change.before);
  const afterIsEmpty = researchEntityFieldIsStranded(change.after);
  if (beforeIsEmpty && !afterIsEmpty) return 'recovered';
  if (!beforeIsEmpty && afterIsEmpty) return 'emptied';
  return 'replaced';
}

export interface MergeRematerializeEntityReport {
  entityId: string;
  slug?: string;
  archivedTwinCount: number;
  skipped?: string;
  filledFields?: string[];
  changes: Array<RematerializeFieldChange & { kind: MergeRematerializeDriftKind }>;
}

export interface MergeRematerializeDriftSummary {
  auditedEntities: number;
  skippedEntities: number;
  entitiesWithDrift: number;
  entitiesWithRecoveredEvidence: number;
  entitiesWithEmptiedEvidence: number;
  changesByKind: Record<MergeRematerializeDriftKind, number>;
  fieldsByKind: Record<MergeRematerializeDriftKind, Record<string, number>>;
}

export function classifyMergeRematerializeChanges(
  changes: RematerializeFieldChange[],
): MergeRematerializeEntityReport['changes'] {
  return changes.map((change) => ({ ...change, kind: classifyMergeRematerializeChange(change) }));
}

export function summarizeMergeRematerializeDrift(
  reports: MergeRematerializeEntityReport[],
): MergeRematerializeDriftSummary {
  const summary: MergeRematerializeDriftSummary = {
    auditedEntities: 0,
    skippedEntities: 0,
    entitiesWithDrift: 0,
    entitiesWithRecoveredEvidence: 0,
    entitiesWithEmptiedEvidence: 0,
    changesByKind: { recovered: 0, emptied: 0, replaced: 0 },
    fieldsByKind: { recovered: {}, emptied: {}, replaced: {} },
  };

  for (const report of reports) {
    if (report.skipped) {
      summary.skippedEntities += 1;
      continue;
    }
    summary.auditedEntities += 1;
    if (report.changes.length > 0) summary.entitiesWithDrift += 1;
    if (report.changes.some((change) => change.kind === 'recovered')) {
      summary.entitiesWithRecoveredEvidence += 1;
    }
    if (report.changes.some((change) => change.kind === 'emptied')) {
      summary.entitiesWithEmptiedEvidence += 1;
    }
    for (const change of report.changes) {
      summary.changesByKind[change.kind] += 1;
      const byField = summary.fieldsByKind[change.kind];
      byField[change.field] = (byField[change.field] || 0) + 1;
    }
  }

  return summary;
}

export interface MergeRematerializeDriftArgs {
  limit: number;
  output?: string;
  slugs: string[];
  apply: boolean;
  confirmMergeRematerialize: boolean;
}

export function assertMergeRematerializeApplyAllowed(
  args: Pick<MergeRematerializeDriftArgs, 'apply' | 'confirmMergeRematerialize'>,
): void {
  if (!args.apply) return;
  if (!args.confirmMergeRematerialize) {
    throw new Error('--apply requires --confirm-merge-rematerialize');
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;

export function parseMergeRematerializeDriftArgs(argv: string[]): MergeRematerializeDriftArgs {
  const args: MergeRematerializeDriftArgs = {
    limit: 500,
    slugs: [],
    apply: false,
    confirmMergeRematerialize: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--confirm-merge-rematerialize') {
      args.confirmMergeRematerialize = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error('--limit requires a positive integer');
      }
      args.limit = parsed;
      continue;
    }
    if (arg.startsWith('--slugs=')) {
      const slugs = arg
        .slice('--slugs='.length)
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean);
      if (slugs.length === 0) throw new Error('--slugs requires at least one entity slug');
      for (const slug of slugs) {
        if (!SLUG_RE.test(slug)) throw new Error(`Invalid entity slug: ${slug}`);
      }
      args.slugs = Array.from(new Set(slugs));
      continue;
    }
    if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown merge rematerialize drift audit argument: ${arg}`);
  }
  return args;
}
