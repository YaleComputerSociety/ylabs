import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { materializeEntity } from '../scrapers/entityMaterializer';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
  runStudentVisibilityGateForPlans,
} from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { resolveResearchEntityCanonicalIdentity } from '../services/researchEntityCanonicalTombstone';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  REMATERIALIZE_TRACKED_FIELDS,
  assertRematerializeApplyAllowed,
  buildRematerializeFieldChanges,
  collectRematerializeEntityReports,
  observationValueIsMaterializable,
  parseRematerializeResearchEntitiesArgs,
  rematerializeFailureMessage,
  rematerializeSkipReasonForEntity,
  researchEntityFieldIsStranded,
  selectRematerializeRegateEntityIds,
  type RematerializeEntityReport,
} from './rematerializeResearchEntitiesCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SELECT_FIELDS = `${REMATERIALIZE_TRACKED_FIELDS.join(' ')} archived`;

async function loadTrackedFields(slug: string): Promise<Record<string, unknown> | null> {
  const doc = await ResearchEntity.findOne({ slug })
    .select(SELECT_FIELDS)
    .lean<Record<string, unknown>>();
  return doc || null;
}

async function processSlug(
  slug: string,
  apply: boolean,
  onlyFields: string[],
  includeArchived: boolean,
): Promise<RematerializeEntityReport> {
  const before = await loadTrackedFields(slug);
  if (!before) return { slug, found: false, changes: [] };

  const redirectCanonical = await resolveResearchEntityCanonicalIdentity({
    slug,
    entityId: before._id ? String(before._id) : undefined,
  });
  const skipReason = rematerializeSkipReasonForEntity(
    before,
    includeArchived,
    redirectCanonical?._id ? String(redirectCanonical._id) : undefined,
  );
  if (skipReason) {
    return {
      slug,
      found: true,
      entityId: before._id ? String(before._id) : undefined,
      studentVisibilityTierBefore: before.studentVisibilityTier,
      changes: [],
      skipped: skipReason,
    };
  }

  const result = await materializeEntity(
    'researchEntity',
    { entityKey: slug },
    { dryRun: !apply, ...(onlyFields.length > 0 ? { writeOnlyFields: onlyFields } : {}) },
  );

  let plannedSet: Record<string, unknown> = result.plannedSet || {};
  const plannedUnset: Record<string, unknown> = result.plannedUnset || {};
  if (apply) {
    const after = await loadTrackedFields(slug);
    plannedSet = (after as Record<string, unknown>) || {};
  }

  const changes = buildRematerializeFieldChanges(before, plannedSet, plannedUnset);
  return {
    slug,
    found: true,
    entityId: result.entityId,
    studentVisibilityTierBefore: before.studentVisibilityTier,
    fieldsWritten: result.fieldsWritten,
    conflicts: result.conflicts,
    changes,
    skipped: result.skipped,
  };
}

async function discoverStrandedFieldSlugs(field: string): Promise<string[]> {
  const observations = await Observation.find({
    entityType: 'researchEntity',
    field,
    superseded: false,
  })
    .select('entityKey entityId value')
    .lean<Array<{ entityKey?: string; entityId?: unknown; value?: unknown }>>();

  const candidateKeys = new Set<string>();
  const candidateIds = new Set<string>();
  for (const observation of observations) {
    if (!observationValueIsMaterializable(observation.value)) continue;
    if (observation.entityKey) candidateKeys.add(observation.entityKey);
    else if (observation.entityId) candidateIds.add(String(observation.entityId));
  }

  const idFilters: any[] = [];
  if (candidateKeys.size > 0) idFilters.push({ slug: { $in: Array.from(candidateKeys) } });
  if (candidateIds.size > 0) {
    const objectIds = Array.from(candidateIds)
      .filter((value) => mongoose.isValidObjectId(value))
      .map((value) => new mongoose.Types.ObjectId(value));
    if (objectIds.length > 0) idFilters.push({ _id: { $in: objectIds } });
  }
  if (idFilters.length === 0) return [];

  const entities = await ResearchEntity.find(
    idFilters.length === 1 ? idFilters[0] : { $or: idFilters },
  )
    .select(`slug ${field}`)
    .lean<Array<{ slug?: string; [key: string]: unknown }>>();

  const strandedSlugs = new Set<string>();
  for (const entity of entities) {
    if (!entity.slug) continue;
    if (researchEntityFieldIsStranded(entity[field])) strandedSlugs.add(entity.slug);
  }
  return Array.from(strandedSlugs).sort();
}

function writeReport(report: Record<string, unknown>, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

interface RematerializeRegateSummary {
  scopedEntities: number;
  tierChanged: number;
  tierTransitions: Array<{ recordId: string; label: string; from: string | null; to: string }>;
  counts: Record<string, number>;
}

async function regateRematerializedEntities(
  entityIds: string[],
): Promise<RematerializeRegateSummary> {
  const plans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'apply',
    recordIds: entityIds,
  });
  const gateReport = await runStudentVisibilityGateForPlans(plans, {
    mode: 'dry-run',
    collection: 'research',
  });
  await applyStudentVisibilityGatePlans(plans);

  const objectIds = entityIds
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (objectIds.length > 0) {
    const docs = await ResearchEntity.find({ _id: { $in: objectIds } }).lean();
    try {
      await syncEntities('researchEntity', docs as unknown[]);
    } catch (error) {
      console.error(
        '[research-entity:rematerialize] Meili resync after re-gate failed:',
        sanitizeLogValue(error),
      );
    }
  }

  const tierTransitions = plans
    .filter((plan) => plan.currentTier !== plan.tier)
    .map((plan) => ({
      recordId: plan.recordId,
      label: plan.label,
      from: plan.currentTier ?? null,
      to: plan.tier,
    }));

  return {
    scopedEntities: entityIds.length,
    tierChanged: tierTransitions.length,
    tierTransitions,
    counts: gateReport.counts as unknown as Record<string, number>,
  };
}

async function main() {
  const args = parseRematerializeResearchEntitiesArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:rematerialize',
    mongoUrl: process.env.MONGODBURL,
  });
  assertRematerializeApplyAllowed(args, guard.dbLabel);

  await initializeConnections();

  let slugs = args.slugs;
  let discoveredSlugs: string[] | undefined;
  if (args.reclaimStrandedField) {
    discoveredSlugs = await discoverStrandedFieldSlugs(args.reclaimStrandedField);
    slugs = Array.from(new Set([...slugs, ...discoveredSlugs]));
  }

  const entities = await collectRematerializeEntityReports(slugs, (slug) =>
    processSlug(slug, args.apply, args.onlyFields, args.includeArchived),
  );
  const failed = entities.filter((entity) => entity.error);

  let regate: RematerializeRegateSummary | undefined;
  let regateError: string | undefined;
  if (args.apply) {
    const regateEntityIds = selectRematerializeRegateEntityIds(entities);
    if (regateEntityIds.length > 0) {
      try {
        regate = await regateRematerializedEntities(regateEntityIds);
      } catch (error) {
        regateError = rematerializeFailureMessage(error);
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    reclaimStrandedField: args.reclaimStrandedField,
    discoveredStrandedCount: discoveredSlugs?.length,
    onlyFields: args.onlyFields,
    includeArchived: args.includeArchived,
    requestedSlugs: slugs,
    entitiesFound: entities.filter((entity) => entity.found).length,
    entitiesMissing: entities
      .filter((entity) => !entity.found && !entity.error)
      .map((entity) => entity.slug),
    entitiesChanged: entities.filter((entity) => entity.changes.length > 0).length,
    entitiesSkipped: entities.filter((entity) => entity.skipped).length,
    entitiesFailed: failed.map((entity) => ({ slug: entity.slug, error: entity.error })),
    regate,
    regateError,
    entities,
  };
  console.log(JSON.stringify(report, null, 2));
  writeReport(report, args.output);
  if (regateError) {
    throw new Error(
      `rematerialize applied ${entities.length} slug(s) but re-gate failed; see regateError in the report`,
    );
  }
  if (failed.length > 0) {
    throw new Error(
      `rematerialize completed with ${failed.length} failed slug(s); see entitiesFailed in the report`,
    );
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to rematerialize research entities:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
