import { RETIRED_UNDERGRAD_QUOTE_CACHE_SOURCE } from '../scrapers/undergradEvidenceQuoteValidation';

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
 */
export function entityHasHostedUndergraduates(entity: {
  pastUndergradAdvisees?: unknown;
  currentUndergradCount?: unknown;
  fieldProvenance?: { currentUndergradCount?: { sourceName?: unknown } };
}): boolean {
  if (hasPastUndergradAdvisees(entity.pastUndergradAdvisees)) return true;
  const count = Number(entity.currentUndergradCount);
  return (
    Number.isFinite(count) &&
    count > 0 &&
    entity.fieldProvenance?.currentUndergradCount?.sourceName !==
      RETIRED_UNDERGRAD_QUOTE_CACHE_SOURCE
  );
}
