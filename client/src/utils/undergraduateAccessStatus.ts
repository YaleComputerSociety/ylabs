export interface UndergraduateAccessFields {
  hasUndergradHostingEvidence?: boolean | null;
}

export type UndergraduateAccessTone = 'evidence';

export interface UndergraduateAccessStatus {
  tone: UndergraduateAccessTone;
  label: string;
}

// Past hosting evidence is the only undergraduate access signal the corpus
// carries, which is why one tone is enough here. See the 2026-09-15 entry in
// docs/decisions.md for why availability, compensation and class years went.
export const deriveUndergraduateAccessStatus = (
  fields: UndergraduateAccessFields,
): UndergraduateAccessStatus | null =>
  fields.hasUndergradHostingEvidence
    ? { tone: 'evidence', label: 'Has hosted undergrads before' }
    : null;

export const undergraduateAccessSortRank = (status: UndergraduateAccessStatus | null): number =>
  status?.tone === 'evidence' ? 0 : 1;
