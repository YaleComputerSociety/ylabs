import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
  runStudentVisibilityGateForPlans,
} from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  planContentlessProjectsBoilerplateRepair,
  type BoilerplateRepairObservation,
} from './repair1636ContentlessProjectsBoilerplateCore';

dotenv.config();

const PROSE_FIELDS = ['fullDescription', 'shortDescription'];

interface Options {
  apply: boolean;
  confirm: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply' || arg === '--mode=apply') options.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.apply = false;
    else if (arg === '--confirm-1636-repair') options.confirm = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function loadCandidateObservations(): Promise<BoilerplateRepairObservation[]> {
  const boilerplateOwners = await Observation.find({
    entityType: 'researchEntity',
    field: { $in: PROSE_FIELDS },
    value: { $regex: '(?:studies\\s+)?i\\s+have\\s+\\d+\\s+research\\s+projects?', $options: 'i' },
  })
    .select('entityKey entityId')
    .lean<Array<{ entityKey?: string; entityId?: unknown }>>();

  const entityKeys = Array.from(
    new Set(boilerplateOwners.map((row) => row.entityKey).filter((key): key is string => Boolean(key))),
  );
  if (entityKeys.length === 0) return [];

  const observations = await Observation.find({
    entityType: 'researchEntity',
    entityKey: { $in: entityKeys },
    field: { $in: PROSE_FIELDS },
  })
    .select('entityKey entityId field value superseded supersededBy')
    .lean<
      Array<{
        _id: unknown;
        entityKey?: string;
        entityId?: unknown;
        field: string;
        value: unknown;
        superseded: boolean;
        supersededBy?: unknown;
      }>
    >();

  return observations.map((row) => ({
    id: String(row._id),
    entityKey: row.entityKey,
    entityId: row.entityId ? String(row.entityId) : undefined,
    field: row.field,
    value: row.value,
    superseded: Boolean(row.superseded),
    supersededBy: row.supersededBy ? String(row.supersededBy) : null,
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = process.env.MONGODBURL || '';
  if (!/\/Development(\?|$)/i.test(url)) {
    throw new Error(`repair-1636 refuses to run: MONGODBURL is not Development (${url.slice(-40)}).`);
  }
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'repair-1636-contentless-projects-boilerplate',
    mongoUrl: process.env.MONGODBURL,
  });
  if (options.apply && !/\/development$/i.test(guard.dbLabel)) {
    throw new Error(`repair-1636 apply is restricted to Development (target: ${guard.dbLabel}).`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-1636-repair is required when --apply is set.');
  }

  await initializeConnections();

  const observations = await loadCandidateObservations();
  const plan = planContentlessProjectsBoilerplateRepair(observations);

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'dry-run',
        db: guard.dbLabel,
        scanned: observations.length,
        supersede: plan.supersedeIds.length,
        reactivate: plan.reactivateIds.length,
        affectedEntityKeys: plan.affectedEntityKeys,
      },
      null,
      2,
    ),
  );

  if (!options.apply) {
    console.log('[dry-run] no writes performed. Re-run with --apply --confirm-1636-repair.');
    return;
  }

  if (plan.supersedeIds.length > 0) {
    await Observation.updateMany(
      { _id: { $in: plan.supersedeIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { $set: { superseded: true } },
    );
  }
  if (plan.reactivateIds.length > 0) {
    await Observation.updateMany(
      { _id: { $in: plan.reactivateIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { $set: { superseded: false }, $unset: { supersededBy: '' } },
    );
  }

  const affectedDocs = await ResearchEntity.find({ slug: { $in: plan.affectedEntityKeys } })
    .select('_id slug studentVisibilityTier')
    .lean<Array<{ _id: unknown; slug?: string; studentVisibilityTier?: string }>>();

  for (const doc of affectedDocs) {
    if (!doc.slug) continue;
    await materializeEntity('researchEntity', { entityKey: doc.slug }, { dryRun: false });
  }

  const entityIds = affectedDocs
    .map((doc) => serializedDocumentId(doc._id))
    .filter((id): id is string => Boolean(id));

  const plans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'apply',
    recordIds: entityIds,
  } as any);
  await runStudentVisibilityGateForPlans(plans, { mode: 'dry-run', collection: 'research' });
  await applyStudentVisibilityGatePlans(plans);

  const objectIds = entityIds
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (objectIds.length > 0) {
    const docs = await ResearchEntity.find({ _id: { $in: objectIds } }).lean();
    try {
      await syncEntities('researchEntity', docs as unknown[]);
    } catch (error) {
      console.error('[repair-1636] Meili resync failed:', sanitizeLogValue(error));
    }
  }

  const transitions = plans
    .filter((p) => p.currentTier !== p.tier)
    .map((p) => ({ recordId: p.recordId, label: p.label, from: p.currentTier ?? null, to: p.tier }));

  console.log(
    JSON.stringify(
      {
        applied: true,
        superseded: plan.supersedeIds.length,
        reactivated: plan.reactivateIds.length,
        rematerialized: affectedDocs.length,
        tierTransitions: transitions,
      },
      null,
      2,
    ),
  );
}

const isDirectRun = process.argv[1]
  ? process.argv[1].replace(/\\/g, '/').endsWith('/scripts/repair1636ContentlessProjectsBoilerplate.ts')
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('repair-1636 failed:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
