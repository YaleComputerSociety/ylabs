import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../../db/connections';
import { ResearchEntity } from '../../models/researchEntity';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { AUTOMATED_MERGE_ARCHIVE_REASONS } from '../../models/entityArchival';
import {
  buildGroundTruthClusters,
  clusterPairs,
  groundTruthPairsByProvenance,
  labelProvenance,
} from './fuzzyMatchMetrics';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export interface FuzzyGroundTruth {
  redirects: Array<{ mergedEntityId?: unknown; canonicalEntityId?: unknown }>;
  canonicalGroupRows: Array<{
    entityId?: unknown;
    canonicalGroupId?: unknown;
    archivedReason?: unknown;
  }>;
}

/**
 * `redirects` is retained as an empty array rather than removed from the shape: the
 * merge-redirect ledger is retired (#3027) and every merge it recorded is now an
 * archived row carrying a `canonicalGroupId`, which `canonicalGroupRows` already
 * loads, so the second source would double-count the same positives.
 */
export async function loadFuzzyGroundTruth(): Promise<FuzzyGroundTruth> {
  const redirects: FuzzyGroundTruth['redirects'] = [];
  const canonicalGroupRows = (
    (await ResearchEntity.find({ canonicalGroupId: { $ne: null } })
      .select('_id canonicalGroupId archivedReason')
      .lean()) as Array<{ _id: unknown; canonicalGroupId?: unknown; archivedReason?: unknown }>
  ).map((row) => ({
    entityId: row._id,
    canonicalGroupId: row.canonicalGroupId,
    archivedReason: row.archivedReason,
  }));
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
    labelsByProvenance: Object.fromEntries(
      Object.entries(
        groundTruthPairsByProvenance(
          groundTruth.canonicalGroupRows,
          AUTOMATED_MERGE_ARCHIVE_REASONS,
        ),
      ).map(([provenance, pairs]) => [
        provenance,
        {
          mergeRows: groundTruth.canonicalGroupRows.filter(
            (row) =>
              labelProvenance(row.archivedReason, AUTOMATED_MERGE_ARCHIVE_REASONS) === provenance,
          ).length,
          positivePairs: pairs.size,
        },
      ]),
    ),
    clusterSizeHistogram: clusterSizeHistogram(clusters),
    note: 'Positive pairs are within-cluster pairs of the merged-into-canonical ground truth. Hard negatives are built separately via buildLabeledNegatives over the same-name-different-person quarantines. labelsByProvenance splits them: automated labels were made by the engine being measured and unattributed ones cannot be told apart, so neither is operator-adjudicated truth.',
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
