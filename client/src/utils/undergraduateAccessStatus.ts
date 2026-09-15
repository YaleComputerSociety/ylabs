export interface UndergraduateAccessFields {
  hasUndergradHostingEvidence?: boolean | null;
}

export type UndergraduateAccessTone = 'muted' | 'evidence';

export interface UndergraduateAccessStatus {
  tone: UndergraduateAccessTone;
  label: string;
  detail?: string;
}

// Availability, compensation and welcomed class years used to drive this status.
// They were removed because no source publishes them: across the served corpus
// availability held 3 real values and the other two held none, so every branch
// but this one was unreachable in practice. Past hosting evidence is the only
// undergraduate access signal the corpus actually carries.
export const deriveUndergraduateAccessStatus = (
  fields: UndergraduateAccessFields,
): UndergraduateAccessStatus | null =>
  fields.hasUndergradHostingEvidence
    ? { tone: 'evidence', label: 'Has hosted undergrads before' }
    : null;

export const undergraduateAccessSortRank = (status: UndergraduateAccessStatus | null): number =>
  status?.tone === 'evidence' ? 0 : 1;
