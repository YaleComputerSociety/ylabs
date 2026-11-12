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

const NAV_MENU_PHRASE_SET = new Set(NAV_MENU_PHRASES);

export function isNavigationMenuPhrase(value: string | null | undefined): boolean {
  return NAV_MENU_PHRASE_SET.has(normalizeTitleWhitespace(value).toLowerCase());
}

const breadcrumbSeparatorPattern = /[>»›•·]/g;

function concatenatedWordRunCount(value: string): number {
  return (value.match(/[a-z][A-Z]/g) || []).length;
}

const SITE_MENU_ITEM_WORDS = new Set([
  'home',
  'about',
  'research',
  'academics',
  'people',
  'media',
  'events',
  'news',
  'outreach',
  'opportunities',
  'contact',
  'publications',
  'resources',
  'gallery',
  'collections',
]);

const ROLE_WORD_PATTERN =
  /\b(?:professor|lecturer|lector|instructor|scientist|scholar|researcher|director|fellow|chair|dean|provost|president|head|lead|assistant|associate|adjunct|affiliate|visiting|emeritus|emerita|postdoc|postdoctoral|student|candidate|manager|coordinator|administrator|officer|specialist|technician|technologist|analyst|engineer|counselor|librarian|curator|editor|advisor|adviser|nurse|physician|clinician|worker)\b/i;

const TITLE_CONNECTIVE_WORDS = new Set(['and', 'of', 'in', 'the', 'at', 'to']);

const MIN_SITE_MENU_ITEMS = 6;
const MIN_SITE_MENU_ITEM_WORDS = 5;
const MENU_ITEM_TOKEN_PATTERN = /^(?:[A-Z][A-Za-z'’-]*|&)$/;

function isSpaceSeparatedSiteMenu(text: string): boolean {
  const tokens = text.split(' ');
  if (tokens.length < MIN_SITE_MENU_ITEMS) return false;
  if (!tokens.every((token) => MENU_ITEM_TOKEN_PATTERN.test(token))) return false;
  if (ROLE_WORD_PATTERN.test(text)) return false;
  const words = tokens.map((token) => token.toLowerCase());
  if (words.some((word) => TITLE_CONNECTIVE_WORDS.has(word))) return false;
  const menuItemWords = new Set(words.filter((word) => SITE_MENU_ITEM_WORDS.has(word)));
  return menuItemWords.size >= MIN_SITE_MENU_ITEM_WORDS;
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

const SECTION_LABEL_TITLES = new Set([
  'research faculty',
  'faculty research',
  'faculty directory',
  'faculty staff',
  'faculty',
  'directory',
  'people',
  'our people',
  'our faculty',
  'related research',
  'research',
  'profile',
  'overview',
  'bio',
  'biography',
  'home',
  'about',
  'publications',
  'selected publications',
  'research interests',
  'contact',
  'news',
]);

function normalizeSectionLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[/&|,·•]+/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A site section, breadcrumb, or directory-index label lifted whole into the
 * title (#1257: engineering.yale.edu faculty-directory pages yielding the
 * page's own "Research / Faculty" section label as the PI title). These slip
 * past `isNavMenuChromeTitle` because they carry no concatenated word runs,
 * chained separators, or two-plus nav phrases. Matched by exact whole-string
 * equality after normalizing separators (`/`, `&`, "and") and case, so a real
 * role string ("Professor of Computer Science") never collides.
 */
export function isSectionLabelTitle(value: string | null | undefined): boolean {
  const text = normalizeTitleWhitespace(value);
  if (!text) return false;
  return SECTION_LABEL_TITLES.has(normalizeSectionLabel(text));
}

const PLURAL_ROSTER_CATEGORY_TITLE =
  /^(?:[A-Z][A-Za-z'’-]*\s+(?:(?:and|&)\s+)?){0,4}(?:affiliates|associates|fellows|scholars|scientists|researchers|investigators|students|postdocs|trainees|members|lecturers|professors|instructors|mentors)$/i;
const AWARD_NAME_TITLE = /\b(?:awards?|prizes?|medals?)$/i;
const NEWS_HEADLINE_VERB =
  /\b(?:hailed|honou?red|wins|receives?|received|awarded|earns?|earned|elected|selected|recognized|celebrates?|announces?|announced)\b/i;

/**
 * A page heading or news headline lifted whole into a person's title: a roster's plural
 * section heading ("Research Affiliates"), an award teaser ("Faculty Impact Award"), or a
 * news card ("Faculty and Postdocs Hailed as Outstanding Mentors"). Each names a group,
 * an honour or an event rather than the person's appointment, so it is refused only when
 * no singular role word appears: "Associate Dean of Students" and "Won Park Hahn
 * Professor" keep their reading (#5323).
 */
export function isPageHeadingTitle(value: string | null | undefined): boolean {
  const text = normalizeTitleWhitespace(value);
  if (!text || ROLE_WORD_PATTERN.test(text)) return false;
  return (
    PLURAL_ROSTER_CATEGORY_TITLE.test(text) ||
    AWARD_NAME_TITLE.test(text) ||
    NEWS_HEADLINE_VERB.test(text)
  );
}

const BIOGRAPHY_CLAUSE =
  /\b(?:is|was) (?:a|an|the|currently|also|associate|assistant|professor|director|lecturer)\b|\b(?:received|earned|completed) (?:his|her|their|a|an|the)\b|\b(?:joined|joins) (?:the|yale)\b|\b(?:his|her|their) (?:research|work|scholarship)\b|\bstudies (?:the|how|why|whether)\b|\bfocuses on\b/;

/**
 * A title states an appointment, never a clause about the person, so a biography sentence
 * run onto the title ("... is associate professor of ...", "... received her ...") is
 * refused at any length (#5594). Only lowercase phrasing counts, because a field name in
 * a title is capitalized ("Professor of Fixture Studies").
 */
export function hasBiographyClause(value: string | null | undefined): boolean {
  return BIOGRAPHY_CLAUSE.test(normalizeTitleWhitespace(value));
}

const DEGREE_LINE =
  /\b(?:Ph\.?\s?D|M\.?\s?A|B\.?\s?A|M\.?\s?S|B\.?\s?S|M\.?\s?Phil|J\.?\s?D|M\.?\s?F\.?\s?A)\.?,\s*(?:[A-Z][\w.'&-]*\s+){0,5}(?:University|College|Institute|School)\b/;

/**
 * A curriculum vitae line ("Ph.D., Fixture University") run onto the title (#5594).
 */
export function hasDegreeLine(value: string | null | undefined): boolean {
  return DEGREE_LINE.test(normalizeTitleWhitespace(value));
}

const DANGLING_TITLE_CONNECTIVE = /\b(?:of|in|and|for|the|to|at|on|with)\s*[,;:]?$|&\s*$/i;

/**
 * A title cut off before the department or field it names ("Professor of", "Professor
 * and Chair of"), which a roster that renders the rank and the department in separate
 * elements yields when only the first is read. It names no appointment a student could
 * read, so it is refused like any other fragment.
 */
export function isTruncatedPersonTitle(value: string | null | undefined): boolean {
  const text = normalizeTitleWhitespace(value);
  return Boolean(text) && DANGLING_TITLE_CONNECTIVE.test(text);
}

/**
 * The longest person title storage holds, and `researchers.profile.title`'s schema
 * `maxlength` (#5594). It is a storage bound, not a defect heuristic: the longest genuine
 * appointment list measured on Development runs 436 characters, so the bound sits more than
 * twice above it. A title past it cannot be stored whole, so it is refused rather than cut.
 */
export const MAX_STORED_PERSON_TITLE_LENGTH = 1000;

const FIELD_LABEL_PREFIX = /^(?:job\s+title|title|position|rank|appointment)\s*:\s*/i;

export const stripTitleFieldLabel = (value: string): string =>
  value.replace(FIELD_LABEL_PREFIX, '');

const SENTENCE_BOUNDARY = /(?<=[a-z]{4,}[.!?]["')\]]?)\s+(?=[A-Z])/;

/**
 * Multi-sentence bio prose dumped into the title (#708). The boundary requires a four-plus-letter
 * lowercase word before the terminator and a capitalized next word, so degree abbreviations
 * ("Ph.D.") and chair initials are not sentences. An appointment list written as sentences names
 * a role in every sentence, so prose is three or more sentences with one that names none.
 */
function isMultiSentenceBioProse(text: string): boolean {
  const sentences = text.split(SENTENCE_BOUNDARY);
  return sentences.length >= 3 && sentences.some((sentence) => !ROLE_WORD_PATTERN.test(sentence));
}

function hasPersonTitleDefectShape(text: string): boolean {
  return (
    isMultiSentenceBioProse(text) ||
    isNavMenuChromeTitle(text) ||
    isSpaceSeparatedSiteMenu(text) ||
    isSectionLabelTitle(text) ||
    isPageHeadingTitle(text) ||
    hasRawEmailAddress(text) ||
    hasStreetAddressFragment(text) ||
    hasPhoneContactFragment(text) ||
    hasBiographyClause(text) ||
    hasDegreeLine(text) ||
    isTruncatedPersonTitle(text)
  );
}

const PROSE_VERB =
  /\b(?:is|was|are|were|has|had|have|holds|received|earned|completed|joined|serves|served|directs|directed|teaches|taught|studied|investigates|focuses|worked|began|became)\b/;
const PERSONAL_PRONOUN = /\b(?:he|she|they|his|her|hers|their|we|my)\b/i;
const FIRST_PERSON_CLAUSE =
  /\bI(?:['’]m|\s+(?:am|was|have|study|work|research|teach|write|edit|read|look))\b/;

function isCleanStoredAppointment(text: string): boolean {
  return (
    Boolean(text) &&
    !hasPersonTitleDefectShape(text) &&
    !PROSE_VERB.test(text) &&
    !PERSONAL_PRONOUN.test(text) &&
    !FIRST_PERSON_CLAUSE.test(text)
  );
}

const storableWhole = (title: string): string | undefined =>
  title.length <= MAX_STORED_PERSON_TITLE_LENGTH ? title : undefined;

/**
 * The person title a materializer may store and a detail page may serve (#5594). Length is
 * never a defect here: a genuine list of appointments, joined by semicolons, commas or
 * sentences, is kept whole up to the storage bound. A title is refused or trimmed only for
 * a defect shape: glued biography (a lowercase finite verb such as "is" or "received", or a
 * personal pronoun, neither of which an appointment carries), multi-sentence prose with a
 * sentence that names no role, degree lines, contact details,
 * a site menu, section label or page heading, or a title cut off at a dangling connective.
 * When the defect sits in a later appointment of a semicolon list, the leading clean
 * appointments are kept, whole and in order, and the defective appointment and everything
 * after it are dropped. A list that is clean throughout is never trimmed.
 */
export function servablePersonTitle(value: string | null | undefined): string | undefined {
  const text = stripTitleFieldLabel(normalizeTitleWhitespace(value));
  if (!text) return undefined;
  if (isCleanStoredAppointment(text)) return storableWhole(text);
  const appointments = text.split(';').map((part) => part.trim());
  const firstDefective = appointments.findIndex((part) => !isCleanStoredAppointment(part));
  if (firstDefective === 0) return undefined;
  const cleanCount = firstDefective === -1 ? appointments.length : firstDefective;
  const leading = appointments.slice(0, cleanCount).join('; ');
  return isCleanStoredAppointment(leading) ? storableWhole(leading) : undefined;
}

/**
 * Fail-closed sanitizer for a scraped person `title` at ingest (#708, #740, #1257, #5832). It
 * emits exactly the title `servablePersonTitle` would store, so a long genuine appointment list
 * reaches the observation store whole instead of being refused for its length one step before
 * the materializer could keep it. Defect shapes (menus, section labels, page headings, contact
 * details, glued biography, multi-sentence bio prose, degree lines, truncation) are refused at
 * any length, and a title
 * past the storage bound is refused rather than cut.
 */
export function sanitizePersonTitle(value: string | null | undefined): string | undefined {
  return servablePersonTitle(value);
}
