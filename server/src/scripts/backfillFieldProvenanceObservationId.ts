import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Source } from '../models/source';
import { resolveScraperEnvironment, summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertBackfillProvenanceObservationIdApplyAllowed,
  emptyProvenanceRepairTally,
  parseBackfillProvenanceObservationIdArgs,
  planProvenanceRepair,
  type BackfillProvenanceObservationIdArgs,
  type ProvenanceRepairTally,
  type ResolvedProvenanceReference,
} from './backfillFieldProvenanceObservationIdCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const REFERENCE_LOOKUP_CHUNK = 500;

interface EntityProvenanceRow {
  _id: unknown;
  fieldProvenance?: Record<string, { sourceId?: unknown; observationId?: unknown }>;
}

function writeReport(report: Record<string, unknown>, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function resolveReferences(
  ids: unknown[],
): Promise<Map<string, ResolvedProvenanceReference>> {
  const resolved = new Map<string, ResolvedProvenanceReference>();
  for (let index = 0; index < ids.length; index += REFERENCE_LOOKUP_CHUNK) {
    const chunk = ids.slice(index, index + REFERENCE_LOOKUP_CHUNK);
    const observations = (await Observation.find({ _id: { $in: chunk } })
      .select('_id sourceId')
      .lean()) as unknown as { _id: unknown; sourceId?: unknown }[];
    for (const observation of observations) {
      resolved.set(String(observation._id), {
        isObservation: true,
        isSource: false,
        ...(observation.sourceId ? { observationSourceId: observation.sourceId } : {}),
      });
    }
    const sources = (await Source.find({ _id: { $in: chunk } })
      .select('_id')
      .lean()) as unknown as { _id: unknown }[];
    for (const source of sources) {
      const key = String(source._id);
      const existing = resolved.get(key);
      resolved.set(key, {
        isObservation: Boolean(existing?.isObservation),
        isSource: true,
        ...(existing?.observationSourceId
          ? { observationSourceId: existing.observationSourceId }
          : {}),
      });
    }
  }
  return resolved;
}

async function main(args: BackfillProvenanceObservationIdArgs): Promise<void> {
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'research-entity:backfill-provenance-observation-id',
    mongoUrl: process.env.MONGODBURL,
  });
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) {
    throw new Error('MONGODBURL is required for research-entity:backfill-provenance-observation-id');
  }
  const environment = resolveScraperEnvironment();
  const dbLabel = summarizeMongoUrl(mongoUrl);
  assertBackfillProvenanceObservationIdApplyAllowed(args, dbLabel, environment);

  await mongoose.connect(mongoUrl);

  const rows = (await ResearchEntity.find({ fieldProvenance: { $exists: true, $ne: {} } })
    .select('_id fieldProvenance')
    .lean()) as unknown as EntityProvenanceRow[];
  const scoped = args.limit > 0 ? rows.slice(0, args.limit) : rows;

  const candidateIds = new Set<string>();
  const candidateById = new Map<string, unknown>();
  for (const row of scoped) {
    for (const entry of Object.values(row.fieldProvenance ?? {})) {
      if (entry?.observationId || !entry?.sourceId) continue;
      const key = String(entry.sourceId);
      candidateIds.add(key);
      candidateById.set(key, entry.sourceId);
    }
  }
  const references = await resolveReferences([...candidateIds].map((key) => candidateById.get(key)));

  const tally: ProvenanceRepairTally = emptyProvenanceRepairTally();
  let entitiesWritten = 0;
  for (const row of scoped) {
    const set: Record<string, unknown> = {};
    for (const [field, entry] of Object.entries(row.fieldProvenance ?? {})) {
      const reference = entry?.sourceId ? references.get(String(entry.sourceId)) ?? null : null;
      const plan = planProvenanceRepair(entry ?? {}, reference);
      tally[plan.outcome] += 1;
      if (!plan.entry) continue;
      set[`fieldProvenance.${field}`] = plan.entry;
    }
    if (Object.keys(set).length === 0) continue;
    entitiesWritten += 1;
    if (!args.apply) continue;
    await ResearchEntity.updateOne({ _id: row._id }, { $set: set });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment,
    mode: args.apply ? 'apply' : 'dry-run',
    entitiesScanned: scoped.length,
    entitiesWithProvenance: rows.length,
    entitiesWritten,
    provenanceEntriesByOutcome: tally,
  };
  console.log(JSON.stringify(report, null, 2));
  writeReport(report, args.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main(parseBackfillProvenanceObservationIdArgs(process.argv.slice(2)))
    .catch((error) => {
      console.error(
        'Failed to backfill fieldProvenance observation ids:',
        sanitizeLogValue(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
