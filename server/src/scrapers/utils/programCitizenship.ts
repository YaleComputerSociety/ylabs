/**
 * The citizenship a program's own prose states (#5129). The Student Grants Database's
 * "Citizenship Status" facet is set by whoever listed the fund and is the only other
 * source, so it misses a requirement stated in the fourth paragraph, contradicts a fund
 * text limited to citizens and permanent residents, and is absent on every other lane.
 */

export const US_CITIZENS_ELIGIBLE = 'U.S. citizens are eligible';
export const NON_US_CITIZENS_ELIGIBLE = 'Non-U.S. citizens are eligible';
export const US_PERMANENT_RESIDENTS_ELIGIBLE = 'U.S. permanent residents are eligible';

export type CitizenshipStatement =
  | { kind: 'us-only'; values: string[] }
  | { kind: 'open'; values: string[] }
  | { kind: 'non-us-only'; values: string[] };

const US = String.raw`(?:u\.?\s?s\.?(?:\s?a\.?)?|united states)`;

const US_ONLY_SENTENCE = new RegExp(
  [
    String.raw`\b(?:must|need to|required to) (?:be|hold) (?:an? )?${US} (?:citizens?|citizenship|nationals?)\b`,
    String.raw`\b(?:must|need to) be citizens of the united states\b`,
    String.raw`\b${US} citizenship (?:\[?or [^.\]]{0,40}\]? )?(?:is |are )?(?:required|necessary|mandatory)\b`,
    String.raw`\b(?:open|available|limited|restricted|awarded) (?:only )?to ${US} citizens\b`,
    String.raw`\b(?:only|exclusively) (?:for |to )?${US} citizens\b`,
    String.raw`\beligible (?:applicants |candidates |students )?(?:are|must be|include) (?:only )?${US} citizens\b`,
    String.raw`\bbe an? ${US} citizens?\b`,
  ].join('|'),
  'i',
);

const PROOF_OF_US_CITIZENSHIP = new RegExp(String.raw`\bproof of ${US} citizenship\b`, 'i');

const US_CITIZEN_GROUP = new RegExp(String.raw`\bwho are ${US} citizens\b`, 'i');

const ELIGIBILITY_CUE = /\b(?:eligible|open to|must|only|limited)\b/i;

const ANOTHER_GROUP = /\b(?:others|international (?:students|applicants))\b/i;

const NEGATION = /\b(?:not need|(?:do|does)(?: not|n't) (?:need|have) to|not required|need not|regardless)\b/i;

const OPEN_SENTENCE = new RegExp(
  [
    String.raw`\bregardless of (?:their )?(?:citizenship|nationality|immigration status)\b`,
    String.raw`\bwithout regard to (?:their )?(?:citizenship|nationality)\b`,
    String.raw`\bno citizenship (?:requirements?|restrictions?)\b`,
    String.raw`\bstudents of any (?:nationality|citizenship)\b`,
    String.raw`\b(?:international|non-?\s?u\.?\s?s\.?) (?:students|citizens|applicants) (?:are|is) (?:also )?(?:eligible|welcome)\b`,
    String.raw`\b${US} and non-?\s?${US} citizens are (?:both )?eligible\b`,
    String.raw`\binternational students with (?:a )?(?:qualifying|valid) (?:visas?|status)\b`,
  ].join('|'),
  'i',
);

const NON_US_ONLY_SENTENCE = new RegExp(
  [
    String.raw`\b${US} citizens?\b(?:(?!\b(?:are|is|but|while)\b)[^,;]){0,60}\b(?:are|is) (?:not eligible|ineligible)\b`,
    String.raw`\bintended for (?:yale )?international (?:undergraduate |graduate )?students only\b`,
  ].join('|'),
  'i',
);

const PREFERENCE = /\b(?:prefer(?:ence|red)?|priority)\b/i;

const PERMANENT_RESIDENT = /\bpermanent residen(?:ts?|cy|ce)\b|\bgreen card\b/i;

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])(?<!\b[Uu]\.[Ss]\.(?:[Aa]\.)?)\s+(?=[A-Z([])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function restrictsToUsCitizens(sentence: string): boolean {
  const match =
    US_ONLY_SENTENCE.exec(sentence) ??
    (ANOTHER_GROUP.test(sentence)
      ? null
      : (PROOF_OF_US_CITIZENSHIP.exec(sentence) ??
        (ELIGIBILITY_CUE.test(sentence) ? US_CITIZEN_GROUP.exec(sentence) : null)));
  return match !== null && !NEGATION.test(sentence.slice(0, match.index + match[0].length));
}

/**
 * Each sentence is judged alone. A preference ("preference for applicants who are U.S.
 * citizens") or a condition on one group ("international students researching in their
 * home country are ineligible") states nothing, and a page whose sentences disagree
 * states nothing either, so the listing facet stands.
 */
export function programCitizenshipStatement(prose: string[]): CitizenshipStatement | undefined {
  let usOnly = false;
  let open = false;
  let nonUsOnly = false;
  let permanentResidents = false;
  for (const sentence of prose.flatMap(sentencesOf)) {
    if (PREFERENCE.test(sentence)) continue;
    if (NON_US_ONLY_SENTENCE.test(sentence)) {
      nonUsOnly = true;
    } else if (OPEN_SENTENCE.test(sentence)) {
      open = true;
    } else if (restrictsToUsCitizens(sentence)) {
      usOnly = true;
      if (PERMANENT_RESIDENT.test(sentence)) permanentResidents = true;
    }
  }
  if ([usOnly, open, nonUsOnly].filter(Boolean).length !== 1) return undefined;
  if (nonUsOnly) return { kind: 'non-us-only', values: [NON_US_CITIZENS_ELIGIBLE] };
  if (open) return { kind: 'open', values: [US_CITIZENS_ELIGIBLE, NON_US_CITIZENS_ELIGIBLE] };
  return {
    kind: 'us-only',
    values: permanentResidents
      ? [US_CITIZENS_ELIGIBLE, US_PERMANENT_RESIDENTS_ELIGIBLE]
      : [US_CITIZENS_ELIGIBLE],
  };
}
