import { FilterMode } from '../contexts/SearchContext';

export const PUBLIC_RESEARCH_QUICK_FILTERS = ['open', 'recent', 'ysm', 'ysph', 'yc'] as const;
export const PUBLIC_RESEARCH_SORT_FIELDS = ['createdAt', 'updatedAt'] as const;

export interface PublicResearchUrlState {
  queryString: string;
  selectedDepartments: string[];
  selectedResearchAreas: string[];
  selectedListingResearchAreas: string[];
  departmentsFilterMode: FilterMode;
  researchAreasFilterMode: FilterMode;
  listingResearchAreasFilterMode: FilterMode;
  sortBy: string;
  sortOrder: number;
  sortDirection: 'asc' | 'desc';
  quickFilter: string | null;
}

const DEFAULT_PUBLIC_RESEARCH_URL_STATE: PublicResearchUrlState = {
  queryString: '',
  selectedDepartments: [],
  selectedResearchAreas: [],
  selectedListingResearchAreas: [],
  departmentsFilterMode: 'union',
  researchAreasFilterMode: 'union',
  listingResearchAreasFilterMode: 'union',
  sortBy: 'default',
  sortOrder: 1,
  sortDirection: 'asc',
  quickFilter: null,
};

const readList = (params: URLSearchParams, key: string, separator = '||') => {
  const raw = params.get(key);
  if (!raw) return [];

  const seen = new Set<string>();
  return raw
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
};

const readMode = (params: URLSearchParams, key: string): FilterMode => {
  return params.get(key) === 'intersection' ? 'intersection' : 'union';
};

const readSortBy = (params: URLSearchParams) => {
  const sortBy = params.get('sortBy');
  return PUBLIC_RESEARCH_SORT_FIELDS.includes(sortBy as any) ? sortBy! : 'default';
};

const readSortOrder = (params: URLSearchParams) => {
  return params.get('sortOrder') === '-1' ? -1 : 1;
};

const readQuickFilter = (params: URLSearchParams) => {
  const quickFilter = params.get('quickFilter');
  return PUBLIC_RESEARCH_QUICK_FILTERS.includes(quickFilter as any) ? quickFilter : null;
};

export const parsePublicResearchUrlState = (search: string): PublicResearchUrlState => {
  const params = new URLSearchParams(search);
  const sortBy = readSortBy(params);
  const sortOrder = readSortOrder(params);

  return {
    ...DEFAULT_PUBLIC_RESEARCH_URL_STATE,
    queryString: (params.get('query') || '').trim(),
    selectedDepartments: readList(params, 'departments'),
    selectedResearchAreas: readList(params, 'academicDisciplines'),
    selectedListingResearchAreas: readList(params, 'researchAreas', ','),
    departmentsFilterMode: readMode(params, 'departmentsMode'),
    researchAreasFilterMode: readMode(params, 'academicDisciplinesMode'),
    listingResearchAreasFilterMode: readMode(params, 'researchAreasMode'),
    sortBy,
    sortOrder,
    sortDirection: sortOrder === -1 ? 'desc' : 'asc',
    quickFilter: readQuickFilter(params),
  };
};

const appendList = (params: URLSearchParams, key: string, values: string[], separator = '||') => {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (cleaned.length > 0) {
    params.set(key, cleaned.join(separator));
  }
};

export const serializePublicResearchUrlState = (state: PublicResearchUrlState) => {
  const params = new URLSearchParams();
  const query = state.queryString.trim();

  if (query) params.set('query', query);
  appendList(params, 'departments', state.selectedDepartments);
  appendList(params, 'academicDisciplines', state.selectedResearchAreas);
  appendList(params, 'researchAreas', state.selectedListingResearchAreas, ',');

  if (state.selectedDepartments.length > 1 && state.departmentsFilterMode === 'intersection') {
    params.set('departmentsMode', 'intersection');
  }
  if (state.selectedResearchAreas.length > 1 && state.researchAreasFilterMode === 'intersection') {
    params.set('academicDisciplinesMode', 'intersection');
  }
  if (
    state.selectedListingResearchAreas.length > 1 &&
    state.listingResearchAreasFilterMode === 'intersection'
  ) {
    params.set('researchAreasMode', 'intersection');
  }

  if (PUBLIC_RESEARCH_SORT_FIELDS.includes(state.sortBy as any)) {
    params.set('sortBy', state.sortBy);
    if (state.sortOrder === -1) params.set('sortOrder', '-1');
  }

  if (PUBLIC_RESEARCH_QUICK_FILTERS.includes(state.quickFilter as any)) {
    params.set('quickFilter', state.quickFilter!);
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
};
