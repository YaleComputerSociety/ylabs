import { Fellowship } from '../types/types';
import { type FellowshipCycleCategory } from './fellowshipCycle';
import { isDepartmentResearchGuidance, programRoleOf } from './programJourney';

export type ProgramBoardSection =
  | 'closingSoon'
  | 'open'
  | 'openingSoon'
  | 'nextCycle'
  | 'guidance'
  | 'noDates'
  | 'archive';

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

const CARD_AWARD_MAX_LENGTH = 24;

export function cardAwardLabel(awardAmount: string | null | undefined): string | null {
  const amount = (awardAmount || '').trim();
  if (!amount || amount.length > CARD_AWARD_MAX_LENGTH) return null;
  return /^\d[\d,.\s\u2013-]*$/.test(amount) ? `$${amount}` : amount;
}

export function programCardFacts(fellowship: Fellowship): string[] {
  const award = cardAwardLabel(fellowship.awardAmount);
  return [award ? `Award: ${award}` : null, mentorRequirementLabel(fellowship)].filter(
    (fact): fact is string => Boolean(fact),
  );
}
