import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  entityIdsLeftWithNoEdge,
  planUnevidencedMemberEdgeRetirements,
  UNEVIDENCED_MEMBER_EDGE_RETIREMENT_NOTE,
  type UnevidencedMemberEdgeEntityInput,
  type UnevidencedMemberEdgeInput,
} from './retireUnevidencedMemberEdgesCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'role-assignments:retire-unevidenced-member-edges';
export const CONFIRM_FLAG = '--confirm-retire-unevidenced-member-edges';

export interface RetireUnevidencedMemberEdgeOptions {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseRetireUnevidencedMemberEdgeArgs(
  argv: string[],
): RetireUnevidencedMemberEdgeOptions {
  const options: RetireUnevidencedMemberEdgeOptions = { dryRun: true, confirmed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseRetireUnevidencedMemberEdgeArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }

  await initializeConnections();

  const edgeDocs = await RoleAssignment.find({ 'target.kind': 'RESEARCH_ENTITY' })
    .select('_id target.id role rosterProvenance archived')
    .lean();
  const edges: UnevidencedMemberEdgeInput[] = (edgeDocs as any[]).flatMap((doc) => {
    const id = serializedDocumentId(doc._id);
    const entityId = serializedDocumentId(doc?.target?.id);
    if (!id || !entityId) return [];
    return [
      {
        id,
        entityId,
        role: String(doc.role || ''),
        hasRosterProvenance: Boolean(doc.rosterProvenance),
        archived: doc.archived === true,
      },
    ];
  });

  const entityDocs = await ResearchEntity.find({
    _id: { $in: Array.from(new Set(edges.map((edge) => edge.entityId))) },
  })
    .select('_id slug entityType studentVisibilityTier archived')
    .lean();
  const entities: UnevidencedMemberEdgeEntityInput[] = (entityDocs as any[]).flatMap((doc) => {
    const id = serializedDocumentId(doc._id);
    if (!id) return [];
    return [
      {
        id,
        slug: String(doc.slug || ''),
        entityType: String(doc.entityType || ''),
        served:
          doc.archived !== true &&
          publicStudentVisibilityTiers.includes(doc.studentVisibilityTier as never),
      },
    ];
  });

  const plan = planUnevidencedMemberEdgeRetirements(edges, entities);
  const blanked = entityIdsLeftWithNoEdge(plan);

  let retired = 0;
  if (!options.dryRun && plan.retire.length > 0) {
    if (blanked.length > 0) {
      throw new Error(
        `${SCRIPT_NAME} refused: ${blanked.length} row(s) would be left with no member edge at all. A served page asserting nobody is worse than the claim being repaired.`,
      );
    }
    const result = await RoleAssignment.updateMany(
      {
        _id: {
          $in: plan.retire
            .map((row) => row.id)
            .filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        },
        archived: { $ne: true },
      },
      {
        $set: {
          archived: true,
          reviewStatus: 'DISPUTED',
          reviewNotes: UNEVIDENCED_MEMBER_EDGE_RETIREMENT_NOTE,
        },
      },
    );
    retired = result.modifiedCount || 0;
  }

  const report = {
    script: SCRIPT_NAME,
    generatedAt: new Date().toISOString(),
    mode: options.dryRun ? 'dry-run' : 'apply',
    databaseName: mongoose.connection.db?.databaseName,
    edgesExamined: edges.length,
    planned: plan.retire.length,
    retired,
    entitiesTouched: Object.keys(plan.remainingByEntityId).length,
    rowsLeftWithNoEdge: blanked.length,
    remainingEdgesPerTouchedRow: Object.values(plan.remainingByEntityId).sort((a, b) => a - b),
    byRole: plan.retire.reduce<Record<string, number>>((acc, row) => {
      acc[row.role] = (acc[row.role] || 0) + 1;
      return acc;
    }, {}),
    skipped: plan.skipped,
  };

  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Saved report to ${options.output}`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (invokedDirectly) {
  main().catch(async (error) => {
    console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(error));
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
