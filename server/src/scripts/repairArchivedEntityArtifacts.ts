import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import {
  buildArchivedEntityArtifactRepairPlan,
  type ArchivedEntityArtifact,
  type ArchivedEntityArtifactType,
} from './repairArchivedEntityArtifactsCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ARTIFACT_SPECS: Array<{
  artifactType: ArchivedEntityArtifactType;
  model: mongoose.Model<any>;
}> = [
  { artifactType: 'EntryPathway', model: EntryPathway },
  { artifactType: 'AccessSignal', model: AccessSignal },
  { artifactType: 'ContactRoute', model: ContactRoute },
  { artifactType: 'PostedOpportunity', model: PostedOpportunity },
];

function parseArgs(argv: string[]): { apply: boolean; limit: number } {
  let apply = false;
  let limit = 500;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    const limitValue = arg.startsWith('--limit=')
      ? arg.slice('--limit='.length)
      : arg === '--limit'
        ? argv[++index]
        : '';
    if (limitValue) {
      const parsed = Number(limitValue);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--limit must be a positive integer');
      }
      limit = parsed;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { apply, limit };
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function objectId(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value);
}

async function loadActiveArtifactsOnArchivedEntities(
  limit: number,
): Promise<ArchivedEntityArtifact[]> {
  const artifacts: ArchivedEntityArtifact[] = [];

  for (const spec of ARTIFACT_SPECS) {
    const rows = await spec.model.aggregate([
      {
        $match: {
          archived: { $ne: true },
          researchEntityId: { $exists: true, $ne: null },
        },
      },
      {
        $lookup: {
          from: 'research_entities',
          localField: 'researchEntityId',
          foreignField: '_id',
          as: 'entity',
        },
      },
      { $unwind: '$entity' },
      {
        $match: {
          'entity.archived': true,
        },
      },
      {
        $project: {
          id: { $toString: '$_id' },
          researchEntityId: { $toString: '$researchEntityId' },
          canonicalResearchEntityId: { $toString: '$entity.canonicalGroupId' },
          derivationKey: '$derivationKey',
          signalType: '$signalType',
          entryPathwayId: { $toString: '$entryPathwayId' },
        },
      },
      { $limit: Math.max(1, limit - artifacts.length) },
    ]);

    for (const row of rows) {
      artifacts.push({
        artifactType: spec.artifactType,
        id: stringId(row.id),
        researchEntityId: stringId(row.researchEntityId),
        canonicalResearchEntityId: stringId(row.canonicalResearchEntityId),
        derivationKey: stringId(row.derivationKey),
        signalType: stringId(row.signalType),
        entryPathwayId: stringId(row.entryPathwayId),
      });
      if (artifacts.length >= limit) return artifacts;
    }
  }

  return artifacts;
}

async function loadCanonicalArtifacts(
  artifacts: ArchivedEntityArtifact[],
): Promise<ArchivedEntityArtifact[]> {
  const canonicalArtifacts: ArchivedEntityArtifact[] = [];
  const idsByType = new Map<ArchivedEntityArtifactType, mongoose.Types.ObjectId[]>();

  for (const artifact of artifacts) {
    if (!mongoose.Types.ObjectId.isValid(artifact.canonicalResearchEntityId)) continue;
    const ids = idsByType.get(artifact.artifactType) || [];
    ids.push(objectId(artifact.canonicalResearchEntityId));
    idsByType.set(artifact.artifactType, ids);
  }

  for (const spec of ARTIFACT_SPECS) {
    const ids = idsByType.get(spec.artifactType);
    if (!ids?.length) continue;
    const rows = await spec.model
      .find({ researchEntityId: { $in: ids }, archived: { $ne: true } })
      .select('_id researchEntityId derivationKey signalType entryPathwayId')
      .lean();
    for (const row of rows) {
      canonicalArtifacts.push({
        artifactType: spec.artifactType,
        id: stringId(row._id),
        researchEntityId: stringId(row.researchEntityId),
        canonicalResearchEntityId: stringId(row.researchEntityId),
        derivationKey: stringId(row.derivationKey),
        signalType: stringId(row.signalType),
        entryPathwayId: stringId(row.entryPathwayId),
      });
    }
  }

  return canonicalArtifacts;
}

function modelForType(artifactType: ArchivedEntityArtifactType): mongoose.Model<any> {
  const spec = ARTIFACT_SPECS.find((item) => item.artifactType === artifactType);
  if (!spec) throw new Error(`Unsupported artifact type: ${artifactType}`);
  return spec.model;
}

async function mergeAndArchiveArtifact(args: {
  artifactType: ArchivedEntityArtifactType;
  duplicateId: string;
  canonicalId: string;
  now: Date;
}): Promise<{ merged: number; archived: number; relinkedChildren: number }> {
  const model = modelForType(args.artifactType);
  const duplicate = (await model
    .findById(args.duplicateId)
    .select('sourceEvidenceIds sourceUrls')
    .lean()) as any;
  const addToSet: Record<string, any> = {};

  if (Array.isArray(duplicate?.sourceEvidenceIds) && duplicate.sourceEvidenceIds.length > 0) {
    addToSet.sourceEvidenceIds = { $each: duplicate.sourceEvidenceIds };
  }
  if (Array.isArray(duplicate?.sourceUrls) && duplicate.sourceUrls.length > 0) {
    addToSet.sourceUrls = { $each: duplicate.sourceUrls };
  }

  const canonicalUpdate =
    Object.keys(addToSet).length > 0
      ? await model.updateOne(
          { _id: objectId(args.canonicalId) },
          {
            $addToSet: addToSet,
            $set: { lastMaterializedAt: args.now },
          },
        )
      : { modifiedCount: 0 };

  let relinkedChildren = 0;
  if (args.artifactType === 'EntryPathway') {
    const [signals, routes, opportunities] = await Promise.all([
      AccessSignal.updateMany(
        { entryPathwayId: objectId(args.duplicateId), archived: { $ne: true } },
        { $set: { entryPathwayId: objectId(args.canonicalId), lastMaterializedAt: args.now } },
      ),
      ContactRoute.updateMany(
        { entryPathwayId: objectId(args.duplicateId), archived: { $ne: true } },
        { $set: { entryPathwayId: objectId(args.canonicalId), lastMaterializedAt: args.now } },
      ),
      PostedOpportunity.updateMany(
        { entryPathwayId: objectId(args.duplicateId), archived: { $ne: true } },
        { $set: { entryPathwayId: objectId(args.canonicalId) } },
      ),
    ]);
    relinkedChildren =
      (signals.modifiedCount || 0) + (routes.modifiedCount || 0) + (opportunities.modifiedCount || 0);
  }

  const archived = await model.updateOne(
    { _id: objectId(args.duplicateId), archived: { $ne: true } },
    { $set: { archived: true, lastMaterializedAt: args.now } },
  );

  return {
    merged: canonicalUpdate.modifiedCount || 0,
    archived: archived.modifiedCount || 0,
    relinkedChildren,
  };
}

async function applyPlan(
  plan: ReturnType<typeof buildArchivedEntityArtifactRepairPlan>,
): Promise<Record<string, unknown>> {
  const now = new Date();
  let relinked = 0;
  let relinkConflictsArchived = 0;
  let merged = 0;
  let archived = 0;
  let archivedWithoutCanonical = 0;
  let relinkedChildren = 0;
  const errors: Array<Record<string, unknown>> = [];

  for (const item of plan.relink) {
    try {
      const result = await modelForType(item.artifactType).updateOne(
        { _id: objectId(item.id), archived: { $ne: true } },
        {
          $set: {
            researchEntityId: objectId(item.canonicalResearchEntityId),
            lastMaterializedAt: now,
          },
        },
      );
      relinked += result.modifiedCount || 0;
    } catch (error: any) {
      if (error?.code === 11000) {
        const result = await modelForType(item.artifactType).updateOne(
          { _id: objectId(item.id), archived: { $ne: true } },
          { $set: { archived: true, lastMaterializedAt: now } },
        );
        relinkConflictsArchived += result.modifiedCount || 0;
      } else {
        errors.push({
          artifactType: item.artifactType,
          id: item.id,
          message: error?.message || String(error),
        });
      }
    }
  }

  for (const item of plan.mergeAndArchive) {
    try {
      const result = await mergeAndArchiveArtifact({ ...item, now });
      merged += result.merged;
      archived += result.archived;
      relinkedChildren += result.relinkedChildren;
    } catch (error: any) {
      errors.push({
        artifactType: item.artifactType,
        id: item.duplicateId,
        message: error?.message || String(error),
      });
    }
  }

  for (const item of plan.archiveWithoutCanonical) {
    try {
      const result = await modelForType(item.artifactType).updateOne(
        { _id: objectId(item.id), archived: { $ne: true } },
        { $set: { archived: true, lastMaterializedAt: now } },
      );
      archivedWithoutCanonical += result.modifiedCount || 0;
    } catch (error: any) {
      errors.push({
        artifactType: item.artifactType,
        id: item.id,
        message: error?.message || String(error),
      });
    }
  }

  return {
    relinked,
    relinkConflictsArchived,
    merged,
    archived,
    archivedWithoutCanonical,
    relinkedChildren,
    errors,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:repair-archived-artifacts',
    mongoUrl,
  });
  await mongoose.connect(mongoUrl);

  const artifacts = await loadActiveArtifactsOnArchivedEntities(options.limit);
  const canonicalArtifacts = await loadCanonicalArtifacts(artifacts);
  const plan = buildArchivedEntityArtifactRepairPlan({ artifacts, canonicalArtifacts });
  const applied = options.apply ? await applyPlan(plan) : null;

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apply: options.apply,
        limit: options.limit,
        inputCounts: {
          activeArtifactsOnArchivedEntities: artifacts.length,
          canonicalArtifacts: canonicalArtifacts.length,
        },
        planCounts: {
          relink: plan.relink.length,
          mergeAndArchive: plan.mergeAndArchive.length,
          archiveWithoutCanonical: plan.archiveWithoutCanonical.length,
          skipped: plan.skipped.length,
        },
        samples: {
          relink: plan.relink.slice(0, 10),
          mergeAndArchive: plan.mergeAndArchive.slice(0, 10),
          archiveWithoutCanonical: plan.archiveWithoutCanonical.slice(0, 10),
          skipped: plan.skipped.slice(0, 10),
        },
        applied,
      },
      null,
      2,
    ),
  );
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
