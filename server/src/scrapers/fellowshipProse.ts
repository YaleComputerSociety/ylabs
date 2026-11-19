import {
  clampDescriptionLength,
  normalizeHygieneWhitespace,
  sanitizeStoredCatalogDescription,
} from '../utils/descriptionHygiene';
import { redactDirectContactInfo } from '../utils/contactRedaction';

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

const CONTACT_REDACTION_TOKEN = /\[(?:email|phone) redacted\]/gi;

/**
 * A lane's source text is the evidence a served claim is checked against, not a description a
 * student reads, so it is never run through the catalog description hygiene: that pass rejects a
 * whole page as a navigation, FAQ or staff-contact dump, which emptied the text of half the
 * program pages read (#6402). Only direct contact details are removed, and the length is bounded.
 */
export function sanitizedObservedSourceText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const redacted = normalizeHygieneWhitespace(
    redactDirectContactInfo(text).replace(CONTACT_REDACTION_TOKEN, ' '),
  );
  return redacted ? boundedObservedFellowshipProse(redacted) : undefined;
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
