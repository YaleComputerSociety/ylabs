import {
  FellowshipQuickFilter,
  StudentProgramFilters,
  createEmptyStudentProgramFilters,
} from '../reducers/fellowshipSearchReducer';
import { PROGRAMS_QUERY_PARAM } from './researchProgramsHandoff';

export type ProgramSearchSortDirection = 'asc' | 'desc';

export interface ProgramSearchUrlState extends StudentProgramFilters {
  queryString: string;
  sortBy: string;
  sortDirection: ProgramSearchSortDirection;
}

type ProgramFilterListKey = Exclude<keyof StudentProgramFilters, 'quickFilter'>;

const PROGRAM_FILTER_LIST_PARAMS: ReadonlyArray<readonly [ProgramFilterListKey, string]> = [
  ['selectedStudentFacingCategory', 'opportunity'],
  ['selectedProgramKind', 'kind'],
  ['selectedEntryMode', 'apply'],
  ['selectedProgramCategory', 'category'],
  ['selectedYearOfStudy', 'year'],
  ['selectedTermOfAward', 'term'],
  ['selectedSubjects', 'subject'],
  ['selectedPurpose', 'purpose'],
  ['selectedRegions', 'region'],
  ['selectedCitizenship', 'citizenship'],
];

const QUICK_FILTER_PARAM = 'quick';
const SORT_PARAM = 'sort';
const SORT_DIRECTION_PARAM = 'dir';
const DEFAULT_SORT = 'default';

const PROGRAM_QUICK_FILTERS: ReadonlySet<string> = new Set<Exclude<FellowshipQuickFilter, null>>([
  'open',
  'closingSoon',
  'nextCycle',
  'firstYear',
  'noMentorFirst',
  'guidance',
  'applicationsOnly',
]);

export const PROGRAM_SEARCH_URL_PARAMS: readonly string[] = [
  PROGRAMS_QUERY_PARAM,
  QUICK_FILTER_PARAM,
  ...PROGRAM_FILTER_LIST_PARAMS.map(([, param]) => param),
  SORT_PARAM,
  SORT_DIRECTION_PARAM,
];

const distinctNonEmpty = (values: string[]): string[] => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];

const readQuickFilter = (value: string | null): FellowshipQuickFilter =>
  value && PROGRAM_QUICK_FILTERS.has(value) ? (value as FellowshipQuickFilter) : null;

export const readProgramSearchUrlState = (
  params: URLSearchParams,
  sortableKeys: readonly string[],
): ProgramSearchUrlState => {
  const filters = createEmptyStudentProgramFilters();
  for (const [key, param] of PROGRAM_FILTER_LIST_PARAMS) {
    filters[key] = distinctNonEmpty(params.getAll(param));
  }
  const requestedSort = params.get(SORT_PARAM) ?? DEFAULT_SORT;
  const sortBy = sortableKeys.includes(requestedSort) ? requestedSort : DEFAULT_SORT;
  return {
    ...filters,
    quickFilter: readQuickFilter(params.get(QUICK_FILTER_PARAM)),
    queryString: params.get(PROGRAMS_QUERY_PARAM) ?? '',
    sortBy,
    sortDirection: params.get(SORT_DIRECTION_PARAM) === 'asc' ? 'asc' : 'desc',
  };
};

export const writeProgramSearchUrlState = (
  params: URLSearchParams,
  state: ProgramSearchUrlState,
): URLSearchParams => {
  const next = new URLSearchParams(params);
  for (const param of PROGRAM_SEARCH_URL_PARAMS) next.delete(param);
  const query = state.queryString.trim();
  if (query) next.set(PROGRAMS_QUERY_PARAM, state.queryString);
  if (state.quickFilter) next.set(QUICK_FILTER_PARAM, state.quickFilter);
  for (const [key, param] of PROGRAM_FILTER_LIST_PARAMS) {
    for (const value of state[key]) next.append(param, value);
  }
  if (state.sortBy !== DEFAULT_SORT) {
    next.set(SORT_PARAM, state.sortBy);
    next.set(SORT_DIRECTION_PARAM, state.sortDirection);
  }
  return next;
};

export const programSearchUrlStateKey = (state: ProgramSearchUrlState): string =>
  writeProgramSearchUrlState(new URLSearchParams(), state).toString();

export const programSearchUrlStatesDifferOnlyInQuery = (
  previous: ProgramSearchUrlState,
  next: ProgramSearchUrlState,
): boolean =>
  programSearchUrlStateKey({ ...previous, queryString: '' }) ===
  programSearchUrlStateKey({ ...next, queryString: '' });
