import { givenNamesEquivalent, surnamesCompatible } from './piNameMatch';
import { splitName } from './scraperHelpers';

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * The email join and the inferred-director profile-URL join have no name resolver
 * behind them, so they carry their own name check: the observed name must agree on
 * surname and given name with the researcher that key already backs. Reuses the same
 * comparators as `resolveResearcherIdForPersonName` so every lane agrees on what
 * "same person" means.
 */
export function observedPersonNameAgreesWith(
  storedDisplayName: unknown,
  observedDisplayName: string,
): boolean {
  const stored = splitName(textOf(storedDisplayName));
  const observed = splitName(observedDisplayName);
  if (!stored.last || !observed.last) return false;
  if (!surnamesCompatible(observed.last, stored.last)) return false;
  if (!stored.first || !observed.first) return false;
  return (
    stored.first.toLowerCase() === observed.first.toLowerCase() ||
    givenNamesEquivalent(observed.first, stored.first)
  );
}
