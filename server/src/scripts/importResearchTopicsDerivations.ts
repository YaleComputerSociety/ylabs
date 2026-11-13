/**
 * `research-topics:import-derivations`: imports research-topic readings made outside the lane,
 * such as local agents answering the exported lane input, into `research_topics_derivations`
 * with no model call and no API key. It never fetches and writes no observation and no row;
 * the materializer applies an imported reading on the row's next resolve, through the same
 * quote check and filters as a paid one.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchTopicsDerivation } from '../models/researchTopicsDerivation';
import {
  ownOrgUnitLabelsFromObservations,
  OWN_ORG_UNIT_LABEL_FIELDS,
} from '../scrapers/utils/ownOrgUnitLabelTopics';
import { containsAsciiControl } from '../utils/asciiControl';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { withoutModelCalls } from '../utils/modelClient';
import { approvedTempRootFor } from '../utils/tempArtifactRoots';
import { loadStoredPageTextRowsBySlug } from './deriveResearchTopics';
import {
  assertImportResearchTopicsApplyAllowed,
  buildResearchTopicsExport,
  chunkOutputPath,
  chunkResearchTopicsExport,
  gradingSampleOf,
  importedTopicsWriterId,
  importResearchTopicReadings,
  IMPORT_RESEARCH_TOPICS_GRADING_GATE,
  IMPORT_RESEARCH_TOPICS_SCRIPT,
  IMPORT_RESEARCH_TOPICS_USAGE,
  mergeImportedTopicReadings,
  parseImportedTopicReadings,
  parseImportResearchTopicsArgs,
  parseSlugList,
  type ImportedTopicsStore,
  type ImportResearchTopicsArgs,
  type ScopedPageTextRow,
} from './importResearchTopicsDerivationsCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const mongoImportStore: ImportedTopicsStore = {
  async has(inputHash) {
    return Boolean(await ResearchTopicsDerivation.exists({ inputHash }));
  },
  async insertIfAbsent(record) {
    const result = await ResearchTopicsDerivation.updateOne(
      { inputHash: record.inputHash },
      { $setOnInsert: record },
      { upsert: true },
    );
    return result.upsertedCount > 0;
  },
};

async function ownOrgUnitLabelsBySlug(slugs: string[]): Promise<Map<string, string[]>> {
  const entities = (await ResearchEntity.find({ slug: { $in: slugs } })
    .select('_id slug')
    .lean()) as Array<{ _id: mongoose.Types.ObjectId; slug: string }>;
  const slugById = new Map(
    entities.map((row) => [serializedDocumentId(row._id) ?? '', row.slug] as const),
  );
  const wanted = new Set(slugs);
  const observations = (await Observation.find({
    entityType: 'researchEntity',
    field: { $in: [...OWN_ORG_UNIT_LABEL_FIELDS] },
    superseded: false,
    $or: [
      { entityKey: { $in: slugs } },
      ...(entities.length > 0 ? [{ entityId: { $in: entities.map((row) => row._id) } }] : []),
    ],
  })
    .select('entityId entityKey field value superseded rollback')
    .lean()) as Array<Record<string, any>>;
  const grouped = new Map<string, Array<Record<string, any>>>();
  for (const observation of observations) {
    const slug =
      slugById.get(serializedDocumentId(observation.entityId) ?? '') ??
      (wanted.has(observation.entityKey) ? observation.entityKey : '');
    if (!slug) continue;
    grouped.set(slug, [...(grouped.get(slug) ?? []), observation]);
  }
  return new Map(
    [...grouped.entries()].map(([slug, group]) => [slug, ownOrgUnitLabelsFromObservations(group)]),
  );
}

async function existingSlugs(slugs: string[]): Promise<Set<string>> {
  const found = (await ResearchEntity.find({ slug: { $in: slugs } })
    .select('slug')
    .lean()) as Array<{ slug: string }>;
  return new Set(found.map((row) => row.slug));
}

async function scopedRows(slugs: string[], withLabels: boolean): Promise<ScopedPageTextRow[]> {
  const rows = await loadStoredPageTextRowsBySlug(slugs);
  if (!withLabels) return rows.map(({ slug, value }) => ({ slug, value }));
  const labels = await ownOrgUnitLabelsBySlug(slugs);
  return rows.map(({ slug, value }) => ({ slug, value, ownOrgUnitLabels: labels.get(slug) ?? [] }));
}

export const EXPERIMENTS_ARTIFACT_ROOT = path.join(os.homedir(), 'Personal', 'ylabs-experiments');

export function resolveImportArtifactPath(
  value: string,
  flag: string,
  experimentsRoot: string = EXPERIMENTS_ARTIFACT_ROOT,
): string {
  try {
    return resolveSafeJsonReportOutputPath(value, flag);
  } catch (error) {
    const resolved = path.resolve(value.trim());
    const isJson = path.extname(resolved).toLowerCase() === '.json';
    if (
      isJson &&
      !containsAsciiControl(resolved) &&
      approvedTempRootFor(resolved, [experimentsRoot])
    ) {
      return resolved;
    }
    throw new Error(`${(error as Error).message}, or under ${experimentsRoot}`, { cause: error });
  }
}

export function writePrivateJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

const inputFiles = (input: string): string[] =>
  input
    .split(',')
    .map((file) => file.trim())
    .filter(Boolean);

async function runExport(args: ImportResearchTopicsArgs, dbLabel: string, output: string) {
  const slugs = [
    ...new Set([
      ...args.slugs,
      ...(args.slugsFile
        ? parseSlugList(fs.readFileSync(path.resolve(args.slugsFile), 'utf8'))
        : []),
    ]),
  ];
  await initializeConnections();
  const exported = buildResearchTopicsExport(await scopedRows(slugs, false), slugs, {
    knownSlugs: await existingSlugs(slugs),
  });
  const chunks = chunkResearchTopicsExport(exported, args.chunkSize);
  const files = chunks.map((chunk, index) => {
    const file = chunkOutputPath(output, index, chunks.length);
    writePrivateJson(file, chunk);
    return file;
  });
  console.log(
    JSON.stringify(
      {
        mode: 'export',
        db: dbLabel,
        capturedAt: exported.capturedAt,
        promptHash: exported.promptHash,
        writer: importedTopicsWriterId(exported.promptHash),
        requested: slugs.length,
        exported: exported.rows.length,
        noText: exported.noText.length,
        notFound: exported.notFound.length,
        files,
        modelCalls: 0,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log(IMPORT_RESEARCH_TOPICS_USAGE);
    return;
  }
  const args = parseImportResearchTopicsArgs(argv);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: IMPORT_RESEARCH_TOPICS_SCRIPT,
    mongoUrl: process.env.MONGODBURL,
  });
  assertImportResearchTopicsApplyAllowed(args, guard.dbLabel);
  const output = args.output ? resolveImportArtifactPath(args.output, '--output') : undefined;
  const sampleOutput = args.sampleOutput
    ? resolveImportArtifactPath(args.sampleOutput, '--sample-output')
    : undefined;
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${args.mode}${args.mode === 'import' ? (args.apply ? ' apply' : ' dry-run') : ''}`,
  );

  if (args.mode === 'export') {
    await runExport(args, guard.dbLabel, output as string);
    return;
  }

  const readings = mergeImportedTopicReadings(
    inputFiles(args.input as string).map((file) => parseImportedTopicReadings(readJson(file))),
  );
  await initializeConnections();
  const slugs = readings.map((reading) => reading.slug);
  const rows = await scopedRows(slugs, true);
  const report = await importResearchTopicReadings({
    mode: args.mode,
    apply: args.apply,
    readings,
    rows,
    knownSlugs: await existingSlugs(slugs),
    store: args.mode === 'import' ? mongoImportStore : null,
  });
  if (args.mode === 'validate-only') {
    for (const row of report.rows) {
      const verdict = row.outcome === 'accepted' ? 'accepted' : `refused:${row.outcome}`;
      const filtered = (row.refusals ?? []).map((item) => `${item.reason}x${item.count}`).join(' ');
      console.log(
        [
          verdict,
          row.slug,
          (row.topics ?? []).join('; '),
          row.malformedOutput ?? (filtered ? `topics dropped at resolve: ${filtered}` : ''),
        ].join('\t'),
      );
    }
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    db: guard.dbLabel,
    mode: args.mode,
    apply: args.apply,
    rowsRead: report.rowsRead,
    stored: report.stored,
    plannedStores: report.plannedStores,
    alreadyCached: report.alreadyCached,
    staleInput: report.staleInput,
    malformedOutput: report.malformedOutput,
    notFound: report.notFound,
    noText: report.noText,
    rowsWithTopicsAfterFilters: report.rowsWithTopicsAfterFilters,
    modelCalls: report.modelCalls,
    gradingGate: IMPORT_RESEARCH_TOPICS_GRADING_GATE,
    next:
      report.stored > 0
        ? 'yarn research-entity:rematerialize --slugs=<stored rows> --only-fields=researchAreas applies the imported readings'
        : undefined,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (output) writePrivateJson(output, { ...summary, rows: report.rows });
  if (sampleOutput && args.sampleForGrading) {
    writePrivateJson(sampleOutput, gradingSampleOf(readings, rows, args.sampleForGrading));
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  withoutModelCalls(IMPORT_RESEARCH_TOPICS_SCRIPT, main)
    .catch((error) => {
      console.error(`Failed to run ${IMPORT_RESEARCH_TOPICS_SCRIPT}:`, sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
