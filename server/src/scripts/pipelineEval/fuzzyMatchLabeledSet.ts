import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../../db/connections';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRedirect } from '../../models/researchEntityRedirect';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { buildGroundTruthClusters, clusterPairs } from './fuzzyMatchMetrics';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export interface FuzzyGroundTruth {
  redirects: Array<{ mergedEntityId?: unknown; canonicalEntityId?: unknown }>;
  canonicalGroupRows: Array<{ entityId?: unknown; canonicalGroupId?: unknown }>;
}

export async function loadFuzzyGroundTruth(): Promise<FuzzyGroundTruth> {
  const redirects = (await ResearchEntityRedirect.find({})
    .select('mergedEntityId canonicalEntityId')
    .lean()) as Array<{ mergedEntityId?: unknown; canonicalEntityId?: unknown }>;
  const canonicalGroupRows = (
    (await ResearchEntity.find({ canonicalGroupId: { $ne: null } })
      .select('_id canonicalGroupId')
      .lean()) as Array<{ _id: unknown; canonicalGroupId?: unknown }>
  ).map((row) => ({ entityId: row._id, canonicalGroupId: row.canonicalGroupId }));
  return { redirects, canonicalGroupRows };
}

function clusterSizeHistogram(clusters: string[][]): Record<string, number> {
  const histogram: Record<string, number> = {};
  for (const cluster of clusters) {
    const key = String(cluster.length);
    histogram[key] = (histogram[key] ?? 0) + 1;
  }
  return histogram;
}

async function main() {
  await initializeConnections();
  const db = mongoose.connection.db?.databaseName ?? 'unknown';
  const groundTruth = await loadFuzzyGroundTruth();
  const clusters = buildGroundTruthClusters(groundTruth.redirects, groundTruth.canonicalGroupRows);
  const positives = clusterPairs(clusters);
  const report = {
    generatedAt: new Date().toISOString(),
    db,
    redirects: groundTruth.redirects.length,
    canonicalGroupRows: groundTruth.canonicalGroupRows.length,
    groundTruthClusters: clusters.length,
    positivePairs: positives.size,
    clusterSizeHistogram: clusterSizeHistogram(clusters),
    note: 'Positive pairs are within-cluster pairs of the merged-into-canonical ground truth. Hard negatives are built separately via buildLabeledNegatives over the same-name-different-person quarantines.',
  };
  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to load fuzzy labeled set:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
