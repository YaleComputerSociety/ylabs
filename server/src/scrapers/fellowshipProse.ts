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
 * and the stored copy a student reads is bounded here. Each cap is the longest any lane
 * stored for that field before, so no stored copy loses text.
 */
export const FELLOWSHIP_DISPLAY_PROSE_CAPS: Readonly<Record<string, number>> = {
  applicationInformation: 3000,
  eligibility: 1200,
  restrictionsToUseOfAward: 1200,
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

/**
 * A plain cut rather than a sentence-boundary clamp, because the office and REU lanes cut
 * these fields the same way at emission, so a copy they stored before is reproduced exactly.
 */
export function fellowshipDisplayProse(field: string, value: string): string | undefined {
  if (FELLOWSHIP_DESCRIPTION_FIELDS.has(field)) return sanitizeStoredCatalogDescription(value);
  const cap = FELLOWSHIP_DISPLAY_PROSE_CAPS[field];
  return cap === undefined ? undefined : value.slice(0, cap);
}
