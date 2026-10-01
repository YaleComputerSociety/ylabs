import { Fellowship } from '../types/types';
import { isLikelyUnavailableSourceLink } from './researchDetailSources';
import { safeHttpUrl } from './url';

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
]);

export function programRoleOf(fellowship: Fellowship): string {
  if (fellowship.programRole) return fellowship.programRole;
  if (STARTS_RESEARCH_KINDS.has(fellowship.programKind)) return 'STARTS_RESEARCH';
  if (FUNDS_RESEARCH_KINDS.has(fellowship.programKind)) return 'FUNDS_RESEARCH';
  if (fellowship.programKind === 'RESEARCH_AWARD') return 'RECOGNIZES_RESEARCH';
  return 'UNCLASSIFIED';
}

// The server serves the gate's own predicate (server/src/services/departmentResearchGuidance.ts)
// rather than the kind alone, because a locked or stale kind can sit on a row admitted as an
// application; every caller drops its application affordances on this answer.
export function isDepartmentResearchGuidance(
  fellowship: Pick<Fellowship, 'departmentResearchGuidance'>,
): boolean {
  return fellowship.departmentResearchGuidance === true;
}

export const DEPARTMENT_RESEARCH_GUIDANCE_LABEL = 'Department research guidance';

export const DEPARTMENT_RESEARCH_GUIDANCE_ACTION = "Read the department's guidance";

export const DEPARTMENT_RESEARCH_GUIDANCE_STATUS = 'Not an application';

export const DEPARTMENT_RESEARCH_GUIDANCE_BADGE = 'Department guidance';

export const DEPARTMENT_RESEARCH_GUIDANCE_BADGE_CLASS =
  'border border-line-brand bg-brand-soft text-brand';

export function departmentResearchGuidanceHref(
  fellowship: Pick<Fellowship, 'sourceUrl' | 'sourceLinkHealth'>,
): string | undefined {
  if (isLikelyUnavailableSourceLink(fellowship.sourceLinkHealth)) return undefined;
  return safeHttpUrl(fellowship.sourceUrl) || undefined;
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
    DEPARTMENT_RESEARCH_GUIDE: DEPARTMENT_RESEARCH_GUIDANCE_LABEL,
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
