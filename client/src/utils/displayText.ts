const SEGMENT_BOUNDARY = /([\s/()-]+)/;
const SOURCE_ACRONYM = /^[A-Z0-9]{2,}$/;
const KNOWN_LOWERCASE_ACRONYMS = /^(ai|cs|dna|rna|mri|fmri|pcr|nlp|crispr)$/i;

const titleCaseSegment = (segment: string): string => {
  if (SOURCE_ACRONYM.test(segment)) {
    return segment;
  }
  if (KNOWN_LOWERCASE_ACRONYMS.test(segment)) {
    return segment.toUpperCase();
  }
  const lower = segment.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

export const formatTitleCaseLabel = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .trim()
    .split(SEGMENT_BOUNDARY)
    .map(titleCaseSegment)
    .join('');
