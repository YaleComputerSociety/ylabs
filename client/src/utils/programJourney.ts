import { Fellowship } from '../types/types';
import { getFellowshipCycleStatus } from './fellowshipCycle';

export type ProgramJourneyCategory =
  | 'applyNow'
  | 'openingSoon'
  | 'structured'
  | 'fundingAfterMentor'
  | 'nextCycle'
  | 'archive';

export interface ProgramJourneyStatus {
  category: ProgramJourneyCategory;
  label: string;
  description: string;
}

export const PROGRAM_JOURNEY_CATEGORIES: ProgramJourneyCategory[] = [
  'applyNow',
  'openingSoon',
  'structured',
  'fundingAfterMentor',
  'nextCycle',
  'archive',
];

export type ProgramJourneySummary = Record<ProgramJourneyCategory, number>;

export const emptyProgramJourneySummary: ProgramJourneySummary = {
  applyNow: 0,
  openingSoon: 0,
  structured: 0,
  fundingAfterMentor: 0,
  nextCycle: 0,
  archive: 0,
};

const STRUCTURED_KINDS = new Set([
  'STRUCTURED_PROGRAM',
  'CENTER_INTERNSHIP',
  'RA_PROGRAM',
  'MENTOR_MATCHING',
]);

const FUNDING_KINDS = new Set([
  'FELLOWSHIP_FUNDING',
  'TRAVEL_RESEARCH_GRANT',
  'SENIOR_THESIS_FUNDING',
]);

export function getProgramJourneyStatus(
  fellowship: Fellowship,
  now: Date = new Date(),
): ProgramJourneyStatus {
  const cycle = getFellowshipCycleStatus(fellowship, now);

  if (cycle.category === 'open' || cycle.category === 'closingSoon') {
    return {
      category: 'applyNow',
      label: 'Apply now',
      description: 'Current application windows and deadlines.',
    };
  }

  if (cycle.category === 'openingSoon') {
    return {
      category: 'openingSoon',
      label: 'Opening Soon',
      description: 'Upcoming application windows with announced opening dates.',
    };
  }

  if (fellowship.studentFacingCategory === 'Archive / review') {
    return {
      category: 'archive',
      label: 'Archive / Review',
      description: 'Records that need eligibility review.',
    };
  }

  if (STRUCTURED_KINDS.has(fellowship.programKind)) {
    return {
      category: 'structured',
      label: 'Structured Research Programs',
      description: 'Programs, internships, RA routes, or mentor-matching experiences.',
    };
  }

  if (FUNDING_KINDS.has(fellowship.programKind) || fellowship.requiresMentorBeforeApply) {
    return {
      category: 'fundingAfterMentor',
      label: 'Funding After You Have a Mentor',
      description: 'Funding records that usually require a research plan, adviser, or lab fit first.',
    };
  }

  if (cycle.category === 'nextCycle') {
    return {
      category: 'nextCycle',
      label: 'Plan Next Cycle',
      description: 'Official past cycles that look recurring.',
    };
  }

  return {
    category: 'archive',
    label: 'Archive / Review',
    description: 'Retained records that should not be treated as active opportunities.',
  };
}

export function summarizeProgramJourney(
  fellowships: Fellowship[],
  now: Date = new Date(),
): ProgramJourneySummary {
  const summary: ProgramJourneySummary = { ...emptyProgramJourneySummary };
  for (const fellowship of fellowships) {
    summary[getProgramJourneyStatus(fellowship, now).category] += 1;
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
    UNKNOWN: 'Review source',
  };
  return labels[mode] || mode.replace(/_/g, ' ').toLowerCase();
}
