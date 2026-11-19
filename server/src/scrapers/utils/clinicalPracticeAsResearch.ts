import { sharesAnInflectionalStem } from '../../utils/groundedCardSynthesis';
import { splitDescriptionSentences } from '../../utils/careerBiographyDescription';
import { isPersonResearchRow, statesResearchSentence } from '../../utils/researchStatementPassage';
import { isPublicationCitationLine } from './researchPageChrome';
import { writerContentTerms } from './writerEvidenceText';

const WRITER_READING = { purposeAdverbs: true } as const;

const CLINICAL_LIST_HEADING =
  /^(?:clinical\s+(?:specialt(?:y|ies)|interests?|expertise|focus|services?)|specialt(?:y|ies)|conditions?\s+(?:treated|we\s+treat))\b\s*:?/i;
const CLINICAL_INLINE =
  /\bclinical\s+(?:specialt(?:y|ies)|interests?|expertise|focus)\b[^.]{0,20}?(?::|\b(?:include|includes|are|is|encompass(?:es)?)\b)|\bspeciali[sz](?:es|ing)\s+in\s+(?:the\s+)?(?:[\p{L}-]+\s+){0,2}(?:treatment|care|management|diagnosis|evaluation)\s+of\b/iu;
const CLINICAL_SENTENCE =
  /\bclinical\s+(?:specialt(?:y|ies)|interests?|expertise|focus|practice|care|services?)\b|\bspeciali[sz](?:es|ing|ed)?\s+in\b|\b(?:treats?|treating|cares?\s+for|sees)\s+(?:patients|adults|children)\b|\bpatient[- ]care\b|\bboard[- ]certified\b/i;
const SCHOLARLY_LINE =
  /\bpeer-reviewed\b|\brelated\s+publications?\b|\bcommon\s+publications?\b|\bclinical\s+trials?\b|\bcurrent\s+trials\b|\birb\s+id\b|\bjournal\s+service\b|^(?:research(?:\s+(?:interests?|summary|overview|focus))?|selected\s+publications|publications)$/i;
const RESEARCH_WORD_IN_PROSE =
  /\b(?:research(?:es|ing)?|stud(?:y|ies|ying)|investigat\w*|scholar\w*|publish\w*|trials?|grants?)\b/i;
const SCHOOL_BOILERPLATE_WITH_RESEARCH_WORD =
  /ysm\s+researchers?|research\s*&\s*innovation|read\s+on\s+yale\s+medicine|\bcommon\s+publications?\b|^research\s+at\s+a\s+glance$/i;
const CV_RECORD_LINE =
  /\((?:19|20)\d{2}\)\s*$|^\d{2}\/\d{2}\/(?:19|20)\d{2}|^(?:19|20)\d{2}\s*-\s*(?:present|(?:19|20)\d{2})|^[^.!?]{0,80}\b(?:award|scholarship|fellowship|prize)\s*$/i;
const INTEREST_PHRASE =
  /\b(?:interests?\s+(?:include|are|is)|(?:is|are)\s+(?:also\s+)?(?:particularly\s+|especially\s+)?interested\s+in|(?:has\s+)?(?:a\s+)?(?:particular|special)\s+interest\s+in|has\s+interests\s+in|I\s+have\s+interest\s+in|practice\s+(?:has\s+)?focus(?:es|ed)?\s+on)\b/i;
const RESEARCH_WORD = /\b(?:research\w*|stud(?:y|ies|ying)|investigat\w*|scholar\w*|trials?)\b/i;
const CLINICAL_BLOCK_END =
  /^(?:are you a patient\?|patient care locations|administrative support|academic office|view doctor profile)/i;
const OPENS_WITH_RESEARCH_VERB =
  /^(?:studies|investigates|examines|explores|researches|develops)\b/i;
const CLINICAL_TERM_SHARE = 0.5;

const linesOf = (text: string): string[] =>
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
const sentencesOf = (text: string): string[] =>
  linesOf(text).flatMap((line) => splitDescriptionSentences(line));

const isClinicalListText = (text: string): boolean =>
  linesOf(text).some((line) => CLINICAL_LIST_HEADING.test(line)) || CLINICAL_INLINE.test(text);

export const isClinicalInterestSentence = (sentence: string): boolean => {
  const text = sentence.normalize('NFKC').replace(/\s+/g, ' ');
  return INTEREST_PHRASE.test(text) && !RESEARCH_WORD.test(text);
};

const isBoilerplateOrCvRecord = (text: string): boolean =>
  SCHOOL_BOILERPLATE_WITH_RESEARCH_WORD.test(text) || CV_RECORD_LINE.test(text);

const isScholarlyLine = (line: string): boolean =>
  SCHOLARLY_LINE.test(line) || isPublicationCitationLine(line);

const isResearchSentence = (sentence: string): boolean =>
  !isBoilerplateOrCvRecord(sentence) &&
  (statesResearchSentence(sentence, WRITER_READING)
    ? !isClinicalInterestSentence(sentence)
    : RESEARCH_WORD_IN_PROSE.test(sentence));

/**
 * Whether the evidence states research anywhere other than a clinical-interest sentence:
 * a research statement, a publications or trials line, a citation, or a prose sentence that
 * names research, after a school's boilerplate and CV lines are set aside.
 */
function hasResearchSignal(text: string): boolean {
  return (
    linesOf(text).some((line) => !isBoilerplateOrCvRecord(line) && isScholarlyLine(line)) ||
    sentencesOf(text).some(
      (sentence) =>
        !(CLINICAL_SENTENCE.test(sentence) && !/\bresearch\b/i.test(sentence)) &&
        isResearchSentence(sentence),
    )
  );
}

/**
 * The evidence split into its clinical lines and the research-bearing text beside them.
 * Only research-bearing text counts as "other", because a department or title line, a
 * condition fact-sheet title or a society membership repeats the specialty words without
 * stating research, and counting it let a "Studies <specialty list>" draft through.
 */
function clinicalAndOtherText(text: string): { clinical: string[]; other: string[] } {
  const clinical: string[] = [];
  const other: string[] = [];
  let inBlock = false;
  for (const line of linesOf(text)) {
    if (CLINICAL_LIST_HEADING.test(line)) {
      inBlock = true;
      clinical.push(line);
      continue;
    }
    if (inBlock && CLINICAL_BLOCK_END.test(line)) inBlock = false;
    if (inBlock) {
      clinical.push(line);
      continue;
    }
    if (isScholarlyLine(line)) {
      other.push(line);
      continue;
    }
    const isClinical = (sentence: string) =>
      !RESEARCH_WORD.test(sentence) &&
      (CLINICAL_SENTENCE.test(sentence) || CLINICAL_INLINE.test(sentence));
    const sentences = sentencesOf(line);
    clinical.push(...sentences.filter(isClinical));
    other.push(
      ...sentences.filter((sentence) => !isClinical(sentence) && isResearchSentence(sentence)),
    );
  }
  return { clinical, other };
}

const shareCarried = (terms: readonly string[], words: readonly string[]): number =>
  terms.filter((term) => words.some((word) => sharesAnInflectionalStem(term, word))).length /
  terms.length;

/**
 * A person's clinical practice written up as research (#5537): on a row whose evidence lists
 * clinical specialties, a draft is refused when the evidence states no research at all, or
 * when it opens as research but takes its subject from the clinical lines rather than from the
 * rest of the evidence. The clinical list is the gate, because "specializes in" alone also
 * describes a scholar's field.
 */
export function isClinicalPracticeAsResearch(input: {
  description: string;
  snippets: ReadonlyArray<{ text: string; sourceName?: string }>;
  entityType?: unknown;
  kind?: unknown;
}): boolean {
  if (!input.description.trim()) return false;
  if (!isPersonResearchRow({ entityType: input.entityType, kind: input.kind })) return false;
  if (!input.snippets.some((snippet) => isClinicalListText(snippet.text))) return false;
  const hasGrant = input.snippets.some((snippet) => /\bgrant$/i.test(snippet.sourceName ?? ''));
  if (!hasGrant && !input.snippets.some((snippet) => hasResearchSignal(snippet.text))) return true;
  if (!OPENS_WITH_RESEARCH_VERB.test(input.description.trim())) return false;
  const parts = input.snippets.map((snippet) => clinicalAndOtherText(snippet.text));
  const clinicalWords = [
    ...new Set(parts.flatMap((part) => part.clinical.flatMap(writerContentTerms))),
  ];
  if (clinicalWords.length === 0) return false;
  const otherWords = [...new Set(parts.flatMap((part) => part.other.flatMap(writerContentTerms)))];
  const terms = [...new Set(writerContentTerms(input.description))];
  if (terms.length === 0) return false;
  return (
    shareCarried(terms, clinicalWords) >= CLINICAL_TERM_SHARE &&
    shareCarried(terms, otherWords) < CLINICAL_TERM_SHARE
  );
}
