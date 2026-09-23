/**
 * These two population predicates were the undergraduate-logistics materializer's,
 * and moved here when that vertical was retired (#3088). This file is now their
 * only consumer, and they are the only part of that materializer any live read
 * path used.
 */
export const quoteHasUndergraduatePopulation = (quote: string): boolean => {
  if (
    /\b(?:undergrads?|undergraduates?|undergraduate\s+students?|college\s+students?|yale\s+college\s+students?)\b/i.test(
      quote,
    ) ||
    /\b(?:first[- ]years?|freshm(?:an|en)|sophomores?|juniors?|seniors?)\b/i.test(quote)
  ) {
    return true;
  }

  return (
    /\bstudents?\b/i.test(quote) &&
    !/\b(?:graduate|doctoral|ph\.?d\.?|master'?s?)\s+students?\b/i.test(quote)
  );
};

const clauseHasExclusionOrConditionalScope = (clause: string): boolean =>
  /\b(?:except(?:ing)?|excluding|other\s+than)\b|\bonly\s+(?:if|when)\b/i.test(clause);

const clauseIsDeclarative = (clause: string): boolean =>
  !/^\s*(?:are|is|can|may|will|do|does|did|would|could|should|how|when|where)\b/i.test(clause) &&
  !/\b(?:ask(?:ed|ing)?\s+(?:if|whether)|wonder(?:ed|ing)?\s+(?:if|whether)|whether|would|could|might|hypothetical(?:ly)?|prefer(?:red|s|ring)?|would\s+(?:like|prefer)|propos(?:e|ed|al)|suggest(?:ed|ion)?|discuss(?:ed|ing|ion)?|consider(?:ed|ing)?\s+(?:whether|the\s+possibility))\b/i.test(
    clause,
  );

const undergraduateClaimClauses = (
  quote: string,
  hasPopulation: (clause: string) => boolean = quoteHasUndergraduatePopulation,
): string[] =>
  quote
    .split(
      /(?:[!?;]+|(?<!\d)\.(?!\d)|(?:,\s*|\s+)(?:and|but|while|whereas)\s+(?=(?:undergrads?|undergraduates?|undergraduate\s+students?|college\s+students?|yale\s+college\s+students?|students?|first[- ]years?|freshm(?:an|en)|sophomores?|juniors?|seniors?|graduate\s+(?:students?|assistants?)|doctoral\s+(?:students?|fellows?)|postdoctoral\s+fellows?|postdocs?|staff)\b)|,\s*(?=(?:undergrads?|undergraduates?|undergraduate\s+students?|college\s+students?|yale\s+college\s+students?|students?|first[- ]years?|freshm(?:an|en)|sophomores?|juniors?|seniors?|graduate\s+(?:students?|assistants?)|doctoral\s+(?:students?|fellows?)|postdoctoral\s+fellows?|postdocs?|staff)\b)|,\s*(?=(?:but|while|whereas)\b))/i,
    )
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0 && hasPopulation(clause));

const UNDERGRADUATE_RESEARCH_ROLE_TITLE = String.raw`(?:research\s+assistants?|research\s+aides?|lab\s+assistants?|laboratory\s+assistants?)`;

const quoteHasUndergraduateDeclinePopulation = (quote: string): boolean =>
  quoteHasUndergraduatePopulation(quote) ||
  new RegExp(`\\b${UNDERGRADUATE_RESEARCH_ROLE_TITLE}\\b`, 'i').test(quote);

const DIRECT_UNDERGRADUATE_NON_ACCEPTANCE_POLICY = new RegExp(
  `\\b(?:not\\s+(?:currently\\s+|now\\s+)?accepting|(?:currently|now)\\s+not\\s+accepting)\\b[^.!?;]{0,80}\\b(?:undergrads?|undergraduates?|undergraduate\\s+(?:students?|researchers?)|${UNDERGRADUATE_RESEARCH_ROLE_TITLE})\\b`,
  'i',
);

export function quoteExplicitlyDeclinesUndergraduates(quote: string): boolean {
  return undergraduateClaimClauses(quote, quoteHasUndergraduateDeclinePopulation).some(
    (clause) =>
      clauseIsDeclarative(clause) &&
      !clauseHasExclusionOrConditionalScope(clause) &&
      DIRECT_UNDERGRADUATE_NON_ACCEPTANCE_POLICY.test(clause),
  );
}

const HIGH_SCHOOL_POPULATION_PATTERN = /\bhigh[- ]schools?\b/i;

const RESUME_EDUCATION_LINE_PATTERN = /^education/i;

const SELF_REFERENTIAL_DEGREE_HISTORY_PATTERN =
  /\b(?:completed|received|earned|holds?|has)\b[^.!?]{0,60}\b(?:her|his|their|my)\b[^.!?]{0,30}\b(?:undergraduate|bachelor'?s?)\s+degree\b/i;

const ALUMNI_OR_HISTORICAL_POPULATION_PATTERN =
  /\balumn(?:i|us|ae|a)\b|\bformer\s+undergrad(?:uate)?s?\b|\b(?:has|have)\s+graduated\b|\bclass\s+of\s+\d{4}\b/i;

const VISITING_SCHOLAR_POPULATION_PATTERN =
  /\bvisiting\s+(?:scholars?|researchers?|students?|fellows?|undergrads?|undergraduates?)\b/i;

const EXPLICIT_UNDERGRAD_UNAVAILABILITY_PATTERNS: RegExp[] = [
  /\bnot\s+(?!only\b|just\b|merely\b|simply\b)(?:currently\s+|presently\s+|at\s+(?:this|the\s+present)\s+time\s+|actively\s+)?(?:accepting|taking(?:\s+on)?|admitting|recruiting|considering|seeking|looking\s+for|able\s+to\s+(?:take|accept|host|supervise|mentor|advise))\b[\s\S]{0,48}?(?:undergrad|under-grad|\bstudents?\b|\binterns?\b|research\s+assistants?|new\s+(?:lab\s+)?members?|mentees?|trainees?|applicants?)/i,
  /(?:undergrad(?:uate)?s?|\bstudents?\b|\binterns?\b)[\s\S]{0,48}?\bare\s+not\s+(?:currently\s+|presently\s+)?(?:being\s+)?(?:accepted|admitted|taken(?:\s+on)?|considered|recruited|hosted)\b/i,
  /\b(?:unable|not\s+able|cannot|can'?t|do(?:es)?\s+not|will\s+not|won'?t)\s+(?:currently\s+)?(?:to\s+)?(?:accept|take(?:\s+on)?|host|supervise|mentor|advise)\b[\s\S]{0,48}?(?:undergrad|\bstudents?\b|\binterns?\b)/i,
  /\bno\s+(?:undergraduate\s+|student\s+|open\s+|current\s+)?(?:openings|positions|opportunities|vacancies|spots|slots)\b/i,
  /\b(?:lab|group|position|opening|team|roster)s?\s+(?:is|are)\s+(?:currently\s+|now\s+|presently\s+)?(?:full|closed|at\s+(?:full\s+)?capacity)\b/i,
  /\bnot\s+(?:currently\s+|presently\s+)?accepting\s+applications\b/i,
  /\b(?:do(?:es)?\s+not|don'?t|cannot|can'?t)\s+have\s+(?:the\s+|any\s+)?(?:bandwidth|capacity|room|space)\b[\s\S]{0,60}?(?:undergrad|\bstudents?\b|\binterns?\b|positions?|inquiries|applications?)/i,
];

export function isExplicitUndergradUnavailabilityPhrase(quote?: string): boolean {
  const text = (quote || '').trim();
  if (!text) return false;
  return EXPLICIT_UNDERGRAD_UNAVAILABILITY_PATTERNS.some((pattern) => pattern.test(text));
}

export function isPlausibleUndergradEvidenceQuote(quote: string | undefined | null): boolean {
  const text = (quote || '').trim();
  if (!text) return false;
  if (HIGH_SCHOOL_POPULATION_PATTERN.test(text)) return false;
  if (RESUME_EDUCATION_LINE_PATTERN.test(text)) return false;
  if (SELF_REFERENTIAL_DEGREE_HISTORY_PATTERN.test(text)) return false;
  if (ALUMNI_OR_HISTORICAL_POPULATION_PATTERN.test(text)) return false;
  if (VISITING_SCHOLAR_POPULATION_PATTERN.test(text)) return false;
  if (quoteExplicitlyDeclinesUndergraduates(text)) return false;
  if (isExplicitUndergradUnavailabilityPhrase(text)) return false;
  return quoteHasUndergraduatePopulation(text);
}
