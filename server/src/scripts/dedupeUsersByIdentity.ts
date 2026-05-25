import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { User } from '../models/user';
import {
  buildUserIdentityDedupeSummary,
  buildUserIdentityDedupePlan,
  parseDedupeUsersByIdentityArgs,
  type PlannedUserIdentityDedupeGroup,
  type UserIdentityCollision,
  uniquePlannedUserIdentityDedupeGroups,
} from './dedupeUsersByIdentityCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SIMPLE_USER_REF_SPECS = [
  { collection: 'contact_routes', field: 'personId' },
  { collection: 'listings', field: 'createdByUserId' },
  { collection: 'research_entities', field: 'claimedByUserId' },
  { collection: 'observations', field: 'entityId', extraMatch: { entityType: 'user' } },
] as const;

function oid(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value);
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .flat()
        .map((value) => (value === undefined || value === null ? '' : String(value).trim()))
        .filter(Boolean),
    ),
  );
}

function firstMeaningful(values: unknown[]): unknown {
  return values.find((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
}

function mergeObjects(values: unknown[]): Record<string, unknown> {
  return values.reduce<Record<string, unknown>>((merged, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return merged;
    return { ...merged, ...(value as Record<string, unknown>) };
  }, {});
}

async function loadCandidateCollisions(input: {
  limit: number;
  identityField?: string;
}): Promise<UserIdentityCollision[]> {
  const fields = input.identityField
    ? [input.identityField]
    : ['netid', 'email', 'orcid', 'openAlexId', 'googleScholarId'];
  const collisions: UserIdentityCollision[] = [];

  for (const field of fields) {
    const rows = await User.aggregate([
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
      { $match: { identityValue: { $nin: ['', 'na', 'n/a', 'unknown'] } } },
      {
        $group: {
          _id: '$identityValue',
          users: { $push: '$user' },
        },
      },
      { $match: { 'users.1': { $exists: true } } },
      { $limit: Math.max(1, input.limit - collisions.length) },
    ]);

    for (const row of rows) {
      collisions.push({
        identityField: field as UserIdentityCollision['identityField'],
        identityValue: String(row._id || ''),
        users: row.users || [],
      });
      if (collisions.length >= input.limit) break;
    }
    if (collisions.length >= input.limit) break;
  }

  return collisions;
}

async function mergeCanonicalUserFields(group: PlannedUserIdentityDedupeGroup): Promise<void> {
  const users = await User.find({
    _id: { $in: [group.canonicalUserId, ...group.duplicateUserIds].map(oid) },
  }).lean();
  const canonical = users.find((user: any) => String(user._id) === group.canonicalUserId) as any;
  if (!canonical) throw new Error(`Canonical user not found: ${group.canonicalUserId}`);
  const duplicates = users.filter((user: any) => group.duplicateUserIds.includes(String(user._id)));

  const scalarFields = [
    'website',
    'bio',
    'phone',
    'title',
    'unit',
    'upi',
    'physicalLocation',
    'buildingDesk',
    'mailingAddress',
    'primaryDepartment',
    'college',
    'year',
    'hIndex',
    'googleScholarId',
    'semanticScholarId',
    'orcid',
    'openAlexId',
    'imageUrl',
    'openAlexWorksSyncedAt',
    'orcidWorksSyncedAt',
    'europePmcWorksSyncedAt',
    'pubmedWorksSyncedAt',
  ];
  const arrayFields = [
    'departments',
    'secondaryDepartments',
    'researchInterests',
    'topics',
    'scholarCandidateProfileUrls',
    'dataSources',
    'major',
    'ownListings',
    'favListings',
    'favFellowships',
    'favPathways',
    'manuallyLockedFields',
  ];

  const set: Record<string, unknown> = {
    userConfirmed: Boolean(canonical.userConfirmed || duplicates.some((user: any) => user.userConfirmed)),
    loginCount:
      (Number(canonical.loginCount) || 0) +
      duplicates.reduce((sum: number, user: any) => sum + (Number(user.loginCount) || 0), 0),
    profileUrls: mergeObjects([canonical.profileUrls, ...duplicates.map((user: any) => user.profileUrls)]),
    savedPathwayPlans: mergeObjects([
      canonical.savedPathwayPlans,
      ...duplicates.map((user: any) => user.savedPathwayPlans),
    ]),
    confidenceByField: mergeObjects([
      canonical.confidenceByField,
      ...duplicates.map((user: any) => user.confidenceByField),
    ]),
    dataSources: uniqueStrings([
      canonical.dataSources || [],
      ...duplicates.map((user: any) => user.dataSources || []),
      'user-identity-dedupe',
    ]),
  };

  for (const field of scalarFields) {
    set[field] = firstMeaningful([canonical[field], ...duplicates.map((user: any) => user[field])]);
  }
  for (const field of arrayFields) {
    set[field] = uniqueStrings([
      canonical[field] || [],
      ...duplicates.map((user: any) => user[field] || []),
    ]);
  }

  await User.updateOne({ _id: oid(group.canonicalUserId) }, { $set: set });
}

async function relinkResearchMembers(
  db: mongoose.mongo.Db,
  canonicalId: mongoose.Types.ObjectId,
  duplicateIds: mongoose.Types.ObjectId[],
): Promise<{ updated: number; retired: number }> {
  const collection = db.collection('research_entity_members');
  const duplicateRows = await collection
    .find({ userId: { $in: duplicateIds } })
    .project({ _id: 1, researchEntityId: 1, role: 1, isCurrentMember: 1 })
    .toArray();
  let updated = 0;
  let retired = 0;

  for (const row of duplicateRows) {
    const isCurrent = row.isCurrentMember !== false;
    const existing =
      isCurrent && row.researchEntityId
        ? await collection.findOne({
            researchEntityId: row.researchEntityId,
            userId: canonicalId,
            role: row.role,
            isCurrentMember: { $ne: false },
          })
        : null;

    if (existing) {
      const result = await collection.updateOne(
        { _id: row._id },
        {
          $set: { isCurrentMember: false, endedAt: new Date(), leftAt: new Date() },
          $unset: { userId: '' },
        },
      );
      retired += result.modifiedCount || 0;
      continue;
    }

    const result = await collection.updateOne({ _id: row._id }, { $set: { userId: canonicalId } });
    updated += result.modifiedCount || 0;
  }

  return { updated, retired };
}

async function relinkUniqueUserCollection(input: {
  db: mongoose.mongo.Db;
  collectionName: string;
  canonicalId: mongoose.Types.ObjectId;
  duplicateIds: mongoose.Types.ObjectId[];
}): Promise<{ updated: number; unset: number }> {
  const collection = input.db.collection(input.collectionName);
  const canonicalRow = await collection.findOne({ userId: input.canonicalId });
  const duplicateRows = await collection
    .find({ userId: { $in: input.duplicateIds } })
    .project({ _id: 1 })
    .toArray();
  let updated = 0;
  let unset = 0;

  for (const row of duplicateRows) {
    if (canonicalRow || updated > 0) {
      const result = await collection.updateOne({ _id: row._id }, { $unset: { userId: '' } });
      unset += result.modifiedCount || 0;
      continue;
    }

    const result = await collection.updateOne(
      { _id: row._id },
      { $set: { userId: input.canonicalId } },
    );
    updated += result.modifiedCount || 0;
  }

  return { updated, unset };
}

async function relinkScholarlyLinks(
  db: mongoose.mongo.Db,
  canonicalId: mongoose.Types.ObjectId,
  duplicateIds: mongoose.Types.ObjectId[],
): Promise<{ updated: number; archived: number }> {
  const collection = db.collection('research_scholarly_links');
  const links = await collection
    .find({ userId: { $in: duplicateIds } })
    .project({ _id: 1, url: 1, archived: 1 })
    .toArray();
  let updated = 0;
  let archived = 0;

  for (const link of links) {
    const existing =
      link.archived === true
        ? null
        : await collection.findOne({
            userId: canonicalId,
            url: link.url,
            archived: { $ne: true },
          });
    if (existing) {
      const result = await collection.updateOne(
        { _id: link._id },
        { $set: { archived: true, archivedReason: 'duplicate-user-identity-dedupe' } },
      );
      archived += result.modifiedCount || 0;
      continue;
    }

    const result = await collection.updateOne({ _id: link._id }, { $set: { userId: canonicalId } });
    updated += result.modifiedCount || 0;
  }

  return { updated, archived };
}

async function applyGroup(group: PlannedUserIdentityDedupeGroup): Promise<Record<string, unknown>> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo connection is not ready');
  const canonicalId = oid(group.canonicalUserId);
  const duplicateIds = group.duplicateUserIds.map(oid);
  const usersForNetids = await User.find({ _id: { $in: [canonicalId, ...duplicateIds] } })
    .select('netid')
    .lean();
  const canonicalNetid =
    usersForNetids.find((user: any) => String(user._id) === group.canonicalUserId)?.netid ||
    group.canonicalUserId;
  const duplicateNetids = usersForNetids
    .filter((user: any) => group.duplicateUserIds.includes(String(user._id)))
    .map((user: any) => String(user.netid || '').trim())
    .filter(Boolean);

  await mergeCanonicalUserFields(group);

  const simpleRefResults: Record<string, number> = {};
  for (const spec of SIMPLE_USER_REF_SPECS) {
    const extraMatch = 'extraMatch' in spec ? spec.extraMatch : {};
    const result = await db.collection(spec.collection).updateMany(
      { ...extraMatch, [spec.field]: { $in: duplicateIds } },
      { $set: { [spec.field]: canonicalId } },
    );
    simpleRefResults[`${spec.collection}.${spec.field}`] = result.modifiedCount || 0;
  }

  const memberResult = await relinkResearchMembers(db, canonicalId, duplicateIds);
  const scholarlyLinkResult = await relinkScholarlyLinks(db, canonicalId, duplicateIds);

  const deleteResult = await User.deleteMany({ _id: { $in: duplicateIds } });

  return {
    ...group,
    deletedUsers: deleteResult.deletedCount || 0,
    simpleRefResults,
    researchMembers: memberResult,
    scholarlyLinks: scholarlyLinkResult,
  };
}

async function main(): Promise<void> {
  const args = parseDedupeUsersByIdentityArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'users:dedupe-by-identity',
    mongoUrl,
  });

  await mongoose.connect(mongoUrl);
  const collisions = await loadCandidateCollisions({
    limit: args.limit,
    identityField: args.identityField,
  });
  const plan = buildUserIdentityDedupePlan(collisions);
  const uniqueGroups = uniquePlannedUserIdentityDedupeGroups(plan.groups);
  const groupsToApply = args.maxApplyGroups
    ? uniqueGroups.slice(0, args.maxApplyGroups)
    : uniqueGroups;

  const applied: Record<string, unknown>[] = [];
  if (args.apply) {
    for (const group of groupsToApply) {
      applied.push(await applyGroup(group));
    }
  }

  const summary = buildUserIdentityDedupeSummary({
    apply: args.apply,
    plan,
    sampleSize: args.sampleSize,
    maxApplyGroups: args.maxApplyGroups,
    applied,
  });
  const jsonSummary = JSON.stringify(summary, null, 2);

  if (args.output) {
    await fs.mkdir(path.dirname(args.output), { recursive: true });
    await fs.writeFile(args.output, `${jsonSummary}\n`, 'utf8');
  }

  console.log(jsonSummary);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
