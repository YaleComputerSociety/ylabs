import { redactDirectContactInfo } from '../utils/contactRedaction';

const CONTACT_TOKEN_PATTERNS: readonly RegExp[] = [
  /\[(?:contact )?(?:email|phone) redacted\](?:@[\w.-]+)?/g,
  /\[email\W?protected\]/g,
  /\bhttps?:\/\/\S+|\bwww\.\S+/g,
  /\S+\s?(?:\(at\)|\[at\]|\{at\})\s?\S+/g,
  /\S+\s(?:at|AT)\s(?:yale|gmail)\b\S*(?:\s(?:dot|DOT)\s\w+)*/g,
  /\(copy\)|\bcopy\b/gi,
];

const DIRECTIVE_PATTERN =
  /\b(?:e-?mail(?:ing)?|contact(?:ing)?|reach(?:ing)? out|reach|get(?:ting)? in touch|let (?:me|us) know|send(?:ing)?|submit(?:ting)?|apply(?:ing)?|writ(?:e|ing)|call|visit|inquire|enquire|ask|join|reply|request|schedule|register|sign up|fill out|complete|check|chat|talk|speak|meet)\b/i;

const PURPOSE_PATTERN =
  /\b(?:to (?:apply|join|learn|inquire|enquire|discuss|request|schedule|arrange|ask|get|find|be|work|volunteer|participate|express|set up|sign up|register|receive|submit|send|contact|reach|explore|hear|see|make|propose|post|determine)|if\b|interested|should|must|please|welcome|encouraged|invited|feel free|for (?:more|additional|further|any|an? appointment|opportunities|positions|questions|information|details|inquiries|enquiries|current)\b|with (?:any |your |a |the )?(?:questions|inquiries|enquiries|queries|comments|concerns)\b|for [\w ,]{0,60}(?:inquiries|enquiries|questions)|regarding|how to|questions\?|about (?:joining|working|opportunities|positions|openings|research|the lab|our|current|participating))/i;

const MATERIALS_PATTERN =
  /\b(?:send|submit|include|attach|e-?mail|with|and)\b[^.]{0,80}\b(?:cv|c\.v\.|resume|résumé|cover letter|statement|transcripts?|references|letter of|application|subject line|description of|(?:short|brief) (?:note|message|introduction|summary))/i;

const ADDRESSEE = String.raw`(?:me|us|him|her|them|the [\w-]+|our [\w-]+|(?:dr\.?|prof\.?|professor)?\s*[A-Z][\w'’.-]*(?:\s[A-Z][\w'’.-]*){0,2})`;

const SELF_SUFFICIENT_INSTRUCTION_PATTERNS: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:[Cc]ontact|[Ee]-?mail|[Cc]all|[Ww]rite to|[Rr]each out to|[Rr]each)\s+${ADDRESSEE}(?:\s*,)?\s+(?:at|via|by|through|on)\b`,
  ),
  /\b(?:[Cc]ontact|[Ee]-?mail|[Cc]all|[Ww]rite to)\s+(?:me|us)\s+(?:for|to|if|with|about|regarding)\b/,
  /\b[Ss]end (?:me|us) an? (?:e-?mail|message|note)\b/,
  /\b(?:[Ii]nquiries|[Qq]uestions|[Aa]pplications) should be (?:sent|made|directed|addressed|submitted)\b/,
  /\b(?:[Oo]penings|[Pp]ositions|[Jj]obs|[Oo]pportunities) (?:can be found|are (?:posted|listed|advertised)) (?:on|at|through|via)\b/,
  /\b(?:[Aa]pplication instructions|[Ff]ollow the instructions|[Cc]an be reached)\b/,
  /\b[Rr]each out to\s+\S/,
  /\b(?:[Aa]pply|[Rr]egister|[Ss]ign up|[Cc]ontact us|[Rr]equest)\s+(?:using|through|via|with|on)\s+(?:the|this|our|an?)\b[^.]{0,30}\b(?:form|portal|page|link|application)\b/,
  /\b[Uu]se (?:the|this|our) [\w ]{0,20}\b(?:form|portal)\b/,
];

const DECLINED_CONTACT_PATTERN =
  /\b(?:do not|don't|not to|unable to respond)\s+(?:e-?mail|contact|call|apply|send|respond|reach)/i;

const ABBREVIATION_SAFE_SENTENCE_BREAK =
  /(?<!\b(?:Dr|Prof|Mr|Mrs|Ms|St|Ave|Rd|Jr|Sr|No|vs|e\.g|i\.e|Ph\.D|M\.D)\.)(?<=[.!?;])\s+/;

function withoutContactTokens(text: string): string {
  return CONTACT_TOKEN_PATTERNS.reduce(
    (remaining, pattern) => remaining.replace(pattern, ' '),
    redactDirectContactInfo(text),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function clauseStatesAnInstruction(clause: string): boolean {
  if (DECLINED_CONTACT_PATTERN.test(clause)) return false;
  if (SELF_SUFFICIENT_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(clause))) return true;
  if (!DIRECTIVE_PATTERN.test(clause)) return false;
  return PURPOSE_PATTERN.test(clause) || MATERIALS_PATTERN.test(clause);
}

export function contactQuoteStatesAnInstruction(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return withoutContactTokens(value)
    .split(ABBREVIATION_SAFE_SENTENCE_BREAK)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .some(clauseStatesAnInstruction);
}
