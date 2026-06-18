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

  const titleSaysNonResearch = NON_RESEARCH_TITLE.test(title);
  const purposeResearch = purposes.some((p) => RESEARCH_PURPOSES.has(p));
  const kindResearch = RESEARCH_PROGRAM_KINDS.has(programKind);
  const textResearch = RESEARCH_TEXT.test(blob);

  if (purposeResearch) reasons.push('research_purpose');
  if (kindResearch) reasons.push('research_program_kind');
  if (textResearch) reasons.push('research_text');
  if (titleSaysNonResearch) reasons.push('non_research_title');

  // A title that explicitly disclaims research (e.g. "...Non-Research Projects", journalism,
  // language study, study/tuition scholarship) is not research-related even if a generic
  // "Research" purpose tag is attached — unless the program kind is a dedicated research kind.
  if (titleSaysNonResearch && !kindResearch) {
    return { researchRelated: false, reasons };
  }

  const researchRelated = purposeResearch || kindResearch || textResearch;
  if (!researchRelated) reasons.push('no_research_signal');
  return { researchRelated, reasons };
}
