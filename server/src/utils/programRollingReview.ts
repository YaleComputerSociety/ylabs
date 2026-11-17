const ROLLING = /\brolling\b/i;

const APPLICATION_CONTEXT =
  /\b(?:appl(?:y|ies|ied|ying|ications?|icants?)|deadlines?|review(?:ed|s|ing)?|basis|accept(?:ed|s|ing)?|submi(?:t|ts|tted|ssions?)|fund(?:s|ed|ing)?|awards?|awarded|admissions?|grants?|consider(?:ed|ation)?)\b/i;

const NEGATED_ROLLING = /\b(?:not|never|no)\b(?:\s+\w+){0,4}?\s+(?:on\s+a\s+)?rolling\b/i;

const ROLLING_DEADLINE = /\brolling\W{0,2}\s*deadlines?\b/i;

const RECURRING_CUTOFF = /\b(?:each|every)\s+(?:month|week)\b|\bmonthly\b/i;

const SENTENCE_BREAK = /(?<=[.!?;])\s+/;

const PROGRAM_TEXT_FIELDS = [
  'summary',
  'description',
  'applicationInformation',
  'additionalInformation',
  'fullSourceDescription',
] as const;

const sentenceStatesRollingReview = (sentence: string): boolean =>
  ROLLING.test(sentence) &&
  APPLICATION_CONTEXT.test(sentence) &&
  !NEGATED_ROLLING.test(sentence) &&
  !RECURRING_CUTOFF.test(sentence);

/**
 * Whether a program's own text says its applications are reviewed on a rolling basis
 * (#6407), so a structured deadline beside it is the close of a rolling window rather than
 * the one date a student must meet. A sentence that negates it ("applications are not
 * reviewed on a rolling basis") states a fixed deadline, and a "rolling deadline" that recurs
 * each month is a cycle of cutoffs rather than one open window, so neither counts.
 */
export function programStatesRollingReview(program: unknown): boolean {
  if (!program || typeof program !== 'object') return false;
  const record = program as Record<string, unknown>;
  const texts = PROGRAM_TEXT_FIELDS.map((field) => record[field]).filter(
    (text): text is string => typeof text === 'string',
  );
  if (texts.some((text) => ROLLING_DEADLINE.test(text) && RECURRING_CUTOFF.test(text))) return false;
  return texts.some((text) =>
    text.replace(/\s+/g, ' ').split(SENTENCE_BREAK).some(sentenceStatesRollingReview),
  );
}
