import { redactPhoneNumbers } from './contactRedaction';

const REDACTED_EMAIL = '[email redacted]';
const DIRECT_EMAIL_CAPTURE = String.raw`([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})`;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The quote with each `[email redacted]` replaced by the address it stood for on the
 * page it was copied from. The model reads contact-redacted text, so its quotes carry
 * the placeholder; a quote that cannot be located on the page is returned unchanged.
 */
export function quoteWithPageEmailsRestored(redactedQuote: string, rawPageText: string): string {
  if (!redactedQuote.includes(REDACTED_EMAIL)) return redactedQuote;
  const quote = collapseWhitespace(redactedQuote);
  const pattern = new RegExp(
    quote.split(REDACTED_EMAIL).map(escapeRegExp).join(DIRECT_EMAIL_CAPTURE).replace(/ /g, '\\s+'),
  );
  const addresses = pattern.exec(collapseWhitespace(redactPhoneNumbers(rawPageText)))?.slice(1);
  if (!addresses) return redactedQuote;
  let index = 0;
  return quote.replace(/\[email redacted\]/g, () => addresses[index++] ?? REDACTED_EMAIL);
}
