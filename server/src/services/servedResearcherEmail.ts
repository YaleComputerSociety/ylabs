import type { ResearcherEmailSupport } from '../models/researcher';

export type ResearcherEmailSupportVerdict = 'supported' | 'unsupported' | 'unmarked';

const normalizedEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/**
 * Read from the stored `identifiers.emailSupport` marker alone, never from observations,
 * because Beta and Production carry no observation store (#5627). A marker computed for a
 * different address than the one stored is stale and reads as unmarked.
 */
export function researcherEmailSupportVerdict(
  email: unknown,
  marker: Partial<ResearcherEmailSupport> | null | undefined,
): ResearcherEmailSupportVerdict {
  const stored = normalizedEmail(email);
  if (!stored || !marker || normalizedEmail(marker.computedForEmail) !== stored) return 'unmarked';
  return marker.supported === true ? 'supported' : 'unsupported';
}
