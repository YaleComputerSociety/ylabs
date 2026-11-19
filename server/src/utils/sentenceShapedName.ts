const SENTENCE_OPENING_PHRASE_RE =
  /^(?:thank\s+you|thanks|please|click\s+here|learn\s+more|read\s+more)\b/i;

const TERMINAL_SENTENCE_PUNCTUATION_RE = /[.!?]$/;

const ABBREVIATION_ENDING_RE =
  /(?:^|[\s(.])(?:inc|co|corp|ltd|llc|plc|jr|sr|st|dr|no|vs|etc|al|[a-z])\.$/i;

export const MIN_TERMINALLY_PUNCTUATED_SENTENCE_WORDS = 4;

/**
 * A research row's name that reads as a sentence rather than a name: it opens with a
 * thank-you, please, click-here, learn-more or read-more phrase, or it has at least four words
 * and ends in `.`, `!` or `?` that is not an abbreviation's period. A lane can read a page's
 * welcome or call-to-action line as the organization's name (#5739); the re-landed
 * `lab-site-research-read` name reader is meant to import this rather than copy it.
 */
export function isSentenceShapedName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) return false;
  if (SENTENCE_OPENING_PHRASE_RE.test(name)) return true;
  return (
    TERMINAL_SENTENCE_PUNCTUATION_RE.test(name) &&
    !ABBREVIATION_ENDING_RE.test(name) &&
    name.split(' ').length >= MIN_TERMINALLY_PUNCTUATED_SENTENCE_WORDS
  );
}
