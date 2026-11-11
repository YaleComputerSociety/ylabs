import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import {
  runStudentVisibilityGate,
  type StudentVisibilityGateReport,
} from '../services/studentVisibilityGateService';
import {
  cannotOwnResearchHome,
  statesResearchOwningAppointment,
} from '../utils/researchHomeOwnership';
import { isTraineeLevelTitle } from '../utils/traineeLevelTitle';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  researcherHoldsDirectoryIdentity,
  type ResearcherIdentitySource,
} from '../utils/researcherIdentity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  ownEvidenceTitlesByPersonId,
  planNonOwnerPiEdgeRestoration,
  planNonOwnerPiEdgeRetirement,
  planTraineeRosterArchive,
  summarizeNonOwnerPiEdgeRefusals,
  type LeadTitleEvidence,
  type NonOwnerPiEdgeRestorationGround,
  type NonOwnerPiEdgeRow,
  type OfficialProfileOwner,
  type PersonTitleObservation,
} from './retireNonOwnerPiEdgesCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'role-assignments:retire-non-owner-pi-edges';
export const CONFIRM_FLAG = '--confirm-retire-non-owner-pi-edges';
const LEAD_ROLES = ['PI', 'DIRECTOR'];
const RETIREMENT_NOTE =
  'Retired as a lead claim on someone whose title cannot own a research home (#2880, #1897).';
const RESTORATION_NOTE_BY_GROUND: Record<NonOwnerPiEdgeRestorationGround, string> = {
  'stored-title-no-longer-refuses':
    'Restored: the title this lane retired the lead claim on no longer refuses a research home (#5323).',
  'own-evidence-states-owning-appointment':
    "Restored: the person's own official profile states an appointment that can own a research row (#5855).",
};

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
    .select('_id profile.title profileLinks')
    .lean()) as unknown as Array<{
    _id: unknown;
    profile?: { title?: unknown };
    profileLinks?: Array<{ kind?: unknown; url?: unknown }>;
  }>;
  const titleByPersonId = new Map<string, string>();
  const officialProfileOwners: OfficialProfileOwner[] = [];
  for (const row of researchers) {
    const id = serializedDocumentId(row._id);
    if (!id) continue;
    titleByPersonId.set(id, String(row?.profile?.title || ''));
    const officialProfileUrls = (row.profileLinks ?? [])
      .filter((link) => link?.kind === 'YALE_OFFICIAL' && typeof link.url === 'string')
      .map((link) => String(link.url));
    if (officialProfileUrls.length > 0) {
      officialProfileOwners.push({ personId: id, officialProfileUrls });
    }
  }

  const personTitleObservations = (await Observation.find({
    entityType: 'user',
    field: { $in: ['title', 'profileUrls'] },
    superseded: { $ne: true },
  })
    .select('entityKey field value sourceUrl')
    .lean()) as unknown as PersonTitleObservation[];

  const evidence: LeadTitleEvidence = {
    storedTitleByPersonId: titleByPersonId,
    ownEvidenceTitlesByPersonId: ownEvidenceTitlesByPersonId(
      officialProfileOwners,
      personTitleObservations,
    ),
    cannotOwnResearchHome,
    statesResearchOwningAppointment,
  };

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

  const plan = planNonOwnerPiEdgeRetirement(edges, evidence);

  const retiredDocs = (await RoleAssignment.find({
    role: { $in: LEAD_ROLES },
    archived: true,
    state: { $ne: 'HISTORICAL' },
    reviewNotes: RETIREMENT_NOTE,
  })
    .select('_id personId target role reviewStatus reviewNotes')
    .lean()) as unknown as Array<Record<string, any>>;
  const liveEdgeKeys = new Set(
    edgeDocs.map(
      (doc) =>
        `${serializedDocumentId(doc.personId)}|${serializedDocumentId(doc.target?.id)}|${doc.role}`,
    ),
  );
  const restorable = planNonOwnerPiEdgeRestoration(
    retiredDocs.flatMap((doc) => {
      const id = serializedDocumentId(doc._id);
      const personId = serializedDocumentId(doc.personId);
      const entityId = serializedDocumentId(doc.target?.id) || '';
      if (!id || !personId) return [];
      if (liveEdgeKeys.has(`${personId}|${entityId}|${doc.role}`)) return [];
      return [
        {
          id,
          personId,
          entityId,
          reviewStatus: doc.reviewStatus ? String(doc.reviewStatus) : undefined,
          reviewNotes: doc.reviewNotes ? String(doc.reviewNotes) : undefined,
        },
      ];
    }),
    RETIREMENT_NOTE,
    evidence,
  );

  const directoryIdentityByPersonId = new Map<string, boolean>();
  const identityRows = (await Researcher.find({ archived: { $ne: true } })
    .select('_id identifiers.email')
    .lean()) as unknown as Array<{ _id: unknown } & ResearcherIdentitySource>;
  for (const row of identityRows) {
    const id = serializedDocumentId(row._id);
    if (id) directoryIdentityByPersonId.set(id, researcherHoldsDirectoryIdentity(row));
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
      holdsDirectoryIdentity: directoryIdentityByPersonId.get(id) === true,
      hasAnyRoleEdge: anyRoleEdge.has(id),
    })),
    isTraineeLevelTitle,
  );

  let retired = 0;
  let restored = 0;
  let corpusWideRegate: StudentVisibilityGateReport['counts'] | null = null;
  let archivedRosterRows = 0;
  for (const [ground, reviewNotes] of Object.entries(RESTORATION_NOTE_BY_GROUND) as Array<
    [NonOwnerPiEdgeRestorationGround, string]
  >) {
    const ids = restorable
      .filter((row) => row.ground === ground)
      .map((row) => row.id)
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (options.dryRun || ids.length === 0) continue;
    const result = await RoleAssignment.updateMany(
      { _id: { $in: ids }, archived: true, reviewStatus: 'DISPUTED', reviewNotes: RETIREMENT_NOTE },
      { $set: { archived: false, reviewStatus: 'UNREVIEWED', reviewNotes } },
    );
    restored += result.modifiedCount || 0;
  }
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
  }

  // Re-gate through the ordinary gate rather than writing tiers here, so every
  // other blocker on those rows still applies and the queue stays consistent.
  //
  // Corpus-wide rather than scoped to the affected rows. Every row this lane touches
  // has just lost its only lead, so a scoped apply hands the gate's zero-lead
  // ceiling a denominator of exactly those rows, reads ~100% and refuses. That
  // denominator is arithmetic, not a corpus signal.
  const regatedEntityIds = new Set(
    [...plan.retire, ...restorable].map((row) => row.entityId).filter(Boolean),
  );
  if (!options.dryRun && regatedEntityIds.size > 0) {
    const gateReport = await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    corpusWideRegate = gateReport.counts;
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
    plannedForRestoration: restorable.length,
    plannedForRestorationByGround: Object.fromEntries(
      Object.keys(RESTORATION_NOTE_BY_GROUND).map((ground) => [
        ground,
        restorable.filter((row) => row.ground === ground).length,
      ]),
    ),
    distinctEntitiesRestored: new Set(restorable.map((row) => row.entityId).filter(Boolean)).size,
    restored,
    corpusWideRegate,
    orphanTraineeRowsPlanned: rosterPlan.archive.length,
    orphanTraineeRowsArchived: archivedRosterRows,
    traineeRowsKeptBecause: rosterPlan.keptBecause,
  };
  console.log(JSON.stringify(report, null, 2));

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(
      options.output,
      JSON.stringify(
        {
          ...report,
          restorable: restorable.map((row) => ({
            edgeId: row.id,
            entityId: row.entityId,
            ground: row.ground,
          })),
        },
        null,
        2,
      ),
    );
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
