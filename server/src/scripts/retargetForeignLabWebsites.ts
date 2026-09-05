/**
 * Re-homes a lab website that a person's profile links but does not own.
 *
 * Yale's profile content models expose one "lab website" slot for both "my lab"
 * and "a lab I collaborate with". Refusing the link as the profile owner's
 * identity (#2234, #2361) stops the graft but drops the corpus's only edge to that
 * lab, so the lab itself keeps an empty `websiteUrl` and no searchable name:
 * `ysm-faculty-amit-khanna`, a colorectal surgeon, served APOLLO Lab's name, site,
 * robotics description and undergrad roster while `rakita-lab-dr877` - Daniel
 * Rakita's actual lab - could not be reached by a search for "apollo" (#2385).
 *
 * So the link is moved rather than discarded: the lab site is asked who leads it,
 * and the website lands on that researcher's research home. Every step fails
 * closed, because a wrong move grafts the same content onto a second innocent
 * record. Dry-run is the default and apply needs an explicit confirm flag.
 *
 * Run:
 *   npx tsx server/src/scripts/retargetForeignLabWebsites.ts
 *   npx tsx server/src/scripts/retargetForeignLabWebsites.ts --apply \
 *     --confirm-retarget-foreign-lab-websites --only=ysm-faculty-amit-khanna
 */
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
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import {
  LAB_SITE_DECLARED_LEAD_SOURCE,
  extractLabSiteDeclaredLead,
  type LabSiteDeclaredLead,
} from '../scrapers/utils/labSiteDeclaredLeadExtractor';
import {
  decideForeignLabWebsiteRetarget,
  personNamesDenoteSamePerson,
  type ForeignLabWebsiteRetargetDecision,
  type RetargetCandidateResearchHome,
} from '../utils/foreignLabWebsiteRetarget';
import {
  isPersonScopedResearchEntity,
  nameCarriesPersonIdentity,
} from '../utils/researchHomeNameIdentityAuthority';
import {
  DEFAULT_SOURCE_CONCURRENCY,
  mapWithConcurrency,
  resolveSourceConcurrency,
} from '../scrapers/utils/mapWithConcurrency';
import {
  deriveShortDescriptionFromFullDescription,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import { syncEntity } from '../services/meiliSyncService';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:retarget-foreign-lab-websites';
const PROFILE_LINK_SOURCE = 'ysm-faculty-directory';
const SOURCE_WEIGHT = 0.9;
const RETIRE_REASON =
  'lab website harvested from a profile lab-website slot re-homed to the lead the lab site declares for itself (#2385)';

export interface RetargetForeignLabWebsitesArgs {
  apply: boolean;
  confirm: boolean;
  limit: number;
  maxApply: number;
  only: string[];
  output?: string;
}

export function parseArgs(argv: string[]): RetargetForeignLabWebsitesArgs {
  const args: RetargetForeignLabWebsitesArgs = {
    apply: false,
    confirm: false,
    limit: 50,
    maxApply: 100,
    only: [],
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-retarget-foreign-lab-websites') args.confirm = true;
    else if (arg.startsWith('--limit='))
      args.limit = parsePositiveInteger(arg.slice('--limit='.length));
    else if (arg === '--limit') args.limit = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--max-apply=')) {
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    } else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--only=')) args.only.push(...splitList(arg.slice('--only='.length)));
    else if (arg === '--only') args.only.push(...splitList(argv[++index]));
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
  }
  return args;
}

function splitList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--limit and --max-apply must be safe positive integers');
  }
  return parsed;
}

export interface ForeignLabWebsiteCandidate {
  holderSlug: string;
  holderId?: string;
  holderName: string;
  holderEntityType: string;
  holderKind: string;
  holderLeadName: string;
  holderVisibilityTier: string;
  websiteUrl: string;
  profileUrl: string;
  slotNames: string[];
  observationIds: string[];
  manuallyLockedFields: string[];
}

export interface RetargetRow extends ForeignLabWebsiteCandidate {
  declaredLead: string;
  siteName: string;
  evidenceUrl: string;
  decision: ForeignLabWebsiteRetargetDecision['action'] | 'NO_SITE_EVIDENCE';
  refusalReason?: string;
  targetSlug?: string;
  adoptedName?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

async function resolveLeadName(entityId: unknown): Promise<string> {
  const lead = await RoleAssignment.findOne({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': entityId,
    role: { $in: ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'] },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('personId')
    .lean();
  const personId = (lead as unknown as { personId?: unknown } | null)?.personId;
  if (!personId) return '';
  const person = await Researcher.findById(personId).select('displayName').lean();
  return textValue((person as { displayName?: unknown } | null)?.displayName);
}

/**
 * Research homes whose lead is this person, for the retarget decision to choose
 * between.
 *
 * The lead is resolved through `RoleAssignment` rather than approximated from slug
 * tokens: the slug fallback is a silent precision downgrade (#2384), and this lane
 * moves a served website on the answer.
 */
export async function loadResearchHomesForLead(
  declaredLead: string,
): Promise<RetargetCandidateResearchHome[]> {
  const surname = declaredLead.split(/\s+/).filter(Boolean).slice(-1)[0] || '';
  if (surname.length < 2) return [];
  const researchers = await Researcher.find({
    displayName: new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
    archived: { $ne: true },
  })
    .select('_id displayName')
    .lean();
  const matching = researchers.filter((researcher) =>
    personNamesDenoteSamePerson(
      (researcher as { displayName?: unknown }).displayName,
      declaredLead,
    ),
  );
  if (matching.length === 0) return [];

  const assignments = await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    personId: { $in: matching.map((researcher) => (researcher as { _id: unknown })._id) },
    role: { $in: ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'] },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('target.id personId')
    .lean();
  const entityIds = assignments
    .map((assignment) => (assignment as { target?: { id?: unknown } }).target?.id)
    .filter(Boolean);
  if (entityIds.length === 0) return [];

  const leadNameById = new Map(
    matching.map((researcher) => [
      serializedDocumentId((researcher as { _id: unknown })._id),
      textValue((researcher as { displayName?: unknown }).displayName),
    ]),
  );
  const leadNameByEntityId = new Map<string, string>();
  for (const assignment of assignments) {
    const entityId = serializedDocumentId((assignment as { target?: { id?: unknown } }).target?.id);
    const personId = serializedDocumentId((assignment as { personId?: unknown }).personId);
    if (entityId && personId && leadNameById.has(personId)) {
      leadNameByEntityId.set(entityId, leadNameById.get(personId)!);
    }
  }

  const entities = await ResearchEntity.find({ _id: { $in: entityIds }, archived: { $ne: true } })
    .select('_id slug name entityType kind websiteUrl manuallyLockedFields')
    .lean();
  return entities
    .filter((entity) => isPersonScopedResearchEntity(entity as Record<string, unknown>))
    .map((entity) => ({
      slug: textValue((entity as { slug?: unknown }).slug),
      name: (entity as { name?: unknown }).name,
      entityType: (entity as { entityType?: unknown }).entityType,
      kind: (entity as { kind?: unknown }).kind,
      websiteUrl: (entity as { websiteUrl?: unknown }).websiteUrl,
      leadName: leadNameByEntityId.get(
        serializedDocumentId((entity as { _id: unknown })._id) || '',
      ),
    }));
}

/**
 * Person-scoped records serving a website harvested from a profile lab-website
 * slot whose stored name does not name the record's own lead.
 *
 * A name that carries the lead's own identity ("O'Connor Lab" on Kevin O'Connor's
 * row) is that person's lab by the same authority the harvest path uses, so it is
 * never a candidate and never costs an LLM call.
 */
export async function loadForeignLabWebsiteCandidates(
  only: string[] = [],
): Promise<ForeignLabWebsiteCandidate[]> {
  // Retired slot observations are INCLUDED on purpose. Retiring an observation is
  // not the repair - the document keeps what the graft wrote until something
  // rewrites that field - so a run that moved the website but not yet the name would
  // otherwise be unable to see the row it half-fixed, which is how #2351's earlier
  // repair stranded records. A row with nothing left to correct is dropped below, so
  // the lane still terminates.
  const slotObservations = await Observation.find({
    entityType: 'researchEntity',
    field: { $in: ['websiteUrl', 'name', 'displayName'] },
    sourceName: PROFILE_LINK_SOURCE,
    ...(only.length > 0 ? { entityKey: { $in: only } } : {}),
  })
    .select('_id entityKey entityId field value sourceUrl superseded')
    .lean();

  const byHolder = new Map<
    string,
    {
      websiteUrl: string;
      profileUrl: string;
      ids: string[];
      slotNames: string[];
      anyLive: boolean;
    }
  >();
  for (const observation of slotObservations as Record<string, unknown>[]) {
    const key =
      textValue(observation.entityKey) || serializedDocumentId(observation.entityId) || '';
    if (!key) continue;
    const entry = byHolder.get(key) || {
      websiteUrl: '',
      profileUrl: '',
      ids: [],
      slotNames: [],
      anyLive: false,
    };
    const live = observation.superseded !== true;
    if (observation.field === 'websiteUrl') {
      entry.websiteUrl = entry.websiteUrl || textValue(observation.value);
    } else {
      const slotName = textValue(observation.value);
      if (slotName && !entry.slotNames.includes(slotName)) entry.slotNames.push(slotName);
    }
    entry.profileUrl = entry.profileUrl || textValue(observation.sourceUrl);
    if (live) entry.anyLive = true;
    const id = serializedDocumentId(observation._id);
    if (id) entry.ids.push(id);
    byHolder.set(key, entry);
  }

  const candidates: ForeignLabWebsiteCandidate[] = [];
  for (const [holderKey, entry] of byHolder) {
    if (!entry.websiteUrl) continue;
    const holder = await ResearchEntity.findOne({ slug: holderKey })
      .select(
        '_id slug name displayName entityType kind studentVisibilityTier manuallyLockedFields websiteUrl',
      )
      .lean();
    if (!holder) continue;
    if (!isPersonScopedResearchEntity(holder as Record<string, unknown>)) continue;
    const holderName = textValue((holder as { name?: unknown }).name);
    const holderLeadName = await resolveLeadName((holder as { _id: unknown })._id);
    if (holderLeadName && nameCarriesPersonIdentity(holderName, holderLeadName)) continue;
    // A row whose slot observations are all retired only stays a candidate while its
    // DOCUMENT still serves something the slot wrote, so a completed repair drops out
    // instead of paying for a lab-site read on every future run.
    const documentStillServesSlot =
      entry.slotNames.includes(holderName) ||
      entry.slotNames.includes(textValue((holder as { displayName?: unknown }).displayName)) ||
      textValue((holder as { websiteUrl?: unknown }).websiteUrl) === entry.websiteUrl;
    if (!entry.anyLive && !documentStillServesSlot) continue;
    candidates.push({
      holderSlug: textValue((holder as { slug?: unknown }).slug),
      holderId: serializedDocumentId((holder as { _id: unknown })._id),
      holderName,
      holderEntityType: textValue((holder as { entityType?: unknown }).entityType),
      holderKind: textValue((holder as { kind?: unknown }).kind),
      holderLeadName,
      holderVisibilityTier: textValue(
        (holder as { studentVisibilityTier?: unknown }).studentVisibilityTier,
      ),
      websiteUrl: entry.websiteUrl,
      profileUrl: entry.profileUrl,
      slotNames: entry.slotNames,
      observationIds: entry.ids,
      manuallyLockedFields:
        ((holder as { manuallyLockedFields?: unknown }).manuallyLockedFields as string[]) || [],
    });
  }
  return candidates.sort((left, right) => left.holderSlug.localeCompare(right.holderSlug));
}

export async function buildRetargetRows(
  candidates: ForeignLabWebsiteCandidate[],
  deps: {
    readSite?: (websiteUrl: string) => Promise<LabSiteDeclaredLead | null>;
    loadHomesForLead?: (declaredLead: string) => Promise<RetargetCandidateResearchHome[]>;
    concurrency?: number;
  } = {},
): Promise<RetargetRow[]> {
  const readSite = deps.readSite ?? ((url: string) => extractLabSiteDeclaredLead(url));
  const loadHomesForLead = deps.loadHomesForLead ?? loadResearchHomesForLead;
  const ordered: Array<RetargetRow | undefined> = new Array(candidates.length);
  await mapWithConcurrency(
    candidates,
    resolveSourceConcurrency(deps.concurrency, DEFAULT_SOURCE_CONCURRENCY),
    async (candidate, index) => {
      ordered[index] = await buildRetargetRow(candidate, readSite, loadHomesForLead);
    },
  );
  return ordered.filter((row): row is RetargetRow => Boolean(row));
}

async function buildRetargetRow(
  candidate: ForeignLabWebsiteCandidate,
  readSite: (websiteUrl: string) => Promise<LabSiteDeclaredLead | null>,
  loadHomesForLead: (declaredLead: string) => Promise<RetargetCandidateResearchHome[]>,
): Promise<RetargetRow> {
  const site = await readSite(candidate.websiteUrl);
  if (!site) {
    return {
      ...candidate,
      declaredLead: '',
      siteName: '',
      evidenceUrl: '',
      decision: 'NO_SITE_EVIDENCE',
    };
  }
  const homes = await loadHomesForLead(site.declaredLead);
  const decision = decideForeignLabWebsiteRetarget({
    holder: {
      slug: candidate.holderSlug,
      name: candidate.holderName,
      entityType: candidate.holderEntityType,
      kind: candidate.holderKind,
      websiteUrl: candidate.websiteUrl,
      leadName: candidate.holderLeadName,
    },
    websiteUrl: candidate.websiteUrl,
    siteName: site.labName,
    declaredLead: site.declaredLead,
    researchHomesByLead: homes,
  });
  return {
    ...candidate,
    declaredLead: site.declaredLead,
    siteName: site.labName,
    evidenceUrl: site.evidenceUrl,
    decision: decision.action,
    refusalReason: decision.action === 'REFUSE' ? decision.reason : undefined,
    targetSlug: decision.action === 'RETARGET' ? decision.targetSlug : undefined,
    adoptedName: decision.action === 'RETARGET' ? decision.adoptableName : undefined,
  };
}

// Served fields a lab site writes, so a site that turns out to belong to somebody
// else has to give all of them back, not only the website it was linked by. Purely
// structural and bookkeeping fields (`slug`, `kind`, `school`, `lastObservedAt`,
// `sourceContentHash`) are absent on purpose: their observations are retired with
// the rest, but rewriting them on the document is a materializer's job, not this
// lane's.
const SITE_GRAFT_DOCUMENT_FIELDS = [
  'fullDescription',
  'shortDescription',
  'methods',
  'researchAreas',
  'currentUndergradCount',
  'undergradEvidenceQuote',
] as const;

function hostOf(value: unknown): string {
  try {
    return new URL(textValue(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

const NAME_FIELDS = ['name', 'displayName'] as const;

/**
 * The name the lab-website slot wrote, corrected on the record the site does not
 * belong to.
 *
 * This is not the name-graft sweep of #2361/#2362, which judges a stored name by its
 * shape against a surname roster. Here the site has already told us it belongs to
 * somebody else, so the name that came out of the same slot is refused on that
 * evidence, and leaving it behind would keep ranking the wrong record first for the
 * lab's own name - which is the whole symptom #2385 reports.
 *
 * The replacement is the value the write path itself produces for a profile with no
 * adoptable lab name, `<person> Faculty Research`, so a later re-scrape agrees with
 * this repair instead of fighting it. `displayName` clears outright because every
 * serve path falls back to `name`.
 */
function correctGraftedName(
  row: RetargetRow,
  live: Record<string, unknown>[],
  set: Record<string, unknown>,
  unset: Record<string, string>,
): void {
  if (row.slotNames.length === 0) return;
  for (const field of NAME_FIELDS) {
    if (row.manuallyLockedFields.includes(field)) continue;
    const stored = field === 'name' ? row.holderName : '';
    if (field === 'name' && !row.slotNames.includes(stored)) continue;
    if (field === 'displayName') {
      unset.displayName = '';
      unset['fieldProvenance.displayName'] = '';
      continue;
    }
    const survivor = live
      .filter(
        (observation) =>
          String(observation.field) === 'name' &&
          !row.slotNames.includes(textValue(observation.value)),
      )
      .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0];
    const replacement = survivor
      ? textValue(survivor.value)
      : row.holderLeadName
        ? `${row.holderLeadName} Faculty Research`
        : '';
    if (!replacement) continue;
    set.name = replacement;
    unset['fieldProvenance.name'] = '';
  }
}

/**
 * Everything a re-homed lab site wrote onto the record that does not own it.
 *
 * Once the site declares a lead who is somebody else, the site cannot describe
 * this record either, so its description, methods and undergrad evidence are as
 * much a graft as the website itself - the asymmetry #2272 fixed for the name-only
 * refusal, arrived at here from the site's own declared lead rather than from a
 * name heuristic. `ysm-faculty-amit-khanna` served APOLLO Lab's robotics prose and
 * a count of 10 undergrads read off its `/team/` page.
 *
 * Each field falls back to the newest surviving observation from another source
 * rather than being blanked, so a record that stated its own description keeps it:
 * Khanna's own profile description survives this repair. A field with no survivor
 * is unset, because serving a wrong value is worse than serving none.
 */
export async function retireSiteGraftFromHolder(row: RetargetRow): Promise<{
  observationsRetired: number;
  documentFieldsCorrected: number;
}> {
  const siteHost = hostOf(row.websiteUrl);
  if (!siteHost) return { observationsRetired: 0, documentFieldsCorrected: 0 };

  const live = await Observation.find({
    entityType: 'researchEntity',
    entityKey: row.holderSlug,
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
  })
    .select('_id field value sourceUrl sourceName confidence observedAt')
    .lean();

  const grafted = (live as Record<string, unknown>[]).filter(
    (observation) => hostOf(observation.sourceUrl) === siteHost,
  );
  // Deliberately NOT an early return on an empty `grafted`: the slot's NAME is cited
  // to the profile page rather than to the site, so a record whose site-sourced
  // observations a previous run already retired still has a name to correct.
  const retired =
    grafted.length > 0
      ? await Observation.updateMany(
          {
            _id: { $in: grafted.map((observation) => observation._id) },
            superseded: { $ne: true },
          },
          {
            $set: {
              superseded: true,
              rollback: { rolledBackAt: new Date(), reason: RETIRE_REASON },
            },
          },
        )
      : { modifiedCount: 0 };

  const graftedFields = new Set(grafted.map((observation) => String(observation.field)));
  const set: Record<string, unknown> = {};
  const unset: Record<string, string> = {};
  correctGraftedName(row, live as Record<string, unknown>[], set, unset);
  for (const field of SITE_GRAFT_DOCUMENT_FIELDS) {
    if (!graftedFields.has(field)) continue;
    if (row.manuallyLockedFields.includes(field)) continue;
    const survivor = (live as Record<string, unknown>[])
      .filter(
        (observation) =>
          String(observation.field) === field && hostOf(observation.sourceUrl) !== siteHost,
      )
      .sort(
        (left, right) =>
          Number(right.confidence || 0) - Number(left.confidence || 0) ||
          new Date(String(right.observedAt || 0)).getTime() -
            new Date(String(left.observedAt || 0)).getTime(),
      )[0];
    if (survivor) set[field] = survivor.value;
    else unset[field] = '';
    unset[`fieldProvenance.${field}`] = '';
  }
  // A blank card description takes the record out of the served set entirely, because
  // the detail route's public-description invariant fails and the slug starts
  // answering 404 while its stored tier still claims `student_ready`. So the card is
  // re-derived from whichever full description survives; when nothing useful can be
  // derived the field stays blank on purpose and the visibility re-gate below moves
  // the tier to match, rather than leaving a broken window behind.
  if ('shortDescription' in unset || 'shortDescription' in set) {
    const storedFull = textValue(
      (
        (await ResearchEntity.findOne({ slug: row.holderSlug })
          .select('fullDescription')
          .lean()) as { fullDescription?: unknown } | null
      )?.fullDescription,
    );
    const survivingFull =
      'fullDescription' in set
        ? textValue(set.fullDescription)
        : 'fullDescription' in unset
          ? ''
          : storedFull;
    const derived = deriveShortDescriptionFromFullDescription(survivingFull);
    if (derived && shortDescriptionQuality(derived, survivingFull).isUseful) {
      set.shortDescription = derived;
      delete unset.shortDescription;
    }
  }

  let documentFieldsCorrected = 0;
  if (Object.keys(set).length > 0 || Object.keys(unset).length > 0) {
    const result = await ResearchEntity.updateOne(
      { slug: row.holderSlug },
      {
        ...(Object.keys(set).length > 0 ? { $set: set } : {}),
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
    );
    documentFieldsCorrected = result.modifiedCount
      ? Object.keys(set).length + Object.keys(unset).filter((key) => !key.includes('.')).length
      : 0;
  }
  return { observationsRetired: retired.modifiedCount || 0, documentFieldsCorrected };
}

/**
 * Moves the website in one pass: durable observations so the value survives the
 * next materialization, and the documents themselves so the change reaches served
 * pages without waiting for one.
 *
 * The holder's own field is matched on the value being removed, so a concurrent
 * re-materialization is never overwritten blind, and a manually locked field is
 * left alone on both records.
 */
export async function applyRetargetRows(rows: RetargetRow[]): Promise<{
  websitesMoved: number;
  namesAdopted: number;
  holderFieldsCleared: number;
  observationsRetired: number;
  visibilityTierChanges: number;
  touchedSlugs: string[];
}> {
  const retargets = rows.filter((row) => row.decision === 'RETARGET' && row.targetSlug);
  const summary = {
    websitesMoved: 0,
    namesAdopted: 0,
    holderFieldsCleared: 0,
    observationsRetired: 0,
    visibilityTierChanges: 0,
    touchedSlugs: [] as string[],
  };
  if (retargets.length === 0) return summary;

  const source = await getSourceByName(LAB_SITE_DECLARED_LEAD_SOURCE);
  if (!source) {
    throw new Error(
      `Source '${LAB_SITE_DECLARED_LEAD_SOURCE}' is not registered. Run seedSources before applying.`,
    );
  }
  const runId = new mongoose.Types.ObjectId().toString();

  for (const row of retargets) {
    const target = await ResearchEntity.findOne({ slug: row.targetSlug })
      .select('_id slug name sourceUrls manuallyLockedFields')
      .lean();
    if (!target) continue;
    const targetId = serializedDocumentId((target as { _id: unknown })._id);
    const targetLocked =
      ((target as { manuallyLockedFields?: unknown }).manuallyLockedFields as string[]) || [];
    const sourceUrls = Array.from(
      new Set([
        ...(((target as { sourceUrls?: unknown }).sourceUrls as string[]) || []),
        row.websiteUrl,
      ]),
    );

    const observations = [
      { field: 'websiteUrl', value: row.websiteUrl },
      { field: 'sourceUrls', value: sourceUrls },
      ...(row.adoptedName && !targetLocked.includes('name')
        ? [{ field: 'name', value: row.adoptedName }]
        : []),
    ].map((observation) => ({
      entityType: 'researchEntity' as const,
      entityId: targetId,
      entityKey: row.targetSlug,
      sourceUrl: row.evidenceUrl || row.websiteUrl,
      ...observation,
    }));
    await appendObservations(observations, {
      sourceId: source._id,
      sourceName: LAB_SITE_DECLARED_LEAD_SOURCE,
      scrapeRunId: runId,
      sourceWeight: SOURCE_WEIGHT,
      dryRun: false,
    });

    const targetUpdate: Record<string, unknown> = { websiteUrl: row.websiteUrl, sourceUrls };
    if (row.adoptedName && !targetLocked.includes('name')) targetUpdate.name = row.adoptedName;
    const targetResult = await ResearchEntity.updateOne(
      { _id: (target as { _id: unknown })._id },
      { $set: targetUpdate },
    );
    if (targetResult.modifiedCount) {
      summary.websitesMoved += 1;
      if (targetUpdate.name) summary.namesAdopted += 1;
      summary.touchedSlugs.push(String(row.targetSlug));
    }

    const retired = await Observation.updateMany(
      {
        _id: { $in: row.observationIds.map((id) => new mongoose.Types.ObjectId(id)) },
        superseded: { $ne: true },
      },
      { $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: RETIRE_REASON } } },
    );
    summary.observationsRetired += retired.modifiedCount || 0;

    if (!row.manuallyLockedFields.includes('websiteUrl')) {
      const holderResult = await ResearchEntity.updateOne(
        { slug: row.holderSlug, websiteUrl: row.websiteUrl },
        { $unset: { websiteUrl: '', 'fieldProvenance.websiteUrl': '' } },
      );
      if (holderResult.modifiedCount) {
        summary.holderFieldsCleared += holderResult.modifiedCount;
        summary.touchedSlugs.push(row.holderSlug);
      }
    }

    const holderSourceUrls = await ResearchEntity.findOne({ slug: row.holderSlug })
      .select('sourceUrls')
      .lean();
    const remainingSourceUrls = (
      ((holderSourceUrls as { sourceUrls?: unknown } | null)?.sourceUrls as string[]) || []
    ).filter((url) => hostOf(url) !== hostOf(row.websiteUrl));
    if (
      remainingSourceUrls.length <
      (((holderSourceUrls as { sourceUrls?: unknown } | null)?.sourceUrls as string[]) || []).length
    ) {
      await ResearchEntity.updateOne(
        { slug: row.holderSlug },
        { $set: { sourceUrls: remainingSourceUrls } },
      );
      summary.holderFieldsCleared += 1;
      summary.touchedSlugs.push(row.holderSlug);
    }

    const graftRemoval = await retireSiteGraftFromHolder(row);
    summary.observationsRetired += graftRemoval.observationsRetired;
    summary.holderFieldsCleared += graftRemoval.documentFieldsCorrected;
    if (graftRemoval.documentFieldsCorrected > 0) summary.touchedSlugs.push(row.holderSlug);
  }

  const touched = Array.from(new Set(summary.touchedSlugs));
  const touchedIds: string[] = [];
  for (const slug of touched) {
    const doc = await ResearchEntity.findOne({ slug }).lean();
    if (!doc) continue;
    const id = serializedDocumentId((doc as { _id: unknown })._id);
    if (id) touchedIds.push(id);
    await syncEntity('researchEntity', doc);
  }
  // Re-gated because a repair can change what the record is able to serve: a record
  // that loses the only description it had must stop claiming `student_ready` rather
  // than answer 404 on its own slug.
  if (touchedIds.length > 0) {
    const gate = await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: touchedIds,
    });
    summary.visibilityTierChanges = gate.counts.changed;
    for (const slug of touched) {
      const doc = await ResearchEntity.findOne({ slug }).lean();
      if (doc) await syncEntity('researchEntity', doc);
    }
  }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  // Resolved before the run, not after it: a full pass reads several hundred lab
  // sites, and rejecting the path at the end throws the whole report away.
  const safeOutput = args.output ? resolveSafeJsonReportOutputPath(args.output) : undefined;
  await initializeConnections();

  const candidates = (await loadForeignLabWebsiteCandidates(args.only)).slice(0, args.limit);
  console.log(`Reading ${candidates.length} lab sites for the lead each declares...`);
  const rows = await buildRetargetRows(candidates);
  const retargets = rows.filter((row) => row.decision === 'RETARGET');

  if (args.apply) {
    if (!args.confirm) {
      throw new Error('--confirm-retarget-foreign-lab-websites is required when --apply is set.');
    }
    if (retargets.length > args.maxApply) {
      throw new Error(
        `Apply would move ${retargets.length} websites, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const applied = args.apply
    ? await applyRetargetRows(rows)
    : {
        websitesMoved: 0,
        namesAdopted: 0,
        holderFieldsCleared: 0,
        observationsRetired: 0,
        visibilityTierChanges: 0,
        touchedSlugs: [],
      };

  const byDecision: Record<string, number> = {};
  for (const row of rows) {
    const key = row.refusalReason ? `REFUSE:${row.refusalReason}` : row.decision;
    byDecision[key] = (byDecision[key] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    candidates: candidates.length,
    byDecision,
    retargets: retargets.length,
    studentReadyHoldersAffected: retargets.filter(
      (row) => row.holderVisibilityTier === 'student_ready',
    ).length,
    ...applied,
    rows,
  };

  if (safeOutput) {
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(sanitizeLogValue(JSON.stringify({ ...report, rows: rows.slice(0, 40) }, null, 2)));
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
