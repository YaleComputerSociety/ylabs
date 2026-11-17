const ROLLING = /\brolling\b/i;

const APPLICATION_CONTEXT =
  /\b(?:appl(?:y|ies|ied|ying|ications?|icants?)|deadlines?|review(?:ed|s|ing)?|basis|accept(?:ed|s|ing)?|submi(?:t|ts|tted|ssions?)|fund(?:s|ed|ing)?|awards?|awarded|admissions?|grants?|consider(?:ed|ation)?)\b/i;

const NEGATED_ROLLING = /\b(?:not|never|no)\b(?:\s+\w+){0,4}?\s+(?:on\s+a\s+)?rolling\b/i;

const SENTENCE_BREAK = /(?<=[.!?;])\s+/;

const PROGRAM_TEXT_FIELDS = [
  'summary',
  'description',
  'applicationInformation',
  'additionalInformation',
  'fullSourceDescription',
] as const;

const sentenceStatesRollingReview = (sentence: string): boolean =>
  ROLLING.test(sentence) && APPLICATION_CONTEXT.test(sentence) && !NEGATED_ROLLING.test(sentence);

/**
 * Whether a program's own text says its applications are reviewed on a rolling basis
 * (#6407), so a structured deadline beside it is the close of a rolling window rather than
 * the one date a student must meet. A sentence that negates it ("applications are not
 * reviewed on a rolling basis") states a fixed deadline and does not count.
 */
export function programStatesRollingReview(program: unknown): boolean {
  if (!program || typeof program !== 'object') return false;
  const record = program as Record<string, unknown>;
  return PROGRAM_TEXT_FIELDS.some((field) => {
    const text = record[field];
    if (typeof text !== 'string') return false;
    return text.replace(/\s+/g, ' ').split(SENTENCE_BREAK).some(sentenceStatesRollingReview);
  });
}
