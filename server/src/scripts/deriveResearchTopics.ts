/**
 * `research-topics:derive`: reads stored `researchPageText` observations and caches the
 * research topics a model quotes from them, keyed by input hash (#5296, #5396). It never
 * fetches a page and writes no observation and no row; the materializer applies a cached
 * reading on the row's next resolve, which `research-entity:rematerialize` runs on demand.
 *
 * Dry run by default, with no API key and no model call: it reports the calls an apply
 * would make. An apply needs `--confirm-research-topics-derivation` and a Development
 * database.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchTopicsDerivation } from '../models/researchTopicsDerivation';
import { currentResearchPageTextObservation } from '../scrapers/researchPageTopicsDerivation';
import {
  RESEARCH_PAGE_TEXT_FIELD,
  RESEARCH_PAGE_TEXT_SOURCE,
} from '../scrapers/utils/researchPageText';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  assertDeriveResearchTopicsApplyAllowed,
  defaultResearchTopicsModel,
  deriveResearchTopicsForRows,
  parseDeriveResearchTopicsArgs,
  type DeriveResearchTopicsArgs,
  type ResearchTopicsDerivationStore,
  type StoredResearchPageTextRow,
} from './deriveResearchTopicsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

interface PageTextObservationRow {
  entityId?: unknown;
  entityKey?: unknown;
  field?: string;
  value?: unknown;
  sourceName?: string;
  observedAt?: Date;
  superseded?: boolean;
}

async function scopeClauses(slugs: string[]): Promise<Record<string, unknown>[]> {
  if (slugs.length === 0) return [];
  const rows = (await ResearchEntity.find({ slug: { $in: slugs } })
    .select('_id')
    .lean()) as Array<{ _id: unknown }>;
  return [
    { entityKey: { $in: slugs } },
    ...(rows.length > 0 ? [{ entityId: { $in: rows.map((row) => row._id) } }] : []),
  ];
}

async function loadStoredPageTextRows(
  args: DeriveResearchTopicsArgs,
): Promise<StoredResearchPageTextRow[]> {
  const clauses = await scopeClauses(args.slugs);
  const query = Observation.find({
    entityType: 'researchEntity',
    sourceName: RESEARCH_PAGE_TEXT_SOURCE,
    field: RESEARCH_PAGE_TEXT_FIELD,
    superseded: false,
    'rollback.rolledBackAt': { $exists: false },
    ...(clauses.length > 0 ? { $or: clauses } : {}),
  })
    .sort({ _id: 1 })
    .select('entityId entityKey field value sourceName observedAt superseded');
  if (args.slugs.length === 0 && !args.all) query.limit(args.limit);
  const observations = (await query.lean()) as PageTextObservationRow[];

  const byEntity = new Map<string, PageTextObservationRow[]>();
  for (const observation of observations) {
    const key =
      serializedDocumentId(observation.entityId) ||
      (typeof observation.entityKey === 'string' ? observation.entityKey : '');
    if (!key) continue;
    byEntity.set(key, [...(byEntity.get(key) ?? []), observation]);
  }
  return [...byEntity.values()].flatMap((group) => {
    const current = currentResearchPageTextObservation(group);
    if (!current) return [];
    const entityId = serializedDocumentId(current.entityId) || undefined;
    const entityKey = typeof current.entityKey === 'string' ? current.entityKey : undefined;
    return [{ entityId, entityKey, value: current.value }];
  });
}

const mongoDerivationStore: ResearchTopicsDerivationStore = {
  async has(inputHash) {
    return Boolean(await ResearchTopicsDerivation.exists({ inputHash }));
  },
  async save(record) {
    await ResearchTopicsDerivation.updateOne(
      { inputHash: record.inputHash },
      { $setOnInsert: record },
      { upsert: true },
    );
  },
};

async function main() {
  const args = parseDeriveResearchTopicsArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-topics:derive',
    mongoUrl: process.env.MONGODBURL,
  });
  const apiKey = args.apply ? process.env.OPENAI_API_KEY : undefined;
  assertDeriveResearchTopicsApplyAllowed(args, guard.dbLabel, apiKey);
  const callModel = args.apply && apiKey ? defaultResearchTopicsModel(apiKey) : null;
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${args.apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  const rows = await loadStoredPageTextRows(args);
  const result = await deriveResearchTopicsForRows({
    rows,
    callModel,
    store: mongoDerivationStore,
    concurrency: args.concurrency,
    log: (message) => console.error(message),
  });

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    db: guard.dbLabel,
    scope: args.slugs.length > 0 ? 'slugs' : args.all ? 'all-live' : `first-${args.limit}`,
    rowsRead: result.rows.length,
    modelCalls: result.modelCalls,
    plannedModelCalls: result.plannedModelCalls,
    cached: result.cached,
    derived: result.derived,
    derivedWithTopics: result.derivedWithTopics,
    noText: result.noText,
    modelFailures: result.modelFailures,
    next:
      result.derived > 0
        ? 'yarn research-entity:rematerialize --slugs=<derived rows> --only-fields=researchAreas applies the new readings'
        : undefined,
    rows: result.rows,
  };
  console.log(JSON.stringify({ ...report, rows: `${result.rows.length} rows` }, null, 2));
  if (args.output) {
    fs.writeFileSync(resolveSafeJsonReportOutputPath(args.output), JSON.stringify(report, null, 2));
  }
  if (result.modelFailures > 0) process.exitCode = 1;
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to derive research topics:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
