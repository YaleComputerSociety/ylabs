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

const MIN_AFFIX_MATCHED_SURNAME_LENGTH = 4;

export const urlCarriesSurname = (pageUrl: string, surname: string): boolean =>
  comparableName(urlHostAndPath(pageUrl))
    .split(' ')
    .some((token) =>
      surname.length < MIN_AFFIX_MATCHED_SURNAME_LENGTH
        ? token === surname
        : token.startsWith(surname) || token.endsWith(surname),
    );

export const textNamesSurname = (text: string, surname: string): boolean => {
  const words = new Set(comparableName(text).split(' ').filter(Boolean));
  for (const word of words) {
    if (surnamesCompatible(word, surname)) return true;
  }
  return false;
};

export const isYaleHostedUrl = (pageUrl: string): boolean => {
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
  if (isYaleHostedUrl(input.sourceUrl)) return { decision: 'not_applicable', reason: 'yale_host' };
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
  if (leadNames.some((name) => textNamesSurname(input.text, leadSurname(name)))) {
    return { decision: 'admit', reason: 'text_names_lead' };
  }
  return { decision: 'refuse', reason: 'lead_not_confirmed' };
}
