const GENERIC_RESEARCH_METADATA_LABELS = new Set([
  'faculty research',
  'research profiles',
  'yale college',
  'school of medicine',
  'faculty of arts and sciences',
  'school of engineering & applied science',
]);

const SOURCE_CHROME_PATTERNS = [
  /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i,
  /\bORCID\s*/i,
  /Publications\s*Timeline/i,
  /\bYSM Researchers?\b/i,
  /ResearchersView/i,
  /View\s+(?:Lab Website|Full Profile|Related Publications?|Related Publication)/i,
  /View\s+\d+\s+(?:Common|Related)\s+Publications?/i,
  /\b(?:Common|Related)\s+Publications?\b/i,
  /^Publications$/i,
  /Yale Co-Authors/i,
  /Streamline Icon/i,
  /Director of Department Cores/i,
  /Course Director/i,
  /\bCitations\b/i,
];

const GENERIC_CONTEXT_DESCRIPTION_PATTERNS = [
  /^research homes connected by yale .+ metadata for .+\.?$/i,
  /^browse yale research homes connected to .+\.?$/i,
  /^research home (?:focused on|connected to)(?:\s|\.|$)/i,
  /^.+ is a yale research home(?: connected to .*)?\.?$/i,
  /(?:\sand\s\.)|\bconnected to\s*\./i,
];

export const normalizeResearchInlineText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export const stripResearchDescriptionChrome = (value: unknown): string => {
  let text = normalizeResearchInlineText(value);
  if (!text) return '';

  text = text
    .replace(/^INFORMATION FOR\s+(?=Copy Link\b|[A-Z])/i, '')
    .replace(/\bCopy Link\b/gi, ' ')
    .replace(/([a-z])\.([A-Z])/g, '$1. $2')
    .replace(/([a-z]),([a-z])/g, '$1, $2')
    .replace(/([a-z])(?=leading-edge\b)/gi, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();

  const tailMarkers = [
    /\bResearch\/Training Opportunities\b/i,
    /\bResearch and Training Opportunities\b/i,
    /\bWe welcome enthusiastic\b/i,
    /\bContact Us\b/i,
    /\bContact us\b/i,
    /\bDepartment of [A-Z][\s\S]*\b(?:United States|New Haven,\s*CT)\b/i,
  ];
  const tailIndex = tailMarkers.reduce((best, pattern) => {
    const match = text.match(pattern);
    if (!match || match.index === undefined) return best;
    return best === -1 ? match.index : Math.min(best, match.index);
  }, -1);
  if (tailIndex > 0) {
    text = text.slice(0, tailIndex).trim();
  }

  return text;
};

export const normalizeResearchStringArray = (values: unknown): string[] =>
  Array.isArray(values)
    ? values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    : [];

export const isResearchSourceChromeText = (value: unknown): boolean => {
  const text = normalizeResearchInlineText(value);
  return !!text && SOURCE_CHROME_PATTERNS.some((pattern) => pattern.test(text));
};

const hasResearchVerb = (value: string): boolean =>
  /\b(studies|investigates|examines|explores|focuses on|works on|develops|uses|employs|researches)\b/i.test(
    value,
  );

const isDescriptionPlaceholder = (value: unknown): boolean =>
  /^research areas?\s*(?::|include\b)/i.test(normalizeResearchInlineText(value));

const isAcademicAppointmentDescription = (value: unknown): boolean => {
  const text = normalizeResearchInlineText(value);
  if (!text) return false;
  if (hasResearchVerb(text)) return false;

  return [
    /^Department Chair\b.*\bProfessor of\b/i,
    /\bProfessor of\b.*;\s*Affiliated Faculty\b/i,
    /\bProfessor of\b.*\bDirector,\s+Yale\b/i,
    /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)+\s+is\s+(?:an?\s+)?(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b/i,
    /\b(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b.*\bPrincipal Investigator\b/i,
    /\bPrincipal Investigator\b.*\b(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b/i,
  ].some((pattern) => pattern.test(text));
};

const isRoleOnlyTitleFragment = (value: unknown): boolean => {
  const text = normalizeResearchInlineText(value);
  if (!text || text.length > 120) return false;
  const titlePatterns = [
    /^(?:track\s+)?director\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:co-)?director\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:principal\s+investigator|faculty|lecturer|instructor)\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /\b(?:course|program|track|site|center|centre|department)\s+director\b/i,
  ];
  if (titlePatterns.some((pattern) => pattern.test(text))) return true;
  if (hasResearchVerb(text)) return false;
  return false;
};

const isIncompleteSentenceFragment = (value: unknown): boolean => {
  const text = normalizeResearchInlineText(value);
  if (!text) return false;

  if (
    /^[a-z]/.test(text) &&
    /^(?:is|of|focuses?|focused|works|studies|examines|investigates|uses|employs)\b/i.test(text)
  ) {
    return true;
  }

  if (/\beduHQ\s*\d/i.test(text)) return true;
  if (/(?:\b(?:Dr|Prof|Mr|Ms|Mrs)|\b[A-Z])\.$/.test(text)) {
    return !/(?:U\.S|U\.K|Ph\.D|M\.D|B\.S|M\.S|Sc\.D)\.$/i.test(text);
  }

  return false;
};

const hasRepeatedSourceChromePhrase = (value: string): boolean => {
  const phraseCounts = new Map<string, number>();
  const phrasePattern =
    /\b(?:Director of Department Cores|Therapeutic Radiology|Radiobiology Course Director|View Lab Website|View Related Publication|View Full Profile|Common Publications|Related Publications|YSM Researcher|YSM Researchers)\b/gi;
  const text = normalizeResearchInlineText(value);
  let match = phrasePattern.exec(text);
  while (match) {
    const phrase = match[0].toLowerCase();
    phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
    match = phrasePattern.exec(text);
  }
  return Array.from(phraseCounts.values()).some((count) => count >= 2);
};

export const isGenericResearchHomeDescription = (value: unknown): boolean => {
  const text = normalizeResearchInlineText(value);
  if (!text) return false;
  return (
    GENERIC_CONTEXT_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(text)) ||
    isAcademicAppointmentDescription(text) ||
    isRoleOnlyTitleFragment(text) ||
    isIncompleteSentenceFragment(text) ||
    isResearchSourceChromeText(text) ||
    hasRepeatedSourceChromePhrase(text)
  );
};

export const publicResearchDescriptionText = (value: unknown): string => {
  const text = stripResearchDescriptionChrome(value);
  if (!text || isDescriptionPlaceholder(text) || isGenericResearchHomeDescription(text)) {
    return '';
  }
  return text;
};

export const isGenericResearchMetadataLabel = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 3) return true;
  if (/^\d+$/.test(normalized)) return true;
  return GENERIC_RESEARCH_METADATA_LABELS.has(normalized) || normalized === 'research';
};

export const normalizeResearchMetadataLabels = (
  values: Array<string | undefined | null> | unknown,
): string[] => {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const value of normalizeResearchStringArray(values)) {
    const key = value.toLowerCase();
    if (
      seen.has(key) ||
      value.length > 90 ||
      /https?:\/\//i.test(value) ||
      isGenericResearchMetadataLabel(value) ||
      isResearchSourceChromeText(value)
    ) {
      continue;
    }
    seen.add(key);
    labels.push(value);
  }

  return labels;
};
