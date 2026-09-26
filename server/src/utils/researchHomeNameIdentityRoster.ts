import { Researcher } from '../models/researcher';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
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
export async function loadResearchEntityLeadPersonName(researchEntityId: unknown): Promise<string> {
  const entityId = serializedDocumentId(researchEntityId);
  if (!entityId) return '';
  const lead = await RoleAssignment.findOne({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': entityId,
    role: { $in: RESEARCH_HOME_LEAD_ROLES },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('personId')
    .lean();
  const personId = serializedDocumentId((lead as { personId?: unknown } | null)?.personId);
  if (!personId) return '';
  const person = await Researcher.findById(personId).select('displayName').lean();
  return String((person as { displayName?: unknown } | null)?.displayName || '');
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
