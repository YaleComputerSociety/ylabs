export interface UndergraduateAccessFields {
  undergraduateCurrentAvailability?: string | null;
  hasUndergradHostingEvidence?: boolean | null;
}

export type UndergraduateAccessTone = 'open' | 'muted' | 'evidence';

export interface UndergraduateAccessStatus {
  tone: UndergraduateAccessTone;
  label: string;
  detail?: string;
  isCurrentlyOpen: boolean;
}

export const CURRENTLY_OPEN_AVAILABILITY_VALUES: ReadonlySet<string> = new Set(['OPEN', 'ROLLING']);

export const deriveUndergraduateAccessStatus = (
  fields: UndergraduateAccessFields,
): UndergraduateAccessStatus | null => {
  switch (fields.undergraduateCurrentAvailability) {
    case 'OPEN':
      return {
        tone: 'open',
        label: 'Open now',
        detail: 'Open to undergraduates right now',
        isCurrentlyOpen: true,
      };
    case 'ROLLING':
      return {
        tone: 'open',
        label: 'Rolling',
        detail: 'Accepting undergraduates on a rolling basis',
        isCurrentlyOpen: true,
      };
    case 'NOT_CURRENTLY_AVAILABLE':
      return {
        tone: 'muted',
        label: 'Not currently available',
        detail: 'Check back later',
        isCurrentlyOpen: false,
      };
    default:
      break;
  }

  if (fields.hasUndergradHostingEvidence) {
    return {
      tone: 'evidence',
      label: 'Has hosted undergrads before',
      isCurrentlyOpen: false,
    };
  }

  return null;
};

export const isCurrentlyOpenToUndergraduates = (fields: UndergraduateAccessFields): boolean =>
  deriveUndergraduateAccessStatus(fields)?.isCurrentlyOpen === true;

export const undergraduateAccessSortRank = (
  status: UndergraduateAccessStatus | null,
): number => {
  if (status?.isCurrentlyOpen) return 0;
  if (status?.tone === 'muted') return 2;
  return 1;
};
