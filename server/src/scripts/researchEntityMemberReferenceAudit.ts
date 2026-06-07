import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import type { PipelineStage } from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import {
  assertResearchEntityMemberReferenceApplyAllowed,
  assertResearchEntityMemberReferenceApplyPreflightAllowed,
  assertResearchEntityMemberReferenceTargetAllowed,
  buildResearchEntityMemberReferenceAuditOutput,
  buildResearchEntityMemberReferenceAuditSummary,
  inferMemberReferenceNames,
  parseResearchEntityMemberReferenceAuditArgs,
  type ExistingMemberMatch,
  type MemberReferenceAuditPlanItem,
  type MemberReferenceAuditRow,
  type MemberReferenceAuditUser,
  type ResearchEntityMemberReferenceAuditArgs,
  type ResearchEntityMemberReferenceAuditSummary,
} from './researchEntityMemberReferenceAuditCore';

dotenv.config();

const ORPHAN_USER_REF_STAGES: PipelineStage[] = [
  { $match: { userId: { $exists: true, $nin: [null, ''] }, archived: { $ne: true } } },
  {
    $lookup: {
      from: 'users',
      localField: 'userId',
      foreignField: '_id',
      as: '_user',
    },
  },
  { $match: { _user: { $size: 0 } } },
];

const CURRENT_MEMBER_ON_ARCHIVED_ENTITY_STAGES: PipelineStage[] = [
  {
    $match: {
      archived: { $ne: true },
      isCurrentMember: { $ne: false },
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
  { $unwind: '$_entity' },
  {
    $match: {
      '_entity.archived': true,
      '_entity.canonicalGroupId': { $exists: true, $nin: [null, ''] },
    },
  },
];

export function buildOrphanMemberUserReferencePipeline(limit: number): PipelineStage[] {
  return [
    ...ORPHAN_USER_REF_STAGES,
    {
      $lookup: {
        from: 'research_entities',
        localField: 'researchEntityId',
        foreignField: '_id',
        as: '_entity',
      },
    },
    { $unwind: { path: '$_entity', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        member: {
          id: { $toString: '$_id' },
          userId: { $toString: '$userId' },
          researchEntityId: { $toString: '$researchEntityId' },
          researchGroupId: { $toString: '$researchGroupId' },
          name: '$name',
          role: '$role',
          sourceUrl: '$sourceUrl',
        },
        entity: {
          id: { $toString: '$_entity._id' },
          name: '$_entity.name',
          slug: '$_entity.slug',
        },
      },
    },
    { $limit: limit },
  ];
}

export function buildCurrentMemberOnArchivedEntityPipeline(limit: number): PipelineStage[] {
  return [
    ...CURRENT_MEMBER_ON_ARCHIVED_ENTITY_STAGES,
    {
      $project: {
        member: {
          id: { $toString: '$_id' },
          userId: { $toString: '$userId' },
          researchEntityId: { $toString: '$researchEntityId' },
          researchGroupId: { $toString: '$researchGroupId' },
          name: '$name',
          role: '$role',
          sourceUrl: '$sourceUrl',
        },
        entity: {
          id: { $toString: '$_entity._id' },
          name: '$_entity.name',
          slug: '$_entity.slug',
          archived: '$_entity.archived',
          canonicalGroupId: { $toString: '$_entity.canonicalGroupId' },
        },
      },
    },
    { $limit: limit },
  ];
}

export function buildExistingMemberMatchQuery(
  row: MemberReferenceAuditRow,
  candidateUserIds: string[],
): Record<string, unknown> | null {
  const userIds = candidateUserIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!row.member.researchEntityId || userIds.length === 0) return null;

  const query: Record<string, unknown> = {
    _id: { $ne: row.member.id },
    researchEntityId: row.member.researchEntityId,
    userId: { $in: userIds },
    archived: { $ne: true },
  };
  if (row.member.role) {
    query.role = row.member.role;
  }
  return query;
}

export function writeResearchEntityMemberReferenceAuditOutput(
  summary: ResearchEntityMemberReferenceAuditSummary,
  output?: string,
): void {
  if (!output) return;
  fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
}

async function loadOrphanRows(args: ResearchEntityMemberReferenceAuditArgs): Promise<{
  totalOrphanedRefs: number;
  rows: MemberReferenceAuditRow[];
}> {
  const [countRows, rawRows, _archivedCountRows, archivedRows] = await Promise.all([
    ResearchGroupMember.aggregate<{ count: number }>([
      ...ORPHAN_USER_REF_STAGES,
      { $count: 'count' },
    ]),
    ResearchGroupMember.aggregate<MemberReferenceAuditRow>(
      buildOrphanMemberUserReferencePipeline(args.limit),
    ),
    ResearchGroupMember.aggregate<{ count: number }>([
      ...CURRENT_MEMBER_ON_ARCHIVED_ENTITY_STAGES,
      { $count: 'count' },
    ]),
    ResearchGroupMember.aggregate<MemberReferenceAuditRow>(
      buildCurrentMemberOnArchivedEntityPipeline(args.limit),
    ),
  ]);

  const rows = await Promise.all(
    rawRows.map(async (row) => {
      const candidateUsers = await loadCandidateUsers(inferMemberReferenceNames(row));
      const candidateRow = { ...row, candidateUsers };
      return {
        ...candidateRow,
        existingMemberMatches: await loadExistingMemberMatches(candidateRow),
      };
    }),
  );
  const archivedEntityRows = await Promise.all(
    archivedRows.map(async (row) => {
      const candidateRow = { ...row, candidateUsers: [] };
      return {
        ...candidateRow,
        existingCanonicalMemberMatches: await loadExistingCanonicalMemberMatches(candidateRow),
      };
    }),
  );

  return {
    totalOrphanedRefs: countRows[0]?.count || 0,
    rows: [...rows, ...archivedEntityRows],
  };
}

async function loadCandidateUsers(names: string[]): Promise<MemberReferenceAuditUser[]> {
  const clauses = names.flatMap((name) => {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return [];
    const [first, ...lastParts] = parts;
    return [
      {
        fname: exactCaseInsensitive(first),
        lname: exactCaseInsensitive(lastParts.join(' ')),
      },
    ];
  });
  if (clauses.length === 0) return [];

  const rows = await User.find({ $or: clauses })
    .select('_id netid fname lname userType')
    .limit(20)
    .lean()
    .exec();

  return rows.map((row) => ({
    id: String(row._id || ''),
    netid: row.netid || undefined,
    name: [row.fname, row.lname].filter(Boolean).join(' '),
    userType: row.userType || undefined,
  }));
}

async function loadExistingMemberMatches(
  row: MemberReferenceAuditRow,
): Promise<ExistingMemberMatch[]> {
  const query = buildExistingMemberMatchQuery(
    row,
    row.candidateUsers.map((user) => user.id),
  );
  if (!query) return [];

  const rows = await ResearchGroupMember.find(query)
    .select('_id userId role')
    .limit(20)
    .lean()
    .exec();

  return rows.map((row) => ({
    id: String(row._id || ''),
    userId: String(row.userId || ''),
    role: row.role || undefined,
  }));
}

async function loadExistingCanonicalMemberMatches(
  row: MemberReferenceAuditRow,
): Promise<ExistingMemberMatch[]> {
  if (
    !row.entity?.canonicalGroupId ||
    !mongoose.Types.ObjectId.isValid(row.entity.canonicalGroupId) ||
    !mongoose.Types.ObjectId.isValid(row.member.userId)
  ) {
    return [];
  }
  const query: Record<string, unknown> = {
    _id: { $ne: row.member.id },
    researchEntityId: row.entity.canonicalGroupId,
    userId: row.member.userId,
    archived: { $ne: true },
  };
  if (row.member.role) {
    query.role = row.member.role;
  }
  const rows = await ResearchGroupMember.find(query)
    .select('_id userId role')
    .limit(20)
    .lean()
    .exec();
  return rows.map((row) => ({
    id: String(row._id || ''),
    userId: String(row.userId || ''),
    role: row.role || undefined,
  }));
}

export async function runResearchEntityMemberReferenceAudit(
  args: ResearchEntityMemberReferenceAuditArgs,
): Promise<ResearchEntityMemberReferenceAuditSummary> {
  const { totalOrphanedRefs, rows } = await loadOrphanRows(args);
  const summary = buildResearchEntityMemberReferenceAuditSummary({ totalOrphanedRefs, rows });
  assertResearchEntityMemberReferenceApplyAllowed(args, summary);
  if (!args.apply) {
    return summary;
  }

  const applied = await applyMemberReferenceRepairs(summary.plan);
  return {
    ...summary,
    mode: 'apply',
    applyBlocked: false,
    nextAction: 'Applied member-reference repairs; rerun data-quality and launch gates.',
    applied,
  };
}

async function applyMemberReferenceRepairs(
  plan: MemberReferenceAuditPlanItem[],
): Promise<ResearchEntityMemberReferenceAuditSummary['applied']> {
  const applied: ResearchEntityMemberReferenceAuditSummary['applied'] = [];
  const archivedAt = new Date();

  for (const item of plan) {
    if (item.action === 'manual_review') {
      continue;
    }

    if (item.action === 'relink_user_id_to_exact_name_match') {
      if (!item.replacementUserId || !mongoose.Types.ObjectId.isValid(item.replacementUserId)) {
        throw new Error(`Cannot relink member ${item.memberId}; replacement user id is invalid.`);
      }

      const result = await ResearchGroupMember.updateOne(
        { _id: item.memberId, userId: item.currentUserId },
        { $set: { userId: new mongoose.Types.ObjectId(item.replacementUserId) } },
      );
      if (result.modifiedCount !== 1) {
        throw new Error(`Failed to relink member ${item.memberId}; row may have changed.`);
      }
      applied.push({
        action: 'relink_user_id_to_exact_name_match',
        memberId: item.memberId,
        previousUserId: item.currentUserId,
        replacementUserId: item.replacementUserId,
        replacementNetid: item.replacementNetid,
      });
      continue;
    }

    if (item.action === 'relink_member_to_canonical_entity') {
      if (
        !item.replacementResearchEntityId ||
        !mongoose.Types.ObjectId.isValid(item.replacementResearchEntityId)
      ) {
        throw new Error(
          `Cannot relink member ${item.memberId}; replacement research entity id is invalid.`,
        );
      }
      const replacementResearchEntityId = new mongoose.Types.ObjectId(
        item.replacementResearchEntityId,
      );
      const result = await ResearchGroupMember.updateOne(
        { _id: item.memberId, userId: item.currentUserId, archived: { $ne: true } },
        {
          $set: {
            researchEntityId: replacementResearchEntityId,
            researchGroupId: replacementResearchEntityId,
          },
        },
      );
      if (result.modifiedCount !== 1) {
        throw new Error(
          `Failed to relink member ${item.memberId} to canonical entity; row may have changed.`,
        );
      }
      applied.push({
        action: 'relink_member_to_canonical_entity',
        memberId: item.memberId,
        previousUserId: item.currentUserId,
        replacementResearchEntityId: item.replacementResearchEntityId,
      });
      continue;
    }

    const result = await ResearchGroupMember.updateOne(
      { _id: item.memberId, userId: item.currentUserId, archived: { $ne: true } },
      {
        $set: {
          archived: true,
          isCurrentMember: false,
          endedAt: archivedAt,
          leftAt: archivedAt,
        },
      },
    );
    if (result.modifiedCount !== 1) {
      throw new Error(`Failed to archive duplicate member ${item.memberId}; row may have changed.`);
    }
    applied.push({
      action:
        item.action === 'archive_current_member_on_archived_entity'
          ? 'archive_current_member_on_archived_entity'
          : 'archive_orphan_duplicate_member',
      memberId: item.memberId,
      previousUserId: item.currentUserId,
      replacementUserId: item.replacementUserId,
      replacementNetid: item.replacementNetid,
      replacementResearchEntityId: item.replacementResearchEntityId,
      existingMemberId: item.existingMemberId,
    });
  }

  return applied;
}

function exactCaseInsensitive(value: string): RegExp {
  return new RegExp(`^${escapeRegExp(value)}$`, 'i');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const args = parseResearchEntityMemberReferenceAuditArgs(process.argv.slice(2));
  assertResearchEntityMemberReferenceApplyPreflightAllowed(args);
  const guard = assertResearchEntityMemberReferenceTargetAllowed(
    args,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();
  const summary = await runResearchEntityMemberReferenceAudit(args);
  const output = buildResearchEntityMemberReferenceAuditOutput(summary, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options: args,
  });
  console.log(JSON.stringify(output, null, 2));
  writeResearchEntityMemberReferenceAuditOutput(output, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
