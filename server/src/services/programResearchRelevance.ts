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
  sourceName?: string;
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
const FACULTY_MENTORSHIP_PROSE = /\bfaculty\b[\w\s-]{0,30}\bmentor(?:s|ship|ing)?\b/gi;

const RESEARCH_CAREER_AWARD =
  /\b(?:pursue|pursuing|intend(?:s|ing)? to pursue)\s+research careers?\b/i;

const NEGATION = /\b(?:not(?!\s+yet\b)|no|never|nor|without|cannot)\b|n't\b(?!\s+yet\b)/i;

const SENTENCE_BOUNDARY = /(?<=[.!?;])\s+/;

const CLAUSE_BOUNDARY = /[,:]/;

const clauseBefore = (sentence: string, index: number): string =>
  sentence.slice(0, index).split(CLAUSE_BOUNDARY).pop() ?? '';

const affirmedIn = (fields: string[], pattern: RegExp): boolean =>
  fields
    .flatMap((field) => field.split(SENTENCE_BOUNDARY))
    .some((sentence) => {
      const match = pattern.exec(sentence);
      return match !== null && !NEGATION.test(clauseBefore(sentence, match.index));
    });

const NEGATION_JUST_BEFORE = /(?:\b(?:no|not|never|nor|without)\b|n't)(?:\s+[\w'-]+){0,3}\s*$/i;

const NEGATED_PREDICATE_AFTER =
  /^\s*(?:program\s+)?(?:(?:is|are|was|were)\s+not|isn't|aren't|wasn't|weren't|not\s+(?:required|needed|necessary|provided|offered))\b/i;

// A sentence that names faculty mentorship only to deny it ("No faculty mentor is required",
// "A faculty mentor is not provided") says the opposite, so the clause around each match is
// read for a negation (#4246).
const assertsFacultyMentorship = (fields: string[]): boolean =>
  fields
    .flatMap((field) => field.split(SENTENCE_BOUNDARY))
    .some((sentence) =>
      [...sentence.matchAll(FACULTY_MENTORSHIP_PROSE)].some(
        (match) =>
          !NEGATION_JUST_BEFORE.test(sentence.slice(0, match.index)) &&
          !NEGATED_PREDICATE_AFTER.test(sentence.slice(match.index + match[0].length)),
      ),
    );

const isMentoredResearchPathway = (programKind: string, fields: string[]): boolean =>
  programKind === 'STRUCTURED_PROGRAM' && assertsFacultyMentorship(fields);

// A multi-purpose fund is served when its own page text names research as an eligible use,
// never on its purpose tags alone (owner decision, 2026-10-04, #4675). The phrasings are kept
// narrower than FUNDS_RESEARCH_PROSE because "language study that can support research" names
// research as an outcome rather than a use (#4291).
const RESEARCH_AS_ELIGIBLE_USE =
  /\b(?:(?<!non-)research\s+(?:expenses|costs|travel|trips?)\b|(?:use[sd]?|using|spen[dt]|funds?|funding|grants?|awards?|support)(?:\s+[\w-]+){0,2}\s+for\s+(?:(?:[\w-]+,?\s+){1,4}(?:and|or|and\/or)\s+)?research\b(?!\s+(?:opportunit|experience|interests?|careers?|staff|assistant|positions?))|(?<!\b(?:experience|prior)\s+(?:in\s+)?)(?:conduct|conducting|undertake|undertaking)\s+(?:[\w-]+\s+){0,2}research\b)/i;

const DISCLAIMS_RESEARCH = /\bnon-research\b/i;

const LANGUAGE_STUDY_PURPOSE = 'Language Study';

// These lanes store `purpose` as inferPurpose output read from page prose rather than as a
// catalog facet, so changing that inference also requires revisiting this set.
const PURPOSE_INFERRED_FROM_PROSE_SOURCES = new Set(['yale-college-fellowships-office']);

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
  const bodyFields = [text(input.summary), text(input.description), text(input.eligibility)].filter(
    Boolean,
  );
  const sourceFields = [title, ...bodyFields].filter(Boolean);
  const sourceProse = sourceFields.join(' ');
  const mentoredPathway = isMentoredResearchPathway(programKind, sourceFields);

  const facetResearch = purposes.some((p) => RESEARCH_PURPOSES.has(p));
  const facetSaysLanguageStudy = purposes.includes(LANGUAGE_STUDY_PURPOSE) && !facetResearch;
  const titleSaysNonResearch = NON_RESEARCH_TITLE.test(title);
  const purposeUnbackedByProse =
    facetResearch &&
    PURPOSE_INFERRED_FROM_PROSE_SOURCES.has(text(input.sourceName)) &&
    bodyFields.length > 0 &&
    !RESEARCH_TEXT.test(sourceProse);
  const purposeResearch = facetResearch && !purposeUnbackedByProse;
  const kindResearch = RESEARCH_PROGRAM_KINDS.has(programKind);
  const inherentKind = INHERENTLY_RESEARCH_PROGRAM_KINDS.has(programKind);
  const textResearch = RESEARCH_TEXT.test(blob);
  const researchUseStated =
    !DISCLAIMS_RESEARCH.test(sourceProse) && affirmedIn(bodyFields, RESEARCH_AS_ELIGIBLE_USE);

  if (purposeResearch) reasons.push('research_purpose');
  if (kindResearch) reasons.push('research_program_kind');
  if (textResearch) reasons.push('research_text');
  if (mentoredPathway) reasons.push('mentored_research_pathway');
  if (titleSaysNonResearch) reasons.push('non_research_title');
  if (facetSaysLanguageStudy) reasons.push('language_study_purpose');
  if (purposeUnbackedByProse) reasons.push('inferred_research_purpose_unbacked');
  if (researchUseStated) reasons.push('research_use_stated');

  // A title that explicitly disclaims research (e.g. "...Non-Research Projects", journalism,
  // language study, study/tuition scholarship), or a facet naming only language study, is not
  // research-related even if a generic "Research" purpose tag is attached, unless the program
  // kind is research by construction or its own page text names research as an eligible use.
  // A kind derived from travel wording does not exempt it.
  if ((titleSaysNonResearch || facetSaysLanguageStudy) && !inherentKind && !researchUseStated) {
    return { researchRelated: false, reasons };
  }

  // The purpose facet is the source catalog's own statement of what an award funds, so a
  // record that carries one is research-related only when the facet says so, its own title
  // names research, or its kind is research by construction. Incidental prose ("research
  // opportunities", "language immersion or research") otherwise admitted study, language,
  // internship and postgraduate awards to a research surface (#3904).
  if (purposes.length > 0 && !purposeResearch && !mentoredPathway) {
    const titleResearch = RESEARCH_TEXT.test(title);
    const researchCareer = affirmedIn(sourceFields, RESEARCH_CAREER_AWARD);
    const fundsResearch = affirmedIn(sourceFields, FUNDS_RESEARCH_PROSE);
    if (
      !titleResearch &&
      !inherentKind &&
      !researchCareer &&
      !fundsResearch &&
      !researchUseStated
    ) {
      reasons.push('purpose_not_research');
      return { researchRelated: false, reasons };
    }
  }

  const researchRelated = purposeResearch || kindResearch || textResearch || mentoredPathway;
  if (!researchRelated) reasons.push('no_research_signal');
  return { researchRelated, reasons };
}
