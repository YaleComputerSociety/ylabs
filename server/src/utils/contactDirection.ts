/**
 * A contact direction names who to ask, often a staff member, rather than who may apply
 * (#4177), and contact data fails closed. The enquiry itself must be what is directed,
 * because a requirement such as "Recipients must email a final report" or "must email a
 * proposal answering the questions below" uses a contact verb and an enquiry word too.
 */
import { normalizeHygieneWhitespace, partitionSentencesForFiltering } from './descriptionHygiene';

const EMAIL_ADDRESS = /(?:mailto:)?[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
const EMAIL_PLACEHOLDER = '\u2063email\u2063';
const POLITE_CONTACT_REQUEST =
  /\bplease\s+(?:contact|e-?mail|call|write\s+to|reach\s+out|direct\b|send\s+(?:any\s+)?(?:questions|inquiries))/i;
const ENQUIRY_NOUN =
  '(?:questions?|inquir(?:y|ies)|enquir(?:y|ies)|concerns?|(?:more|further|additional)\\s+information)';
const ENQUIRY = new RegExp(`\\b${ENQUIRY_NOUN}\\b`, 'i');
const CONTACT = /\bcontact(?:ed|ing)?\b/i;
const ENQUIRY_LEAD_IN = new RegExp(
  `^(?:for|with|if\\s+you\\s+have)\\s+(?:any\\s+)?(?:\\w+\\s+)?${ENQUIRY_NOUN}\\b`,
  'i',
);
const CONTACT_VERB =
  /\b(?:contact(?:ed|ing)?|address(?:ed)?\s+to|direct(?:ed)?\s+to|sent\s+to|reach\s+out|e-?mail(?:ed)?)\b/i;
const ENQUIRY_ROUTED = new RegExp(
  `\\b${ENQUIRY_NOUN}\\b[^.]*?\\b(?:should|may|can|will)\\s+be\\s+(?:addressed|directed|sent|forwarded|e-?mailed)\\s+to\\b`,
  'i',
);
const ENQUIRY_SENT = new RegExp(
  `\\b(?:send|direct|address|forward|e-?mail)\\s+(?:any\\s+|all\\s+|your\\s+)?${ENQUIRY_NOUN}\\s+to\\b`,
  'i',
);
const CONTACT_LABEL = /^contact(?:\s+(?:information|info|person|persons|us))?\s*(?::|$)/i;
const IMPERATIVE_CONTACT = /^(?:e-?mail|write\s+to|call(?!\s+for\b))\b/i;
const BARE_ENQUIRY = new RegExp(`^(?:any\\s+)?${ENQUIRY_NOUN}\\s*[?:]?$`, 'i');

const withEmailPlaceholders = (text: string): string =>
  text.replace(EMAIL_ADDRESS, EMAIL_PLACEHOLDER);

export function isContactDirectionSentence(sentence: string): boolean {
  const text = normalizeHygieneWhitespace(withEmailPlaceholders(sentence));
  if (!text) return false;
  return (
    CONTACT_LABEL.test(text) ||
    IMPERATIVE_CONTACT.test(text) ||
    BARE_ENQUIRY.test(text) ||
    text.includes(EMAIL_PLACEHOLDER) ||
    POLITE_CONTACT_REQUEST.test(text) ||
    (ENQUIRY.test(text) && CONTACT.test(text)) ||
    (ENQUIRY_LEAD_IN.test(text) && CONTACT_VERB.test(text)) ||
    ENQUIRY_ROUTED.test(text) ||
    ENQUIRY_SENT.test(text)
  );
}

export interface ProseWithoutContactDirections {
  text: string;
  droppedSentences: number;
}

export function withoutContactDirections(blocks: readonly string[]): ProseWithoutContactDirections {
  let droppedSentences = 0;
  const keptBlocks: string[] = [];
  for (const block of blocks) {
    const sentences = partitionSentencesForFiltering(withEmailPlaceholders(block));
    const kept = sentences.filter((sentence) => !isContactDirectionSentence(sentence));
    droppedSentences += sentences.length - kept.length;
    const keptText = normalizeHygieneWhitespace(kept.join(''));
    if (keptText) keptBlocks.push(keptText);
  }
  return { text: keptBlocks.join(' '), droppedSentences };
}
