import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { User } from '../models/user';
import {
  buildConflictingUserIdentityCleanupPlan,
  type ConflictingUserIdentityCleanup,
} from './cleanupConflictingUserIdentitiesCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import type { UserIdentityCollision, UserIdentityField } from './dedupeUsersByIdentityCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const IDENTITY_FIELDS: UserIdentityField[] = ['email', 'orcid', 'openAlexId', 'googleScholarId'];

interface Args {
  apply: boolean;
  limit: number;
  identityField?: UserIdentityField;
}

function valueAfterEquals(arg: string, flag: string): string | undefined {
  return arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
}

function parseArgs(argv: string[]): Args {
  let apply = false;
  let limit = 5000;
  let identityField: UserIdentityField | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }

    const limitValue = valueAfterEquals(arg, '--limit') || (arg === '--limit' ? argv[++index] : '');
    if (limitValue) {
      const parsed = Number(limitValue);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--limit must be a positive integer');
      }
      limit = parsed;
      continue;
    }

    const fieldValue =
      valueAfterEquals(arg, '--identity-field') ||
      (arg === '--identity-field' ? argv[++index] : '');
    if (fieldValue) {
      if (!IDENTITY_FIELDS.includes(fieldValue as UserIdentityField)) {
        throw new Error(`--identity-field must be one of: ${IDENTITY_FIELDS.join(', ')}`);
      }
      identityField = fieldValue as UserIdentityField;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return identityField ? { apply, limit, identityField } : { apply, limit };
}

async function loadCollisions(field: UserIdentityField, limit: number): Promise<UserIdentityCollision[]> {
  const rows = await User.aggregate([
    {
      $project: {
        identityValue: {
          $trim: {
            input: {
              $toLower: {
                $ifNull: [`$${field}`, ''],
              },
            },
          },
        },
        user: {
          id: { $toString: '$_id' },
          netid: '$netid',
          email: '$email',
          fname: '$fname',
          lname: '$lname',
          orcid: '$orcid',
          openAlexId: '$openAlexId',
          googleScholarId: '$googleScholarId',
          userConfirmed: '$userConfirmed',
          lastLogin: '$lastLogin',
          lastLoginAt: '$lastLoginAt',
          lastActive: '$lastActive',
          loginCount: '$loginCount',
          departments: '$departments',
          primaryDepartment: '$primaryDepartment',
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
        count: { $sum: 1 },
      },
    },
    { $match: { 'users.1': { $exists: true } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit },
  ]);

  return rows.map((row: any) => ({
    identityField: field,
    identityValue: String(row._id || ''),
    users: row.users || [],
  }));
}

function applyUpdateForCleanup(cleanup: ConflictingUserIdentityCleanup): Record<string, any> {
  if (cleanup.identityField === 'email' && cleanup.replacementValue) {
    return { $set: { email: cleanup.replacementValue } };
  }

  return { $unset: Object.fromEntries(cleanup.unsetFields.map((field) => [field, ''])) };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'users:cleanup-conflicting-identities',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const fields = args.identityField ? [args.identityField] : IDENTITY_FIELDS;
  const collisions = (
    await Promise.all(fields.map((field) => loadCollisions(field, args.limit)))
  ).flat();
  const plan = buildConflictingUserIdentityCleanupPlan(collisions);

  const cleanupByUserAndField = new Map<string, ConflictingUserIdentityCleanup>();
  for (const cleanup of plan.cleanupUsers) {
    cleanupByUserAndField.set(`${cleanup.userId}:${cleanup.identityField}`, cleanup);
  }
  const cleanupUsers = Array.from(cleanupByUserAndField.values());

  let modified = 0;
  if (args.apply && cleanupUsers.length > 0) {
    const result = await User.bulkWrite(
      cleanupUsers.map((cleanup) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(cleanup.userId) },
          update: applyUpdateForCleanup(cleanup),
        },
      })),
      { ordered: false },
    );
    modified = result.modifiedCount || 0;
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        fields,
        candidateGroups: plan.candidateGroups,
        cleanupUsers: cleanupUsers.length,
        skippedSameNameGroups: plan.skippedSameNameGroups,
        cleanupByField: cleanupUsers.reduce<Record<string, number>>((acc, cleanup) => {
          acc[cleanup.identityField] = (acc[cleanup.identityField] || 0) + 1;
          return acc;
        }, {}),
        modified,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
