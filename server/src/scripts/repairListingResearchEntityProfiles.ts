import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections, getListingModel } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { buildListingResearchEntityProfilePatch } from '../services/listingResearchEntityProfile';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

interface CliOptions {
  apply: boolean;
  limit: number;
}

interface PlannedRepair {
  listingId: string;
  researchEntityId: string;
  label: string;
  patch: Record<string, any>;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, limit: Infinity };
  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function planRepairs(limit: number): Promise<PlannedRepair[]> {
  const Listing = getListingModel();
  const query = Listing.find({
    archived: { $ne: true },
    confirmed: { $ne: false },
    researchEntityId: { $exists: true, $ne: null },
  }).sort({ updatedAt: -1 });
  if (Number.isFinite(limit)) query.limit(limit);

  const listings = await query.lean();
  const entityIds = Array.from(
    new Set(
      listings
        .map((listing: any) => listing.researchEntityId || listing.researchGroupId)
        .filter((id: any) => mongoose.Types.ObjectId.isValid(id))
        .map((id: any) => String(id)),
    ),
  );
  const entities = await ResearchEntity.find({ _id: { $in: entityIds } }).lean();
  const entityById = new Map(entities.map((entity: any) => [String(entity._id), entity]));
  const repairs: PlannedRepair[] = [];

  for (const listing of listings as any[]) {
    const researchEntityId = String(listing.researchEntityId || listing.researchGroupId || '');
    const entity = entityById.get(researchEntityId);
    if (!entity) continue;
    const patch = buildListingResearchEntityProfilePatch({ entity, listing });
    if (Object.keys(patch).length === 0) continue;
    repairs.push({
      listingId: String(listing._id),
      researchEntityId,
      label: entity.displayName || entity.name || entity.slug || researchEntityId,
      patch,
    });
  }

  return repairs;
}

async function applyRepairs(repairs: PlannedRepair[]) {
  for (const repair of repairs) {
    await ResearchEntity.updateOne({ _id: repair.researchEntityId }, { $set: repair.patch });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'repairListingResearchEntityProfiles',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const repairs = await planRepairs(options.limit);
  if (options.apply) await applyRepairs(repairs);

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'dry-run',
        environment: guard.environment,
        db: guard.dbLabel,
        scannedLimit: Number.isFinite(options.limit) ? options.limit : 'all',
        repairCount: repairs.length,
        fieldCounts: repairs.reduce<Record<string, number>>((acc, repair) => {
          for (const field of Object.keys(repair.patch)) acc[field] = (acc[field] || 0) + 1;
          return acc;
        }, {}),
        samples: repairs.slice(0, 20),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Failed to repair listing research entity profiles:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
