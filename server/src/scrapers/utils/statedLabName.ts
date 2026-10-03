import {
  NO_SURNAME_ROSTER,
  claimsAnotherPersonsLab,
  classifyHarvestedResearchHomeName,
  namesASelfDeclaredLaboratory,
  personIdentityTokens,
} from '../../utils/researchHomeNameIdentityAuthority';

const NAME_WORD = String.raw`[A-Z][\p{L}\p{N}'’&.-]*`;
const NAME_CONNECTOR = String.raw`(?:of|and|for|in|on|&)`;
const NAME_CONTINUES = String.raw`\s+(?:(?:of|and|for|&)\s+)?[A-Z]`;
const SUBJECT = String.raw`((?:(?:Dr|Prof|Professor)\.?\s+)?${NAME_WORD}(?:\s+${NAME_WORD}){0,3})`;
const LEADERSHIP_VERB = String.raw`(?:directs|leads|heads|founded\s+and\s+(?:directs|leads)|is\s+the\s+(?:founding\s+)?(?:director|head|principal\s+investigator)\s+of)`;
const LAB_NAME = String.raw`(${NAME_WORD}(?:\s+(?:${NAME_CONNECTOR}\s+)?${NAME_WORD}){0,5}?\s+(?:Lab|Laboratory))(?![\p{L}\p{N}])(${NAME_CONTINUES})?`;
const HEAD_FIRST_LAB_NAME = String.raw`((?:Lab|Laboratory|Group)\s+(?:of|for)\s+[A-Z])`;
const OTHER_RESEARCH_HOME_NAME = String.raw`(${NAME_WORD}(?:\s+(?:${NAME_CONNECTOR}\s+)?${NAME_WORD}){0,5}?\s+Group)(?![\p{L}\p{N}])`;
const NAME_PHRASE_ENDS_RE =
  /(?:\s*(?:[,.;:!?)\]—–]|$)|\s+(?:at|in|on|with|that|which|where|whose|who|to|is|was|has|have|and|an?|the|since|from|focus\w*|stud\w*|investigat\w*|examin\w*|explor\w*|uses?|using|seeks?|aims?)\b)/uy;
const NON_RESEARCH_LAB_RE =
  /\b(?:teaching|instructional|course|classroom|demonstration|simulation|skills)\b|^(?:animal|computer|wet|dry|shared|undergraduate)\s+lab(?:oratory)?$/i;

const LEADERSHIP_STATEMENT_RE = new RegExp(
  String.raw`${SUBJECT}\s+(?:(?:also|currently|now)\s+)?${LEADERSHIP_VERB}\s+the\s+(?:${LAB_NAME}|${HEAD_FIRST_LAB_NAME}|${OTHER_RESEARCH_HOME_NAME})`,
  'gu',
);

function subjectIsThePerson(subject: string, personName: string): boolean {
  const personTokens = personIdentityTokens(personName);
  const surname = personTokens[personTokens.length - 1];
  if (!surname) return false;
  const subjectTokens = personIdentityTokens(subject);
  return (
    subjectTokens[subjectTokens.length - 1] === surname &&
    subjectTokens.every((token) => personTokens.includes(token))
  );
}

function namePhraseEndsAt(text: string, index: number): boolean {
  NAME_PHRASE_ENDS_RE.lastIndex = index;
  return NAME_PHRASE_ENDS_RE.test(text);
}

function isAdoptableStatedLabName(name: string, personName: string, pageUrl: string): boolean {
  if (NON_RESEARCH_LAB_RE.test(name)) return false;
  if (!namesASelfDeclaredLaboratory(name)) return false;
  return (
    classifyHarvestedResearchHomeName({
      harvestedName: name,
      personName,
      knownPersonSurnames: NO_SURNAME_ROSTER,
      recordCitedUrls: [pageUrl],
    }) === 'OWN_IDENTITY'
  );
}

/**
 * The lab a person's own page says that person leads, read only from a sentence
 * whose subject is the person and whose verb is a leadership verb ("directs",
 * "leads", "is the director of"). A lab the page merely mentions, a link label,
 * and a name the page attributes to someone else are never a stated name, and a
 * page stating two different labs states neither.
 */
export function labNameStatedForPerson(args: {
  text: string;
  personName: string;
  pageUrl: string;
}): string | undefined {
  const stated = new Map<string, string>();
  for (const match of args.text.matchAll(LEADERSHIP_STATEMENT_RE)) {
    const [, subject, labName, nameContinues, headFirstLabName, otherResearchHomeName] = match;
    if (!subjectIsThePerson(subject, args.personName)) continue;
    if (nameContinues || headFirstLabName || otherResearchHomeName) return undefined;
    if (!namePhraseEndsAt(args.text, (match.index ?? 0) + match[0].length)) return undefined;
    const name = labName.replace(/\s+/g, ' ').trim();
    if (!isAdoptableStatedLabName(name, args.personName, args.pageUrl)) return undefined;
    stated.set(name.toLowerCase(), name);
  }
  return stated.size === 1 ? [...stated.values()][0] : undefined;
}

export function statedLabNameClaimsAnotherPerson(args: {
  statedLabName: string;
  personName: string;
  knownPersonSurnames: ReadonlySet<string>;
}): boolean {
  return claimsAnotherPersonsLab({
    harvestedName: args.statedLabName,
    websiteUrl: undefined,
    identityTokens: personIdentityTokens(args.personName),
    knownPersonSurnames: args.knownPersonSurnames,
  });
}
