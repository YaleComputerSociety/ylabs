/**
 * Backfill v4 Listing bridge fields from legacy listing ownership.
 *
 * Sets Listing.createdByUserId and Listing.researchGroupId using ownerId/netid.
 * Dry-run by default; pass --apply to write. Supports --limit N / --limit=N.
 */
import mongoose from '../server/node_modules/mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Department, DepartmentCategory } from '../server/src/models/department';
import { Listing } from '../server/src/models/listing';
import { ResearchGroup } from '../server/src/models/researchGroup';
import { ResearchGroupMember } from '../server/src/models/researchGroupMember';
import { User } from '../server/src/models/user';

dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const APPLY = process.argv.includes('--apply') || process.argv.includes('--live');
const NON_LAB_CATEGORIES = new Set<string>([
  DepartmentCategory.SOCIAL_SCIENCES,
  DepartmentCategory.HUMANITIES_ARTS,
  DepartmentCategory.ECONOMICS,
]);

interface OwnerLike {
  _id: mongoose.Types.ObjectId;
  netid?: string;
  fname?: string;
  lname?: string;
  primary_department?: string;
}

function parseLimit(): number | undefined {
  const eq = process.argv.find((arg) => arg.startsWith('--limit='));
  const raw = eq ? eq.split('=')[1] : process.argv[process.argv.indexOf('--limit') + 1];
  if (!raw || raw.startsWith('--')) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function existingGroupIdForOwner(userId: mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId | null> {
  const member = await ResearchGroupMember.findOne(
    { userId, role: 'pi' },
    { researchGroupId: 1 },
  ).lean<any>();
  return member?.researchGroupId || null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/['\u2018\u2019]s\b/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function inferKindFromDepartment(deptName?: string): Promise<'lab' | 'individual'> {
  if (!deptName) return 'lab';
  const dept = await Department.findOne({
    $or: [{ name: deptName }, { displayName: deptName }, { abbreviation: deptName }],
  }).lean<any>();
  if (dept?.primaryCategory && NON_LAB_CATEGORIES.has(dept.primaryCategory)) return 'individual';
  return 'lab';
}

function ownerSlugSeed(owner: OwnerLike, kind: 'lab' | 'individual'): string {
  const surname = (owner.lname || '').trim();
  const netid = (owner.netid || '').trim().toLowerCase();
  if (kind === 'individual') {
    if (surname) return `${slugify(surname)}-${netid || 'profile'}`;
    return `${netid || 'profile'}-research`;
  }
  if (surname) return `${slugify(surname)}-lab-${netid || ''}`.replace(/-+$/, '');
  return `${netid || 'unknown'}-lab`;
}

function ownerDisplayName(owner: OwnerLike, kind: 'lab' | 'individual'): string {
  const surname = (owner.lname || '').trim();
  const fname = (owner.fname || '').trim();
  if (kind === 'individual') {
    if (fname && surname) return `${fname} ${surname} - Research`;
    if (surname) return `${surname} Research`;
    return owner.netid ? `${owner.netid} Research` : 'Research';
  }
  if (surname) return `${surname} Lab`;
  return owner.netid ? `${owner.netid} Lab` : 'Lab';
}

async function findOrCreateGroupForOwner(owner: OwnerLike): Promise<mongoose.Types.ObjectId | null> {
  const existingGroupId = await existingGroupIdForOwner(owner._id);
  if (existingGroupId) return existingGroupId;

  const kind = await inferKindFromDepartment(owner.primary_department);
  const slug = ownerSlugSeed(owner, kind);
  const name = ownerDisplayName(owner, kind);
  const group = await ResearchGroup.findOneAndUpdate(
    { slug },
    {
      $setOnInsert: {
        slug,
        name,
        kind,
        openness: 'open',
        acceptingUndergrads: true,
        lastObservedAt: new Date(),
        sourceUrls: [],
        departments: owner.primary_department ? [owner.primary_department] : [],
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean<any>();

  await ResearchGroupMember.updateOne(
    { researchGroupId: group._id, userId: owner._id },
    {
      $setOnInsert: {
        researchGroupId: group._id,
        userId: owner._id,
        role: 'pi',
        startedAt: new Date(),
        lastObservedAt: new Date(),
      },
    },
    { upsert: true },
  );

  return group?._id || null;
}

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set');
    process.exit(1);
  }

  const limit = parseLimit();
  console.log('\n=== Backfill v4 Listing legacy bridges ===');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Limit: ${limit ?? 'none'}\n`);

  await mongoose.connect(url);

  const filter = {
    $or: [
      { createdByUserId: { $exists: false } },
      { createdByUserId: null },
      { researchGroupId: { $exists: false } },
      { researchGroupId: null },
    ],
  };
  const total = await Listing.countDocuments(filter);
  const query = Listing.find(filter, {
    _id: 1,
    ownerId: 1,
    createdByUserId: 1,
    researchGroupId: 1,
  }).sort({ _id: 1 }).lean<any[]>();
  if (limit) query.limit(limit);
  const listings = await query;
  console.log(`Listings missing bridge fields: ${total}; processing ${listings.length}`);

  let linkedUsers = 0;
  let linkedGroups = 0;
  let groupsCreatedOrEnsured = 0;
  let skipped = 0;
  const errors: Array<{ listingId: string; error: string }> = [];

  for (const listing of listings) {
    const ownerNetid = String(listing.ownerId || '').trim();
    if (!ownerNetid) {
      skipped++;
      continue;
    }

    try {
      const owner = await User.findOne({ netid: ownerNetid }).lean<any>();
      if (!owner) {
        skipped++;
        continue;
      }

      let researchGroupId = listing.researchGroupId;
      if (!researchGroupId) {
        if (APPLY) {
          researchGroupId = await findOrCreateGroupForOwner({
            _id: owner._id,
            netid: owner.netid,
            fname: owner.fname,
            lname: owner.lname,
            primary_department: owner.primary_department,
          });
          if (researchGroupId) groupsCreatedOrEnsured++;
        } else {
          researchGroupId = await existingGroupIdForOwner(owner._id);
          if (!researchGroupId) groupsCreatedOrEnsured++;
        }
      }

      const set: Record<string, unknown> = {};
      if (!listing.createdByUserId) set.createdByUserId = owner._id;
      if (!listing.researchGroupId && researchGroupId) set.researchGroupId = researchGroupId;

      if (Object.keys(set).length === 0) {
        skipped++;
        continue;
      }

      if (APPLY) {
        await Listing.updateOne(
          {
            _id: listing._id,
            $or: [
              { createdByUserId: { $exists: false } },
              { createdByUserId: null },
              { researchGroupId: { $exists: false } },
              { researchGroupId: null },
            ],
          },
          { $set: set },
        );
      }

      if (set.createdByUserId) linkedUsers++;
      if (set.researchGroupId) linkedGroups++;
    } catch (err: any) {
      errors.push({ listingId: String(listing._id), error: err?.message || String(err) });
    }
  }

  console.log('\nDone.');
  console.log(`  Listings processed:       ${listings.length}`);
  console.log(`  createdByUserId set:      ${linkedUsers} ${APPLY ? '' : '(dry run)'}`);
  console.log(`  researchGroupId set:      ${linkedGroups} ${APPLY ? '' : '(dry run)'}`);
  console.log(`  Groups created/ensured:   ${groupsCreatedOrEnsured} ${APPLY ? '' : '(dry run)'}`);
  console.log(`  Skipped:                  ${skipped}`);
  console.log(`  Errors:                   ${errors.length}`);
  for (const error of errors.slice(0, 10)) console.log(`  ${error.listingId}: ${error.error}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
