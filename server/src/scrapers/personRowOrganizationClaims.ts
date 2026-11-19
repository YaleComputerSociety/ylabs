/**
 * Owner decision 2026-10-17 (#5283): a person who directs or co-founds an organization keeps
 * two rows, their own faculty research row and the organization's row. `official-profile-pi-
 * backfill` now refuses such a home at the write, but the claims it made before the guard
 * reached a row are still live, and a row its re-read can no longer reach is never refused.
 * So the same rule is applied to the lane's stored claims on every resolve: it reads evidence,
 * writes no field and needs no lock.
 */
import { PERSON_SCOPED_RESEARCH_ENTITY_TYPES } from '../models/storedVocabularies';
import {
  entityKeyNamesOnlyThisPerson,
  personIdentityTokens,
} from '../utils/researchHomeNameIdentityAuthority';

export const PROFILE_HOME_SOURCE = 'official-profile-pi-backfill';

const GRANT_DERIVED_PI_SHELL_SLUG_RE = /^(?:nih-pi-|nsf-pi-)/;

const FACULTY_RESEARCH_ROW_TYPES: ReadonlySet<string> = new Set(
  [...PERSON_SCOPED_RESEARCH_ENTITY_TYPES].filter((entityType) => entityType !== 'LAB'),
);

const PROFILE_HOME_CLAIM_IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'displayName',
  'entityType',
  'kind',
]);

export type ProfileHomeClaimObservation = {
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
  scrapeRunId?: unknown;
  observedAt?: unknown;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function observedTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * The lane states a home's name, kind and type together in one read, so the read is the
 * claim. A later read that names nothing admissible still restates the type, because the
 * type is latest-wins for this lane and the name is not; without the read as the pairing key
 * an older name kept a newer organization type live (#5283).
 */
export function profileHomeClaimKey(observation: ProfileHomeClaimObservation): string {
  const runId = observation.scrapeRunId ? String(observation.scrapeRunId) : '';
  return runId ? `run:${runId}` : `at:${observedTime(observation.observedAt)}`;
}

export function isProfileHomeLaneObservation(observation: ProfileHomeClaimObservation): boolean {
  return observation.sourceName === PROFILE_HOME_SOURCE;
}

/**
 * Whether the row is a person's own: a grant shell, a key naming nobody but its lead, or a row
 * another source states is faculty research. The lane's own type is never read here, because a
 * past retype would otherwise exempt the row it retyped.
 */
export function isPersonRowForProfileHomeClaims(
  row: { slug?: unknown; leadPersonName?: unknown },
  observations: ProfileHomeClaimObservation[],
): boolean {
  const slug = text(row.slug);
  if (GRANT_DERIVED_PI_SHELL_SLUG_RE.test(slug)) return true;
  if (entityKeyNamesOnlyThisPerson({ slug, personName: row.leadPersonName })) return true;
  if (keyNamesTheLeadsLab(slug, row.leadPersonName)) return true;
  return observations.some(
    (observation) =>
      !isProfileHomeLaneObservation(observation) &&
      observation.field === 'entityType' &&
      FACULTY_RESEARCH_ROW_TYPES.has(text(observation.value).toUpperCase()),
  );
}

/**
 * A `<surname>-lab-<netid>` key was minted for the lead's own lab. The netid glues initials to
 * the surname, so the every-token test above cannot account for it.
 */
function keyNamesTheLeadsLab(slug: string, leadPersonName: unknown): boolean {
  const keyTokens = slug.toLowerCase().split('-');
  if (!keyTokens.includes('lab')) return false;
  const surname = personIdentityTokens(leadPersonName).at(-1);
  return (
    Boolean(surname) &&
    keyTokens.indexOf(surname!) >= 0 &&
    keyTokens.indexOf(surname!) < keyTokens.indexOf('lab')
  );
}

/** The reads in which the lane typed the row as something other than a lab. */
export function profileHomeOrganizationClaimKeys(
  observations: ProfileHomeClaimObservation[],
): Set<string> {
  return new Set(
    observations
      .filter(
        (observation) =>
          isProfileHomeLaneObservation(observation) &&
          observation.field === 'entityType' &&
          Boolean(text(observation.value)) &&
          text(observation.value).toUpperCase() !== 'LAB',
      )
      .map(profileHomeClaimKey),
  );
}

/**
 * Drops every name, display name, type and kind of a lane read that typed a person's row as an
 * organization. The website the read stated is left alone, as the lane's own refusal leaves it.
 */
export function withoutPersonRowOrganizationHomeClaims<T extends ProfileHomeClaimObservation>(
  observations: T[],
  organizationClaimKeys: ReadonlySet<string>,
): T[] {
  if (organizationClaimKeys.size === 0) return observations;
  return observations.filter(
    (observation) =>
      !isProfileHomeLaneObservation(observation) ||
      !PROFILE_HOME_CLAIM_IDENTITY_FIELDS.has(String(observation.field ?? '')) ||
      !organizationClaimKeys.has(profileHomeClaimKey(observation)),
  );
}
