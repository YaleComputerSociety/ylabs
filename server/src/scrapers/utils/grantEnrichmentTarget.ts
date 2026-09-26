import type { CanonicalResearchHomeResolution } from '../canonicalResearchHomeResolver';

export type GrantPersonResolution =
  | { status: 'matched'; userId: string }
  | { status: 'absent' }
  | { status: 'ambiguous' };

export type GrantAttachRefusal =
  | 'unresolved'
  | 'ambiguousPerson'
  | 'noExistingRow'
  | 'ineligibleRow'
  | 'ambiguousRow';

export type GrantEnrichmentTarget =
  | { status: 'enrich'; researcherId: string; slug: string }
  | { status: 'refused'; reason: GrantAttachRefusal };

export type GrantAttachTally = Record<'enriched' | GrantAttachRefusal, number>;

export function emptyGrantAttachTally(): GrantAttachTally {
  return {
    enriched: 0,
    unresolved: 0,
    ambiguousPerson: 0,
    noExistingRow: 0,
    ineligibleRow: 0,
    ambiguousRow: 0,
  };
}

const REFUSAL_FOR_ROW_STATUS: Record<
  Exclude<CanonicalResearchHomeResolution['status'], 'canonical'>,
  GrantAttachRefusal
> = {
  'safe-shell': 'noExistingRow',
  ineligible: 'ineligibleRow',
  ambiguous: 'ambiguousRow',
};

export async function resolveGrantEnrichmentTarget(
  person: GrantPersonResolution,
  resolveExistingRow: (researcherId: string) => Promise<CanonicalResearchHomeResolution>,
): Promise<GrantEnrichmentTarget> {
  if (person.status === 'ambiguous') return { status: 'refused', reason: 'ambiguousPerson' };
  if (person.status !== 'matched') return { status: 'refused', reason: 'unresolved' };
  const row = await resolveExistingRow(person.userId);
  if (row.status === 'canonical') {
    return { status: 'enrich', researcherId: person.userId, slug: row.slug };
  }
  return { status: 'refused', reason: REFUSAL_FOR_ROW_STATUS[row.status] };
}

export function countGrantAttach(tally: GrantAttachTally, target: GrantEnrichmentTarget): void {
  if (target.status === 'enrich') tally.enriched++;
  else tally[target.reason]++;
}

export function grantAttachSummary(tally: GrantAttachTally): string {
  return (
    `rows enriched: ${tally.enriched}; not attached: ${tally.unresolved} resolved to no researcher, ` +
    `${tally.ambiguousPerson} resolved to several researchers, ` +
    `${tally.noExistingRow} have no existing research row (grants never mint one, #3145), ` +
    `${tally.ineligibleRow} ineligible row, ${tally.ambiguousRow} ambiguous row`
  );
}
