import mongoose from 'mongoose';
import type { AccountRecord } from '../models/account';
import type { ResearcherRecord } from '../models/researcher';
import type { RoleAssignmentRecord } from '../models/roleAssignment';
import {
  parsePhase0SummaryOnlyEnvironment,
  type Phase0SummaryOnlyEnvironment,
} from './phase0SummaryOnlyAudit';
import type {
  Phase2IdentityMigrationPlanReport,
  PlannedAccount,
  PlannedPerson,
  PlannedRoleAssignment,
} from './phase2IdentityMigrationPlannerCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export const PHASE2_IDENTITY_APPLY_SCRIPT_NAME = 'model-refactor:identity-apply';
export const PHASE2_IDENTITY_APPLY_CONFIRM_FLAG = '--confirm-identity-migration-apply';

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

export interface Phase2IdentityMigrationApplyArgs {
  environment: Phase0SummaryOnlyEnvironment;
  apply: boolean;
  confirm: boolean;
  documentLimit: number;
  quarantineLimit: number;
  output?: string;
}

function consumeValue(
  argv: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const arg = argv[index];
  const inline = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
  const value = inline !== undefined ? inline : arg === flag ? argv[index + 1] : undefined;
  if (value === undefined || !value.trim() || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return { value, nextIndex: inline !== undefined ? index : index + 1 };
}

function boundedPositiveInteger(value: string, flag: string, maximum: number): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${flag} must be a positive integer no greater than ${maximum}`);
  }
  return parsed;
}

export function parsePhase2IdentityMigrationApplyArgs(
  argv: string[],
): Phase2IdentityMigrationApplyArgs {
  let environment: Phase0SummaryOnlyEnvironment | undefined;
  let apply = false;
  let confirm = false;
  let documentLimit = 100_000;
  let quarantineLimit = 25_000;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--environment' || arg.startsWith('--environment=')) {
      const consumed = consumeValue(argv, index, '--environment');
      environment = parsePhase0SummaryOnlyEnvironment(consumed.value);
      index = consumed.nextIndex;
      continue;
    }
    if (arg === '--apply' || arg === '--mode=apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      apply = false;
      continue;
    }
    if (arg === PHASE2_IDENTITY_APPLY_CONFIRM_FLAG) {
      confirm = true;
      continue;
    }
    if (arg.startsWith(`${PHASE2_IDENTITY_APPLY_CONFIRM_FLAG}=`)) {
      throw new Error(`${PHASE2_IDENTITY_APPLY_CONFIRM_FLAG} does not accept a value`);
    }
    if (arg === '--document-limit' || arg.startsWith('--document-limit=')) {
      const consumed = consumeValue(argv, index, '--document-limit');
      documentLimit = boundedPositiveInteger(consumed.value, '--document-limit', 1_000_000);
      index = consumed.nextIndex;
      continue;
    }
    if (arg === '--quarantine-limit' || arg.startsWith('--quarantine-limit=')) {
      const consumed = consumeValue(argv, index, '--quarantine-limit');
      quarantineLimit = boundedPositiveInteger(consumed.value, '--quarantine-limit', 100_000);
      index = consumed.nextIndex;
      continue;
    }
    if (arg === '--output' || arg.startsWith('--output=')) {
      const consumed = consumeValue(argv, index, '--output');
      output = resolveSafeJsonReportOutputPath(consumed.value);
      index = consumed.nextIndex;
      continue;
    }
    throw new Error(`Unknown ${PHASE2_IDENTITY_APPLY_SCRIPT_NAME} option: ${arg}`);
  }

  if (!environment) {
    throw new Error(
      '--environment requires development, beta, or production-copy; Production is never allowed',
    );
  }
  return {
    environment,
    apply,
    confirm,
    documentLimit,
    quarantineLimit,
    ...(output ? { output } : {}),
  };
}

export function assertPhase2IdentityMigrationApplyAllowed(args: {
  apply: boolean;
  confirm: boolean;
}): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(
      `${PHASE2_IDENTITY_APPLY_CONFIRM_FLAG} is required when --apply is set for ${PHASE2_IDENTITY_APPLY_SCRIPT_NAME}`,
    );
  }
}

export interface CanonicalAccountDocument {
  _id: mongoose.Types.ObjectId;
  netid: string;
  email: string;
  status: AccountRecord['status'];
  archived: boolean;
}

export interface CanonicalPersonDocument {
  _id: mongoose.Types.ObjectId;
  displayName: string;
  accountId?: mongoose.Types.ObjectId;
  profileLinks: ResearcherRecord['profileLinks'];
  archived: boolean;
}

export interface CanonicalRoleAssignmentDocument {
  _id: mongoose.Types.ObjectId;
  personId: mongoose.Types.ObjectId;
  target: { kind: 'RESEARCH_ENTITY'; id: mongoose.Types.ObjectId };
  role: RoleAssignmentRecord['role'];
  state: RoleAssignmentRecord['state'];
  startedAt?: Date;
  endedAt?: Date;
  confidence: number;
  reviewStatus: RoleAssignmentRecord['reviewStatus'];
  archived: boolean;
}

export interface CanonicalWriteDocuments {
  accounts: CanonicalAccountDocument[];
  people: CanonicalPersonDocument[];
  roleAssignments: CanonicalRoleAssignmentDocument[];
}

export type CanonicalWritePlan = Pick<
  Phase2IdentityMigrationPlanReport,
  'plannedAccounts' | 'plannedPeople' | 'plannedRoleAssignments'
>;

function researchEntityObjectId(value: string): mongoose.Types.ObjectId {
  if (!OBJECT_ID_PATTERN.test(value)) {
    throw new Error(
      `${PHASE2_IDENTITY_APPLY_SCRIPT_NAME} cannot resolve research entity id "${value}" to an ObjectId`,
    );
  }
  return new mongoose.Types.ObjectId(value);
}

function accountDocument(
  account: PlannedAccount,
  objectIdFactory: () => mongoose.Types.ObjectId,
): CanonicalAccountDocument {
  return {
    _id: objectIdFactory(),
    netid: account.netid,
    email: account.email,
    status: account.status,
    archived: false,
  };
}

function personDocument(
  person: PlannedPerson,
  accountIdByKey: ReadonlyMap<string, mongoose.Types.ObjectId>,
  objectIdFactory: () => mongoose.Types.ObjectId,
): CanonicalPersonDocument {
  const document: CanonicalPersonDocument = {
    _id: objectIdFactory(),
    displayName: person.displayName,
    profileLinks: [],
    archived: false,
  };
  if (person.accountKey !== undefined) {
    const accountId = accountIdByKey.get(person.accountKey);
    if (!accountId) {
      throw new Error(
        `${PHASE2_IDENTITY_APPLY_SCRIPT_NAME} could not resolve accountKey ${person.accountKey}`,
      );
    }
    document.accountId = accountId;
  }
  return document;
}

function roleAssignmentDocument(
  role: PlannedRoleAssignment,
  personIdByKey: ReadonlyMap<string, mongoose.Types.ObjectId>,
  objectIdFactory: () => mongoose.Types.ObjectId,
): CanonicalRoleAssignmentDocument {
  const personId = personIdByKey.get(role.personKey);
  if (!personId) {
    throw new Error(
      `${PHASE2_IDENTITY_APPLY_SCRIPT_NAME} could not resolve personKey ${role.personKey}`,
    );
  }
  const document: CanonicalRoleAssignmentDocument = {
    _id: objectIdFactory(),
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: researchEntityObjectId(role.researchEntityId) },
    role: role.role,
    state: role.state,
    confidence: role.confidence,
    reviewStatus: role.reviewStatus,
    archived: false,
  };
  if (role.startedAt) document.startedAt = new Date(role.startedAt);
  if (role.state === 'HISTORICAL' && role.endedAt) document.endedAt = new Date(role.endedAt);
  return document;
}

export function buildCanonicalWriteDocuments(
  plan: CanonicalWritePlan,
  objectIdFactory: () => mongoose.Types.ObjectId = () => new mongoose.Types.ObjectId(),
): CanonicalWriteDocuments {
  const accountIdByKey = new Map<string, mongoose.Types.ObjectId>();
  const accounts = plan.plannedAccounts.map((account) => {
    const document = accountDocument(account, objectIdFactory);
    accountIdByKey.set(account.accountKey, document._id);
    return document;
  });

  const personIdByKey = new Map<string, mongoose.Types.ObjectId>();
  const people = plan.plannedPeople.map((person) => {
    const document = personDocument(person, accountIdByKey, objectIdFactory);
    personIdByKey.set(person.personKey, document._id);
    return document;
  });

  const roleAssignments = plan.plannedRoleAssignments.map((role) =>
    roleAssignmentDocument(role, personIdByKey, objectIdFactory),
  );

  return { accounts, people, roleAssignments };
}

export interface Phase2IdentityMigrationApplyReport {
  generatedAt: string;
  environment: Phase0SummaryOnlyEnvironment;
  databaseName: string;
  sourceCommit: string;
  mode: 'dry-run' | 'apply';
  sourceCounts: {
    users: number;
    facultyMembers: number;
    memberships: number;
    researchEntities: number;
  };
  planned: {
    accounts: number;
    people: number;
    roleAssignments: number;
    quarantinedSubjects: number;
  };
  written: {
    accounts: number;
    people: number;
    roleAssignments: number;
  };
  scanComplete: boolean;
}

export function buildPhase2IdentityMigrationApplyReport(args: {
  environment: Phase0SummaryOnlyEnvironment;
  databaseName: string;
  mode: 'dry-run' | 'apply';
  plan: Phase2IdentityMigrationPlanReport;
  written: Phase2IdentityMigrationApplyReport['written'];
  generatedAt?: string;
}): Phase2IdentityMigrationApplyReport {
  return {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    environment: args.environment,
    databaseName: args.databaseName,
    sourceCommit: args.plan.sourceCommit,
    mode: args.mode,
    sourceCounts: {
      users: args.plan.scan.documentsScanned.users,
      facultyMembers: args.plan.scan.documentsScanned.facultyMembers,
      memberships: args.plan.scan.documentsScanned.memberships,
      researchEntities: args.plan.scan.documentsScanned.researchEntities,
    },
    planned: {
      accounts: args.plan.summary.plannedAccounts,
      people: args.plan.summary.plannedPeople,
      roleAssignments: args.plan.summary.plannedRoleAssignments,
      quarantinedSubjects: args.plan.summary.quarantinedSubjects,
    },
    written: args.written,
    scanComplete: args.plan.scan.complete,
  };
}
