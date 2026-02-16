/**
 * Shared types and helpers for browsable listings and fellowships.
 */
import { Listing, Fellowship } from './types';
import { getDepartmentAbbreviation } from '../utils/departmentNames';

export type BrowsableItem =
  | { type: 'listing'; data: Listing }
  | { type: 'fellowship'; data: Fellowship };

export function isItemOpen(item: BrowsableItem): boolean {
  if (item.type === 'listing') {
    return item.data.hiringStatus >= 0;
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
  getColor: (area: string) => { bg: string; text: string }
): TagInfo[] {
  if (item.type === 'listing') {
    const areas =
      item.data.researchAreas?.length > 0
        ? item.data.researchAreas
        : item.data.keywords || [];
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
      departments && departments.length > 0
        ? getDepartmentAbbreviation(departments[0])
        : null;
    return dept ? `${name} · ${dept}` : name;
  }
  const { deadline } = item.data;
  if (!deadline) return 'No deadline';
  const d = new Date(deadline);
  if (d < new Date()) return 'Deadline passed';
  return `Due ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function getItemSubtitleColor(item: BrowsableItem): string {
  if (item.type === 'listing') return 'text-gray-500';
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
