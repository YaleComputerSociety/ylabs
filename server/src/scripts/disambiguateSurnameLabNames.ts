import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ACTIVE_FILTER = { archived: { $ne: true } };
const DEFAULT_LIMIT = 10000;
const DEFAULT_MAX_APPLY = 25;
const SURNAME_LAB_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export interface DisambiguateSurnameLabArgs {
  apply: boolean;
  confirmSurnameLabDisambiguation: boolean;
  limit: number;
  limitExplicit: boolean;
  maxApply: number;
  output?: string;
}

export interface SurnameLabEntityInput {
  id: string;
  name: string;
  displayName?: string;
  slug?: string;
  manuallyLockedFields?: string[];
}

export interface SurnameLabMemberInput {
  researchEntityId: string;
  userId?: string;
  role?: string;
  isCurrentMember?: boolean;
  archived?: boolean;
}

export interface SurnameLabUserInput {
  id: string;
  fname?: string;
  lname?: string;
  netid?: string;
}

export interface SurnameLabDisambiguationPlan {
  entityId: string;
  slug?: string;
  oldName: string;
  newName: string;
  oldDisplayName?: string;
  newDisplayName?: string;
  piUserId: string;
  piName: string;
  normalizedClusterName: string;
}

export interface SurnameLabDisambiguationSkipped {
  entityId?: string;
  name?: string;
  reason: string;
}

export interface SurnameLabDisambiguationResult {
  plans: SurnameLabDisambiguationPlan[];
  skipped: SurnameLabDisambiguationSkipped[];
}

interface ApplyResult {
  entityId: string;
  slug?: string;
  oldName: string;
  newName: string;
  matchedCount: number;
  modifiedCount: number;
}

export function normalizeSurnameLabObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!SURNAME_LAB_OBJECT_ID_RE.test(trimmed)) return undefined;
  return new mongoose.Types.ObjectId(trimmed);
}

function consumeValue(argv: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const value = argv[index + 1];
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return { value, nextIndex: index + 1 };
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseDisambiguateSurnameLabArgs(argv: string[]): DisambiguateSurnameLabArgs {
  const args: DisambiguateSurnameLabArgs = {
    apply: false,
    confirmSurnameLabDisambiguation: false,
    limit: DEFAULT_LIMIT,
    limitExplicit: false,
    maxApply: DEFAULT_MAX_APPLY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--confirm-surname-lab-disambiguation') {
      args.confirmSurnameLabDisambiguation = true;
      continue;
    }
    if (arg.startsWith('--confirm-surname-lab-disambiguation=')) {
      throw new Error('--confirm-surname-lab-disambiguation does not accept a value');
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      args.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      args.limitExplicit = true;
      continue;
    }
    if (arg === '--limit') {
      const { value, nextIndex } = consumeValue(argv, index, '--limit');
      args.limit = parsePositiveInteger(value, '--limit');
      args.limitExplicit = true;
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--max-apply=')) {
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length), '--max-apply');
      continue;
    }
    if (arg === '--max-apply') {
      const { value, nextIndex } = consumeValue(argv, index, '--max-apply');
      args.maxApply = parsePositiveInteger(value, '--max-apply');
      index = nextIndex;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length).trim());
      continue;
    }
    if (arg === '--output') {
      const { value, nextIndex } = consumeValue(argv, index, '--output');
      args.output = resolveSafeJsonReportOutputPath(value);
      index = nextIndex;
      continue;
    }
    throw new Error(`Unknown surname-lab disambiguation option: ${arg}`);
  }

  return args;
}

export function assertDisambiguateSurnameLabApplyAllowed(
  args: DisambiguateSurnameLabArgs,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (args.apply && !args.confirmSurnameLabDisambiguation) {
    throw new Error(
      '--confirm-surname-lab-disambiguation is required when --apply is set for research-entity:disambiguate-surname-labs.',
    );
  }
  if (args.apply && (!args.limitExplicit || !Number.isFinite(args.limit))) {
    throw new Error('--limit is required when --apply is set for research-entity:disambiguate-surname-labs.');
  }
  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:disambiguate-surname-labs',
    mongoUrl,
    env,
  });
}

export function normalizeNameKey(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function singleSurnameLabName(value: string): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^([A-Za-z][A-Za-z.'-]*) Lab$/);
  return match ? match[1] : null;
}

function cleanNamePart(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

export function personDisplayName(user: SurnameLabUserInput): string {
  return [cleanNamePart(user.fname), cleanNamePart(user.lname)].filter(Boolean).join(' ');
}

function lnameMatchesSurname(lname: string | undefined, surname: string): boolean {
  return normalizeNameKey(lname || '') === normalizeNameKey(surname);
}

function isPiLikeRole(role: string | undefined): boolean {
  return role === 'pi' || role === 'director' || role === 'co-pi' || role === 'co-director';
}

export function buildSurnameLabDisambiguationPlans(input: {
  entities: SurnameLabEntityInput[];
  members: SurnameLabMemberInput[];
  users: SurnameLabUserInput[];
  existingActiveNames?: string[];
}): SurnameLabDisambiguationResult {
  const skipped: SurnameLabDisambiguationSkipped[] = [];
  const usersById = new Map(input.users.map((user) => [user.id, user]));
  const membersByEntityId = new Map<string, SurnameLabMemberInput[]>();
  for (const member of input.members) {
    if (!member.researchEntityId) continue;
    membersByEntityId.set(member.researchEntityId, [
      ...(membersByEntityId.get(member.researchEntityId) || []),
      member,
    ]);
  }

  const duplicateClusters = new Map<string, SurnameLabEntityInput[]>();
  for (const entity of input.entities) {
    const key = normalizeNameKey(entity.name || '');
    if (!key) continue;
    duplicateClusters.set(key, [...(duplicateClusters.get(key) || []), entity]);
  }

  const existingNameKeys = new Map<string, number>();
  for (const name of input.existingActiveNames || input.entities.map((entity) => entity.name)) {
    const key = normalizeNameKey(name || '');
    if (!key) continue;
    existingNameKeys.set(key, (existingNameKeys.get(key) || 0) + 1);
  }

  const plans: SurnameLabDisambiguationPlan[] = [];
  for (const [clusterName, entities] of duplicateClusters) {
    if (entities.length < 2) continue;

    const proposedForCluster: SurnameLabDisambiguationPlan[] = [];
    for (const entity of entities) {
      const surname = singleSurnameLabName(entity.name);
      if (!surname) {
        skipped.push({ entityId: entity.id, name: entity.name, reason: 'not_single_surname_lab' });
        continue;
      }
      if (entity.manuallyLockedFields?.includes('name')) {
        skipped.push({ entityId: entity.id, name: entity.name, reason: 'name_manually_locked' });
        continue;
      }

      const piMembers = (membersByEntityId.get(entity.id) || []).filter(
        (member) =>
          isPiLikeRole(member.role) &&
          member.archived !== true &&
          member.isCurrentMember !== false &&
          !!member.userId,
      );
      const matchingUsers = piMembers
        .map((member) => usersById.get(member.userId || ''))
        .filter((user): user is SurnameLabUserInput => !!user)
        .filter((user) => lnameMatchesSurname(user.lname, surname));
      const uniqueUsers = Array.from(new Map(matchingUsers.map((user) => [user.id, user])).values());

      if (uniqueUsers.length !== 1) {
        skipped.push({
          entityId: entity.id,
          name: entity.name,
          reason: uniqueUsers.length === 0 ? 'missing_exact_pi_user' : 'ambiguous_pi_user',
        });
        continue;
      }

      const piUser = uniqueUsers[0];
      const piName = personDisplayName(piUser);
      if (!piName || normalizeNameKey(piName) === normalizeNameKey(surname)) {
        skipped.push({ entityId: entity.id, name: entity.name, reason: 'weak_pi_name' });
        continue;
      }

      const newName = `${piName} Lab`;
      const newNameKey = normalizeNameKey(newName);
      const existingCount = existingNameKeys.get(newNameKey) || 0;
      if (existingCount > 0 && normalizeNameKey(entity.name) !== newNameKey) {
        skipped.push({
          entityId: entity.id,
          name: entity.name,
          reason: 'proposed_name_collides_with_existing_entity',
        });
        continue;
      }

      const updateDisplayName =
        !entity.displayName || normalizeNameKey(entity.displayName) === normalizeNameKey(entity.name);
      proposedForCluster.push({
        entityId: entity.id,
        slug: entity.slug,
        oldName: entity.name,
        newName,
        oldDisplayName: entity.displayName,
        newDisplayName: updateDisplayName ? newName : undefined,
        piUserId: piUser.id,
        piName,
        normalizedClusterName: clusterName,
      });
    }

    const proposedNameKeys = new Set(proposedForCluster.map((plan) => normalizeNameKey(plan.newName)));
    if (proposedForCluster.length !== entities.length || proposedNameKeys.size !== proposedForCluster.length) {
      for (const entity of entities) {
        if (!proposedForCluster.some((plan) => plan.entityId === entity.id)) continue;
        skipped.push({
          entityId: entity.id,
          name: entity.name,
          reason: 'cluster_not_fully_disambiguated',
        });
      }
      continue;
    }

    plans.push(...proposedForCluster);
  }

  plans.sort((left, right) => left.oldName.localeCompare(right.oldName) || left.newName.localeCompare(right.newName));
  return { plans, skipped };
}

function writeOutput(report: unknown, output?: string): void {
  const serialized = JSON.stringify(report, null, 2);
  if (output) {
    const safeOutput = resolveSafeJsonReportOutputPath(output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${serialized}\n`);
  }
  console.log(serialized);
}

async function applyPlans(plans: SurnameLabDisambiguationPlan[], maxApply: number): Promise<ApplyResult[]> {
  const bounded = plans.slice(0, maxApply);
  const applied: ApplyResult[] = [];
  for (const plan of bounded) {
    const entityObjectId = normalizeSurnameLabObjectId(plan.entityId);
    if (!entityObjectId) {
      applied.push({
        entityId: plan.entityId,
        slug: plan.slug,
        oldName: plan.oldName,
        newName: plan.newName,
        matchedCount: 0,
        modifiedCount: 0,
      });
      continue;
    }
    const $set: Record<string, unknown> = { name: plan.newName };
    if (plan.newDisplayName) $set.displayName = plan.newDisplayName;
    const result = await ResearchEntity.updateOne(
      {
        _id: entityObjectId,
        archived: { $ne: true },
        name: plan.oldName,
        manuallyLockedFields: { $ne: 'name' },
      },
      { $set },
    );
    applied.push({
      entityId: plan.entityId,
      slug: plan.slug,
      oldName: plan.oldName,
      newName: plan.newName,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  }
  return applied;
}

export async function runDisambiguateSurnameLabNames(args: DisambiguateSurnameLabArgs) {
  const guard = assertDisambiguateSurnameLabApplyAllowed(args, process.env, process.env.MONGODBURL);

  const entityRows = (await ResearchEntity.find({
    ...ACTIVE_FILTER,
    name: { $regex: /^[A-Za-z][A-Za-z.'-]* Lab$/ },
  })
    .select('_id slug name displayName manuallyLockedFields')
    .sort({ name: 1, slug: 1 })
    .limit(args.limit)
    .lean()) as any[];
  const entityIds = entityRows.map((entity) => entity._id);
  const memberRows = (await ResearchGroupMember.find({
    researchEntityId: { $in: entityIds },
    archived: { $ne: true },
    role: { $in: ['pi', 'director', 'co-pi', 'co-director'] },
  })
    .select('researchEntityId userId role isCurrentMember archived')
    .lean()) as any[];
  const userIds = memberRows
    .map((member) => member.userId)
    .filter((id): id is mongoose.Types.ObjectId => !!id);
  const userRows = (await User.find({ _id: { $in: userIds } })
    .select('_id fname lname netid')
    .lean()) as any[];
  const existingNames = (
    (await ResearchEntity.find(ACTIVE_FILTER).select('name').lean()) as Array<{ name?: string }>
  ).map((entity) => entity.name || '');

  const result = buildSurnameLabDisambiguationPlans({
    entities: entityRows.map((entity) => ({
      id: serializedDocumentId(entity._id) || '',
      slug: entity.slug,
      name: entity.name,
      displayName: entity.displayName,
      manuallyLockedFields: entity.manuallyLockedFields || [],
    })),
    members: memberRows.map((member) => ({
      researchEntityId: serializedDocumentId(member.researchEntityId) || '',
      userId: serializedDocumentId(member.userId),
      role: member.role,
      isCurrentMember: member.isCurrentMember,
      archived: member.archived,
    })),
    users: userRows.map((user) => ({
      id: serializedDocumentId(user._id) || '',
      fname: user.fname,
      lname: user.lname,
      netid: user.netid,
    })),
    existingActiveNames: existingNames,
  });

  const applied = args.apply ? await applyPlans(result.plans, args.maxApply) : [];
  return {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    options: args,
    scannedSingleSurnameLabs: entityRows.length,
    planned: result.plans.length,
    skipped: result.skipped.length,
    appliedCount: applied.length,
    plans: result.plans,
    skippedRows: result.skipped,
    applied,
  };
}

export async function main() {
  const args = parseDisambiguateSurnameLabArgs(process.argv.slice(2));
  assertDisambiguateSurnameLabApplyAllowed(args, process.env, process.env.MONGODBURL);
  await initializeConnections();
  try {
    const report = await runDisambiguateSurnameLabNames(args);
    writeOutput(report, args.output);
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('Failed to disambiguate surname lab names:', sanitizeLogValue(error));
    process.exit(1);
  });
}
