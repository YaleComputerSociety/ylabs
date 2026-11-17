import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import { profileImagePictureKey } from '../scripts/profileImageQualityAuditCore';
import { slugify } from './utils/scraperHelpers';

/**
 * A picture one source asserts as the portrait of this many different people is nobody's
 * portrait: it is a site default the lane read once per profile (#6043).
 *
 * A read-only Development measurement on 2026-11-12 found 33 image URLs each stored on 3 or
 * more researchers, 201 researchers in all, read as site defaults. Subjects are counted
 * within one source, because each lane can key one person differently, so a count across
 * sources would read one person seen by three lanes as three people. A department roster
 * keys a person without a personal email per roster (`dept:<roster>:<name>`), so those keys
 * are counted by name: one cross-listed person read off three rosters is one person.
 */
export const OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS = 3;

const CACHE_TTL_MS = 10 * 60 * 1000;

export interface PersonImageObservationLike {
  value?: unknown;
  entityId?: unknown;
  entityKey?: unknown;
  sourceName?: unknown;
}

export const personImageShareKey = (value: unknown): string | undefined =>
  (typeof value === 'string' && profileImagePictureKey(value)) || undefined;

const PER_ROSTER_NAME_KEY = /^dept:.*:([^:]+)$/;

function subjectOf(observation: PersonImageObservationLike): string | undefined {
  const subject = observation.entityId ?? observation.entityKey;
  if (subject === undefined || subject === null || subject === '') return undefined;
  const rosterName = PER_ROSTER_NAME_KEY.exec(String(subject))?.[1];
  return rosterName ? `dept-name:${rosterName}` : String(subject);
}

export function overSharedPersonImageKeys(
  observations: Iterable<PersonImageObservationLike>,
  minSubjects: number = OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS,
): Set<string> {
  const subjectsBySourceAndKey = new Map<string, { key: string; subjects: Set<string> }>();
  for (const observation of observations) {
    const key = personImageShareKey(observation.value);
    const subject = subjectOf(observation);
    if (!key || !subject) continue;
    const bucketKey = `${String(observation.sourceName ?? '')}\u0000${key}`;
    const bucket = subjectsBySourceAndKey.get(bucketKey) ?? { key, subjects: new Set<string>() };
    bucket.subjects.add(subject);
    subjectsBySourceAndKey.set(bucketKey, bucket);
  }
  const overShared = new Set<string>();
  for (const { key, subjects } of subjectsBySourceAndKey.values()) {
    if (subjects.size >= minSubjects) overShared.add(key);
  }
  return overShared;
}

export interface StoredPersonImageHolderLike {
  _id?: unknown;
  displayName?: unknown;
  identifiers?: { netid?: unknown } | null;
  profile?: { imageUrl?: unknown } | null;
}

interface ImageHolderIdentity {
  identity: string;
  name: string;
  netid?: string;
}

const lowerNetid = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function storedHolderIdentity(
  holder: StoredPersonImageHolderLike,
): ImageHolderIdentity | undefined {
  const netid = lowerNetid(holder.identifiers?.netid);
  const name = String(holder.displayName ?? '').trim();
  if (netid) return { identity: `netid:${netid}`, name, netid };
  return holder._id === undefined || holder._id === null
    ? undefined
    : { identity: `id:${String(holder._id)}`, name };
}

const NETID_SUBJECT_KEY = /^netid:(.+)$/;

const isEmailAliasPayload = (payload: string): boolean => payload.includes('.');

export type EmailAliasNetids = ReadonlyMap<string, string>;

/**
 * The researcher identity an observation's key names: a netid key names that netid, and a
 * per-roster key names the one researcher whose display name has that slug, if only one does.
 * A `netid:` key whose payload is an email alias proves no netid (#2831), so it names a netid
 * only where the directory alias map resolves it, and otherwise stands for nobody already counted.
 */
function observationIdentityResolver(
  researchers: Iterable<StoredPersonImageHolderLike>,
  aliasNetids: EmailAliasNetids,
): (observation: PersonImageObservationLike) => ImageHolderIdentity | undefined {
  const identityByNameSlug = new Map<string, ImageHolderIdentity | null>();
  const nameByNetid = new Map<string, string>();
  for (const researcher of researchers) {
    const identity = storedHolderIdentity(researcher);
    if (!identity) continue;
    if (identity.netid) nameByNetid.set(identity.netid, identity.name);
    const slug = slugify(identity.name);
    if (!slug) continue;
    const known = identityByNameSlug.get(slug);
    identityByNameSlug.set(
      slug,
      known === undefined || known?.identity === identity.identity ? identity : null,
    );
  }
  const netidIdentity = (netid: string): ImageHolderIdentity => ({
    identity: `netid:${netid}`,
    name: nameByNetid.get(netid) ?? '',
    netid,
  });
  return (observation) => {
    const key = String(observation.entityKey ?? '');
    const payload = lowerNetid(NETID_SUBJECT_KEY.exec(key)?.[1]);
    if (payload) {
      if (nameByNetid.has(payload) || !isEmailAliasPayload(payload)) return netidIdentity(payload);
      const aliasNetid = lowerNetid(aliasNetids.get(payload));
      return aliasNetid ? netidIdentity(aliasNetid) : { identity: `alias:${payload}`, name: '' };
    }
    const rosterName = PER_ROSTER_NAME_KEY.exec(key)?.[1];
    return (rosterName && identityByNameSlug.get(rosterName)) || undefined;
  };
}

const exactFullName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function provablyOnePerson(left: ImageHolderIdentity, right: ImageHolderIdentity): boolean {
  if (left.netid && right.netid) return left.netid === right.netid;
  const leftName = exactFullName(left.name);
  return Boolean(leftName) && leftName === exactFullName(right.name);
}

/**
 * How many people hold a picture (#6284). Undercounting would serve a site default, so holders
 * merge only on proof: a shared netid, or the same full name where one of them has no netid.
 * Two holders with different netids are always two people.
 */
export function distinctPeopleAmongHolders(holders: Iterable<ImageHolderIdentity>): number {
  const byIdentity = new Map<string, ImageHolderIdentity>();
  for (const holder of holders) {
    const known = byIdentity.get(holder.identity);
    byIdentity.set(holder.identity, known && known.name ? known : holder);
  }
  const people: ImageHolderIdentity[][] = [];
  for (const holder of byIdentity.values()) {
    const matches = people.filter((person) =>
      person.some((member) => provablyOnePerson(member, holder)),
    );
    const merged = [holder, ...matches.flat()];
    const distinctNetids = new Set(merged.map((member) => member.netid).filter(Boolean));
    if (distinctNetids.size > 1) {
      people.push([holder]);
      continue;
    }
    for (const match of matches) people.splice(people.indexOf(match), 1);
    people.push(merged);
  }
  return people.length;
}

function holdersByPicture(
  researchers: readonly StoredPersonImageHolderLike[],
  observations: Iterable<PersonImageObservationLike>,
  aliasNetids: EmailAliasNetids,
): Map<string, ImageHolderIdentity[]> {
  const observationIdentity = observationIdentityResolver(researchers, aliasNetids);
  const holdersByKey = new Map<string, ImageHolderIdentity[]>();
  const count = (value: unknown, identity: ImageHolderIdentity | undefined) => {
    const key = personImageShareKey(value);
    if (!key || !identity) return;
    holdersByKey.set(key, [...(holdersByKey.get(key) ?? []), identity]);
  };
  for (const researcher of researchers) {
    count(researcher.profile?.imageUrl, storedHolderIdentity(researcher));
  }
  for (const observation of observations) {
    count(observation.value, observationIdentity(observation));
  }
  return holdersByKey;
}

/**
 * The email-alias payloads worth resolving: those on a picture whose holders reach the bar
 * before any merge, since only there can a resolved alias change the count.
 */
export function emailAliasPayloadsOnCandidatePictures(
  researchers: readonly StoredPersonImageHolderLike[],
  observations: readonly PersonImageObservationLike[],
  minHolders: number = OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS,
): string[] {
  const payloads = new Set<string>();
  for (const holders of holdersByPicture(researchers, observations, new Map()).values()) {
    if (new Set(holders.map((holder) => holder.identity)).size < minHolders) continue;
    for (const holder of holders) {
      if (holder.identity.startsWith('alias:'))
        payloads.add(holder.identity.slice('alias:'.length));
    }
  }
  return [...payloads].sort();
}

/**
 * A picture stored on this many researchers with different identities is a default whatever
 * lane wrote it, including a stored value no live observation still asserts (#6043). A live
 * observation counts the researcher its key names too, so clearing the stored copies does not
 * drop a picture below the bar while that evidence would write it back on the next resolve.
 */
export function overSharedStoredPersonImageKeys(
  researchers: readonly StoredPersonImageHolderLike[],
  observations: Iterable<PersonImageObservationLike> = [],
  minHolders: number = OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS,
  aliasNetids: EmailAliasNetids = new Map(),
): Set<string> {
  const overShared = new Set<string>();
  for (const [key, holders] of holdersByPicture(researchers, observations, aliasNetids)) {
    if (distinctPeopleAmongHolders(holders) >= minHolders) overShared.add(key);
  }
  return overShared;
}

const ALIAS_RESOLVE_BATCH = 16;

async function resolveEmailAliasNetids(payloads: readonly string[]): Promise<EmailAliasNetids> {
  if (payloads.length === 0) return new Map();
  const { netidForRosterEmailAlias } = await import('./entityMaterializer');
  const resolved = new Map<string, string>();
  for (let start = 0; start < payloads.length; start += ALIAS_RESOLVE_BATCH) {
    const batch = payloads.slice(start, start + ALIAS_RESOLVE_BATCH);
    const netids = await Promise.all(batch.map((payload) => netidForRosterEmailAlias(payload)));
    batch.forEach((payload, index) => {
      const netid = netids[index];
      if (netid) resolved.set(payload, netid);
    });
  }
  return resolved;
}

export async function readOverSharedPersonImageKeys(): Promise<Set<string>> {
  const [observations, researchers] = await Promise.all([
    Observation.find(
      {
        entityType: 'user',
        field: 'imageUrl',
        superseded: false,
        'rollback.rolledBackAt': { $exists: false },
      },
      { value: 1, entityId: 1, entityKey: 1, sourceName: 1 },
    ).lean<PersonImageObservationLike[]>(),
    Researcher.find(
      { archived: { $ne: true } },
      { displayName: 1, 'profile.imageUrl': 1, 'identifiers.netid': 1 },
    ).lean<StoredPersonImageHolderLike[]>(),
  ]);
  const aliasNetids = await resolveEmailAliasNetids(
    emailAliasPayloadsOnCandidatePictures(researchers, observations),
  );
  return new Set([
    ...overSharedPersonImageKeys(observations),
    ...overSharedStoredPersonImageKeys(
      researchers,
      observations,
      OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS,
      aliasNetids,
    ),
  ]);
}

/**
 * Keys only accumulate between resets: clearing a stored default lowers its holder count, so
 * a fresh read mid-run would stop refusing it for the holders the run has not reached yet.
 */
let cached: { keys: Promise<Set<string>>; expiresAt: number } | undefined;
let knownKeys = new Set<string>();

export function overSharedPersonImageKeysForMaterialization(
  now: number = Date.now(),
): Promise<Set<string>> {
  if (!cached || cached.expiresAt <= now) {
    const keys = readOverSharedPersonImageKeys().then((fresh) => {
      knownKeys = new Set([...knownKeys, ...fresh]);
      return knownKeys;
    });
    cached = { keys, expiresAt: now + CACHE_TTL_MS };
    keys.catch(() => {
      if (cached?.keys === keys) cached = undefined;
    });
  }
  return cached.keys;
}

export function resetOverSharedPersonImageKeysCache(): void {
  cached = undefined;
  knownKeys = new Set<string>();
}

export function isOverSharedPersonImage(
  value: unknown,
  overSharedKeys: ReadonlySet<string>,
): boolean {
  const key = personImageShareKey(value);
  return Boolean(key && overSharedKeys.has(key));
}

export function withoutOverSharedPersonImageObservations<
  T extends PersonImageObservationLike & { field?: unknown },
>(observations: readonly T[], overSharedKeys: ReadonlySet<string>): T[] {
  if (overSharedKeys.size === 0) return [...observations];
  return observations.filter(
    (observation) =>
      !(
        observation.field === 'imageUrl' &&
        isOverSharedPersonImage(observation.value, overSharedKeys)
      ),
  );
}
