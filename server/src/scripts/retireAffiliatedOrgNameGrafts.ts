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
  eponymMatchesIdentity,
  eponymousOrganizationNameSurnameCandidates,
  isPersonScopedResearchEntity,
  isUmbrellaOrganizationName,
  personIdentityTokens,
  personScopedResearchEntityNameNamesSomethingElse,
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
  documentStillServesGraft: boolean;
  documentGraftedFields: GraftedDocumentField[];
  replacementNameAfterRollback: string;
  needsRescrapeToRename: boolean;
  replacementIsStillAnOrganization: boolean;
}

/**
 * A name field the DOCUMENT still serves wrongly, carrying the value the document
 * actually holds rather than the observation's raw value. Materialization
 * normalizes a name before storing it (dashes, smart quotes, trailing
 * descriptions, credentials), so comparing the stored value to the observation
 * string misses exactly the records whose graft was normalized on the way in and
 * silently drops them from the repair (#2351).
 */
export interface GraftedDocumentField {
  field: string;
  storedName: string;
}

interface EntityContext {
  slug: string;
  name: string;
  displayName: string;
  entityType: string;
  kind: string;
  studentVisibilityTier: string;
  personName: string;
  manuallyLockedFields: string[];
}

/**
 * The record's own person identity, resolved the way
 * `personScopedResearchEntityNameNamesSomethingElse` resolves it: the lead's name
 * when a lead is known, and only otherwise the slug's tokens. A slug names the
 * research rather than the person (`yale-sleep-neurobiology-lab`), so judging an
 * eponym against slug tokens alone reads a lab correctly named after its own PI
 * as somebody else's (#2361).
 */
function entityIdentityTokens(entity: EntityContext): string[] {
  const personTokens = personIdentityTokens(entity.personName);
  return personTokens.length > 0 ? personTokens : entityKeyPersonTokens(entity.slug);
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
  const identityTokens = entityIdentityTokens(entity);
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
  if (isUmbrellaOrganizationName(graftedName)) {
    const namesThisRecordsOwnLead = eponymousOrganizationNameSurnameCandidates(graftedName).some(
      (eponym) => eponymMatchesIdentity(eponym, identityTokens),
    );
    return namesThisRecordsOwnLead ? null : 'AFFILIATED_ORGANIZATION';
  }
  const foreign = claimsAnotherPersonsLab({
    harvestedName: graftedName,
    websiteUrl: linkedWebsiteUrl || sourceUrl,
    identityTokens,
    knownPersonSurnames,
  });
  return foreign ? 'ANOTHER_PERSONS_LAB' : null;
}

/**
 * Whether the value the DOCUMENT currently holds for a name field still names
 * something other than this record, judged with the same predicate the writers
 * and serve paths now run. The byte-equality fallback covers the entities the
 * predicate does not speak for (an organization-shaped record grafted from a
 * profile lab-website link), so this is never narrower than comparing the stored
 * value to the observation string.
 *
 * The surname roster reaches this predicate too, so a stored graft normalized on
 * the way in ("Girgenti Lab - Yale School of Medicine" stored as "Girgenti Lab")
 * is still recognized on a generic site path, which is what lets the repair
 * rewrite the document rather than retire the observation and walk away (#2361).
 */
function documentNameStillNamesSomethingElse(
  entity: EntityContext,
  storedName: string,
  graftedName: string,
  websiteUrl: string,
  knownPersonSurnames?: ReadonlySet<string>,
): boolean {
  if (!storedName) return false;
  if (storedName === graftedName) return true;
  return personScopedResearchEntityNameNamesSomethingElse({
    candidateName: storedName,
    entityType: entity.entityType,
    kind: entity.kind,
    slug: entity.slug,
    personName: entity.personName,
    websiteUrl,
    knownPersonSurnames,
  });
}

/**
 * Grafted name observations, INCLUDING ones a previous run already retired.
 * Skipping those is what stranded the records this issue reports: the
 * 2026-09-01 apply retired the observations, nothing rewrote the documents, and a
 * re-run could no longer see the rows it had half-fixed (#2351). A row whose
 * observation is retired AND whose document no longer serves a wrong name has
 * nothing left to do and is dropped, so the repair still terminates.
 */
export async function loadOrgNameGrafts(): Promise<OrgNameGraftRow[]> {
  const observations = await Observation.find({
    entityType: 'researchEntity',
    field: { $in: NAME_FIELDS },
    sourceName: { $in: [PROFILE_LINK_SOURCE, MICROSITE_SOURCE] },
  })
    .select('_id entityKey entityId field value sourceName sourceUrl superseded')
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
      .select(
        '_id slug name displayName entityType kind studentVisibilityTier manuallyLockedFields',
      )
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
      displayName: String(record.displayName || ''),
      entityType: String(record.entityType || ''),
      kind: String(record.kind || ''),
      studentVisibilityTier: String(record.studentVisibilityTier || ''),
      personName: String((person as { displayName?: string } | null)?.displayName || ''),
      manuallyLockedFields: (record.manuallyLockedFields as string[]) || [],
    };
    entityCache.set(cacheKey, context);
    return context;
  };

  const grouped = new Map<
    string,
    OrgNameGraftRow & { idSet: Set<string>; entity: EntityContext; linkedWebsiteUrl: string }
  >();
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
    // A manually locked field has nothing the repair may do, so it never counts as
    // still served; otherwise the row would be re-reported on every future run
    // with no action available to close it out.
    const graftedDocumentFields = NAME_FIELDS.filter(
      (candidateField) =>
        !entity.manuallyLockedFields.includes(candidateField) &&
        documentNameStillNamesSomethingElse(
          entity,
          candidateField === 'displayName' ? entity.displayName : entity.name,
          graftedName,
          linkedWebsiteUrl || sourceUrl,
          knownPersonSurnames,
        ),
    );
    const documentServesThisGraft = graftedDocumentFields.length > 0;
    const alreadyRetired = obs.superseded === true;
    if (alreadyRetired && !documentServesThisGraft) continue;

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
        entity,
        linkedWebsiteUrl: linkedWebsiteUrl || sourceUrl,
        documentStillServesGraft: false,
        documentGraftedFields: [],
        replacementNameAfterRollback: '',
        needsRescrapeToRename: true,
        replacementIsStillAnOrganization: false,
      });
    }
    const group = grouped.get(groupKey)!;
    for (const graftedField of graftedDocumentFields) {
      if (group.documentGraftedFields.some((entry) => entry.field === graftedField)) continue;
      group.documentGraftedFields.push({
        field: graftedField,
        storedName: graftedField === 'displayName' ? entity.displayName : entity.name,
      });
    }
    group.documentStillServesGraft = group.documentGraftedFields.length > 0;
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
    .map(({ idSet: _idSet, entity, linkedWebsiteUrl, ...row }) => {
      const retired = graftedPairsBySlug.get(row.entitySlug) || new Set<string>();
      const survivors = (activeNamesBySlug.get(row.entitySlug) || [])
        .filter(
          (candidate) =>
            !retired.has(`${String(candidate.sourceName)}|${String(candidate.value || '')}`),
        )
        .sort((a, b) => Number(b.confidence) - Number(a.confidence));
      // A survivor from a source this scan never looks at can itself be an
      // umbrella-organization or foreign-lab name, so the replacement has to clear
      // the same guard the writers run. When none does, the row falls through to
      // `needsRescrapeToRename` rather than trading one graft for another.
      const replacement = survivors.find(
        (candidate) =>
          String(candidate.value || '') &&
          !documentNameStillNamesSomethingElse(
            entity,
            String(candidate.value || ''),
            '',
            linkedWebsiteUrl,
            knownPersonSurnames,
          ),
      );
      return {
        ...row,
        replacementNameAfterRollback: String(replacement?.value || ''),
        needsRescrapeToRename: !replacement,
        replacementIsStillAnOrganization: isUmbrellaOrganizationName(survivors[0]?.value),
      };
    })
    .sort((a, b) => a.entitySlug.localeCompare(b.entitySlug));
}

/**
 * Retiring the observation is not the repair. The document keeps whatever the
 * graft wrote until something rewrites that field, and for `displayName` nothing
 * ever does: no faculty-directory source emits it, so the retired value stayed on
 * served records after this script's own 2026-09-01 apply (#2351). So the document
 * is corrected in the same pass, and only on the fields whose STORED value was
 * itself judged wrong, matched by that stored value so a concurrent
 * re-materialization is never overwritten blind.
 *
 * `displayName` clears outright because every serve path falls back to `name`.
 * `name` only moves to a surviving observation's value that clears the same
 * identity guard, so a record is never left nameless nor renamed to a second
 * umbrella organization; when nothing qualifies, `needsRescrapeToRename` already
 * reports it for a rename pass.
 */
async function clearGraftFromDocument(row: OrgNameGraftRow): Promise<number> {
  const entityFilter = row.entityId
    ? { _id: new mongoose.Types.ObjectId(row.entityId) }
    : { slug: row.entitySlug };
  const correction = (field: string): Record<string, unknown> | null => {
    if (field !== 'name') {
      return { $unset: { [field]: '', [`fieldProvenance.${field}`]: '' } };
    }
    return row.replacementNameAfterRollback
      ? {
          $set: { name: row.replacementNameAfterRollback },
          $unset: { 'fieldProvenance.name': '' },
        }
      : null;
  };
  let corrected = 0;
  for (const { field, storedName } of row.documentGraftedFields) {
    const update = correction(field);
    if (!update) continue;
    const result = await ResearchEntity.updateOne(
      { ...entityFilter, [field]: storedName, manuallyLockedFields: { $ne: field } },
      update,
    );
    corrected += result.modifiedCount || 0;
  }
  return corrected;
}

export async function applyRows(rows: OrgNameGraftRow[]): Promise<{
  rolledBack: number;
  documentFieldsCorrected: number;
}> {
  let rolledBack = 0;
  let documentFieldsCorrected = 0;
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
    documentFieldsCorrected += await clearGraftFromDocument(row);
  }
  return { rolledBack, documentFieldsCorrected };
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

  const applied = args.apply
    ? await applyRows(rows)
    : { rolledBack: 0, documentFieldsCorrected: 0 };

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
    rolledBackObservations: applied.rolledBack,
    documentFieldsCorrected: applied.documentFieldsCorrected,
    documentsStillServingGraft: rows.filter((row) => row.documentStillServesGraft).length,
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
