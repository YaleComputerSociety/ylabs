import type { SavedSearchFilters, SavedSearchView } from '../types/savedSearch';

const AVAILABILITY_LABELS: Record<'OPEN' | 'ROLLING', string> = {
  OPEN: 'Open now',
  ROLLING: 'Rolling',
};

const COMPENSATION_LABELS: Record<'PAID_OR_STIPEND' | 'COURSE_CREDIT', string> = {
  PAID_OR_STIPEND: 'Paid or stipend',
  COURSE_CREDIT: 'Course credit',
};

const ELIGIBLE_STUDENT_LEVEL_LABELS: Record<
  'FIRST_YEAR' | 'SOPHOMORE' | 'JUNIOR' | 'SENIOR',
  string
> = {
  FIRST_YEAR: 'Open to first-years',
  SOPHOMORE: 'Open to sophomores',
  JUNIOR: 'Open to juniors',
  SENIOR: 'Open to seniors',
};

const titleCaseEntityType = (value: string): string =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

export const savedSearchFilterChips = (filters: SavedSearchFilters): string[] => {
  const chips: string[] = [];
  filters.school.forEach((value) => chips.push(value));
  filters.departments.forEach((value) => chips.push(value));
  filters.researchAreas.forEach((value) => chips.push(value));
  filters.entityType.forEach((value) => chips.push(titleCaseEntityType(value)));
  filters.currentAvailability.forEach((value) => chips.push(AVAILABILITY_LABELS[value]));
  filters.compensation.forEach((value) => chips.push(COMPENSATION_LABELS[value]));
  filters.eligibleStudentLevels.forEach((value) =>
    chips.push(ELIGIBLE_STUDENT_LEVEL_LABELS[value]),
  );
  if (filters.hostsUndergrads) chips.push('Hosts undergrads');
  if (filters.hasDocumentedWayIn) chips.push('Documented way in');
  return chips;
};

export const savedSearchHasCriteria = (search: SavedSearchView): boolean =>
  Boolean(search.queryText) || savedSearchFilterChips(search.filters).length > 0;

export const savedSearchSummaryText = (search: SavedSearchView): string => {
  const parts: string[] = [];
  if (search.queryText) parts.push(`"${search.queryText}"`);
  const chips = savedSearchFilterChips(search.filters);
  if (chips.length) parts.push(chips.join(', '));
  return parts.join(' · ') || 'All research homes';
};

export const savedSearchDisplayLabel = (search: SavedSearchView): string => {
  const label = search.label.trim();
  if (label) return label;
  if (search.queryText) return search.queryText;
  const chips = savedSearchFilterChips(search.filters);
  return chips.length ? chips.join(', ') : 'Saved search';
};

export const savedSearchTargetPath = (search: SavedSearchView): string => {
  const params = search.urlParams.replace(/^\?+/, '');
  return params ? `/research?${params}` : '/research';
};
