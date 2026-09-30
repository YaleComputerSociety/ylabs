import { Fellowship } from '../types/types';
import { getFellowshipCycleStatus, type FellowshipCycleCategory } from './fellowshipCycle';

export type ProgramJourneyCategory =
  | 'startsResearch'
  | 'fundsResearch'
  | 'recognizesResearch'
  | 'archive';

export interface ProgramJourneyStatus {
  category: ProgramJourneyCategory;
  label: string;
  description: string;
}

export const PROGRAM_JOURNEY_CATEGORIES: ProgramJourneyCategory[] = [
  'startsResearch',
  'fundsResearch',
  'recognizesResearch',
  'archive',
];

export type ProgramJourneySummary = Record<ProgramJourneyCategory, number>;

export const emptyProgramJourneySummary: ProgramJourneySummary = {
  startsResearch: 0,
  fundsResearch: 0,
  recognizesResearch: 0,
  archive: 0,
};

// Mirrors `programRoleForKind` in server/src/services/programClassifier.ts, for a record
// served before its derived `programRole` was written. Changing one requires the other.
const STARTS_RESEARCH_KINDS = new Set([
  'STRUCTURED_PROGRAM',
  'CENTER_INTERNSHIP',
  'RA_PROGRAM',
  'MENTOR_MATCHING',
  'DEPARTMENT_RESEARCH_GUIDE',
]);

const FUNDS_RESEARCH_KINDS = new Set([
  'FELLOWSHIP_FUNDING',
  'TRAVEL_RESEARCH_GRANT',
  'SENIOR_THESIS_FUNDING',
  'RESEARCH_AWARD',
]);

export function programRoleOf(fellowship: Fellowship): string {
  if (fellowship.programRole) return fellowship.programRole;
  if (STARTS_RESEARCH_KINDS.has(fellowship.programKind)) return 'STARTS_RESEARCH';
  if (FUNDS_RESEARCH_KINDS.has(fellowship.programKind)) return 'FUNDS_RESEARCH';
  if (fellowship.programKind === 'RESEARCH_AWARD') return 'RECOGNIZES_RESEARCH';
  return 'UNCLASSIFIED';
}

export function getProgramJourneyStatus(fellowship: Fellowship): ProgramJourneyStatus {
  const role = programRoleOf(fellowship);
  if (fellowship.studentFacingCategory === 'Archive / review' || role === 'UNCLASSIFIED') {
    return {
      category: 'archive',
      label: 'Archive / Review',
      description: 'Retained records that should not be treated as active opportunities.',
    };
  }
  if (role === 'STARTS_RESEARCH') {
    return {
      category: 'startsResearch',
      label: 'Get Started in Research',
      description: 'Programs, internships, RA roles, mentor matching, and department guides.',
    };
  }
  if (role === 'RECOGNIZES_RESEARCH') {
    return {
      category: 'recognizesResearch',
      label: "Awards for Research You've Done",
      description: 'Competitive awards for students who already have a research record.',
    };
  }
  return {
    category: 'fundsResearch',
    label: "Funding for Research You've Arranged",
    description: 'Grants and fellowships that usually need a mentor, a project, or a plan first.',
  };
}

const CYCLE_ORDER: Record<FellowshipCycleCategory, number> = {
  closingSoon: 0,
  open: 1,
  openingSoon: 2,
  projectedNextCycle: 3,
  nextCycle: 4,
  closed: 5,
};

// Within a section, programs a student can act on now come first, then the ones that open
// soon, then recurring past cycles, each by deadline.
export function cycleActionOrder(category: FellowshipCycleCategory): number {
  return CYCLE_ORDER[category];
}

export function programActionOrder(fellowship: Fellowship, now: Date = new Date()): number {
  return cycleActionOrder(getFellowshipCycleStatus(fellowship, now).category);
}

export function summarizeProgramJourney(fellowships: Fellowship[]): ProgramJourneySummary {
  const summary: ProgramJourneySummary = { ...emptyProgramJourneySummary };
  for (const fellowship of fellowships) {
    summary[getProgramJourneyStatus(fellowship).category] += 1;
  }
  return summary;
}

export function programKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    STRUCTURED_PROGRAM: 'Structured program',
    CENTER_INTERNSHIP: 'Center internship',
    RA_PROGRAM: 'RA program',
    MENTOR_MATCHING: 'Mentor matching',
    FELLOWSHIP_FUNDING: 'Fellowship funding',
    TRAVEL_RESEARCH_GRANT: 'Research travel grant',
    SENIOR_THESIS_FUNDING: 'Senior research funding',
    DEPARTMENT_RESEARCH_GUIDE: 'Department research guide',
    RESEARCH_AWARD: 'Research award',
    OTHER: 'Program record',
  };
  return labels[kind] || kind.replace(/_/g, ' ').toLowerCase();
}

export function entryModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    APPLY_TO_PROGRAM: 'Apply to program',
    APPLY_TO_PROJECT: 'Apply to project',
    SECURE_MENTOR_THEN_APPLY: 'Find mentor first',
    DIRECT_FACULTY_MATCHING: 'Faculty matching',
    TRACK_NEXT_CYCLE: 'Track next cycle',
    CONTACT_FACULTY: 'Contact faculty',
    UNKNOWN: 'Review source',
  };
  return labels[mode] || mode.replace(/_/g, ' ').toLowerCase();
}

export function programCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    CENTER_INTERNSHIP: 'Center internship',
    FELLOWSHIP: 'Fellowship',
    RECURRING_PROGRAM: 'Recurring program',
    SUMMER_RESEARCH_PROGRAM: 'Summer research program',
  };
  return labels[category] || category.replace(/_/g, ' ').toLowerCase();
}
