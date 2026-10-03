import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { Signal } from '../models/signal';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import {
  GRANT_ONLY_ROW_ARCHIVE_REASON,
  GRANT_SHELL_FACULTY_PORT_ARCHIVE_REASON,
  archivedEntityUpdate,
} from '../models/entityArchival';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { deleteFromIndex, syncEntities } from '../services/meiliSyncService';
import { Observation } from '../models/observation';
import {
  isGrantOrOrcidSourceUrl,
  isUncorroboratedGrantOnlyEntity,
} from '../services/studentVisibilityTier';
import {
  getResearchGroupDetail,
  resolveArchivedResearchEntityCanonicalSlug,
} from '../services/researchGroupService';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { isLowTrustAreaShellSlug } from '../utils/researchEntityShellSlug';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { applyResearchEntityDedupeMergeGroup } from './dedupeResearchEntitiesByPi';
import { GRANT_CORPUS_SYNTHESIS_SOURCE_NAME, GRANT_SOURCE_NAMES } from './grantCorpusSynthesisCore';
import {
  GRANT_SHELL_PORT_SLUG_RE,
  isGrantShellSlug,
  GRANT_ENRICHABLE_ENTITY_TYPES,
  planGrantOnlyArchival,
  planGrantShellPort,
  portableGrantShellFields,
  summarizeGrantShellPort,
  unionRecentGrants,
  unionStringField,
  type GrantShellPortInput,
  type GrantShellPortOutcome,
  type GrantShellPortPlan,
  type GrantShellPortRow,
} from './portGrantShellsToFacultyProfilesCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'research-entity:port-grant-shells-to-faculty-profiles';
export const CONFIRM_FLAG = '--confirm-port-grant-shells-to-faculty-profiles';
export const SCRAPER_SWEEP_PORT_GRANT_SHELLS_ENV = 'SCRAPER_SWEEP_PORT_GRANT_SHELLS';
export const DEFAULT_GRANT_SHELL_PORT_MAX = 500;
const TOMBSTONE_HOP_LIMIT = 10;
const PER_RESOLVE_CHURN_FIELDS = new Set(['updatedAt', 'lastObservedAt', 'confidenceByField']);

interface Options {
  dryRun: boolean;
  confirmed: boolean;
  maxPorts: number;
  maxArchives?: number;
  output?: string;
}

export interface GrantShellPortDelta {
  liveGrantShells: number;
  plannedPorts: number;
  plannedShells: number;
  plansBySurvivorKind: ReturnType<typeof summarizeGrantShellPort>['plansBySurvivorKind'];
  shellsBySurvivorKind: ReturnType<typeof summarizeGrantShellPort>['shellsBySurvivorKind'];
  refusedByReason: ReturnType<typeof summarizeGrantShellPort>['refusedByReason'];
  deferredByCap: number;
  appliedPorts: number;
  shellsArchived: number;
  deferredAsWouldDemote: number;
  secondPassChangedFields: Record<string, number>;
  shellsServedBefore: number;
  survivorsServedAfter: number;
  redirectsResolvingToSurvivor: number;
  redirectsNotResolving: number;
  liveLeadEdgesLeftOnShells: number;
  liveSignalsLeftOnShells: number;
  survivorsResynced: number;
  survivorsAwaitingResync: number;
  grantOnlyPlannedArchives: number;
  grantOnlyKeptForOperatorIntent: number;
  grantOnlyArchived: number;
  grantOnlyServedBefore: number;
  grantOnlyStillArchivedAfterTwoPasses: number;
  grantOnlyIndexDeleteFailures: number;
  grantOnlyEnrichedIntoExistingRow: number;
  grantOnlyEnrichmentDeferred: number;
  grantOnlyDeferredByCap: number;
}

type GrantOnlyArchivalDelta = Pick<
  GrantShellPortDelta,
  | 'grantOnlyPlannedArchives'
  | 'grantOnlyKeptForOperatorIntent'
  | 'grantOnlyArchived'
  | 'grantOnlyServedBefore'
  | 'grantOnlyStillArchivedAfterTwoPasses'
  | 'grantOnlyIndexDeleteFailures'
  | 'grantOnlyEnrichedIntoExistingRow'
  | 'grantOnlyEnrichmentDeferred'
  | 'grantOnlyDeferredByCap'
>;

export const GRANT_OR_ORCID_LANE_SOURCE_NAMES: ReadonlySet<string> = new Set([
  ...GRANT_SOURCE_NAMES,
  GRANT_CORPUS_SYNTHESIS_SOURCE_NAME,
]);

/**
 * Whether one observation is evidence from somewhere other than a grant or ORCID record.
 * A grant lane's observation never is, whatever it cites. Any other lane's observation is,
 * unless it cites a grant or ORCID record: one recorded without a URL came from a page the
 * archive cannot see, and an unseen page is not proof that the row is grant-only (#4247).
 */
export function observationCorroboratesBeyondGrants(observation: {
  sourceName?: unknown;
  sourceUrl?: unknown;
}): boolean {
  if (GRANT_OR_ORCID_LANE_SOURCE_NAMES.has(idText(observation.sourceName))) return false;
  const sourceUrl = idText(observation.sourceUrl).trim();
  if (!/^https?:\/\//i.test(sourceUrl)) return true;
  return !isGrantOrOrcidSourceUrl(sourceUrl);
}

/**
 * The gate's grant-only test reads the row's cited URLs, but a lane can read an official
 * profile page without citing it: on Development 10 of 44 rows that cited only grant
 * records had observations fetched from a Yale profile page. So a row is grant-only here
 * only when every observation on it, and on every row tombstoned into it, came from a
 * grant or ORCID record too.
 */
async function hasNonGrantObservationEvidence(doc: Record<string, any>): Promise<boolean> {
  const tombstoned = (await ResearchEntity.find({ canonicalGroupId: doc._id })
    .select('_id slug')
    .lean()) as unknown as Array<Record<string, any>>;
  const keys = [doc.slug, ...tombstoned.map((row) => row.slug)].map(idText).filter(Boolean);
  const ids = [doc._id, ...tombstoned.map((row) => row._id)];
  const observations = (await Observation.find({
    entityType: 'researchEntity',
    superseded: { $ne: true },
    $or: [{ entityKey: { $in: keys } }, { entityId: { $in: ids } }],
  })
    .select('sourceName sourceUrl')
    .lean()) as Array<{ sourceName?: unknown; sourceUrl?: unknown }>;
  return observations.some(observationCorroboratesBeyondGrants);
}

/**
 * The live research page a grant-only row's grants should enrich instead: the one live
 * lab or faculty research profile its lead also leads, excluding another row this pass is
 * itself acting on. Several such rows is not a choice this pass may make, so it returns
 * none and the row is left alone rather than archived.
 */
/**
 * Merges one grant row into the research page its lead already has, through the same
 * never-demote merge path the port uses, so the page cannot lose visibility by gaining
 * grants. Topics are carried only onto another low-trust shell, never onto a real lab,
 * which is the #604 anti-graft rule.
 */
async function mergeGrantRowInto(
  target: Record<string, any>,
  grantRow: Record<string, any>,
): Promise<boolean> {
  const rows = [target, grantRow];
  const mergedRecentGrants = unionRecentGrants(rows);
  const result = await applyResearchEntityDedupeMergeGroup(
    {
      canonicalEntityId: idText(target._id),
      duplicateEntityIds: [idText(grantRow._id)],
      mergedDepartments: unionStringField(rows, 'departments'),
      mergedResearchAreas: isLowTrustAreaShellSlug(idText(target.slug))
        ? unionStringField(rows, 'researchAreas')
        : [],
      mergedSourceUrls: unionStringField(rows, 'sourceUrls'),
      mergedRecentGrants,
      mergedRecentGrantCount: mergedRecentGrants.length,
      mergedFundingAgencies: unionStringField(rows, 'fundingAgencies'),
    },
    {
      deleteDuplicates: false,
      relinkReferences: true,
      rematerializeCanonical: true,
      neverDemote: true,
      pinnedCanonical: true,
    },
  );
  const deferred =
    Boolean((result as { deferredAsWouldDemote?: boolean }).deferredAsWouldDemote) ||
    Boolean(
      (result as { deferredAsWouldSwapPinnedCanonical?: boolean })
        .deferredAsWouldSwapPinnedCanonical,
    );
  return !deferred;
}

async function enrichmentTargetIdForRow(
  doc: Record<string, any>,
  actingOnIds: ReadonlySet<string>,
): Promise<string | undefined> {
  const leadPersonIds = [
    ...new Set(
      (await currentLeadEdges({ 'target.id': doc._id })).map((edge) => idText(edge.personId)),
    ),
  ].filter(Boolean);
  if (leadPersonIds.length !== 1) return undefined;
  const otherEntityIds = [
    ...new Set(
      (await currentLeadEdges({ personId: leadPersonIds[0] })).map((edge) =>
        idText(edge.target?.id),
      ),
    ),
  ].filter((id) => id && !actingOnIds.has(id));
  if (otherEntityIds.length === 0) return undefined;
  const rows = (await ResearchEntity.find({
    _id: { $in: otherEntityIds },
    archived: { $ne: true },
    entityType: { $in: [...GRANT_ENRICHABLE_ENTITY_TYPES] },
  })
    .select('_id slug')
    .lean()) as unknown as Array<Record<string, any>>;
  const enrichable = rows.filter((row) => !isGrantShellSlug(idText(row.slug)));
  return enrichable.length === 1 ? idText(enrichable[0]._id) : undefined;
}

async function grantOnlyRowIds(docs: Array<Record<string, any>>): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const doc of docs) {
    if (isUncorroboratedGrantOnlyEntity(doc) && !(await hasNonGrantObservationEvidence(doc))) {
      ids.add(idText(doc._id));
    }
  }
  return ids;
}

async function archiveGrantOnlyRows(
  dryRun: boolean,
  maxActions: number,
): Promise<GrantOnlyArchivalDelta> {
  const survivorIds = await ResearchEntity.distinct('canonicalGroupId', {
    archived: true,
    archivedReason: GRANT_SHELL_FACULTY_PORT_ARCHIVE_REASON,
  });
  const candidates = (await ResearchEntity.find({
    archived: { $ne: true },
    $or: [{ slug: GRANT_SHELL_PORT_SLUG_RE }, { _id: { $in: survivorIds.filter(Boolean) } }],
  })
    .select(
      '_id slug entityType websiteUrl website sourceUrls manuallyLockedFields studentVisibilityOverrideTier studentVisibilityTier',
    )
    .lean()) as unknown as Array<Record<string, any>>;
  const grantOnlyIds = await grantOnlyRowIds(candidates);
  const candidateIdSet = new Set(candidates.map((doc) => idText(doc._id)));
  const plan = planGrantOnlyArchival(
    await Promise.all(
      candidates.map(async (doc) => ({
        id: idText(doc._id),
        entityType: idText(doc.entityType),
        grantOnly: grantOnlyIds.has(idText(doc._id)),
        enrichmentTargetId: await enrichmentTargetIdForRow(doc, candidateIdSet),
        manuallyLockedFields: doc.manuallyLockedFields,
        studentVisibilityOverrideTier: doc.studentVisibilityOverrideTier,
      })),
    ),
  );
  const archiveIds = new Set(plan.archiveIds);
  const plannedArchives = candidates.filter((doc) => archiveIds.has(idText(doc._id)));
  const enrichmentsToApply = plan.enrichIntoExistingRow.slice(0, maxActions);
  const toArchive = plannedArchives.slice(0, maxActions - enrichmentsToApply.length);
  const delta: GrantOnlyArchivalDelta = {
    grantOnlyPlannedArchives: plannedArchives.length,
    grantOnlyKeptForOperatorIntent: plan.keptForOperatorIntentIds.length,
    grantOnlyArchived: 0,
    grantOnlyServedBefore: toArchive.filter(
      (doc) => idText(doc.studentVisibilityTier) === 'student_ready',
    ).length,
    grantOnlyStillArchivedAfterTwoPasses: 0,
    grantOnlyIndexDeleteFailures: 0,
    grantOnlyEnrichedIntoExistingRow: 0,
    grantOnlyEnrichmentDeferred: 0,
    grantOnlyDeferredByCap:
      plan.enrichIntoExistingRow.length +
      plannedArchives.length -
      enrichmentsToApply.length -
      toArchive.length,
  };
  if (dryRun) {
    delta.grantOnlyEnrichedIntoExistingRow = enrichmentsToApply.length;
    return delta;
  }

  // Enrich first: a grant-only row whose lead already has a research page is merged into
  // it, so its grants land there instead of being archived out of reach (#3992).
  for (const { id, enrichmentTargetId } of enrichmentsToApply) {
    const row = candidates.find((doc) => idText(doc._id) === id);
    const target = await ResearchEntity.findById(enrichmentTargetId).lean();
    if (!row || !target) continue;
    const merged = await mergeGrantRowInto(target as Record<string, any>, row);
    if (merged) delta.grantOnlyEnrichedIntoExistingRow += 1;
    else delta.grantOnlyEnrichmentDeferred += 1;
  }
  if (toArchive.length === 0) return delta;

  for (const doc of toArchive) {
    const result = await ResearchEntity.updateOne(
      { _id: doc._id, archived: { $ne: true } },
      archivedEntityUpdate(GRANT_ONLY_ROW_ARCHIVE_REASON),
    );
    delta.grantOnlyArchived += result.modifiedCount ?? 0;
    const removedFromIndex = await deleteFromIndex('researchEntity', idText(doc._id));
    if (!removedFromIndex) delta.grantOnlyIndexDeleteFailures += 1;
  }
  for (let pass = 0; pass < 2; pass += 1) {
    for (const doc of toArchive) {
      await materializeEntity('researchEntity', { entityKey: idText(doc.slug) }, {});
    }
  }
  delta.grantOnlyStillArchivedAfterTwoPasses = await ResearchEntity.countDocuments({
    _id: { $in: toArchive.map((doc) => doc._id) },
    archived: true,
    archivedReason: GRANT_ONLY_ROW_ARCHIVE_REASON,
  });
  return delta;
}

export function parsePortGrantShellArgs(argv: string[]): Options {
  const options: Options = {
    dryRun: true,
    confirmed: false,
    maxPorts: DEFAULT_GRANT_SHELL_PORT_MAX,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--max-ports' || arg.startsWith('--max-ports=')) {
      const raw = arg === '--max-ports' ? argv[(i += 1)] : arg.slice('--max-ports='.length);
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${SCRIPT_NAME} --max-ports must be a non-negative integer`);
      }
      options.maxPorts = value;
    } else if (arg === '--max-archives' || arg.startsWith('--max-archives=')) {
      const raw = arg === '--max-archives' ? argv[(i += 1)] : arg.slice('--max-archives='.length);
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${SCRIPT_NAME} --max-archives must be a non-negative integer`);
      }
      options.maxArchives = value;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[(i += 1)]);
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

const idText = (value: unknown): string => (value == null ? '' : String(value));

function toPortRow(doc: Record<string, any>): GrantShellPortRow {
  return {
    id: idText(doc._id),
    slug: idText(doc.slug),
    entityType: idText(doc.entityType),
    studentVisibilityTier: idText(doc.studentVisibilityTier),
    archived: doc.archived === true,
  };
}

async function currentLeadEdges(filter: Record<string, unknown>) {
  return (await RoleAssignment.find({
    ...filter,
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: LEAD_ROLE_CANONICAL_VALUES as unknown as string[] },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('personId target')
    .lean()) as unknown as Array<{ personId?: unknown; target?: { id?: unknown } }>;
}

async function tombstoneTerminusId(row: GrantShellPortRow): Promise<string> {
  let current = await ResearchEntity.findById(row.id)
    .select('_id canonicalGroupId archived')
    .lean();
  for (let hop = 0; hop < TOMBSTONE_HOP_LIMIT && current; hop += 1) {
    const doc = current as Record<string, any>;
    if (doc.archived !== true) return idText(doc._id);
    if (!doc.canonicalGroupId) return '';
    current = await ResearchEntity.findById(doc.canonicalGroupId)
      .select('_id canonicalGroupId archived')
      .lean();
  }
  return '';
}

async function loadPortInput(shellDocs: Array<Record<string, any>>): Promise<GrantShellPortInput> {
  const shells = shellDocs.map(toPortRow);
  const shellIds = shellDocs.map((doc) => doc._id);
  const shellIdSet = new Set(shells.map((shell) => shell.id));

  const leadPersonIdsByEntityId = new Map<string, string[]>();
  for (const edge of await currentLeadEdges({ 'target.id': { $in: shellIds } })) {
    const entityId = idText(edge.target?.id);
    const personId = idText(edge.personId);
    if (!entityId || !personId) continue;
    leadPersonIdsByEntityId.set(entityId, [
      ...(leadPersonIdsByEntityId.get(entityId) ?? []),
      personId,
    ]);
  }
  const personIds = [...new Set([...leadPersonIdsByEntityId.values()].flat())];

  const researchers = (await Researcher.find({ _id: { $in: personIds } })
    .select('displayName')
    .lean()) as unknown as Array<{ _id: unknown; displayName?: string }>;
  const personNameById = new Map(
    researchers.map((row) => [idText(row._id), row.displayName ?? '']),
  );

  const personEdges = await currentLeadEdges({ personId: { $in: personIds } });
  const otherEntityIds = [
    ...new Set(
      personEdges.map((edge) => idText(edge.target?.id)).filter((id) => !shellIdSet.has(id)),
    ),
  ];
  const enrichableDocs = (await ResearchEntity.find({
    _id: { $in: otherEntityIds },
    archived: { $ne: true },
    entityType: { $in: [...GRANT_ENRICHABLE_ENTITY_TYPES] },
  })
    .select('_id slug entityType studentVisibilityTier archived')
    .lean()) as unknown as Array<Record<string, any>>;
  const enrichableRowById = new Map(
    enrichableDocs
      .filter((doc) => !isGrantShellSlug(idText(doc.slug)))
      .map((doc) => [idText(doc._id), toPortRow(doc)]),
  );
  const liveEnrichableRowsByPersonId = new Map<string, GrantShellPortRow[]>();
  for (const edge of personEdges) {
    const row = enrichableRowById.get(idText(edge.target?.id));
    const personId = idText(edge.personId);
    if (!row || !personId) continue;
    const rows = liveEnrichableRowsByPersonId.get(personId) ?? [];
    if (!rows.some((existing) => existing.id === row.id)) rows.push(row);
    liveEnrichableRowsByPersonId.set(personId, rows);
  }

  const baseInput: GrantShellPortInput = {
    shells,
    leadPersonIdsByEntityId,
    personNameById,
    liveEnrichableRowsByPersonId,
    rowsHoldingSlug: new Map(),
    tombstoneTerminusIdByArchivedRowId: new Map(),
  };
  const candidateSlugs = planGrantShellPort(baseInput).plans.map((plan) => plan.survivorSlug);
  const holderDocs = (await ResearchEntity.find({ slug: { $in: candidateSlugs } })
    .select('_id slug entityType studentVisibilityTier archived')
    .lean()) as unknown as Array<Record<string, any>>;
  const holders = holderDocs.map(toPortRow);
  const tombstoneTerminusIdByArchivedRowId = new Map<string, string>();
  for (const holder of holders.filter((row) => row.archived)) {
    tombstoneTerminusIdByArchivedRowId.set(holder.id, await tombstoneTerminusId(holder));
  }
  return {
    ...baseInput,
    rowsHoldingSlug: new Map(holders.map((row) => [row.slug, row])),
    tombstoneTerminusIdByArchivedRowId,
  };
}

async function prepareSurvivor(
  plan: GrantShellPortPlan,
  shellDocById: Map<string, Record<string, any>>,
): Promise<{ survivorId: string; rollback: () => Promise<void> }> {
  const collection = ResearchEntity.collection;
  const now = new Date();
  if (plan.kind === 'existing-faculty-row') {
    return { survivorId: plan.survivorId, rollback: async () => undefined };
  }
  if (plan.kind === 'created-faculty-row') {
    const template = shellDocById.get(plan.templateShellId) ?? {};
    const survivorId = new mongoose.Types.ObjectId();
    await collection.insertOne({
      ...portableGrantShellFields(template),
      _id: survivorId,
      slug: plan.survivorSlug,
      archived: false,
      canonicalGroupId: null,
      createdAt: now,
      updatedAt: now,
    });
    return {
      survivorId: String(survivorId),
      rollback: async () => {
        await collection.deleteOne({ _id: survivorId });
      },
    };
  }
  const revivedId = new mongoose.Types.ObjectId(plan.survivorId);
  const before = await collection.findOne({ _id: revivedId });
  const template = shellDocById.get(plan.shellIds[0]) ?? {};
  await collection.updateOne(
    { _id: revivedId, archived: true },
    {
      $set: {
        ...portableGrantShellFields(template),
        archived: false,
        canonicalGroupId: null,
        updatedAt: now,
      },
      $unset: { archivedReason: '', archivedAt: '' },
    },
  );
  return {
    survivorId: plan.survivorId,
    rollback: async () => {
      if (before) await collection.replaceOne({ _id: revivedId }, before);
    },
  };
}

async function applyPort(
  plan: GrantShellPortPlan,
  shellDocById: Map<string, Record<string, any>>,
): Promise<{ applied: boolean; survivorId: string }> {
  const { survivorId, rollback } = await prepareSurvivor(plan, shellDocById);
  const survivorDoc = ((await ResearchEntity.findById(survivorId).lean()) ?? {}) as Record<
    string,
    any
  >;
  const shellDocs = plan.shellIds.map((id) => shellDocById.get(id) ?? {});
  const rows = [survivorDoc, ...shellDocs];
  const mergedRecentGrants = unionRecentGrants(rows);
  const result = await applyResearchEntityDedupeMergeGroup(
    {
      canonicalEntityId: survivorId,
      duplicateEntityIds: plan.shellIds,
      mergedDepartments: unionStringField(rows, 'departments'),
      mergedResearchAreas: isLowTrustAreaShellSlug(plan.survivorSlug)
        ? unionStringField(rows, 'researchAreas')
        : [],
      mergedSourceUrls: unionStringField(rows, 'sourceUrls'),
      mergedRecentGrants,
      mergedRecentGrantCount: mergedRecentGrants.length,
      mergedFundingAgencies: unionStringField(rows, 'fundingAgencies'),
    },
    {
      deleteDuplicates: false,
      relinkReferences: true,
      rematerializeCanonical: true,
      neverDemote: true,
      pinnedCanonical: true,
    },
  );
  const deferred =
    Boolean((result as { deferredAsWouldDemote?: boolean }).deferredAsWouldDemote) ||
    Boolean(
      (result as { deferredAsWouldSwapPinnedCanonical?: boolean })
        .deferredAsWouldSwapPinnedCanonical,
    );
  if (deferred) {
    await rollback();
    return { applied: false, survivorId };
  }
  await ResearchEntity.updateMany(
    { _id: { $in: plan.shellIds }, archived: true },
    { $set: { archivedReason: GRANT_SHELL_FACULTY_PORT_ARCHIVE_REASON } },
  );
  return { applied: true, survivorId };
}

function withoutSubdocumentIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSubdocumentIds);
  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !mongoose.isValidObjectId(value)
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== '_id')
        .map(([key, nested]) => [key, withoutSubdocumentIds(nested)]),
    );
  }
  return value;
}

/**
 * Every resolve re-mints `recentGrants` subdocument ids, bumps `lastObservedAt`, and
 * re-decays `confidenceByField` by the elapsed time, on grant rows whether or not they
 * were ported, so a durability check that counted written fields would read that churn
 * as instability.
 */
export function changedValueFields(before: unknown, after: unknown): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (field) =>
      !PER_RESOLVE_CHURN_FIELDS.has(field) &&
      JSON.stringify(withoutSubdocumentIds(a[field])) !==
        JSON.stringify(withoutSubdocumentIds(b[field])),
  );
}

async function servesDetail(slug: string): Promise<boolean> {
  try {
    return Boolean(await getResearchGroupDetail(slug));
  } catch {
    return false;
  }
}

export async function runGrantShellPort(options: Options): Promise<{
  delta: GrantShellPortDelta;
  outcome: GrantShellPortOutcome;
}> {
  const grantOnlyDelta = await archiveGrantOnlyRows(
    options.dryRun,
    options.maxArchives ?? options.maxPorts,
  );
  const shellDocs = (await ResearchEntity.find({
    slug: GRANT_SHELL_PORT_SLUG_RE,
    archived: { $ne: true },
  }).lean()) as unknown as Array<Record<string, any>>;
  const shellDocById = new Map(shellDocs.map((doc) => [idText(doc._id), doc]));
  const grantOnlyShellIds = await grantOnlyRowIds(shellDocs);
  const portInput = await loadPortInput(shellDocs);
  const outcome = planGrantShellPort({
    ...portInput,
    shells: portInput.shells.map((shell) => ({
      ...shell,
      grantOnly: grantOnlyShellIds.has(shell.id),
    })),
  });
  const summary = summarizeGrantShellPort(outcome);
  const plansToApply = outcome.plans.slice(0, options.maxPorts);

  const delta: GrantShellPortDelta = {
    liveGrantShells: shellDocs.length,
    plannedPorts: outcome.plans.length,
    plannedShells: outcome.plans.reduce((total, plan) => total + plan.shellIds.length, 0),
    ...summary,
    deferredByCap: outcome.plans.length - plansToApply.length,
    appliedPorts: 0,
    shellsArchived: 0,
    deferredAsWouldDemote: 0,
    secondPassChangedFields: {},
    shellsServedBefore: 0,
    survivorsServedAfter: 0,
    redirectsResolvingToSurvivor: 0,
    redirectsNotResolving: 0,
    liveLeadEdgesLeftOnShells: 0,
    liveSignalsLeftOnShells: 0,
    survivorsResynced: 0,
    survivorsAwaitingResync: 0,
    ...grantOnlyDelta,
  };
  if (options.dryRun) return { delta, outcome };

  const applied: Array<{ plan: GrantShellPortPlan; survivorId: string }> = [];
  for (const plan of plansToApply) {
    delta.shellsServedBefore += plan.shellIds.filter(
      (id) => idText(shellDocById.get(id)?.studentVisibilityTier) === 'student_ready',
    ).length;
    const result = await applyPort(plan, shellDocById);
    if (!result.applied) {
      delta.deferredAsWouldDemote += 1;
      continue;
    }
    applied.push({ plan, survivorId: result.survivorId });
    delta.appliedPorts += 1;
    delta.shellsArchived += plan.shellIds.length;
  }

  for (const { plan } of applied) {
    await materializeEntity('researchEntity', { entityKey: plan.survivorSlug }, {});
  }
  for (const { plan, survivorId } of applied) {
    const afterFirstPass = await ResearchEntity.findById(survivorId).lean();
    await materializeEntity('researchEntity', { entityKey: plan.survivorSlug }, {});
    const afterSecondPass = await ResearchEntity.findById(survivorId).lean();
    for (const field of changedValueFields(afterFirstPass, afterSecondPass)) {
      delta.secondPassChangedFields[field] = (delta.secondPassChangedFields[field] ?? 0) + 1;
    }
  }

  const survivorIds = applied.map(({ survivorId }) => survivorId);
  if (survivorIds.length > 0) {
    await applyStudentVisibilityGatePlans(
      await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: survivorIds,
      }),
    );
    const survivors = await ResearchEntity.find({
      _id: { $in: survivorIds },
      archived: { $ne: true },
    }).lean();
    delta.survivorsResynced = await syncEntities('researchEntity', survivors as never[]);
    delta.survivorsAwaitingResync = survivors.length - delta.survivorsResynced;
  }

  const portedShellIds = applied.flatMap(({ plan }) => plan.shellIds);
  for (const { plan } of applied) {
    if (await servesDetail(plan.survivorSlug)) delta.survivorsServedAfter += 1;
    for (const shellId of plan.shellIds) {
      const shellSlug = idText(shellDocById.get(shellId)?.slug);
      const redirect = await resolveArchivedResearchEntityCanonicalSlug(shellSlug);
      if (redirect === plan.survivorSlug) delta.redirectsResolvingToSurvivor += 1;
      else delta.redirectsNotResolving += 1;
    }
  }
  const portedObjectIds = portedShellIds.map((id) => new mongoose.Types.ObjectId(id));
  delta.liveLeadEdgesLeftOnShells = (
    await currentLeadEdges({ 'target.id': { $in: portedObjectIds } })
  ).length;
  delta.liveSignalsLeftOnShells = await Signal.countDocuments({
    researchEntityId: { $in: portedObjectIds },
    archived: { $ne: true },
  });
  return { delta, outcome };
}

async function main(): Promise<void> {
  const options = parsePortGrantShellArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  }
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.dryRun ? 'dry-run' : 'apply'
    }`,
  );
  await initializeConnections();
  const { delta, outcome } = await runGrantShellPort(options);
  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    portDelta: delta,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify({ ...report, outcome }, null, 2)}\n`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
