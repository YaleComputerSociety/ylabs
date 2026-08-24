export interface FundingProgramTopicMatch {
  department?: string;
  researchArea?: string;
}

interface FundingProgramTopicRule extends FundingProgramTopicMatch {
  pattern: RegExp;
}

/**
 * Curated, evidence-grounded sponsor/program-name -> topic mappings for
 * FELLOWSHIP_PROGRAM/RA_PROGRAM entities (issue #1700). Every pattern keys off
 * a phrase naming the funding entity's own sponsoring council, program, or
 * department in its own title/description - never a bare region or subject
 * mentioned in passing - so a fellowship whose text names a country but not a
 * field of study (e.g. "research in Japan") is left to the fail-closed
 * default of no derived value rather than a guessed area.
 */
export const FUNDING_PROGRAM_TOPIC_RULES: readonly FundingProgramTopicRule[] = [
  {
    pattern: /council on middle east(?:ern)? studies|\bcmes\b/i,
    researchArea: 'Middle Eastern Studies',
  },
  {
    pattern: /european (?:union )?studies (?:council|program)/i,
    researchArea: 'European Studies',
  },
  {
    pattern: /latin american (?:and iberian )?studies|\bclais\b/i,
    department: 'Latin American Studies',
  },
  {
    pattern: /department of classics/i,
    department: 'Classics',
  },
  {
    pattern: /judaic studies|\bjudaica\b/i,
    researchArea: 'Judaic Studies',
  },
  {
    pattern: /\bbaltic studies\b/i,
    researchArea: 'Baltic Studies',
  },
  {
    pattern: /women'?s,? gender,? and sexuality studies/i,
    department: "Women's, Gender, and Sexuality Studies",
  },
  {
    pattern: /french (?:major|department)/i,
    department: 'French',
  },
  {
    pattern: /research opportunities in economics/i,
    department: 'Economics',
  },
  {
    pattern: /\breees\b/i,
    department: 'Russian, East European, and Eurasian Studies',
  },
  {
    pattern: /\bcanadian studies\b/i,
    researchArea: 'Canadian Studies',
  },
  {
    pattern: /program in grand strategy|grand strategy (?:fellowships|summer research award)/i,
    researchArea: 'Grand Strategy',
  },
] as const;

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Returns the first curated topic match for a funding program's own name and
 * description, or `{}` when nothing is grounded. Rules are checked in order
 * and the first hit wins, so more specific council/department phrases are
 * listed ahead of broader ones.
 */
export function deriveFundingProgramTopic(
  name: unknown,
  fullDescription: unknown,
): FundingProgramTopicMatch {
  const text = `${textValue(name)}\n${textValue(fullDescription)}`;
  if (!text.trim()) return {};
  for (const rule of FUNDING_PROGRAM_TOPIC_RULES) {
    if (rule.pattern.test(text)) {
      return { department: rule.department, researchArea: rule.researchArea };
    }
  }
  return {};
}
