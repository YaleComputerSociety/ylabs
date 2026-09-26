/**
 * Read-only canonical reference-integrity audit (#210 Phase 6, #727).
 *
 * Counts dangling and missing-required ObjectId references on the canonical
 * relationship edges declared in `CANONICAL_REFERENCE_EDGES` (RoleAssignment,
 * Signal, ResearchEntityRelationship, and the canonical-collection outgoing
 * refs). It never writes anything.
 *
 * Usage:
 *   yarn --cwd server model-refactor:reference-integrity --environment development \
 *     --include-samples --output /tmp/ylabs-canonical-reference-integrity-dev.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertOperatorEnvironmentMatchesDatabase } from './operatorDatabaseEnvironment';
import { type ReferenceAuditInput } from './betaDataQualityCore';
import { auditReferenceEdge } from './referenceEdgeAudit';
import {
  buildCanonicalReferenceIntegrityReport,
  CANONICAL_REFERENCE_EDGES,
  parseCanonicalReferenceIntegrityArgs,
} from './canonicalReferenceIntegrityAuditCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main(): Promise<void> {
  const args = parseCanonicalReferenceIntegrityArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  if (args.output) resolveSafeJsonReportOutputPath(args.output);

  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db();
    assertOperatorEnvironmentMatchesDatabase(args.environment, db.databaseName);

    const inputs: ReferenceAuditInput[] = [];
    for (const edge of CANONICAL_REFERENCE_EDGES) {
      inputs.push(
        await auditReferenceEdge(db, edge, {
          includeSamples: args.includeSamples,
          sampleLimit: args.sampleLimit,
        }),
      );
    }

    const report = buildCanonicalReferenceIntegrityReport({
      environment: args.environment,
      databaseName: db.databaseName,
      inputs,
    });

    console.log(JSON.stringify({ ...report, target: summarizeMongoUrl(mongoUrl) }, null, 2));
    if (args.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(args.output);
      fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    await client.close();
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}
