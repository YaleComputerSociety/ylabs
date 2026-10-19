import { givenNamesEquivalent, surnamesCompatible } from './piNameMatch';
import { splitName } from './scraperHelpers';

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const soleNameToken = (name: string): string => {
  const tokens = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.length === 1 ? tokens[0] : '';
};

/**
 * The email join and the inferred-director profile-URL join have no name resolver
 * behind them, so they carry their own name check: the observed name must agree on
 * surname and given name with the researcher that key already backs. Reuses the same
 * comparators as `resolveResearcherIdForPersonName` so every lane agrees on what
 * "same person" means. A person known by a single name has no surname to compare, so
 * two single-token names agree only when they are the same name.
 */
export function observedPersonNameAgreesWith(
  storedDisplayName: unknown,
  observedDisplayName: string,
): boolean {
  const storedMononym = soleNameToken(textOf(storedDisplayName));
  if (storedMononym && storedMononym === soleNameToken(textOf(observedDisplayName))) return true;
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
