/**
 * Shared types and helpers for browsable research homes, listings, and fellowships.
 */
import { Listing, Fellowship } from './types';
import { ResearchGroup, ResearchGroupKind } from './researchGroup';
import {
  DepartmentNameRecord,
  getDepartmentAbbreviation,
  getUniqueDepartmentLabels,
} from '../utils/departmentNames';
import {
  computeAcceptanceVerdict,
  verdictBadgeStyles,
  verdictLabel,
} from '../utils/undergradAcceptance';
import {
  getFellowshipCycleStatus,
  getFellowshipDeadlineSubtitle,
} from '../utils/fellowshipCycle';

export const DEPT_CAP = 3;
export const TAG_CAP = 3;
export const DESCRIPTION_CLAMP_CLASS = 'line-clamp-3';

export function getOrderedDepartments(
  departments: string[] | undefined,
  primary: string | undefined,
  departmentTable?: DepartmentNameRecord[],
): string[] {
  const deps = [...(departments || [])];
  if (deps.length === 0) {
    return primary ? [primary] : [];
  }
  if (primary && deps.length > 1) {
    const idx = deps.findIndex(
      (d) => d === primary || getDepartmentAbbreviation(d) === getDepartmentAbbreviation(primary),
    );
    if (idx > 0) {
      deps.splice(idx, 1);
      deps.unshift(primary);
    } else if (idx === -1) {
      deps.unshift(primary);
    }
  }
  return getUniqueDepartmentLabels(deps, departmentTable);
}

export function getOrderedDeptAbbrs(
  departments: string[] | undefined,
  primary: string | undefined,
  limit?: number,
  departmentTable?: DepartmentNameRecord[],
): { abbrs: string[]; truncated: number } {
  const ordered = getOrderedDepartments(departments, primary, departmentTable);
  const abbrs = ordered.map((d) => getDepartmentAbbreviation(d));
  if (limit && abbrs.length > limit) {
    return { abbrs: abbrs.slice(0, limit), truncated: abbrs.length - limit };
  }
  return { abbrs, truncated: 0 };
}

export type BrowsableItem =
  | { type: 'listing'; data: Listing }
  | { type: 'fellowship'; data: Fellowship }
  | { type: 'researchGroup'; data: ResearchGroup };

export function getItemId(item: BrowsableItem): string {
  if (item.type === 'researchGroup') {
    return item.data.id || item.data._id || item.data.slug;
  }
  return item.data.id;
}

export function getResearchGroupKindLabel(kind: ResearchGroupKind): string {
  const labels: Record<ResearchGroupKind, string> = {
    lab: 'Lab',
    center: 'Center',
    institute: 'Institute',
    program: 'Program',
    initiative: 'Initiative',
    group: 'Group',
    individual: 'Faculty Research',
    solo: 'Faculty Research',
  };
  return labels[kind] || 'Research';
}

export function getResearchGroupDisplayName(group: ResearchGroup): string {
  if (group.kind !== 'individual' && group.kind !== 'solo') {
    return group.name;
  }
  return group.displayName || group.name.replace(/\s+—\s+Research$/i, '').replace(/\s+Research$/i, '');
}

const PATHWAY_TYPE_LABELS: Record<string, string> = {
  POSTED_ROLE: 'Posted opening',
  STUDENT_JOB: 'Student job',
  RECURRING_PROGRAM: 'Recurring program',
  COURSE_CREDIT: 'Course credit',
  SENIOR_THESIS: 'Senior thesis',
  FELLOWSHIP_FUNDED_PROJECT: 'Fellowship funded',
  WORK_STUDY: 'Work-study',
  VOLUNTEER_OUTREACH: 'Volunteer outreach',
  CENTER_INTERNSHIP: 'Center internship',
  FACULTY_SUPERVISION: 'Faculty supervision',
  EXPLORATORY_CONTACT: 'Exploratory contact',
};

const FORMALIZATION_ONLY_PATHWAY_TYPES = new Set([
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
]);

export function getResearchEntityPathwaySummary(group: ResearchGroup): string | null {
  const summary = group.accessSummary;
  if (!summary) return null;
  if (summary.hasActivePostedOpportunity) return 'Posted opening available';

  const labels = Array.from(new Set(summary.entryPathwayTypes || []))
    .filter((type) => !FORMALIZATION_ONLY_PATHWAY_TYPES.has(type))
    .map((type) => PATHWAY_TYPE_LABELS[type] || type.replace(/_/g, ' ').toLowerCase())
    .slice(0, 2);

  if (labels.length === 0) return null;
  return labels.join(' + ');
}

export function getResearchEntityBestNextStep(group: ResearchGroup): string | null {
  const bestNextStep = group.accessSummary?.bestNextStep?.trim();
  if (!bestNextStep || bestNextStep === 'Check back later') return null;
  return bestNextStep;
}

export function isItemOpen(item: BrowsableItem): boolean {
  if (item.type === 'listing') {
    return item.data.hiringStatus >= 0;
  }
  if (item.type === 'researchGroup') {
    const { verdict } = computeAcceptanceVerdict(
      item.data,
      item.data.accessSummary?.hasActivePostedOpportunity === true,
    );
    return verdict === 'verified-accepting' || verdict === 'likely-accepting';
  }
  const { isAcceptingApplications, deadline } = item.data;
  const deadlinePassed = deadline ? new Date(deadline) < new Date() : false;
  return isAcceptingApplications && !deadlinePassed;
}

interface TagInfo {
  label: string;
  bg: string;
  text: string;
}

export function getItemTags(
  item: BrowsableItem,
  getColor: (area: string) => { bg: string; text: string },
): TagInfo[] {
  if (item.type === 'listing') {
    const areas =
      item.data.researchAreas?.length > 0 ? item.data.researchAreas : item.data.keywords || [];
    return areas.map((a) => ({ label: a, ...getColor(a) }));
  }
  if (item.type === 'researchGroup') {
    const areas = item.data.researchAreas || [];
    return areas.map((a) => ({ label: a, ...getColor(a) }));
  }
  return [
    ...item.data.yearOfStudy.map((y) => ({
      label: y,
      bg: 'bg-blue-50',
      text: 'text-blue-700',
    })),
    ...item.data.purpose.map((p) => ({
      label: p,
      bg: 'bg-purple-50',
      text: 'text-purple-700',
    })),
  ];
}

export function getItemSubtitle(item: BrowsableItem): string {
  if (item.type === 'listing') {
    const { ownerFirstName, ownerLastName, departments } = item.data;
    const name = `${ownerFirstName} ${ownerLastName}`;
    const dept =
      departments && departments.length > 0 ? getDepartmentAbbreviation(departments[0]) : null;
    return dept ? `${name} · ${dept}` : name;
  }
  if (item.type === 'researchGroup') {
    const kind = getResearchGroupKindLabel(item.data.kind);
    const dept =
      item.data.departments && item.data.departments.length > 0
        ? getDepartmentAbbreviation(item.data.departments[0])
        : null;
    return dept ? `${kind} · ${dept}` : kind;
  }
  return getFellowshipDeadlineSubtitle(item.data);
}

export function getItemSubtitleColor(item: BrowsableItem): string {
  if (item.type === 'listing') return 'text-gray-500';
  if (item.type === 'researchGroup') return 'text-gray-500';
  const status = getFellowshipCycleStatus(item.data);
  if (status.category === 'nextCycle') return 'text-sky-700 font-medium';
  const { deadline } = item.data;
  if (!deadline) return 'text-gray-500';
  const d = new Date(deadline);
  if (d < new Date()) return 'text-red-500';
  const daysUntil = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysUntil <= 14) return 'text-amber-600 font-medium';
  return 'text-gray-500';
}

export function getDaysUntilDeadline(item: BrowsableItem): number | null {
  if (item.type !== 'fellowship' || !item.data.deadline) return null;
  const d = new Date(item.data.deadline);
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function getResearchGroupStatus(item: BrowsableItem): {
  label: string;
  className: string;
} | null {
  if (item.type !== 'researchGroup') return null;
  const { verdict } = computeAcceptanceVerdict(
    item.data,
    item.data.accessSummary?.hasActivePostedOpportunity === true,
  );
  return {
    label: verdictLabel(verdict),
    className: verdictBadgeStyles(verdict),
  };
}
