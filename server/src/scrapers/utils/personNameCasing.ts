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

// Uppercase by Unicode property rather than by ASCII range, so an accented shouty
// run de-shouts too. Matching on ASCII alone left "CANTÓ-PASTOR" half-cased as
// "CANTÓ-Pastor", which is worse than either extreme: a repair pass writes the
// half-cased value and then reads it back as already clean, making the shout
// permanent. Combining marks are admitted so a decomposed accent reads the same as a
// composed one.
const ALL_CAPS_RUN = /^\p{Lu}[\p{Lu}\p{M}]{2,}$/u;

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
 * mixed-case names ("McDonald", "K-Bidi"). Only all-uppercase runs of length 3
 * or more that are not credentials or roman numerals are title-cased.
 */
export function normalizePersonNameCasing(value: string): string {
  if (typeof value !== 'string' || !value) return value;
  return value
    .split(WORD_SEPARATORS)
    .map((word) => word.split(INTRA_WORD_SEPARATORS).map(normalizeNameSubToken).join(''))
    .join('');
}

const ROMAN_SUFFIXES = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const NAME_SUFFIXES = ['JR', 'JR.', 'SR', 'SR.', 'JNR', 'SNR'];

const POST_NOMINAL_CREDENTIALS = [
  'MD',
  'PHD',
  'MDPHD',
  'MPH',
  'MBA',
  'MFA',
  'DFA',
  'DVM',
  'DDS',
  'MSN',
  'RN',
  'DO',
  'JD',
  'LLM',
  'DPT',
  'EDD',
  'PSYD',
  'MSW',
  'MS',
  'BA',
  'BS',
  'DSC',
  'SCD',
  'MDIV',
  'STM',
  'RD',
  'MPA',
  'MHS',
  'APRN',
  'PA',
  'NP',
  'FNU',
];

export const GENERATIONAL_NAME_SUFFIX_TOKENS: ReadonlySet<string> = new Set<string>([
  ...ROMAN_SUFFIXES,
  ...NAME_SUFFIXES.map((suffix) => suffix.replace(/\.$/, '')),
]);

const RANK_ABBREVIATIONS = [
  'LTC',
  'COL',
  'CPT',
  'MAJ',
  'SGT',
  'GEN',
  'CDR',
  'CAPT',
  'LCDR',
  'ENS',
  'ADM',
  'RADM',
  'VADM',
  'RET',
  'USN',
  'USA',
  'USAF',
  'USMC',
  'MG',
  'BG',
  'LTG',
];

export const PRESERVED_UPPERCASE_NAME_TOKENS = new Set<string>([
  ...ROMAN_SUFFIXES,
  ...NAME_SUFFIXES,
  ...POST_NOMINAL_CREDENTIALS,
  ...RANK_ABBREVIATIONS,
]);

const SUBTOKEN_SEPARATORS = /([-'‘’])/;

const isAllUppercaseNameFragment = (fragment: string): boolean => ALL_CAPS_RUN.test(fragment);

function fixNameFragmentCasing(fragment: string): string {
  if (!isAllUppercaseNameFragment(fragment)) return fragment;
  if (PRESERVED_UPPERCASE_NAME_TOKENS.has(fragment)) return fragment;
  return fragment.charAt(0) + fragment.slice(1).toLowerCase();
}

function fixNameTokenCasing(token: string): string {
  return token.split(SUBTOKEN_SEPARATORS).map(fixNameFragmentCasing).join('');
}

export function canonicalPersonName(raw: string | undefined | null): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/).map(fixNameTokenCasing).join(' ');
}

export function personNameCasingChanged(raw: string | undefined | null): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return canonicalPersonName(trimmed) !== trimmed;
}
