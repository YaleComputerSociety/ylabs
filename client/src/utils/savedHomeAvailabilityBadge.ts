import { REACH_OUT_PLAUSIBLE_LABEL, REACH_OUT_TO_CONFIRM_LABEL } from './undergradAcceptance';

export type SavedHomeAvailabilityTone = 'open' | 'muted-negative' | 'muted-positive';

export interface SavedHomeAvailabilityBadge {
  label: string;
  tone: SavedHomeAvailabilityTone;
  isCurrentlyOpen: boolean;
}

export interface SavedHomeAvailabilityFields {
  undergraduateCurrentAvailability?: string;
  accessAcceptanceLevel?: string;
  hasUndergradHostingEvidence?: boolean;
}

const CURRENT_AVAILABILITY_OPEN_LABELS: Record<string, string> = {
  OPEN: 'Open now',
  ROLLING: 'Rolling',
};

const HAS_HOSTED_UNDERGRADS_LABEL = 'Has hosted undergrads before';

export function computeSavedHomeAvailabilityBadge(
  entity: SavedHomeAvailabilityFields,
): SavedHomeAvailabilityBadge | null {
  const availability = entity.undergraduateCurrentAvailability;
  const openLabel = availability ? CURRENT_AVAILABILITY_OPEN_LABELS[availability] : undefined;
  if (openLabel) {
    return { label: openLabel, tone: 'open', isCurrentlyOpen: true };
  }

  if (availability === 'NOT_CURRENTLY_AVAILABLE') {
    return { label: REACH_OUT_TO_CONFIRM_LABEL, tone: 'muted-negative', isCurrentlyOpen: false };
  }

  if (entity.hasUndergradHostingEvidence === true) {
    return { label: HAS_HOSTED_UNDERGRADS_LABEL, tone: 'muted-positive', isCurrentlyOpen: false };
  }

  if (entity.accessAcceptanceLevel === 'verified' || entity.accessAcceptanceLevel === 'likely') {
    return { label: REACH_OUT_PLAUSIBLE_LABEL, tone: 'muted-positive', isCurrentlyOpen: false };
  }

  return null;
}

export function savedHomeAvailabilityBadgeToneClasses(tone: SavedHomeAvailabilityTone): string {
  switch (tone) {
    case 'open':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'muted-negative':
      return 'border-[var(--yr-line)] bg-[var(--yr-panel-muted)] text-gray-600';
    case 'muted-positive':
      return 'border-blue-100 bg-[var(--yr-blue-soft)] text-[var(--yr-blue)]';
    default:
      return 'border-[var(--yr-line)] bg-[var(--yr-panel-muted)] text-gray-600';
  }
}
