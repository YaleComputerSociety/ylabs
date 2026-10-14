import { PHONE_SHAPED_DIGITS_PATTERN } from './contactRedaction';

const PLACEHOLDER_PATTERN = /\[(email|phone) redacted\]/g;
const CAPTURE_BY_KIND: Record<string, string> = {
  email: String.raw`([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})`,
  phone: `(${PHONE_SHAPED_DIGITS_PATTERN.source})`,
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The quote with each `[email redacted]` and `[phone redacted]` replaced by the
 * address or number it stood for on the page it was copied from. The model reads
 * contact-redacted text, so its quotes carry the placeholders; a quote that cannot be
 * located on the page is returned unchanged.
 */
export function quoteWithPageContactsRestored(redactedQuote: string, rawPageText: string): string {
  const quote = collapseWhitespace(redactedQuote);
  const kinds = [...quote.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
  if (kinds.length === 0) return redactedQuote;
  const literals = quote.split(PLACEHOLDER_PATTERN).filter((_, index) => index % 2 === 0);
  const source = literals
    .map((literal, index) =>
      index < kinds.length
        ? escapeRegExp(literal) + CAPTURE_BY_KIND[kinds[index]]
        : escapeRegExp(literal),
    )
    .join('')
    .replace(/ /g, '\\s+');
  const values = new RegExp(source).exec(collapseWhitespace(rawPageText))?.slice(1);
  if (!values) return redactedQuote;
  let index = 0;
  return quote.replace(PLACEHOLDER_PATTERN, (placeholder) => values[index++] ?? placeholder);
}
