/**
 * Shared title hygiene for source-scraped person titles.
 *
 * A loose profile-page selector can lift page furniture into a person's `title`
 * field, where only a short role/position string belongs. Issue #708 saw this
 * spread across shapes: a Yale Quantum Institute nav menu, a department nav bar,
 * a street address run together with the role, and a full faculty bio (in one
 * case with a raw @yale.edu email) dumped into the title. Issue #740 added the
 * PII-severity contact-block shape: an unredacted email plus a phone number
 * ("Phone:"/"Tel:"/"Fax:") and street address concatenated into the title, and
 * observed that any title beyond a short role string (over ~140 chars) is
 * scraped junk. These guards fail closed: title extraction and render yield a
 * real title or nothing.
 *
 * Deliberately separate from `descriptionHygiene`: that module governs
 * student-facing prose descriptions; this one governs the short person `title`
 * field, which has a different chrome signature (concatenated menu link text,
 * breadcrumb trails) and a much tighter false-positive budget.
 */

export function normalizeTitleWhitespace(value: string | null | undefined): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAV_MENU_PHRASES = [
  'about the institute',
  'about us',
  'mission & history',
  'mission and history',
  'community values',
  'our members',
  'our people',
  'our team',
  'annual report',
  'annual reports',
  'join the institute',
  'in the media',
  'location & contacts',
  'programs & events',
  'upcoming events',
  'artists-in-residence',
  'artist-in-residence',
  'colloquia and seminar',
  'seminar series',
  'news & events',
  'get involved',
  'contact us',
  'skip to content',
  'skip to main content',
  'toggle navigation',
  'main menu',
];

const navMenuPhrasePattern = new RegExp(
  NAV_MENU_PHRASES.map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'gi',
);

const breadcrumbSeparatorPattern = /[>»›•·]/g;

function concatenatedWordRunCount(value: string): number {
  return (value.match(/[a-z][A-Z]/g) || []).length;
}

/**
 * True when a candidate title looks like navigation, menu, or breadcrumb chrome
 * rather than a real job title.
 *
 * Signals (any one is sufficient):
 *  - concatenated link text: `.text()` on a menu container yields runs like
 *    "InstituteMission" with no separator; three or more lower-to-upper
 *    boundaries never occur in a genuine job title.
 *  - breadcrumb trails with two or more chained separators (> » › • ·).
 *  - two or more distinct navigation/menu phrases.
 */
export function isNavMenuChromeTitle(value: string | null | undefined): boolean {
  const text = normalizeTitleWhitespace(value);
  if (!text) return false;
  if (concatenatedWordRunCount(text) >= 3) return true;
  if ((text.match(breadcrumbSeparatorPattern) || []).length >= 2) return true;
  if ((text.match(navMenuPhrasePattern) || []).length >= 2) return true;
  return false;
}

const rawEmailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/**
 * A raw email address never belongs in a role/title string; when the scraper
 * lifts a faculty contact block into the title it carries a student-visible
 * privacy leak (#708). Reject it fail-closed.
 */
export function hasRawEmailAddress(value: string | null | undefined): boolean {
  return rawEmailPattern.test(normalizeTitleWhitespace(value));
}

const streetAddressPatterns: RegExp[] = [
  /\baddress\s*:/i,
  /\b\d{1,5}\s+[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)*\s+(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|place|pl)\b\.?/i,
  /\bnew haven,?\s*ct\b/i,
  /\bpo box\b/i,
  /\b\d{5}(?:-\d{4})?\b/,
];

/**
 * A mailing-address fragment lifted into the title (e.g. #708's
 * "...Evolutionary BiologyAddress: 21 Sachem St. New Haven, CT 06511"). Any one
 * of an "Address:" label, a numbered street, a city/state, a PO box, or a ZIP
 * is enough: none occur in a genuine job title.
 */
export function hasStreetAddressFragment(value: string | null | undefined): boolean {
  const text = normalizeTitleWhitespace(value);
  if (!text) return false;
  return streetAddressPatterns.some((pattern) => pattern.test(text));
}

const phoneNumberPattern = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/;
const phoneLabelPattern = /\b(?:phone|tel|telephone|fax|mobile|cell)\s*:/i;

/**
 * A phone/fax contact fragment lifted into the title (#740's "raw
 * email/phone/address contact block"): a `Phone:`/`Tel:`/`Fax:`/`Mobile:`/`Cell:`
 * label, or a bare ten-digit phone number. Neither occurs in a genuine job
 * title, and both are a student-visible contact-route leak, so either one fails
 * the title closed. Complements `hasRawEmailAddress`/`hasStreetAddressFragment`,
 * which already cover the email and street-address arms of the same block.
 */
export function hasPhoneContactFragment(value: string | null | undefined): boolean {
  const text = normalizeTitleWhitespace(value);
  if (!text) return false;
  return phoneLabelPattern.test(text) || phoneNumberPattern.test(text);
}

function sentenceBoundaryCount(text: string): number {
  return (text.match(/[a-z]{4,}[.!?]["')\]]?\s+[A-Z]/g) || []).length;
}

/**
 * Multi-sentence bio prose dumped into the title (#708: `hammer-lhammer`,
 * `smith-sbs9`). A title is a single short role phrase, so an overlong run of
 * words, or two or more real sentence boundaries, signals a bio paragraph
 * rather than a title. The boundary arm requires a four-plus-letter lowercase
 * word before the terminator and a capitalized next word, so degree
 * abbreviations ("Ph.D.") and endowed-chair initials ("...K. Lanman, Jr.
 * Professor") are not mistaken for sentences.
 */
export function isBioProseTitle(value: string | null | undefined): boolean {
  const text = normalizeTitleWhitespace(value);
  if (!text) return false;
  if (text.split(/\s+/).filter(Boolean).length > 30) return true;
  return sentenceBoundaryCount(text) >= 2;
}

export const MAX_PERSON_TITLE_LENGTH = 140;

/**
 * Fail-closed sanitizer for the short person `title` field, applied at both the
 * scraper write path and the member/PI card render path (#708). Returns a
 * normalized title, or undefined when the candidate is navigation/menu chrome,
 * a raw email, a street-address fragment, a phone/fax contact fragment,
 * multi-sentence bio prose, or simply longer than a role string ever runs
 * (#740's over-140-char scraped-junk heuristic), so a corrupted title never
 * lands in storage nor renders from stale data (#708, #740).
 */
export function sanitizePersonTitle(value: string | null | undefined): string | undefined {
  const text = normalizeTitleWhitespace(value);
  if (!text) return undefined;
  if (text.length > MAX_PERSON_TITLE_LENGTH) return undefined;
  if (isNavMenuChromeTitle(text)) return undefined;
  if (hasRawEmailAddress(text)) return undefined;
  if (hasStreetAddressFragment(text)) return undefined;
  if (hasPhoneContactFragment(text)) return undefined;
  if (isBioProseTitle(text)) return undefined;
  return text;
}
