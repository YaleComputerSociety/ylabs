import { sharesAnInflectionalStem } from '../../utils/groundedCardSynthesis';
import {
  foldWriterTextForms,
  researchPageHeadings,
  writerContentTerms,
  writerWordTokens,
} from './writerEvidenceText';

export interface WrittenDescriptionEvidence {
  text: string;
  isResearchPageText: boolean;
}

const hasWordSharingStem = (term: string, words: readonly string[]): boolean =>
  words.some((word) => sharesAnInflectionalStem(term, word));

export function ungroundedContentTerms(
  description: string,
  evidence: readonly WrittenDescriptionEvidence[],
): string[] {
  const evidenceWords = [...new Set(evidence.flatMap((entry) => writerWordTokens(entry.text)))];
  const evidenceCompact = evidence.map((entry) => writerWordTokens(entry.text).join('')).join(' ');
  return [
    ...new Set(
      writerContentTerms(description).filter(
        (term) => !hasWordSharingStem(term, evidenceWords) && !evidenceCompact.includes(term),
      ),
    ),
  ];
}

export const RESEARCH_PAGE_FREQUENT_TERM_COUNT = 5;
const MIN_FREQUENT_TERM_OCCURRENCES = 2;

export function researchPageFrequentTerms(pageTexts: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const term of pageTexts.flatMap(writerContentTerms)) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_FREQUENT_TERM_OCCURRENCES)
    .sort(([a, left], [b, right]) => right - left || a.localeCompare(b))
    .slice(0, RESEARCH_PAGE_FREQUENT_TERM_COUNT)
    .map(([term]) => term);
}

export function coversResearchPage(
  description: string,
  evidence: readonly WrittenDescriptionEvidence[],
): boolean {
  const pageTexts = evidence.filter((entry) => entry.isResearchPageText).map((e) => e.text);
  if (pageTexts.length === 0) return true;
  const bodyWords = writerWordTokens(description);
  const headingTerms = [...new Set(pageTexts.flatMap(researchPageHeadings))]
    .map(writerContentTerms)
    .filter((terms) => terms.length > 0);
  const frequentTerms = researchPageFrequentTerms(pageTexts);
  if (headingTerms.length === 0 && frequentTerms.length === 0) return true;
  if (headingTerms.some((terms) => terms.every((term) => hasWordSharingStem(term, bodyWords)))) {
    return true;
  }
  return frequentTerms.some((term) => hasWordSharingStem(term, bodyWords));
}

const FIRST_PERSON = [
  /\b(?:we|our|ours|ourselves|my|mine|myself)\b/i,
  /\bus\b/,
  /\bme\b/,
  /\bI(?:'m|'ve|'d)?\s+(?:am|was|have|had|study|studied|research|work|lead|direct|use|develop|investigate|focus|also|aim|seek|explore|examine)\b/,
];

export function hasFirstPerson(description: string): boolean {
  const text = foldWriterTextForms(description);
  return FIRST_PERSON.some((pattern) => pattern.test(text));
}

const GENERIC_SECTION_HEADING =
  /(?:Research(?:\s+(?:Overview|Interests?|Areas?|Focus|Projects?|Themes?|Summary))?|About(?:\s+(?:Us|the\s+Lab))?|Overview|Our\s+Research|Mission|Current\s+Projects?|Welcome)/;
const SENTENCE_OPENER = '(?:The|We|Our|This|These|In|At|A|An|Using|Lab|Laboratory)\\b';
const FUSED_GENERIC_HEADING = new RegExp(
  `(?:^|[.!?]\\s+)${GENERIC_SECTION_HEADING.source}\\s+${SENTENCE_OPENER}`,
);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Matched case-sensitively against a sentence opener, because the same words in running
 * prose ("studies coral reef recovery. The lab ...") are not a fused heading.
 */
export function hasFusedPageHeading(
  description: string,
  evidence: readonly WrittenDescriptionEvidence[],
): boolean {
  const text = foldWriterTextForms(description);
  if (FUSED_GENERIC_HEADING.test(text)) return true;
  const headings = [
    ...new Set(
      evidence
        .filter((entry) => entry.isResearchPageText)
        .flatMap((e) => researchPageHeadings(e.text)),
    ),
  ];
  return headings.some((heading) =>
    new RegExp(`${escapeRegExp(heading)}\\s+${SENTENCE_OPENER}`).test(text),
  );
}

const GREETING =
  /\bwelcome\s+to\b|^welcome\b|\bthanks?\s+(?:you\s+)?for\s+(?:visiting|your\s+interest|stopping\s+by)\b|\b(?:hello|greetings|hi)\s*[,!]/i;

export function hasGreetingText(description: string): boolean {
  return GREETING.test(foldWriterTextForms(description));
}
