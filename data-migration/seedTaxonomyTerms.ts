import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assertScriptApplyAllowed,
  type ScriptApplyGuardResult,
} from '../server/src/scripts/scriptWriteGuards';
import {
  RESEARCH_AREA_ALIASES,
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
} from '../server/src/scrapers/researchAreaCanonicalization';
import { RESEARCH_AREA_GROUND_TRUTH } from './seedResearchAreas';
import {
  buildApprovedTaxonomyTermSeedRows,
  buildCandidateTaxonomyTermSeedRows,
  simulateResearchAreaCollapse,
  type TaxonomyTermSeedRow,
} from './taxonomyTermSeedCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

type SeedDb = NonNullable<(typeof mongoose.connection)['db']>;

export interface TaxonomyTermSeedCliOptions {
  apply: boolean;
  confirmSeedApply?: boolean;
  includeCandidates: boolean;
  output?: string;
}

export function parseTaxonomyTermSeedArgs(argv: string[]): TaxonomyTermSeedCliOptions {
  const options: TaxonomyTermSeedCliOptions = { apply: false, includeCandidates: true };
  const parseRequiredOutputPath = (value: string | undefined): string => {
    const output = value?.trim();
    if (!output || output.startsWith('--')) throw new Error('--output requires a path');
    return output;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--live') {
      options.apply = true;
    } else if (arg === '--confirm-seed-apply') {
      options.confirmSeedApply = true;
    } else if (arg === '--dry-run') {
      options.apply = false;
    } else if (arg === '--approved-only') {
      options.includeCandidates = false;
    } else if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown taxonomy-term seed argument: ${arg}`);
    }
  }

  return options;
}

export function assertTaxonomyTermSeedApplyAllowed(args: {
  apply: boolean;
  confirmSeedApply?: boolean;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): ScriptApplyGuardResult {
  if (args.apply && !args.confirmSeedApply) {
    throw new Error('--confirm-seed-apply is required when --apply is set for taxonomy-term seed');
  }
  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'taxonomy-term seed',
    mongoUrl: args.mongoUrl,
    env: args.env,
  });
}

function buildApprovedRows(): TaxonomyTermSeedRow[] {
  return buildApprovedTaxonomyTermSeedRows(RESEARCH_AREA_GROUND_TRUTH, RESEARCH_AREA_ALIASES);
}

function canonicalizerFromRows(rows: TaxonomyTermSeedRow[]) {
  return createResearchAreaCanonicalizer(
    buildResearchAreaResolverIndex(rows.map((row) => ({ name: row.label, aliases: row.aliases }))),
  );
}

async function readCorpusAreaLists(db: SeedDb): Promise<string[][]> {
  const entities = (await db
    .collection('research_entities')
    .find({ archived: { $ne: true } }, { projection: { researchAreas: 1 } })
    .toArray()) as Array<{ researchAreas?: unknown }>;
  return entities.map((entity) =>
    Array.isArray(entity.researchAreas)
      ? entity.researchAreas.filter((value): value is string => typeof value === 'string')
      : [],
  );
}

async function findMissingTerms(db: SeedDb, rows: TaxonomyTermSeedRow[]): Promise<TaxonomyTermSeedRow[]> {
  if (rows.length === 0) return [];
  const existing = (await db
    .collection('taxonomy_terms')
    .find(
      { $or: rows.map((row) => ({ kind: row.kind, normalizedLabel: row.normalizedLabel })) },
      { projection: { kind: 1, normalizedLabel: 1 } },
    )
    .toArray()) as Array<{ kind: string; normalizedLabel: string }>;
  const existingKeys = new Set(existing.map((row) => `${row.kind}::${row.normalizedLabel}`));
  return rows.filter((row) => !existingKeys.has(`${row.kind}::${row.normalizedLabel}`));
}

async function insertTerms(db: SeedDb, rows: TaxonomyTermSeedRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();
  await db
    .collection('taxonomy_terms')
    .insertMany(
      rows.map((row) => ({ ...row, createdAt: now, updatedAt: now })),
      { ordered: false },
    );
  return rows.length;
}

const SYNTHETIC_EXAMPLES = [
  { raw: 'AI', becomes: 'Artificial Intelligence (approved-alias match)' },
  { raw: 'machine learning', becomes: 'Machine Learning (approved match)' },
  { raw: 'Research Areas:', becomes: 'dropped (scraper-label leakage)' },
  { raw: 'Theorist', becomes: 'dropped (role-label leakage)' },
  { raw: 'Underwater Basket Weaving', becomes: 'kept raw + UNREVIEWED candidate (fail closed)' },
];

async function main(): Promise<void> {
  const options = parseTaxonomyTermSeedArgs(process.argv.slice(2));
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set in server/.env');
    process.exit(1);
  }
  const guard = assertTaxonomyTermSeedApplyAllowed({
    apply: options.apply,
    confirmSeedApply: options.confirmSeedApply,
    mongoUrl: url,
  });

  console.log('=== TaxonomyTerm Seed + Research-Area Collapse Simulation ===');
  console.log(`Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}`);
  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY RUN'}`);

  const approvedRows = buildApprovedRows();
  const approvedNormalized = new Set(approvedRows.map((row) => row.normalizedLabel));
  const canonicalizer = canonicalizerFromRows(approvedRows);

  await mongoose.connect(url, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 60000 });
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB connection is not ready.');

    const areaLists = await readCorpusAreaLists(db);
    const collapse = simulateResearchAreaCollapse(canonicalizer, areaLists);
    const candidateRows = options.includeCandidates
      ? buildCandidateTaxonomyTermSeedRows(collapse.candidateLabels, approvedNormalized)
      : [];

    const existingTaxonomyTermsBefore = await db.collection('taxonomy_terms').countDocuments();
    const missingApproved = await findMissingTerms(db, approvedRows);
    const missingCandidates = await findMissingTerms(db, candidateRows);
    const approvedNewInserts = options.apply
      ? await insertTerms(db, missingApproved)
      : missingApproved.length;
    const candidateNewInserts = options.apply
      ? await insertTerms(db, missingCandidates)
      : missingCandidates.length;

    const report = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options,
      seed: {
        approvedSeedTerms: approvedRows.length,
        approvedNewInserts,
        candidateTermsPendingReview: candidateRows.length,
        candidateNewInserts,
        existingTaxonomyTermsBefore,
      },
      collapse: {
        entitiesConsidered: collapse.entitiesConsidered,
        entitiesWithAreas: collapse.entitiesWithAreas,
        entitiesWithCanonicalizedAreaChange: collapse.entitiesWithCanonicalizedAreaChange,
        distinctRawAreasBefore: collapse.distinctRawAreasBefore,
        distinctCanonicalAreasAfter: collapse.distinctCanonicalAreasAfter,
        distinctFallThroughToRaw: collapse.distinctFallThroughToRaw,
        distinctLeakageDropped: collapse.distinctLeakageDropped,
        leakageDroppedOccurrences: collapse.leakageDroppedOccurrences,
      },
      syntheticExamples: SYNTHETIC_EXAMPLES,
      reviewQueueSample: options.output ? collapse.candidateLabels.slice(0, 100) : undefined,
    };

    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Saved taxonomy-term seed report to ${options.output}`);
    }

    console.log(JSON.stringify({ seed: report.seed, collapse: report.collapse }, null, 2));
    if (!options.apply) {
      console.log('Dry run only; no taxonomy terms were inserted.');
    }
    console.log('=== Complete ===\n');
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
