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

/**
 * Clean a scraped catalog description: strip chrome, then fail closed to an
 * empty string when the remainder is roster/PII-shaped or a navigation dump.
 */
export function sanitizeCatalogDescription(text: string): string {
  const stripped = stripCatalogChrome(text);
  if (!stripped) return '';
  if (isRosterShapedText(stripped) || isNavigationDumpText(stripped)) return '';
  return stripped;
}
