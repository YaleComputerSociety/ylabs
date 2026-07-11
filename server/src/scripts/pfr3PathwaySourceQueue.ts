import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { EntryPathway } from '../models/entryPathway';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { buildPathwaySourceQueue } from './pfr3PathwaySourceQueueCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

function parseSampleLimit(argv: string[]): number {
  if (argv.length === 0) return 0;
  if (argv.length !== 1 || !argv[0].startsWith('--sample-limit=')) {
    throw new Error('Usage: pfr3:pathway-source-queue [--sample-limit=0..100]');
  }
  const value = argv[0].slice('--sample-limit='.length);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100 || String(parsed) !== value) {
    throw new Error('--sample-limit requires an integer from 0 through 100');
  }
  return parsed;
}

async function main(): Promise<void> {
  const sampleLimit = parseSampleLimit(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: false,
    scriptName: 'pfr3:pathway-source-queue',
    mongoUrl: process.env.MONGODBURL,
  });
  const handleSalt = process.env.PFR3_QUEUE_HANDLE_SALT?.trim();
  if (!handleSalt || handleSalt.length < 16) {
    throw new Error('PFR3_QUEUE_HANDLE_SALT must contain at least 16 characters');
  }
  await initializeConnections();
  const candidates = await EntryPathway.find({ archived: { $ne: true } })
    .select('_id status evidenceStrength confidence sourceUrls sourceEvidenceIds archived')
    .lean();
  const report = buildPathwaySourceQueue(
    candidates.map((candidate: any) => ({ ...candidate, id: candidate._id })),
    { sampleLimit, handleSalt },
  );
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to build PFR-3 pathway source queue:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
