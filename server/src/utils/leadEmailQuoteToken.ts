import { createHash } from 'node:crypto';

const REDACTED_EMAIL = '[email redacted]';
const LEAD_EMAIL_TOKEN_PATTERN = /\[lead email ([0-9a-f]{12})\]/g;
const DIRECT_EMAIL_CAPTURE = String.raw`([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})`;

const normalizedEmail = (email: string): string => email.trim().toLowerCase();

const emailDigest = (email: string): string =>
  createHash('sha256').update(normalizedEmail(email)).digest('hex').slice(0, 12);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const leadEmailToken = (email: string): string => `[lead email ${emailDigest(email)}]`;

export const withLeadEmailTokensRedacted = (text: string): string =>
  text.replace(LEAD_EMAIL_TOKEN_PATTERN, REDACTED_EMAIL);

/**
 * The contact-redacted quote with each `[email redacted]` that stood for one of the
 * row's own lead addresses on the page replaced by that lead's token. The address
 * itself is never stored, so the quote stays as fail-closed as the redaction made it.
 */
export function quoteWithLeadEmailTokens(
  redactedQuote: string,
  rawPageText: string,
  leadEmails: readonly string[],
): string {
  if (!redactedQuote.includes(REDACTED_EMAIL) || leadEmails.length === 0) return redactedQuote;
  const quote = collapseWhitespace(redactedQuote);
  const pattern = new RegExp(
    quote.split(REDACTED_EMAIL).map(escapeRegExp).join(DIRECT_EMAIL_CAPTURE).replace(/ /g, '\\s+'),
  );
  const addresses = pattern.exec(collapseWhitespace(rawPageText))?.slice(1);
  if (!addresses) return redactedQuote;
  const leads = new Set(leadEmails.map(normalizedEmail));
  let index = 0;
  return quote.replace(/\[email redacted\]/g, () => {
    const address = normalizedEmail(addresses[index++] ?? '');
    return leads.has(address) ? leadEmailToken(address) : REDACTED_EMAIL;
  });
}

export function withLeadEmailTokensResolved(text: string, servedEmails: readonly string[]): string {
  const byDigest = new Map(servedEmails.map((email) => [emailDigest(email), email]));
  return text.replace(
    LEAD_EMAIL_TOKEN_PATTERN,
    (_token, digest: string) => byDigest.get(digest) ?? REDACTED_EMAIL,
  );
}
