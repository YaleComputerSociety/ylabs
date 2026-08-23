import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import {
  materializedFieldValue,
  shouldIgnoreObservationForEntityMaterialization,
} from '../scrapers/entityMaterializer';
import { resolveAllFields } from '../scrapers/confidenceResolver';
import { syncEntity } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  runMethodsMaterializationBackfill,
  type MethodsMaterializationDeps,
  type MethodsMaterializationTargetEntity,
} from './backfillMethodsMaterializationCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const RESEARCH_ENTITY_OBSERVATION_TYPES = ['researchEntity', 'researchGroup'];
const METHODS_FIELD = 'methods';

function entityHasMethods(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function buildDeps(limit?: number): MethodsMaterializationDeps {
  return {
    async findEntitiesWithLiveMethodsObservation() {
      const keys = await Observation.distinct('entityKey', {
        entityType: { $in: RESEARCH_ENTITY_OBSERVATION_TYPES },
        field: METHODS_FIELD,
        superseded: false,
      });
      const ids = await Observation.distinct('entityId', {
        entityType: { $in: RESEARCH_ENTITY_OBSERVATION_TYPES },
        field: METHODS_FIELD,
        superseded: false,
      });
      const slugKeys = keys.filter((value): value is string => typeof value === 'string' && value !== '');
      const objectIds = ids
        .filter((value) => value != null && mongoose.Types.ObjectId.isValid(String(value)))
        .map((value) => new mongoose.Types.ObjectId(String(value)));

      const docs = await ResearchEntity.find({
        $or: [{ slug: { $in: slugKeys } }, { _id: { $in: objectIds } }],
      })
        .select('_id slug archived')
        .lean();

      const byId = new Map<string, MethodsMaterializationTargetEntity>();
      for (const doc of docs as Array<{ _id: unknown; slug?: string; archived?: boolean }>) {
        if (!doc.slug) continue;
        byId.set(String(doc._id), {
          entityId: String(doc._id),
          entityKey: doc.slug,
          archived: Boolean(doc.archived),
        });
      }
      const entities = [...byId.values()].sort((a, b) => a.entityKey.localeCompare(b.entityKey));
      return typeof limit === 'number' ? entities.slice(0, limit) : entities;
    },
    async writeResolvedMethods(entity) {
      const doc = (await ResearchEntity.findById(entity.entityId)
        .select('_id methods manuallyLockedFields')
        .lean()) as {
        _id: unknown;
        methods?: unknown;
        manuallyLockedFields?: string[];
      } | null;
      if (!doc) return { applied: false, locked: false };

      const manuallyLockedFields = Array.isArray(doc.manuallyLockedFields)
        ? doc.manuallyLockedFields
        : [];
      if (manuallyLockedFields.includes(METHODS_FIELD)) {
        return { applied: false, locked: true };
      }

      const rawObs = await Observation.find({
        entityType: { $in: RESEARCH_ENTITY_OBSERVATION_TYPES },
        field: METHODS_FIELD,
        superseded: false,
        $or: [{ entityKey: entity.entityKey }, { entityId: doc._id }],
      })
        .select('field value sourceName confidence observedAt')
        .lean();

      const usableObs = rawObs.filter(
        (o) => !shouldIgnoreObservationForEntityMaterialization('researchEntity', o),
      );
      if (usableObs.length === 0) return { applied: false, locked: false };

      const resolverObs = usableObs.map((o: any) => ({
        field: METHODS_FIELD,
        value: o.value,
        sourceName: o.sourceName,
        confidence: o.confidence,
        observedAt: o.observedAt,
      }));
      const resolved = resolveAllFields(resolverObs);
      const resolvedMethods = resolved[METHODS_FIELD];
      if (!resolvedMethods) return { applied: false, locked: false };

      const value = materializedFieldValue(
        'researchEntity',
        METHODS_FIELD,
        resolvedMethods.value,
        doc.methods,
      );
      await ResearchEntity.updateOne(
        { _id: doc._id },
        { $set: { [METHODS_FIELD]: value, 'confidenceByField.methods': resolvedMethods.confidence } },
      );

      const fresh = await ResearchEntity.findById(doc._id).lean();
      if (fresh) await syncEntity('researchEntity', fresh);
      return { applied: true, locked: false };
    },
    async entityHasMethodsAfter(entityKey) {
      const doc = await ResearchEntity.findOne({ slug: entityKey }).select('methods').lean();
      return entityHasMethods((doc as { methods?: unknown } | null)?.methods);
    },
  };
}

function parseOutputPath(argv: string[]): string | undefined {
  const inline = argv.find((arg) => arg.startsWith('--output='));
  if (inline) return resolveSafeJsonReportOutputPath(inline.slice('--output='.length));
  const flagIndex = argv.indexOf('--output');
  if (flagIndex >= 0) return resolveSafeJsonReportOutputPath(argv[flagIndex + 1]);
  return undefined;
}

function parseLimit(argv: string[]): number | undefined {
  const inline = argv.find((arg) => arg.startsWith('--limit='));
  const raw = inline ? inline.slice('--limit='.length) : undefined;
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('--limit requires a positive integer');
  }
  return parsed;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const limit = parseLimit(argv);
  const output = parseOutputPath(argv);

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'backfillMethodsMaterialization',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const report = await runMethodsMaterializationBackfill(buildDeps(limit), { apply });

  const outputReport = {
    mode: apply ? 'apply' : 'dry-run',
    field: METHODS_FIELD,
    limit: limit ?? null,
    environment: guard.environment,
    db: guard.dbLabel,
    scanned: report.scanned,
    eligible: report.eligible,
    tally: report.tally,
    rows: report.rows,
  };
  const { rows: _rows, ...summary } = outputReport;
  console.log(JSON.stringify(summary, null, 2));
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(outputReport, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to materialize stranded methods observations:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
