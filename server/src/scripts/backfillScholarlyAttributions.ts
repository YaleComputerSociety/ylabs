import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchScholarlyAttribution } from '../models/researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import {
  buildScholarlyAttributionBackfillOps,
  parseBackfillScholarlyAttributionsArgs,
  summarizeScholarlyAttributionBackfill,
} from './backfillScholarlyAttributionsCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  const options = parseBackfillScholarlyAttributionsArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'scholarly-links:backfill-attributions',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const eligibleFilter = {
    archived: { $ne: true },
    $or: [
      { userId: { $exists: true, $ne: null } },
      { researchEntityId: { $exists: true, $ne: null } },
    ],
  };
  const totalEligible = await ResearchScholarlyLink.countDocuments(eligibleFilter);
  const links = await ResearchScholarlyLink.find(eligibleFilter)
    .sort({ updatedAt: -1, _id: 1 })
    .skip(options.offset)
    .limit(options.limit)
    .lean();

  const { ops, summary } = buildScholarlyAttributionBackfillOps(links as Record<string, any>[]);
  if (options.apply && ops.length > 0) {
    await ResearchScholarlyAttribution.bulkWrite(ops, { ordered: false });
  }

  console.log(
    JSON.stringify(
      summarizeScholarlyAttributionBackfill({
        ...summary,
        apply: options.apply,
        totalEligible,
        offset: options.offset,
      }),
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Failed to backfill scholarly attributions:', error);
  await mongoose.disconnect();
  process.exit(1);
});
