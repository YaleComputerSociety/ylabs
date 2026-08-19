import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import type { Db, Document } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { Account } from '../models/account';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import {
  assertOperatorEnvironmentMatchesDatabase,
  databaseNameFromMongoUrl,
} from './operatorDatabaseEnvironment';
import {
  buildPhase2IdentityMigrationPlan,
  type LegacyIdentityFacultyMember,
  type LegacyIdentityMembership,
  type LegacyIdentityUser,
} from './phase2IdentityMigrationPlannerCore';
import {
  PHASE2_PROJECTIONS,
  facultyMemberFromDocument,
  membershipFromDocument,
  researchEntityIdFromDocument,
  userFromDocument,
} from './phase2IdentityMigrationPlan';
import {
  assertPhase2IdentityMigrationApplyAllowed,
  buildCanonicalWriteDocuments,
  buildPhase2IdentityMigrationApplyReport,
  parsePhase2IdentityMigrationApplyArgs,
  PHASE2_IDENTITY_APPLY_SCRIPT_NAME,
  type CanonicalWriteDocuments,
  type Phase2IdentityMigrationApplyArgs,
} from './phase2IdentityMigrationApplyCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '../../..');
const FULL_COMMIT_PATTERN = /^[a-f0-9]{40}$/;

function resolvePhase2IdentityApplySourceCommit(): string {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sourceCommit = head.stdout?.trim();
  return head.status === 0 && FULL_COMMIT_PATTERN.test(sourceCommit || '')
    ? (sourceCommit as string)
    : 'unknown';
}

async function loadBoundedNormalRead<T>(
  db: Db,
  collectionName: keyof typeof PHASE2_PROJECTIONS,
  mapDocument: (document: Document) => T,
  documentLimit: number,
): Promise<{ documents: T[]; truncated: boolean }> {
  const cursor = db
    .collection(collectionName)
    .find(
      {},
      {
        projection: PHASE2_PROJECTIONS[collectionName],
        comment: 'ylabs-phase2:identity-migration-apply',
      },
    )
    .sort({ _id: 1 })
    .limit(documentLimit + 1)
    .batchSize(500);
  const documents: T[] = [];
  let truncated = false;
  for await (const document of cursor) {
    if (documents.length >= documentLimit) {
      truncated = true;
      break;
    }
    documents.push(mapDocument(document));
  }
  return { documents, truncated };
}

export async function loadLegacyIdentitySources(documentLimit: number): Promise<{
  users: { documents: LegacyIdentityUser[]; truncated: boolean };
  facultyMembers: { documents: LegacyIdentityFacultyMember[]; truncated: boolean };
  memberships: { documents: LegacyIdentityMembership[]; truncated: boolean };
  researchEntities: { documents: string[]; truncated: boolean };
}> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error(`${PHASE2_IDENTITY_APPLY_SCRIPT_NAME} requires an active database connection`);
  }
  const users = await loadBoundedNormalRead(db, 'users', userFromDocument, documentLimit);
  const facultyMembers = await loadBoundedNormalRead(
    db,
    'faculty_members',
    facultyMemberFromDocument,
    documentLimit,
  );
  const memberships = await loadBoundedNormalRead(
    db,
    'research_entity_members',
    membershipFromDocument,
    documentLimit,
  );
  const researchEntities = await loadBoundedNormalRead(
    db,
    'research_entities',
    researchEntityIdFromDocument,
    documentLimit,
  );
  return { users, facultyMembers, memberships, researchEntities };
}

export async function replaceCanonicalIdentityCollections(
  documents: CanonicalWriteDocuments,
): Promise<{ accounts: number; people: number; roleAssignments: number }> {
  await RoleAssignment.deleteMany({});
  await Researcher.deleteMany({});
  await Account.deleteMany({});

  const accounts = documents.accounts.length
    ? await Account.insertMany(documents.accounts, { ordered: true })
    : [];
  const people = documents.people.length
    ? await Researcher.insertMany(documents.people, { ordered: true })
    : [];
  const roleAssignments = documents.roleAssignments.length
    ? await RoleAssignment.insertMany(documents.roleAssignments, { ordered: true })
    : [];

  return {
    accounts: accounts.length,
    people: people.length,
    roleAssignments: roleAssignments.length,
  };
}

export function writePhase2IdentityMigrationApplyOutput(report: object, output: string): void {
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  const parent = path.dirname(safeOutput);
  let parentStat: fs.Stats;
  let realParent: string;
  try {
    parentStat = fs.lstatSync(parent);
    realParent = fs.realpathSync.native(parent);
  } catch {
    throw new Error('Unable to validate the private Phase 2 identity-apply report location.');
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || realParent !== parent) {
    throw new Error('The Phase 2 identity-apply report parent must be a real directory.');
  }
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  fs.chmodSync(safeOutput, 0o600);
}

export async function applyPhase2IdentityMigration(args: {
  apply: boolean;
  environment: Phase2IdentityMigrationApplyArgs['environment'];
  databaseName: string;
  sourceCommit: string;
  documentLimit: number;
  quarantineLimit: number;
}) {
  const sources = await loadLegacyIdentitySources(args.documentLimit);
  const plan = buildPhase2IdentityMigrationPlan({
    users: sources.users.documents,
    facultyMembers: sources.facultyMembers.documents,
    memberships: sources.memberships.documents,
    knownResearchEntityIds: sources.researchEntities.documents,
    environment: args.environment,
    databaseName: args.databaseName,
    sourceCommit: args.sourceCommit,
    limits: {
      documentsPerCollection: args.documentLimit,
      quarantineRecords: args.quarantineLimit,
    },
    truncation: {
      users: sources.users.truncated,
      facultyMembers: sources.facultyMembers.truncated,
      memberships: sources.memberships.truncated,
      researchEntities: sources.researchEntities.truncated,
    },
  });

  const documents = buildCanonicalWriteDocuments(plan);
  const written = args.apply
    ? await replaceCanonicalIdentityCollections(documents)
    : { accounts: 0, people: 0, roleAssignments: 0 };

  return buildPhase2IdentityMigrationApplyReport({
    environment: args.environment,
    databaseName: args.databaseName,
    mode: args.apply ? 'apply' : 'dry-run',
    plan,
    written,
  });
}

async function runPhase2IdentityMigrationApply(
  args: Phase2IdentityMigrationApplyArgs,
  mongoUrl: string,
): Promise<void> {
  assertPhase2IdentityMigrationApplyAllowed({ apply: args.apply, confirm: args.confirm });
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: PHASE2_IDENTITY_APPLY_SCRIPT_NAME,
    mongoUrl,
  });
  const configuredDatabaseName = databaseNameFromMongoUrl(mongoUrl);
  assertOperatorEnvironmentMatchesDatabase(args.environment, configuredDatabaseName);
  const sourceCommit = resolvePhase2IdentityApplySourceCommit();

  await initializeConnections();
  try {
    const databaseName = mongoose.connection.db?.databaseName ?? configuredDatabaseName;
    assertOperatorEnvironmentMatchesDatabase(args.environment, databaseName);

    const report = await applyPhase2IdentityMigration({
      apply: args.apply,
      environment: args.environment,
      databaseName,
      sourceCommit,
      documentLimit: args.documentLimit,
      quarantineLimit: args.quarantineLimit,
    });

    console.log(JSON.stringify({ ...report, db: guard.dbLabel }, null, 2));
    if (args.output) {
      writePhase2IdentityMigrationApplyOutput({ ...report, db: guard.dbLabel }, args.output);
    }
  } finally {
    await mongoose.disconnect();
  }
}

async function main(): Promise<void> {
  const args = parsePhase2IdentityMigrationApplyArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  await runPhase2IdentityMigrationApply(args, mongoUrl);
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`${PHASE2_IDENTITY_APPLY_SCRIPT_NAME} failed:`, sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
