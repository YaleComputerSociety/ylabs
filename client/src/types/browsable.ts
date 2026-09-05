/**
 * Shared types and helpers for browsable research homes and fellowships.
 */
import { Fellowship } from './types';
import {
  DepartmentNameRecord,
  getDepartmentAbbreviation,
  getUniqueDepartmentLabels,
} from '../utils/departmentNames';
import { getFellowshipCycleStatus, getFellowshipDeadlineSubtitle } from '../utils/fellowshipCycle';
import { getFellowshipApplicationStatus } from '../utils/fellowshipStatus';
import { entryModeLabel, programKindLabel } from '../utils/programJourney';

export const DEPT_CAP = 3;
export const TAG_CAP = 3;
export const FELLOWSHIP_TAG_CAP = 2;
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

/**
 * Browse rows are fellowships only. A `researchGroup` variant existed here with
 * its own kind-label map, subtitle, tag, and display-name resolvers, but no
 * product surface ever constructed one: `BrowseGrid` is reached only from
 * `fellowships.tsx` and `ProgramWatch` passes `fellowshipToBrowsable`. Those
 * resolvers were a fourth entity-kind label map (missing `core_facility`) and a
 * display-name resolver with no graft guard, so they were removed rather than
 * converged - unreachable code is the code that gets copied when a surface is
 * revived (#2397). Research browse rows go through `researchDiscoveryAdapters`
 * and `researchEntityCopy`.
 */
export type BrowsableItem = { type: 'fellowship'; data: Fellowship };

export function getItemId(item: BrowsableItem): string {
  return item.data.id;
}

export function isItemOpen(item: BrowsableItem): boolean {
  return getFellowshipApplicationStatus(item.data).isApplicationWindowOpen;
}

interface TagInfo {
  label: string;
  bg: string;
  text: string;
}

const normalizeTagLabel = (label: string) => label.trim().toLowerCase();

function dedupeTags(tags: TagInfo[]): TagInfo[] {
  const kept: TagInfo[] = [];
  for (const tag of tags) {
    const norm = normalizeTagLabel(tag.label);
    if (!norm) continue;
    if (kept.some((k) => normalizeTagLabel(k.label) === norm)) continue;
    kept.push(tag);
  }
  return kept;
}

export function getItemTags(item: BrowsableItem): TagInfo[] {
  const categoryLabel = item.data.studentFacingCategory;
  const categoryNorm = categoryLabel ? normalizeTagLabel(categoryLabel) : '';
  const entryModeChipLabel = item.data.entryMode ? entryModeLabel(item.data.entryMode) : '';
  const entryModeNorm = normalizeTagLabel(entryModeChipLabel);
  const entryModeImpliedByCategory =
    !!entryModeNorm && !!categoryNorm && categoryNorm.includes(entryModeNorm);
  return dedupeTags([
    ...(item.data.undergraduateOnly === false
      ? [
          {
            label: 'Graduate',
            bg: 'bg-violet-50',
            text: 'text-violet-700',
          },
        ]
      : []),
    ...(categoryLabel
      ? [
          {
            label: categoryLabel,
            bg: 'bg-sky-50',
            text: 'text-sky-700',
          },
        ]
      : []),
    ...(entryModeChipLabel && !entryModeImpliedByCategory
      ? [
          {
            label: entryModeChipLabel,
            bg: 'bg-emerald-50',
            text: 'text-emerald-700',
          },
        ]
      : []),
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
  ]);
}

export function getItemSubtitle(item: BrowsableItem): string {
  return getFellowshipDeadlineSubtitle(item.data);
}

export function getItemSubtitleColor(item: BrowsableItem): string {
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

export function getFellowshipJourneySummary(fellowship: Fellowship): string | null {
  const parts = [
    fellowship.studentFacingCategory || programKindLabel(fellowship.programKind),
    fellowship.requiresMentorBeforeApply ? 'mentor first' : null,
    fellowship.mentorMatching ? 'mentor matching' : null,
    fellowship.compensationSummary || null,
    fellowship.hoursPerWeek ? `${fellowship.hoursPerWeek} hrs/week` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function getDaysUntilDeadline(item: BrowsableItem): number | null {
  if (!item.data.deadline) return null;
  const d = new Date(item.data.deadline);
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
