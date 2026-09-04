import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { Researcher } from '../models/researcher';
import {
  claimsAnotherPersonsLab,
  classifyHarvestedResearchHomeName,
  entityKeyPersonTokens,
  isPersonScopedResearchEntity,
  isUmbrellaOrganizationName,
  personSurnamesFromDisplayNames,
} from '../utils/researchHomeNameIdentityAuthority';
import { isPersonCmsProfileUrl } from '../utils/researchHomeWebsiteUrl';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:retire-affiliated-org-name-grafts';
const NAME_FIELDS = ['name', 'displayName'];
const PROFILE_LINK_SOURCE = 'ysm-faculty-directory';
const MICROSITE_SOURCE = 'lab-microsite-description-llm';
const ROLLBACK_REASON =
  'affiliated-organization or another person’s lab adopted as a person-scoped entity name from a profile lab-website link (#2234)';

export interface RetireAffiliatedOrgNameGraftsArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): RetireAffiliatedOrgNameGraftsArgs {
  const args: RetireAffiliatedOrgNameGraftsArgs = { apply: false, confirm: false, maxApply: 1500 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-retire-org-name-grafts') args.confirm = true;
    else if (arg.startsWith('--max-apply=')) {
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    } else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
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

export interface OrgNameGraftRow {
  entitySlug: string;
  entityId?: string;
  servedName: string;
  entityType: string;
  studentVisibilityTier: string;
  graftedName: string;
  sourceName: string;
  sourceUrl: string;
  verdict: string;
  observationIds: string[];
  replacementNameAfterRollback: string;
  needsRescrapeToRename: boolean;
  replacementIsStillAnOrganization: boolean;
}

interface EntityContext {
  slug: string;
  name: string;
  entityType: string;
  kind: string;
  studentVisibilityTier: string;
  personName: string;
  manuallyLockedFields: string[];
}

/**
 * Whether the fixed writers would still refuse this stored name for this entity.
 * Running the same guards the writers now run keeps the repair and the write
 * path from drifting apart.
 */
function graftVerdict(
  sourceName: string,
  graftedName: string,
  sourceUrl: string,
  linkedWebsiteUrl: string,
  entity: EntityContext,
  knownPersonSurnames?: ReadonlySet<string>,
): string | null {
  if (sourceName === PROFILE_LINK_SOURCE) {
    const personName = entity.personName || entityKeyPersonTokens(entity.slug).join(' ');
    const verdict = classifyHarvestedResearchHomeName({
      harvestedName: graftedName,
      personName,
      websiteUrl: linkedWebsiteUrl || sourceUrl,
      knownPersonSurnames,
    });
    return verdict === 'AFFILIATED_ORGANIZATION' || verdict === 'ANOTHER_PERSONS_LAB'
      ? verdict
      : null;
  }
  if (sourceName !== MICROSITE_SOURCE) return null;
  if (isPersonCmsProfileUrl(sourceUrl)) return 'PERSON_CMS_PROFILE_SOURCE';
  if (!isPersonScopedResearchEntity(entity)) return null;
  if (isUmbrellaOrganizationName(graftedName)) return 'AFFILIATED_ORGANIZATION';
  const foreign = claimsAnotherPersonsLab({
    harvestedName: graftedName,
    websiteUrl: linkedWebsiteUrl || sourceUrl,
    identityTokens: entityKeyPersonTokens(entity.slug),
    knownPersonSurnames,
  });
  return foreign ? 'ANOTHER_PERSONS_LAB' : null;
}

export async function loadOrgNameGrafts(): Promise<OrgNameGraftRow[]> {
  const observations = await Observation.find({
    entityType: 'researchEntity',
    field: { $in: NAME_FIELDS },
    sourceName: { $in: [PROFILE_LINK_SOURCE, MICROSITE_SOURCE] },
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('_id entityKey entityId field value sourceName sourceUrl')
    .lean();

  const allNameObservations = await Observation.find({
    entityType: 'researchEntity',
    field: 'name',
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('entityKey entityId value sourceName confidence')
    .lean();

  // A profile-link name observation cites the PROFILE page, while the harvested
  // name belongs to the linked lab website, so the eponym check has to read the
  // same source's websiteUrl to see whose lab the link actually is.
  const linkedWebsites = new Map<string, string>();
  const websiteObservations = await Observation.find({
    entityType: 'researchEntity',
    field: 'websiteUrl',
    sourceName: { $in: [PROFILE_LINK_SOURCE, MICROSITE_SOURCE] },
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('entityKey entityId value sourceName')
    .lean();
  for (const obs of websiteObservations as Record<string, unknown>[]) {
    const key = `${obs.entityKey || serializedDocumentId(obs.entityId)}|${obs.sourceName}`;
    if (!linkedWebsites.has(key)) linkedWebsites.set(key, String(obs.value || ''));
  }

  // Every known researcher's surname, so an eponymous stored name claiming a
  // person other than this entity's own lead is refusable even when the linked
  // site's path never spells that surname out (#2361).
  const knownPersonSurnames = personSurnamesFromDisplayNames(
    (
      await Researcher.find({ archived: { $ne: true } })
        .select('displayName')
        .lean()
    ).map((person) => (person as { displayName?: unknown }).displayName),
  );

  const slugById = new Map<string, string>();
  for (const entity of await ResearchEntity.find({}).select('_id slug').lean()) {
    const id = serializedDocumentId((entity as { _id: unknown })._id);
    if (id) slugById.set(id, String((entity as { slug?: unknown }).slug || ''));
  }

  const entityCache = new Map<string, EntityContext | null>();
  const loadEntity = async (
    entityKey: string | undefined,
    entityId: string | undefined,
  ): Promise<EntityContext | null> => {
    const cacheKey = entityKey || entityId || '';
    if (entityCache.has(cacheKey)) return entityCache.get(cacheKey) ?? null;
    const entity = await ResearchEntity.findOne(entityKey ? { slug: entityKey } : { _id: entityId })
      .select('_id slug name entityType kind studentVisibilityTier manuallyLockedFields')
      .lean();
    if (!entity) {
      entityCache.set(cacheKey, null);
      return null;
    }
    const lead = await RoleAssignment.findOne({
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': (entity as { _id: unknown })._id,
      role: { $in: ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'] },
      archived: { $ne: true },
      state: { $ne: 'HISTORICAL' },
    })
      .select('personId')
      .lean();
    const leadPersonId = (lead as unknown as { personId?: unknown } | null)?.personId;
    const person = leadPersonId
      ? await Researcher.findById(leadPersonId).select('displayName').lean()
      : null;
    const record = entity as Record<string, unknown>;
    const context: EntityContext = {
      slug: String(record.slug || ''),
      name: String(record.name || ''),
      entityType: String(record.entityType || ''),
      kind: String(record.kind || ''),
      studentVisibilityTier: String(record.studentVisibilityTier || ''),
      personName: String((person as { displayName?: string } | null)?.displayName || ''),
      manuallyLockedFields: (record.manuallyLockedFields as string[]) || [],
    };
    entityCache.set(cacheKey, context);
    return context;
  };

  const grouped = new Map<string, OrgNameGraftRow & { idSet: Set<string> }>();
  const graftedPairsBySlug = new Map<string, Set<string>>();
  for (const obs of observations as Record<string, unknown>[]) {
    const entityKey = obs.entityKey ? String(obs.entityKey) : undefined;
    const entityId = obs.entityId ? serializedDocumentId(obs.entityId) : undefined;
    const entity = await loadEntity(entityKey, entityId);
    if (!entity) continue;
    if (entity.manuallyLockedFields.includes('name')) continue;
    const graftedName = String(obs.value || '');
    const sourceUrl = String(obs.sourceUrl || '');
    const sourceName = String(obs.sourceName);
    const linkedWebsiteUrl = linkedWebsites.get(`${entityKey || entityId}|${sourceName}`) || '';
    const verdict = graftVerdict(
      sourceName,
      graftedName,
      sourceUrl,
      linkedWebsiteUrl,
      entity,
      knownPersonSurnames,
    );
    if (!verdict) continue;

    const groupKey = `${entity.slug}|${sourceName}|${graftedName}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        entitySlug: entity.slug,
        entityId,
        servedName: entity.name,
        entityType: entity.entityType,
        studentVisibilityTier: entity.studentVisibilityTier,
        graftedName,
        sourceName,
        sourceUrl,
        verdict,
        observationIds: [],
        idSet: new Set<string>(),
        replacementNameAfterRollback: '',
        needsRescrapeToRename: true,
        replacementIsStillAnOrganization: false,
      });
    }
    const group = grouped.get(groupKey)!;
    const observationId = serializedDocumentId(obs._id);
    if (observationId && !group.idSet.has(observationId)) {
      group.idSet.add(observationId);
      group.observationIds.push(observationId);
    }
    const pairs = graftedPairsBySlug.get(entity.slug) || new Set<string>();
    pairs.add(`${sourceName}|${graftedName}`);
    graftedPairsBySlug.set(entity.slug, pairs);
  }

  // The name a row would serve after the rollback is whatever active name
  // observation survives it, which means excluding every graft this repair
  // retires for that entity rather than only the one being reported.
  const activeNamesBySlug = new Map<string, Record<string, unknown>[]>();
  for (const candidate of allNameObservations as Record<string, unknown>[]) {
    const slug = candidate.entityKey
      ? String(candidate.entityKey)
      : slugById.get(String(serializedDocumentId(candidate.entityId)));
    if (!slug) continue;
    activeNamesBySlug.set(slug, [...(activeNamesBySlug.get(slug) || []), candidate]);
  }

  return Array.from(grouped.values())
    .map(({ idSet: _idSet, ...row }) => {
      const retired = graftedPairsBySlug.get(row.entitySlug) || new Set<string>();
      const survivors = (activeNamesBySlug.get(row.entitySlug) || [])
        .filter(
          (candidate) =>
            !retired.has(`${String(candidate.sourceName)}|${String(candidate.value || '')}`),
        )
        .sort((a, b) => Number(b.confidence) - Number(a.confidence));
      return {
        ...row,
        replacementNameAfterRollback: String(survivors[0]?.value || ''),
        needsRescrapeToRename: survivors.length === 0,
        replacementIsStillAnOrganization: isUmbrellaOrganizationName(survivors[0]?.value),
      };
    })
    .sort((a, b) => a.entitySlug.localeCompare(b.entitySlug));
}

async function applyRows(rows: OrgNameGraftRow[]): Promise<number> {
  let rolledBack = 0;
  for (const row of rows) {
    const ids = row.observationIds.map((id) => new mongoose.Types.ObjectId(id));
    const result = await Observation.updateMany(
      { _id: { $in: ids }, superseded: { $ne: true } },
      {
        $set: {
          superseded: true,
          rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON },
        },
      },
    );
    rolledBack += result.modifiedCount || 0;
  }
  return rolledBack;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const rows = await loadOrgNameGrafts();
  const plannedObservations = rows.reduce((sum, row) => sum + row.observationIds.length, 0);

  if (args.apply) {
    if (!args.confirm) {
      throw new Error('--confirm-retire-org-name-grafts is required when --apply is set.');
    }
    if (plannedObservations > args.maxApply) {
      throw new Error(
        `Apply would roll back ${plannedObservations} observations, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const rolledBack = args.apply ? await applyRows(rows) : 0;

  const byVerdict: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const row of rows) {
    byVerdict[row.verdict] = (byVerdict[row.verdict] || 0) + 1;
    bySource[row.sourceName] = (bySource[row.sourceName] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    graftedEntities: rows.length,
    plannedObservations,
    rolledBackObservations: rolledBack,
    byVerdict,
    bySource,
    studentReadyAffected: rows.filter((row) => row.studentVisibilityTier === 'student_ready')
      .length,
    resolvableWithoutRescrape: rows.filter((row) => !row.needsRescrapeToRename).length,
    needsRescrapeToRename: rows.filter((row) => row.needsRescrapeToRename).length,
    replacementStillAnOrganization: rows.filter((row) => row.replacementIsStillAnOrganization)
      .length,
    rows,
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({ ...report, rows: rows.slice(0, 40) }, null, 2));
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
