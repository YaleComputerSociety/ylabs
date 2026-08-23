/**
 * Remove direct contact details from public-facing evidence excerpts while
 * preserving enough quote context for source review.
 */
export function redactDirectContactInfo(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
    .replace(
      /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g,
      '[phone redacted]',
    );
}

const REDACTION_MARKER = /\[(?:email|phone) redacted\]/i;

const CONTACT_LABEL = '(?:e-?mail|phone|tel(?:ephone)?|fax|mobile|cell|contact(?:\\s+info(?:rmation)?)?)';

const LABELED_MARKER = new RegExp(
  `(?:\\b${CONTACT_LABEL}\\b\\s*[:\\-]?\\s*)?[<(]*\\[(?:email|phone) redacted\\][)>\\].]*`,
  'gi',
);

const LEADING_CONTACT_LABEL = new RegExp(`^\\s*${CONTACT_LABEL}\\b\\s*[:\\-]?\\s*`, 'i');

const EDGE_PUNCTUATION = /^[\s:;,.\-–—/|<>()[\]"'`]+|[\s:;,.\-–—/|<>()[\]"'`]+$/g;

const EVIDENCE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'call',
  'cell',
  'contact',
  'email',
  'e-mail',
  'fax',
  'for',
  'in',
  'info',
  'information',
  'inquiries',
  'inquiry',
  'is',
  'mail',
  'me',
  'mobile',
  'of',
  'on',
  'or',
  'out',
  'phone',
  'please',
  'question',
  'questions',
  'reach',
  'send',
  'tel',
  'telephone',
  'the',
  'to',
  'us',
  'via',
  'write',
]);

const cleanupResidue = (value: string): string =>
  value
    .replace(LEADING_CONTACT_LABEL, '')
    .replace(/\s{2,}/g, ' ')
    .replace(EDGE_PUNCTUATION, '')
    .trim();

const hasReadableSubstance = (value: string): boolean => {
  const contentWords = value
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 2 && !EVIDENCE_STOPWORDS.has(word));
  return contentWords.length >= 3;
};

/**
 * Given evidence text that has already had direct contact info redacted, drop
 * any residual `[email redacted]`/`[phone redacted]` markers so students never
 * see the raw placeholder token. Excerpts whose only informational content was
 * the redacted contact detail collapse to `undefined` rather than a bare marker
 * fragment; excerpts with real surrounding context keep that context.
 */
export function sanitizeEvidenceExcerpt(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!REDACTION_MARKER.test(trimmed)) return trimmed;

  const stripped = cleanupResidue(trimmed.replace(LABELED_MARKER, ' '));
  if (!stripped || !hasReadableSubstance(stripped)) return undefined;
  return stripped;
}
