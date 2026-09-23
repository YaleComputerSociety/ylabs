/**
 * Removes the chrome shapes that can be stripped from a served research body
 * without judging the content around them (#2593).
 *
 * ## Why this is small
 *
 * #2593 was scoped as a sentence-level chrome strip: drop leading chrome
 * sentences, serve from the first research sentence. That was built and measured
 * against Development's 2,617 served fulls, hand-reading every affected row over
 * three iterations, and it was **rejected on precision**: 5 wrong of 20, then 12
 * of 22, then 5 of 14, with each fix surfacing a new shape - mid-name splits
 * ("Owen M." + "Fiss"), identifying sentences that name the lab and its PI,
 * degree sentences that also carry research content, dangling openers ("Before
 * that", "I also hold"), and a job title containing the words "Admissions and
 * Financial Aid".
 *
 * That is the #2573 convergence problem one level down: the space of leading
 * chrome shapes is as unbounded as the space of page layouts, so a regex
 * classifier over sentences does not converge either. Dropping a sentence is
 * destructive, and a wrong drop is invisible in aggregate counts because the row
 * still serves a plausible body.
 *
 * So this module deliberately does NOT drop sentences. It removes only text whose
 * chrome status does not depend on reading the content around it. Measured effect:
 * 18 of 2,617 served fulls change and none lose content.
 */

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * Abbreviations whose internal period is not a sentence boundary. Degree tokens
 * matter most: a divinity or medicine body is often a run of them.
 */
const PROTECTED_TRAILING_ABBREVIATION =
  /(?:\b(?:Dr|Prof|Mr|Mrs|Ms|Jr|Sr|St|vs|etc|approx|Inc|Ltd|Co|Dept|Univ|No|Vol|Fig|al)|\b(?:e\.g|i\.e|Ph\.D|M\.D|B\.A|B\.S|A\.B|M\.A|M\.S|M\.Div|M\.S\.W|M\.P\.H|M\.B\.A|D\.Min|D\.Phil|Sc\.D|J\.D|Ed\.D|D\.V\.M))\.$/i;

/** A trailing middle initial, or a run of them: "Owen M.", "Arthur K.", "C.N.H.". */
const TRAILING_INITIAL = /(?:^|\s)(?:[A-Z]\.){1,4}$/;

/** A continuation rather than a new sentence: "from 1984. -2022.", "...2019. (see below)". */
const CONTINUATION_OPENER = /^[-–—,;:)\]}]|^[a-z\d]/;

/**
 * Sentence split that survives this corpus. A naive `split(/(?<=[.!?])\s+/)`
 * breaks on "B.A. University", on "Dr. Maerz", and on every middle initial, and it
 * does not break at all on "VirginiaM.Div." where the source lost the space.
 *
 * Exported because it is the reusable half of the rejected experiment: any future
 * sentence-level work needs it, and it is pinned by tests against the specific
 * hostile inputs this corpus actually contains.
 */
export function splitBodySentences(value: unknown): string[] {
  const text = textValue(value);
  if (!text) return [];
  const rough = text.split(/(?<=[.!?])\s+/);
  const merged: string[] = [];
  for (const piece of rough) {
    const previous = merged[merged.length - 1];
    if (
      previous !== undefined &&
      (PROTECTED_TRAILING_ABBREVIATION.test(previous) ||
        TRAILING_INITIAL.test(previous) ||
        CONTINUATION_OPENER.test(piece))
    ) {
      merged[merged.length - 1] = `${previous} ${piece}`;
      continue;
    }
    merged.push(piece);
  }
  return merged.map((sentence) => sentence.trim()).filter(Boolean);
}

/**
 * "Last Updated on March 15, 2023." Handled as a SUFFIX rather than a sentence,
 * because on `ysm-faculty-yann-poncin` the source glued it to the previous
 * sentence with no period in front of it, so no sentence-level rule can see it.
 * 8 of the 12 measured trailing-chrome rows are this shape, and all 8 strip
 * correctly.
 */
const TRAILING_UPDATE_STAMP =
  /\s*\bLast\s+Updated\s+(?:on\s+)?(?:[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})\s*\.?\s*$/i;

/**
 * A section label used as an inline PREFIX on the first sentence rather than as
 * its own sentence: "Bio: My research focuses on ...". Dropping the sentence
 * discards the prose, which is exactly what deleted the single best sentence in
 * `padmanabhan-lab-np274`. Unwrapping the label keeps it.
 */
const INLINE_SECTION_LABEL_PREFIX =
  /^(?:bio|biography|titles?|overview|about|summary|profile)\s*[:.–-]?\s+/i;

/**
 * Site furniture strings, which are chrome wherever they appear because they name a
 * page widget rather than say anything. That is what makes a leading run of them
 * strippable under this module's rule while a leading *sentence* is not: deciding
 * that "Skip to main content" is chrome needs no reading of the text around it.
 *
 * A page whose navigation is not inside `<nav>` flattens into the extracted text as
 * one unpunctuated run, so `splitBodySentences` cannot separate the furniture from
 * the prose that follows it on the same run and no sentence-level rule can reach it.
 * `htmlToText` drops `nav`/`footer` and the collapsed-widget selector reaches the
 * rest of the markup, but neither removes a skip link or a menu label rendered as a
 * plain `div`, which is how a harvested body came to open "Main Menu Sub Menu home
 * publications Research people alum/theses Outreach contact links Welcome Current
 * Research Projects ..." (#1878). Measured on Development: 5 stored bodies carry one
 * of these runs, 4 of them on `student_ready` rows.
 *
 * The same vocabulary gates snippet selection in `fraProfileSynthesisCore.ts`. It is
 * duplicated rather than shared because that one rejects a whole snippet and this one
 * cuts a prefix, so widening either for its own cohort must not silently change the
 * other's reach.
 */
const LEADING_NAVIGATION_CHROME_MARKER =
  /\b(?:Skip\s+to\s+(?:main\s+)?content|Skip\s+to\s+main|Open\s+Main\s+Navigation|Close\s+Main\s+Navigation|Search\s+this\s+site|Search\s+form|Main\s+Menu|Sub\s+Menu|MENU\s+MENU|INFORMATION\s+FOR|YSM\s+Home)\b/gi;

/** Below this, what follows the furniture is not a body worth serving on its own. */
const MIN_BODY_AFTER_CHROME_CHARS = 60;

/**
 * The text after the last furniture marker in the leading run, or `''` when there is
 * no such run or cutting it would leave too little to serve.
 *
 * A marker only belongs to the leading run when it precedes the body's first sentence
 * boundary. That is the whole distinction between a page header and prose that quotes
 * one: a header carries no terminator, which is exactly why `splitBodySentences`
 * cannot reach it, while a sentence about the phrase "Skip to main content" sits after
 * one. A distance bound was tried instead and it cut such a sentence, discarding real
 * content, which this module must never do.
 *
 * Returning `''` rather than a short remainder is deliberate for the same reason: a
 * row whose entire extracted text was furniture should keep failing the description
 * gate rather than start serving a fragment of its own menu.
 */
function bodyAfterLeadingNavigationChrome(text: string): string {
  const terminator = text.search(/[.!?]\s/);
  const boundary = terminator === -1 ? text.length : terminator;
  LEADING_NAVIGATION_CHROME_MARKER.lastIndex = 0;
  let cut = 0;
  let match: RegExpExecArray | null;
  while ((match = LEADING_NAVIGATION_CHROME_MARKER.exec(text))) {
    if (match.index >= boundary) break;
    cut = Math.max(cut, match.index + match[0].length);
  }
  if (cut === 0) return '';
  const remainder = text
    .slice(cut)
    .replace(/^[\s|·•–—:,.-]+/, '')
    .trim();
  return remainder.length >= MIN_BODY_AFTER_CHROME_CHARS ? remainder : '';
}

const MAX_TITLES_RUN_WORDS = 25;
const MIN_TITLES_RUN_TITLE_CASE_RATIO = 0.4;

/**
 * Share of non-sentence-initial words that are Title Case. Publication titles and
 * administrative title runs are overwhelmingly Title Case; prose is not. Acronyms
 * are excluded because a real research sentence cites them freely.
 */
export function titleCaseWordRatio(value: string): number {
  const words = value.trim().split(/\s+/).filter(Boolean);
  let considered = 0;
  let titleCase = 0;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index].replace(/^[("'“‘]+|[)"'”’,;:.]+$/g, '');
    if (word.length < 2 || !/^[\p{L}]/u.test(word)) continue;
    if (word === word.toUpperCase()) continue;
    considered += 1;
    if (/^[\p{Lu}]/u.test(word)) titleCase += 1;
  }
  return considered === 0 ? 0 : titleCase / considered;
}

const looksLikeTitlesRun = (sentence: string): boolean =>
  sentence.split(/\s+/).filter(Boolean).length <= MAX_TITLES_RUN_WORDS &&
  titleCaseWordRatio(sentence) > MIN_TITLES_RUN_TITLE_CASE_RATIO;

export interface StrippedBody {
  body: string;
  droppedUpdateStamp: boolean;
  strippedLabelPrefix: boolean;
  strippedNavigationChrome: boolean;
}

export function stripBodyChrome(value: unknown): StrippedBody {
  const original = textValue(value);
  const withoutStamp = original.replace(TRAILING_UPDATE_STAMP, '');
  const droppedUpdateStamp = withoutStamp !== original;
  // Ahead of the sentence split, because the run this removes carries no sentence
  // boundary for the split to find.
  const afterNavigationChrome = bodyAfterLeadingNavigationChrome(withoutStamp);
  const strippedNavigationChrome = afterNavigationChrome.length > 0;
  const withoutChrome = strippedNavigationChrome ? afterNavigationChrome : withoutStamp;
  const sentences = splitBodySentences(withoutChrome);
  if (sentences.length === 0) {
    return {
      body: '',
      droppedUpdateStamp,
      strippedLabelPrefix: false,
      strippedNavigationChrome,
    };
  }
  const first = sentences[0];
  const afterLabel = first.replace(INLINE_SECTION_LABEL_PREFIX, '').trim();
  // Do not unwrap a label whose content is itself title-cased: "Title A Novel
  // Approach to Measuring the Impact of Surgery in Craniosynostosis" is a
  // publication title, and removing "Title" makes it READ as prose without making
  // it prose (`ysm-faculty-john-persing`).
  const strippedLabelPrefix =
    afterLabel !== first && afterLabel.length > 0 && !looksLikeTitlesRun(afterLabel);
  const rest = [...sentences];
  if (strippedLabelPrefix) rest[0] = afterLabel;
  return {
    body: rest.join(' ').trim(),
    droppedUpdateStamp,
    strippedLabelPrefix,
    strippedNavigationChrome,
  };
}
