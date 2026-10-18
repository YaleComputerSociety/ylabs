import type { PastUndergradAdvisee } from '../types/researchGroup';

export const pastUndergradAdviseesSummary = (
  advisees: readonly (PastUndergradAdvisee | null | undefined)[] | null | undefined,
): string | null => {
  const entries = advisees || [];
  const total = entries.reduce((sum, advisee) => sum + (advisee?.count ?? 1), 0);
  if (total <= 0) return null;
  const years = entries
    .map((advisee) => advisee?.year)
    .filter((year): year is number => typeof year === 'number' && year > 0)
    .sort((a, b) => a - b);
  const range =
    years.length > 0
      ? years[0] === years[years.length - 1]
        ? `${years[0]}`
        : `${years[0]}–${years[years.length - 1]}`
      : null;
  return `Advised ${total} ${total === 1 ? 'undergrad' : 'undergrads'}${range ? ` (${range})` : ''}`;
};
