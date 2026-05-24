import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import {
  buildCopiedProfileDescriptionRepairPlan,
  RESEARCH_ENTITY_DESCRIPTION_FIELDS,
  type CopiedProfileDescriptionRepair,
} from './repairCopiedProfileDescriptionsCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

interface Args {
  apply: boolean;
  only: string[];
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, only: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--only') {
      const value = argv[index + 1];
      if (!value) throw new Error('--only requires a comma-separated slug list');
      args.only.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg.startsWith('--only=')) {
      args.only.push(
        ...arg.slice('--only='.length).split(',').map((item) => item.trim()).filter(Boolean),
      );
      continue;
    }
    if (arg === '--limit') {
      const value = argv[index + 1];
      if (!value) throw new Error('--limit requires a number');
      args.limit = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      args.limit = Number.parseInt(arg.slice('--limit='.length), 10);
      continue;
    }
    throw new Error(`Unknown repairCopiedProfileDescriptions option: ${arg}`);
  }
  if (args.limit !== undefined && (!Number.isFinite(args.limit) || args.limit <= 0)) {
    throw new Error('--limit must be a positive number');
  }
  return args;
}

function stringId(value: unknown): string {
  return value ? String(value) : '';
}

function replacementUpdateForRepair(repair: CopiedProfileDescriptionRepair) {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};

  for (const field of RESEARCH_ENTITY_DESCRIPTION_FIELDS) {
    if (!repair.copiedCurrentFields.includes(field)) continue;
    const replacement = repair.replacementFields[field];
    if (replacement) {
      $set[field] = replacement.value;
      $set[`confidenceByField.${field}`] = replacement.confidence;
    } else {
      $unset[field] = '';
      $unset[`confidenceByField.${field}`] = '';
    }
  }

  const update: Record<string, unknown> = {};
  if (Object.keys($set).length > 0) update.$set = $set;
  if (Object.keys($unset).length > 0) update.$unset = $unset;
  return update;
}

async function main() {
  dotenv.config({ path: '.env' });
  const args = parseArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:repair-copied-profile-descriptions',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const entityFilter: Record<string, unknown> = { archived: { $ne: true } };
  if (args.only.length > 0) entityFilter.slug = { $in: args.only };
  const entityQuery = ResearchEntity.find(entityFilter)
    .select('_id slug name description shortDescription fullDescription manuallyLockedFields')
    .sort({ slug: 1 });
  if (args.limit) entityQuery.limit(args.limit);
  const entityDocs = await entityQuery.lean();
  const entityIds = entityDocs.map((entity: any) => entity._id);
  const entitySlugs = entityDocs.map((entity: any) => entity.slug).filter(Boolean);

  const [memberDocs, observationDocs] = await Promise.all([
    ResearchGroupMember.find({
      researchEntityId: { $in: entityIds },
      role: { $in: ['pi', 'co-pi', 'director', 'co-director'] },
      isCurrentMember: { $ne: false },
    })
      .select('researchEntityId userId role isCurrentMember')
      .lean(),
    Observation.find({
      entityType: 'researchEntity',
      field: { $in: RESEARCH_ENTITY_DESCRIPTION_FIELDS },
      superseded: { $ne: true },
      $or: [{ entityKey: { $in: entitySlugs } }, { entityId: { $in: entityIds } }],
    })
      .select('_id entityKey entityId field value sourceName confidence observedAt superseded')
      .lean(),
  ]);
  const userIds = Array.from(
    new Set(memberDocs.map((member: any) => stringId(member.userId)).filter(Boolean)),
  );
  const userDocs = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('_id netid fname lname bio').lean()
    : [];

  const plan = buildCopiedProfileDescriptionRepairPlan({
    entities: entityDocs.map((entity: any) => ({
      id: stringId(entity._id),
      slug: entity.slug,
      name: entity.name,
      description: entity.description,
      shortDescription: entity.shortDescription,
      fullDescription: entity.fullDescription,
      manuallyLockedFields: entity.manuallyLockedFields,
    })),
    members: memberDocs.map((member: any) => ({
      researchEntityId: stringId(member.researchEntityId),
      userId: stringId(member.userId),
      role: member.role,
      isCurrentMember: member.isCurrentMember,
    })),
    users: userDocs.map((user: any) => ({
      id: stringId(user._id),
      netid: user.netid,
      name: [user.fname, user.lname].filter(Boolean).join(' '),
      bio: user.bio,
    })),
    observations: observationDocs.map((observation: any) => ({
      id: stringId(observation._id),
      entityKey: observation.entityKey,
      entityId: stringId(observation.entityId),
      field: observation.field,
      value: observation.value,
      sourceName: observation.sourceName,
      confidence: observation.confidence,
      observedAt: observation.observedAt,
      superseded: observation.superseded,
    })),
  });

  const applied = {
    supersededObservations: 0,
    updatedEntities: 0,
  };

  if (args.apply) {
    for (const repair of plan.repairs) {
      if (repair.staleObservationIds.length > 0) {
        const observationResult = await Observation.updateMany(
          { _id: { $in: repair.staleObservationIds } },
          { $set: { superseded: true } },
        );
        applied.supersededObservations += observationResult.modifiedCount || 0;
      }

      const update = replacementUpdateForRepair(repair);
      if (Object.keys(update).length > 0) {
        const entityResult = await ResearchEntity.updateOne(
          { _id: new mongoose.Types.ObjectId(repair.researchEntityId) },
          update,
        );
        applied.updatedEntities += entityResult.modifiedCount || 0;
      }

    }
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        scannedEntities: entityDocs.length,
        repairCount: plan.repairs.length,
        staleObservationCount: plan.repairs.reduce(
          (total, repair) => total + repair.staleObservationIds.length,
          0,
        ),
        copiedCurrentEntityCount: plan.repairs.filter(
          (repair) => repair.copiedCurrentFields.length > 0,
        ).length,
        applied,
        samples: plan.repairs.slice(0, 25),
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
