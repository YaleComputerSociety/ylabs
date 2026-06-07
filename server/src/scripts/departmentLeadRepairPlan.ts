import dotenv from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import {
  buildDepartmentLeadRepairApplyOperations,
  buildDepartmentLeadRepairPlan,
  compareDepartmentLeadRepairPlans,
  type DepartmentLeadRepairPlanReport,
} from './departmentLeadRepairPlanCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

function valuesForArg(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith(`--${name}=`)) {
      values.push(...arg.slice(name.length + 3).split(','));
    } else if (arg === `--${name}` && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      values.push(...argv[index + 1].split(','));
      index += 1;
    }
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function parseArgs(argv: string[]) {
  return {
    slugs: [...valuesForArg(argv, 'slug'), ...valuesForArg(argv, 'slugs')],
    output: valuesForArg(argv, 'output')[0],
    expectPlan: valuesForArg(argv, 'expect-plan')[0],
    apply: argv.includes('--apply'),
    confirmPlannedCount: Number(valuesForArg(argv, 'confirm-planned-count')[0] || NaN),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.slugs.length === 0) {
    throw new Error('department-leads:repair-plan requires --slug=<slug> or --slugs=<a,b>');
  }
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'department-leads:repair-plan',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();

  const entities = await ResearchEntity.find({ slug: { $in: options.slugs }, archived: { $ne: true } })
    .select('_id slug name displayName')
    .lean();
  const entityIds = entities.map((entity: any) => entity._id);
  const slugs = entities.map((entity: any) => entity.slug).filter(Boolean);

  const observations = await Observation.find({
    entityType: 'researchEntity',
    field: { $in: ['inferredPiUserKey', 'contactName', 'contactEmail', 'contactRole'] },
    superseded: { $ne: true },
    $or: [{ entityId: { $in: entityIds } }, { entityKey: { $in: slugs } }],
  })
    .select('entityId entityKey field value sourceName sourceUrl confidence observedAt')
    .lean();

  const netids = observations
    .filter((observation: any) => observation.field === 'inferredPiUserKey')
    .map((observation: any) => String(observation.value || '').replace(/^netid:/i, '').trim())
    .filter(Boolean);
  const inferredUserKeys = observations
    .filter((observation: any) => observation.field === 'inferredPiUserKey')
    .map((observation: any) => String(observation.value || '').trim())
    .filter(Boolean);
  const inferredUserObservations = await Observation.find({
    entityType: 'user',
    entityKey: { $in: inferredUserKeys },
    field: { $in: ['netid', 'email', 'fname', 'lname'] },
    superseded: { $ne: true },
  })
    .select('entityKey field value')
    .lean();
  const inferredUserFacts = new Map<string, Record<string, string>>();
  for (const observation of inferredUserObservations as any[]) {
    const key = String(observation.entityKey || '');
    if (!key) continue;
    inferredUserFacts.set(key, {
      ...(inferredUserFacts.get(key) || {}),
      [observation.field]: String(observation.value || '').trim(),
    });
  }
  const inferredNetids = Array.from(inferredUserFacts.values())
    .map((facts) => facts.netid)
    .filter(Boolean);
  const inferredEmails = Array.from(inferredUserFacts.values())
    .map((facts) => facts.email?.toLowerCase())
    .filter(Boolean);
  const emails = observations
    .filter((observation: any) => observation.field === 'contactEmail')
    .map((observation: any) => String(observation.value || '').trim().toLowerCase())
    .filter(Boolean);
  const names = observations
    .filter((observation: any) => observation.field === 'contactName')
    .map((observation: any) => String(observation.value || '').trim())
    .filter(Boolean);

  const nameClauses: Record<string, unknown>[] = [];
  for (const name of names) {
    const [first, ...rest] = name.split(/\s+/);
    const last = rest.join(' ');
    if (first && last) {
      nameClauses.push({
        fname: new RegExp(`^${escapeRegExp(first)}$`, 'i'),
        lname: new RegExp(`^${escapeRegExp(last)}$`, 'i'),
      });
    }
  }
  const userClauses: Record<string, unknown>[] = [
    ...(netids.length + inferredNetids.length > 0 ? [{ netid: { $in: [...netids, ...inferredNetids] } }] : []),
    ...(emails.length + inferredEmails.length > 0 ? [{ email: { $in: [...emails, ...inferredEmails] } }] : []),
    ...nameClauses,
  ];

  const users = await User.find(userClauses.length > 0 ? { $or: userClauses } : { _id: { $exists: false } })
    .select('_id netid email fname lname')
    .lean();

  const existingMembers = await ResearchGroupMember.find({
    researchEntityId: { $in: entityIds },
    role: { $in: ['pi', 'co-pi', 'director', 'co-director'] },
    isCurrentMember: { $ne: false },
  })
    .select('researchEntityId userId role isCurrentMember')
    .lean();

  const report = buildDepartmentLeadRepairPlan({
    entities: entities.map((entity: any) => ({
      id: String(entity._id),
      slug: entity.slug,
      name: entity.displayName || entity.name,
    })),
    observations: observations.map((observation: any) => ({
      entityId: observation.entityId ? String(observation.entityId) : undefined,
      entityKey: observation.entityKey,
      field: observation.field,
      value: observation.value,
      sourceName: observation.sourceName,
      sourceUrl: observation.sourceUrl,
      confidence: observation.confidence,
      observedAt: observation.observedAt,
    })),
    users: users.map((user: any) => ({
      id: String(user._id),
      netid: user.netid,
      email: user.email,
      fname: user.fname,
      lname: user.lname,
      entityKeys: Array.from(inferredUserFacts.entries())
        .filter(([, facts]) => facts.netid === user.netid || normalizeEmail(facts.email) === normalizeEmail(user.email))
        .map(([key]) => key),
    })),
    existingMembers: existingMembers.map((member: any) => ({
      researchEntityId: String(member.researchEntityId),
      userId: member.userId ? String(member.userId) : undefined,
      role: member.role,
      isCurrentMember: member.isCurrentMember,
    })),
  });

  const text = JSON.stringify(report, null, 2);
  if (options.output) {
    await writeFile(options.output, `${text}\n`, 'utf8');
    console.log(`Wrote department lead repair plan to ${options.output}`);
  } else {
    console.log(text);
  }

  if (options.apply) {
    if (!Number.isFinite(options.confirmPlannedCount)) {
      throw new Error('--apply requires --confirm-planned-count=<expected planned row count>');
    }
    if (!options.expectPlan) {
      throw new Error('--apply requires --expect-plan=<reviewed dry-run plan json>');
    }
    if (report.summary.planned !== options.confirmPlannedCount) {
      throw new Error(
        `Refusing to apply: planned row count ${report.summary.planned} does not match --confirm-planned-count=${options.confirmPlannedCount}`,
      );
    }
    if (report.summary.ambiguous > 0 || report.summary.noEvidence > 0) {
      throw new Error('Refusing to apply: repair plan still has ambiguous or no-evidence rows');
    }
    const expectedPlan = JSON.parse(await readFile(options.expectPlan, 'utf8')) as DepartmentLeadRepairPlanReport;
    const comparison = compareDepartmentLeadRepairPlans(report, expectedPlan);
    if (!comparison.matches) {
      throw new Error(`Refusing to apply: live plan differs from reviewed plan: ${comparison.reasons.join('; ')}`);
    }
    const operations = buildDepartmentLeadRepairApplyOperations(report);
    const result =
      operations.length > 0
        ? await ResearchGroupMember.bulkWrite(operations as any[], { ordered: false })
        : { upsertedCount: 0, modifiedCount: 0, matchedCount: 0 };
    console.log(
      JSON.stringify(
        {
          mode: 'apply',
          environment: guard.environment,
          db: guard.dbLabel,
          requested: operations.length,
          expectedPlan: options.expectPlan,
          upserted: result.upsertedCount || 0,
          modified: result.modifiedCount || 0,
          matched: result.matchedCount || 0,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          environment: guard.environment,
          db: guard.dbLabel,
          applyCommandRequires:
            '--apply --confirm-planned-count=<expected planned row count> --expect-plan=<reviewed dry-run plan json> and production CONFIRM_PROD_SCRAPE=true when SCRAPER_ENV=production',
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
