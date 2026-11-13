import { OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME } from '../models/fieldProvenanceBacking';
import {
  getOrgUnitCanonicalizer,
  orgUnitMatchKey,
  schoolNameFromProfileHosts,
} from './orgUnitCanonicalization';

export { OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME };

const SCHOOL_FIELD = 'school';

/**
 * Below every first-hand lane, so a reading the person's own profile states about their school
 * always outranks the host inference it stands in for.
 */
export const OWN_PROFILE_HOST_SCHOOL_CONFIDENCE = 0.6;

export interface SchoolPrecedenceObservation {
  field?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
  observedAt?: unknown;
}

export interface OwnProfileSchoolCandidate {
  field: typeof SCHOOL_FIELD;
  value: string;
  sourceName: typeof OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME;
  sourceUrl: string;
  confidence: number;
  observedAt: Date;
}

export interface OwnProfileSchoolPrecedence<T> {
  observations: T[];
  dropped: T[];
  candidate?: OwnProfileSchoolCandidate;
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const hostOf = (value: unknown): string => {
  try {
    return new URL(textOf(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const siteSchoolOf = (url: unknown): string => schoolNameFromProfileHosts([textOf(url)]) ?? '';

const observedAtMs = (observation: SchoolPrecedenceObservation): number =>
  new Date(observation.observedAt as string | number | Date).getTime() || 0;

// Pinned to evidence rather than the clock, so an unchanged row re-derives the same provenance
// and the projection's no-op check converges instead of rewriting the row on every pass.
function newestObservedAt(observations: readonly SchoolPrecedenceObservation[]): Date {
  return new Date(Math.max(0, ...observations.map(observedAtMs)));
}

const schoolKey = (
  value: unknown,
  canonicalizeSchool: (raw: unknown) => { value: string },
): string => orgUnitMatchKey(canonicalizeSchool(textOf(value)).value || textOf(value));

/**
 * The person's own profile outranks a roster from another school's site on `school` (#6157).
 *
 * A department roster states the school of the roster's own unit, so a person listed on a
 * School of Medicine department page reads as School of Medicine even when their own profile
 * sits on the School of Public Health's site; a blind check graded that roster school wrong on
 * 13 of 20 such rows. Where the lead's own official profile is on a school's site, a `school`
 * reading taken from a different school's site is dropped unless the own profile itself states
 * that school (a joint appointment it names), and the profile's host school stands in as a
 * derived candidate, re-derived on every resolve and never written back as an observation.
 *
 * Nothing changes when there is no own profile on a school's site, when any other `school`
 * reading shares the own profile's host (that page is the roster's own site, not an independent
 * profile), or when no reading is dropped.
 */
export function withOwnProfileSchoolPrecedence<T extends SchoolPrecedenceObservation>(
  observations: readonly T[],
  ownProfileUrl: string | undefined,
  canonicalizeSchool: (raw: unknown) => { value: string },
): OwnProfileSchoolPrecedence<T> {
  const unchanged = { observations: [...observations], dropped: [] };
  const ownSchool = siteSchoolOf(ownProfileUrl);
  const ownHost = hostOf(ownProfileUrl);
  if (!ownProfileUrl || !ownSchool || !ownHost) return unchanged;

  const schoolReadings = observations.filter((observation) => observation.field === SCHOOL_FIELD);
  const fromOwnProfile = (observation: T) => textOf(observation.sourceUrl) === ownProfileUrl;
  if (
    schoolReadings.some(
      (observation) => !fromOwnProfile(observation) && hostOf(observation.sourceUrl) === ownHost,
    )
  ) {
    return unchanged;
  }

  const ownSchoolKey = schoolKey(ownSchool, canonicalizeSchool);
  const namedByOwnProfile = new Set([
    ownSchoolKey,
    ...schoolReadings.filter(fromOwnProfile).map((o) => schoolKey(o.value, canonicalizeSchool)),
  ]);
  const crossSchool = new Set(
    schoolReadings.filter((observation) => {
      const siteSchool = siteSchoolOf(observation.sourceUrl);
      return (
        Boolean(siteSchool) &&
        schoolKey(siteSchool, canonicalizeSchool) !== ownSchoolKey &&
        !namedByOwnProfile.has(schoolKey(observation.value, canonicalizeSchool))
      );
    }),
  );
  if (crossSchool.size === 0) return unchanged;

  return {
    observations: observations.filter((observation) => !crossSchool.has(observation)),
    dropped: [...crossSchool],
    candidate: {
      field: SCHOOL_FIELD,
      value: canonicalizeSchool(ownSchool).value || ownSchool,
      sourceName: OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME,
      sourceUrl: ownProfileUrl,
      confidence: OWN_PROFILE_HOST_SCHOOL_CONFIDENCE,
      observedAt: newestObservedAt(
        observations.filter(fromOwnProfile).length > 0
          ? observations.filter(fromOwnProfile)
          : [...crossSchool],
      ),
    },
  };
}

/**
 * The resolve-time entry point: a row with no `school` reading is returned untouched without
 * loading the org-unit catalog.
 */
export async function ownProfileSchoolPrecedenceAtResolve<T extends SchoolPrecedenceObservation>(
  observations: readonly T[],
  ownProfileUrl: string | undefined,
): Promise<OwnProfileSchoolPrecedence<T>> {
  if (!ownProfileUrl || !observations.some((observation) => observation.field === SCHOOL_FIELD)) {
    return { observations: [...observations], dropped: [] };
  }
  const canonicalizer = await getOrgUnitCanonicalizer();
  return withOwnProfileSchoolPrecedence(observations, ownProfileUrl, (raw) =>
    canonicalizer.canonicalizeSchool(raw),
  );
}

/** The provenance the derived school records when it wins, mirroring the derived-topics entry. */
export function ownProfileSchoolProvenanceFor(
  field: string,
  resolved: { value?: unknown; contributingSources: readonly string[]; confidence?: number },
  candidate: OwnProfileSchoolCandidate | undefined,
): Record<string, unknown> | null {
  if (field !== SCHOOL_FIELD || !candidate) return null;
  if (!resolved.contributingSources.includes(candidate.sourceName)) return null;
  if (textOf(resolved.value) !== candidate.value) return null;
  return {
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    observedAt: candidate.observedAt,
    confidence: candidate.confidence,
  };
}
