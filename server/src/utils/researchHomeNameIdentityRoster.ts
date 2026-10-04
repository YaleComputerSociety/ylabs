import { Researcher } from '../models/researcher';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { serializedDocumentId } from './idSerialization';
import { personSurnamesFromDisplayNames } from './researchHomeNameIdentityAuthority';

const RESEARCH_HOME_LEAD_ROLES = LEAD_ROLE_CANONICAL_VALUES;

/**
 * How long a loaded roster stands before the next reader re-reads it. The roster
 * is the corpus's surname vocabulary, so a scrape sweep over thousands of records
 * would otherwise re-read every researcher once per record. This is an in-memory
 * read cache and never a stored judgement, so the #2351 hazard - a persisted
 * verdict that outlives its own retirement because nothing rewrites the document -
 * does not apply: nothing derived from it is written without being recomputed.
 */
const ROSTER_CACHE_TTL_MS = 10 * 60 * 1000;

let cachedRoster: { surnames: ReadonlySet<string>; loadedAt: number } | undefined;

/** Drops the cached roster so the next load re-reads the corpus. */
export function resetKnownPersonSurnameRosterCache(): void {
  cachedRoster = undefined;
}

/**
 * Every known researcher's surname, as the vocabulary the eponym check
 * corroborates against. Without it an eponymous name on a bare or generic URL
 * path carries no evidence that its eponym is a person at all, which is the
 * bare-eponymous-host shape a write chokepoint has to refuse (#2369).
 */
export async function loadKnownPersonSurnameRoster(): Promise<ReadonlySet<string>> {
  const now = Date.now();
  if (cachedRoster && now - cachedRoster.loadedAt < ROSTER_CACHE_TTL_MS) {
    return cachedRoster.surnames;
  }
  const people = await Researcher.find({ archived: { $ne: true } })
    .select('displayName')
    .lean();
  const surnames = personSurnamesFromDisplayNames(
    people.map((person) => (person as { displayName?: unknown }).displayName),
  );
  cachedRoster = { surnames, loadedAt: now };
  return surnames;
}

/**
 * The display name of the person a research entity's own lead role assignment
 * names, or empty when none resolves. This is the identity half the roster arm
 * needs: a roster says an eponym is somebody's surname, and only the lead says
 * whether that somebody is this record (#2369).
 */
export async function loadResearchEntityLeadPersonName(
  researchEntityId: unknown,
  prefetchedLeadPersonId?: string,
): Promise<string> {
  const personId = await loadResearchEntityLeadPersonId(researchEntityId, prefetchedLeadPersonId);
  if (!personId) return '';
  const person = await Researcher.findById(personId).select('displayName').lean();
  return String((person as { displayName?: unknown } | null)?.displayName || '');
}

/** The id of the person a research entity's own lead role assignment names, or empty. */
export async function loadResearchEntityLeadPersonId(
  researchEntityId: unknown,
  prefetchedLeadPersonId?: string,
): Promise<string> {
  const entityId = serializedDocumentId(researchEntityId);
  if (!entityId) return '';
  if (prefetchedLeadPersonId !== undefined) return prefetchedLeadPersonId;
  const assignment = (await RoleAssignment.findOne({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': entityId,
    role: { $in: RESEARCH_HOME_LEAD_ROLES },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('personId')
    .lean()) as { personId?: unknown } | null;
  return serializedDocumentId(assignment?.personId) || '';
}

/**
 * The person each research entity's own lead role assignments name, by entity id,
 * for a caller that reads many entities at once. An entity with more than one lead
 * assignment lists every assignment, so a caller that needs the single answer
 * `loadResearchEntityLeadPersonName` would give can tell when it cannot know it.
 */
export async function loadResearchEntityLeadPersonIds(
  researchEntityIds: readonly string[],
): Promise<Map<string, string[]>> {
  const personIdsByEntityId = new Map<string, string[]>(
    researchEntityIds.map((entityId) => [entityId, []]),
  );
  if (researchEntityIds.length === 0) return personIdsByEntityId;
  const assignments = await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: [...researchEntityIds] },
    role: { $in: RESEARCH_HOME_LEAD_ROLES },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('target.id personId')
    .lean();
  for (const assignment of assignments as Array<{
    target?: { id?: unknown };
    personId?: unknown;
  }>) {
    const entityId = serializedDocumentId(assignment.target?.id);
    const bucket = entityId ? personIdsByEntityId.get(entityId) : undefined;
    if (bucket) bucket.push(serializedDocumentId(assignment.personId) || '');
  }
  return personIdsByEntityId;
}

/**
 * Lead display names for every research entity that has one, keyed by entity id,
 * for a batch caller that judges many records in one pass and must not pay a
 * lookup per record.
 */
export async function loadResearchEntityLeadPersonNames(): Promise<Map<string, string>> {
  const assignments = await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: RESEARCH_HOME_LEAD_ROLES },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('target.id personId')
    .lean();
  const personIds = new Set<string>();
  for (const assignment of assignments as Array<{ personId?: unknown }>) {
    const personId = serializedDocumentId(assignment.personId);
    if (personId) personIds.add(personId);
  }
  const displayNameByPersonId = new Map<string, string>();
  for (const person of await Researcher.find({ _id: { $in: Array.from(personIds) } })
    .select('displayName')
    .lean()) {
    const personId = serializedDocumentId((person as { _id?: unknown })._id);
    if (personId) {
      displayNameByPersonId.set(
        personId,
        String((person as { displayName?: unknown }).displayName || ''),
      );
    }
  }
  const leadNameByEntityId = new Map<string, string>();
  for (const assignment of assignments as Array<{
    target?: { id?: unknown };
    personId?: unknown;
  }>) {
    const entityId = serializedDocumentId(assignment.target?.id);
    const personId = serializedDocumentId(assignment.personId);
    if (!entityId || !personId || leadNameByEntityId.has(entityId)) continue;
    const displayName = displayNameByPersonId.get(personId);
    if (displayName) leadNameByEntityId.set(entityId, displayName);
  }
  return leadNameByEntityId;
}

/**
 * Every live `LAB` row's leads, name and lab-named URL segments, for the derivation
 * that retypes a faculty research row as its lead's lab: it must know whether the lead
 * already has a lab row, whether "<surname> Lab" is another person's name, and whether
 * the lab site it cites is another person's. Cached on the same terms as the surname
 * roster: a read cache, never a stored judgement.
 */
export interface LabRowRoster {
  labIdsByLeadPersonId: ReadonlyMap<string, ReadonlySet<string>>;
  leadPersonIdsByLabName: ReadonlyMap<string, ReadonlySet<string>>;
  leadPersonIdsByLabUrlToken: ReadonlyMap<string, ReadonlySet<string>>;
}

let cachedLabRowRoster: { roster: LabRowRoster; loadedAt: number } | undefined;

export function resetLabRowRosterCache(): void {
  cachedLabRowRoster = undefined;
}

export function normalizedLabRowName(name: unknown): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function labRowUrlTokens(value: unknown): string[] {
  try {
    const url = new URL(String(value || ''));
    return [...url.hostname.split('.'), ...url.pathname.split('/')]
      .map((part) => part.toLowerCase().replace(/[^\p{L}]/gu, ''))
      .filter((part) => /lab(?:oratory|s)?/.test(part) && part.length > 4);
  } catch {
    return [];
  }
}

const addTo = (map: Map<string, Set<string>>, key: string, value: string) => {
  if (!key) return;
  const bucket = map.get(key) ?? new Set<string>();
  bucket.add(value);
  map.set(key, bucket);
};

export async function loadLabRowRoster(): Promise<LabRowRoster> {
  const now = Date.now();
  if (cachedLabRowRoster && now - cachedLabRowRoster.loadedAt < ROSTER_CACHE_TTL_MS) {
    return cachedLabRowRoster.roster;
  }
  const labs = (await ResearchEntity.find({ entityType: 'LAB', archived: { $ne: true } })
    .select('_id name websiteUrl website sourceUrls')
    .lean()) as Array<Record<string, any>>;
  const leadsByLabId = await loadResearchEntityLeadPersonIds(
    labs.map((lab) => serializedDocumentId(lab._id)).filter(Boolean) as string[],
  );
  const labIdsByLeadPersonId = new Map<string, Set<string>>();
  const leadPersonIdsByLabName = new Map<string, Set<string>>();
  const leadPersonIdsByLabUrlToken = new Map<string, Set<string>>();
  for (const lab of labs) {
    const labId = serializedDocumentId(lab._id) || '';
    const leads = leadsByLabId.get(labId)?.filter(Boolean) ?? [];
    const owners = leads.length ? leads : [''];
    const tokens = [
      lab.websiteUrl,
      lab.website,
      ...(Array.isArray(lab.sourceUrls) ? lab.sourceUrls : []),
    ].flatMap(labRowUrlTokens);
    for (const owner of owners) {
      if (owner) addTo(labIdsByLeadPersonId, owner, labId);
      addTo(leadPersonIdsByLabName, normalizedLabRowName(lab.name), owner);
      for (const token of tokens) addTo(leadPersonIdsByLabUrlToken, token, owner);
    }
  }
  const roster = { labIdsByLeadPersonId, leadPersonIdsByLabName, leadPersonIdsByLabUrlToken };
  cachedLabRowRoster = { roster, loadedAt: now };
  return roster;
}
