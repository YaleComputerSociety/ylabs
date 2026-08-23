import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  REMATERIALIZE_TRACKED_FIELDS,
  assertRematerializeApplyAllowed,
  buildRematerializeFieldChanges,
  observationValueIsMaterializable,
  parseRematerializeResearchEntitiesArgs,
  researchEntityFieldIsStranded,
  type RematerializeFieldChange,
} from './rematerializeResearchEntitiesCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SELECT_FIELDS = REMATERIALIZE_TRACKED_FIELDS.join(' ');

interface RematerializeEntityReport {
  slug: string;
  found: boolean;
  entityId?: string;
  studentVisibilityTierBefore?: unknown;
  fieldsWritten?: number;
  conflicts?: number;
  changes: RematerializeFieldChange[];
  skipped?: string;
}

async function loadTrackedFields(slug: string): Promise<Record<string, unknown> | null> {
  const doc = await ResearchEntity.findOne({ slug })
    .select(SELECT_FIELDS)
    .lean<Record<string, unknown>>();
  return doc || null;
}

async function processSlug(slug: string, apply: boolean): Promise<RematerializeEntityReport> {
  const before = await loadTrackedFields(slug);
  if (!before) return { slug, found: false, changes: [] };

  const result = await materializeEntity(
    'researchEntity',
    { entityKey: slug },
    { dryRun: !apply },
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

  const entities: RematerializeEntityReport[] = [];
  for (const slug of slugs) {
    entities.push(await processSlug(slug, args.apply));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    reclaimStrandedField: args.reclaimStrandedField,
    discoveredStrandedCount: discoveredSlugs?.length,
    requestedSlugs: slugs,
    entitiesFound: entities.filter((entity) => entity.found).length,
    entitiesMissing: entities.filter((entity) => !entity.found).map((entity) => entity.slug),
    entitiesChanged: entities.filter((entity) => entity.changes.length > 0).length,
    entities,
  };
  console.log(JSON.stringify(report, null, 2));
  writeReport(report, args.output);
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
