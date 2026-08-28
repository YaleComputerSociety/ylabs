import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { getResearchEntityRosterByEntityId } from '../services/researchEntityMembershipAccessor';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  buildGateLeadRow,
  planForeignLeadGraftRetirement,
  summarizeForeignLeadGraftRetirement,
  type ForeignLeadGraftPlanRow,
  type ForeignLeadGraftSummary,
} from './retireForeignLeadGraftsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ENTITY_PROJECTION =
  '_id slug name displayName kind entityType website websiteUrl profileUrls sourceUrls studentVisibilityTier';

export interface ForeignLeadGraftCliOptions {
  dryRun: boolean;
  confirm: boolean;
  slugs: string[];
  entityIds: string[];
  limit?: number;
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function parseForeignLeadGraftArgs(argv: string[]): ForeignLeadGraftCliOptions {
  const options: ForeignLeadGraftCliOptions = {
    dryRun: true,
    confirm: false,
    slugs: [],
    entityIds: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm') options.confirm = true;
    else if (arg.startsWith('--slug=')) options.slugs.push(arg.slice('--slug='.length));
    else if (arg.startsWith('--entity-id=')) options.entityIds.push(arg.slice('--entity-id='.length));
    else if (arg.startsWith('--limit=')) options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export interface ForeignLeadGraftResult {
  mode: 'dry-run' | 'apply';
  summary: ForeignLeadGraftSummary;
  changes: ForeignLeadGraftPlanRow[];
}

async function planForeignLeadGraftRows(options: {
  slugs: string[];
  entityIds: string[];
  limit?: number;
}): Promise<ForeignLeadGraftPlanRow[]> {
  const filter: Record<string, unknown> = { archived: { $ne: true } };
  const scoped: Array<Record<string, unknown>> = [];
  if (options.slugs.length) scoped.push({ slug: { $in: options.slugs } });
  if (options.entityIds.length) {
    scoped.push({
      _id: { $in: options.entityIds.filter(mongoose.isValidObjectId).map((id) => new mongoose.Types.ObjectId(id)) },
    });
  }
  if (scoped.length) filter.$or = scoped;

  const query = ResearchEntity.find(filter).select(ENTITY_PROJECTION).sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = await query.lean();

  const rosterByEntityId = await getResearchEntityRosterByEntityId(entities.map((e: any) => e._id));

  const rows: ForeignLeadGraftPlanRow[] = [];
  for (const entity of entities as any[]) {
    const roster = rosterByEntityId.get(String(entity._id)) || [];
    if (roster.length === 0) continue;
    const leadRows = roster.map(buildGateLeadRow);
    const row = planForeignLeadGraftRetirement({ entity, leadRows });
    if (row) rows.push(row);
  }
  return rows;
}

export async function runForeignLeadGraftRetirement(options: {
  dryRun: boolean;
  slugs: string[];
  entityIds: string[];
  limit?: number;
}): Promise<ForeignLeadGraftResult> {
  const rows = await planForeignLeadGraftRows(options);

  if (!options.dryRun && rows.length > 0) {
    const roleAssignmentIds = rows
      .flatMap((row) => row.roleAssignmentIds)
      .filter(mongoose.isValidObjectId)
      .map((id) => new mongoose.Types.ObjectId(id));
    await RoleAssignment.updateMany(
      { _id: { $in: roleAssignmentIds } },
      {
        $set: {
          archived: true,
          reviewStatus: 'DISPUTED',
          reviewNotes: 'Retired as a non-corroborating foreign-identity lead graft (#1203).',
        },
      },
    );
    const affectedEntityIds = rows.map((row) => row.entityId);
    await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: affectedEntityIds,
    });
    const updatedDocs = await ResearchEntity.find({
      _id: { $in: affectedEntityIds.filter(mongoose.isValidObjectId).map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    await syncEntities('researchEntity', updatedDocs);
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeForeignLeadGraftRetirement(rows),
    changes: rows,
  };
}

async function main(): Promise<void> {
  const options = parseForeignLeadGraftArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) throw new Error('Apply mode requires --confirm.');
  if (apply && options.slugs.length === 0 && options.entityIds.length === 0) {
    throw new Error(
      'Apply mode requires an explicit --slug or --entity-id scope. A non-corroborating lead is ' +
        'an unverified identity, not a confirmed foreign graft (an opaque netid profile slug or a ' +
        'legal-vs-preferred name also fails corroboration), so retirement must target ' +
        'operator-verified entities. Run a corpus-wide dry-run to build the review queue first.',
    );
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'foreign-identity lead-graft retirement',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runForeignLeadGraftRetirement({
      dryRun: options.dryRun,
      slugs: options.slugs,
      entityIds: options.entityIds,
      limit: options.limit,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: {
        dryRun: options.dryRun,
        slugs: options.slugs,
        entityIds: options.entityIds,
        limit: options.limit,
      },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved foreign-lead-graft retirement report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result.summary, null, 2));
    console.log(JSON.stringify(result.changes, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
