import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../../db/connections';
import { ResearchEntity } from '../../models/researchEntity';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { buildFuzzyResidualPlan, type MatcherEntity } from './fuzzyResidualMatcher';
import { normalizeToken } from './fuzzyMatchFeatures';
import { loadFuzzyGroundTruth } from './fuzzyMatchLabeledSet';
import {
  buildGroundTruthClusters,
  buildLabeledNegatives,
  clusterPairs,
  pairCompleteness,
  pairKey,
  pairwiseMetrics,
  type SameNameQuarantineLike,
} from './fuzzyMatchMetrics';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

interface Args {
  sample?: number;
  limit?: number;
  includeArchived: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { includeArchived: false };
  for (const token of argv) {
    if (token.startsWith('--sample=')) args.sample = Number(token.slice('--sample='.length));
    else if (token.startsWith('--limit=')) args.limit = Number(token.slice('--limit='.length));
    else if (token === '--include-archived') args.includeArchived = true;
  }
  return args;
}

const SELECT =
  'slug name entityType departments researchAreas methods websiteUrl inferredPiUserId embedding';

function buildInScopeQuarantines(entities: MatcherEntity[]): SameNameQuarantineLike[] {
  const byName = new Map<string, Array<{ id: string; personId?: unknown }>>();
  for (const entity of entities) {
    const normalizedName = normalizeToken(entity.name);
    if (!normalizedName) continue;
    const group = byName.get(normalizedName) ?? [];
    group.push({ id: entity.id, personId: entity.pi?.[0]?.personId });
    byName.set(normalizedName, group);
  }
  return [...byName.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([normalizedName, group]) => ({ normalizedName, entities: group }));
}

function toMatcherEntity(doc: Record<string, any>): MatcherEntity {
  const pi = doc.inferredPiUserId
    ? [{ personId: String(doc.inferredPiUserId), confidence: 1 }]
    : [];
  return {
    id: String(doc._id),
    name: doc.name,
    departments: doc.departments,
    researchAreas: doc.researchAreas,
    methods: doc.methods,
    websiteUrl: doc.websiteUrl,
    embedding: doc.embedding,
    entityType: typeof doc.entityType === 'string' ? doc.entityType : undefined,
    pi,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const dbLabel = mongoose.connection.db?.databaseName ?? 'unknown';

  const match = args.includeArchived ? {} : { archived: { $ne: true } };
  let docs: Record<string, any>[];
  if (args.sample && Number.isFinite(args.sample)) {
    const projection = Object.fromEntries(SELECT.split(' ').map((f) => [f, 1]));
    docs = (await ResearchEntity.aggregate([
      { $match: match },
      { $sample: { size: args.sample } },
      { $project: { ...projection, _id: 1 } },
    ])) as Record<string, any>[];
  } else {
    const query = ResearchEntity.find(match).select(SELECT).lean();
    if (args.limit && Number.isFinite(args.limit)) query.limit(args.limit);
    docs = (await query) as Record<string, any>[];
  }

  const entities = docs.map(toMatcherEntity);
  const loadedIds = new Set(entities.map((e) => e.id));

  const groundTruth = await loadFuzzyGroundTruth();
  const positiveClusters = buildGroundTruthClusters(
    groundTruth.redirects,
    groundTruth.canonicalGroupRows,
  );
  const allPositives = clusterPairs(positiveClusters);
  const inScopePositives = new Set(
    [...allPositives].filter((key) => {
      const [a, b] = key.split('|');
      return loadedIds.has(a) && loadedIds.has(b);
    }),
  );

  const inScopeNegatives = buildLabeledNegatives(buildInScopeQuarantines(entities));

  const { plan, candidatePairs } = buildFuzzyResidualPlan(entities);
  const autoPairs = new Set(
    plan.filter((e) => e.band === 'auto').map((e) => pairKey(e.pair[0], e.pair[1])),
  );
  const reviewPairs = plan.filter((e) => e.band === 'review').length;

  const report = {
    generatedAt: new Date().toISOString(),
    db: dbLabel,
    selection: args.sample
      ? `random-sample:${args.sample}`
      : args.limit
        ? `first:${args.limit}`
        : 'all',
    includeArchived: args.includeArchived,
    entitiesLoaded: entities.length,
    candidatePairs: candidatePairs.size,
    autoBandPairs: autoPairs.size,
    reviewBandPairs: reviewPairs,
    inScopePositives: inScopePositives.size,
    inScopeNegatives: inScopeNegatives.size,
    blockingPairCompleteness: pairCompleteness(candidatePairs, inScopePositives),
    autoBandVsPositives: pairwiseMetrics(autoPairs, inScopePositives, inScopeNegatives),
    note: 'Report-only. Precision is measured against same-name-different-PI hard negatives drawn from the loaded set. Use --include-archived for a true recall estimate (merge losers are often archived). No merges are applied.',
  };
  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to run fuzzy residual report:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
