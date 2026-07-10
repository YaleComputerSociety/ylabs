const WORD_INITIAL_PATTERN = /(^|[\s/(-])([a-z])/g;

export const formatTitleCaseLabel = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(
      WORD_INITIAL_PATTERN,
      (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`,
    )
    .replace(/\b(Ai|Cs|Dna|Rna|Mri|Fmri|Pcr|Nlp|Crispr)\b/g, (match) =>
      match.toUpperCase(),
    );
