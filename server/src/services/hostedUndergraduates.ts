import {
  officialRosterUndergraduateStatuses,
  type OfficialRosterUndergraduateStatus,
} from '../models/storedVocabularies';
import { RETIRED_UNDERGRAD_QUOTE_CACHE_SOURCE } from '../scrapers/undergradEvidenceQuoteValidation';

const MAX_ROSTER_UNDERGRADUATE_NAME_LENGTH = 80;

const boundedRosterText = (value: unknown, maxLength: number): string => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length <= maxLength ? text : '';
};

export const DERIVED_UNDERGRAD_ROSTERS_SERVE_ENV = 'DERIVED_UNDERGRAD_ROSTERS_SERVE';

/**
 * A roster the lane derived for a row with a website, rather than one from the reviewed allowlist, is
 * recorded but not served until an owner-graded sample clears it (#5278).
 */
export const derivedUndergradRostersServe = (): boolean =>
  process.env[DERIVED_UNDERGRAD_ROSTERS_SERVE_ENV] === 'true';

export function servableRosterSnapshot(
  enrichment: any,
  derivedRostersServe = derivedUndergradRostersServe(),
): Record<string, any> | null {
  const snapshot = enrichment?.state === 'failed' ? enrichment?.lastSuccessfulSnapshot : enrichment;
  if (!['current', 'partial'].includes(snapshot?.state)) return null;
  if (snapshot?.configOrigin === 'derived' && !derivedRostersServe) return null;
  return Array.isArray(snapshot?.undergraduates) ? snapshot : null;
}

export function listedRosterUndergraduate(
  value: any,
): { name: string; status: OfficialRosterUndergraduateStatus } | null {
  const name = boundedRosterText(value?.name, MAX_ROSTER_UNDERGRADUATE_NAME_LENGTH);
  const status = value?.status;
  if (!name || !(officialRosterUndergraduateStatuses as readonly string[]).includes(status)) {
    return null;
  }
  return { name, status };
}

export function rosterListsUndergraduates(
  enrichment: unknown,
  derivedRostersServe = derivedUndergradRostersServe(),
): boolean {
  const snapshot = servableRosterSnapshot(enrichment, derivedRostersServe);
  return Boolean(snapshot?.undergraduates.some(listedRosterUndergraduate));
}

export function hasPastUndergradAdvisees(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const count = Number((row as { count?: unknown }).count ?? 1);
    return count > 0;
  });
}

/**
 * The one definition of "Has hosted undergraduate researchers" (#3593): evidence that
 * undergraduates have been in the lab. The served flag behind the browse card, the pathway
 * badge and saved plans, and the stored flag the `hostsUndergrads` filter reads, are all this
 * predicate, so they cannot disagree about a row. Supervising student projects is a separate
 * claim with its own badge.
 *
 * A current roster count joined the predicate once it was re-derived from grounded roster
 * lines (#3789): after that re-run, 28 of 30 stored positive counts sampled on Development
 * (2026-09-28) were backed by the cited page, against 13 of 20 before it. A count held only by
 * the retired cache backfill carried no roster to check, so it still does not count.
 *
 * An owner-reviewed official roster that lists an undergraduate by name, current or past,
 * counts too (#5232), read from the same snapshot the detail page lists them from. Unlike
 * that list it ignores the freshness window: "has hosted" is historical, and the stored
 * copy of this flag must not change with the clock.
 *
 * A derived roster never counts: the lane derives one only for a row that already carries
 * this flag, so counting it would let the roster keep the flag alive after the evidence that
 * earned it is gone (#5278).
 */
export function entityHasHostedUndergraduates(entity: {
  pastUndergradAdvisees?: unknown;
  currentUndergradCount?: unknown;
  fieldProvenance?: { currentUndergradCount?: { sourceName?: unknown } };
  rosterEnrichment?: unknown;
}): boolean {
  if (hasPastUndergradAdvisees(entity.pastUndergradAdvisees)) return true;
  if (rosterListsUndergraduates(entity.rosterEnrichment, false)) return true;
  const count = Number(entity.currentUndergradCount);
  return (
    Number.isFinite(count) &&
    count > 0 &&
    entity.fieldProvenance?.currentUndergradCount?.sourceName !==
      RETIRED_UNDERGRAD_QUOTE_CACHE_SOURCE
  );
}
