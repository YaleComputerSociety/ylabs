import { isPersonalNameDomainWebsite } from '../../utils/personalNameWebsite';
import { personSurnamesFromDisplayNames } from '../../utils/researchHomeNameIdentityAuthority';
import { isYaleHostname } from '../../utils/yaleHost';
import { surnamesCompatible } from './piNameMatch';

export interface MicrositeLeadIdentity {
  names: readonly (string | undefined | null)[];
}

export interface NonYaleMicrositeOwnershipInput {
  sourceUrl: string;
  text: string;
  lead: MicrositeLeadIdentity;
}

export type NonYaleMicrositeOwnershipVerdict =
  | { decision: 'not_applicable'; reason: 'yale_host' | 'no_lead_surname' }
  | {
      decision: 'admit';
      reason: 'surname_in_url' | 'personal_name_domain' | 'text_names_lead';
    }
  | { decision: 'refuse'; reason: 'lead_not_confirmed' };

const withoutDiacriticsOrApostrophes = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019`]/g, '');

const comparableName = (value: string): string =>
  withoutDiacriticsOrApostrophes(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const leadSurname = (personName: string | undefined | null): string =>
  [...personSurnamesFromDisplayNames([withoutDiacriticsOrApostrophes(personName || '')])][0] ?? '';

const urlHostAndPath = (pageUrl: string): string => {
  try {
    const url = new URL(pageUrl);
    return `${url.host} ${url.pathname}`;
  } catch {
    return pageUrl;
  }
};

const RESEARCH_UNIT_WORDS = ['lab', 'labs', 'laboratory', 'group', 'research'];

const MIN_AFFIX_MATCHED_SURNAME_LENGTH = 5;

const withoutTrailingDigits = (token: string): string => token.replace(/\d+$/, '');

const surnameUrlTokens = (surname: string): Set<string> =>
  new Set([
    surname,
    ...RESEARCH_UNIT_WORDS.flatMap((unit) => [`${surname}${unit}`, `${unit}${surname}`]),
  ]);

export const urlCarriesSurname = (pageUrl: string, surname: string): boolean => {
  const accepted = surnameUrlTokens(surname);
  return comparableName(urlHostAndPath(pageUrl))
    .split(' ')
    .map(withoutTrailingDigits)
    .some(
      (token) =>
        accepted.has(token) ||
        (surname.length >= MIN_AFFIX_MATCHED_SURNAME_LENGTH &&
          (token.startsWith(surname) || token.endsWith(surname))),
    );
};

const HONORIFICS = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'mx']);

const leadOtherNameTokens = (personName: string, surname: string): Set<string> => {
  const tokens = comparableName(personName)
    .split(' ')
    .filter((token) => token !== '' && token !== surname && !HONORIFICS.has(token));
  return new Set(tokens.flatMap((token) => [token, token[0]]));
};

const NAME_CONTEXT_WORDS = 3;

export const textNamesLead = (text: string, personName: string): boolean => {
  const surname = leadSurname(personName);
  if (!surname) return false;
  const otherNameTokens = leadOtherNameTokens(personName, surname);
  const words = comparableName(text).split(' ').filter(Boolean);
  return words.some((word, index) => {
    if (!surnamesCompatible(word, surname)) return false;
    if (surname.length >= MIN_AFFIX_MATCHED_SURNAME_LENGTH) return true;
    const context = [
      ...words.slice(Math.max(0, index - NAME_CONTEXT_WORDS), index),
      words[index + 1],
    ];
    return context.some(
      (contextWord) => contextWord !== undefined && otherNameTokens.has(contextWord),
    );
  });
};

const isYaleHostedPage = (pageUrl: string): boolean => {
  try {
    return isYaleHostname(new URL(pageUrl).hostname);
  } catch {
    return false;
  }
};

/**
 * Whether a page off Yale's hosts is confirmed as the row lead's own, before its prose may
 * describe that lead's row (#5777). A non-Yale page reached only because a roster lane stored
 * it as the row's website carries no identity of its own, so it is admitted only when the lead
 * is confirmed by the page itself: the lead's surname in its address, a personal-name domain,
 * or its text naming the lead. Yale-hosted pages are outside this rule.
 */
export function nonYaleMicrositeOwnership(
  input: NonYaleMicrositeOwnershipInput,
): NonYaleMicrositeOwnershipVerdict {
  if (isYaleHostedPage(input.sourceUrl)) return { decision: 'not_applicable', reason: 'yale_host' };
  const leadNames = input.lead.names.filter(
    (name): name is string => typeof name === 'string' && leadSurname(name) !== '',
  );
  if (leadNames.length === 0) return { decision: 'not_applicable', reason: 'no_lead_surname' };
  if (leadNames.some((name) => urlCarriesSurname(input.sourceUrl, leadSurname(name)))) {
    return { decision: 'admit', reason: 'surname_in_url' };
  }
  if (leadNames.some((name) => isPersonalNameDomainWebsite(input.sourceUrl, name))) {
    return { decision: 'admit', reason: 'personal_name_domain' };
  }
  if (leadNames.some((name) => textNamesLead(input.text, name))) {
    return { decision: 'admit', reason: 'text_names_lead' };
  }
  return { decision: 'refuse', reason: 'lead_not_confirmed' };
}
