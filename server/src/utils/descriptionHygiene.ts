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
];

export function stripCatalogChrome(text: string): string {
  let out = String(text || '');
  for (const pattern of CATALOG_CHROME_PATTERNS) out = out.replace(pattern, ' ');
  return normalizeHygieneWhitespace(out);
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

/**
 * Clean a scraped catalog description: strip chrome, then fail closed to an
 * empty string when the remainder is roster/PII-shaped, a navigation dump, an
 * FAQ/Q&A dump, an eligibility-form label dump, or internal
 * curation/reviewer-rationale prose.
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
    isCurationRationaleText(stripped)
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
