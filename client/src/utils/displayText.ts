const SEGMENT_BOUNDARY = /([\s/()-]+)/;
/**
 * An already-upper-case token is left exactly as it is. The optional dots matter: without
 * them "U.S." is not recognised as an acronym, so it is lower-cased and re-capitalised into
 * "U.s.", which reached students on any label carrying a dotted acronym. A single letter
 * plus a dot is not an acronym, so the repetition requires two units.
 */
const SOURCE_ACRONYM = /^(?:[A-Z0-9]\.?){2,}$/;
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

/**
 * A controlled-vocabulary heading is stored inverted so that it files under its head noun:
 * MeSH holds "Carcinoma, Renal Cell" and "Immunity, Innate" so both sort beside their
 * siblings. That is right for an index and wrong for a chip, which a student reads as a
 * phrase: "Best fit for: Endothelium, Vascular" reads like a truncation.
 *
 * Only the stored value is a heading; the chip is presentation. So this un-inverts for
 * display and changes nothing stored, which matters because the same value is a
 * Meilisearch filter value and a search term, and both must keep matching the inverted
 * spelling a student may type or click.
 */
const INVERTED_HEADING = /^([^,]+),\s*([^,]+)$/;
/**
 * A conjunction in the MODIFIER means the comma separates co-ordinate parts rather than a
 * head from its subdivision, so the label is a composite heading and swapping it scrambles
 * it: "Molecular Medicine, Pharmacology & Physiology" must stay as it is.
 *
 * Tested on the modifier alone rather than the whole label, which was measured rather than
 * assumed. A conjunction inside the head is ordinary: on Development, testing the whole
 * label left exactly three chips inverted, and all three read better un-inverted, including
 * "Centers for Disease Control and Prevention, U.S.". A guard whose every firing was wrong
 * is worse than no guard.
 */
const COORDINATE_PARTS = /[&]|\b(?:and|or)\b/i;
/**
 * A modifier is a word or two ("Renal Cell", "Innate", "Type 1"). Longer than that and the
 * comma is punctuating a phrase rather than inverting a heading, so leave it alone.
 */
const MAX_INVERTED_MODIFIER_WORDS = 2;

export const unInvertControlledVocabularyHeading = (value: string): string => {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  const match = INVERTED_HEADING.exec(collapsed);
  if (!match) return collapsed;
  const [, head, modifier] = match;
  if (COORDINATE_PARTS.test(modifier)) return collapsed;
  const modifierWords = modifier.split(' ').filter(Boolean);
  if (modifierWords.length === 0 || modifierWords.length > MAX_INVERTED_MODIFIER_WORDS) {
    return collapsed;
  }
  // A lower-case modifier is prose ("politics, culture"), not a vocabulary subdivision.
  if (!/^[A-Z0-9]/.test(modifier)) return collapsed;
  return `${modifier} ${head}`;
};

/** A topic chip: un-inverted for reading, then title-cased like every other label. */
export const formatTopicChipLabel = (value: string): string =>
  formatTitleCaseLabel(unInvertControlledVocabularyHeading(value));
