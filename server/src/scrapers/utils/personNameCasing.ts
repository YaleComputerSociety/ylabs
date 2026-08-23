const CREDENTIAL_TOKENS = new Set([
  'MD',
  'PHD',
  'MFA',
  'DFA',
  'MPH',
  'JD',
  'DVM',
  'DDS',
  'DPT',
  'DO',
  'PA',
  'RN',
  'MSN',
  'MSW',
  'MBA',
  'EDD',
  'PSYD',
  'SCD',
  'DNP',
]);

const ROMAN_NUMERAL = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

const ALL_CAPS_RUN = /^[A-Z]{3,}$/;

const WORD_SEPARATORS = /(\s+)/;
const INTRA_WORD_SEPARATORS = /([-'‘’])/;

function normalizeNameSubToken(subToken: string): string {
  if (!ALL_CAPS_RUN.test(subToken)) return subToken;
  if (CREDENTIAL_TOKENS.has(subToken)) return subToken;
  if (ROMAN_NUMERAL.test(subToken)) return subToken;
  return subToken.charAt(0) + subToken.slice(1).toLowerCase();
}

/**
 * Conservatively fixes shouty raw-cased person names (e.g. "AZA ALLSOP" ->
 * "Aza Allsop") without mangling values that are legitimately capitalized:
 * two-letter initials ("JJ", "TJ"), generational roman-numeral suffixes
 * ("III", "VIII"), academic credentials ("MFA", "DVM"), and already
 * mixed-case names ("McDonald", "K-Bidi"). Only all-uppercase ASCII runs of
 * length 3 or more that are not credentials or roman numerals are title-cased.
 */
export function normalizePersonNameCasing(value: string): string {
  if (typeof value !== 'string' || !value) return value;
  return value
    .split(WORD_SEPARATORS)
    .map((word) => word.split(INTRA_WORD_SEPARATORS).map(normalizeNameSubToken).join(''))
    .join('');
}
