/**
 * One-time migration: extract embedded User.publications arrays into a Paper collection.
 *
 * Strategy:
 *   - Group by DOI when present, fall back to (lowercased title, year) tuple otherwise.
 *   - Multiple Yale authors of the same paper collapse into one Paper document with
 *     yaleAuthorIds containing all matched users.
 *   - User.publications array is left in place (read by some legacy code paths until they migrate).
 *
 * Usage:
 *   npx tsx MigratePublicationsToPapers.ts            # dry run
 *   npx tsx MigratePublicationsToPapers.ts --live     # write to DB
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { userSchema } from '../server/src/models/user';
import { paperSchema } from '../server/src/models/paper';

dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const User = mongoose.model('users', userSchema);
const Paper = mongoose.model('papers', paperSchema);

const LIVE = process.argv.includes('--live');

interface EmbeddedPub {
  title: string;
  doi?: string;
  year?: number;
  venue?: string;
  cited_by_count?: number;
  open_access_url?: string;
  source?: string;
}

function dedupeKey(pub: EmbeddedPub): string {
  if (pub.doi) return `doi:${pub.doi.toLowerCase().trim()}`;
  const t = (pub.title || '').toLowerCase().trim().replace(/\s+/g, ' ');
  return `title:${t}|year:${pub.year ?? 'unknown'}`;
}

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set');
    process.exit(1);
  }

  console.log(`\n=== Migrate User.publications -> Paper collection ===`);
  console.log(`Mode: ${LIVE ? 'LIVE (writing to DB)' : 'DRY RUN'}\n`);

  await mongoose.connect(url);

  const users = await User.find({}, { _id: 1, netid: 1, fname: 1, lname: 1, publications: 1 })
    .select('+publications')
    .lean<any[]>();
  console.log(`Loaded ${users.length} users`);

  const grouped = new Map<
    string,
    {
      pub: EmbeddedPub;
      yaleAuthorIds: Set<string>;
      yaleAuthorNetIds: Set<string>;
      sources: Set<string>;
    }
  >();

  let totalEmbedded = 0;
  for (const user of users) {
    const pubs: EmbeddedPub[] = user.publications || [];
    for (const pub of pubs) {
      if (!pub?.title) continue;
      totalEmbedded++;
      const key = dedupeKey(pub);
      let entry = grouped.get(key);
      if (!entry) {
        entry = {
          pub,
          yaleAuthorIds: new Set(),
          yaleAuthorNetIds: new Set(),
          sources: new Set(),
        };
        grouped.set(key, entry);
      }
      entry.yaleAuthorIds.add(String(user._id));
      if (user.netid) entry.yaleAuthorNetIds.add(user.netid);
      if (pub.source) entry.sources.add(pub.source);
    }
  }

  console.log(`Embedded publications scanned: ${totalEmbedded}`);
  console.log(`Unique papers after dedup:     ${grouped.size}`);

  if (!LIVE) {
    console.log('\nDRY RUN — no writes. Re-run with --live to apply.');
    await mongoose.disconnect();
    return;
  }

  let inserted = 0;
  let updated = 0;
  const BATCH = 500;
  const entries = Array.from(grouped.values());
  for (let i = 0; i < entries.length; i += BATCH) {
    const slice = entries.slice(i, i + BATCH);
    const ops = slice.map((e) => {
      const filter: any = {};
      if (e.pub.doi) {
        filter.doi = e.pub.doi.toLowerCase().trim();
      } else {
        filter.title = e.pub.title;
        filter.year = e.pub.year;
      }
      return {
        updateOne: {
          filter,
          update: {
            $set: {
              title: e.pub.title,
              doi: e.pub.doi ? e.pub.doi.toLowerCase().trim() : undefined,
              year: e.pub.year,
              venue: e.pub.venue,
              citationCount: e.pub.cited_by_count || 0,
              openAccessUrl: e.pub.open_access_url,
              lastObservedAt: new Date(),
            },
            $addToSet: {
              yaleAuthorIds: { $each: Array.from(e.yaleAuthorIds) },
              yaleAuthorNetIds: { $each: Array.from(e.yaleAuthorNetIds) },
              sources: { $each: Array.from(e.sources) },
            },
          },
          upsert: true,
        },
      };
    });

    const result = await Paper.bulkWrite(ops as any, { ordered: false });
    inserted += result.upsertedCount || 0;
    updated += result.modifiedCount || 0;
    console.log(`  batch ${i / BATCH + 1}: +${result.upsertedCount} new, ${result.modifiedCount} updated`);
  }

  console.log(`\nDone. Inserted ${inserted}, updated ${updated}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
