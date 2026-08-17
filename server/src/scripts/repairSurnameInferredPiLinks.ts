import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  classifySurnameInferredPiMember,
  summarizeSurnameInferredPiClassifications,
  type SurnameInferredPiCandidateUser,
  type SurnameInferredPiClassification,
} from './repairSurnameInferredPiLinksCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEFAULT_SLUG_PREFIX = 'ysm-';
const LEAD_FACULTY_USER_TYPES = ['professor', 'faculty'];

export interface RepairSurnameInferredPiArgs {
  apply: boolean;
  confirm: boolean;
  slug?: string;
  maxApply: number;
  output: string;
  backup: string;
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  if (!value || !/^[1-9]\d*$/.test(value)) throw new Error(`${flag} requires a positive integer`);
  return Number(value);
}

export function parseArgs(argv: string[]): RepairSurnameInferredPiArgs {
  const args: RepairSurnameInferredPiArgs = {
    apply: false,
    confirm: false,
    maxApply: 300,
    output: resolveSafeJsonReportOutputPath('tmp/surname-inferred-pi-repair-report.json'),
    backup: resolveSafeJsonReportOutputPath('tmp/surname-inferred-pi-repair-backup.json'),
  };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--confirm-surname-inferred-pi-repair') args.confirm = true;
    else if (arg.startsWith('--slug=')) {
      args.slug = arg.slice('--slug='.length).trim();
      if (!args.slug) throw new Error('--slug requires a value');
    } else if (arg.startsWith('--max-apply='))
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length), '--max-apply');
    else if (arg.startsWith('--output='))
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    else if (arg.startsWith('--backup='))
      args.backup = resolveSafeJsonReportOutputPath(arg.slice('--backup='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.apply && !args.confirm) {
    throw new Error('--confirm-surname-inferred-pi-repair is required with --apply');
  }
  return args;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const normalizedFullName = (user?: SurnameInferredPiCandidateUser | null): string =>
  user
    ? [user.firstName, user.lastName]
        .map((part) => (part || '').trim())
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    : '';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.MONGODBURL) throw new Error('MONGODBURL is required');
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:repair-surname-inferred-pi',
    mongoUrl: process.env.MONGODBURL,
  });
  await mongoose.connect(process.env.MONGODBURL);

  const entityFilter = args.slug
    ? { slug: args.slug }
    : { slug: { $regex: `^${DEFAULT_SLUG_PREFIX}` } };
  const entities = await ResearchEntity.find(entityFilter)
    .select('_id slug name contactName contactEmail contactRole')
    .lean();
  const entityById = new Map(entities.map((entity) => [String(entity._id), entity]));
  const entityIds = entities.map((entity) => entity._id);

  const members = await ResearchGroupMember.find({
    researchEntityId: { $in: entityIds },
    role: 'pi',
    isCurrentMember: { $ne: false },
    archived: { $ne: true },
  })
    .select('_id researchEntityId userId sourceName sourceUrl confidence')
    .lean();

  const linkedUserIds = Array.from(
    new Set(members.map((member) => String(member.userId || '')).filter(Boolean)),
  );
  const linkedUsers = await User.find({ _id: { $in: linkedUserIds } })
    .select('_id fname lname primaryDepartment')
    .lean();
  const userById = new Map(
    linkedUsers.map((user) => [
      String(user._id),
      {
        id: String(user._id),
        firstName: user.fname,
        lastName: user.lname,
        primaryDepartment: user.primaryDepartment,
      } as SurnameInferredPiCandidateUser,
    ]),
  );

  const surnames = Array.from(
    new Set(
      linkedUsers
        .map((user) => String(user.lname || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const sameSurnameFacultyBySurname = new Map<string, SurnameInferredPiCandidateUser[]>();
  await Promise.all(
    surnames.map(async (surname) => {
      const faculty = await User.find({
        lname: new RegExp(`^${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        userType: { $in: LEAD_FACULTY_USER_TYPES },
      })
        .select('_id fname lname primaryDepartment')
        .lean();
      sameSurnameFacultyBySurname.set(
        surname,
        faculty.map((user) => ({
          id: String(user._id),
          firstName: user.fname,
          lastName: user.lname,
          primaryDepartment: user.primaryDepartment,
        })),
      );
    }),
  );

  const classifications: Array<
    SurnameInferredPiClassification & { linkedUserId?: string; entitySlug?: string }
  > = members.map((member) => {
    const entity = entityById.get(String(member.researchEntityId));
    const linkedUser = userById.get(String(member.userId || '')) || null;
    const surname = String(linkedUser?.lastName || '').trim().toLowerCase();
    return classifySurnameInferredPiMember({
      memberId: String(member._id),
      entityId: String(member.researchEntityId),
      entitySlug: entity?.slug,
      entityName: entity?.name,
      linkedUser,
      sameSurnameFaculty: surname ? sameSurnameFacultyBySurname.get(surname) || [] : [],
    });
  });

  const retirePlans = classifications.filter((item) => item.verdict === 'retire');
  const summary = summarizeSurnameInferredPiClassifications(classifications);

  if (args.apply && retirePlans.length > args.maxApply) {
    throw new Error(
      `Repair would retire ${retirePlans.length} PI links, above --max-apply=${args.maxApply}`,
    );
  }

  writeJson(args.backup, {
    generatedAt: new Date(),
    target: guard.dbLabel,
    entityFilter,
    retireMembers: retirePlans.map((plan) => {
      const member = members.find((row) => String(row._id) === plan.memberId);
      const entity = entityById.get(plan.entityId);
      return { plan, member, entity };
    }),
  });

  const applied: Array<{
    memberId: string;
    entitySlug?: string;
    reason: string;
    retiredMember: boolean;
    supersededObservations: number;
    clearedContact: boolean;
  }> = [];

  if (args.apply) {
    const now = new Date();
    for (const plan of retirePlans) {
      const memberUpdate = await ResearchGroupMember.updateOne(
        { _id: plan.memberId, isCurrentMember: { $ne: false }, archived: { $ne: true } },
        {
          $set: {
            isCurrentMember: false,
            archived: true,
            evidenceStatus: 'historical',
            leftAt: now,
            endedAt: now,
            lastObservedAt: now,
          },
        },
      );
      if (memberUpdate.modifiedCount !== 1) {
        throw new Error(`Atomic retire precondition failed for member ${plan.memberId}`);
      }

      let supersededObservations = 0;
      if (plan.entitySlug && plan.linkedUserId) {
        const observationUpdate = await Observation.updateMany(
          {
            entityType: 'researchEntity',
            entityKey: plan.entitySlug,
            field: 'inferredPiUserId',
            value: plan.linkedUserId,
            superseded: { $ne: true },
          },
          { $set: { superseded: true } },
        );
        supersededObservations = observationUpdate.modifiedCount || 0;
      }

      const entity = entityById.get(plan.entityId);
      const linkedUser = userById.get(plan.linkedUserId || '') || null;
      const clearContact =
        Boolean(entity?.contactName) &&
        normalizedFullName(linkedUser) === String(entity?.contactName || '').trim().toLowerCase();
      if (clearContact) {
        await ResearchEntity.updateOne(
          { _id: plan.entityId },
          { $set: { contactName: '', contactEmail: '', contactRole: '' } },
        );
      }

      applied.push({
        memberId: plan.memberId,
        entitySlug: plan.entitySlug,
        reason: plan.reason,
        retiredMember: true,
        supersededObservations,
        clearedContact: clearContact,
      });
    }
  }

  let visibilityRecomputed = 0;
  if (args.apply && applied.length > 0) {
    const affectedEntityIds = Array.from(
      new Set(retirePlans.map((plan) => plan.entityId).filter(Boolean)),
    );
    if (affectedEntityIds.length > 0) {
      const gateResult = await runStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: affectedEntityIds,
      });
      visibilityRecomputed = gateResult.counts.scanned;
    }
  }

  const report = {
    generatedAt: new Date(),
    mode: args.apply ? 'apply' : 'dry-run',
    target: guard.dbLabel,
    environment: guard.environment,
    entityFilter,
    backup: args.backup,
    summary,
    maxApply: args.maxApply,
    visibilityRecomputed,
    retirePlans: retirePlans.map((plan) => ({
      memberId: plan.memberId,
      entitySlug: plan.entitySlug,
      entityName: plan.entityName,
      linkedUserId: plan.linkedUserId,
      linkedUserName: plan.linkedUserName,
      linkedUserDepartment: plan.linkedUserDepartment,
      reason: plan.reason,
      correctedUserId: plan.correctedUserId,
    })),
    applied,
  };
  writeJson(args.output, report);
  console.log(
    JSON.stringify(
      { output: args.output, backup: args.backup, mode: report.mode, summary, visibilityRecomputed },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

if (process.env.NODE_ENV !== 'test' && process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(async (error) => {
    console.error('Surname-inferred PI repair failed:', sanitizeLogValue(error));
    await mongoose.disconnect();
    process.exit(1);
  });
}
