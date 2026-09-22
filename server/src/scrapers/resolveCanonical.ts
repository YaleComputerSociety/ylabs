import { type CanonicalType } from '../models/canonicalAlias';
import {
  normalizeWebsiteUrlIdentityKey,
  specificProfileLabUrlIdentityKey,
  normalizeOrgDedupeName,
  entitiesShareLeadPersonName,
  clusterHasConflictingLeadFirstNames,
} from '../scripts/researchEntityPiDedupeCore';
import {
  emailLooksPersonSpecific,
  samePersonNameVariant,
} from '../scripts/dedupeUsersByIdentityCore';

export type KeyStrength = 'unique' | 'strong' | 'weak';

export interface CanonicalKey {
  ns: string;
  value: string;
  strength: KeyStrength;
}

export interface ObservationLike {
  field: string;
  value: unknown;
}

export interface CandidateEntity {
  id: string;
  name?: string;
  fname?: string;
  lname?: string;
  tier?: string;
}

export type CanonicalResolution =
  | { status: 'existing'; canonicalId: string; matchedKey: CanonicalKey }
  | { status: 'mint'; reservedKeys: CanonicalKey[] }
  | { status: 'ambiguous'; candidates: string[]; blockingKey: CanonicalKey }
  | { status: 'blocked'; reason: string };

export interface ResolveCanonicalDeps {
  resolveAlias: (type: CanonicalType, ns: string, value: string) => Promise<string | null>;
  findCandidatesByKey: (type: CanonicalType, key: CanonicalKey) => Promise<CandidateEntity[]>;
}

export interface ResolveCanonicalInput {
  type: CanonicalType;
  keys: CanonicalKey[];
  self?: CandidateEntity;
}

const STRENGTH_ORDER: Record<KeyStrength, number> = { unique: 0, strong: 1, weak: 2 };

const TIER_RANK: Record<string, number> = {
  student_ready: 3,
  limited_but_safe: 2,
  operator_review: 1,
  suppressed: 0,
};

function tierRank(tier?: string): number {
  return tier && tier in TIER_RANK ? TIER_RANK[tier] : -1;
}

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

function observationMap(observations: ObservationLike[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const obs of observations) {
    const value = asString(obs.value);
    if (value) map.set(obs.field, value);
  }
  return map;
}

function normalizedNameFrom(map: Map<string, string>): string {
  const fname = map.get('fname') ?? '';
  const lname = map.get('lname') ?? '';
  const composed = `${fname} ${lname}`.replace(/\s+/g, ' ').trim();
  if (composed) return composed.toLowerCase();
  return (map.get('name') ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function pushKey(keys: CanonicalKey[], ns: string, value: string, strength: KeyStrength): void {
  const trimmed = value.trim();
  if (trimmed) keys.push({ ns, value: trimmed, strength });
}

export function deriveCanonicalKeys(
  type: CanonicalType,
  observations: ObservationLike[],
): CanonicalKey[] {
  const map = observationMap(observations);
  const keys: CanonicalKey[] = [];

  if (type === 'researcher') {
    pushKey(keys, 'netid', map.get('netid') ?? '', 'unique');
    pushKey(keys, 'orcid', map.get('orcid') ?? '', 'unique');
    const email = (map.get('email') ?? '').toLowerCase();
    const normalizedName = normalizedNameFrom(map);
    if (email && normalizedName && emailLooksPersonSpecific(email, normalizedName)) {
      pushKey(keys, 'email', email, 'strong');
    }
  } else if (type === 'researchEntity') {
    pushKey(keys, 'slug', map.get('slug') ?? '', 'unique');
    pushKey(keys, 'website-url', normalizeWebsiteUrlIdentityKey(map.get('websiteUrl')), 'strong');
    const profileKey =
      specificProfileLabUrlIdentityKey(map.get('websiteUrl')) ||
      specificProfileLabUrlIdentityKey(map.get('sourceUrl'));
    pushKey(keys, 'profile-lab-url', profileKey, 'strong');
    pushKey(keys, 'org-name', normalizeOrgDedupeName(map.get('name')), 'weak');
  } else if (type === 'fellowship') {
    pushKey(keys, 'source-key', map.get('sourceKey') ?? '', 'unique');
    pushKey(keys, 'source-url', map.get('sourceUrl') ?? '', 'strong');
    pushKey(keys, 'application-link', map.get('applicationLink') ?? '', 'strong');
    pushKey(
      keys,
      'title',
      (map.get('title') ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
      'weak',
    );
  }

  const seen = new Set<string>();
  return keys.filter((key) => {
    const id = `${key.ns}:${key.value}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function shareLead(a: string, b: string): boolean {
  return entitiesShareLeadPersonName(
    { name: a } as unknown as Parameters<typeof entitiesShareLeadPersonName>[0],
    { name: b } as unknown as Parameters<typeof entitiesShareLeadPersonName>[1],
  );
}

function conflictingFirstNames(a: string, b: string): boolean {
  return clusterHasConflictingLeadFirstNames([{ name: a }, { name: b }] as unknown as Parameters<
    typeof clusterHasConflictingLeadFirstNames
  >[0]);
}

function nameGuardVetoes(self: CandidateEntity | undefined, candidate: CandidateEntity): boolean {
  const a = self?.name ?? '';
  const b = candidate.name ?? '';
  if (!a || !b) return false;
  if (conflictingFirstNames(a, b)) return true;
  return false;
}

/**
 * The comparable person name for the identity veto. `fname`/`lname` are legacy
 * `User` fields that the canonical `Researcher` model does not carry (measured
 * 2026-09-22: 0 of 9,068 rows hold either, 9,068 hold `displayName`), so a
 * person veto that reads only those two fields can never compare anything.
 * `name` is the field every producer populates, so it is the authority and the
 * split parts are the fallback rather than the other way round.
 */
function personNameParts(
  entity: CandidateEntity | undefined,
): { fname: string; lname: string } | undefined {
  if (!entity) return undefined;
  const fname = (entity.fname ?? '').trim();
  const lname = (entity.lname ?? '').trim();
  if (fname && lname) return { fname, lname };
  const tokens = (entity.name ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return undefined;
  return { fname: tokens.slice(0, -1).join(' '), lname: tokens[tokens.length - 1] };
}

/**
 * Fails closed: a person merge it cannot evaluate is refused, not allowed. The
 * veto exists to stop two different people becoming one canonical record
 * (#562, #579), and every input a caller can actually supply left the previous
 * four-way `&&` unsatisfied, so the veto returned false for all of them.
 */
function personGuardVetoes(self: CandidateEntity | undefined, candidate: CandidateEntity): boolean {
  const a = personNameParts(self);
  const b = personNameParts(candidate);
  if (!a || !b) return true;
  return !samePersonNameVariant(a, b);
}

function wouldDemote(self: CandidateEntity | undefined, candidate: CandidateEntity): boolean {
  if (!self?.tier) return false;
  return tierRank(self.tier) > tierRank(candidate.tier);
}

export async function resolveCanonical(
  input: ResolveCanonicalInput,
  deps: ResolveCanonicalDeps,
): Promise<CanonicalResolution> {
  const orderedKeys = [...input.keys].sort(
    (a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength],
  );
  const reservedKeys = orderedKeys.filter((key) => key.strength !== 'weak');

  for (const key of orderedKeys) {
    // Any reserved (non-weak) key can carry a durable canonical-alias from a prior
    // confirmed resolution/merge; an alias hit is authoritative, so it resolves
    // before the live candidate lookup and without re-applying guards. Weak keys
    // are never reserved as aliases, so they skip the ledger.
    if (key.strength !== 'weak') {
      const aliasId = await deps.resolveAlias(input.type, key.ns, key.value);
      if (aliasId) return { status: 'existing', canonicalId: aliasId, matchedKey: key };
    }

    if (key.strength === 'unique') {
      const candidates = await deps.findCandidatesByKey(input.type, key);
      if (candidates.length === 1) {
        if (wouldDemote(input.self, candidates[0])) continue;
        return { status: 'existing', canonicalId: candidates[0].id, matchedKey: key };
      }
      if (candidates.length > 1) {
        return { status: 'ambiguous', candidates: candidates.map((c) => c.id), blockingKey: key };
      }
      continue;
    }

    const candidates = await deps.findCandidatesByKey(input.type, key);
    if (candidates.length === 0) continue;
    if (candidates.length > 1) {
      return { status: 'ambiguous', candidates: candidates.map((c) => c.id), blockingKey: key };
    }
    const candidate = candidates[0];

    const isPersonType = input.type === 'researcher';
    const vetoed = isPersonType
      ? personGuardVetoes(input.self, candidate)
      : nameGuardVetoes(input.self, candidate);
    if (vetoed) {
      return { status: 'ambiguous', candidates: [candidate.id], blockingKey: key };
    }
    if (key.strength === 'weak') {
      const selfName = input.self?.name ?? '';
      const candidateName = candidate.name ?? '';
      const corroborated =
        input.type === 'researchEntity' &&
        Boolean(selfName) &&
        Boolean(candidateName) &&
        shareLead(selfName, candidateName);
      if (!corroborated) continue;
    }
    if (wouldDemote(input.self, candidate)) continue;
    return { status: 'existing', canonicalId: candidate.id, matchedKey: key };
  }

  return { status: 'mint', reservedKeys };
}
