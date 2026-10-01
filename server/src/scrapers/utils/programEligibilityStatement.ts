/**
 * The eligibility statement a program page makes: the sentences that say who may apply,
 * in page order (#4233).
 *
 * A sentence qualifies when it states an admission ("are eligible to apply", "open to",
 * "invites applications from", "awarded to") or names the student population an award
 * is for ("to support graduate students"), and when it names an applicant. The applicant
 * test is what keeps "This project is eligible for remote work." out, and a line that does
 * not end as a sentence is a heading or a staff title rather than a statement. A note or a
 * conditional ("if you are a senior, the conference must...") qualifies a different
 * benefit, so it is left out too. A sentence that
 * carries contact data is never kept, because a staff contact line read as eligibility
 * publishes a person on the card (#4177), so the statement fails closed on it.
 */

const ADMISSION_CUES = [
  String.raw`\beligib(?:le|ility)\b`,
  String.raw`\bopen(?: only)? to\b`,
  String.raw`\b(?:is|are) (?:not )?available(?: only)? to\b`,
  String.raw`\b(?:is|are) designed for\b`,
  String.raw`\b(?:limited|restricted|reserved) to\b`,
  String.raw`\bawarded(?: only)? to\b`,
  String.raw`\b(?:invites?|welcomes?|accepts?) applications?\b(?:\s+\S+){0,8}?\s+from\b`,
  String.raw`\bapplications? will be (?:accepted|considered) from\b`,
  String.raw`\b(?:may|can) apply\b(?!\s+(?:to|for)\b)`,
  String.raw`\b(?:is|are) welcome to apply\b`,
  String.raw`\b(?:selected|chosen) from(?: among)?\b`,
];

const LEVEL_SOURCE = String.raw`(?:(?:undergraduate|graduate|doctoral|professional)\b|ph\.?\s?d\b\.?)`;

const POPULATION_CUES = [
  String.raw`\b(?:for|to support|supports?|to an?|to)\s+(?:(?:all|any|current|currently|enrolled|yale|university|college|the)\s+)*${LEVEL_SOURCE}[^.;]{0,60}?\bstudents?\b`,
  String.raw`\b(?:for|to)\s+(?:yale\s+)?students\s+(?:with|who|entering|enrolled)\b`,
];

const ELIGIBILITY_CUE = new RegExp([...ADMISSION_CUES, ...POPULATION_CUES].join('|'), 'i');

const APPLICANT =
  /\b(?:students?|undergraduates?|graduates|applicants?|candidates?|first[- ]years?|sophomores?|juniors?|seniors?|underclassmen|fellows?|scholars?|majors?|citizens(?:hip)?|residents|you)\b/i;

const CONTACT_DATA =
  /@|\bhttps?:\/\/|\bwww\.|\b(?:e-?mail|contact|phone|call|telephone)\b|\+?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/i;

const SENTENCE_BOUNDARY =
  /(?<!\b(?:[A-Z]\.){2,}|\b(?:Dr|Mr|Mrs|Ms|Prof|St|No|vs)\.)(?<=[.!?])\s+(?=["“(*]*[A-Z])/;

const ENDS_AS_STATEMENT = /[.!?:]["”')\]]*$/;

const ASIDE_OPENING = /^\W*(?:note\b|if\b|when\b|unless\b)/i;

const MAX_SENTENCE_CHARS = 400;

const MAX_STATEMENT_SENTENCES = 3;

const MAX_STATEMENT_CHARS = 600;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

function sentencesOf(block: string): string[] {
  return normalizeWhitespace(block)
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function isEligibilitySentence(sentence: string): boolean {
  return (
    sentence.length <= MAX_SENTENCE_CHARS &&
    ENDS_AS_STATEMENT.test(sentence) &&
    !ASIDE_OPENING.test(sentence) &&
    ELIGIBILITY_CUE.test(sentence) &&
    APPLICANT.test(sentence) &&
    !CONTACT_DATA.test(sentence)
  );
}

/**
 * Each block is read on its own, so a heading or list item never runs into the sentence
 * after it.
 */
export function eligibilitySentences(blocks: readonly string[]): string[] {
  const kept: string[] = [];
  let length = 0;
  for (const sentence of blocks.flatMap(sentencesOf)) {
    if (kept.length >= MAX_STATEMENT_SENTENCES) break;
    if (!isEligibilitySentence(sentence) || kept.includes(sentence)) continue;
    if (length + sentence.length > MAX_STATEMENT_CHARS) break;
    kept.push(sentence);
    length += sentence.length + 1;
  }
  return kept;
}

export function eligibilityStatement(sentences: readonly string[]): string | undefined {
  return sentences.length > 0 ? sentences.join(' ') : undefined;
}
