/**
 * research-entity:archive-detachment-bypassing-leads - retires a lead edge that a
 * second row for an already-detached human holds, so the detachment the operator
 * recorded takes effect on the served surface (#3182).
 *
 * #3164 stopped the resolver minting such a twin and #3181 folds the netid ones,
 * but neither reaches a pair the corpus already holds under two different names.
 * The edge is archived rather than repointed, because the operator's judgement was
 * about the human rather than about the row, and nothing is minted to fill the
 * slot: where no other live lead edge remains the row is left to the ordinary gate
 * to hold on `missing_lead`, which `docs/decisions.md` records as the intended
 * outcome rather than a cost to be worked around.
 *
 * The report's `pastArchives` re-reads every archive this repair already made and
 * counts the ones the current rule would refuse (#5854).
 *
 *   yarn --cwd server research-entity:archive-detachment-bypassing-leads
 *   yarn --cwd server research-entity:archive-detachment-bypassing-leads --apply \
 *     --confirm-archive-detachment-bypassing-leads
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Researcher } from '../models/researcher';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { canonicalRoleForLegacy } from '../models/canonicalRoleMapping';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { PUBLIC_LEAD_ROLES } from '../services/researchGroupService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  classifyPastBypassArchive,
  DETACHED_REVIEW_STATUS,
  PAST_BYPASS_ARCHIVE_CLASSES,
  planDetachmentBypassRepair,
  type LeadEdgeLike,
  type PastBypassArchiveClass,
  type PersonIdentityLike,
} from './archiveDetachmentBypassingLeadEdgesCore';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.resolve(path.dirname(__filename), '../../.env'), quiet: true });

const SCRIPT_NAME = 'archive-detachment-bypassing-leads';
const BYPASS_ARCHIVE_NOTE =
  'Archived as a lead edge held by a second row for an already-detached human (#3182).';
const IDENTITY_FIELDS =
  '_id identifiers.netid identifiers.email identifiers.orcid distinctFromResearcherIds';

// `role_assignments.role` stores canonical roles; `PUBLIC_LEAD_ROLES` holds the
// legacy labels a SERVED member carries. Filtering stored edges by the legacy set
// matches nothing and reads as a clean zero, which is how an earlier pass
// concluded both rows would lose every lead.
const LEAD_CANONICAL_ROLES = Array.from(PUBLIC_LEAD_ROLES).flatMap((legacy) => {
  const canonical = canonicalRoleForLegacy(legacy);
  return canonical ? [canonical] : [];
});

export interface ArchiveBypassOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseArchiveBypassArgs(argv: string[]): ArchiveBypassOptions {
  const options: ArchiveBypassOptions = { apply: false, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-archive-detachment-bypassing-leads') options.confirm = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

const idOf = (value: unknown): string => (value == null ? '' : String(value));

const identityOf = (researcher: any): PersonIdentityLike => ({
  personId: idOf(researcher?._id),
  netid: researcher?.identifiers?.netid ?? null,
  email: researcher?.identifiers?.email ?? null,
  orcid: researcher?.identifiers?.orcid ?? null,
  distinctFromPersonIds: (researcher?.distinctFromResearcherIds ?? []).map(idOf),
});

async function loadIdentities(
  personIds: Iterable<string>,
): Promise<Map<string, PersonIdentityLike>> {
  const ids = [...new Set(personIds)].filter(Boolean);
  const researchers: any[] = await Researcher.find({ _id: { $in: ids } })
    .select(IDENTITY_FIELDS)
    .lean();
  return new Map(researchers.map((researcher) => [idOf(researcher._id), identityOf(researcher)]));
}

async function classifyPastBypassArchives(
  detachedEdges: any[],
): Promise<Record<PastBypassArchiveClass, number>> {
  const pastArchives: any[] = await RoleAssignment.find({
    reviewStatus: DETACHED_REVIEW_STATUS,
    reviewNotes: BYPASS_ARCHIVE_NOTE,
  })
    .select('_id personId target role archived reviewStatus')
    .lean();
  const detachments = detachedEdges.filter(
    (edge) => edge.target?.kind === 'RESEARCH_ENTITY' && edge.reviewNotes !== BYPASS_ARCHIVE_NOTE,
  );
  const identities = await loadIdentities(
    [...pastArchives, ...detachments].map((edge) => idOf(edge.personId)),
  );
  const counts = Object.fromEntries(PAST_BYPASS_ARCHIVE_CLASSES.map((c) => [c, 0])) as Record<
    PastBypassArchiveClass,
    number
  >;
  for (const archived of pastArchives) {
    const verdict = classifyPastBypassArchive({
      archivedEdge: {
        edgeId: idOf(archived._id),
        personId: idOf(archived.personId),
        entityId: idOf(archived.target?.id),
        role: String(archived.role),
        archived: archived.archived === true,
        reviewStatus: archived.reviewStatus ?? null,
      },
      archivedIdentity: identities.get(idOf(archived.personId)),
      detachments: detachments.map((detachment) => ({
        edgeId: idOf(detachment._id),
        personId: idOf(detachment.personId),
        entityId: idOf(detachment.target?.id),
        role: String(detachment.role),
        identity: identities.get(idOf(detachment.personId)),
      })),
    });
    counts[verdict] += 1;
  }
  return counts;
}

export async function runArchiveDetachmentBypassingLeadEdges(
  options: ArchiveBypassOptions,
): Promise<number> {
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (options.apply && !options.confirm) {
    throw new Error(
      `${SCRIPT_NAME} apply requires --confirm-archive-detachment-bypassing-leads. Mongo target: ${guard.dbLabel}.`,
    );
  }

  await initializeConnections();

  const detachedEdges = await RoleAssignment.find({ reviewStatus: DETACHED_REVIEW_STATUS })
    .select('_id personId target role reviewNotes')
    .lean();

  const rows: Array<Record<string, unknown>> = [];
  const archiveEdgeIds = new Set<string>();
  const regateEntityIds = new Set<string>();

  for (const detached of detachedEdges as any[]) {
    if (detached.target?.kind !== 'RESEARCH_ENTITY') continue;
    if (detached.reviewNotes === BYPASS_ARCHIVE_NOTE) continue;
    const entityId = idOf(detached.target?.id);
    if (!entityId) continue;
    const person: any = await Researcher.findById(detached.personId)
      .select(`displayName ${IDENTITY_FIELDS}`)
      .lean();
    const displayName = typeof person?.displayName === 'string' ? person.displayName : '';
    if (!displayName) continue;

    const twins: any[] = await Researcher.find({
      displayName,
      _id: { $ne: detached.personId },
      archived: { $ne: true },
    })
      .select(IDENTITY_FIELDS)
      .lean();
    if (twins.length === 0) continue;

    const entityLeadEdges: any[] = await RoleAssignment.find({
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': detached.target.id,
      role: { $in: LEAD_CANONICAL_ROLES },
    })
      .select('_id personId role archived reviewStatus')
      .lean();

    const plan = planDetachmentBypassRepair({
      detached: {
        edgeId: idOf(detached._id),
        personId: idOf(detached.personId),
        entityId,
        role: String(detached.role),
      },
      detachedIdentity: identityOf(person),
      twinCandidates: twins.map(identityOf),
      entityLeadEdges: entityLeadEdges.map((edge): LeadEdgeLike => ({
        edgeId: idOf(edge._id),
        personId: idOf(edge.personId),
        entityId,
        role: String(edge.role),
        archived: edge.archived === true,
        reviewStatus: edge.reviewStatus ?? null,
      })),
    });
    if (plan.verdict !== 'archive_bypassing_edge') continue;

    const entity: any = await ResearchEntity.findById(entityId)
      .select('entityType studentVisibilityTier')
      .lean();

    for (const edgeId of plan.bypassingEdgeIds) archiveEdgeIds.add(edgeId);
    regateEntityIds.add(entityId);
    rows.push({
      entityType: entity?.entityType ?? null,
      tierBefore: entity?.studentVisibilityTier ?? null,
      role: String(detached.role),
      bypassingEdges: plan.bypassingEdgeIds.length,
      survivingLeadEdges: plan.survivingLeadEdgeIds.length,
      outcome: plan.survivingLeadEdgeIds.length > 0 ? 'keeps_a_lead' : 'held_no_lead_remains',
    });
  }

  let edgesArchived = 0;
  let entitiesRegated = 0;
  if (options.apply && archiveEdgeIds.size > 0) {
    const result = await RoleAssignment.updateMany(
      { _id: { $in: Array.from(archiveEdgeIds).map((id) => new mongoose.Types.ObjectId(id)) } },
      {
        $set: {
          archived: true,
          reviewStatus: DETACHED_REVIEW_STATUS,
          reviewNotes: BYPASS_ARCHIVE_NOTE,
        },
      },
    );
    edgesArchived = result.modifiedCount ?? 0;

    // Re-gate through the ordinary gate rather than writing a tier, so every other
    // blocker still applies and the row lands on `missing_lead` on its own merits.
    if (regateEntityIds.size > 0) {
      await runStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: [...regateEntityIds],
      });
      entitiesRegated = regateEntityIds.size;
    }
  }

  const pastArchives = await classifyPastBypassArchives(detachedEdges as any[]);

  const report = {
    script: SCRIPT_NAME,
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    database: guard.dbLabel,
    leadCanonicalRoles: LEAD_CANONICAL_ROLES,
    detachedEdgesScanned: detachedEdges.length,
    bypassedRows: rows.length,
    edgesPlanned: archiveEdgeIds.size,
    edgesArchived,
    entitiesRegated,
    rowsKeepingALead: rows.filter((r) => r.outcome === 'keeps_a_lead').length,
    rowsHeldWithNoLeadRemaining: rows.filter((r) => r.outcome === 'held_no_lead_remains').length,
    pastArchives,
    rows,
  };

  if (options.output) {
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  console.log(JSON.stringify(report, null, 2));

  await mongoose.disconnect();
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (invokedDirectly) {
  runArchiveDetachmentBypassingLeadEdges(parseArchiveBypassArgs(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(String(error)));
      process.exit(1);
    });
}
