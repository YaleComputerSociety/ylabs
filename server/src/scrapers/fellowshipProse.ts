import {
  clampDescriptionLength,
  sanitizeStoredCatalogDescription,
} from '../utils/descriptionHygiene';

export const MAX_OBSERVED_FELLOWSHIP_PROSE_CHARS = 20_000;

export const OBSERVED_FELLOWSHIP_PROSE_FIELDS: ReadonlySet<string> = new Set([
  'summary',
  'description',
  'applicationInformation',
  'eligibility',
  'restrictionsToUseOfAward',
  'additionalInformation',
  'fullSourceDescription',
]);

export const FELLOWSHIP_DESCRIPTION_FIELDS: ReadonlySet<string> = new Set([
  'description',
  'summary',
]);

/**
 * Lanes emit prose whole so the classifier reads every requirement a page states (#4572),
 * and the stored copy a student reads is bounded here. These are the caps the grants lane
 * applied at emission before, so its stored copies are unchanged.
 */
export const FELLOWSHIP_DISPLAY_PROSE_CAPS: Readonly<Record<string, number>> = {
  applicationInformation: 2000,
  eligibility: 500,
  restrictionsToUseOfAward: 500,
};

function clampedOnlyPastCap(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : clampDescriptionLength(value, maxLength);
}

export function boundedObservedFellowshipProse(value: string): string {
  return clampedOnlyPastCap(value, MAX_OBSERVED_FELLOWSHIP_PROSE_CHARS);
}

export function sanitizedObservedFellowshipProse(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return sanitizeStoredCatalogDescription(text, MAX_OBSERVED_FELLOWSHIP_PROSE_CHARS) || undefined;
}

export function fellowshipDisplayProse(field: string, value: string): string | undefined {
  if (FELLOWSHIP_DESCRIPTION_FIELDS.has(field)) return sanitizeStoredCatalogDescription(value);
  const cap = FELLOWSHIP_DISPLAY_PROSE_CAPS[field];
  return cap === undefined ? undefined : clampedOnlyPastCap(value, cap);
}
