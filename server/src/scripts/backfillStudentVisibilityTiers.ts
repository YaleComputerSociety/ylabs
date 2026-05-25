import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { AccessSignal } from '../models/accessSignal';
import { EntryPathway } from '../models/entryPathway';
import { Fellowship } from '../models/fellowship';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import type { StudentVisibilityTier } from '../models/studentVisibility';
import {
  computeProgramStudentVisibility,
  computeResearchEntityStudentVisibility,
  STUDENT_VISIBILITY_VERSION,
} from '../services/studentVisibilityTier';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

interface CliOptions {
  apply: boolean;
  limit: number;
  collection: 'all' | 'research' | 'programs';
}

interface PlannedTierUpdate {
  id: string;
  label: string;
  currentTier?: string;
  tier: StudentVisibilityTier;
  computedTier: StudentVisibilityTier;
  reasons: string[];
}

const FORMALIZATION_ONLY_ENTRY_PATHWAY_TYPES = [
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
];

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    limit: Infinity,
    collection: 'all',
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
    } else if (arg === '--collection=research') {
      options.collection = 'research';
    } else if (arg === '--collection=programs') {
      options.collection = 'programs';
    } else if (arg === '--collection=all') {
      options.collection = 'all';
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] || 0) + 1;
};

const countByEntityId = (rows: Array<{ _id: unknown; count: number }>) =>
  new Map(rows.map((row) => [String(row._id), row.count]));

async function planResearchEntityUpdates(limit: number): Promise<PlannedTierUpdate[]> {
  const query = ResearchEntity.find({ archived: { $ne: true } }).sort({ name: 1 });
  if (Number.isFinite(limit)) query.limit(limit);
  const entities = await query.lean();
  const entityIds = entities.map((entity: any) => entity._id);
  const [leadRows, accessRows, pathwayRows, postedRows] = await Promise.all([
    ResearchGroupMember.find({
      researchEntityId: { $in: entityIds },
      isCurrentMember: { $ne: false },
      role: { $in: ['pi', 'co-pi', 'director', 'co-director'] },
    })
      .select('researchEntityId userId name role')
      .lean(),
    AccessSignal.aggregate([
      { $match: { researchEntityId: { $in: entityIds }, archived: false } },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
    EntryPathway.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          archived: false,
          pathwayType: { $nin: FORMALIZATION_ONLY_ENTRY_PATHWAY_TYPES },
        },
      },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
    PostedOpportunity.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          archived: false,
          status: { $in: ['OPEN', 'ROLLING'] },
        },
      },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
  ]);

  const leadsByEntityId = new Map<string, any[]>();
  for (const row of leadRows as any[]) {
    const key = String(row.researchEntityId);
    leadsByEntityId.set(key, [...(leadsByEntityId.get(key) || []), row]);
  }
  const accessCounts = countByEntityId(accessRows as any[]);
  const pathwayCounts = countByEntityId(pathwayRows as any[]);
  const postedCounts = countByEntityId(postedRows as any[]);

  return entities.map((entity: any) => {
    const id = String(entity._id);
    const result = computeResearchEntityStudentVisibility({
      entity,
      leadMembers: leadsByEntityId.get(id) || [],
      accessSignalCount: accessCounts.get(id) || 0,
      actionablePathwayCount: pathwayCounts.get(id) || 0,
      openPostedOpportunityCount: postedCounts.get(id) || 0,
    });
    return {
      id,
      label: entity.displayName || entity.name || entity.slug || id,
      currentTier: entity.studentVisibilityTier,
      tier: result.tier,
      computedTier: result.computedTier,
      reasons: result.reasons,
    };
  });
}

async function planProgramUpdates(limit: number): Promise<PlannedTierUpdate[]> {
  const query = Fellowship.find({ archived: false }).sort({ title: 1 });
  if (Number.isFinite(limit)) query.limit(limit);
  const programs = await query.lean();
  return programs.map((program: any) => {
    const result = computeProgramStudentVisibility(program);
    return {
      id: String(program._id),
      label: program.title || String(program._id),
      currentTier: program.studentVisibilityTier,
      tier: result.tier,
      computedTier: result.computedTier,
      reasons: result.reasons,
    };
  });
}

async function applyResearchUpdates(updates: PlannedTierUpdate[]) {
  for (const update of updates) {
    await ResearchEntity.updateOne(
      { _id: update.id },
      {
        $set: {
          studentVisibilityTier: update.tier,
          studentVisibilityComputedTier: update.computedTier,
          studentVisibilityReasons: update.reasons,
          studentVisibilityComputedAt: new Date(),
          studentVisibilityVersion: STUDENT_VISIBILITY_VERSION,
        },
      },
    );
  }
}

async function applyProgramUpdates(updates: PlannedTierUpdate[]) {
  for (const update of updates) {
    await Fellowship.updateOne(
      { _id: update.id },
      {
        $set: {
          studentVisibilityTier: update.tier,
          studentVisibilityComputedTier: update.computedTier,
          studentVisibilityReasons: update.reasons,
          studentVisibilityComputedAt: new Date(),
          studentVisibilityVersion: STUDENT_VISIBILITY_VERSION,
        },
      },
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'backfillStudentVisibilityTiers',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const research =
    options.collection === 'all' || options.collection === 'research'
      ? await planResearchEntityUpdates(options.limit)
      : [];
  const programs =
    options.collection === 'all' || options.collection === 'programs'
      ? await planProgramUpdates(options.limit)
      : [];

  if (options.apply) {
    await applyResearchUpdates(research);
    await applyProgramUpdates(programs);
  }

  const counts: Record<string, number> = {};
  for (const update of [...research, ...programs]) increment(counts, update.tier);

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'dry-run',
        environment: guard.environment,
        db: guard.dbLabel,
        collection: options.collection,
        version: STUDENT_VISIBILITY_VERSION,
        scanned: {
          research: research.length,
          programs: programs.length,
        },
        counts,
        samples: {
          research: research.slice(0, 20),
          programs: programs.slice(0, 20),
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Failed to backfill student visibility tiers:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
