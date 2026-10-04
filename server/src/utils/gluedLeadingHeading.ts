const LAB_HEADING_BEFORE_TITLED_NAME =
  /^(?:The\s+)?(?:\p{Lu}[\p{L}'’-]*\s+){1,4}(?:Lab|Laboratory|Group)\s+(?=(?:Dr\.?|Professor|Prof\.)\s+\p{Lu})/u;

const FIRST_PERSON_SENTENCE_OPENER = /^(?:Our|We|My)$/;

const WORD_THAT_CONTINUES_A_SENTENCE =
  /^(?:and|or|nor|but|so|yet|that|which|who|whom|where|when|while|because|as|if|how|what|than|the|a|an|of|in|into|to|for|with|at|by|from|on|about|like|is|are|was|were)$/i;

const FINITE_VERB = /^(?:is|are|was|were|has|have|had)$/i;

const MIN_HEADING_WORDS = 2;
const MAX_HEADING_WORDS = 10;

function firstPersonOpenerAfterHeading(text: string): number {
  const firstSentence = text.split(/(?<=[.!?])\s/u)[0];
  const words = firstSentence.split(' ');
  const lastCandidate = Math.min(MAX_HEADING_WORDS, words.length - 2);
  for (let index = MIN_HEADING_WORDS; index <= lastCandidate; index += 1) {
    if (!FIRST_PERSON_SENTENCE_OPENER.test(words[index])) continue;
    const heading = words.slice(0, index);
    const previous = heading[heading.length - 1];
    if (/[,;:/—–-]$/u.test(previous) || WORD_THAT_CONTINUES_A_SENTENCE.test(previous)) return -1;
    if (previous.length === 1) return -1;
    if (heading.some((word) => word.includes('/') || FINITE_VERB.test(word))) return -1;
    return heading.join(' ').length + 1;
  }
  return -1;
}

export function withoutGluedLeadingHeading(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  const labHeading = LAB_HEADING_BEFORE_TITLED_NAME.exec(text);
  if (labHeading) return text.slice(labHeading[0].length);
  const openerOffset = firstPersonOpenerAfterHeading(text);
  return openerOffset > 0 ? text.slice(openerOffset) : value;
}
