import { Observation } from '../models/observation';
import { profileImagePictureKey } from '../scripts/profileImageQualityAuditCore';

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

export async function readOverSharedPersonImageKeys(): Promise<Set<string>> {
  const observations = await Observation.find(
    {
      entityType: 'user',
      field: 'imageUrl',
      superseded: false,
      'rollback.rolledBackAt': { $exists: false },
    },
    { value: 1, entityId: 1, entityKey: 1, sourceName: 1 },
  ).lean<PersonImageObservationLike[]>();
  return overSharedPersonImageKeys(observations);
}

let cached: { keys: Promise<Set<string>>; expiresAt: number } | undefined;

export function overSharedPersonImageKeysForMaterialization(
  now: number = Date.now(),
): Promise<Set<string>> {
  if (!cached || cached.expiresAt <= now) {
    const keys = readOverSharedPersonImageKeys();
    cached = { keys, expiresAt: now + CACHE_TTL_MS };
    keys.catch(() => {
      if (cached?.keys === keys) cached = undefined;
    });
  }
  return cached.keys;
}

export function resetOverSharedPersonImageKeysCache(): void {
  cached = undefined;
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
