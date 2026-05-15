/**
 * One-time backfill: every existing Listing without a researchGroupId gets one.
 *
 * For each Listing:
 *   - Look up the owning User by Listing.ownerId (netid).
 *   - Call findOrCreateForOwner to get or create a stub ResearchGroup + PI member row.
 *   - Set Listing.researchGroupId.
 *
 * Idempotent: re-running skips listings that already have a researchGroupId.
 *
 * Usage:
 *   npx tsx BackfillListingResearchGroups.ts            # dry run
 *   npx tsx BackfillListingResearchGroups.ts --live     # write
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { listingSchema } from '../server/src/models/listing';
import { userSchema } from '../server/src/models/user';
import { findOrCreateForOwner } from '../server/src/services/researchGroupService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const Listing = mongoose.model('Listing', listingSchema, 'listings');
const User = mongoose.model('User', userSchema, 'users');

const LIVE = process.argv.includes('--live');

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set');
    process.exit(1);
  }
  console.log(`\n=== Backfill Listing.researchGroupId ===`);
  console.log(`Mode: ${LIVE ? 'LIVE' : 'DRY RUN'}\n`);
  await mongoose.connect(url);

  const filter: any = {
    $or: [{ researchGroupId: { $exists: false } }, { researchGroupId: null }],
  };
  const total = await Listing.countDocuments(filter);
  console.log(`Listings missing researchGroupId: ${total}`);

  let processed = 0;
  let attached = 0;
  let createdGroups = 0;
  let skipped = 0;
  const errors: Array<{ listingId: string; error: string }> = [];

  const allListings = await Listing.find(filter, { _id: 1, ownerId: 1 }).lean();
  console.log(`Loaded ${allListings.length} listings into memory; processing...`);

  for (const listing of allListings) {
    processed++;
    const ownerNetid = (listing as any).ownerId;
    if (!ownerNetid) {
      skipped++;
      continue;
    }
    try {
      const owner: any = await User.findOne({ netid: ownerNetid }).lean();
      if (!owner) {
        skipped++;
        continue;
      }
      const { group, created } = await findOrCreateForOwner({
        _id: owner._id,
        netid: owner.netid,
        fname: owner.fname,
        lname: owner.lname,
        primary_department: owner.primary_department,
      });
      if (created) createdGroups++;
      if (group) {
        if (LIVE) {
          await Listing.updateOne({ _id: listing._id }, { $set: { researchGroupId: group._id } });
        }
        attached++;
      }
    } catch (err: any) {
      errors.push({ listingId: String(listing._id), error: err?.message || String(err) });
    }
    if (processed % 100 === 0) {
      console.log(`  progress: ${processed}/${total} | attached ${attached} | new groups ${createdGroups}`);
    }
  }

  console.log(`\nDone.`);
  console.log(`  Listings processed:    ${processed}`);
  console.log(`  Listings attached:     ${attached} ${LIVE ? '' : '(dry run)'}`);
  console.log(`  ResearchGroups created: ${createdGroups}`);
  console.log(`  Skipped (no owner):    ${skipped}`);
  console.log(`  Errors:                ${errors.length}`);
  if (errors.length > 0) {
    console.log(`\nFirst 10 errors:`);
    for (const e of errors.slice(0, 10)) {
      console.log(`  ${e.listingId}: ${e.error}`);
    }
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
