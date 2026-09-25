const SEGMENT_BOUNDARY = /([\s/()-]+)/;
const SOURCE_ACRONYM = /^[A-Z0-9]{2,}$/;
const KNOWN_LOWERCASE_ACRONYMS = /^(ai|cs|dna|rna|mri|fmri|pcr|nlp|crispr)$/i;
const HAS_LOWERCASE = /[a-z]/;

/**
 * Short function words a title keeps lower-case away from the opening position.
 * Without this every chip read "Work And Gender" and "Economics Of Education",
 * which is the one thing a reader notices about a machine-written label even
 * though the stored topic is already correct English (#3251).
 */
const TITLE_CASE_MINOR_WORD =
  /^(a|an|and|as|at|but|by|for|from|in|into|nor|of|on|onto|or|over|per|the|to|up|via|with|within)$/i;

/**
 * A slash or a bracket starts a new label rather than continuing one, so the word
 * after it is an opening word again. `in vivo/in vitro` depends on this: both halves
 * are their own term of art and both keep the capital.
 */
const PHRASE_RESETTING_BOUNDARY = /[/()]/;

const titleCaseSegment = (segment: string, isOpeningWord: boolean): string => {
  if (SOURCE_ACRONYM.test(segment)) {
    return segment;
  }
  if (KNOWN_LOWERCASE_ACRONYMS.test(segment)) {
    return segment.toUpperCase();
  }
  const lower = segment.toLowerCase();
  if (!isOpeningWord && TITLE_CASE_MINOR_WORD.test(lower)) {
    return lower;
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

const isScreamingMultiWord = (value: string): boolean =>
  !HAS_LOWERCASE.test(value) && SEGMENT_BOUNDARY.test(value);

export const formatTitleCaseLabel = (value: string): string => {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  const normalized = isScreamingMultiWord(collapsed) ? collapsed.toLowerCase() : collapsed;
  const segments = normalized.split(SEGMENT_BOUNDARY);
  // The closing word keeps its capital even when it is a function word, because a
  // trailing single letter is usually a designator rather than an article:
  // "Vascular Endothelial Growth Factor A" must not end in "factor a".
  let lastWordIndex = -1;
  segments.forEach((segment, index) => {
    if (segment && index % 2 === 0) lastWordIndex = index;
  });
  let atOpeningWord = true;
  return segments
    .map((segment, index) => {
      if (!segment) return segment;
      const isSeparator = index % 2 === 1;
      if (isSeparator) {
        if (PHRASE_RESETTING_BOUNDARY.test(segment)) atOpeningWord = true;
        return segment;
      }
      const formatted = titleCaseSegment(segment, atOpeningWord || index === lastWordIndex);
      atOpeningWord = false;
      return formatted;
    })
    .join('');
};
