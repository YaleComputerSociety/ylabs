import type { ResearchEntityType } from '../models/researchAccessTypes';
import { creativePracticeEvidence } from './creativePracticeDescription';

export type NonResearchBodyShape = 'role-biography' | 'third-party-page' | 'instruction-offering';

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const sentencesOf = (text: string): string[] =>
  text.split(/(?<=[.!?])\s+(?=["“A-Z])/).filter(Boolean);

// Lower case on purpose, so a department name ("Africana Studies") or an office ("Graduate
// Studies") is not read as a statement that the person studies something.
const STATES_RESEARCH_OR_CARE =
  /\b(?:research\w*|stud(?:y|ies|ied|ying)|investigat\w*|examin\w*|explor\w*|analy[sz]\w*|scholar\w*|inquiry|publish\w*|publications?|papers?|articles?|books?|authored|grants?|funded|laborator\w*|experiment\w*|interventions?|trials?|evaluat\w*|novel|clinical|clinician|patients?|physician|surgeon|nurs\w*|treat(?:s|ing|ment)|specializ\w*|science|scientist|interests?|interested in|focus(?:es|ed)? on|works? on)\b/;

const RESEARCH_VOICE_OPENING =
  /^(?:studies|examines|investigates|analy[sz]es|develops|development of)\b/i;

const lowerFirstLetter = (sentence: string): string =>
  sentence.replace(
    /^(["“]?)([A-Z])/,
    (_match, quote: string, letter: string) => quote + letter.toLowerCase(),
  );

const anySentenceStates = (text: string, statement: RegExp): boolean =>
  sentencesOf(text).some(
    (sentence) =>
      RESEARCH_VOICE_OPENING.test(sentence) || statement.test(lowerFirstLetter(sentence)),
  );

const FACULTY_RANK = /\b(?:professor|associate professor|assistant professor)\b/i;

const ADMINISTRATIVE_ROLE =
  /\b(?:(?:executive|managing|associate|assistant|deputy|program|operations|communications|marketing|development|admissions|finance|financial|administrative|inaugural)\s+director|director of (?:diversity|equity|inclusion|dei|communications|operations|admissions|development|marketing|finance|human resources|student|programs?|administration|events|alumni|outreach|engagement|external)|dean of (?:students|admissions)|associate dean|assistant dean|chief (?:executive|operating|financial|diversity)|manager|coordinator|administrator|strategist|consultant|career (?:and executive )?coach|executive coach|responsible for|oversees|leads the (?:office|team)|human resources|diversity, equity)\b/gi;

const TEACHING_ROLE =
  /\b(?:teach(?:es|ing|er)?|taught|instructor|lector|lecturer|curricul\w*|courses?|classes|classroom|pedagog\w*)\b/gi;

const MIN_ADMINISTRATIVE_ROLE_MENTIONS = 2;
const MIN_TEACHING_ROLE_MENTIONS = 3;

/**
 * A biography of a teaching or administrative appointment that states no research, no
 * creative practice and no clinical work: a career office director, a language lector, a
 * diversity office lead. A faculty rank, any research or care word, or a single kind of
 * practice evidence keeps the body, because the cost of refusing a real research biography
 * is the row.
 */
export function isRoleBiographyWithoutResearchOrPractice(value: unknown): boolean {
  const text = textValue(value);
  if (!text || anySentenceStates(text, STATES_RESEARCH_OR_CARE)) return false;
  if (FACULTY_RANK.test(text) || creativePracticeEvidence(text).length > 0) return false;
  return (
    (text.match(ADMINISTRATIVE_ROLE) ?? []).length >= MIN_ADMINISTRATIVE_ROLE_MENTIONS ||
    (text.match(TEACHING_ROLE) ?? []).length >= MIN_TEACHING_ROLE_MENTIONS
  );
}

const SUBMISSION_TERMS =
  /\b(?:by submitting|interested in (?:collaborating|applying|submitting)|will receive an overview|retains? (?:all )?(?:ownership|copyright)|usage (?:&|and) rights|non-exclusive (?:right|license)|submission deadline|submit (?:your|an?) (?:application|portfolio|proposal))\b/gi;

const MIN_SUBMISSION_TERMS = 2;

const EVENT_PAGE_LEAD =
  /^the\s[^.]{0,80}\b(?:biennale|biennial|festival|conference|exhibition|symposium|summit|fair)\b[^.]{0,60}\bwas\s(?:open|held)\b/i;

const SECTION_BLURB_LEAD =
  /^(?:highlights|lists?|documentation|information|resources|links|news|overview|details|descriptions?|summaries|examples|types|guidance|tools?|answers|announcements|updates|research goals|funding opportunities)\s+(?:of|on|for|from|about|and|to)\b/i;

const MIN_SECTION_BLURBS = 3;

/**
 * Another organization's page text: a call for submissions with its usage terms, an
 * event's own page, or a site's section blurbs ("Highlights of ...", "Lists of ...").
 * None of the three describes the row's own work, whatever subject the row carries.
 */
export function isThirdPartyPageText(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  if ((text.match(SUBMISSION_TERMS) ?? []).length >= MIN_SUBMISSION_TERMS) return true;
  if (EVENT_PAGE_LEAD.test(text)) return true;
  return (
    sentencesOf(text).filter((sentence) => SECTION_BLURB_LEAD.test(sentence)).length >=
    MIN_SECTION_BLURBS
  );
}

const INSTRUCTION_OFFERING =
  /\b(?:provides? (?:opportunities|hands-on|training|instruction|lessons|classes)|hands-on (?:lessons|classes|training)|(?:classes|lessons|courses|workshops) (?:focus|are|cover|teach|include)|taught (?:at|in|by)\b[^.]{0,80}\b(?:kitchen|studio|classroom))\b/gi;

const MIN_INSTRUCTION_OFFERING_MENTIONS = 2;

const STATES_RESEARCH =
  /\b(?:research\w*|investigat\w*|experiment\w*|laborator\w*|scientists?|publish\w*|publications?)\b/;

/**
 * An education program's description: the body's subject is the instruction it offers
 * ("classes focus on", "hands-on lessons"), so a row carrying it as a lab names a course,
 * not a group a student could join. Only a lab is refused for it, because a core facility's
 * or a center's training and workshops are its own service. A research statement keeps the
 * body, so a research core that also trains its users is not read as a course.
 */
export function isInstructionOfferingText(value: unknown): boolean {
  const text = textValue(value);
  if (!text || anySentenceStates(text, STATES_RESEARCH)) return false;
  return (text.match(INSTRUCTION_OFFERING) ?? []).length >= MIN_INSTRUCTION_OFFERING_MENTIONS;
}

const isLabEntityType = (entityType?: ResearchEntityType): boolean =>
  typeof entityType === 'string' && entityType.toUpperCase() === 'LAB';

export function nonResearchBodyShape(
  value: unknown,
  entityType?: ResearchEntityType,
): NonResearchBodyShape | null {
  if (isThirdPartyPageText(value)) return 'third-party-page';
  if (isLabEntityType(entityType) && isInstructionOfferingText(value)) {
    return 'instruction-offering';
  }
  if (isRoleBiographyWithoutResearchOrPractice(value)) return 'role-biography';
  return null;
}
