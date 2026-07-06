import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import type { PipelineStage } from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { User } from '../models/user';
import {
  buildUserIdentityDedupePlan,
  buildUserIdentityDedupeSummary,
  parseDedupeUsersByIdentityArgs,
  uniquePlannedUserIdentityDedupeGroups,
  type DedupeUsersByIdentityArgs,
  type PlannedUserIdentityDedupeGroup,
  type UserIdentityCollision,
  type UserIdentityDedupeSummary,
  type UserIdentityField,
} from './dedupeUsersByIdentityCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

const IDENTITY_FIELDS: UserIdentityField[] = [
  'netid',
  'email',
  'orcid',
  'openAlexId',
  'googleScholarId',
];

const USER_SCALAR_OBJECT_ID_REFERENCE_FIELDS: Array<{ collection: string; field: string }> = [
  { collection: 'research_entities', field: 'claimedByUserId' },
  { collection: 'research_entities', field: 'studentVisibilityReviewedByUserId' },
  { collection: 'entry_pathways', field: 'review.reviewedByUserId' },
  { collection: 'access_signals', field: 'review.reviewedByUserId' },
  { collection: 'contact_routes', field: 'personId' },
  { collection: 'contact_routes', field: 'review.reviewedByUserId' },
  { collection: 'posted_opportunities', field: 'review.reviewedByUserId' },
  { collection: 'paper_authors', field: 'userId' },
  { collection: 'research_scholarly_links', field: 'userId' },
  { collection: 'research_scholarly_attributions', field: 'targetUserId' },
  { collection: 'listings', field: 'createdByUserId' },
  { collection: 'fellowships', field: 'studentVisibilityReviewedByUserId' },
  { collection: 'faculty_members', field: 'userId' },
  { collection: 'student_profiles', field: 'userId' },
];

const USER_SCALAR_STRING_REFERENCE_FIELDS: Array<{ collection: string; field: string }> = [
  { collection: 'listings', field: 'ownerId' },
];

const USER_ARRAY_OBJECT_ID_REFERENCE_FIELDS: Array<{ collection: string; field: string }> = [
  { collection: 'papers', field: 'yaleAuthorIds' },
];

const USER_ARRAY_STRING_REFERENCE_FIELDS: Array<{ collection: string; field: string }> = [
  { collection: 'listings', field: 'professorIds' },
];

const USER_IDENTITY_DEDUPE_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function buildUserIdentityCollisionPipeline(
  field: UserIdentityField,
  limit: number,
): PipelineStage[] {
  return [
    { $match: { archived: { $ne: true } } },
    {
      $project: {
        identityValue: { $trim: { input: { $toLower: `$${field}` } } },
        user: {
          id: { $toString: '$_id' },
          netid: '$netid',
          email: '$email',
          fname: '$fname',
          lname: '$lname',
          userConfirmed: '$userConfirmed',
          lastLogin: '$lastLogin',
          lastLoginAt: '$lastLoginAt',
          lastActive: '$lastActive',
          loginCount: '$loginCount',
          departments: '$departments',
          primaryDepartment: '$primaryDepartment',
          orcid: '$orcid',
          openAlexId: '$openAlexId',
          googleScholarId: '$googleScholarId',
          createdAt: '$createdAt',
          updatedAt: '$updatedAt',
        },
      },
    },
    {
      $match: {
        identityValue: { $nin: ['', 'na', 'n/a', 'unknown'] },
      },
    },
    {
      $group: {
        _id: '$identityValue',
        users: { $push: '$user' },
      },
    },
    { $match: { 'users.1': { $exists: true } } },
    { $limit: limit },
  ];
}

export function writeDedupeUsersByIdentityOutput(
  summary: UserIdentityDedupeSummary,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(summary, null, 2)}\n`);
}

export function assertDedupeUsersByIdentityApplyAllowed(
  args: DedupeUsersByIdentityArgs,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
  plannedGroups?: number,
) {
  if (args.apply) {
    if (!args.confirmUserIdentityDedupe) {
      throw new Error(
        '--confirm-user-identity-dedupe is required when --apply is set for users:dedupe-by-identity.',
      );
    }
    if (!args.limitProvided) {
      throw new Error('--limit is required when --apply is set for users:dedupe-by-identity.');
    }
    if (!args.maxApplyGroups) {
      throw new Error('--max-apply-groups is required when --apply is set.');
    }
    if (plannedGroups !== undefined) {
      if (plannedGroups <= 0) {
        throw new Error('Apply requires at least one same-person user identity dedupe plan.');
      }
      if (plannedGroups > args.maxApplyGroups) {
        throw new Error(`Apply would merge ${plannedGroups} groups, above --max-apply-groups.`);
      }
    }
  }

  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'users:dedupe-by-identity',
    mongoUrl,
    env,
  });

  return guard;
}

export function buildDedupeUsersByIdentityOutput<T extends object>(
  summary: T,
  metadata: {
    environment?: string;
    db?: string;
    options: DedupeUsersByIdentityArgs;
  },
): T & {
  environment?: string;
  db?: string;
  options: DedupeUsersByIdentityArgs;
} {
  return {
    ...summary,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

async function loadCollisions(args: DedupeUsersByIdentityArgs): Promise<UserIdentityCollision[]> {
  const fields = args.identityField ? [args.identityField] : IDENTITY_FIELDS;
  const collisions: UserIdentityCollision[] = [];

  for (const field of fields) {
    const rows = await User.aggregate(buildUserIdentityCollisionPipeline(field, args.limit));
    for (const row of rows) {
      collisions.push({
        identityField: field,
        identityValue: String(row._id || ''),
        users: row.users || [],
      });
    }
  }

  return collisions;
}

export async function runDedupeUsersByIdentity(
  args: DedupeUsersByIdentityArgs,
): Promise<UserIdentityDedupeSummary> {
  assertDedupeUsersByIdentityApplyAllowed(args);

  const collisions = await loadCollisions(args);
  const plan = buildUserIdentityDedupePlan(collisions);
  const applyGroups = uniquePlannedUserIdentityDedupeGroups(plan.groups).slice(
    0,
    args.maxApplyGroups,
  );
  assertDedupeUsersByIdentityApplyAllowed(args, process.env, undefined, applyGroups.length);
  if (args.apply) {
    const applied = await applyUserIdentityDedupeGroups(applyGroups);
    return buildUserIdentityDedupeSummary({
      apply: true,
      plan,
      sampleSize: args.sampleSize,
      maxApplyGroups: args.maxApplyGroups,
      applied,
    });
  }
  return buildUserIdentityDedupeSummary({
    apply: false,
    plan,
    sampleSize: args.sampleSize,
    maxApplyGroups: args.maxApplyGroups,
    applied: [],
  });
}

interface ReferenceRewriteCount {
  collection: string;
  field: string;
  matchedCount: number;
  modifiedCount: number;
}

interface MemberReferenceRewriteCount {
  matchedCount: number;
  relinkedCount: number;
  archivedDuplicateCount: number;
}

interface UniqueReferenceArchiveCount {
  collection: string;
  field: string;
  uniqueFields: string[];
  matchedCount: number;
  archivedDuplicateCount: number;
}

async function applyUserIdentityDedupeGroups(
  groups: PlannedUserIdentityDedupeGroup[],
): Promise<Record<string, unknown>[]> {
  const applied: Record<string, unknown>[] = [];

  for (const group of groups) {
    const canonicalObjectId = objectIdOrThrow(group.canonicalUserId, 'canonical user id');
    const activeCanonical = await User.findOne({
      _id: canonicalObjectId,
      archived: { $ne: true },
    })
      .select('_id')
      .lean()
      .exec();
    if (!activeCanonical) {
      throw new Error(`Cannot merge user identity group; canonical user is missing or archived.`);
    }

    for (const duplicateUserId of group.duplicateUserIds) {
      const duplicateObjectId = objectIdOrThrow(duplicateUserId, 'duplicate user id');
      const duplicateUser = await User.findOne({
        _id: duplicateObjectId,
        archived: { $ne: true },
      })
        .lean()
        .exec();
      if (!duplicateUser) {
        throw new Error(`Cannot merge user ${duplicateUserId}; duplicate user is missing.`);
      }

      const canonicalFieldsModified = await mergeCanonicalUserFields(
        canonicalObjectId,
        duplicateUser,
      );
      const memberReferences = await rewriteResearchEntityMemberReferences(
        duplicateObjectId,
        canonicalObjectId,
      );
      const archivedUniqueReferences = await archiveDuplicateUniqueUserReferences(
        duplicateObjectId,
        canonicalObjectId,
      );
      const scalarObjectIdReferences = await rewriteScalarObjectIdReferences(
        duplicateObjectId,
        canonicalObjectId,
      );
      const scalarStringReferences = await rewriteScalarStringReferences(
        duplicateUserId,
        group.canonicalUserId,
      );
      const arrayObjectIdReferences = await rewriteArrayObjectIdReferences(
        duplicateObjectId,
        canonicalObjectId,
      );
      const arrayStringReferences = await rewriteArrayStringReferences(
        duplicateUserId,
        group.canonicalUserId,
      );

      const archivedAt = new Date();
      const archiveResult = await User.updateOne(
        { _id: duplicateObjectId, archived: { $ne: true } },
        {
          $set: {
            archived: true,
            dedupedIntoUserId: canonicalObjectId,
            dedupedAt: archivedAt,
            dedupeReason: 'same_person_identity',
            dedupedIdentityField: group.identityField,
            dedupedIdentityValue: group.identityValue,
          },
        },
      );
      if (archiveResult.modifiedCount !== 1) {
        throw new Error(`Failed to archive duplicate user ${duplicateUserId}; row may have changed.`);
      }

      applied.push({
        identityField: group.identityField,
        identityValue: group.identityValue,
        canonicalUserId: group.canonicalUserId,
        duplicateUserId,
        canonicalFieldsModified,
        memberReferences,
        archivedUniqueReferences,
        scalarObjectIdReferences,
        scalarStringReferences,
        arrayObjectIdReferences,
        arrayStringReferences,
        duplicateArchived: true,
      });
    }
  }

  return applied;
}

async function mergeCanonicalUserFields(
  canonicalObjectId: mongoose.Types.ObjectId,
  duplicateUser: Record<string, any>,
): Promise<boolean> {
  const canonicalUser = (await User.findById(canonicalObjectId).lean().exec()) as Record<
    string,
    any
  > | null;
  if (!canonicalUser) throw new Error('Cannot merge user fields; canonical user is missing.');

  const scalarFields = [
    'website',
    'bio',
    'title',
    'unit',
    'physicalLocation',
    'buildingDesk',
    'mailingAddress',
    'primaryDepartment',
    'orcid',
    'openAlexId',
    'googleScholarId',
    'semanticScholarId',
    'imageUrl',
    'hIndex',
  ];
  const arrayFields = [
    'departments',
    'secondaryDepartments',
    'researchInterests',
    'topics',
    'scholarCandidateProfileUrls',
    'dataSources',
  ];
  const $set: Record<string, unknown> = {};
  const $addToSet: Record<string, { $each: unknown[] }> = {};

  for (const field of scalarFields) {
    if (isMissing(canonicalUser[field]) && !isMissing(duplicateUser[field])) {
      $set[field] = duplicateUser[field];
    }
  }

  if (!canonicalUser.profileVerified && duplicateUser.profileVerified) {
    $set.profileVerified = true;
  }

  for (const field of arrayFields) {
    const values = uniqueNonEmptyValues(duplicateUser[field]);
    if (values.length > 0) {
      $addToSet[field] = { $each: values };
    }
  }

  const duplicateProfileUrls = duplicateUser.profileUrls;
  if (duplicateProfileUrls && typeof duplicateProfileUrls === 'object') {
    const canonicalProfileUrls =
      canonicalUser.profileUrls && typeof canonicalUser.profileUrls === 'object'
        ? canonicalUser.profileUrls
        : {};
    const mergedProfileUrls = { ...duplicateProfileUrls, ...canonicalProfileUrls };
    if (Object.keys(mergedProfileUrls).length > Object.keys(canonicalProfileUrls).length) {
      $set.profileUrls = mergedProfileUrls;
    }
  }

  const update: Record<string, unknown> = {};
  if (Object.keys($set).length > 0) update.$set = $set;
  if (Object.keys($addToSet).length > 0) update.$addToSet = $addToSet;
  if (Object.keys(update).length === 0) return false;

  const result = await User.updateOne({ _id: canonicalObjectId }, update);
  return result.modifiedCount > 0;
}

async function rewriteResearchEntityMemberReferences(
  duplicateObjectId: mongoose.Types.ObjectId,
  canonicalObjectId: mongoose.Types.ObjectId,
): Promise<MemberReferenceRewriteCount> {
  const db = requireMongoDb();
  const collection = db.collection('research_entity_members');
  const members = await collection
    .find({ userId: duplicateObjectId, archived: { $ne: true } })
    .toArray();
  let relinkedCount = 0;
  let archivedDuplicateCount = 0;
  const archivedAt = new Date();

  for (const member of members) {
    const existingQuery: Record<string, unknown> = {
      _id: { $ne: member._id },
      userId: canonicalObjectId,
      archived: { $ne: true },
    };
    if (member.role) existingQuery.role = member.role;
    if (member.researchEntityId) {
      existingQuery.researchEntityId = member.researchEntityId;
    } else if (member.researchGroupId) {
      existingQuery.researchGroupId = member.researchGroupId;
    }

    const canCheckDuplicate = Boolean(member.researchEntityId || member.researchGroupId);
    const existingMember = canCheckDuplicate ? await collection.findOne(existingQuery) : null;
    if (existingMember) {
      const result = await collection.updateOne(
        { _id: member._id, userId: duplicateObjectId, archived: { $ne: true } },
        {
          $set: {
            archived: true,
            isCurrentMember: false,
            endedAt: archivedAt,
            leftAt: archivedAt,
            dedupedIntoMemberId: existingMember._id,
            dedupeReason: 'user_identity_dedupe',
          },
        },
      );
      if (result.modifiedCount !== 1) {
        throw new Error(`Failed to archive duplicate member ${serializedDocumentId(member._id) || ''}.`);
      }
      archivedDuplicateCount += 1;
      continue;
    }

    const result = await collection.updateOne(
      { _id: member._id, userId: duplicateObjectId, archived: { $ne: true } },
      { $set: { userId: canonicalObjectId } },
    );
    if (result.modifiedCount !== 1) {
      throw new Error(`Failed to relink member ${serializedDocumentId(member._id) || ''}.`);
    }
    relinkedCount += 1;
  }

  return {
    matchedCount: members.length,
    relinkedCount,
    archivedDuplicateCount,
  };
}

async function rewriteScalarObjectIdReferences(
  duplicateObjectId: mongoose.Types.ObjectId,
  canonicalObjectId: mongoose.Types.ObjectId,
): Promise<ReferenceRewriteCount[]> {
  const db = requireMongoDb();
  const rewrites: ReferenceRewriteCount[] = [];
  for (const { collection, field } of USER_SCALAR_OBJECT_ID_REFERENCE_FIELDS) {
    const filter: Record<string, unknown> = { [field]: duplicateObjectId };
    if (collection === 'research_scholarly_links' || collection === 'research_scholarly_attributions') {
      filter.archived = { $ne: true };
    }
    const result = await db
      .collection(collection)
      .updateMany(filter, { $set: { [field]: canonicalObjectId } });
    if (result.matchedCount > 0 || result.modifiedCount > 0) {
      rewrites.push({ collection, field, matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
    }
  }
  return rewrites;
}

async function archiveDuplicateUniqueUserReferences(
  duplicateObjectId: mongoose.Types.ObjectId,
  canonicalObjectId: mongoose.Types.ObjectId,
): Promise<UniqueReferenceArchiveCount[]> {
  const db = requireMongoDb();
  const collection = db.collection('research_scholarly_links');
  const duplicateRows = await collection
    .find({ userId: duplicateObjectId, archived: { $ne: true } })
    .toArray();
  let archivedDuplicateCount = 0;
  const archivedAt = new Date();

  for (const row of duplicateRows) {
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    if (!url) continue;
    const existing = await collection.findOne({
      _id: { $ne: row._id },
      userId: canonicalObjectId,
      url,
      archived: { $ne: true },
    });
    if (!existing) continue;

    const result = await collection.updateOne(
      { _id: row._id, userId: duplicateObjectId, archived: { $ne: true } },
      {
        $set: {
          archived: true,
          archivedAt,
          dedupedIntoScholarlyLinkId: existing._id,
          dedupeReason: 'user_identity_dedupe',
        },
      },
    );
    if (result.modifiedCount !== 1) {
      throw new Error(`Failed to archive duplicate scholarly link ${serializedDocumentId(row._id) || ''}.`);
    }
    archivedDuplicateCount += 1;
  }

  return archivedDuplicateCount > 0
    ? [
        {
          collection: 'research_scholarly_links',
          field: 'userId',
          uniqueFields: ['url'],
          matchedCount: duplicateRows.length,
          archivedDuplicateCount,
        },
      ]
    : [];
}

async function rewriteScalarStringReferences(
  duplicateUserId: string,
  canonicalUserId: string,
): Promise<ReferenceRewriteCount[]> {
  const db = requireMongoDb();
  const rewrites: ReferenceRewriteCount[] = [];
  for (const { collection, field } of USER_SCALAR_STRING_REFERENCE_FIELDS) {
    const result = await db
      .collection(collection)
      .updateMany({ [field]: duplicateUserId }, { $set: { [field]: canonicalUserId } });
    if (result.matchedCount > 0 || result.modifiedCount > 0) {
      rewrites.push({ collection, field, matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
    }
  }
  return rewrites;
}

async function rewriteArrayObjectIdReferences(
  duplicateObjectId: mongoose.Types.ObjectId,
  canonicalObjectId: mongoose.Types.ObjectId,
): Promise<ReferenceRewriteCount[]> {
  const db = requireMongoDb();
  const rewrites: ReferenceRewriteCount[] = [];
  for (const { collection, field } of USER_ARRAY_OBJECT_ID_REFERENCE_FIELDS) {
    const addResult = await db
      .collection(collection)
      .updateMany({ [field]: duplicateObjectId }, { $addToSet: { [field]: canonicalObjectId } });
    const pullResult = await db
      .collection(collection)
      .updateMany(
        { [field]: duplicateObjectId },
        { $pull: { [field]: duplicateObjectId } } as any,
      );
    if (addResult.matchedCount > 0 || addResult.modifiedCount > 0 || pullResult.modifiedCount > 0) {
      rewrites.push({
        collection,
        field,
        matchedCount: Math.max(addResult.matchedCount, pullResult.matchedCount),
        modifiedCount: addResult.modifiedCount + pullResult.modifiedCount,
      });
    }
  }
  return rewrites;
}

async function rewriteArrayStringReferences(
  duplicateUserId: string,
  canonicalUserId: string,
): Promise<ReferenceRewriteCount[]> {
  const db = requireMongoDb();
  const rewrites: ReferenceRewriteCount[] = [];
  for (const { collection, field } of USER_ARRAY_STRING_REFERENCE_FIELDS) {
    const addResult = await db
      .collection(collection)
      .updateMany({ [field]: duplicateUserId }, { $addToSet: { [field]: canonicalUserId } });
    const pullResult = await db
      .collection(collection)
      .updateMany(
        { [field]: duplicateUserId },
        { $pull: { [field]: duplicateUserId } } as any,
      );
    if (addResult.matchedCount > 0 || addResult.modifiedCount > 0 || pullResult.modifiedCount > 0) {
      rewrites.push({
        collection,
        field,
        matchedCount: Math.max(addResult.matchedCount, pullResult.matchedCount),
        modifiedCount: addResult.modifiedCount + pullResult.modifiedCount,
      });
    }
  }
  return rewrites;
}

function requireMongoDb() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized.');
  return db;
}

export function normalizeUserIdentityDedupeObjectId(
  value: unknown,
): mongoose.Types.ObjectId | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!USER_IDENTITY_DEDUPE_OBJECT_ID_RE.test(trimmed)) return undefined;
  return new mongoose.Types.ObjectId(trimmed);
}

function objectIdOrThrow(value: unknown, label: string): mongoose.Types.ObjectId {
  const objectId = normalizeUserIdentityDedupeObjectId(value);
  if (!objectId) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return objectId;
}

function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function uniqueNonEmptyValues(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const values: unknown[] = [];
  for (const item of value) {
    if (isMissing(item)) continue;
    const key = String(item);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(item);
  }
  return values;
}

async function main() {
  const args = parseDedupeUsersByIdentityArgs(process.argv.slice(2));
  const guard = assertDedupeUsersByIdentityApplyAllowed(args, process.env, process.env.MONGODBURL);
  await initializeConnections();
  const summary = await runDedupeUsersByIdentity(args);
  const output = buildDedupeUsersByIdentityOutput(summary, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options: args,
  });
  console.log(JSON.stringify(output, null, 2));
  writeDedupeUsersByIdentityOutput(output, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
