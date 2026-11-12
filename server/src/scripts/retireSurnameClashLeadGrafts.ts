import dotenv from 'dotenv';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { researchEntityIdentityTokens } from '../scrapers/utils/personProfileEntityMatch';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { researcherCarriesIdentityEvidence } from '../utils/researcherIdentity';
import { servedSiteLeadVerdicts } from '../utils/leadContradictedByNamesake';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  pastDetachmentsOfTheNamedPerson,
  planSurnameClashLeadDetachment,
  summarizeSurnameClashRefusals,
  surnameClashGroups,
  type PastSurnameClashDetachment,
  type SurnameClashEntityRow,
  type SurnameClashLeadIdentity,
  type SurnameClashLeadRow,
} from './retireSurnameClashLeadGraftsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'role-assignments:retire-surname-clash-lead-grafts';
export const CONFIRM_FLAG = '--confirm-retire-surname-clash-lead-grafts';
const LEAD_ROLES = LEAD_ROLE_CANONICAL_VALUES;
const DETACH_NOTE =
  'Detached as a same-surname lead on an entity whose own identity names a different person (#2768).';

export interface RetireSurnameClashOptions {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
}

export function parseRetireSurnameClashArgs(argv: string[]): RetireSurnameClashOptions {
  const options: RetireSurnameClashOptions = { dryRun: true, confirmed: false };
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

interface PersonIdentity {
  displayName: string;
  identityAnchored: boolean;
  identity: SurnameClashLeadIdentity;
  archivedDuplicate: boolean;
}

const optionalText = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
};

async function loadPersonIdentities(): Promise<Map<string, PersonIdentity>> {
  const researchers = (await Researcher.find({
    $or: [{ archived: { $ne: true } }, { dedupedIntoResearcherId: { $exists: true, $ne: null } }],
  })
    .select(
      '_id displayName archived dedupedIntoResearcherId identifiers profileLinks.kind profile.title profile.primaryDepartment',
    )
    .lean()) as unknown as Array<Record<string, any>>;
  const identities = new Map<string, PersonIdentity>();
  for (const row of researchers) {
    const id = serializedDocumentId(row._id);
    if (!id) continue;
    const displayName = String(row.displayName || '').trim();
    if (!displayName) continue;
    identities.set(id, {
      displayName,
      identityAnchored: researcherCarriesIdentityEvidence(row),
      identity: {
        netid: optionalText(row.identifiers?.netid),
        email: optionalText(row.identifiers?.email),
        orcid: optionalText(row.identifiers?.orcid),
        title: optionalText(row.profile?.title),
        department: optionalText(row.profile?.primaryDepartment),
        dedupedIntoPersonId: serializedDocumentId(row.dedupedIntoResearcherId),
      },
      archivedDuplicate: row.archived === true,
    });
  }
  return identities;
}

/**
 * An archived duplicate's live lead edge is read only beside a lead edge of the record
 * it was folded into, where it is evidence that the clash is one person (#5941). Alone,
 * it is not a clash member: the repair never judged archived records before.
 */
function withoutStrayArchivedDuplicates(
  leads: readonly SurnameClashLeadRow[],
  identities: ReadonlyMap<string, PersonIdentity>,
): SurnameClashLeadRow[] {
  const personIds = new Set(leads.map((lead) => lead.personId));
  return leads.filter((lead) => {
    const identity = identities.get(lead.personId);
    if (!identity?.archivedDuplicate) return true;
    const dedupedInto = identity.identity.dedupedIntoPersonId;
    return Boolean(dedupedInto && personIds.has(dedupedInto));
  });
}

async function loadClashEntities(
  identities: ReadonlyMap<string, PersonIdentity>,
): Promise<{ rows: SurnameClashEntityRow[]; slugByEntityId: Map<string, string> }> {
  const assignments = (await RoleAssignment.find({
    role: { $in: LEAD_ROLES },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
    'target.kind': 'RESEARCH_ENTITY',
  })
    .select('_id personId target reviewStatus rosterProvenance.evidenceStatus')
    .lean()) as unknown as Array<Record<string, any>>;

  const leadsByEntityId = new Map<string, SurnameClashLeadRow[]>();
  for (const doc of assignments) {
    const entityId = serializedDocumentId(doc.target?.id);
    const assignmentId = serializedDocumentId(doc._id);
    const personId = serializedDocumentId(doc.personId);
    if (!entityId || !assignmentId || !personId) continue;
    const identity = identities.get(personId);
    if (!identity) continue;
    leadsByEntityId.set(entityId, [
      ...(leadsByEntityId.get(entityId) || []),
      {
        assignmentId,
        personId,
        displayName: identity.displayName,
        reviewStatus: doc.reviewStatus ? String(doc.reviewStatus) : undefined,
        identityAnchored: identity.identityAnchored,
        identity: identity.identity,
        rosterVerified:
          String(doc.rosterProvenance?.evidenceStatus || '')
            .trim()
            .toLowerCase() === 'verified',
      },
    ]);
  }

  for (const [entityId, leads] of leadsByEntityId) {
    leadsByEntityId.set(entityId, withoutStrayArchivedDuplicates(leads, identities));
  }

  const clashEntityIds = [...leadsByEntityId.entries()]
    .filter(([, leads]) => surnameClashGroups(leads).length > 0)
    .map(([entityId]) => entityId)
    .filter((entityId) => mongoose.isValidObjectId(entityId));

  const entityDocs = (await ResearchEntity.find({
    _id: { $in: clashEntityIds.map((id) => new mongoose.Types.ObjectId(id)) },
    archived: { $ne: true },
  })
    .select('_id slug name displayName websiteUrl website leadVerification')
    .lean()) as unknown as Array<Record<string, any>>;

  const rows: SurnameClashEntityRow[] = [];
  const slugByEntityId = new Map<string, string>();
  for (const entity of entityDocs) {
    const entityId = serializedDocumentId(entity._id);
    if (!entityId) continue;
    const siteVerdicts = servedSiteLeadVerdicts(entity);
    rows.push({
      entityId,
      identityTokens: researchEntityIdentityTokens({
        name: entity.name,
        displayName: entity.displayName,
        slug: entity.slug,
      }),
      leads: (leadsByEntityId.get(entityId) || []).map((lead) => {
        const servedSiteVerdict = siteVerdicts.get(lead.personId);
        return servedSiteVerdict ? { ...lead, servedSiteVerdict } : lead;
      }),
    });
    slugByEntityId.set(entityId, String(entity.slug || ''));
  }
  return { rows, slugByEntityId };
}

/**
 * For each entity, the records that archived duplicates which ever led it were folded
 * into, read from `dedupedIntoResearcherId` on every lead edge this repair did not detach.
 */
async function loadArchivedDuplicateLeadTargets(
  entityIds: readonly unknown[],
): Promise<Map<string, Set<string>>> {
  const edges = (await RoleAssignment.find({
    role: { $in: LEAD_ROLES },
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: entityIds },
    reviewNotes: { $ne: DETACH_NOTE },
  })
    .select('personId target')
    .lean()) as unknown as Array<Record<string, any>>;
  const duplicates = (await Researcher.find({
    _id: { $in: [...new Set(edges.map((edge) => edge.personId))] },
    archived: true,
    dedupedIntoResearcherId: { $exists: true, $ne: null },
  })
    .select('_id dedupedIntoResearcherId')
    .lean()) as unknown as Array<Record<string, any>>;
  const targetByDuplicateId = new Map(
    duplicates.map((row) => [
      serializedDocumentId(row._id),
      serializedDocumentId(row.dedupedIntoResearcherId),
    ]),
  );
  const targetsByEntityId = new Map<string, Set<string>>();
  for (const edge of edges) {
    const entityId = serializedDocumentId(edge.target?.id);
    const target = targetByDuplicateId.get(serializedDocumentId(edge.personId));
    if (!entityId || !target) continue;
    targetsByEntityId.set(entityId, (targetsByEntityId.get(entityId) || new Set()).add(target));
  }
  return targetsByEntityId;
}

async function loadPastDetachments(): Promise<{
  detachments: PastSurnameClashDetachment[];
  slugByEntityId: Map<string, string>;
}> {
  const assignments = (await RoleAssignment.find({
    role: { $in: LEAD_ROLES },
    archived: true,
    reviewNotes: DETACH_NOTE,
    'target.kind': 'RESEARCH_ENTITY',
  })
    .select('_id personId target')
    .lean()) as unknown as Array<Record<string, any>>;
  const objectIds = (ids: Array<string | undefined>) =>
    [...new Set(ids)]
      .filter((id): id is string => Boolean(id) && mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));

  const researchers = (await Researcher.find({
    _id: { $in: objectIds(assignments.map((doc) => serializedDocumentId(doc.personId))) },
  })
    .select('_id displayName')
    .lean()) as unknown as Array<Record<string, any>>;
  const displayNameByPersonId = new Map(
    researchers.map((row) => [serializedDocumentId(row._id), String(row.displayName || '')]),
  );

  const entities = (await ResearchEntity.find({
    _id: { $in: objectIds(assignments.map((doc) => serializedDocumentId(doc.target?.id))) },
    archived: { $ne: true },
  })
    .select('_id slug name displayName')
    .lean()) as unknown as Array<Record<string, any>>;
  const entityById = new Map(entities.map((entity) => [serializedDocumentId(entity._id), entity]));
  const duplicateTargetsByEntityId = await loadArchivedDuplicateLeadTargets(
    entities.map((entity) => entity._id),
  );

  const detachments: PastSurnameClashDetachment[] = [];
  const slugByEntityId = new Map<string, string>();
  for (const doc of assignments) {
    const assignmentId = serializedDocumentId(doc._id);
    const personId = serializedDocumentId(doc.personId);
    const entityId = serializedDocumentId(doc.target?.id);
    const entity = entityById.get(entityId);
    const displayName = displayNameByPersonId.get(personId);
    if (!assignmentId || !personId || !entityId || !entity || !displayName) continue;
    detachments.push({
      assignmentId,
      entityId,
      personId,
      displayName,
      identityTokens: researchEntityIdentityTokens({
        name: entity.name,
        displayName: entity.displayName,
        slug: entity.slug,
      }),
      entityLeadDuplicateResolvesToPerson:
        duplicateTargetsByEntityId.get(entityId)?.has(personId) === true,
    });
    slugByEntityId.set(entityId, String(entity.slug || ''));
  }
  return { detachments, slugByEntityId };
}

export async function retireSurnameClashLeadGrafts(options: {
  dryRun: boolean;
}): Promise<Record<string, unknown>> {
  const identities = await loadPersonIdentities();
  const { rows, slugByEntityId } = await loadClashEntities(identities);
  const plan = planSurnameClashLeadDetachment(rows);
  const entityIds = [...new Set(plan.detach.map((row) => row.entityId))];

  let detached = 0;
  let regatedEntities = 0;
  if (!options.dryRun && plan.detach.length > 0) {
    const result = await RoleAssignment.updateMany(
      {
        _id: {
          $in: plan.detach
            .map((row) => row.assignmentId)
            .filter((id) => mongoose.isValidObjectId(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        },
        archived: { $ne: true },
      },
      { $set: { archived: true, reviewStatus: 'DISPUTED', reviewNotes: DETACH_NOTE } },
    );
    detached = result.modifiedCount || 0;

    // Re-gate through the ordinary gate rather than writing tiers here, so every
    // other blocker on those rows still applies and the queue stays consistent.
    if (entityIds.length > 0) {
      await runStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: entityIds,
      });
      regatedEntities = entityIds.length;
    }
  }

  const past = await loadPastDetachments();
  const pastDetachmentsNowNamed = pastDetachmentsOfTheNamedPerson(past.detachments);

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    surnameClashEntitiesScanned: rows.length,
    plannedDetachments: plan.detach.length,
    entitiesAffected: entityIds.length,
    entitySlugsAffected: entityIds.map((id) => slugByEntityId.get(id) || id).sort(),
    refusedByReason: summarizeSurnameClashRefusals(plan.refused),
    detached,
    regatedEntities,
    pastDetachmentsScanned: past.detachments.length,
    pastDetachmentsOfTheNamedPerson: pastDetachmentsNowNamed.length,
    pastDetachmentEntitySlugsOfTheNamedPerson: [
      ...new Set(
        pastDetachmentsNowNamed.map((row) => past.slugByEntityId.get(row.entityId) || row.entityId),
      ),
    ].sort(),
  };
  return report;
}

async function main(): Promise<void> {
  const options = parseRetireSurnameClashArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }

  await initializeConnections();
  const report = await retireSurnameClashLeadGrafts({ dryRun: options.dryRun });
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
