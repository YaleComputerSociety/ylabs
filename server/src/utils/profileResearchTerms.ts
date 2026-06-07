const ORCID_VALUE_RE = /\b(?:orcid\s*)?\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3}[\dX]\b/i;
const PUBLICATION_METADATA_MARKER_RE =
  /^(?:PM(?:ID|CID)\s*:|DOI\s*:|(?:total|recent)\s+citations?$|(?:field|relative)\s+citation\s+ratio$|(?:MeSH\s+)?Keywords?(?:\s+and\s+Concepts)?$)/i;

const RESEARCH_TERM_NOISE_PATTERNS = [
  ORCID_VALUE_RE,
  /streamline\s+icon/i,
  /streamlinehq\.com/i,
  /^view\s+lab\s+website$/i,
  /^view\s+(?:\d+\s+)?related\s+publications?$/i,
  /view\s+full\s+profile/i,
  /view\s+(?:\d+\s+)?common\s+publications?/i,
  /^(?:publications?|citations?)$/i,
  /^[\d,]+$/,
  /^\d+\s+publications?(?:\s+\d+\s+citations?)?$/i,
  /^\d+\s+citations?$/i,
  /^\d+\s*YSM\s+Researchers?$/i,
  /^YSM\s+Researchers?$/i,
  /^PM(?:ID|CID)\s*:/i,
  /^DOI\s*:/i,
  /^(?:total|recent)\s+citations?$/i,
  /^(?:field|relative)\s+citation\s+ratio$/i,
  /^(?:MeSH\s+)?Keywords?(?:\s+and\s+Concepts)?$/i,
  /^Concepts$/i,
  /^n\/a$/i,
  /^\d+(?:\.\d+)?$/,
  /^research\s+interests$/i,
  /^research\s+topics\b.*\binterested\s+in\s+exploring\.?$/i,
  /[a-z][A-Z]/,
  /^(?:theorist|experimentalist)$/i,
  /\b(?:assistant|associate|clinical|adjunct|visiting)?\s*professor\b/i,
  /\b(?:research\s+(?:associate|scientist|faculty|staff)|lecturer|instructor)\b/i,
  /\bgoogle\s+scholar\s+profile\b/i,
  /^for\s+a\s+full\s+list\b/i,
  /^more\s+than\s+\d+.*\bpapers?\s+published\b/i,
  /^(?:chemicals\s+and\s+drugs|diseases|health\s+care)$/i,
  /^\d{4}\b.*\b(?:award|prize|fellowship|winner|competition)\b/i,
  /^teaching\s+interests?:/i,
  /\b[A-Z&]{2,}\s*\d{3,4}\b/,
  /^(?:i|we)\s+/i,
  /^(?:although|as opposed to|they|much of|known to|in contrast|rather than)\b/i,
  /\bin their\b/i,
];

const RESEARCH_TERM_CHROME_REPLACEMENTS = [
  /\b(?:orcid\s*)?\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3}[\dX]\b/gi,
  /\d+\s*YSM\s+Researchers?/gi,
  /View\s+(?:\d+\s+)?(?:Common|Related)\s+Publications?/gi,
  /View\s+(?:Lab Website|Full Profile|Related Publication)/gi,
];

function cleanResearchTerm(value: string): string {
  let cleaned = value;
  for (const pattern of RESEARCH_TERM_CHROME_REPLACEMENTS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  cleaned = cleaned
    .replace(/^research\s+areas?:\s*our work is interdisciplinary and combines elements of\s+/i, '')
    .replace(/^research\s+areas?:\s*/i, '')
    .replace(/^(?:and|or|including)\s+/i, '');

  const firstSentence = cleaned.split(/\.\s+/)[0]?.trim() || '';
  if (
    firstSentence &&
    /(?:^|\s)(?:we use|in its sum|our research attempts)\b/i.test(cleaned) &&
    !/^(?:we use|in its sum|our research attempts)\b/i.test(firstSentence)
  ) {
    cleaned = firstSentence;
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

function extractExplicitResearchInterestPhrases(value: string): string[] {
  const firstSentence = value.split(/\.\s+/)[0]?.trim() || '';
  const cleaned = firstSentence.replace(/^research\s+areas?:\s*/i, '').trim();
  const includeMatch = cleaned.match(/\bresearch\s+interests?\s+include\s+(?:the\s+)?(.+)$/i);
  const studiesHowMatch = cleaned.match(/^studies\s+how\s+(.+?)\s+(?:shape|shapes|affect|affects|influence|influences|drive|drives)\b/i);
  const phraseText = includeMatch?.[1] || studiesHowMatch?.[1] || '';
  if (!phraseText) return [];

  return phraseText
    .split(/\s*,\s*|\s+and\s+/)
    .map((phrase) => phrase.replace(/^(?:the|a|an)\s+/i, '').replace(/[.;:,]+$/g, '').trim())
    .filter((phrase) => {
      const wordCount = phrase.split(/\s+/).filter(Boolean).length;
      return wordCount > 0 && wordCount <= 8;
    });
}

function isProseResearchBlurb(value: string): boolean {
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  return (
    (/^research\s+areas?:/i.test(value) && wordCount > 12) ||
    /^our\s+work\b/i.test(value) ||
    /^(?:we use|in its sum|our research attempts)\b/i.test(value) ||
    wordCount > 10
  );
}

export function sanitizeProfileResearchTerms(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  if (values.some((raw) => PUBLICATION_METADATA_MARKER_RE.test(String(raw || '').trim()))) {
    return [];
  }

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (RESEARCH_TERM_NOISE_PATTERNS.some((pattern) => pattern.test(value))) continue;
    const candidates = extractExplicitResearchInterestPhrases(value);
    if (candidates.length === 0) candidates.push(cleanResearchTerm(value));

    for (const candidate of candidates) {
      const cleaned = cleanResearchTerm(candidate);
      if (!cleaned) continue;
      if (isProseResearchBlurb(cleaned)) continue;
      if (RESEARCH_TERM_NOISE_PATTERNS.some((pattern) => pattern.test(cleaned))) continue;

      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
    }
  }

  return out;
}
