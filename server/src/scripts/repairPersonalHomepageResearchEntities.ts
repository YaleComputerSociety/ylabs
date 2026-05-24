import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntity } from '../services/meiliSyncService';
import { syncPathwaySearchIndexDocumentsForEntity } from '../services/pathwaySearchIndexService';
import {
  buildPersonalHomepageResearchEntityRepairPlan,
  type PersonalHomepageArtifactTextUpdate,
  type PersonalHomepageResearchEntityRepair,
} from './repairPersonalHomepageResearchEntitiesCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

interface Args {
  apply: boolean;
  syncSearch: boolean;
  only: string[];
  acceptedInput?: string;
  limit?: number;
}

interface AcceptedRepairInput {
  slug?: string;
  researchEntityId?: string;
  acceptedForApply?: boolean;
}

const REPAIRABLE_FIELDS = [
  'name',
  'kind',
  'entityType',
  'shortDescription',
  'fullDescription',
  'description',
];

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, syncSearch: true, only: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--no-sync') {
      args.syncSearch = false;
      continue;
    }
    if (arg === '--only') {
      const value = argv[index + 1];
      if (!value) throw new Error('--only requires a comma-separated slug list');
      args.only.push(...splitCsv(value));
      index += 1;
      continue;
    }
    if (arg.startsWith('--only=')) {
      args.only.push(...splitCsv(arg.slice('--only='.length)));
      continue;
    }
    if (arg === '--accepted-input') {
      const value = argv[index + 1];
      if (!value) throw new Error('--accepted-input requires a JSON file path');
      args.acceptedInput = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--accepted-input=')) {
      args.acceptedInput = arg.slice('--accepted-input='.length);
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
    throw new Error(`Unknown repairPersonalHomepageResearchEntities option: ${arg}`);
  }
  if (args.limit !== undefined && (!Number.isFinite(args.limit) || args.limit <= 0)) {
    throw new Error('--limit must be a positive number');
  }
  return args;
}

function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function objectId(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value);
}

function loadAcceptedKeys(filePath: string | undefined): Set<string> | null {
  if (!filePath) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows: AcceptedRepairInput[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.repairs)
      ? parsed.repairs
      : Array.isArray(parsed?.samples?.repairs)
        ? parsed.samples.repairs
        : [];
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.acceptedForApply !== true) continue;
    if (row.slug) keys.add(`slug:${row.slug}`);
    if (row.researchEntityId) keys.add(`id:${row.researchEntityId}`);
  }
  return keys;
}

function isAccepted(repair: PersonalHomepageResearchEntityRepair, acceptedKeys: Set<string> | null): boolean {
  if (!acceptedKeys) return true;
  return acceptedKeys.has(`slug:${repair.slug}`) || acceptedKeys.has(`id:${repair.researchEntityId}`);
}

async function loadCandidates(args: Args) {
  const filter: Record<string, unknown> = {
    archived: { $ne: true },
    $or: [{ kind: 'lab' }, { entityType: 'LAB' }],
  };
  if (args.only.length > 0) filter.slug = { $in: args.only };
  const query = ResearchEntity.find(filter)
    .select(
      '_id slug name kind entityType website websiteUrl sourceUrls shortDescription fullDescription description manuallyLockedFields',
    )
    .sort({ slug: 1 });
  if (args.limit) query.limit(args.limit);
  return query.lean();
}

async function loadPlanInputs(entityDocs: any[]) {
  const entityIds = entityDocs.map((entity) => entity._id);
  const entitySlugs = entityDocs.map((entity) => entity.slug).filter(Boolean);
  const [observationDocs, pathwayDocs, contactRouteDocs, accessSignalDocs] = await Promise.all([
    Observation.find({
      entityType: 'researchEntity',
      field: { $in: REPAIRABLE_FIELDS },
      superseded: { $ne: true },
      $or: [{ entityKey: { $in: entitySlugs } }, { entityId: { $in: entityIds } }],
    })
      .select('_id entityKey entityId field value sourceName')
      .lean(),
    EntryPathway.find({ researchEntityId: { $in: entityIds }, archived: { $ne: true } })
      .select('_id researchEntityId explanation bestNextStep')
      .lean(),
    ContactRoute.find({ researchEntityId: { $in: entityIds }, archived: { $ne: true } })
      .select('_id researchEntityId rationale')
      .lean(),
    AccessSignal.find({ researchEntityId: { $in: entityIds }, archived: { $ne: true } })
      .select('_id researchEntityId excerpt')
      .lean(),
  ]);

  return {
    entities: entityDocs.map((entity: any) => ({
      id: stringId(entity._id),
      slug: entity.slug,
      name: entity.name,
      kind: entity.kind,
      entityType: entity.entityType,
      website: entity.website,
      websiteUrl: entity.websiteUrl,
      sourceUrls: entity.sourceUrls,
      shortDescription: entity.shortDescription,
      fullDescription: entity.fullDescription,
      description: entity.description,
      manuallyLockedFields: entity.manuallyLockedFields,
    })),
    observations: observationDocs.map((observation: any) => ({
      id: stringId(observation._id),
      entityKey: observation.entityKey,
      entityId: stringId(observation.entityId),
      field: observation.field,
      value: observation.value,
      sourceName: observation.sourceName,
    })),
    pathways: pathwayDocs.map((pathway: any) => ({
      id: stringId(pathway._id),
      researchEntityId: stringId(pathway.researchEntityId),
      explanation: pathway.explanation,
      bestNextStep: pathway.bestNextStep,
    })),
    contactRoutes: contactRouteDocs.map((route: any) => ({
      id: stringId(route._id),
      researchEntityId: stringId(route.researchEntityId),
      rationale: route.rationale,
    })),
    accessSignals: accessSignalDocs.map((signal: any) => ({
      id: stringId(signal._id),
      researchEntityId: stringId(signal.researchEntityId),
      excerpt: signal.excerpt,
    })),
  };
}

function updateForRepair(repair: PersonalHomepageResearchEntityRepair, now: Date) {
  const $set: Record<string, unknown> = { ...repair.entitySet, updatedAt: now };
  const $unset: Record<string, ''> = {};
  for (const field of Object.keys(repair.entitySet)) {
    $set[`confidenceByField.${field}`] = field === 'kind' || field === 'entityType' ? 0.95 : 0.9;
  }
  for (const field of repair.entityUnset) {
    $unset[field] = '';
    $unset[`confidenceByField.${field}`] = '';
  }
  const update: Record<string, unknown> = { $set };
  if (Object.keys($unset).length > 0) update.$unset = $unset;
  return update;
}

function modelForArtifactUpdate(update: PersonalHomepageArtifactTextUpdate): mongoose.Model<any> {
  if (update.artifactType === 'EntryPathway') return EntryPathway;
  if (update.artifactType === 'ContactRoute') return ContactRoute;
  return AccessSignal;
}

async function applyRepairs(
  repairs: PersonalHomepageResearchEntityRepair[],
  args: Pick<Args, 'syncSearch'>,
) {
  const now = new Date();
  const applied = {
    updatedEntities: 0,
    supersededObservations: 0,
    updatedArtifacts: 0,
    syncedResearchEntities: 0,
    syncedPathwayDocuments: 0,
    errors: [] as Array<Record<string, unknown>>,
  };

  for (const repair of repairs) {
    try {
      const entityResult = await ResearchEntity.updateOne(
        { _id: objectId(repair.researchEntityId), archived: { $ne: true } },
        updateForRepair(repair, now),
      );
      applied.updatedEntities += entityResult.modifiedCount || 0;

      if (repair.staleObservationIds.length > 0) {
        const observationResult = await Observation.updateMany(
          { _id: { $in: repair.staleObservationIds.map(objectId) }, superseded: { $ne: true } },
          {
            $set: {
              superseded: true,
              cleanupReason: 'personal-homepage-false-lab-repair',
              cleanupAppliedAt: now,
            },
          },
        );
        applied.supersededObservations += observationResult.modifiedCount || 0;
      }

      for (const artifactUpdate of repair.artifactTextUpdates) {
        const result = await modelForArtifactUpdate(artifactUpdate).updateOne(
          { _id: objectId(artifactUpdate.id), archived: { $ne: true } },
          { $set: { ...artifactUpdate.set, lastMaterializedAt: now } },
        );
        applied.updatedArtifacts += result.modifiedCount || 0;
      }

      if (args.syncSearch) {
        const fresh = await ResearchEntity.findById(repair.researchEntityId).lean();
        if (fresh) {
          await syncEntity('researchEntity', fresh);
          applied.syncedResearchEntities += 1;
        }
        const pathwaySync = await syncPathwaySearchIndexDocumentsForEntity(repair.researchEntityId);
        applied.syncedPathwayDocuments += pathwaySync.indexedDocumentCount;
      }
    } catch (error) {
      applied.errors.push({
        slug: repair.slug,
        researchEntityId: repair.researchEntityId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return applied;
}

async function main() {
  dotenv.config({ path: '.env' });
  const args = parseArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:repair-personal-homepages',
    mongoUrl: process.env.MONGODBURL,
  });
  const acceptedKeys = loadAcceptedKeys(args.acceptedInput);
  await initializeConnections();

  const entityDocs = await loadCandidates(args);
  const inputs = await loadPlanInputs(entityDocs);
  const plan = buildPersonalHomepageResearchEntityRepairPlan(inputs);
  const selectedRepairs = plan.repairs.filter((repair) => isAccepted(repair, acceptedKeys));
  const applied = args.apply
    ? await applyRepairs(selectedRepairs, args)
    : {
        updatedEntities: 0,
        supersededObservations: 0,
        updatedArtifacts: 0,
        syncedResearchEntities: 0,
        syncedPathwayDocuments: 0,
        errors: [],
      };

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        syncSearch: args.syncSearch,
        acceptedInput: args.acceptedInput || null,
        scannedEntities: entityDocs.length,
        repairCount: plan.repairs.length,
        selectedRepairCount: selectedRepairs.length,
        reviewNeededCount: plan.reviewNeeded.length,
        skippedCount: plan.skipped.length,
        staleObservationCount: selectedRepairs.reduce(
          (total, repair) => total + repair.staleObservationIds.length,
          0,
        ),
        artifactTextUpdateCount: selectedRepairs.reduce(
          (total, repair) => total + repair.artifactTextUpdates.length,
          0,
        ),
        applied,
        samples: {
          repairs: plan.repairs.slice(0, 25),
          selectedRepairs: selectedRepairs.slice(0, 25),
          reviewNeeded: plan.reviewNeeded.slice(0, 25),
          skipped: plan.skipped.slice(0, 25),
        },
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
