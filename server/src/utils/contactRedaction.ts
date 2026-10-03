/**
 * Remove direct contact details from public-facing evidence excerpts while
 * preserving enough quote context for source review.
 */
const DIRECT_EMAIL_ADDRESS_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const ADDRESS_LOCAL_PART = String.raw`(?<![A-Z0-9._%+-])[A-Z0-9][A-Z0-9._%+-]*`;
const DOMAIN_LABEL = String.raw`(?!(?:the|a|an|this|that|our|its|their|his|her|my|your)\b)[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?`;
const BRACKETED = (word: string): string => String.raw`\s*[[({<]\s*(?:${word})\s*[\])}>]\s*`;
const OBFUSCATED_AT_SIGN = String.raw`(?:\s*@\s+|\s*(?:\uFF20|&#0*64;|&#x0*40;|&commat;)\s*)`;
const SPELLED_AT = String.raw`\s+at\s+`;
const OBFUSCATED_DOT = String.raw`(?:${BRACKETED(String.raw`dot|\.`)}|\s+dot\s+)`;
const ANY_DOT = String.raw`(?:${OBFUSCATED_DOT}|\.)`;
const KNOWN_DOMAIN_SUFFIX = 'edu|org|com|net|gov|mil|int|io|ac|uk|ca|us|info|biz';
const ADDRESS_END = String.raw`(?![A-Z0-9-])`;

const SYMBOLIC_AT_EMAIL_PATTERN = new RegExp(
  `${ADDRESS_LOCAL_PART}(?:${BRACKETED('at')}|${OBFUSCATED_AT_SIGN})${DOMAIN_LABEL}(?:${ANY_DOT}${DOMAIN_LABEL})*${ANY_DOT}[A-Z]{2,}${ADDRESS_END}`,
  'gi',
);

const SPELLED_AT_EMAIL_PATTERN = new RegExp(
  `${ADDRESS_LOCAL_PART}${SPELLED_AT}${DOMAIN_LABEL}(?:${ANY_DOT}${DOMAIN_LABEL})*${OBFUSCATED_DOT}(?:${KNOWN_DOMAIN_SUFFIX})${ADDRESS_END}`,
  'gi',
);

// Digit lookarounds rather than `\b`: extracted HTML glues a label to its value
// ("Phone" + number, number + "Fax"), and there is no word boundary between a
// letter and a digit. A longer digit run is still left alone (#3738).
export const PHONE_SHAPED_DIGITS_PATTERN =
  /(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)/g;

const BARE_DIGIT_RUN = /^\d+$/;
const ENDS_WITH_LETTER = /[A-Za-z]$/;
const ENDS_WITH_PHONE_LABEL =
  /(?:^|[^A-Za-z])(?:phone|ph|tel|telephone|fax|cell|mobile|call|ext|x|office|main|voice|number)$/i;
const LABEL_LOOKBACK_CHARS = 16;

// Measured on Development (#3738): every glued phone carried separators, while every
// bare ten-digit run with a letter directly before it was a record id ("IRB ID" plus
// the protocol number, a journal e-locator), so that one shape needs a phone label.
const isIdentifierSuffix = (match: string, offset: number, text: string): boolean => {
  if (!BARE_DIGIT_RUN.test(match)) return false;
  const before = text.slice(Math.max(0, offset - LABEL_LOOKBACK_CHARS), offset);
  return ENDS_WITH_LETTER.test(before) && !ENDS_WITH_PHONE_LABEL.test(before);
};

export const phoneRedactionReplacement = (match: string, offset: number, text: string): string =>
  isIdentifierSuffix(match, offset, text) ? match : '[phone redacted]';

export function redactDirectContactInfo(value: string): string {
  return value
    .replace(DIRECT_EMAIL_ADDRESS_PATTERN, '[email redacted]')
    .replace(SYMBOLIC_AT_EMAIL_PATTERN, '[email redacted]')
    .replace(SPELLED_AT_EMAIL_PATTERN, '[email redacted]')
    .replace(PHONE_SHAPED_DIGITS_PATTERN, phoneRedactionReplacement);
}
