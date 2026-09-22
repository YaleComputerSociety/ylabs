import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import {
  runStudentVisibilityGate,
  type StudentVisibilityGateReport,
} from '../services/studentVisibilityGateService';
import { cannotOwnResearchHome } from '../utils/researchHomeOwnership';
import { isTraineeLevelTitle } from '../utils/traineeLevelTitle';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planNonOwnerPiEdgeRetirement,
  planTraineeRosterArchive,
  summarizeNonOwnerPiEdgeRefusals,
  type NonOwnerPiEdgeRow,
} from './retireNonOwnerPiEdgesCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'role-assignments:retire-non-owner-pi-edges';
export const CONFIRM_FLAG = '--confirm-retire-non-owner-pi-edges';
const LEAD_ROLES = ['PI', 'DIRECTOR'];
const RETIREMENT_NOTE =
  'Retired as a lead claim on someone whose title cannot own a research home (#2880, #1897).';

export interface RetireNonOwnerPiEdgeOptions {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseRetireNonOwnerPiEdgeArgs(argv: string[]): RetireNonOwnerPiEdgeOptions {
  const options: RetireNonOwnerPiEdgeOptions = { dryRun: true, confirmed: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseRetireNonOwnerPiEdgeArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }

  await initializeConnections();

  const researchers = (await Researcher.find({ archived: { $ne: true } })
    .select('_id profile.title')
    .lean()) as unknown as Array<{ _id: unknown; profile?: { title?: unknown } }>;
  const titleByPersonId = new Map<string, string>();
  for (const row of researchers) {
    const id = serializedDocumentId(row._id);
    if (id) titleByPersonId.set(id, String(row?.profile?.title || ''));
  }

  const edgeDocs = (await RoleAssignment.find({
    role: { $in: LEAD_ROLES },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('_id personId target role reviewStatus rosterProvenance')
    .lean()) as unknown as Array<Record<string, any>>;

  const edges: NonOwnerPiEdgeRow[] = edgeDocs.flatMap((doc) => {
    const id = serializedDocumentId(doc._id);
    const personId = serializedDocumentId(doc.personId);
    if (!id || !personId) return [];
    return [
      {
        id,
        personId,
        entityId: serializedDocumentId(doc.target?.id) || '',
        role: String(doc.role),
        reviewStatus: doc.reviewStatus ? String(doc.reviewStatus) : undefined,
        sourceName: doc.rosterProvenance?.sourceName
          ? String(doc.rosterProvenance.sourceName)
          : undefined,
      },
    ];
  });

  const plan = planNonOwnerPiEdgeRetirement(edges, cannotOwnResearchHome, titleByPersonId);

  const accountByPersonId = new Map<string, boolean>();
  const accountRows = (await Researcher.find({ archived: { $ne: true } })
    .select('_id accountId')
    .lean()) as unknown as Array<{ _id: unknown; accountId?: unknown }>;
  for (const row of accountRows) {
    const id = serializedDocumentId(row._id);
    if (id) accountByPersonId.set(id, Boolean(row.accountId));
  }
  const anyRoleEdge = new Set(
    (
      (await RoleAssignment.find({}).select('personId').lean()) as unknown as Array<{
        personId: unknown;
      }>
    )
      .map((row) => serializedDocumentId(row.personId))
      .filter((id): id is string => Boolean(id)),
  );
  const rosterPlan = planTraineeRosterArchive(
    [...titleByPersonId.entries()].map(([id, title]) => ({
      id,
      title,
      hasAccount: accountByPersonId.get(id) === true,
      hasAnyRoleEdge: anyRoleEdge.has(id),
    })),
    isTraineeLevelTitle,
  );

  let retired = 0;
  let corpusWideRegate: StudentVisibilityGateReport['counts'] | null = null;
  let archivedRosterRows = 0;
  if (!options.dryRun && plan.retire.length > 0) {
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
      { $set: { archived: true, reviewStatus: 'DISPUTED', reviewNotes: RETIREMENT_NOTE } },
    );
    retired = result.modifiedCount || 0;

    // Re-gate through the ordinary gate rather than writing tiers here, so every
    // other blocker on those rows still applies and the queue stays consistent.
    //
    // Corpus-wide rather than scoped to the affected rows. Every row this lane touches
    // has just lost its only lead, so a scoped apply hands the gate's zero-lead
    // ceiling a denominator of exactly those rows, reads ~100% and refuses. That
    // denominator is arithmetic, not a corpus signal.
    const entityIds = [...new Set(plan.retire.map((row) => row.entityId).filter(Boolean))];
    if (entityIds.length > 0) {
      const gateReport = await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
      corpusWideRegate = gateReport.counts;
    }
  }

  // Deliberately not nested inside the edge arm above. Keying one arm on another
  // arm's plan makes it a silent no-op on any re-run where the first arm is already
  // done, which is how a repair passes while doing nothing (#2858).
  if (!options.dryRun && rosterPlan.archive.length > 0) {
    const archivedRows = await Researcher.updateMany(
      {
        _id: {
          $in: rosterPlan.archive
            .filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        },
        archived: { $ne: true },
      },
      { $set: { archived: true } },
    );
    archivedRosterRows = archivedRows.modifiedCount || 0;
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    leadEdgesScanned: edges.length,
    plannedForRetirement: plan.retire.length,
    distinctEntitiesAffected: new Set(plan.retire.map((row) => row.entityId).filter(Boolean)).size,
    refusedByReason: summarizeNonOwnerPiEdgeRefusals(plan.refused),
    retired,
    corpusWideRegate,
    orphanTraineeRowsPlanned: rosterPlan.archive.length,
    orphanTraineeRowsArchived: archivedRosterRows,
    traineeRowsKeptBecause: rosterPlan.keptBecause,
  };
  console.log(JSON.stringify(report, null, 2));

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`Saved report to ${options.output}`);
  }

  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
