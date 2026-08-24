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

const normalizeResearchInlineText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const isResearchSourceChromeText = (value: unknown): boolean => {
  const text = normalizeResearchInlineText(value);
  return !!text && SOURCE_CHROME_PATTERNS.some((pattern) => pattern.test(text));
};

const hasResearchVerb = (value: string): boolean =>
  /\b(studies|investigates|examines|explores|focuses on|works on|develops|uses|employs|researches)\b/i.test(
    value,
  );

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

const isGenericResearchHomeDescription = (value: unknown): boolean => {
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

export type ResearchHomeCardSummaryState = 'complete' | 'sparse';

export interface ResearchHomeCardSummary {
  text: string;
  state: ResearchHomeCardSummaryState;
  label: string;
}

export interface ResearchHomeCardSummaryInput {
  shortDescription?: string | null;
  fullDescription?: string | null;
  profileSynthesisDescription?: string | null;
  departments?: Array<string | undefined | null>;
  sourceUrls?: Array<string | undefined | null>;
  school?: string | null;
}

const uniq = (values: Array<string | undefined | null>): string[] =>
  Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean)));

const formatReadableList = (values: string[]): string => {
  if (values.length <= 1) return values[0] || '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

const buildCompleteContextSummary = (
  description?: string | null,
  label: string = 'Research description',
): ResearchHomeCardSummary | undefined => {
  const text = normalizeResearchInlineText(description);
  if (!text || isGenericResearchHomeDescription(text)) return undefined;
  return {
    text,
    state: 'complete',
    label,
  };
};

const hasUsefulFullDescription = (input: ResearchHomeCardSummaryInput): boolean => {
  const fullText = normalizeResearchInlineText(input.fullDescription);
  return Boolean(fullText && !isGenericResearchHomeDescription(fullText));
};

const isWeakShortDescription = (value?: string | null): boolean => {
  const text = normalizeResearchInlineText(value);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return (
    wordCount < 10 &&
    (/^my lab (?:focuses|studies|investigates|examines|works) (?:on|in|with)\b/i.test(text) ||
      /^our lab (?:focuses|studies|investigates|examines|works) (?:on|in|with)\b/i.test(text))
  );
};

const selectResearchDescriptionSummary = (
  input: ResearchHomeCardSummaryInput,
): ResearchHomeCardSummary | undefined => {
  const fullIsUseful = hasUsefulFullDescription(input);
  if (fullIsUseful) {
    const shortSummary = isWeakShortDescription(input.shortDescription)
      ? undefined
      : buildCompleteContextSummary(input.shortDescription);
    if (shortSummary) return shortSummary;
    return buildCompleteContextSummary(input.fullDescription);
  }

  const summaries = [
    buildCompleteContextSummary(input.profileSynthesisDescription, 'Profile context'),
  ].filter((summary): summary is ResearchHomeCardSummary => Boolean(summary));

  return summaries[0];
};

/**
 * Server-side mirror of the client's `buildResearchHomeContextSummary`
 * (client/src/utils/researchDiscoveryAdapters.ts). Kept in exact sync so the
 * card text a list/related response resolves here is byte-identical to what
 * the client would have derived itself from the raw description fields;
 * changing either side requires updating the other.
 */
export const resolveResearchHomeCardSummary = (
  input: ResearchHomeCardSummaryInput = {},
): ResearchHomeCardSummary => {
  const descriptionSummary = selectResearchDescriptionSummary(input);
  if (descriptionSummary) return descriptionSummary;

  const homeMetadata = uniq([...(input.departments || []), input.school]);
  const hasSourceLinks = (input.sourceUrls || []).some(Boolean);
  if (homeMetadata.length > 0) {
    return {
      text: hasSourceLinks
        ? `Limited public description. Open the profile to review source links and ${formatReadableList(homeMetadata)} context.`
        : `Limited public description. Use the ${formatReadableList(homeMetadata)} context while this profile is reviewed.`,
      state: 'sparse',
      label: 'Summary limited',
    };
  }

  return {
    text: hasSourceLinks
      ? 'Limited public description. Open the profile to review source links before deciding fit.'
      : 'Limited public description. This profile needs source review before fit can be assessed.',
    state: 'sparse',
    label: 'Summary limited',
  };
};
