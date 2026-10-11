import type { ResearchEntity } from '../types/researchEntity';
import { safeHttpUrl } from './url';

export const UNDERGRAD_QUOTE_LABEL = 'Mentions undergraduate research';

const CARD_QUOTE_MAX_CHARACTERS = 140;

export interface UndergradQuoteEvidence {
  quote: string;
  cardQuote: string;
  sourceUrl: string;
  sourceHost: string;
}

const hostOf = (url: string): string => new URL(url).hostname.replace(/^www\./, '');

const shortenQuote = (quote: string, maxCharacters: number): string => {
  if (quote.length <= maxCharacters) return quote;
  const cut = quote.slice(0, maxCharacters - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const wordBoundaryCut = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${wordBoundaryCut.replace(/[\s,;:.-]+$/, '')}…`;
};

/**
 * The served undergraduate quote with the page it cites, or nothing.
 *
 * #3569 measured served quotes at 42/50 = 0.84 badge precision, but only 25/50 show that
 * undergraduates were hosted, so a quote is never turned into a hosting claim. It is shown as
 * what it is, a cited passage the student can judge, and a quote with no citable page is not
 * shown at all. The server has already applied the serve-time guards before the quote arrives.
 */
export const undergradQuoteEvidenceFromEntity = (
  entity: ResearchEntity | undefined,
): UndergradQuoteEvidence | undefined => {
  const quote = (entity?.undergradEvidenceQuote || '').replace(/\s+/g, ' ').trim();
  const sourceUrl = safeHttpUrl(entity?.undergradEvidenceSourceUrl);
  if (!quote || !sourceUrl) return undefined;
  return {
    quote,
    cardQuote: shortenQuote(quote, CARD_QUOTE_MAX_CHARACTERS),
    sourceUrl,
    sourceHost: hostOf(sourceUrl),
  };
};
