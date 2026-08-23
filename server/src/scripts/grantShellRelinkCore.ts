export type Disposition =
  | 'newly-linked'
  | 'already-linked'
  | 'personid-divergent'
  | 'still-ambiguous'
  | 'still-unmatched';

export const DISPOSITIONS: readonly Disposition[] = [
  'newly-linked',
  'already-linked',
  'personid-divergent',
  'still-ambiguous',
  'still-unmatched',
];

export type MatchResult = string | 'ambiguous' | null;

export interface ClassificationInput {
  matched: MatchResult;
  canonicalPersonId: string | null;
  activeLeadPersonIds: readonly string[];
}

export function classifyDisposition({
  matched,
  canonicalPersonId,
  activeLeadPersonIds,
}: ClassificationInput): Disposition {
  if (matched === 'ambiguous') return 'still-ambiguous';
  if (!matched) return 'still-unmatched';
  if (canonicalPersonId && activeLeadPersonIds.includes(canonicalPersonId)) {
    return 'already-linked';
  }
  if (activeLeadPersonIds.length > 0) return 'personid-divergent';
  return 'newly-linked';
}

export function isApplyable(disposition: Disposition): boolean {
  return disposition === 'newly-linked';
}

export function tallyDispositions(dispositions: readonly Disposition[]): Record<Disposition, number> {
  const counts = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0])) as Record<Disposition, number>;
  for (const disposition of dispositions) counts[disposition] += 1;
  return counts;
}
