/**
 * Determines whether a program/fellowship is research-related, for a research-focused
 * surface. A program is research-related if it can fund or support research in any form
 * (independent research, senior thesis/essay, dissertation, faculty-mentored research,
 * research travel, RA work). Programs with no research dimension at all (pure journalism,
 * public service, language study, study/tuition scholarships, non-research internships)
 * are not research-related and should be removed from the research surface.
 *
 * Pure function, no DB access — unit-testable.
 */

export interface ProgramResearchRelevanceInput {
  title?: string;
  studentFacingCategory?: string;
  programKind?: string;
  purpose?: string[];
  sourceUrl?: string;
  summary?: string;
  description?: string;
  eligibility?: string;
}

export interface ProgramResearchRelevanceResult {
  researchRelated: boolean;
  reasons: string[];
}

const RESEARCH_PURPOSES = new Set([
  'Research',
  'Senior Research Project or Senior Essay',
  'Dissertation Support',
]);

const RESEARCH_PROGRAM_KINDS = new Set([
  'SENIOR_THESIS_FUNDING',
  'TRAVEL_RESEARCH_GRANT',
  'RA_PROGRAM',
  'MENTOR_MATCHING',
  'SUMMER_RESEARCH_PROGRAM',
]);

const RESEARCH_TEXT =
  /\b(research|thesis|theses|dissertation|senior essay|scholarly|scientific|fieldwork|field research|laborator|faculty[- ]mentored|independent study)\b/i;

// Kinds that are research by construction rather than by a keyword the classifier matched.
// TRAVEL_RESEARCH_GRANT is absent on purpose: it is derived from text that mentions travel,
// so counting it here let study, language and internship travel awards through (#3904).
const INHERENTLY_RESEARCH_PROGRAM_KINDS = new Set([
  'SENIOR_THESIS_FUNDING',
  'RA_PROGRAM',
  'MENTOR_MATCHING',
  'SUMMER_RESEARCH_PROGRAM',
]);

const FUNDS_RESEARCH_PROSE =
  /\b(?:(?<!non-)research (?:trips?|projects?|travel|expenses|costs|stays?)|(?:conduct|conducting|support|supports|fund|funds)\s+(?:(?!(?:or|and|interested|in)\b)\w+\s+){0,3}research(?!\s+opportunit)|whose research)\b/i;

// A structured program built on faculty mentorship is a student's way into research even when
// its page never uses the word, so it belongs on /programs (product decision, 2026-09-30).
const FACULTY_MENTORSHIP_PROSE = /\bfaculty\b[\w\s-]{0,30}\bmentor(?:s|ship|ing)?\b/i;

const isMentoredResearchPathway = (programKind: string, prose: string): boolean =>
  programKind === 'STRUCTURED_PROGRAM' && FACULTY_MENTORSHIP_PROSE.test(prose);

const RESEARCH_CAREER_AWARD =
  /\b(?:pursue|pursuing|intend(?:s|ing)? to pursue)\s+research careers?\b/i;

// Strong non-research markers in the title that override an incidental "Research" purpose tag.
const NON_RESEARCH_TITLE =
  /\b(journalism|non-research|public service|language study|study abroad scholarship|tuition)\b/i;

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function classifyProgramResearchRelevance(
  input: ProgramResearchRelevanceInput,
): ProgramResearchRelevanceResult {
  const title = text(input.title);
  const blob = [
    title,
    text(input.studentFacingCategory),
    text(input.summary),
    text(input.description),
    text(input.eligibility),
  ]
    .filter(Boolean)
    .join(' ');
  const purposes = Array.isArray(input.purpose) ? input.purpose.map(text) : [];
  const programKind = text(input.programKind).toUpperCase();
  const reasons: string[] = [];
  const sourceProse = [title, text(input.summary), text(input.description), text(input.eligibility)]
    .filter(Boolean)
    .join(' ');
  const mentoredPathway = isMentoredResearchPathway(programKind, sourceProse);

  const titleSaysNonResearch = NON_RESEARCH_TITLE.test(title);
  const purposeResearch = purposes.some((p) => RESEARCH_PURPOSES.has(p));
  const kindResearch = RESEARCH_PROGRAM_KINDS.has(programKind);
  const textResearch = RESEARCH_TEXT.test(blob);

  if (purposeResearch) reasons.push('research_purpose');
  if (kindResearch) reasons.push('research_program_kind');
  if (textResearch) reasons.push('research_text');
  if (mentoredPathway) reasons.push('mentored_research_pathway');
  if (titleSaysNonResearch) reasons.push('non_research_title');

  // A title that explicitly disclaims research (e.g. "...Non-Research Projects", journalism,
  // language study, study/tuition scholarship) is not research-related even if a generic
  // "Research" purpose tag is attached — unless the program kind is a dedicated research kind.
  if (titleSaysNonResearch && !kindResearch) {
    return { researchRelated: false, reasons };
  }

  // The purpose facet is the source catalog's own statement of what an award funds, so a
  // record that carries one is research-related only when the facet says so, its own title
  // names research, or its kind is research by construction. Incidental prose ("research
  // opportunities", "language immersion or research") otherwise admitted study, language,
  // internship and postgraduate awards to a research surface (#3904).
  if (purposes.length > 0 && !purposeResearch && !mentoredPathway) {
    const titleResearch = RESEARCH_TEXT.test(title);
    const inherentKind = INHERENTLY_RESEARCH_PROGRAM_KINDS.has(programKind);
    const researchCareer = RESEARCH_CAREER_AWARD.test(sourceProse);
    const fundsResearch = FUNDS_RESEARCH_PROSE.test(sourceProse);
    if (!titleResearch && !inherentKind && !researchCareer && !fundsResearch) {
      reasons.push('purpose_not_research');
      return { researchRelated: false, reasons };
    }
  }

  const researchRelated = purposeResearch || kindResearch || textResearch || mentoredPathway;
  if (!researchRelated) reasons.push('no_research_signal');
  return { researchRelated, reasons };
}
