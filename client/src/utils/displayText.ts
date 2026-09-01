const SEGMENT_BOUNDARY = /([\s/()-]+)/;
const SOURCE_ACRONYM = /^[A-Z0-9]{2,}$/;
const KNOWN_LOWERCASE_ACRONYMS = /^(ai|cs|dna|rna|mri|fmri|pcr|nlp|crispr)$/i;
const HAS_LOWERCASE = /[a-z]/;

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

const isScreamingMultiWord = (value: string): boolean =>
  !HAS_LOWERCASE.test(value) && SEGMENT_BOUNDARY.test(value);

export const formatTitleCaseLabel = (value: string): string => {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  const normalized = isScreamingMultiWord(collapsed) ? collapsed.toLowerCase() : collapsed;
  return normalized.split(SEGMENT_BOUNDARY).map(titleCaseSegment).join('');
};
