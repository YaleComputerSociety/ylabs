import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  REMATERIALIZE_TRACKED_FIELDS,
  assertRematerializeApplyAllowed,
  buildRematerializeFieldChanges,
  parseRematerializeResearchEntitiesArgs,
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

  const entities: RematerializeEntityReport[] = [];
  for (const slug of args.slugs) {
    entities.push(await processSlug(slug, args.apply));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    requestedSlugs: args.slugs,
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
