import {
  buildResearchAreasCardSummary,
  describesResearchFocus,
  deriveShortDescriptionFromFullDescription,
  fullDescriptionQuality,
  isBareChairTitleFragment,
  isCitationFragmentShort,
  shortDescriptionQuality,
} from './researchEntityDescriptionQuality';
import { isMidCvContinuationOpener } from './researchEntityDescriptionText';

const INITIAL_DOT_TOKEN = '<initialdot>';

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

const PROTECTED_ABBREVIATIONS = [
  'Ph.D.',
  'M.Phil.',
  'D.Phil.',
  'Sc.D.',
  'Ed.D.',
  'Psy.D.',
  'M.D.',
  'B.S.',
  'B.A.',
  'M.S.',
  'M.A.',
  'M.Sc.',
  'B.Sc.',
  'J.D.',
  'U.S.',
  'U.K.',
  'D.C.',
  'N.I.H.',
];

function protectAbbreviations(value: string): string {
  let protectedText = value;
  for (const abbreviation of PROTECTED_ABBREVIATIONS) {
    const withToken = abbreviation.split('.').join(INITIAL_DOT_TOKEN);
    protectedText = protectedText.split(abbreviation).join(withToken);
  }
  return protectedText
    .replace(/\b(Dr|Prof|Mr|Mrs|Ms|Jr|Sr)\./g, `$1${INITIAL_DOT_TOKEN}`)
    // A degree abbreviation with a space before its second initial ("Ph. D.",
    // "M. D.", "U. S.") is otherwise invisible to every rule below, which all
    // expect the two letters glued together - the sentence splitter then
    // treats the lone second initial as its own one-word "sentence" that
    // survives CV-sentence stripping intact (#1533 reopen: angluin-lab-dca3's
    // "her Ph. D. in Engineering Science" left a bare "D." at the front of
    // the rebuilt fullDescription once the name-lead sentence around it was
    // stripped as a career-timeline fact).
    .replace(
      /\b([A-Z][a-z]{0,2})\.\s([A-Z])\.(?=\s|,|$)/g,
      (_match, first: string, second: string) => `${first}${INITIAL_DOT_TOKEN} ${second}${INITIAL_DOT_TOKEN}`,
    )
    .replace(/\b(?:[A-Z]\.){2,}/g, (match) => match.split('.').join(INITIAL_DOT_TOKEN))
    .replace(/\b([A-Z])\.(?=\s*[A-Z][A-Za-z.'-]*)/g, `$1${INITIAL_DOT_TOKEN}`)
    // A genuine sentence-ending period is always followed by whitespace or
    // end-of-string; anything else (glued abbreviation, decimal, a period
    // before a closing bracket/quote) is not a sentence boundary.
    .replace(/\.(?!\s|$)/g, INITIAL_DOT_TOKEN);
}

export function protectedSentenceList(value: string): string[] {
  const protectedText = protectAbbreviations(value);
  return (
    protectedText
      .match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)
      ?.map((sentence) => sentence.split(INITIAL_DOT_TOKEN).join('.').trim())
      .filter(Boolean) || []
  );
}

const PROFILE_CHROME_OPENER_PATTERN = /^(?:Welcome!\s*|Bio:\s*|Titles[\s\S]{0,300}?Biography\s*)+/i;

export function isProfileBiographyChromeOpener(value: unknown): boolean {
  const text = textValue(value);
  return Boolean(text) && PROFILE_CHROME_OPENER_PATTERN.test(text);
}

export function stripProfileBiographyChromeOpener(value: unknown): string {
  const text = textValue(value);
  if (!text) return '';
  return text.replace(PROFILE_CHROME_OPENER_PATTERN, '').trim();
}

const LEADING_SPECIALIZATIONS_LABEL_PATTERN = /^Specializations?:\s*/i;
const ABOUT_FIELD_LABEL_PATTERN = /\bAbout:\s*/;

/**
 * A faculty-bio page's "Specializations: <topics>. About: <bio>" form-field
 * scaffold, scraped with the field labels still attached (#1533: Music
 * department profiles - "Specializations: music theory. About: B.A.
 * Stanford University... My chief research interest is in tonal theory...").
 * The "Specializations:" content itself is a genuine topic list, not chrome
 * to delete - only the bare label tokens are stripped, wherever "About:"
 * lands in the string, so the surrounding prose reads naturally and a
 * degree-list lead directly after "About:" is still reachable by
 * stripLeadingDegreeListPrefix.
 */
export function stripProfileFieldLabelChrome(value: unknown): string {
  const text = textValue(value);
  if (!text) return '';
  return text
    .replace(LEADING_SPECIALIZATIONS_LABEL_PATTERN, '')
    .replace(ABOUT_FIELD_LABEL_PATTERN, '')
    .trim();
}

export function hasProfileFieldLabelChromeSignal(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  return LEADING_SPECIALIZATIONS_LABEL_PATTERN.test(text) || ABOUT_FIELD_LABEL_PATTERN.test(text);
}

const TRAILING_PROFILE_CHROME_PATTERN =
  /\s*Last Updated on [^.]+\.\s*Departments\s*&\s*Organizations[\s\S]*$/i;

/**
 * A profile-page "Education & Training" / "Departments & Organizations"
 * footer glued directly onto the last sentence with no separating
 * whitespace, so it survives sentence splitting as unreadable chrome
 * (#1456: "...opioid use disorder.Last Updated on June 02,
 * 2026.Departments & OrganizationsInternal MedicineJaneway
 * SocietyEducation & Training...").
 */
export function stripTrailingProfileChromeFooter(value: unknown): string {
  const text = textValue(value);
  if (!text) return '';
  return text.replace(TRAILING_PROFILE_CHROME_PATTERN, '').trim();
}

const DEGREE_TOKEN_PATTERN =
  "(?:Ph\\.?\\s?D\\.?|Sc\\.?\\s?D\\.?|Ed\\.?\\s?D\\.?|Psy\\.?\\s?D\\.?|Th\\.?\\s?D\\.?|D\\.?\\s?Phil\\.?|M\\.?\\s?Phil\\.?|M\\.?\\s?D\\.?|J\\.?\\s?D\\.?|LL\\.?\\s?B\\.?|LL\\.?\\s?M\\.?|M\\.?\\s?T\\.?\\s?S\\.?|M\\.?\\s?Div\\.?|M\\.?\\s?Arch\\.?|M\\.?\\s?F\\.?\\s?A\\.?|M\\.?\\s?B\\.?\\s?A\\.?|B\\.?\\s?Litt\\.?|A\\.?\\s?B\\.?|B\\.?\\s?A\\.?|M\\.?\\s?A\\.?|M\\.?\\s?S\\.?|Hon\\.?)";

// The institution clause after a degree token is usually "<Name> University"
// but sometimes the qualifying name comes after the keyword ("Graduate
// School of Fine Arts, University of Pennsylvania") - the optional second
// keyword clause lets one entry swallow both halves instead of stopping mid
// institution name and leaving an ungrammatical fragment behind (#1533:
// rizvi-kr74's "Graduate School of Fine Arts, University of Pennsylvania").
const INSTITUTION_KEYWORD_CLAUSE =
  "[\\p{L}&.'\\s-]*?(?:University|College|Institute|School|Academy)(?:\\s*,\\s*[\\p{L}&.'\\s-]*?(?:University|College|Institute|School|Academy))?[^.,;]*?(?:,\\s*\\d{4})?";

// Some faculty bios omit the institution keyword entirely ("Ph.D., Harvard,
// 1966") - a bare capitalized name is only accepted as an institution when a
// year anchors it, so this branch can't swallow an unrelated proper noun.
const BARE_NAMED_INSTITUTION_WITH_YEAR_CLAUSE = "[A-Z][\\p{L}.'\\s-]{2,40}?,\\s*\\d{4}";

const DEGREE_LIST_ENTRY_PATTERN = new RegExp(
  `${DEGREE_TOKEN_PATTERN}\\.?,?\\s*(?:${INSTITUTION_KEYWORD_CLAUSE}|${BARE_NAMED_INSTITUTION_WITH_YEAR_CLAUSE})\\.?`,
  'u',
);

const LEADING_DEGREE_LIST_PATTERN = new RegExp(
  `^\\s*(?:${DEGREE_LIST_ENTRY_PATTERN.source}\\s*(?:[;,]\\s*)?)+`,
  'u',
);

const DEGREE_LIST_FRAGMENT_SEARCH_PATTERN = new RegExp(DEGREE_LIST_ENTRY_PATTERN.source, 'u');

/**
 * A faculty-bio page's raw "B.A., Yale University, 2003 M.A., Harvard
 * University, 2006 Ph.D., Harvard University, 2011" degree timeline glued
 * directly onto the front of the description, with the actual research
 * prose only starting at the name-lead sentence that follows (#1533:
 * humanities faculty pages render this list with no separating punctuation
 * the sentence splitter can key on, so it survives as an unreadable prefix
 * rather than a real sentence). Only strips when a name-lead clause survives
 * afterward - a bare degree list with nothing else is left alone so the
 * no-usable-description fallback below can decide its fate.
 */
// Every character in DEGREE_TOKEN_PATTERN is individually optional (periods,
// internal spaces), so applied case-insensitively and unanchored it also
// matches an ordinary two-letter run inside an unrelated word ("Ma" inside
// "Marisa" satisfies the M.A. alternative). The lookaround pair keeps that
// loose token definition - needed so the anchored entry matcher above still
// recognizes "B.A" / "B A" / "B.A." spacing variants - from also matching
// mid-word when scanning free text for leftover degree/institution mentions.
const DEGREE_OR_INSTITUTION_MENTION_PATTERN = new RegExp(
  `(?<![\\p{L}])(?:${DEGREE_TOKEN_PATTERN}|University|College|Institute|School|Academy)(?!\\p{L})`,
  'giu',
);

/**
 * A genuine name-lead sentence essentially never mentions two separate
 * institutions or degree abbreviations in its opening stretch, so two or
 * more hits this early means the entry loop above stopped mid degree list
 * rather than at the real sentence start (#1533: chang-ksc3's shape -
 * "Institution, Degree Year, Degree Year" - reorders the degree list so the
 * entry pattern above can only consume its first token, leaving "Taiwan,
 * 1966 M.L.S., Rutgers University, 1971 M.A., ..." as a still-broken
 * remainder that happens to start with a capital letter). A fixed character
 * window, not "up to the first period", because several of these
 * abbreviations (M.L.S., Ph.D.) contain their own periods and would
 * otherwise truncate the window to almost nothing.
 */
function remainderStillLooksLikeDegreeListResidue(remainder: string): boolean {
  const window = remainder.slice(0, 150);
  const mentionCount = window.match(DEGREE_OR_INSTITUTION_MENTION_PATTERN)?.length || 0;
  return mentionCount >= 2;
}

/**
 * A looser candidacy signal than stripLeadingDegreeListPrefix succeeding:
 * two or more degree/institution mentions in the opening stretch means the
 * description opens with a degree-list dump, even on a shape
 * stripLeadingDegreeListPrefix can't cleanly resolve on its own (#1533:
 * dept-history-art-mimi-yiengpruksawan's "A.B., Occidental College M.A.,
 * UCLA Ph.D., UCLA..." lead never fully strips - UCLA isn't a recognized
 * institution keyword - but the downstream CV/career-timeline sentence
 * patterns still clean up the rest once this signals the row as a
 * candidate).
 */
export function hasLeadingDegreeListSignal(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  return remainderStillLooksLikeDegreeListResidue(text);
}

export function stripLeadingDegreeListPrefix(value: unknown): string {
  const text = textValue(value);
  if (!text) return '';
  const match = text.match(LEADING_DEGREE_LIST_PATTERN);
  if (!match) return text;
  const remainder = text.slice(match[0].length).trim();
  if (remainder.length < 20 || !/^[A-Z]/.test(remainder)) return text;
  if (remainderStillLooksLikeDegreeListResidue(remainder)) return text;
  return remainder;
}

/**
 * Unambiguous education-timeline, career-timeline, and personal-life-narrative
 * markers (#1456: "was born in Boston...", "received her doctoral degree
 * from...", "joined the Yale faculty in..."). Every pattern here identifies a
 * biography/CV fact rather than a description of what the lab or researcher
 * currently studies, so a matching sentence is dropped outright with no
 * research-focus override: a CV sentence that happens to also contain the
 * word "studies" ("completed his graduate studies on X") is still a CV
 * sentence, not a research statement.
 */
const EDUCATION_OR_CAREER_TIMELINE_SENTENCE_PATTERNS: RegExp[] = [
  /\bwas born in\b/i,
  // Appositive phrasing drops "was" entirely (#1533: "Seyla Benhabib, born in
  // Istanbul, Turkey, is the Eugene Meyer Professor...").
  /^[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,3},\s*born in\b/u,
  /\bmoved,?\s+as a teenager\b/i,
  /\b(?:received|earned|obtained)\s+(?:the|his|her|their|an?)\b[^.!?]{0,80}\b(?:degrees?|doctorate|Ph\.?D\.?|M\.?D\.?|MPH|MBA|MSc|M\.?S\.?|M\.?A\.?|B\.?S\.?|B\.?A\.?)\b/i,
  /\b(?:completed|did)\s+(?:his|her|their)\s+(?:graduate|undergraduate|postdoctoral|clinical|doctoral)\b/i,
  /\bdid\s+(?:his|her|their)\s+(?:ph\.?d|doctorate|postdoctoral)\b/i,
  /\bpost-?doc(?:toral)?\s+(?:work|training|fellowship|research)\s+(?:with|at|on)\b/i,
  /\bunder\s+the\s+(?:supervision|guidance|direction|mentorship)\s+of\b/i,
  // Any institution's faculty/staff, not just Yale's - a CV career-timeline
  // fact regardless of which employer is named (#1791: Holly Rushmeier's bio
  // lists Georgia Tech, NIST, and IBM in the same pattern before ever joining
  // Yale).
  /\bjoined\s+(?:the\s+)?[\p{L}][\p{L} .,&'-]{0,80}?\b(?:faculty|staff)\b/iu,
  /\bwas\s+a\s+research\s+staff\s+member\b/i,
  /\b(?:before|prior\s+to)\s+joining\b/i,
  /\bwas\s+appointed\s+(?:as\s+)?(?:an?\s+)?(?:assistant|associate|full)?\s*professor\b/i,
  /\bserved\s+as\s+(?:Senior|Associate|Assistant|Director|Dean|Chief|Section\s+Chief)\b/i,
  /\b(?:served|serves)\s+as\s+(?:the\s+)?[\p{L} .,'-]{0,40}?\b(?:chair|co-chair|editor-in-chief)\b/iu,
  /\bwas\s+Editor-in-Chief\s+of\b/i,
  /\bmoved\s+to\s+[\p{L} .-]+,?\s+(?:with\s+(?:his|her|their)\s+family\s+)?in\s+\d{4}\b/iu,
  /^(?:Next,|Subsequently,|After completing\b|In \d{4},\s+(?:he|she|they)\b)/i,
  // Humanities/social-science CV markers - awards, honorary degrees, editorial
  // service, teaching history, and career résumé lines - are appointment/CV
  // facts, not a description of what the person currently researches
  // (#1533: benhabib-sb422's full description is entirely this shape and
  // carries no research-topic sentence at all).
  /\bis\s+the\s+recipient\s+of\s+(?:the|an?)\b[^.!?]{0,80}\b(?:prize|award|medal|honor)\b/i,
  /\bwas\s+(?:the\s+)?President\s+of\s+the\b/i,
  /\bhas\s+been\s+a\s+member\s+of\s+the\b[^.!?]{0,60}\bAcademy\b/i,
  /\bhas\s+previously\s+taught\s+at\b/i,
  /\b(?:Guggenheim|MacArthur|Fulbright|NEH|NSF)\s+Fellowship\s+recipient\b/i,
  /\bholds?\s+Honorary\s+Degrees?\s+from\b/i,
  /\bis\s+the\s+author\s+of\s+(?:several|numerous|many)?\s*(?:influential\s+)?(?:books?|works?)\s+including\b/i,
  /\bwork\s+has\s+been\s+translated\s+into\s+(?:numerous|several|many)\s+languages\b/i,
  /\bhas\s+edited\s+and\s+coedited\s+\d+\s+volumes\b/i,
  /\bhas\s+held\s+(?:many|several|numerous)\s+(?:prestigious\s+)?visiting\s+professorships\b/i,
  /\bwas\s+CEO\s+of\b/i,
  /\bwas\s+a\s+partner\s+at\b[^.!?]{0,80}\bco-founded\s+the\s+firm\b/i,
  /\bhas\s+also\s+led\s+organizations\s+in\b/i,
  /\bhas\s+authored\s+(?:several|numerous|many)\b[^.!?]{0,40}\bincluding\b/i,
  /\bhas\s+received\s+an?\b[^.!?]{0,60}\bfellowship\b/i,
  /\bis\s+(?:currently\s+)?involved\s+with\s+(?:several|numerous|many)\s+editorial\s+and\s+advisory\s+boards\b/i,
  /\bwas\s+(?:also\s+)?the\s+general\s+editor\s+of\b/i,
  /\bhas\s+served\s+as\s+the\s+founder\s+and\s+general\s+editor\s+of\b/i,
  // A "who we recruit" note, not a description of the research itself
  // (#1533: faculty-research-area-francis-lee's entire fullDescription is
  // this one sentence, and the stored shortDescription is a dangling
  // "-Ph.D. Students, ..." fragment cut from its middle).
  /\bvisiting\s+fellows\s+for\s+research\s+opportunities\s+and\s+career\s+advancement\b/i,
  // First-person equivalents of the third-person career/credential facts
  // above - a LAB fullDescription narrated in first person still leaks pure
  // CV/administrative-role facts rather than research content (#1638: Allore
  // Lab's entire description is "I founded the field of...", "I previously
  // chaired...", "I have a wealth of experience...", with almost no sentence
  // describing what is currently studied).
  /\bI\s+founded\s+the\s+field\s+of\b/i,
  /\bI\s+(?:previously\s+)?(?:chaired|co-chaired)\b/i,
  // First-person appointment/degree openers (#1841: a personal-academic-
  // homepage extraction whose whole fullDescription was "I am a professor in
  // the philosophy department at Yale. I completed my PhD in philosophy at
  // MIT in ...", a CV/bio opener rather than a research summary).
  /\bI\s+am\s+(?:an?\s+|the\s+)?(?:assistant|associate|full|adjunct|clinical|visiting)?\s*(?:professor|lecturer|instructor|faculty\s+member)\b/i,
  /\bI\s+completed\s+(?:my|a)\b[^.!?]{0,60}\b(?:Ph\.?D\.?|doctorate|M\.?D\.?|master'?s|bachelor'?s|degree)\b/i,
  /\b(?:resulted\s+in\s+me\s+being|I\s+was)\s+(?:an?\s+)?invited\s+speaker\b/i,
  /\bI\s+have\s+a\s+wealth\s+of\s+experience\b/i,
  /\bI\s+am\s+a\s+recognized\s+authority\s+on\b/i,
  /\b(?:with\s+)?over\s+\d[\d,]*\s+peer-reviewed\s+(?:articles|publications)\b/i,
  /\bcontinuous\s+(?:NIH|NSF)\s+funding\s+since\s+\d{4}\b/i,
  // Non-humanities faculty-bio CV markers (#1533 reopen: the corpus of
  // still-live rows is 32 FAS, 6 School of Medicine, 3 School of Management,
  // and 1 Law - the shape below covers the prior-employment, society-fellow,
  // department-chair, and prize-list phrasings those schools' bios use that
  // the original humanities-scoped patterns above never matched).
  /\b(?:he|she|they)\s+previously\s+was\s+at\b/i,
  /\bserved\s+as\s+an?\s+visiting\s+(?:assistant|associate|full)?\s*professor\b/i,
  /\bis\s+an?\s+fellow\s+of\s+the\b[^.!?]{0,80}\bSociety\b/i,
  /\bhas\s+chaired\b[^.!?]{0,80}\bDepartment\b/i,
  /\bholds?\s+secondary\s+appointments?\s+in\b/i,
  /\bis\s+the\s+author,\s*co-author\s+or\s+co-editor\s+of\s+[a-z]+\s+books?\b/i,
  /\bis\s+the\s+faculty\s+PI\s+for\b/i,
  /\b(?:Advisory|Editorial)\s+Committee\s+member\s+for\b/i,
  /\bwinner\s+of\s+(?:the\s+)?\d{4}\b[^.!?]{0,80}\b(?:Prize|Award)\b/i,
  /\bis\s+the\s+winner\s+of\s+(?:the\s+)?(?:numerous|several|many|eleven|ten|nine|eight|seven|six|five|four|three|two|one|\d+)\s+(?:book\s+)?(?:awards?|prizes?)\b/i,
];

export function isEducationOrCareerTimelineSentence(sentence: string): boolean {
  return EDUCATION_OR_CAREER_TIMELINE_SENTENCE_PATTERNS.some((pattern) => pattern.test(sentence));
}

const MULTIPLE_CAREER_TIMELINE_SENTENCE_THRESHOLD = 2;

/**
 * A first-person CV/bio dump rarely has a name-lead or appointment-opener
 * sentence to key a candidacy pre-filter on (#1638: Allore Lab's
 * fullDescription opens "The focus of my research collaborations and
 * methodological development work as the Leader of..." - no name, no "is
 * the Professor of" clause). Two or more sentences matching the
 * education/career-timeline patterns anywhere in the text is instead the
 * signal: a single incidental match deep in an otherwise-fine research
 * description is common enough to be unsafe as a threshold of one (the same
 * over-broad risk hasLeadingDegreeListSignal's >=2 threshold guards against),
 * but a real CV dump narrated in first person carries several.
 */
export function hasMultipleCareerTimelineSentences(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  const strippedCount = protectedSentenceList(text).filter((sentence) =>
    isEducationOrCareerTimelineSentence(sentence),
  ).length;
  return strippedCount >= MULTIPLE_CAREER_TIMELINE_SENTENCE_THRESHOLD;
}

/**
 * A hard defect: this text must never be served, regardless of whether a
 * better alternative exists to replace it with (#1533: raab-jcr42's stored
 * short "Studies, Stanford University Ph.D., Yale University Jennifer Raab
 * specializes..." and lawler-tl4's "Studies , Holy Cross, 1958 Middle
 * English..." both carry the same degree-list defect as their full;
 * shirkhani-ks733's "- "Small Language and Big Men in Virginia Woolf,"
 * Studies in the Novel." is a bare citation, not a description; jaynes-gj7's
 * "Whitney Griswold Professor of Economics, Black Studies, and Urban
 * Studies." is a bare chair-title clause with no subject or verb at all).
 */
export function isDefectiveShortDescription(candidate: string): boolean {
  if (!candidate) return true;
  if (isMidCvContinuationOpener(candidate)) return true;
  if (isEducationOrCareerTimelineSentence(candidate)) return true;
  if (DEGREE_LIST_FRAGMENT_SEARCH_PATTERN.test(candidate)) return true;
  if (/^Studies\s*,/i.test(candidate)) return true;
  if (isCitationFragmentShort(candidate)) return true;
  if (isBareChairTitleFragment(candidate)) return true;
  return false;
}

function isSalvageableShortDescription(candidate: string, contextFullDescription: string): boolean {
  if (isDefectiveShortDescription(candidate)) return false;
  // Exclude 'full-not-useful': it reflects fullDescriptionQuality's whole-text
  // verdict on contextFullDescription, which can false-flag a rebuilt full
  // that opens with a legitimate appointment sentence (see
  // rebuiltFullIsUsable above) - that is not a defect of the candidate short
  // itself.
  return shortDescriptionQuality(candidate, contextFullDescription).flags.every(
    (flag) => flag === 'full-not-useful',
  );
}

export interface BiographyDescriptionRepairInput {
  fullDescription: unknown;
  shortDescription: unknown;
  researchAreas: unknown;
}

export interface BiographyDescriptionRepairResult {
  outcome: 'unchanged' | 'resynthesized' | 'blanked';
  fullDescription: string;
  shortDescription: string;
  strippedSentenceCount: number;
  totalSentenceCount: number;
}

/**
 * Repairs a served lab/research-entity description that leaked a PI resume or
 * biography (education timeline, personal-life narrative, profile-layout
 * chrome) instead of describing what the lab studies (#1456). Strips
 * biography/CV/chrome sentences and rebuilds a research-focused description
 * from whatever genuine research content remains; falls back to a
 * researchAreas-derived card summary, and finally to a blank description when
 * nothing usable can be derived so the caller can route the record through
 * the existing no-usable-description visibility floor (#1449) instead of
 * serving the bio verbatim.
 */
export function repairPersonBiographyLeakedDescription({
  fullDescription,
  shortDescription,
  researchAreas,
}: BiographyDescriptionRepairInput): BiographyDescriptionRepairResult {
  const originalFull = textValue(fullDescription);
  const originalShort = textValue(shortDescription);
  const dechromed = stripLeadingDegreeListPrefix(
    stripProfileFieldLabelChrome(
      stripTrailingProfileChromeFooter(stripProfileBiographyChromeOpener(originalFull)),
    ),
  );
  const sentences = protectedSentenceList(dechromed);
  const keptSentences = sentences.filter((sentence) => !isEducationOrCareerTimelineSentence(sentence));
  const strippedSentenceCount = sentences.length - keptSentences.length;
  const hadChrome = dechromed !== originalFull;

  // originalShort is checked only when non-empty: a blank short is a
  // separate, already-tracked coverage gap (missing_card_description), not a
  // defect this repair path should start populating as a side effect.
  const hasDefectiveNonEmptyShort = Boolean(originalShort) && isDefectiveShortDescription(originalShort);
  if (strippedSentenceCount === 0 && !hadChrome && !hasDefectiveNonEmptyShort) {
    return {
      outcome: 'unchanged',
      fullDescription: originalFull,
      shortDescription: originalShort,
      strippedSentenceCount: 0,
      totalSentenceCount: sentences.length,
    };
  }

  const rebuiltFull = keptSentences.join(' ').trim();
  const rebuiltFullQuality = fullDescriptionQuality(rebuiltFull);
  // fullDescriptionQuality assesses a description as one unit, so a single
  // legitimate "X is a Professor of Y" orienting sentence at the head of an
  // otherwise research-focused rebuilt text can flip the whole-text verdict
  // to appointment-only/synthetic-placeholder. describesResearchFocus is the
  // narrower, more reliable signal here: does genuine research-focus language
  // survive anywhere in what was kept.
  const rebuiltFullIsUsable = rebuiltFullQuality.isUseful || describesResearchFocus(rebuiltFull);

  if (rebuiltFull && rebuiltFullIsUsable) {
    // A short flagged only by shortDescriptionQuality's softer heuristics
    // (e.g. 'copied-first-sentence') is worth trying to improve on, but
    // never worth discarding outright if no improvement materializes - only
    // a hard defect (isDefectiveShortDescription) should end up blank
    // (#1533: wood-jpw54's stored short was a perfectly good, specific
    // sentence that both derivation fallbacks failed to replace with
    // anything, and the prior chain silently dropped it to '').
    const rebuiltShort = isSalvageableShortDescription(originalShort, rebuiltFull)
      ? originalShort
      : deriveShortDescriptionFromFullDescription(rebuiltFull) ||
        buildResearchAreasCardSummary(researchAreas) ||
        (isDefectiveShortDescription(originalShort) ? '' : originalShort);
    return {
      outcome: 'resynthesized',
      fullDescription: rebuiltFull,
      shortDescription: rebuiltShort,
      strippedSentenceCount,
      totalSentenceCount: sentences.length,
    };
  }

  const areaSummary = buildResearchAreasCardSummary(researchAreas);
  if (areaSummary) {
    return {
      outcome: 'resynthesized',
      fullDescription: areaSummary,
      shortDescription: areaSummary,
      strippedSentenceCount,
      totalSentenceCount: sentences.length,
    };
  }

  return {
    outcome: 'blanked',
    fullDescription: '',
    shortDescription: '',
    strippedSentenceCount,
    totalSentenceCount: sentences.length,
  };
}
