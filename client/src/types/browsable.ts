/**
 * Shared types and helpers for browsable listings and fellowships.
 */
import { Listing, Fellowship } from './types';
import { getDepartmentAbbreviation } from '../utils/departmentNames';
import { getFellowshipApplicationStatus, URGENT_DEADLINE_DAYS } from '../utils/fellowshipStatus';

export type BrowsableItem =
  | { type: 'listing'; data: Listing }
  | { type: 'fellowship'; data: Fellowship };

export function isItemOpen(item: BrowsableItem): boolean {
  if (item.type === 'listing') {
    return item.data.hiringStatus >= 0;
  }
  return getFellowshipApplicationStatus(item.data).isApplicationWindowOpen;
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
  return getFellowshipApplicationStatus(item.data).detail;
}

export function getItemSubtitleColor(item: BrowsableItem): string {
  if (item.type === 'listing') return 'text-gray-500';
  const status = getFellowshipApplicationStatus(item.data);
  if (status.kind === 'deadlinePassed' || status.kind === 'closed') return 'text-red-500';
  if (status.kind === 'notOpenYet') return 'text-blue-600 font-medium';
  if (
    status.daysUntilDeadline !== null &&
    status.daysUntilDeadline > 0 &&
    status.daysUntilDeadline <= URGENT_DEADLINE_DAYS
  ) {
    return 'text-amber-600 font-medium';
  }
  return 'text-gray-500';
}

export function getDaysUntilDeadline(item: BrowsableItem): number | null {
  if (item.type !== 'fellowship') return null;
  return getFellowshipApplicationStatus(item.data).daysUntilDeadline;
}
