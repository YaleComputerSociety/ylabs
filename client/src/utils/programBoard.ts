import { Fellowship } from '../types/types';
import { type FellowshipCycleCategory } from './fellowshipCycle';
import { isDepartmentResearchGuidance, programRoleOf } from './programJourney';

export type ProgramBoardSection =
  'closingSoon' | 'open' | 'openingSoon' | 'nextCycle' | 'guidance' | 'noDates' | 'archive';

export const PROGRAM_BOARD_SECTIONS: ProgramBoardSection[] = [
  'closingSoon',
  'open',
  'openingSoon',
  'nextCycle',
  'guidance',
  'noDates',
  'archive',
];

export type ProgramBoardSummary = Record<ProgramBoardSection, number>;

export const emptyProgramBoardSummary = (): ProgramBoardSummary => ({
  closingSoon: 0,
  open: 0,
  openingSoon: 0,
  nextCycle: 0,
  guidance: 0,
  noDates: 0,
  archive: 0,
});

const SECTION_FOR_CYCLE: Record<FellowshipCycleCategory, ProgramBoardSection> = {
  closingSoon: 'closingSoon',
  open: 'open',
  openingSoon: 'openingSoon',
  projectedNextCycle: 'nextCycle',
  nextCycle: 'nextCycle',
  staleDeadline: 'noDates',
  closed: 'noDates',
};

export function isArchivedProgramRecord(fellowship: Fellowship): boolean {
  return (
    fellowship.studentFacingCategory === 'Archive / review' ||
    programRoleOf(fellowship) === 'UNCLASSIFIED'
  );
}

export function programBoardSectionOf(
  fellowship: Fellowship,
  cycle: FellowshipCycleCategory,
): ProgramBoardSection {
  if (isDepartmentResearchGuidance(fellowship)) return 'guidance';
  if (isArchivedProgramRecord(fellowship)) return 'archive';
  return SECTION_FOR_CYCLE[cycle];
}

export const FIRST_YEAR_STUDENT = 'First-Year Student';

export function isOpenToFirstYears(fellowship: Fellowship): boolean {
  return (fellowship.yearOfStudy || []).includes(FIRST_YEAR_STUDENT);
}

export function needsMentorBeforeApplying(fellowship: Fellowship): boolean {
  return fellowship.requiresMentorBeforeApply === true;
}

export function mentorRequirementLabel(fellowship: Fellowship): string | null {
  if (needsMentorBeforeApplying(fellowship)) return 'Line up a mentor before you apply';
  if (fellowship.mentorMatching) return 'Matches you with a mentor';
  return null;
}

export const US_CITIZENS_ELIGIBLE = 'U.S. citizens are eligible';
export const NON_US_CITIZENS_ELIGIBLE = 'Non-U.S. citizens are eligible';
export const US_PERMANENT_RESIDENTS_ELIGIBLE = 'U.S. permanent residents are eligible';

export const CITIZENSHIP_NOT_STATED_LABEL = 'Not stated. Check the official page.';

export function programCitizenshipRestriction(
  fellowship: Pick<Fellowship, 'citizenshipStatus'>,
): string | null {
  const statuses = new Set(fellowship.citizenshipStatus || []);
  const us = statuses.has(US_CITIZENS_ELIGIBLE);
  const nonUs = statuses.has(NON_US_CITIZENS_ELIGIBLE);
  if (us && !nonUs) {
    return statuses.has(US_PERMANENT_RESIDENTS_ELIGIBLE)
      ? 'U.S. citizens and permanent residents only'
      : 'U.S. citizens only';
  }
  if (nonUs && !us) return 'Non-U.S. citizens only';
  return null;
}

export function programCitizenshipSummary(
  fellowship: Pick<Fellowship, 'citizenshipStatus'>,
): string {
  const restriction = programCitizenshipRestriction(fellowship);
  if (restriction) return restriction;
  const statuses = fellowship.citizenshipStatus || [];
  if (statuses.includes(US_CITIZENS_ELIGIBLE) && statuses.includes(NON_US_CITIZENS_ELIGIBLE)) {
    return 'Open to U.S. and non-U.S. citizens';
  }
  return statuses.length > 0 ? statuses.join(', ') : CITIZENSHIP_NOT_STATED_LABEL;
}

const CARD_AWARD_MAX_LENGTH = 24;

export function cardAwardLabel(awardAmount: string | null | undefined): string | null {
  const amount = (awardAmount || '').trim();
  if (!amount || amount.length > CARD_AWARD_MAX_LENGTH) return null;
  return /^\d[\d,.\s\u2013-]*$/.test(amount) ? `$${amount}` : amount;
}

export function programCardFacts(fellowship: Fellowship): string[] {
  const award = cardAwardLabel(fellowship.awardAmount);
  return [
    award ? `Award: ${award}` : null,
    mentorRequirementLabel(fellowship),
    programCitizenshipRestriction(fellowship),
  ].filter((fact): fact is string => Boolean(fact));
}
