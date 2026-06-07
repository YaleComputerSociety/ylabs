import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections, getListingModel } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { buildListingResearchEntityProfilePatch } from '../services/listingResearchEntityProfile';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

export interface RepairListingResearchEntityProfilesCliOptions {
  apply: boolean;
  confirmListingProfileRepair: boolean;
  limit: number;
  output?: string;
}

interface PlannedRepair {
  listingId: string;
  researchEntityId: string;
  label: string;
  patch: Record<string, any>;
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseRequiredOutputPath(value: string | undefined): string {
  const output = value?.trim();
  if (!output || output.startsWith('--')) {
    throw new Error('--output requires a path');
  }
  return output;
}

export function parseRepairListingResearchEntityProfilesArgs(
  argv: string[],
): RepairListingResearchEntityProfilesCliOptions {
  const options: RepairListingResearchEntityProfilesCliOptions = {
    apply: false,
    confirmListingProfileRepair: false,
    limit: Infinity,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--confirm-listing-profile-repair') {
      options.confirmListingProfileRepair = true;
    } else if (arg.startsWith('--confirm-listing-profile-repair=')) {
      throw new Error('--confirm-listing-profile-repair does not accept a value');
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export function writeRepairListingResearchEntityProfilesOutput(
  report: unknown,
  output?: string,
): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildRepairListingResearchEntityProfilesOutput<T extends object>(
  report: T,
  metadata: {
    environment?: string;
    db?: string;
    options: RepairListingResearchEntityProfilesCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: RepairListingResearchEntityProfilesCliOptions;
} {
  return {
    ...report,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

export function assertRepairListingResearchEntityProfilesApplyAllowed(
  options: RepairListingResearchEntityProfilesCliOptions,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error(
      'repairListingResearchEntityProfiles --limit is required when --apply is set.',
    );
  }
  if (options.apply && !options.confirmListingProfileRepair) {
    throw new Error(
      '--confirm-listing-profile-repair is required when --apply is set for repairListingResearchEntityProfiles.',
    );
  }

  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'repairListingResearchEntityProfiles',
    mongoUrl,
    env,
  });
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
  const options = parseRepairListingResearchEntityProfilesArgs(process.argv.slice(2));
  const guard = assertRepairListingResearchEntityProfilesApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );

  await initializeConnections();
  const repairs = await planRepairs(options.limit);
  if (options.apply) await applyRepairs(repairs);

  const report = buildRepairListingResearchEntityProfilesOutput({
    mode: options.apply ? 'apply' : 'dry-run',
    scannedLimit: Number.isFinite(options.limit) ? options.limit : 'all',
    repairCount: repairs.length,
    fieldCounts: repairs.reduce<Record<string, number>>((acc, repair) => {
      for (const field of Object.keys(repair.patch)) acc[field] = (acc[field] || 0) + 1;
      return acc;
    }, {}),
    samples: repairs.slice(0, 20),
  }, {
    environment: guard.environment,
    db: guard.dbLabel,
    options,
  });

  console.log(JSON.stringify(report, null, 2));
  writeRepairListingResearchEntityProfilesOutput(report, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to repair listing research entity profiles:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
