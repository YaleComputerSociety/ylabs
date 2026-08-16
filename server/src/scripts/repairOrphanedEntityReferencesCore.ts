import type { PipelineStage } from 'mongoose';

export const ENVIRONMENT_DATABASE_NAMES: Record<string, string> = {
  development: 'Development',
  beta: 'Beta',
  'production-copy': 'ProductionCopy',
  production: 'Production',
  test: 'Test',
};

export type OrphanedEntityReferenceEnvironment = keyof typeof ENVIRONMENT_DATABASE_NAMES;

export function isSupportedOrphanReferenceEnvironment(
  value: string,
): value is OrphanedEntityReferenceEnvironment {
  return Object.prototype.hasOwnProperty.call(ENVIRONMENT_DATABASE_NAMES, value);
}

export function expectedDatabaseNameForEnvironment(
  environment: OrphanedEntityReferenceEnvironment,
): string {
  return ENVIRONMENT_DATABASE_NAMES[environment];
}

export function assertConnectedDatabaseMatchesEnvironment(args: {
  environment: OrphanedEntityReferenceEnvironment;
  connectedDatabaseName: string | undefined;
  scriptName: string;
}): void {
  const expected = expectedDatabaseNameForEnvironment(args.environment);
  if (args.connectedDatabaseName !== expected) {
    throw new Error(
      `${args.scriptName} expected the ${expected} database for --environment=${args.environment} but connected to ${args.connectedDatabaseName || 'an unknown database'}.`,
    );
  }
}

export function buildOrphanMemberEntityReferencePipeline(limit: number): PipelineStage[] {
  return [
    {
      $match: {
        archived: { $ne: true },
        researchEntityId: { $exists: true, $nin: [null, ''] },
      },
    },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'researchEntityId',
        foreignField: '_id',
        as: '_entity',
      },
    },
    { $match: { _entity: { $size: 0 } } },
    { $project: { _id: 1, researchEntityId: 1, userId: 1, isCurrentMember: 1 } },
    { $limit: limit },
  ];
}

export function buildOrphanRelationshipReferencePipeline(limit: number): PipelineStage[] {
  return [
    { $match: { archived: { $ne: true } } },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'sourceResearchEntityId',
        foreignField: '_id',
        as: '_source',
      },
    },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'targetResearchEntityId',
        foreignField: '_id',
        as: '_target',
      },
    },
    {
      $match: {
        $or: [
          { sourceResearchEntityId: { $nin: [null, ''] }, _source: { $size: 0 } },
          { targetResearchEntityId: { $nin: [null, ''] }, _target: { $size: 0 } },
        ],
      },
    },
    {
      $project: {
        _id: 1,
        relationshipType: 1,
        sourceMissing: { $eq: [{ $size: '$_source' }, 0] },
        targetMissing: { $eq: [{ $size: '$_target' }, 0] },
      },
    },
    { $limit: limit },
  ];
}

export interface OrphanMemberRow {
  _id: unknown;
  isCurrentMember?: boolean;
}

export interface OrphanRelationshipRow {
  _id: unknown;
  relationshipType?: string;
  sourceMissing?: boolean;
  targetMissing?: boolean;
}

export interface OrphanedEntityReferencePlan {
  memberArchiveIds: string[];
  relationshipDeleteIds: string[];
  relationshipTypeCounts: Record<string, number>;
  relationshipDirectionCounts: { sourceMissing: number; targetMissing: number };
  possibleTruncation: { members: boolean; relationships: boolean };
}

const asId = (value: unknown): string =>
  value && typeof (value as { toHexString?: () => string }).toHexString === 'function'
    ? (value as { toHexString: () => string }).toHexString()
    : String(value);

export function buildOrphanedEntityReferencePlan(args: {
  memberRows: OrphanMemberRow[];
  relationshipRows: OrphanRelationshipRow[];
  limit: number;
}): OrphanedEntityReferencePlan {
  const relationshipTypeCounts: Record<string, number> = {};
  const relationshipDirectionCounts = { sourceMissing: 0, targetMissing: 0 };
  for (const row of args.relationshipRows) {
    const type = row.relationshipType || 'UNKNOWN';
    relationshipTypeCounts[type] = (relationshipTypeCounts[type] || 0) + 1;
    if (row.sourceMissing) relationshipDirectionCounts.sourceMissing += 1;
    if (row.targetMissing) relationshipDirectionCounts.targetMissing += 1;
  }
  return {
    memberArchiveIds: args.memberRows.map((row) => asId(row._id)),
    relationshipDeleteIds: args.relationshipRows.map((row) => asId(row._id)),
    relationshipTypeCounts,
    relationshipDirectionCounts,
    possibleTruncation: {
      members: args.memberRows.length >= args.limit,
      relationships: args.relationshipRows.length >= args.limit,
    },
  };
}

export function summarizeOrphanedEntityReferencePlan(plan: OrphanedEntityReferencePlan): {
  membersToArchive: number;
  relationshipsToDelete: number;
  relationshipTypeCounts: Record<string, number>;
  relationshipDirectionCounts: { sourceMissing: number; targetMissing: number };
  possibleTruncation: { members: boolean; relationships: boolean };
} {
  return {
    membersToArchive: plan.memberArchiveIds.length,
    relationshipsToDelete: plan.relationshipDeleteIds.length,
    relationshipTypeCounts: plan.relationshipTypeCounts,
    relationshipDirectionCounts: plan.relationshipDirectionCounts,
    possibleTruncation: plan.possibleTruncation,
  };
}
