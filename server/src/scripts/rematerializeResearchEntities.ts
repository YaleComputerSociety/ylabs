import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { fieldProvenanceEntries } from '../models/fieldProvenanceBacking';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
  runStudentVisibilityGateForPlans,
} from '../services/studentVisibilityGateService';
import { syncResearchEntitiesWithOutcome } from '../services/researchEntityIndexSyncOutcome';
import { resolveResearchEntityCanonicalIdentity } from '../services/researchEntityCanonicalTombstone';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertRematerializeApplyAllowed,
  collectRematerializeEntityReports,
  observationValueIsMaterializable,
  parseRematerializeResearchEntitiesArgs,
  rematerializeComparedFields,
  rematerializeEntityReportFromChanges,
  rematerializeFailureMessage,
  rematerializeReportedChanges,
  rematerializeSkipReasonForEntity,
  rematerializeStateAfterPlan,
  summarizeRematerializeEntities,
  researchEntityFieldIsStranded,
  countProvenanceReconciliation,
  provenanceReconciliationChanges,
  selectRematerializeRegateEntityIds,
  slugsCarryingUnbackedProvenance,
  foreignContactFieldsByRow,
  type RematerializeEntityReport,
} from './rematerializeResearchEntitiesCore';
import { RESEARCH_ENTITY_CONTACT_FIELDS } from '../scrapers/rowKeyedContactEvidence';
import { loadResearchAreaEvidenceBackedRowIds } from '../scrapers/researchAreaEvidence';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function loadComparedFields(
  slug: string,
  fields: readonly string[],
): Promise<Record<string, unknown> | null> {
  const doc = await ResearchEntity.findOne({ slug })
    .select(`${fields.join(' ')} archived`)
    .lean<Record<string, unknown>>();
  return doc || null;
}

async function loadFieldProvenance(slug: string): Promise<unknown> {
  const doc = await ResearchEntity.findOne({ slug })
    .select('fieldProvenance')
    .lean<{ fieldProvenance?: unknown }>();
  return doc?.fieldProvenance;
}

function provenanceAfterPlan(
  provenance: unknown,
  plannedSet: Record<string, unknown>,
  plannedUnset: Record<string, unknown>,
): Record<string, unknown> {
  const planned: Record<string, unknown> = {};
  for (const [field, entry] of fieldProvenanceEntries(provenance)) {
    const path = `fieldProvenance.${field}`;
    if (Object.prototype.hasOwnProperty.call(plannedUnset, path)) continue;
    planned[field] = Object.prototype.hasOwnProperty.call(plannedSet, path)
      ? plannedSet[path]
      : entry;
  }
  return planned;
}

async function processSlug(
  slug: string,
  apply: boolean,
  onlyFields: string[],
  includeArchived: boolean,
  onlyReconcileFieldProvenance: boolean,
  foreignContact = false,
): Promise<RematerializeEntityReport> {
  const writeOnlyFields = foreignContact ? [...RESEARCH_ENTITY_CONTACT_FIELDS] : onlyFields;
  const comparedFields = rematerializeComparedFields(writeOnlyFields);
  const before = await loadComparedFields(slug, comparedFields);
  if (!before) return { slug, found: false, changes: [] };
  const provenanceBefore = onlyReconcileFieldProvenance
    ? await loadFieldProvenance(slug)
    : undefined;

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
    {
      dryRun: !apply,
      ...(writeOnlyFields.length > 0 ? { writeOnlyFields } : {}),
      ...(onlyReconcileFieldProvenance ? { onlyReconcileFieldProvenance } : {}),
    },
  );

  const plannedSet: Record<string, unknown> = result.plannedSet || {};
  const plannedUnset: Record<string, unknown> = result.plannedUnset || {};

  const changes = onlyReconcileFieldProvenance
    ? provenanceReconciliationChanges(
        provenanceBefore,
        apply
          ? await loadFieldProvenance(slug)
          : provenanceAfterPlan(provenanceBefore, plannedSet, plannedUnset),
      )
    : rematerializeReportedChanges(
        before,
        apply
          ? (await loadComparedFields(slug, comparedFields)) || {}
          : rematerializeStateAfterPlan(before, plannedSet, plannedUnset, comparedFields),
        comparedFields,
      );
  return rematerializeEntityReportFromChanges({
    slug,
    entityId: result.entityId,
    studentVisibilityTierBefore: before.studentVisibilityTier,
    materializerFieldsWritten: result.fieldsWritten,
    conflicts: result.conflicts,
    changes,
    foreignContact,
    unbackedResearchAreas: result.unbackedResearchAreas,
    skipped: result.skipped,
  });
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

async function discoverForeignContactSlugs(): Promise<string[]> {
  const storesContact = RESEARCH_ENTITY_CONTACT_FIELDS.map((field) => ({
    [field]: { $exists: true, $nin: ['', null] },
  }));
  const rows = await ResearchEntity.find({ archived: { $ne: true }, $or: storesContact })
    .select(`_id slug manuallyLockedFields ${RESEARCH_ENTITY_CONTACT_FIELDS.join(' ')}`)
    .lean<Array<Record<string, unknown>>>();
  if (rows.length === 0) return [];
  const observations = await Observation.find({
    entityType: 'researchEntity',
    superseded: false,
    field: { $in: [...RESEARCH_ENTITY_CONTACT_FIELDS] },
    $or: [
      { entityId: { $in: rows.map((row) => row._id) } },
      { entityKey: { $in: rows.map((row) => String(row.slug || '')).filter(Boolean) } },
    ],
  })
    .select('entityId entityKey field value')
    .lean();
  return Array.from(foreignContactFieldsByRow(rows, observations).keys()).sort();
}

async function discoverUnbackedProvenanceSlugs(includeArchived: boolean): Promise<string[]> {
  const rows = await ResearchEntity.find(
    includeArchived
      ? { fieldProvenance: { $exists: true } }
      : { fieldProvenance: { $exists: true }, archived: { $ne: true } },
  )
    .select('slug fieldProvenance')
    .lean<Array<{ slug?: string; fieldProvenance?: unknown }>>();
  return slugsCarryingUnbackedProvenance(rows);
}

async function discoverUnbackedResearchAreaSlugs(): Promise<string[]> {
  const rows = await ResearchEntity.find({
    archived: { $ne: true },
    manuallyLockedFields: { $ne: 'researchAreas' },
  })
    .select('_id slug departments manuallyLockedFields')
    .lean<Array<{ _id: unknown; slug?: string; departments?: unknown }>>();
  const backed = await loadResearchAreaEvidenceBackedRowIds(rows);
  return rows
    .filter((row) => row.slug && !backed.has(String(row._id)))
    .map((row) => row.slug as string)
    .sort();
}

function writeReport(report: Record<string, unknown>, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export interface RematerializeRegateSummary {
  scopedEntities: number;
  indexResynced: number;
  indexSyncFailures: number;
  tierChanged: number;
  tierTransitions: Array<{ recordId: string; label: string; from: string | null; to: string }>;
  counts: Record<string, number>;
}

export async function regateRematerializedEntities(
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
  const docs =
    objectIds.length > 0 ? await ResearchEntity.find({ _id: { $in: objectIds } }).lean() : [];
  const indexSync = await syncResearchEntitiesWithOutcome(docs);

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
    indexResynced: indexSync.resynced,
    indexSyncFailures: indexSync.indexSyncFailures,
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
  let discoveredUnbackedProvenanceSlugs: string[] | undefined;
  if (args.unbackedProvenance) {
    discoveredUnbackedProvenanceSlugs = await discoverUnbackedProvenanceSlugs(args.includeArchived);
    slugs = Array.from(new Set([...slugs, ...discoveredUnbackedProvenanceSlugs]));
  }

  let discoveredForeignContactSlugs: string[] | undefined;
  if (args.foreignContact) {
    discoveredForeignContactSlugs = await discoverForeignContactSlugs();
    slugs = Array.from(new Set([...slugs, ...discoveredForeignContactSlugs]));
  }

  let discoveredUnbackedResearchAreaSlugs: string[] | undefined;
  if (args.unbackedResearchAreas) {
    discoveredUnbackedResearchAreaSlugs = await discoverUnbackedResearchAreaSlugs();
    slugs = Array.from(new Set([...slugs, ...discoveredUnbackedResearchAreaSlugs]));
  }

  const entities = await collectRematerializeEntityReports(slugs, (slug) =>
    processSlug(
      slug,
      args.apply,
      args.onlyFields,
      args.includeArchived,
      args.unbackedProvenance,
      args.foreignContact,
    ),
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

  const provenanceReconciliation = args.unbackedProvenance
    ? countProvenanceReconciliation(entities)
    : undefined;
  const summary = summarizeRematerializeEntities(entities, { foreignContact: args.foreignContact });
  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    reclaimStrandedField: args.reclaimStrandedField,
    discoveredStrandedCount: discoveredSlugs?.length,
    unbackedProvenance: args.unbackedProvenance,
    discoveredUnbackedProvenanceCount: discoveredUnbackedProvenanceSlugs?.length,
    foreignContact: args.foreignContact,
    discoveredForeignContactCount: discoveredForeignContactSlugs?.length,
    clearedContactFields: summary.clearedContactFields,
    unbackedResearchAreasMode: args.unbackedResearchAreas,
    discoveredUnbackedResearchAreasCount: discoveredUnbackedResearchAreaSlugs?.length,
    retiredProvenanceEntries: provenanceReconciliation?.retired,
    relinkedProvenanceEntries: provenanceReconciliation?.relinked,
    onlyFields: args.onlyFields,
    includeArchived: args.includeArchived,
    requestedSlugs: slugs,
    entitiesFound: entities.filter((entity) => entity.found).length,
    entitiesMissing: entities
      .filter((entity) => !entity.found && !entity.error)
      .map((entity) => entity.slug),
    entitiesChanged: summary.entitiesChanged,
    fieldsWritten: summary.fieldsWritten,
    unbackedResearchAreas: summary.unbackedResearchAreas,
    researchAreaChips: summary.researchAreaChips,
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
