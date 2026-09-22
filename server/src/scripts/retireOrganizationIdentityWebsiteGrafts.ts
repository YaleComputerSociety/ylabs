/**
 * Stops a person-scoped row serving an organization's own identity page as its
 * research website, once that organization exists in the corpus as its own entity.
 *
 * Yale's profile content models expose one "website" slot, and a faculty directory
 * fills it with whatever the person's profile links - including the center or
 * institute they lead or belong to. The result is a real Yale organization that no
 * student can reach as an entity, represented only as a URL grafted onto two or
 * three individuals (#2535). #2529 deliberately left these rows alone, because
 * clearing the link before the organization exists drops the corpus's only edge to
 * it (#2385).
 *
 * So the order matters and the lane depends on it: mint the organization first, then
 * run this. Ownership is decided on the resolved page rather than the URL string,
 * because a vanity host redirects to a canonical path and the two never string-match
 * - which is also why the duplicate-URL visibility reason never fired on any of them.
 *
 * Clearing the slot is not durable on its own. The borrowed page stays in the row's
 * `website` field and `sourceUrls`, and `resolveBackfillWebsiteUrl` promotes the first
 * promotable candidate from exactly those into an empty slot, so the next
 * materialization restores the graft. `isPromotableWebsiteUrl` has no arm that can
 * refuse this, because whether a page is an organization's identity page is a fact
 * about the corpus rather than about the URL's shape, and every guard there is a pure
 * URL predicate. So the clear is paired with an `engine_gap_workaround` lock on
 * `websiteUrl`, the same mechanism `repairVanityHostCitations` and
 * `repairPromotionRegressedWebsiteUrls` use for the same engine gap (#2542, #2612):
 * the lock asserts the absence, and it is revisitable the moment the engine can
 * retract a field it no longer has evidence for. The locked slot is also why a second
 * run plans nothing.
 *
 * Dry-run is the default and apply needs an explicit confirm flag. Clearing a
 * borrowed URL is not a neutral subtraction: the collision can be the only thing
 * holding another row out of student view, so every row citing a retired URL is
 * re-gated alongside the borrower and the cleared rows' own tiers are re-read.
 *
 * Run:
 *   yarn --cwd server observations:retire-organization-identity-websites
 *   yarn --cwd server observations:retire-organization-identity-websites --apply \
 *     --confirm-retire-organization-identity-websites
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import {
  applyStudentVisibilityGatePlans,
  isStudentVisibilityGatePlanMateriallyChanged,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { syncEntity } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { serializedDocumentId } from '../utils/idSerialization';
import { planFieldLock } from '../utils/researchEntityFieldLocks';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  canonicalWebsitePageKey,
  isOrganizationIdentityWebsiteObservation,
  organizationsByIdentityToken,
  ORGANIZATION_IDENTITY_WEBSITE_OBSERVATION_FIELDS,
  planOrganizationIdentityWebsiteGraft,
  urlsToResolve,
  type OrganizationIdentityWebsite,
  type OrganizationIdentityWebsiteGraftPlan,
} from './retireOrganizationIdentityWebsiteGraftsCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:retire-organization-identity-websites';
const ROLLBACK_REASON =
  "organization identity page as a person website: the organization is its own research entity, so the page is that entity's identity rather than this person's research home (#2535)";
const ORGANIZATION_ENTITY_TYPES = ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY'];
const WEBSITE_URL_LOCK_NOTE =
  "the organization's identity page stays in this row's `website` field and `sourceUrls`, and `resolveBackfillWebsiteUrl` promotes the first promotable candidate back into an empty slot, so an unlocked clear is undone on the next materialization; revisit once the engine can retract a field it no longer has evidence for (#2542).";
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface RetireOrganizationIdentityWebsitesArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  only: string[];
  output?: string;
}

export function parseArgs(argv: string[]): RetireOrganizationIdentityWebsitesArgs {
  const args: RetireOrganizationIdentityWebsitesArgs = {
    apply: false,
    confirm: false,
    maxApply: 40,
    only: [],
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-retire-organization-identity-websites') args.confirm = true;
    else if (arg.startsWith('--max-apply='))
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--only=')) args.only = parseSlugList(arg.slice('--only='.length));
    else if (arg === '--only') args.only = parseSlugList(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return args;
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return parsed;
}

function parseSlugList(value: string | undefined): string[] {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

interface PlannedRow {
  entityId: string;
  slug: string;
  entityType?: string;
  kind?: string;
  studentVisibilityTier?: string;
  manuallyLockedFields: string[];
  plan: OrganizationIdentityWebsiteGraftPlan;
}

async function resolveFinalUrls(urls: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  // Serial, with a browser user agent: a parallel probe of medicine.yale.edu gets
  // 403-throttled and a throttled page reads as a different page, which would make
  // the ownership comparison fail on exactly the rows the lane exists to repair.
  for (const url of urls) {
    try {
      const page = await fetchPageWithPolicy(url, {
        headers: { 'User-Agent': BROWSER_USER_AGENT },
        timeoutMs: 20_000,
      });
      resolved.set(url, page.url);
    } catch (error) {
      console.warn(
        `[${SCRIPT_NAME}] could not resolve ${sanitizeLogValue(url)}: ${sanitizeLogValue(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    }
  }
  return resolved;
}

export async function loadOrganizationIdentityWebsites(): Promise<OrganizationIdentityWebsite[]> {
  const organizations = await ResearchEntity.find({
    entityType: { $in: ORGANIZATION_ENTITY_TYPES },
    archived: { $ne: true },
    websiteUrl: { $nin: ['', null] },
  })
    .select('slug name entityType websiteUrl')
    .lean();
  return (organizations as any[])
    .filter((organization) => organization.slug && organization.websiteUrl)
    .map((organization) => ({
      slug: String(organization.slug),
      name: organization.name ? String(organization.name) : undefined,
      entityType: String(organization.entityType),
      websiteUrl: String(organization.websiteUrl),
    }));
}

export async function loadPlannedRows(only: string[]): Promise<PlannedRow[]> {
  const organizationsByToken = organizationsByIdentityToken(
    await loadOrganizationIdentityWebsites(),
  );
  const filter: Record<string, unknown> = {
    archived: { $ne: true },
    websiteUrl: { $nin: ['', null] },
  };
  if (only.length > 0) filter.slug = { $in: only };
  const rows = await ResearchEntity.find(filter)
    .select('_id slug name entityType kind websiteUrl studentVisibilityTier manuallyLockedFields')
    .lean();

  const resolved = await resolveFinalUrls(urlsToResolve(rows as any[], organizationsByToken));
  const lookup = (url: string): string => resolved.get(url) || '';

  const planned: PlannedRow[] = [];
  for (const row of rows as any[]) {
    const plan = planOrganizationIdentityWebsiteGraft(row, organizationsByToken, lookup);
    if (!plan) continue;
    const entityId = serializedDocumentId(row._id);
    if (!entityId) continue;
    planned.push({
      entityId,
      slug: String(row.slug),
      entityType: row.entityType,
      kind: row.kind,
      studentVisibilityTier: row.studentVisibilityTier,
      manuallyLockedFields: Array.isArray(row.manuallyLockedFields)
        ? row.manuallyLockedFields.filter((entry: unknown) => typeof entry === 'string')
        : [],
      plan,
    });
  }
  return planned.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function loadPlannedObservationIds(planned: PlannedRow[]): Promise<string[]> {
  if (planned.length === 0) return [];
  const planBySlug = new Map(planned.map((row) => [row.slug, row.plan]));
  const observations = (await Observation.find({
    entityType: 'researchEntity',
    entityKey: { $in: [...planBySlug.keys()] },
    field: { $in: [...ORGANIZATION_IDENTITY_WEBSITE_OBSERVATION_FIELDS] },
    superseded: { $ne: true },
  })
    .select('_id field value entityKey')
    .lean()) as any[];

  // An assertion whose value is an alias of the organization page only compares equal
  // once probed, and the planning pass probed the rows' current values rather than
  // every stored assertion on them.
  const aliasCandidates = new Set<string>();
  for (const observation of observations) {
    const plan = planBySlug.get(observation.entityKey);
    if (!plan) continue;
    const value = typeof observation.value === 'string' ? observation.value.trim() : '';
    if (!value || value === plan.graftedWebsiteUrl) continue;
    const pageKey = canonicalWebsitePageKey(value);
    if (!pageKey || pageKey === plan.resolvedPageKey) continue;
    aliasCandidates.add(value);
  }
  const resolved = await resolveFinalUrls([...aliasCandidates]);
  const lookup = (url: string): string => resolved.get(url) || '';

  return observations
    .filter((observation) => {
      const plan = planBySlug.get(observation.entityKey);
      return (
        !!plan &&
        isOrganizationIdentityWebsiteObservation(observation.field, observation.value, plan, lookup)
      );
    })
    .map((observation) => serializedDocumentId(observation._id))
    .filter((id): id is string => Boolean(id));
}

/**
 * Every row citing one of the retired URLs, not just the rows being cleared. A
 * duplicate-URL collision can be the only thing holding the real owner out of
 * student view, and the cleared rows themselves can surface once the collision is
 * gone, so both sides are re-decided (#2385).
 */
export async function loadRegateEntityIds(
  plannedEntityIds: string[],
  retiredUrls: string[],
  ownerSlugs: string[],
): Promise<string[]> {
  const ids = new Set(plannedEntityIds);
  const citing = await ResearchEntity.find({
    archived: { $ne: true },
    $or: [
      { websiteUrl: { $in: retiredUrls } },
      { sourceUrls: { $in: retiredUrls } },
      { slug: { $in: ownerSlugs } },
    ],
  })
    .select('_id')
    .lean();
  for (const entity of citing as any[]) {
    const id = serializedDocumentId(entity._id);
    if (id) ids.add(id);
  }
  return [...ids];
}

async function applyRepair(
  planned: PlannedRow[],
  observationIds: string[],
  regateEntityIds: string[],
): Promise<{
  rowsRepaired: number;
  observationsSuperseded: number;
  regatedEntities: number;
}> {
  let rowsRepaired = 0;
  for (const row of planned) {
    const result = await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(row.entityId) },
      {
        $unset: { websiteUrl: '', 'fieldProvenance.websiteUrl': '' },
        $set: planFieldLock(row.manuallyLockedFields, {
          field: 'websiteUrl',
          reason: 'engine_gap_workaround',
          lockedBy: SCRIPT_NAME,
          note: WEBSITE_URL_LOCK_NOTE,
        }),
      },
    );
    if (result.modifiedCount > 0) rowsRepaired += 1;
  }

  let observationsSuperseded = 0;
  if (observationIds.length > 0) {
    const result = await Observation.updateMany(
      {
        _id: { $in: observationIds.map((id) => new mongoose.Types.ObjectId(id)) },
        superseded: { $ne: true },
      },
      {
        $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON } },
      },
    );
    observationsSuperseded = result.modifiedCount || 0;
  }

  let regatedEntities = 0;
  if (regateEntityIds.length > 0) {
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: regateEntityIds,
    });
    await applyStudentVisibilityGatePlans(gatePlans);
    regatedEntities = gatePlans.filter(isStudentVisibilityGatePlanMateriallyChanged).length;
    for (const entityId of regateEntityIds) {
      const fresh = await ResearchEntity.findById(entityId).lean();
      if (!fresh) continue;
      await syncEntity('researchEntity', fresh).catch((error) =>
        console.warn(
          `[${SCRIPT_NAME}] meili sync failed for ${sanitizeLogValue(entityId)}: ${sanitizeLogValue(
            error instanceof Error ? error.message : String(error),
          )}`,
        ),
      );
    }
  }

  return { rowsRepaired, observationsSuperseded, regatedEntities };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const planned = await loadPlannedRows(args.only);
  const observationIds = await loadPlannedObservationIds(planned);
  const retiredUrls = [...new Set(planned.map((row) => row.plan.graftedWebsiteUrl))];
  const ownerSlugs = [...new Set(planned.map((row) => row.plan.ownerSlug))];
  const regateEntityIds = await loadRegateEntityIds(
    planned.map((row) => row.entityId),
    retiredUrls,
    ownerSlugs,
  );

  if (args.apply) {
    if (!args.confirm) {
      throw new Error(
        '--confirm-retire-organization-identity-websites is required when --apply is set.',
      );
    }
    if (planned.length > args.maxApply) {
      throw new Error(
        `Apply would clear ${planned.length} website slots, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const applied = args.apply
    ? await applyRepair(planned, observationIds, regateEntityIds)
    : { rowsRepaired: 0, observationsSuperseded: 0, regatedEntities: 0 };

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    plannedRows: planned.length,
    plannedServedRows: planned.filter((row) => row.studentVisibilityTier === 'student_ready')
      .length,
    retiredUrls: retiredUrls.length,
    aliasUrls: planned.filter(
      (row) => canonicalWebsitePageKey(row.plan.graftedWebsiteUrl) !== row.plan.resolvedPageKey,
    ).length,
    ownerRows: ownerSlugs.length,
    plannedObservations: observationIds.length,
    regateCandidates: regateEntityIds.length,
    rowsRepaired: applied.rowsRepaired,
    observationsSuperseded: applied.observationsSuperseded,
    regatedEntities: applied.regatedEntities,
    byOwnerEntityType: planned.reduce<Record<string, number>>((acc, row) => {
      const key = row.plan.ownerEntityType || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    byVisibilityTier: planned.reduce<Record<string, number>>((acc, row) => {
      const key = row.studentVisibilityTier || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    rows: planned,
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({ ...report, rows: planned.slice(0, 25) }, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
