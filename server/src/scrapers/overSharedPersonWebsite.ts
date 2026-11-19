import { Observation } from '../models/observation';
import { websiteShareKey } from '../utils/websiteShareKey';

/**
 * A URL asserted as the own website of this many different people is nobody's own
 * website: it is page chrome the lane read once per profile (#5645, #2460).
 *
 * Measured on Development 2026-11-10 over live `user` `website`/`websiteUrl`
 * observations: lab sites top out at 20 people (17 for the largest lab roster), while
 * every value asserted for 26 or more is a page that is not a person's own: a donor
 * story for 687, a department research page for 292, a clinical service for 174, a lab-site
 * index, a department root, a course list, and a lab page linked from 62 profile
 * pages across two schools' site navigation. 50 sits well above the largest lab, so a
 * growing lab stays admissible.
 */
export const OVER_SHARED_PERSON_WEBSITE_MIN_SUBJECTS = 50;

const CACHE_TTL_MS = 10 * 60 * 1000;

const PERSON_WEBSITE_FIELDS = ['website', 'websiteUrl'] as const;

export interface PersonWebsiteObservationLike {
  value?: unknown;
  entityId?: unknown;
  entityKey?: unknown;
}

export const personWebsiteShareKey = websiteShareKey;

function subjectOf(observation: PersonWebsiteObservationLike): string | undefined {
  const subject = observation.entityId ?? observation.entityKey;
  return subject === undefined || subject === null || subject === '' ? undefined : String(subject);
}

export function overSharedPersonWebsiteKeys(
  observations: Iterable<PersonWebsiteObservationLike>,
  minSubjects: number = OVER_SHARED_PERSON_WEBSITE_MIN_SUBJECTS,
): Set<string> {
  const subjectsByKey = new Map<string, Set<string>>();
  for (const observation of observations) {
    const key = personWebsiteShareKey(observation.value);
    const subject = subjectOf(observation);
    if (!key || !subject) continue;
    const subjects = subjectsByKey.get(key) ?? new Set<string>();
    subjects.add(subject);
    subjectsByKey.set(key, subjects);
  }
  const overShared = new Set<string>();
  for (const [key, subjects] of subjectsByKey) {
    if (subjects.size >= minSubjects) overShared.add(key);
  }
  return overShared;
}

export async function readOverSharedPersonWebsiteKeys(): Promise<Set<string>> {
  const observations = await Observation.find(
    {
      entityType: 'user',
      field: { $in: [...PERSON_WEBSITE_FIELDS] },
      superseded: false,
      'rollback.rolledBackAt': { $exists: false },
    },
    { value: 1, entityId: 1, entityKey: 1 },
  ).lean<PersonWebsiteObservationLike[]>();
  return overSharedPersonWebsiteKeys(observations);
}

let cached: { keys: Promise<Set<string>>; expiresAt: number } | undefined;

export function overSharedPersonWebsiteKeysForMaterialization(
  now: number = Date.now(),
): Promise<Set<string>> {
  if (!cached || cached.expiresAt <= now) {
    const keys = readOverSharedPersonWebsiteKeys();
    cached = { keys, expiresAt: now + CACHE_TTL_MS };
    keys.catch(() => {
      if (cached?.keys === keys) cached = undefined;
    });
  }
  return cached.keys;
}

export function resetOverSharedPersonWebsiteKeysCache(): void {
  cached = undefined;
}

export function isOverSharedPersonWebsite(
  value: unknown,
  overSharedKeys: ReadonlySet<string>,
): boolean {
  const key = personWebsiteShareKey(value);
  return Boolean(key && overSharedKeys.has(key));
}

export function withoutOverSharedPersonWebsiteObservations<
  T extends PersonWebsiteObservationLike & { field?: unknown },
>(observations: readonly T[], overSharedKeys: ReadonlySet<string>): T[] {
  if (overSharedKeys.size === 0) return [...observations];
  return observations.filter(
    (observation) =>
      !(
        (observation.field === 'website' || observation.field === 'websiteUrl') &&
        isOverSharedPersonWebsite(observation.value, overSharedKeys)
      ),
  );
}
