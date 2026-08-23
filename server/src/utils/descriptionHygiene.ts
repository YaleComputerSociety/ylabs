/**
 * Shared description hygiene for source-scraped catalog prose.
 *
 * Two responsibilities:
 *  - strip page chrome (navigation, breadcrumbs, leaked script/style) from
 *    text that was lifted out of a rendered page;
 *  - fail closed on personally-identifying page content (recipient rosters,
 *    navigation dumps) that must never become a student-facing description.
 *
 * The department undergrad-research scraper (#598/#605) and the fellowship
 * catalog scraper (#609/#610) both feed here, and the read-time program
 * payload uses it as a second line of defense over already-stored records.
 */
import { redactDirectContactInfo } from './contactRedaction';

export function normalizeHygieneWhitespace(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const SECTION_HEADING_CHROME = [
  'Undergraduate Research Opportunities',
  'Undergraduate Research Opportunity',
  'About the Undergraduate Program',
  'Undergraduate Research',
  'Research Opportunities',
  'Undergraduate Programs',
  'Undergraduate Program',
  'Undergraduate Studies',
  'Overview',
  'Introduction',
];

export const leadingSectionHeadingPattern = new RegExp(
  `^(?:(?:${SECTION_HEADING_CHROME.join('|')})\\s+)+(?=[A-Z])`,
);

export const sourceChromeTextPattern =
  /\b(?:show all breadcrumbs|expand all|homeabout|home academics|calendar|applyprizes|recipient|copyright|privacy|click here|learn more|read more|for more information|more information|apply now|back to top|sign up)\b/i;

export function stripInlineUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\b[a-z0-9][a-z0-9-]*\.(?:gle|com|edu|org|gov|io|net|us)\b\S*/gi, ' ');
}

export function stripLeadingSectionHeadingChrome(sentence: string): string {
  return normalizeHygieneWhitespace(sentence.replace(leadingSectionHeadingPattern, ''));
}

const redactionPlaceholderPattern =
  /\s*(?:\b(?:at|to|via|contact(?:ed)?|email(?:ed)?|reach(?:ed)?(?:\s+out)?|sent)\b\s*)?[:-]?\s*\[(?:email|phone) redacted\]/gi;

export function stripRedactionPlaceholders(text: string): string {
  return normalizeHygieneWhitespace(
    String(text || '')
      .replace(redactionPlaceholderPattern, ' ')
      .replace(/\s+([.,;:!?])/g, '$1'),
  );
}

const CATALOG_CHROME_PATTERNS: RegExp[] = [
  /\$\(document\)\.ready\([\s\S]*?\}\s*\)\s*;?/gi,
  /\$\([^)]*\)[^;{}]*\{[\s\S]*?\}\s*\)?\s*;?/g,
  /\.[-\w]+\s*\{[^}]*\}/g,
  /\bskip to (?:main )?(?:content|navigation|main navigation)\b/gi,
  /\bshow all breadcrumbs\b/gi,
  /\bshow breadcrumbs\b/gi,
  /\btoggle navigation\b/gi,
  /\bexpand all\b/gi,
  /\bcollapse all\b/gi,
  /\bmain menu\b/gi,
  /\bINFORMATION FOR\b/g,
  /\bCopy Link\b/g,
];

export function stripCatalogChrome(text: string): string {
  let out = String(text || '');
  for (const pattern of CATALOG_CHROME_PATTERNS) out = out.replace(pattern, ' ');
  return normalizeHygieneWhitespace(out);
}

const researchAreaHeadingLeakPattern =
  /(?:^\s*|[,;]\s*(?:and\s+)?|\b(?:Studies|include|including)\s+)research\s+(?:areas?|interests?|fields?|topics?)\s*:(?:\s|\.|$)/i;

/**
 * A synthesized topic blurb ("Studies X, Y, and research areas:.") that leaked a
 * bare section-heading token ("research areas:", "research interests:") into its
 * joined area list. The trailing colon on a heading word used as a list item is
 * the tell - clean topical tags never carry it - so this stays clear of genuine
 * summaries. Fails closed on the leak so the corrupted card blurb is dropped
 * rather than shown (#816).
 */
export function isResearchAreaTemplateLeakText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(String(text || ''));
  if (!normalized) return false;
  return researchAreaHeadingLeakPattern.test(normalized);
}

/**
 * Chrome-only cleaner for a research-entity shortDescription (card blurb and
 * detail field): strip page chrome and redact contact info, but skip the
 * fail-closed dump detection of sanitizeResearchEntityDescription so a genuine
 * research summary phrased as a question is not wrongly blanked, while a
 * chrome-only blurb collapses to empty (#808). Also fails closed on a leaked
 * research-areas heading fragment in a synthesized topic blurb (#816).
 */
export function sanitizeResearchEntityShortDescription(text: string): string {
  const cleaned = stripTrailingContactAddress(
    stripCatalogChrome(redactDirectContactInfo(String(text || ''))),
  );
  if (isResearchAreaTemplateLeakText(cleaned)) return '';
  if (isInstitutionalCenterBlurbText(cleaned)) return '';
  return cleaned;
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}

/**
 * A recipient roster or person list: a run of "Name '28 Mentor: ..." rows, or a
 * dense list of names with almost no sentences. Class-year and mentor markers
 * are the strongest signal; the name-density arm is gated on the absence of
 * real sentences so multi-sentence prose that merely names people is kept.
 */
export function isRosterShapedText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  const classYearMarkers = countMatches(normalized, /[‘’'`]\s?\d{2}\b/g);
  if (classYearMarkers >= 3) return true;
  const mentorMarkers = countMatches(normalized, /\bmentors?\s*:/gi);
  if (mentorMarkers >= 3) return true;
  const uniqueNames = new Set(normalized.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g) || []).size;
  const sentenceEnders = countMatches(normalized, /[.!?](?:\s|$)/g);
  return uniqueNames >= 8 && sentenceEnders <= 3;
}

/**
 * A navigation/menu dump: a long run of capitalized menu labels with no real
 * sentences. Gated so short blurbs and ordinary multi-sentence prose pass.
 */
export function isNavigationDumpText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 40) return false;
  const sentenceEnders = countMatches(normalized, /[.!?](?:\s|$)/g);
  if (sentenceEnders > 2) return false;
  const capitalized = words.filter((word) => /^[A-Z]/.test(word)).length;
  return capitalized / words.length > 0.4;
}

const interrogativeQuestionPattern =
  /(?:^|[.!?]\s|\bFAQs?\b\s*|\bFrequently Asked Questions\b\s*)(?:can|could|do|does|did|how|what|when|where|which|who|whose|why|is|are|will|would|should|may|must|have|has)\b[^.?!]{0,200}\?/gi;

const faqMarkerPattern = /\bfrequently asked questions\b|\bfaqs?\b/i;

/**
 * An FAQ / Q&A page dump: a scraped page body whose "prose" is actually a run
 * of question-and-answer pairs. FAQ questions terminate in "?", so they defeat
 * isNavigationDumpText (which bails on real sentence enders); this arm catches
 * them instead. Kept conservative so prose with a single rhetorical question is
 * unaffected.
 */
export function isFaqDumpText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  const questionMarks = countMatches(normalized, /\?/g);
  if (questionMarks >= 3) return true;
  if (countMatches(normalized, interrogativeQuestionPattern) >= 2) return true;
  return faqMarkerPattern.test(normalized) && questionMarks >= 1;
}

const formFieldLabelPattern = /\b[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,3}:\s/g;

/**
 * An eligibility/requirements form dump: a dense run of "Label: value" fields
 * (Level: ..., Class: ..., Deadline: ...) with almost no real sentences, lifted
 * verbatim from a form or requirements table. Gated on the absence of sentences
 * so ordinary prose that merely uses a colon is kept.
 */
export function isFormFieldDumpText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 12) return false;
  const sentenceEnders = countMatches(normalized, /[.!?](?:\s|$)/g);
  if (sentenceEnders > 2) return false;
  return countMatches(normalized, formFieldLabelPattern) >= 4;
}

const CURATION_RATIONALE_PATTERNS: RegExp[] = [
  /\bsource-backed\b/i,
  /\bsafe to show\b/i,
  /\bshow (?:it )?prominently\b/i,
  /\bpublic copy\b/i,
  /\boperators?\s+should\b/i,
  /\bshould not be described as\b/i,
  /\btreat it as (?:a |an )?(?:restrained|broad)\b/i,
  /\buntil a (?:more specific )?(?:current )?(?:award|fellowship|program|funding) page is attached\b/i,
  /\bkeep public copy restrained\b/i,
  /\bclear student audience\b/i,
];

/**
 * Internal curation / reviewer-rationale prose: an LLM or operator suitability
 * assessment written *about the record* ("is source-backed", "safe to show
 * prominently", "operators should refresh", "keep public copy restrained until
 * ... is attached") instead of a student-facing description of the program.
 * These phrases are internal review vocabulary that never appears in genuine
 * source prose, so a single marker is enough to fail closed (#671).
 */
export function isCurationRationaleText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  return CURATION_RATIONALE_PATTERNS.some((pattern) => pattern.test(normalized));
}

const ctaImperativePattern =
  /\b(?:sign\s?up|join\s+(?:us|the\s+(?:conversation|community|movement|discussion|mailing\s+list))|register(?:\s+(?:now|today|here))?|rsvp|subscribe|donate|get\s+involved|follow\s+us|take\s+(?:the|a)\s+quiz|find\s+out\s+which\s+group|stay\s+(?:tuned|informed))\b/i;

const socialPlatformPattern =
  /\b(?:LinkedIn|Bluesky|Twitter|Instagram|Facebook|YouTube|TikTok|Mastodon|Threads)\b/gi;

const socialCtaSignoffPattern =
  /\b(?:join|follow|connect\s+with|find\s+us|share|watch|subscribe\s+to)\b[^.!?]{0,60}\b(?:LinkedIn|Bluesky|Twitter|Instagram|Facebook|YouTube|TikTok|Mastodon|Threads)\b/i;

const datedEventTeaserPattern =
  /\bon\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b[^.!?]{0,40}?\b\d{1,2}(?:st|nd|rd|th)?\b/i;

const secondPersonPattern = /\b(?:you|your|you['’]re|yourself)\b/gi;

const welcomeGreetingPattern = /(?:^|[.!?]\s)Welcome!/;

/**
 * A homepage news-ticker / call-to-action dump: disjointed promotional teaser
 * fragments (dated event announcements, a "Sign up"/"Join us" imperative, a
 * "take a quiz" prompt, a "Welcome!" greeting, a "join us on LinkedIn/Bluesky/
 * YouTube" social sign-off) scraped verbatim from a communications-heavy landing
 * page instead of a coherent description of the entity. These well-formed
 * sentences defeat the sentence-ender-gated dumps
 * (isNavigationDumpText/isFormFieldDumpText bail when sentence enders exceed two)
 * and carry no "?" for isFaqDumpText, so this arm keys on CTA / second-person /
 * social-sign-off markers rather than sentence count (#898). A social-platform
 * call to action is unmistakable promotional chrome on its own; otherwise two
 * independent promotional signals are required so a genuine description that
 * merely invites contact is kept.
 */
export function isCtaNewsTickerDumpText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  if (socialCtaSignoffPattern.test(normalized)) return true;
  const distinctPlatforms = new Set(
    (normalized.match(socialPlatformPattern) || []).map((platform) => platform.toLowerCase()),
  ).size;
  const promotionalSignals = [
    ctaImperativePattern.test(normalized),
    distinctPlatforms >= 2,
    datedEventTeaserPattern.test(normalized),
    countMatches(normalized, secondPersonPattern) >= 2,
    welcomeGreetingPattern.test(normalized),
  ].filter(Boolean).length;
  return promotionalSignals >= 2;
}

function lastSentenceBoundary(text: string): number {
  const matches = [...text.matchAll(/[.!?]["')\]]?(?=\s|$)/g)];
  if (matches.length === 0) return -1;
  const last = matches[matches.length - 1];
  return (last.index ?? 0) + last[0].length;
}

/**
 * Clamp an over-long description to a complete sentence when one is available
 * in the tail, otherwise to a word boundary with an ellipsis, so stored prose
 * is never cut mid-word (#671). Shorter text is returned unchanged.
 */
export function clampDescriptionLength(text: string, maxLength = 2000): string {
  const value = normalizeHygieneWhitespace(text);
  if (value.length <= maxLength) return value;
  const window = value.slice(0, maxLength);
  const sentenceEnd = lastSentenceBoundary(window);
  if (sentenceEnd >= maxLength * 0.6) return window.slice(0, sentenceEnd).trim();
  const lastSpace = window.slice(0, maxLength).lastIndexOf(' ');
  const cut = lastSpace > 0 ? window.slice(0, lastSpace) : window.slice(0, maxLength);
  return `${cut.trim()}…`;
}

const contactRedactionTokenPattern = /\[(?:email|phone) redacted\]/i;
const contactBlockLabelPattern = /\b(?:email|phone|office|fax)\s*:/i;
const bareLocalPhonePattern = /\b(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]\d{4}\b/;

const STREET_SUFFIX_WORD = 'Street|Avenue|Road|Boulevard|Drive|Way|Lane|Place|Court|Circle';
const STREET_SUFFIX_ABBREVIATION = 'St|Ave|Rd|Blvd|Dr|Ln|Pl|Ct|Cir';
const OFFICE_UNIT_LABEL = 'Floor|Fl|Room|Rm|Suite|Ste';

/**
 * A bare street-address fragment (`266 Whitney Avenue`), optionally followed by
 * a floor/room/suite unit (`, Fl 2, Rm 234`), with no `office:`/`address:` label
 * of its own. Faculty-bio scrapes sometimes merge a page's office-location line
 * straight into the bio prose with no separating punctuation, so this must be
 * detected on shape alone (#798).
 */
const bareStreetAddressPattern = new RegExp(
  `\\b\\d{1,5}\\s+[A-Z][A-Za-z']*(?:\\s+[A-Z][A-Za-z']*){0,3}\\s+` +
    `(?:(?:${STREET_SUFFIX_WORD})\\b|(?:${STREET_SUFFIX_ABBREVIATION})\\.)` +
    `(?:[.,]?\\s*(?:${OFFICE_UNIT_LABEL})\\.?\\s*\\d+[A-Za-z]?)*`,
);

/**
 * A faculty-bio contact block: a leftover `[email redacted]`/`[phone redacted]`
 * placeholder token (the read-time-safe rendering elsewhere in this module,
 * but never acceptable in a research-entity description), an
 * `Email:`/`Phone:`/`Office:`/`Fax:` label paired with a bare phone number
 * lifted straight out of a profile-page header (#676), or a bare office/street
 * address fragment glued onto the bio with no label at all (#798).
 */
export function hasContactBlockResidue(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  if (contactRedactionTokenPattern.test(normalized)) return true;
  if (contactBlockLabelPattern.test(normalized) && bareLocalPhonePattern.test(normalized)) {
    return true;
  }
  return bareStreetAddressPattern.test(normalized);
}

const trailingOfficeAddressPattern =
  /\s+\d{1,5}\s+(?:[A-Z][\w.'-]*\s+){1,5}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Way|Lane|Ln|Place|Pl|Court|Ct|Terrace|Ter|Circle|Cir|Plaza|Highway|Hwy)\.?(?:[,\s]+(?:Fl|Floor|Rm|Room|Ste|Suite|Unit|Apt|Bldg|Building)\.?\s*\d+[A-Za-z]?)*(?:[,\s]+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})?(?:,?\s+[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?[.\s]*$/;

/**
 * Strip a bare campus office/street-address fragment glued onto the end of a
 * faculty-bio description (a lost-line-break scrape artifact, #798), preserving
 * the bio prose ahead of it. Requires a street number and a street-type suffix
 * so ordinary research prose that merely names a street is not affected; the
 * optional unit (Fl/Rm/Suite) and city/state/ZIP tail extend coverage. Only a
 * trailing, sentence-final fragment is removed so a mid-text mention is left
 * intact.
 */
export function stripTrailingContactAddress(text: string): string {
  const value = String(text || '');
  const stripped = value.replace(trailingOfficeAddressPattern, '');
  return stripped === value ? value : normalizeHygieneWhitespace(stripped);
}

const publicationsListMarkerPattern = /\bselected\s+publications?\s*:/i;

/**
 * A "Selected Publications:" citation-list dump lifted from a faculty profile
 * page into a research-entity description (#676).
 */
export function isPublicationsListDumpText(text: string): boolean {
  return publicationsListMarkerPattern.test(normalizeHygieneWhitespace(text));
}

const INSTITUTIONAL_CENTER_BLURB_PATTERNS: RegExp[] = [
  /\bleading center of excellence\b/i,
  /\bcenter of excellence for\b[\s\S]{0,80}\bresearch and teaching\b/i,
  /\ba center dedicated to research and teaching\b/i,
  /\bresearch and teaching on the local,?\s*national,?\s*and international levels\b/i,
];

/**
 * A center/council promotional landing blurb ("... is a leading center of
 * excellence for X research and teaching on the local, national, and
 * international levels") scraped from an institution's own page and grafted
 * onto a lab or individual research entity that the page merely lists (#893).
 * The text is well-formed prose, so chrome/dump detectors miss it; it is wrong
 * only because it describes an *organization*, not this entity's research.
 *
 * The "Welcome to ..." opener is deliberately NOT a marker: 44 legitimate lab
 * descriptions open with it, so matching would blank real prose. The
 * center-of-excellence markers below hit only the grafts.
 */
export function isInstitutionalCenterBlurbText(text: string): boolean {
  const normalized = normalizeHygieneWhitespace(text);
  if (!normalized) return false;
  return INSTITUTIONAL_CENTER_BLURB_PATTERNS.some((pattern) => pattern.test(normalized));
}

const researchAreaEchoPattern = /^Research\s+(?:fields?|areas?)\s+include\b[^.!?]+[.!?]?$/i;

/**
 * A vacuous "Research fields include <A>, <B>, and <C>." description whose only
 * content is a comma-join of the entity's own researchAreas: a bare labeled
 * chip list carrying no prose, fully redundant with the chips already shown
 * beside it (#623). Gated to a single sentence (the pattern admits no internal
 * sentence terminator) so genuine prose that merely opens with the phrase and
 * continues into a real description is kept.
 */
export function isResearchAreaEchoDescription(text: string): boolean {
  return researchAreaEchoPattern.test(normalizeHygieneWhitespace(text));
}

/**
 * Clean a scraped catalog description: strip chrome, then fail closed to an
 * empty string when the remainder is roster/PII-shaped, a navigation dump, an
 * FAQ/Q&A dump, an eligibility-form label dump, internal
 * curation/reviewer-rationale prose, or a homepage news-ticker / CTA dump.
 *
 * Redaction placeholder tokens ([email redacted]/[phone redacted]) are the
 * intended safe rendering of contact info at read time and are left in place
 * here; stored prose that reads awkwardly around a token is cleaned at rest by
 * stripRedactionPlaceholders in the #671 backfill.
 */
export function sanitizeCatalogDescription(text: string): string {
  const stripped = stripCatalogChrome(text);
  if (!stripped) return '';
  if (
    isRosterShapedText(stripped) ||
    isNavigationDumpText(stripped) ||
    isFaqDumpText(stripped) ||
    isFormFieldDumpText(stripped) ||
    isCurationRationaleText(stripped) ||
    isCtaNewsTickerDumpText(stripped)
  ) {
    return '';
  }
  return stripped;
}

/**
 * Stored-layer sanitizer for catalog description prose, applied at every write
 * step (program/fellowship materialize and the #671 backfill) so a
 * re-materialize over a stale dirty observation can never re-introduce a
 * chrome/roster/FAQ/form/curation dump, a leaked contact detail, a baked-in
 * [email redacted] token, or a mid-word truncation.
 *
 * Contact details are redacted and their placeholder tokens then removed here
 * because the [email redacted] token is the intended read-time contact
 * rendering, not stored prose (#671): a stored description must read as clean
 * prose, so the token cleanup lives at the write step, not at read time. Fails
 * closed to an empty string on dump shapes.
 */
export function sanitizeStoredCatalogDescription(text: string, maxLength = 2000): string {
  const redacted = redactDirectContactInfo(String(text || ''));
  return clampDescriptionLength(
    stripRedactionPlaceholders(sanitizeCatalogDescription(redacted)),
    maxLength,
  );
}

/**
 * Research-entity description sanitizer (write- and read-time), stricter than
 * sanitizeCatalogDescription/sanitizeStoredCatalogDescription: a faculty/lab
 * fullDescription or shortDescription is the primary "what this lab studies"
 * surface, so a leftover contact-block token, a "Selected Publications:"
 * citation dump, or a bare "Research fields include <chips>." area echo (#623)
 * fails the whole description closed rather than surviving as read-time-safe
 * token text, a truncated tail (#676), or a vacuous restatement of the chips.
 */
export function sanitizeResearchEntityDescription(text: string): string {
  const redacted = redactDirectContactInfo(String(text || ''));
  const stripped = stripTrailingContactAddress(sanitizeCatalogDescription(redacted));
  if (!stripped) return '';
  if (
    hasContactBlockResidue(stripped) ||
    isPublicationsListDumpText(stripped) ||
    isResearchAreaEchoDescription(stripped) ||
    isInstitutionalCenterBlurbText(stripped)
  ) {
    return '';
  }
  return stripped;
}
