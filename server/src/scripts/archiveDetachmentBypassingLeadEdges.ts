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
  DETACHED_REVIEW_STATUS,
  planDetachmentBypassRepair,
  type LeadEdgeLike,
} from './archiveDetachmentBypassingLeadEdgesCore';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.resolve(path.dirname(__filename), '../../.env') });

const SCRIPT_NAME = 'archive-detachment-bypassing-leads';

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
    .select('_id personId target role')
    .lean();

  const rows: Array<Record<string, unknown>> = [];
  const archiveEdgeIds = new Set<string>();
  const regateEntityIds = new Set<string>();

  for (const detached of detachedEdges as any[]) {
    if (detached.target?.kind !== 'RESEARCH_ENTITY') continue;
    const entityId = idOf(detached.target?.id);
    if (!entityId) continue;
    const person: any = await Researcher.findById(detached.personId).select('displayName').lean();
    const displayName = typeof person?.displayName === 'string' ? person.displayName : '';
    if (!displayName) continue;

    const twins: any[] = await Researcher.find({
      displayName,
      _id: { $ne: detached.personId },
      archived: { $ne: true },
    })
      .select('_id')
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
      twinPersonIds: twins.map((t) => idOf(t._id)),
      entityLeadEdges: entityLeadEdges.map(
        (edge): LeadEdgeLike => ({
          edgeId: idOf(edge._id),
          personId: idOf(edge.personId),
          entityId,
          role: String(edge.role),
          archived: edge.archived === true,
          reviewStatus: edge.reviewStatus ?? null,
        }),
      ),
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
          reviewNotes:
            'Archived as a lead edge held by a second row for an already-detached human (#3182).',
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
