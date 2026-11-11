import mongoose from 'mongoose';
import { Researcher } from '../../models/researcher';
import { recordedGrantInvestigators, type ProvablyNotALead } from './grantInvestigators';

export interface GrantPersonIdentity {
  id: string;
  displayName?: string;
  netid?: string;
  dedupedIntoResearcherId?: string;
  distinctFromResearcherIds?: string[];
}

const NAME_SUFFIX_TOKENS = new Set([
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'phd',
  'md',
  'mph',
  'mba',
  'msc',
  'ms',
  'dds',
  'dmd',
  'dvm',
  'pharmd',
  'rn',
  'np',
  'facs',
  'facp',
]);

const normalizedNameTokens = (name: unknown): string[] =>
  typeof name === 'string'
    ? name
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\./g, '')
        .replace(/[^\p{L}\s'-]/gu, ' ')
        .split(/\s+/)
        .filter((token) => token && !NAME_SUFFIX_TOKENS.has(token))
    : [];

const givenTokensCompatible = (left: string, right: string): boolean => {
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length === 1) return longer.startsWith(shorter);
  return shorter.length >= 3 && longer.startsWith(shorter);
};

const givenNamesBefore = (tokens: readonly string[], surname: string): string[] => {
  const at = tokens.lastIndexOf(surname);
  return at > 0 ? tokens.slice(0, at) : [];
};

const givenNamesShareAToken = (left: readonly string[], right: readonly string[]): boolean =>
  left.some((token) => right.some((other) => givenTokensCompatible(token, other)));

export function namesCouldBeOnePerson(left: unknown, right: unknown): boolean {
  const a = normalizedNameTokens(left);
  const b = normalizedNameTokens(right);
  if (a.length < 2 || b.length < 2) return true;
  const surnameA = a[a.length - 1];
  const surnameB = b[b.length - 1];
  return (
    givenNamesShareAToken(a.slice(0, -1), givenNamesBefore(b, surnameA)) ||
    givenNamesShareAToken(givenNamesBefore(a, surnameB), b.slice(0, -1))
  );
}

const linked = (one: GrantPersonIdentity, other: GrantPersonIdentity): boolean =>
  one.dedupedIntoResearcherId === other.id ||
  other.dedupedIntoResearcherId === one.id ||
  (one.distinctFromResearcherIds ?? []).includes(other.id) ||
  (other.distinctFromResearcherIds ?? []).includes(one.id);

export function investigatorIsProvablyNotALead(
  investigator: Record<string, unknown>,
  leads: readonly GrantPersonIdentity[],
  listed: ReadonlyMap<string, GrantPersonIdentity>,
): boolean {
  const researcherId =
    typeof investigator.researcherId === 'string' ? investigator.researcherId : '';
  // A name alone never proves someone else: an investigator the lane credited to no
  // researcher has no netid to compare, so the award stays held (#5779).
  if (!researcherId) return false;
  const person = listed.get(researcherId);
  if (!person?.netid) return false;
  return leads.every(
    (lead) =>
      !!lead.netid &&
      lead.netid !== person.netid &&
      !linked(lead, person) &&
      !namesCouldBeOnePerson(lead.displayName, person.displayName) &&
      (typeof investigator.name !== 'string' ||
        !namesCouldBeOnePerson(lead.displayName, investigator.name)),
  );
}

const idText = (value: unknown): string | undefined =>
  value === undefined || value === null ? undefined : String(value);

export async function loadGrantPersonIdentities(
  researcherIds: readonly string[],
): Promise<Map<string, GrantPersonIdentity>> {
  const ids = [...new Set(researcherIds)].filter((id) => mongoose.isValidObjectId(id));
  if (ids.length === 0) return new Map();
  const docs = (await Researcher.find({ _id: { $in: ids } })
    .select('displayName netid identifiers.netid dedupedIntoResearcherId distinctFromResearcherIds')
    .lean()) as Array<Record<string, any>>;
  return new Map(
    docs.map((doc) => {
      const id = String(doc._id);
      const netid = doc.identifiers?.netid || doc.netid;
      return [
        id,
        {
          id,
          displayName: doc.displayName,
          ...(typeof netid === 'string' && netid.trim()
            ? { netid: netid.trim().toLowerCase() }
            : {}),
          ...(doc.dedupedIntoResearcherId
            ? { dedupedIntoResearcherId: idText(doc.dedupedIntoResearcherId) }
            : {}),
          ...(Array.isArray(doc.distinctFromResearcherIds)
            ? { distinctFromResearcherIds: doc.distinctFromResearcherIds.map(String) }
            : {}),
        },
      ];
    }),
  );
}

export function investigatorResearcherIdsOf(
  observations: readonly { value?: unknown }[],
): string[] {
  const ids: string[] = [];
  for (const observation of observations) {
    if (!Array.isArray(observation.value)) continue;
    for (const entry of observation.value) {
      for (const investigator of recordedGrantInvestigators(entry) ?? []) {
        const id = (investigator as { researcherId?: unknown })?.researcherId;
        if (typeof id === 'string' && id) ids.push(id);
      }
    }
  }
  return ids;
}

export async function loadProvablyNotALead(
  leadPersonIds: ReadonlySet<string>,
  observations: readonly { field?: unknown; value?: unknown }[],
): Promise<ProvablyNotALead> {
  const grantObservations = observations.filter(
    (observation) =>
      observation.field === 'recentGrants' || observation.field === 'recentGrantPeriods',
  );
  const identities = await loadGrantPersonIdentities([
    ...leadPersonIds,
    ...investigatorResearcherIdsOf(grantObservations),
  ]);
  const leads = [...leadPersonIds].map(
    (id) => identities.get(id) ?? ({ id } as GrantPersonIdentity),
  );
  return (investigator) => investigatorIsProvablyNotALead(investigator, leads, identities);
}
