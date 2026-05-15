/**
 * Backfill first-class PostedOpportunity records from legacy Listing rows.
 *
 * Dry-run by default; pass --apply or --live to write.
 *
 * Usage:
 *   npx tsx BackfillPostedOpportunitiesFromListings.ts
 *   npx tsx BackfillPostedOpportunitiesFromListings.ts --apply
 */
import mongoose from '../server/node_modules/mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Listing } from '../server/src/models/listing';
import {
  getEntryPathwayStatusForPostedOpportunity,
  getPostedOpportunityStatusForListing,
  materializePostedOpportunityFromListing,
} from '../server/src/services/postedOpportunityService';

dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const APPLY = process.argv.includes('--apply') || process.argv.includes('--live');

function parseLimit(): number | undefined {
  const eq = process.argv.find((arg) => arg.startsWith('--limit='));
  const raw = eq ? eq.split('=')[1] : process.argv[process.argv.indexOf('--limit') + 1];
  if (!raw || raw.startsWith('--')) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set');
    process.exit(1);
  }

  const limit = parseLimit();
  console.log('\n=== Backfill PostedOpportunity from Listing ===');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Limit: ${limit ?? 'none'}\n`);

  await mongoose.connect(url);

  const filter = {
    researchEntityId: { $exists: true, $ne: null },
  };
  const total = await Listing.countDocuments(filter);
  const query = Listing.find(filter).sort({ _id: 1 }).lean<any[]>();
  if (limit) query.limit(limit);
  const listings = await query;

  let processed = 0;
  let skipped = 0;
  let written = 0;
  const statusCounts = new Map<string, number>();
  const errors: Array<{ listingId: string; error: string }> = [];

  for (const listing of listings) {
    processed++;
    const status = getPostedOpportunityStatusForListing(listing);
    const pathwayStatus = getEntryPathwayStatusForPostedOpportunity(status);
    const countKey = `${status}/${pathwayStatus}`;
    statusCounts.set(countKey, (statusCounts.get(countKey) || 0) + 1);

    if (!APPLY) continue;

    try {
      const result = await materializePostedOpportunityFromListing(listing);
      if (result.skipped) {
        skipped++;
      } else {
        written++;
      }
    } catch (err: any) {
      errors.push({
        listingId: String(listing._id),
        error: err?.message || String(err),
      });
    }
  }

  console.log(`Listings with researchEntityId: ${total}`);
  console.log(`Listings processed:           ${processed}`);
  console.log(`Rows written:                 ${written}${APPLY ? '' : ' (dry run)'}`);
  console.log(`Skipped:                      ${skipped}`);
  console.log(`Errors:                       ${errors.length}`);
  console.log('\nStatus preview:');
  for (const [status, count] of statusCounts.entries()) {
    console.log(`  ${status}: ${count}`);
  }
  for (const error of errors.slice(0, 10)) {
    console.log(`  ${error.listingId}: ${error.error}`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
