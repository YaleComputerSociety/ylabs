/**
 * A durable refusal of one value at one field of one person record (#5641), the person
 * counterpart of the research-row refusal in `researchEntityFieldValueRefusals.ts`, whose
 * key, record shape, plan and withdrawal it reuses.
 *
 * It is consulted in three places, and each is a derivation that writes no lock:
 *   - the user materializer drops a refused value from the evidence of every identity that
 *     joins the person, before the resolver ranks it, so a rival still wins and a field left
 *     with no candidate resolves to nothing;
 *   - a refused email is not a join witness either, so an address refused as someone else's
 *     cannot glue two people together (owner decision 2026-11-11);
 *   - the stored value is cleared when the refusal is recorded and on every resolve, which is
 *     the only thing that reaches a person no identity resolves to.
 */
import {
  liveFieldValueRefusals,
  valueIsRefused,
  type FieldValueRefusal,
} from './researchEntityFieldValueRefusals';

export const RESEARCHER_REFUSABLE_FIELDS = [
  'websiteUrl',
  'title',
  'primaryDepartment',
  'imageUrl',
  'email',
  'profileLink',
] as const;

export type ResearcherRefusableField = (typeof RESEARCHER_REFUSABLE_FIELDS)[number];

export const isResearcherRefusableField = (field: string): field is ResearcherRefusableField =>
  (RESEARCHER_REFUSABLE_FIELDS as readonly string[]).includes(field);

const PROFILE_FIELDS: ReadonlySet<ResearcherRefusableField> = new Set([
  'websiteUrl',
  'title',
  'primaryDepartment',
  'imageUrl',
]);

const USER_OBSERVATION_REFUSAL_FIELD: Readonly<Record<string, ResearcherRefusableField>> = {
  websiteUrl: 'websiteUrl',
  website: 'websiteUrl',
  title: 'title',
  primaryDepartment: 'primaryDepartment',
  imageUrl: 'imageUrl',
  email: 'email',
};

export const PROFILE_URLS_OBSERVATION_FIELD = 'profileUrls';

export function researcherHasLiveRefusals(fieldValueRefusals: unknown): boolean {
  return RESEARCHER_REFUSABLE_FIELDS.some(
    (field) => liveFieldValueRefusals(fieldValueRefusals, field).length > 0,
  );
}

export function researcherRefusesValue(
  fieldValueRefusals: unknown,
  field: ResearcherRefusableField,
  value: unknown,
): boolean {
  return valueIsRefused(fieldValueRefusals, field, value);
}

const withoutRefusedProfileUrls = (value: unknown, fieldValueRefusals: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const kept = Object.entries(value as Record<string, unknown>).filter(
    ([, url]) => !valueIsRefused(fieldValueRefusals, 'profileLink', url),
  );
  return Object.fromEntries(kept);
};

export interface ResearcherRefusableObservation {
  field?: unknown;
  value?: unknown;
}

/** The person's user evidence with every value the person refuses dropped. */
export function withoutResearcherRefusedObservations<T extends ResearcherRefusableObservation>(
  observations: readonly T[],
  fieldValueRefusals: unknown,
): T[] {
  if (!researcherHasLiveRefusals(fieldValueRefusals)) return [...observations];
  const kept: T[] = [];
  for (const observation of observations) {
    const field = String(observation.field ?? '');
    if (field === PROFILE_URLS_OBSERVATION_FIELD) {
      kept.push({
        ...observation,
        value: withoutRefusedProfileUrls(observation.value, fieldValueRefusals),
      });
      continue;
    }
    const refusalField = USER_OBSERVATION_REFUSAL_FIELD[field];
    if (refusalField && valueIsRefused(fieldValueRefusals, refusalField, observation.value)) {
      continue;
    }
    kept.push(observation);
  }
  return kept;
}

export interface ResearcherStoredValues {
  identifiers?: { email?: unknown } | null;
  profile?: Record<string, unknown> | null;
  profileLinks?: Array<{ url?: unknown }> | null;
  fieldValueRefusals?: unknown;
}

export interface ResearcherRefusedStoredValueClear {
  unset: string[];
  profileLinkUrlsToPull: string[];
}

/** The stored paths a person's own refusals condemn, as `$unset` paths and link URLs to pull. */
export function planResearcherRefusedStoredValueClear(
  researcher: ResearcherStoredValues,
): ResearcherRefusedStoredValueClear {
  const refusals = researcher.fieldValueRefusals;
  const unset: string[] = [];
  const profileLinkUrlsToPull: string[] = [];
  if (!researcherHasLiveRefusals(refusals)) return { unset, profileLinkUrlsToPull };
  for (const field of PROFILE_FIELDS) {
    const stored = researcher.profile?.[field];
    if (stored && valueIsRefused(refusals, field, stored)) unset.push(`profile.${field}`);
  }
  const email = researcher.identifiers?.email;
  if (email && valueIsRefused(refusals, 'email', email)) unset.push('identifiers.email');
  for (const link of researcher.profileLinks ?? []) {
    if (link?.url && valueIsRefused(refusals, 'profileLink', link.url)) {
      profileLinkUrlsToPull.push(String(link.url));
    }
  }
  return { unset, profileLinkUrlsToPull };
}

/** The shell's live refusals the survivor does not already hold, per field, for a fold. */
export function refusalsToCopyOnFold(
  survivorRefusals: unknown,
  shellRefusals: unknown,
): Record<string, FieldValueRefusal[]> {
  const copies: Record<string, FieldValueRefusal[]> = {};
  for (const field of RESEARCHER_REFUSABLE_FIELDS) {
    const held = new Set(
      liveFieldValueRefusals(survivorRefusals, field).map((refusal) => refusal.valueKey),
    );
    const missing = liveFieldValueRefusals(shellRefusals, field).filter(
      (refusal) => !held.has(refusal.valueKey),
    );
    if (missing.length > 0) copies[field] = missing;
  }
  return copies;
}
