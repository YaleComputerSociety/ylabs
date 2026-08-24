import { FormEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isCancel } from 'axios';
import { useLocation, useSearchParams } from 'react-router-dom';

import ResearchHomeCard from '../components/research/ResearchHomeCard';
import ResearchFilterDisclosure from '../components/research/ResearchFilterDisclosure';
import ResearchZeroResultRecovery from '../components/research/ResearchZeroResultRecovery';
import ResearchSortDropdown, {
  ResearchSortField,
} from '../components/research/ResearchSortDropdown';
import InfiniteScrollLoadingDots from '../components/shared/InfiniteScrollLoadingDots';
import UserContext from '../contexts/UserContext';
import useConfig from '../hooks/useConfig';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import axios from '../utils/axios';
import {
  buildGroupedSearchResults,
  GroupedResearchResults,
  ResearchCluster,
} from '../utils/researchDiscoveryAdapters';
import {
  normalizeResearchEntitySearchResponse,
  ResearchEntity,
  ResearchEntitySearchResponse,
  StudentVisibilityTier,
} from '../types/researchEntity';
import { getUniqueDepartmentLabels } from '../utils/departmentNames';
import {
  relaxResearchQuery,
  suggestCorpusResearchAreas,
} from '../utils/researchZeroResultRecovery';
import useDocumentTitle from '../hooks/useDocumentTitle';
import type { PathwaySearchFilters } from '../types/pathway';
import {
  createResearchAnalyticsInteractionId,
  researchPositionBucket,
  researchResultCountBucket,
  trackResearchEvent,
  trackResearchEventOnce,
} from '../utils/researchAnalytics';

interface DepartmentResearchHomeConfig {
  abbreviation?: string;
  displayName?: string;
  name?: string;
  primaryCategory?: string;
  categories?: string[];
}

interface DepartmentSearchTarget {
  label: string;
  filters: {
    departments: string[];
  };
}

type CurrentAvailabilityFilterValue = 'OPEN' | 'ROLLING';

type ResearchSearchFilters = PathwaySearchFilters & {
  kind?: string[];
  school?: string[];
  hostsUndergrads?: boolean;
  currentAvailability?: CurrentAvailabilityFilterValue[];
};

type ResearchQualityFilter = 'description-issue' | 'missing-lead' | 'profile-fallback';
type ResearchTrustTierFilter = StudentVisibilityTier;

const CURRENT_AVAILABILITY_FILTER_VALUES: readonly CurrentAvailabilityFilterValue[] = [
  'OPEN',
  'ROLLING',
];

const CURRENT_AVAILABILITY_FILTER_LABELS: Record<CurrentAvailabilityFilterValue, string> = {
  OPEN: 'Open now',
  ROLLING: 'Rolling',
};

const FILTERED_RESULT_QUERY_LABEL = 'filtered research';
const DEFAULT_RESEARCH_HOME_LIMIT = 24;
const QUICK_START_PROMPTS = [
  { label: 'Machine learning', query: 'machine learning' },
  { label: 'Neuroscience', query: 'neuroscience' },
  { label: 'Climate change', query: 'climate change' },
  { label: 'Ancient DNA', query: 'ancient DNA' },
  { label: 'Digital archives', query: 'digital archives' },
  { label: 'Quantum materials', query: 'quantum materials' },
];

const hasStructuredFilters = (filters: ResearchSearchFilters): boolean =>
  Object.values(filters).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== false;
  });

const readSearchParamList = <T extends string>(
  params: URLSearchParams,
  key: string,
  allowedValues: readonly T[],
): T[] => {
  const allowed = new Set(allowedValues);
  const seen = new Set<T>();
  return (params.get(key) || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is T => allowed.has(value as T))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

const readSearchParamCsv = (params: URLSearchParams, key: string): string[] => {
  const seen = new Set<string>();
  return (params.get(key) || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      const lower = value.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
};

const emptyGroupedResults = (query: string): GroupedResearchResults =>
  buildGroupedSearchResults({
    query,
    researchEntities: [],
    pathways: [],
  });

interface ResearchEntitySearchPage {
  researchEntities: ResearchEntity[];
  estimatedTotalHits: number;
  page: number;
  pageSize: number;
  facetDistribution: Record<string, Record<string, number>>;
}

interface ActiveResearchSearchRequest {
  searchQuery: string;
  filters: ResearchSearchFilters;
  options?: ResearchEntitySearchOptions;
}

interface ResearchFilterAnalyticsChange {
  operation: 'apply' | 'remove';
  filter:
    | 'school'
    | 'department'
    | 'documented_way_in'
    | 'research_area'
    | 'hosts_undergrads'
    | 'current_availability';
}

interface ResearchPageSnapshot {
  key: string;
  isAdmin: boolean;
  query: string;
  submittedQuery: string;
  departmentSearch: DepartmentSearchTarget | null;
  showWeakestProfilesFirst: boolean;
  qualityFilters: ResearchQualityFilter[];
  trustTierFilters: ResearchTrustTierFilter[];
  selectedSchool: string;
  selectedDepartment: string;
  selectedResearchAreas: string[];
  hostsUndergrads: boolean;
  selectedCurrentAvailability: CurrentAvailabilityFilterValue[];
  sortBy: ResearchSortField;
  sortOrder: 'asc' | 'desc';
  facetDistribution: Record<string, Record<string, number>>;
  browseFacetDistribution: Record<string, Record<string, number>>;
  groupedResults: GroupedResearchResults;
  searchResultResearchEntities: ResearchEntity[];
  searchPage: number;
  searchTotal: number;
  searchExhausted: boolean;
  activeSearchRequest: ActiveResearchSearchRequest | null;
  defaultResearchEntities: ResearchEntity[];
  defaultSearchPage: number;
  defaultSearchTotal: number;
  defaultSearchExhausted: boolean;
  searchError: string;
  hasFacetError: boolean;
  defaultSearchError: string;
}

interface ResearchEntitySearchOptions {
  lowQualityFirst?: boolean;
  qualityFilters?: ResearchQualityFilter[];
  trustTierFilters?: ResearchTrustTierFilter[];
  includeSuppressed?: boolean;
  sortBy?: 'name' | 'lastObservedAt';
  sortOrder?: 'asc' | 'desc';
}

const defaultResearchSortOrder = (field: ResearchSortField): 'asc' | 'desc' =>
  field === 'name' ? 'asc' : 'desc';

let researchPageSnapshot: ResearchPageSnapshot | null = null;

const searchResearchEntities = async (
  q: string,
  pageSize = 18,
  signal?: AbortSignal,
  filters: ResearchSearchFilters = {},
  page = 1,
  options: ResearchEntitySearchOptions = {},
): Promise<ResearchEntitySearchPage> => {
  const response = await axios.post<ResearchEntitySearchResponse>(
    '/research/search',
    {
      q,
      page,
      pageSize,
      filters,
      ...(options.lowQualityFirst ? { browseQuality: 'low-first' } : {}),
      ...(options.lowQualityFirst && options.qualityFilters?.length
        ? { qualityFilters: options.qualityFilters }
        : {}),
      ...(options.trustTierFilters?.length
        ? { studentVisibilityTier: options.trustTierFilters }
        : {}),
      ...(options.includeSuppressed ? { includeSuppressed: true } : {}),
      ...(options.sortBy
        ? { sortBy: options.sortBy, sortOrder: options.sortOrder ?? 'desc' }
        : {}),
    },
    { signal },
  );
  const normalized = normalizeResearchEntitySearchResponse(response.data);
  return {
    researchEntities: normalized.researchEntities || [],
    estimatedTotalHits: normalized.estimatedTotalHits || 0,
    page: normalized.page || page,
    pageSize: normalized.pageSize || pageSize,
    facetDistribution: normalized.facetDistribution || {},
  };
};

const isResearchEntitySearchExhausted = (page: ResearchEntitySearchPage) =>
  page.researchEntities.length === 0 ||
  (page.researchEntities.length < page.pageSize &&
    page.page * page.pageSize >= page.estimatedTotalHits);

const SectionHeading = ({ children }: { children: string }) => (
  <div className="mb-3 flex w-full items-center justify-between gap-3">
    <h2 className="yr-kicker min-w-0 flex-1">{children}</h2>
  </div>
);

const ClusterLoadingCard = () => (
  <div className="yr-card rounded-md p-4">
    <div className="h-3 w-2/3 rounded bg-slate-100" />
    <div className="mt-3 h-2 w-full rounded bg-slate-100" />
    <div className="mt-2 h-2 w-5/6 rounded bg-slate-100" />
    <p className="mt-4 text-xs text-slate-500">Loading research homes</p>
  </div>
);

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count.toLocaleString()} ${count === 1 ? singular : plural}`;

const resultSummary = (
  results: GroupedResearchResults,
  query: string,
  loading: boolean,
  departmentGapLabel?: string,
  totalMatchingHomeCount?: number,
): string => {
  if (loading) return `Searching Yale Research for ${query}.`;
  const loadedHomeCount = results.clusters.length;
  const matchingHomeCount = Math.max(totalMatchingHomeCount ?? loadedHomeCount, loadedHomeCount);
  if (departmentGapLabel && matchingHomeCount === 0 && results.people.length === 0) {
    return `No indexed research homes yet for ${departmentGapLabel}.`;
  }
  const homeCountLabel = pluralize(matchingHomeCount, 'research home');
  const homeSummary =
    query === FILTERED_RESULT_QUERY_LABEL
      ? `${homeCountLabel} match your filters`
      : `${homeCountLabel} for '${query}'`;
  const parts = [homeSummary];
  if (results.people.length > 0) {
    parts.push(pluralize(results.people.length, 'contact', 'contacts'));
  }
  if (results.pathways.length > 0) {
    parts.push(pluralize(results.pathways.length, 'verified way in', 'verified ways in'));
  }
  return parts.join(', ');
};

const EmptyGroup = ({ children }: { children: string }) => (
  <div className="yr-muted-surface rounded-md border-dashed p-4 text-sm text-slate-500">
    {children}
  </div>
);

const QUALITY_FILTER_OPTIONS: Array<{ value: ResearchQualityFilter; label: string }> = [
  { value: 'description-issue', label: 'Description issue' },
  { value: 'missing-lead', label: 'Missing lead' },
  { value: 'profile-fallback', label: 'Profile fallback' },
];

const TRUST_TIER_FILTER_OPTIONS: Array<{ value: ResearchTrustTierFilter; label: string }> = [
  { value: 'student_ready', label: 'Ready' },
  { value: 'limited_but_safe', label: 'Limited' },
  { value: 'operator_review', label: 'Review' },
  { value: 'suppressed', label: 'Suppressed' },
];

const uniqueStrings = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const trimmed = (value || '').trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }

  return out;
};

const buildDepartmentSearchTargets = (
  departments: DepartmentResearchHomeConfig[],
): DepartmentSearchTarget[] =>
  departments
    .map((department) => {
      const labels = getUniqueDepartmentLabels(
        [department.name, department.displayName].filter(Boolean) as string[],
        departments,
      );
      const label = (labels[0] || '').trim();
      if (!label) return null;
      return {
        label,
        filters: {
          departments: uniqueStrings([department.displayName, department.name]),
        },
      };
    })
    .filter((target): target is DepartmentSearchTarget => Boolean(target))
    .filter((target) => target.filters.departments.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));

const scrollResearchViewportToTop = () => {
  const scrollContainer = document.querySelector<HTMLElement>('[data-scroll-container]');
  if (scrollContainer) {
    scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const Research = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useContext(UserContext);
  const { departments, researchAreas } = useConfig();
  const isAdmin = user?.userType === 'admin';
  const pageSnapshotKey = searchParams.toString();
  const restorableSnapshot =
    researchPageSnapshot?.key === pageSnapshotKey && researchPageSnapshot.isAdmin === isAdmin
      ? researchPageSnapshot
      : null;
  const restoredSnapshotRef = useRef<ResearchPageSnapshot | null>(restorableSnapshot);
  const [query, setQuery] = useState(
    () => restoredSnapshotRef.current?.query ?? searchParams.get('q') ?? '',
  );
  const [submittedQuery, setSubmittedQuery] = useState(
    () => restoredSnapshotRef.current?.submittedQuery ?? '',
  );
  const [departmentSearch, setDepartmentSearch] = useState<DepartmentSearchTarget | null>(
    () => restoredSnapshotRef.current?.departmentSearch ?? null,
  );
  const [showWeakestProfilesFirst, setShowWeakestProfilesFirst] = useState(
    () =>
      restoredSnapshotRef.current?.showWeakestProfilesFirst ??
      (isAdmin && searchParams.get('weak') === '1'),
  );
  const [qualityFilters, setQualityFilters] = useState<ResearchQualityFilter[]>(
    () =>
      restoredSnapshotRef.current?.qualityFilters ??
      (isAdmin
        ? readSearchParamList(
            searchParams,
            'quality',
            QUALITY_FILTER_OPTIONS.map((option) => option.value),
          )
        : []),
  );
  const [trustTierFilters, setTrustTierFilters] = useState<ResearchTrustTierFilter[]>(
    () =>
      restoredSnapshotRef.current?.trustTierFilters ??
      (isAdmin
        ? readSearchParamList(
            searchParams,
            'tier',
            TRUST_TIER_FILTER_OPTIONS.map((option) => option.value),
          )
        : []),
  );
  const [selectedSchool, setSelectedSchool] = useState(
    () => restoredSnapshotRef.current?.selectedSchool ?? searchParams.get('school') ?? '',
  );
  const [selectedDepartment, setSelectedDepartment] = useState(
    () => restoredSnapshotRef.current?.selectedDepartment ?? searchParams.get('department') ?? '',
  );
  const [selectedResearchAreas, setSelectedResearchAreas] = useState<string[]>(
    () =>
      restoredSnapshotRef.current?.selectedResearchAreas ??
      readSearchParamCsv(searchParams, 'researchAreas'),
  );
  const [hostsUndergrads, setHostsUndergrads] = useState(
    () => restoredSnapshotRef.current?.hostsUndergrads ?? searchParams.get('undergrad') === '1',
  );
  const [selectedCurrentAvailability, setSelectedCurrentAvailability] = useState<
    CurrentAvailabilityFilterValue[]
  >(
    () =>
      restoredSnapshotRef.current?.selectedCurrentAvailability ??
      readSearchParamList(searchParams, 'availability', CURRENT_AVAILABILITY_FILTER_VALUES),
  );
  const [sortBy, setSortBy] = useState<ResearchSortField>(
    () => restoredSnapshotRef.current?.sortBy ?? 'relevance',
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(
    () => restoredSnapshotRef.current?.sortOrder ?? 'asc',
  );
  const sortByRef = useRef(sortBy);
  const sortOrderRef = useRef(sortOrder);
  sortByRef.current = sortBy;
  sortOrderRef.current = sortOrder;
  const currentSortRequestOptions = (): Pick<
    ResearchEntitySearchOptions,
    'sortBy' | 'sortOrder'
  > =>
    sortByRef.current === 'relevance'
      ? {}
      : { sortBy: sortByRef.current, sortOrder: sortOrderRef.current };
  const [facetDistribution, setFacetDistribution] = useState<
    Record<string, Record<string, number>>
  >(() => restoredSnapshotRef.current?.facetDistribution ?? {});
  const [browseFacetDistribution, setBrowseFacetDistribution] = useState<
    Record<string, Record<string, number>>
  >(() => restoredSnapshotRef.current?.browseFacetDistribution ?? {});
  const [groupedResults, setGroupedResults] = useState<GroupedResearchResults>(
    () => restoredSnapshotRef.current?.groupedResults ?? emptyGroupedResults(''),
  );
  const [searchResultResearchEntities, setSearchResultResearchEntities] = useState<
    ResearchEntity[]
  >(() => restoredSnapshotRef.current?.searchResultResearchEntities ?? []);
  const [searchPage, setSearchPage] = useState(() => restoredSnapshotRef.current?.searchPage ?? 1);
  const [searchTotal, setSearchTotal] = useState(
    () => restoredSnapshotRef.current?.searchTotal ?? 0,
  );
  const [searchExhausted, setSearchExhausted] = useState(
    () => restoredSnapshotRef.current?.searchExhausted ?? true,
  );
  const [activeSearchRequest, setActiveSearchRequest] =
    useState<ActiveResearchSearchRequest | null>(
      () => restoredSnapshotRef.current?.activeSearchRequest ?? null,
    );
  const [defaultResearchEntities, setDefaultResearchEntities] = useState<ResearchEntity[]>(
    () => restoredSnapshotRef.current?.defaultResearchEntities ?? [],
  );
  const [defaultSearchPage, setDefaultSearchPage] = useState(
    () => restoredSnapshotRef.current?.defaultSearchPage ?? 1,
  );
  const [defaultSearchTotal, setDefaultSearchTotal] = useState(
    () => restoredSnapshotRef.current?.defaultSearchTotal ?? 0,
  );
  const [defaultSearchExhausted, setDefaultSearchExhausted] = useState(
    () => restoredSnapshotRef.current?.defaultSearchExhausted ?? false,
  );
  const fetchedSearchPageRef = useRef(restoredSnapshotRef.current?.searchPage ?? 1);
  const fetchedDefaultSearchPageRef = useRef(restoredSnapshotRef.current?.defaultSearchPage ?? 1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isApplyingFilters, setIsApplyingFilters] = useState(false);
  const [defaultSearchLoading, setDefaultSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(
    () => restoredSnapshotRef.current?.searchError ?? '',
  );
  const [hasFacetError, setHasFacetError] = useState(
    () => restoredSnapshotRef.current?.hasFacetError ?? false,
  );
  const [defaultSearchError, setDefaultSearchError] = useState(
    () => restoredSnapshotRef.current?.defaultSearchError ?? '',
  );
  const [relaxedQuerySuggestion, setRelaxedQuerySuggestion] = useState<string | null>(null);
  const relaxProbeRequestIdRef = useRef(0);
  const relaxProbeAbortRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchRequestIdRef = useRef(0);
  const defaultSearchRequestIdRef = useRef(0);
  const browseAnalyticsSessionRef = useRef(createResearchAnalyticsInteractionId('browse'));
  const searchAbortRef = useRef<AbortController | null>(null);
  const defaultSearchAbortRef = useRef<AbortController | null>(null);
  const activeSearchKeyRef = useRef<string | null>(null);
  const activeSearchAnalyticsKeyRef = useRef<string | null>(null);
  const pendingSearchParamsRef = useRef<string | null>(null);
  const pendingSearchSourceParamsRef = useRef<string | null>(null);
  const pendingSearchSourceLocationKeyRef = useRef<string | null>(null);
  const effectGenerationRef = useRef(0);
  const restoredSnapshotSyncKeyRef = useRef(
    restoredSnapshotRef.current
      ? `${pageSnapshotKey}|${String(isAdmin)}|${String(showWeakestProfilesFirst)}|${qualityFilters.join(',')}|${trustTierFilters.join(',')}`
      : null,
  );
  const buildResearchAreaOptions = useCallback(
    (counts: Record<string, number> | undefined) =>
      Array.from(new Set(researchAreas.map((area) => area.name.trim()).filter(Boolean)))
        .map((name) => ({ value: name, count: (counts || {})[name] }))
        .filter((option) => Number.isFinite(option.count) && (option.count ?? 0) > 0)
        .sort((a, b) => a.value.localeCompare(b.value)),
    [researchAreas],
  );
  const researchAreaOptions = useMemo(
    () => buildResearchAreaOptions(facetDistribution.researchAreas),
    [buildResearchAreaOptions, facetDistribution.researchAreas],
  );
  const browseResearchAreaOptions = useMemo(
    () => buildResearchAreaOptions(browseFacetDistribution.researchAreas),
    [buildResearchAreaOptions, browseFacetDistribution.researchAreas],
  );
  const buildCurrentAvailabilityOptions = useCallback(
    (counts: Record<string, number> | undefined) =>
      CURRENT_AVAILABILITY_FILTER_VALUES.map((value) => ({
        value,
        label: CURRENT_AVAILABILITY_FILTER_LABELS[value],
        count: (counts || {})[value],
      })).filter((option) => Number.isFinite(option.count) && (option.count ?? 0) > 0),
    [],
  );
  const currentAvailabilityOptions = useMemo(
    () => buildCurrentAvailabilityOptions(facetDistribution.undergraduateCurrentAvailability),
    [buildCurrentAvailabilityOptions, facetDistribution.undergraduateCurrentAvailability],
  );
  const browseCurrentAvailabilityOptions = useMemo(
    () =>
      buildCurrentAvailabilityOptions(browseFacetDistribution.undergraduateCurrentAvailability),
    [buildCurrentAvailabilityOptions, browseFacetDistribution.undergraduateCurrentAvailability],
  );
  const departmentSearchTargets = useMemo(
    () => buildDepartmentSearchTargets(departments),
    [departments],
  );
  const departmentSearchTargetByLabel = useMemo(
    () => new Map(departmentSearchTargets.map((target) => [target.label.toLowerCase(), target])),
    [departmentSearchTargets],
  );

  useDocumentTitle('Research');

  const writeResearchSearchParams = (
    nextState: {
      query?: string;
      departmentLabel?: string | null;
      showWeakest?: boolean;
      quality?: ResearchQualityFilter[];
      trustTiers?: ResearchTrustTierFilter[];
      school?: string;
      department?: string;
      researchAreas?: string[];
      hostsUndergrads?: boolean;
      currentAvailability?: CurrentAvailabilityFilterValue[];
    },
    options: { replace?: boolean; markPending?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    const nextQuery = (nextState.query || '').trim();
    if (nextQuery) params.set('q', nextQuery);
    const departmentLabel = (nextState.departmentLabel || '').trim();
    if (departmentLabel) params.set('dept', departmentLabel);
    if (nextState.school?.trim()) params.set('school', nextState.school.trim());
    if (nextState.department?.trim()) params.set('department', nextState.department.trim());
    if (nextState.researchAreas?.length) {
      params.set('researchAreas', nextState.researchAreas.join(','));
    }
    if (nextState.hostsUndergrads) params.set('undergrad', '1');
    if (nextState.currentAvailability?.length) {
      params.set('availability', nextState.currentAvailability.join(','));
    }

    if (isAdmin) {
      if (nextState.showWeakest) params.set('weak', '1');
      if (nextState.quality?.length) params.set('quality', nextState.quality.join(','));
      if (nextState.trustTiers?.length) params.set('tier', nextState.trustTiers.join(','));
    }

    if (options.markPending) {
      pendingSearchParamsRef.current = params.toString();
      pendingSearchSourceParamsRef.current = searchParams.toString();
      pendingSearchSourceLocationKeyRef.current = location.key;
    }
    setSearchParams(params, { replace: Boolean(options.replace) });
  };

  useEffect(() => {
    const generation = ++effectGenerationRef.current;
    return () => {
      queueMicrotask(() => {
        if (effectGenerationRef.current !== generation) return;
        searchAbortRef.current?.abort();
        defaultSearchAbortRef.current?.abort();
      });
    };
  }, []);

  useEffect(() => {
    restoredSnapshotRef.current?.defaultResearchEntities.forEach((entity, index) => {
      if (!entity._id) return;
      void trackResearchEventOnce(`${browseAnalyticsSessionRef.current}:restored:${entity._id}`, {
        eventType: 'research_entity_impression',
        entityType: 'research_entity',
        entityId: entity._id,
        payload: {
          surface: 'browse',
          positionBucket: researchPositionBucket(index + 1),
        },
      });
    });
  }, []);

  useEffect(() => {
    if (isAdmin) return;
    if (showWeakestProfilesFirst) setShowWeakestProfilesFirst(false);
    if (qualityFilters.length > 0) setQualityFilters([]);
    if (trustTierFilters.length > 0) setTrustTierFilters([]);
  }, [isAdmin, showWeakestProfilesFirst, qualityFilters.length, trustTierFilters.length]);

  const runDefaultResearchHomeSearch = async (page = 1) => {
    if (page === 1) fetchedDefaultSearchPageRef.current = 1;
    const requestId = ++defaultSearchRequestIdRef.current;
    const browseLoadAnalyticsKey = `${browseAnalyticsSessionRef.current}:${requestId}:${page}`;
    const controller = new AbortController();
    defaultSearchAbortRef.current?.abort();
    defaultSearchAbortRef.current = controller;

    setDefaultSearchLoading(true);
    setDefaultSearchError('');
    if (page === 1) {
      setDefaultSearchExhausted(false);
    }

    try {
      const researchEntitiesPage = await searchResearchEntities(
        '',
        DEFAULT_RESEARCH_HOME_LIMIT,
        controller.signal,
        {},
        page,
        {
          lowQualityFirst: isAdmin && showWeakestProfilesFirst,
          qualityFilters: isAdmin && showWeakestProfilesFirst ? qualityFilters : [],
          trustTierFilters: isAdmin ? trustTierFilters : [],
          includeSuppressed: isAdmin && trustTierFilters.includes('suppressed'),
          ...currentSortRequestOptions(),
        },
      );

      if (requestId !== defaultSearchRequestIdRef.current || controller.signal.aborted) return;

      const researchEntities = researchEntitiesPage.researchEntities;

      setDefaultResearchEntities((current) =>
        page === 1 ? researchEntities : [...current, ...researchEntities],
      );
      if (page === 1) {
        setBrowseFacetDistribution(researchEntitiesPage.facetDistribution);
      }
      setDefaultSearchTotal(researchEntitiesPage.estimatedTotalHits);
      setDefaultSearchExhausted(isResearchEntitySearchExhausted(researchEntitiesPage));
      setDefaultSearchError('');
      researchEntities.forEach((entity, index) => {
        if (!entity._id) return;
        void trackResearchEventOnce(`${browseLoadAnalyticsKey}:${entity._id}`, {
          eventType: 'research_entity_impression',
          entityType: 'research_entity',
          entityId: entity._id,
          payload: {
            surface: 'browse',
            positionBucket: researchPositionBucket(
              (page - 1) * DEFAULT_RESEARCH_HOME_LIMIT + index + 1,
            ),
          },
        });
      });
    } catch (error) {
      if (
        requestId === defaultSearchRequestIdRef.current &&
        !controller.signal.aborted &&
        !isCancel(error)
      ) {
        setDefaultSearchError('Research homes are temporarily unavailable.');
      }
    } finally {
      if (requestId === defaultSearchRequestIdRef.current && !controller.signal.aborted) {
        setDefaultSearchLoading(false);
      }
    }
  };

  const runSearch = async (
    nextQuery: string,
    options: {
      searchQuery?: string;
      filters?: ResearchSearchFilters;
      hasFilterSelections?: boolean;
      departmentSearch?: DepartmentSearchTarget | null;
      syncUrl?: boolean;
      filterChanges?: ResearchFilterAnalyticsChange[];
      preserveResults?: boolean;
    } = {},
  ) => {
    defaultSearchAbortRef.current?.abort();
    const trimmed = nextQuery.trim();
    const searchQuery = options.searchQuery ?? trimmed;
    const filters = options.filters ?? {};
    const hasFilters = hasStructuredFilters(filters) || Boolean(options.hasFilterSelections);
    if (!trimmed && !hasFilters) return;
    if (!searchQuery.trim() && !hasFilters) return;
    const resultQueryLabel = trimmed || FILTERED_RESULT_QUERY_LABEL;
    const searchKind = options.departmentSearch ? 'department' : hasFilters ? 'filtered' : 'query';
    const filterCount = Object.values(filters).filter((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    ).length;
    const filterCountBucket =
      filterCount === 0 ? '0' : filterCount === 1 ? '1' : filterCount === 2 ? '2' : '3+';

    const requestKey = JSON.stringify({
      query: searchQuery.trim(),
      filters,
      trustTierFilters: isAdmin ? trustTierFilters : [],
      includeSuppressed: isAdmin && trustTierFilters.includes('suppressed'),
      sort: currentSortRequestOptions(),
    });
    if (activeSearchKeyRef.current === requestKey) return;
    activeSearchKeyRef.current = requestKey;

    const requestId = ++searchRequestIdRef.current;
    const analyticsKey = createResearchAnalyticsInteractionId('search');
    activeSearchAnalyticsKeyRef.current = analyticsKey;
    const controller = new AbortController();
    searchAbortRef.current?.abort();
    searchAbortRef.current = controller;

    setDefaultSearchExhausted(true);
    fetchedSearchPageRef.current = 1;
    setSearchPage(1);
    setSearchTotal(0);
    setSearchExhausted(false);
    if (!options.preserveResults) {
      setSearchResultResearchEntities([]);
    }
    setActiveSearchRequest({
      searchQuery: searchQuery.trim(),
      filters,
      options: {
        trustTierFilters: isAdmin ? trustTierFilters : [],
        includeSuppressed: isAdmin && trustTierFilters.includes('suppressed'),
        ...currentSortRequestOptions(),
      },
    });
    setQuery(trimmed);
    setSubmittedQuery(resultQueryLabel);
    setDepartmentSearch(options.departmentSearch ?? null);
    if (!options.preserveResults) {
      setFacetDistribution({});
    }
    setSearchLoading(true);
    setIsLoadingMore(false);
    setIsApplyingFilters(Boolean(options.preserveResults));
    setSearchError('');
    setHasFacetError(false);
    if (!options.preserveResults) {
      setGroupedResults(emptyGroupedResults(resultQueryLabel));
    }
    if (options.syncUrl !== false) {
      writeResearchSearchParams(
        {
          query: trimmed,
          departmentLabel: options.departmentSearch?.label,
          school: filters.school?.[0],
          department: filters.departments?.[0],
          researchAreas: filters.researchAreas,
          hostsUndergrads: filters.hostsUndergrads === true,
          currentAvailability: filters.currentAvailability,
          showWeakest: showWeakestProfilesFirst,
          quality: qualityFilters,
          trustTiers: trustTierFilters,
        },
        { markPending: true },
      );
    }

    try {
      const researchEntitiesPage = await searchResearchEntities(
        searchQuery.trim(),
        24,
        controller.signal,
        filters,
        1,
        {
          trustTierFilters: isAdmin ? trustTierFilters : [],
          includeSuppressed: isAdmin && trustTierFilters.includes('suppressed'),
          ...currentSortRequestOptions(),
        },
      );

      if (requestId !== searchRequestIdRef.current || controller.signal.aborted) return;

      const researchEntities = researchEntitiesPage.researchEntities;
      setSearchError('');
      setHasFacetError(false);
      setSearchResultResearchEntities(researchEntities);
      setSearchTotal(researchEntitiesPage.estimatedTotalHits);
      setFacetDistribution(researchEntitiesPage.facetDistribution);
      setSearchExhausted(isResearchEntitySearchExhausted(researchEntitiesPage));

      setGroupedResults(
        buildGroupedSearchResults({
          query: resultQueryLabel,
          researchEntities,
          pathways: [],
        }),
      );
      const resultCount = researchEntitiesPage.estimatedTotalHits;
      void trackResearchEvent({
        eventType: 'research_search',
        payload: {
          outcome: resultCount > 0 ? 'results' : 'zero_results',
          resultCountBucket: researchResultCountBucket(resultCount),
          searchKind,
          filterCountBucket,
        },
        dedupeKey: analyticsKey,
      });
      researchEntities.forEach((entity, index) => {
        if (!entity._id) return;
        void trackResearchEventOnce(`${analyticsKey}:i:${entity._id}`, {
          eventType: 'research_entity_impression',
          entityType: 'research_entity',
          entityId: entity._id,
          payload: { surface: 'search', positionBucket: researchPositionBucket(index + 1) },
        });
      });
      options.filterChanges?.forEach((change) => {
        void trackResearchEvent({
          eventType: 'research_filter_change',
          payload: change,
          dedupeKey: createResearchAnalyticsInteractionId('filter'),
        });
      });
    } catch (error) {
      if (
        requestId === searchRequestIdRef.current &&
        !controller.signal.aborted &&
        !isCancel(error)
      ) {
        setSearchError(
          'Live search metadata is unavailable right now. Try another topic or check back soon.',
        );
        setHasFacetError(true);
        setSearchExhausted(true);
        void trackResearchEvent({
          eventType: 'research_search',
          payload: {
            outcome: 'error',
            resultCountBucket: '0',
            searchKind,
            filterCountBucket,
          },
          dedupeKey: analyticsKey,
        });
      }
    } finally {
      if (activeSearchKeyRef.current === requestKey) activeSearchKeyRef.current = null;
      if (requestId === searchRequestIdRef.current && !controller.signal.aborted) {
        setSearchLoading(false);
        setIsApplyingFilters(false);
      }
    }
  };

  const runSearchResultsPage = async (page: number) => {
    if (!activeSearchRequest) return;
    const requestId = ++searchRequestIdRef.current;
    const controller = new AbortController();
    searchAbortRef.current?.abort();
    searchAbortRef.current = controller;

    setIsLoadingMore(true);

    try {
      const researchEntitiesPage = await searchResearchEntities(
        activeSearchRequest.searchQuery,
        24,
        controller.signal,
        activeSearchRequest.filters,
        page,
        activeSearchRequest.options || {},
      );

      if (requestId !== searchRequestIdRef.current || controller.signal.aborted) return;

      const visibleResearchEntities = researchEntitiesPage.researchEntities;

      setSearchResultResearchEntities((current) => {
        const nextResearchEntities = [...current, ...visibleResearchEntities];
        setGroupedResults((currentResults) =>
          buildGroupedSearchResults({
            query: submittedQuery,
            researchEntities: nextResearchEntities,
            pathways: currentResults.pathways,
          }),
        );
        return nextResearchEntities;
      });
      const analyticsKey = activeSearchAnalyticsKeyRef.current;
      if (analyticsKey) {
        visibleResearchEntities.forEach((entity, index) => {
          if (!entity._id) return;
          void trackResearchEventOnce(`${analyticsKey}:i:${entity._id}`, {
            eventType: 'research_entity_impression',
            entityType: 'research_entity',
            entityId: entity._id,
            payload: {
              surface: 'search',
              positionBucket: researchPositionBucket((page - 1) * 24 + index + 1),
            },
          });
        });
      }
      setSearchTotal(researchEntitiesPage.estimatedTotalHits);
      setSearchExhausted(isResearchEntitySearchExhausted(researchEntitiesPage));
    } catch (error) {
      if (
        requestId === searchRequestIdRef.current &&
        !controller.signal.aborted &&
        !isCancel(error)
      ) {
        setSearchError('More research homes are temporarily unavailable.');
        setSearchExhausted(true);
      }
    } finally {
      if (requestId === searchRequestIdRef.current && !controller.signal.aborted) {
        setIsLoadingMore(false);
      }
    }
  };

  const runSearchRef = useRef(runSearch);
  const runDefaultResearchHomeSearchRef = useRef(runDefaultResearchHomeSearch);
  const runSearchResultsPageRef = useRef(runSearchResultsPage);
  runSearchRef.current = runSearch;
  runDefaultResearchHomeSearchRef.current = runDefaultResearchHomeSearch;
  runSearchResultsPageRef.current = runSearchResultsPage;

  const studentSearchFilters = (
    school = selectedSchool,
    department = selectedDepartment,
    areas = selectedResearchAreas,
    undergrads = hostsUndergrads,
    availability = selectedCurrentAvailability,
  ): ResearchSearchFilters => ({
    ...(school ? { school: [school] } : {}),
    ...(department ? { departments: [department] } : {}),
    ...(areas.length ? { researchAreas: areas } : {}),
    ...(undergrads ? { hostsUndergrads: true } : {}),
    ...(availability.length ? { currentAvailability: availability } : {}),
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const filters = studentSearchFilters();
    runSearch(query.trim(), {
      filters,
      hasFilterSelections: hasStructuredFilters(filters),
    });
  };

  const resetSearch = () => {
    searchAbortRef.current?.abort();
    searchRequestIdRef.current += 1;
    setQuery('');
    setSubmittedQuery('');
    setDepartmentSearch(null);
    setSelectedSchool('');
    setSelectedDepartment('');
    setSelectedResearchAreas([]);
    setHostsUndergrads(false);
    setSelectedCurrentAvailability([]);
    setFacetDistribution({});
    setGroupedResults(emptyGroupedResults(''));
    setSearchResultResearchEntities([]);
    setSearchPage(1);
    setSearchTotal(0);
    setSearchExhausted(true);
    setActiveSearchRequest(null);
    activeSearchAnalyticsKeyRef.current = null;
    setSearchError('');
    setHasFacetError(false);
    setSearchLoading(false);
    setIsLoadingMore(false);
    setDefaultSearchExhausted(false);
    setDefaultSearchPage(1);
    writeResearchSearchParams(
      {
        showWeakest: showWeakestProfilesFirst,
        quality: qualityFilters,
        trustTiers: trustTierFilters,
      },
      { replace: true },
    );
    if (defaultResearchEntities.length === 0) {
      setDefaultSearchTotal(0);
      runDefaultResearchHomeSearch(1);
    }
  };

  const hasSubmittedSearch = submittedQuery.trim().length > 0;

  useEffect(() => {
    const observedSearchParams = searchParams.toString();
    if (pendingSearchParamsRef.current === observedSearchParams) {
      pendingSearchParamsRef.current = null;
      pendingSearchSourceParamsRef.current = null;
      pendingSearchSourceLocationKeyRef.current = null;
    } else if (
      pendingSearchParamsRef.current !== null &&
      (pendingSearchSourceParamsRef.current !== observedSearchParams ||
        pendingSearchSourceLocationKeyRef.current !== location.key)
    ) {
      pendingSearchParamsRef.current = null;
      pendingSearchSourceParamsRef.current = null;
      pendingSearchSourceLocationKeyRef.current = null;
    }

    // A search submission or filter toggle updates component state and the URL
    // in the same transition, but the URL write can land a render later. While
    // the pending write is still unobserved, the params we see are stale: acting
    // on them would reset the just-toggled filter and re-run the previous query
    // (hard-resetting results) before the new URL arrives to reconcile. Wait for
    // the pending write instead.
    if (
      pendingSearchParamsRef.current !== null &&
      pendingSearchParamsRef.current !== observedSearchParams
    ) {
      return;
    }
    const urlQuery = searchParams.get('q') || '';
    const urlDepartmentLabel = searchParams.get('dept') || '';
    const urlSchool = searchParams.get('school') || '';
    const urlDepartment = searchParams.get('department') || '';
    const urlResearchAreas = readSearchParamCsv(searchParams, 'researchAreas');
    const urlHostsUndergrads = searchParams.get('undergrad') === '1';
    const urlCurrentAvailability = readSearchParamList(
      searchParams,
      'availability',
      CURRENT_AVAILABILITY_FILTER_VALUES,
    );
    const urlWeakestFirst = isAdmin && searchParams.get('weak') === '1';
    const urlQualityFilters = isAdmin
      ? readSearchParamList(
          searchParams,
          'quality',
          QUALITY_FILTER_OPTIONS.map((option) => option.value),
        )
      : [];
    const urlTrustTierFilters = isAdmin
      ? readSearchParamList(
          searchParams,
          'tier',
          TRUST_TIER_FILTER_OPTIONS.map((option) => option.value),
        )
      : [];
    const syncKey = `${pageSnapshotKey}|${String(isAdmin)}|${String(showWeakestProfilesFirst)}|${qualityFilters.join(',')}|${trustTierFilters.join(',')}`;

    if (restoredSnapshotSyncKeyRef.current === syncKey) {
      restoredSnapshotRef.current = null;
      return;
    }

    if (showWeakestProfilesFirst !== urlWeakestFirst) {
      setShowWeakestProfilesFirst(urlWeakestFirst);
      return;
    }
    if (qualityFilters.join(',') !== urlQualityFilters.join(',')) {
      setQualityFilters(urlQualityFilters);
      return;
    }
    if (trustTierFilters.join(',') !== urlTrustTierFilters.join(',')) {
      setTrustTierFilters(urlTrustTierFilters);
      return;
    }
    if (selectedSchool !== urlSchool) {
      setSelectedSchool(urlSchool);
      return;
    }
    if (selectedDepartment !== urlDepartment) {
      setSelectedDepartment(urlDepartment);
      return;
    }
    if (selectedResearchAreas.join(',') !== urlResearchAreas.join(',')) {
      setSelectedResearchAreas(urlResearchAreas);
      return;
    }
    if (hostsUndergrads !== urlHostsUndergrads) {
      setHostsUndergrads(urlHostsUndergrads);
      return;
    }
    if (selectedCurrentAvailability.join(',') !== urlCurrentAvailability.join(',')) {
      setSelectedCurrentAvailability(urlCurrentAvailability);
      return;
    }
    const studentFilters: ResearchSearchFilters = {
      ...(urlSchool ? { school: [urlSchool] } : {}),
      ...(urlDepartment ? { departments: [urlDepartment] } : {}),
      ...(urlResearchAreas.length ? { researchAreas: urlResearchAreas } : {}),
      ...(urlHostsUndergrads ? { hostsUndergrads: true } : {}),
      ...(urlCurrentAvailability.length ? { currentAvailability: urlCurrentAvailability } : {}),
    };

    const urlDepartmentSearch = urlDepartmentLabel
      ? (departmentSearchTargetByLabel.get(urlDepartmentLabel.toLowerCase()) ?? null)
      : null;

    if (urlDepartmentSearch) {
      if (departmentSearch?.label === urlDepartmentSearch.label && hasSubmittedSearch) {
        return;
      }
      void runSearchRef.current(urlDepartmentSearch.label, {
        searchQuery: '',
        filters: { departments: urlDepartmentSearch.filters.departments },
        hasFilterSelections: true,
        departmentSearch: urlDepartmentSearch,
        syncUrl: false,
      });
      return;
    }

    if (urlQuery.trim()) {
      if (
        !urlDepartmentLabel &&
        submittedQuery === urlQuery.trim() &&
        JSON.stringify(activeSearchRequest?.filters || {}) === JSON.stringify(studentFilters)
      ) {
        return;
      }
      void runSearchRef.current(urlQuery, {
        filters: studentFilters,
        syncUrl: false,
        preserveResults: submittedQuery === urlQuery.trim(),
      });
      return;
    }

    if (hasStructuredFilters(studentFilters)) {
      if (
        submittedQuery === FILTERED_RESULT_QUERY_LABEL &&
        JSON.stringify(activeSearchRequest?.filters || {}) === JSON.stringify(studentFilters)
      ) {
        return;
      }
      void runSearchRef.current('', {
        filters: studentFilters,
        hasFilterSelections: true,
        syncUrl: false,
        preserveResults: submittedQuery === 'filtered research',
      });
      return;
    }

    // A search submission updates component state and the URL in the same
    // transition. Do not let an effect that still observes the previous URL
    // overwrite that active search before its pending URL write is observed.
    if (activeSearchKeyRef.current !== null && pendingSearchParamsRef.current !== null) return;

    searchAbortRef.current?.abort();
    searchRequestIdRef.current += 1;
    activeSearchKeyRef.current = null;

    // Preserve an in-progress draft while startup context (for example config or
    // user state) settles. Only clear the input when an existing URL-backed
    // search is actually being reset.
    if (hasSubmittedSearch) setQuery('');
    setSubmittedQuery('');
    setDepartmentSearch(null);
    setGroupedResults(emptyGroupedResults(''));
    setSearchResultResearchEntities([]);
    setSearchPage(1);
    setSearchTotal(0);
    setSearchExhausted(true);
    setActiveSearchRequest(null);
    setSearchError('');
    setHasFacetError(false);
    setSearchLoading(false);
    setIsLoadingMore(false);
    setDefaultResearchEntities([]);
    setDefaultSearchTotal(0);
    setDefaultSearchExhausted(false);
    setDefaultSearchPage(1);
    void runDefaultResearchHomeSearchRef.current(1);
  }, [
    searchParams,
    setSearchParams,
    location.key,
    pageSnapshotKey,
    isAdmin,
    showWeakestProfilesFirst,
    qualityFilters,
    trustTierFilters,
    selectedSchool,
    selectedDepartment,
    selectedResearchAreas,
    hostsUndergrads,
    selectedCurrentAvailability,
    departmentSearchTargetByLabel,
    departmentSearch,
    hasSubmittedSearch,
    submittedQuery,
    activeSearchRequest,
  ]);

  useEffect(() => {
    researchPageSnapshot = {
      key: pageSnapshotKey,
      isAdmin,
      query,
      submittedQuery,
      departmentSearch,
      showWeakestProfilesFirst,
      qualityFilters,
      trustTierFilters,
      selectedSchool,
      selectedDepartment,
      selectedResearchAreas,
      hostsUndergrads,
      selectedCurrentAvailability,
      sortBy,
      sortOrder,
      facetDistribution,
      browseFacetDistribution,
      groupedResults,
      searchResultResearchEntities,
      searchPage,
      searchTotal,
      searchExhausted,
      activeSearchRequest,
      defaultResearchEntities,
      defaultSearchPage,
      defaultSearchTotal,
      defaultSearchExhausted,
      searchError,
      hasFacetError,
      defaultSearchError,
    };
  }, [
    pageSnapshotKey,
    isAdmin,
    query,
    submittedQuery,
    departmentSearch,
    showWeakestProfilesFirst,
    qualityFilters,
    trustTierFilters,
    selectedSchool,
    selectedDepartment,
    selectedResearchAreas,
    hostsUndergrads,
    selectedCurrentAvailability,
    sortBy,
    sortOrder,
    facetDistribution,
    browseFacetDistribution,
    groupedResults,
    searchResultResearchEntities,
    searchPage,
    searchTotal,
    searchExhausted,
    activeSearchRequest,
    defaultResearchEntities,
    defaultSearchPage,
    defaultSearchTotal,
    defaultSearchExhausted,
    searchError,
    hasFacetError,
    defaultSearchError,
  ]);

  useEffect(() => {
    if (hasSubmittedSearch || defaultSearchPage <= fetchedDefaultSearchPageRef.current) return;
    fetchedDefaultSearchPageRef.current = defaultSearchPage;
    void runDefaultResearchHomeSearchRef.current(defaultSearchPage);
  }, [defaultSearchPage, hasSubmittedSearch]);

  useEffect(() => {
    if (!hasSubmittedSearch || !activeSearchRequest || searchPage <= fetchedSearchPageRef.current) {
      return;
    }
    fetchedSearchPageRef.current = searchPage;
    void runSearchResultsPageRef.current(searchPage);
  }, [activeSearchRequest, hasSubmittedSearch, searchPage]);

  const isZeroResultSearch =
    hasSubmittedSearch &&
    !searchLoading &&
    !searchError &&
    activeSearchRequest !== null &&
    searchResultResearchEntities.length === 0;

  useEffect(() => {
    const relaxedQuery = isZeroResultSearch
      ? relaxResearchQuery(activeSearchRequest?.searchQuery ?? '')
      : null;
    if (!relaxedQuery || !activeSearchRequest) {
      relaxProbeRequestIdRef.current += 1;
      setRelaxedQuerySuggestion(null);
      return;
    }

    const requestId = ++relaxProbeRequestIdRef.current;
    const controller = new AbortController();
    relaxProbeAbortRef.current?.abort();
    relaxProbeAbortRef.current = controller;

    void (async () => {
      try {
        const probe = await searchResearchEntities(
          relaxedQuery,
          1,
          controller.signal,
          activeSearchRequest.filters,
          1,
          activeSearchRequest.options || {},
        );
        if (requestId !== relaxProbeRequestIdRef.current || controller.signal.aborted) return;
        setRelaxedQuerySuggestion(probe.estimatedTotalHits > 0 ? relaxedQuery : null);
      } catch (error) {
        if (
          requestId === relaxProbeRequestIdRef.current &&
          !controller.signal.aborted &&
          !isCancel(error)
        ) {
          setRelaxedQuerySuggestion(null);
        }
      }
    })();

    return () => controller.abort();
  }, [isZeroResultSearch, activeSearchRequest]);

  const activeResults = useMemo(() => groupedResults, [groupedResults]);
  const clusterByEntityRef = useRef(new WeakMap<ResearchEntity, ResearchCluster>());
  const clustersForEntities = useCallback((entities: ResearchEntity[]): ResearchCluster[] => {
    const cache = clusterByEntityRef.current;
    return entities.map((entity) => {
      const cached = cache.get(entity);
      if (cached) return cached;
      const [cluster] = buildGroupedSearchResults({
        query: '',
        researchEntities: [entity],
        pathways: [],
      }).clusters;
      cache.set(entity, cluster);
      return cluster;
    });
  }, []);
  const activeClusters = useMemo(
    () => clustersForEntities(searchResultResearchEntities),
    [clustersForEntities, searchResultResearchEntities],
  );
  const defaultClusters = useMemo(
    () => clustersForEntities(defaultResearchEntities),
    [clustersForEntities, defaultResearchEntities],
  );
  const defaultSentinelRef = useInfiniteScroll({
    searchExhausted: hasSubmittedSearch || defaultSearchExhausted,
    isLoading: defaultSearchLoading,
    setPage: setDefaultSearchPage,
    totalRawCount: defaultSearchTotal,
    filteredCount: defaultResearchEntities.length,
  });
  const searchSentinelRef = useInfiniteScroll({
    searchExhausted: !hasSubmittedSearch || searchExhausted,
    isLoading: searchLoading || isLoadingMore,
    setPage: setSearchPage,
    totalRawCount: searchTotal,
    filteredCount: searchResultResearchEntities.length,
  });
  const hasStudentFacetSelection = Boolean(
    selectedSchool ||
      selectedDepartment ||
      selectedResearchAreas.length ||
      hostsUndergrads ||
      selectedCurrentAvailability.length,
  );
  const hasSubmittableChange = query.trim().length > 0 && query.trim() !== submittedQuery;
  const searchDisabled =
    (query.trim().length === 0 && !hasStudentFacetSelection) ||
    (searchLoading && !hasSubmittableChange);
  const searchHelpText = query.trim()
    ? 'Press Enter or Search to see matching research homes.'
    : hasStudentFacetSelection
      ? 'Search with the selected filters.'
      : 'Enter a topic or name to enable Search.';
  const departmentFacetLabel = (department: string) =>
    getUniqueDepartmentLabels([department], departments)[0] || department;
  const currentAvailabilityFilterLabel = (value: string) =>
    CURRENT_AVAILABILITY_FILTER_LABELS[value as CurrentAvailabilityFilterValue] ?? value;
  const applyStudentFilters = (next: {
    school?: string;
    department?: string;
    researchAreas?: string[];
    hostsUndergrads?: boolean;
    currentAvailability?: CurrentAvailabilityFilterValue[];
  }) => {
    const school = next.school ?? selectedSchool;
    const department = next.department ?? selectedDepartment;
    const areas = next.researchAreas ?? selectedResearchAreas;
    const undergrads = next.hostsUndergrads ?? hostsUndergrads;
    const availability = next.currentAvailability ?? selectedCurrentAvailability;
    const filterChanges: ResearchFilterAnalyticsChange[] = [];
    if (school !== selectedSchool) {
      filterChanges.push({ operation: school ? 'apply' : 'remove', filter: 'school' });
    }
    if (department !== selectedDepartment) {
      filterChanges.push({ operation: department ? 'apply' : 'remove', filter: 'department' });
    }
    if (areas.join(',') !== selectedResearchAreas.join(',')) {
      filterChanges.push({
        operation: areas.length > selectedResearchAreas.length ? 'apply' : 'remove',
        filter: 'research_area',
      });
    }
    if (undergrads !== hostsUndergrads) {
      filterChanges.push({
        operation: undergrads ? 'apply' : 'remove',
        filter: 'hosts_undergrads',
      });
    }
    if (availability.join(',') !== selectedCurrentAvailability.join(',')) {
      filterChanges.push({
        operation: availability.length > selectedCurrentAvailability.length ? 'apply' : 'remove',
        filter: 'current_availability',
      });
    }
    setSelectedSchool(school);
    setSelectedDepartment(department);
    setSelectedResearchAreas(areas);
    setHostsUndergrads(undergrads);
    setSelectedCurrentAvailability(availability);
    const filters = studentSearchFilters(school, department, areas, undergrads, availability);
    if (!query.trim() && !hasStructuredFilters(filters)) {
      filterChanges.forEach((change) => {
        void trackResearchEvent({
          eventType: 'research_filter_change',
          payload: change,
          dedupeKey: createResearchAnalyticsInteractionId('filter'),
        });
      });
      resetSearch();
      return;
    }
    runSearch(query.trim(), {
      filters,
      hasFilterSelections: hasStructuredFilters(filters),
      filterChanges,
      preserveResults: true,
    });
  };
  const applyResearchSort = (nextSortBy: ResearchSortField, nextSortOrder?: 'asc' | 'desc') => {
    const order = nextSortOrder ?? defaultResearchSortOrder(nextSortBy);
    if (nextSortBy === sortBy && order === sortOrder) return;
    sortByRef.current = nextSortBy;
    sortOrderRef.current = order;
    setSortBy(nextSortBy);
    setSortOrder(order);
    if (hasSubmittedSearch && activeSearchRequest) {
      void runSearchRef.current(query.trim(), {
        searchQuery: activeSearchRequest.searchQuery,
        filters: activeSearchRequest.filters,
        hasFilterSelections: hasStructuredFilters(activeSearchRequest.filters),
        departmentSearch,
        preserveResults: true,
        syncUrl: false,
      });
      return;
    }
    setDefaultResearchEntities([]);
    setDefaultSearchPage(1);
    setDefaultSearchTotal(0);
    setDefaultSearchExhausted(false);
    void runDefaultResearchHomeSearchRef.current(1);
  };
  const toggleResearchSortDirection = () =>
    applyResearchSort(sortBy, sortOrder === 'asc' ? 'desc' : 'asc');
  const exploreHome = useCallback(
    (label: string) => {
      scrollResearchViewportToTop();
      const target = departmentSearchTargetByLabel.get(label.toLowerCase());
      if (target) {
        void runSearchRef.current(target.label, {
          searchQuery: '',
          filters: { departments: target.filters.departments },
          hasFilterSelections: true,
          departmentSearch: target,
        });
        return;
      }
      void runSearchRef.current(label);
    },
    [departmentSearchTargetByLabel],
  );
  const toggleQualityFilter = (filter: ResearchQualityFilter) => {
    setQualityFilters((current) => {
      const next = current.includes(filter)
        ? current.filter((value) => value !== filter)
        : [...current, filter];
      writeResearchSearchParams(
        {
          showWeakest: showWeakestProfilesFirst,
          quality: next,
          trustTiers: trustTierFilters,
        },
        { replace: true },
      );
      return next;
    });
  };
  const toggleTrustTierFilter = (filter: ResearchTrustTierFilter) => {
    setTrustTierFilters((current) => {
      const next = current.includes(filter)
        ? current.filter((value) => value !== filter)
        : [...current, filter];
      writeResearchSearchParams(
        {
          showWeakest: showWeakestProfilesFirst,
          quality: qualityFilters,
          trustTiers: next,
        },
        { replace: true },
      );
      return next;
    });
  };
  const setWeakestProfilesFirst = (value: boolean) => {
    setShowWeakestProfilesFirst(value);
    writeResearchSearchParams(
      {
        showWeakest: value,
        quality: value ? qualityFilters : [],
        trustTiers: trustTierFilters,
      },
      { replace: true },
    );
    if (!value && qualityFilters.length > 0) {
      setQualityFilters([]);
    }
  };

  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [isWideFilterLayout, setIsWideFilterLayout] = useState(
    () => window.matchMedia?.('(min-width: 1280px)').matches ?? false,
  );
  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(min-width: 1280px)');
    if (!mediaQuery) return;
    const handleChange = (event: MediaQueryListEvent) => setIsWideFilterLayout(event.matches);
    setIsWideFilterLayout(mediaQuery.matches);
    mediaQuery.addEventListener?.('change', handleChange);
    return () => mediaQuery.removeEventListener?.('change', handleChange);
  }, []);

  const [isCompactViewport, setIsCompactViewport] = useState(
    () => window.matchMedia?.('(max-width: 639px)').matches ?? false,
  );
  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(max-width: 639px)');
    if (!mediaQuery) return;
    const handleChange = (event: MediaQueryListEvent) => setIsCompactViewport(event.matches);
    setIsCompactViewport(mediaQuery.matches);
    mediaQuery.addEventListener?.('change', handleChange);
    return () => mediaQuery.removeEventListener?.('change', handleChange);
  }, []);
  const searchPlaceholder = isCompactViewport
    ? 'Type a topic, professor, or lab'
    : 'Type a topic, professor, lab, or research question';

  const researchFilterProps = {
    facetDistribution,
    selectedSchool,
    selectedDepartment,
    selectedResearchAreas,
    researchAreaOptions,
    hostsUndergrads,
    currentAvailabilityOptions,
    selectedCurrentAvailability,
    isApplying: searchLoading,
    hasFacetError,
    departmentLabel: departmentFacetLabel,
    currentAvailabilityLabel: currentAvailabilityFilterLabel,
    onSchoolChange: (school: string) => applyStudentFilters({ school }),
    onDepartmentChange: (department: string) => applyStudentFilters({ department }),
    onResearchAreasChange: (areas: string[]) => applyStudentFilters({ researchAreas: areas }),
    onHostsUndergradsChange: (value: boolean) => applyStudentFilters({ hostsUndergrads: value }),
    onCurrentAvailabilityChange: (values: string[]) =>
      applyStudentFilters({ currentAvailability: values as CurrentAvailabilityFilterValue[] }),
    onClearAll: () =>
      applyStudentFilters({
        school: '',
        department: '',
        researchAreas: [],
        hostsUndergrads: false,
        currentAvailability: [],
      }),
  };

  const browseFilterProps = {
    ...researchFilterProps,
    facetDistribution: browseFacetDistribution,
    researchAreaOptions: browseResearchAreaOptions,
    currentAvailabilityOptions: browseCurrentAvailabilityOptions,
    isApplying: false,
    hasFacetError: false,
  };

  const activeStudentFilterCount =
    Number(Boolean(selectedSchool)) +
    Number(Boolean(selectedDepartment)) +
    selectedResearchAreas.length +
    Number(hostsUndergrads);
  const researchAreaSuggestions = useMemo(
    () =>
      isZeroResultSearch
        ? suggestCorpusResearchAreas(
            researchAreas,
            activeSearchRequest?.searchQuery ?? '',
            selectedResearchAreas,
            6,
          )
        : [],
    [isZeroResultSearch, researchAreas, activeSearchRequest, selectedResearchAreas],
  );

  const pivotToResearchArea = (area: string) => {
    scrollResearchViewportToTop();
    setQuery('');
    setSelectedSchool('');
    setSelectedDepartment('');
    setSelectedResearchAreas([area]);
    setHostsUndergrads(false);
    void runSearchRef.current('', {
      filters: { researchAreas: [area] },
      hasFilterSelections: true,
      filterChanges: [{ operation: 'apply', filter: 'research_area' }],
    });
  };

  const retryRelaxedQuery = () => {
    if (!relaxedQuerySuggestion) return;
    scrollResearchViewportToTop();
    setQuery(relaxedQuerySuggestion);
    const filters = studentSearchFilters();
    void runSearchRef.current(relaxedQuerySuggestion, {
      filters,
      hasFilterSelections: hasStructuredFilters(filters),
    });
  };

  const browseAllResearchHomes = () => {
    scrollResearchViewportToTop();
    resetSearch();
  };

  return (
    <div className="yr-page min-h-[calc(100vh-8rem)]">
      <div className="mx-auto w-full max-w-screen-2xl px-5 py-5 sm:py-8 lg:px-8">
        <div className="grid gap-5 sm:gap-6 xl:grid-cols-[22rem_minmax(0,1fr)] xl:items-start xl:gap-8">
          <header className="yr-panel rounded-md p-4 sm:p-6 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
            <p className="yr-kicker mb-3">Yale Research</p>
            <h1 className="max-w-3xl text-2xl font-semibold leading-tight tracking-normal text-slate-950 sm:text-4xl">
              Find a Yale lab that fits you.
            </h1>
            <p
              id="research-search-context"
              className={`mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 sm:mt-3 sm:text-base ${
                hasSubmittedSearch ? 'xl:hidden' : ''
              }`}
            >
              Search by interest, professor, course topic, or question. We&apos;ll help you
              find relevant research profiles and verified ways in when the source evidence is
              strong enough.
            </p>

            <form onSubmit={onSubmit} className="mt-4 sm:mt-7">
              <label
                htmlFor="research-search"
                className="mb-2 block text-sm font-semibold text-slate-950"
              >
                Search Yale research
              </label>
              <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
                <input
                  id="research-search"
                  ref={searchInputRef}
                  type="search"
                  value={query}
                  onChange={(event) => {
                    const nextQuery = event.target.value;
                    setQuery(nextQuery);
                    if (!nextQuery.trim() && hasSubmittedSearch) {
                      resetSearch();
                    }
                  }}
                  aria-describedby="research-search-context research-search-help"
                  placeholder={searchPlaceholder}
                  className="min-h-12 min-w-0 flex-1 overflow-hidden text-ellipsis rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-4 text-base text-slate-950 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 sm:min-h-14"
                />
                <button
                  type="submit"
                  className="min-h-12 rounded-md bg-[var(--yr-blue)] px-6 text-sm font-semibold text-white hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:bg-slate-200 disabled:text-slate-700 sm:min-h-14"
                  disabled={searchDisabled}
                >
                  {searchLoading ? 'Searching...' : 'Search'}
                </button>
              </div>
              <p id="research-search-help" className="mt-2 text-sm text-slate-600">
                {searchHelpText}
              </p>
              {!hasSubmittedSearch && (
                <div
                  className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
                  aria-label="Suggested research searches"
                >
                  <span className="yr-kicker text-[0.7rem]">Try a starting point</span>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_START_PROMPTS.map((prompt) => (
                      <button
                        key={prompt.query}
                        type="button"
                        onClick={() => {
                          setQuery(prompt.query);
                          runSearch(prompt.query);
                        }}
                        className="yr-pill yr-pill-blue min-h-[44px] rounded-md px-3 py-2 transition-colors hover:border-blue-300 hover:bg-[var(--yr-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                      >
                        {prompt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </form>

            {hasSubmittedSearch && isWideFilterLayout && (
              <div className="mt-6 border-t border-[var(--yr-line)] pt-6">
                <ResearchFilterDisclosure variant="sidebar" {...researchFilterProps} />
              </div>
            )}
            {!hasSubmittedSearch && isWideFilterLayout && (
              <div className="mt-6 border-t border-[var(--yr-line)] pt-6">
                <ResearchFilterDisclosure variant="sidebar" {...browseFilterProps} />
              </div>
            )}
          </header>

          <div className="min-w-0">
            {!hasSubmittedSearch && (
              <section aria-busy={defaultSearchLoading} aria-label="Research homes to explore">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="w-full">
                    <SectionHeading>Research homes to explore</SectionHeading>
                    <p className="text-sm text-gray-600">
                      Open a profile to review people, evidence, sources, and planning context.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <ResearchSortDropdown
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSortByChange={(field) => applyResearchSort(field)}
                      onToggleSortDirection={toggleResearchSortDirection}
                    />
                    {isAdmin && (
                      <label className="yr-card inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={showWeakestProfilesFirst}
                          onChange={(event) => setWeakestProfilesFirst(event.target.checked)}
                          className="h-4 w-4 rounded border-[var(--yr-line-strong)] text-blue-700 focus:ring-blue-200"
                        />
                        <span>Show weakest profiles first</span>
                      </label>
                    )}
                  </div>
                </div>
                {!isWideFilterLayout && (
                  <div className="sticky top-0 z-30 bg-[var(--yr-paper)] pb-2">
                    <ResearchFilterDisclosure
                      {...browseFilterProps}
                      isOpen={isFilterPanelOpen}
                      onOpenChange={setIsFilterPanelOpen}
                    />
                  </div>
                )}
                {defaultSearchError && (
                  <div
                    role="alert"
                    className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    {defaultSearchError}
                  </div>
                )}
                {isAdmin && showWeakestProfilesFirst && (
                  <div
                    className="yr-muted-surface mb-4 flex flex-wrap gap-2 rounded-md p-2"
                    aria-label="Quality filters"
                  >
                    {QUALITY_FILTER_OPTIONS.map((option) => {
                      const isActive = qualityFilters.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={isActive}
                          onClick={() => toggleQualityFilter(option.value)}
                          className={`min-h-10 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${
                            isActive
                              ? 'border-blue-700 bg-[var(--yr-panel)] text-blue-900'
                              : 'border-[var(--yr-border-warm)] bg-transparent text-slate-700 hover:bg-[var(--yr-panel)]'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {isAdmin && (
                  <div
                    className="mb-4 flex flex-wrap gap-2 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-2"
                    aria-label="Trust tier filters"
                  >
                    {TRUST_TIER_FILTER_OPTIONS.map((option) => {
                      const isActive = trustTierFilters.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={isActive}
                          onClick={() => toggleTrustTierFilter(option.value)}
                          className={`min-h-10 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${
                            isActive
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-[var(--yr-line)] bg-[var(--yr-panel)] text-slate-700 hover:bg-[var(--yr-panel-muted)]'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {defaultSearchLoading && defaultClusters.length === 0 ? (
                  <div className="grid gap-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <ClusterLoadingCard key={index} />
                    ))}
                  </div>
                ) : defaultClusters.length > 0 ? (
                  <div className="grid gap-5">
                    <div>
                      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[repeat(3,minmax(0,1fr))]">
                        {defaultClusters.map((cluster) => (
                          <ResearchHomeCard
                            key={cluster.id}
                            home={cluster}
                            onSelect={exploreHome}
                            variant="compact"
                            showAdminQuality={isAdmin && showWeakestProfilesFirst}
                          />
                        ))}
                      </div>
                      {defaultSearchLoading && defaultClusters.length > 0 && (
                        <InfiniteScrollLoadingDots label="Loading more research homes" />
                      )}
                      {!defaultSearchExhausted && (
                        <div ref={defaultSentinelRef} className="h-10 w-full" />
                      )}
                    </div>
                  </div>
                ) : (
                  <EmptyGroup>
                    No research homes match these filters. Try a broader topic, professor name, lab,
                    or research question.
                  </EmptyGroup>
                )}
              </section>
            )}

            {hasSubmittedSearch && (
              <section aria-busy={searchLoading} aria-label="Search results">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="min-w-0 text-sm font-medium text-slate-700"
                  >
                    {resultSummary(
                      activeResults,
                      submittedQuery,
                      searchLoading,
                      departmentSearch?.label,
                      searchTotal,
                    )}
                  </p>
                  <div className="shrink-0">
                    <ResearchSortDropdown
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSortByChange={(field) => applyResearchSort(field)}
                      onToggleSortDirection={toggleResearchSortDirection}
                    />
                  </div>
                </div>

                {!isWideFilterLayout && (
                  <div className="sticky top-0 z-30 bg-[var(--yr-paper)] pb-2">
                    <ResearchFilterDisclosure
                      {...researchFilterProps}
                      isOpen={isFilterPanelOpen}
                      onOpenChange={setIsFilterPanelOpen}
                    />
                  </div>
                )}

                {searchError && (
                  <div
                    role="alert"
                    className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    {searchError}
                  </div>
                )}

                <section className="mt-5">
                  <SectionHeading>Research profiles</SectionHeading>
                  {searchLoading && activeClusters.length === 0 ? (
                    <div className="grid gap-3">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <ClusterLoadingCard key={index} />
                      ))}
                    </div>
                  ) : activeClusters.length > 0 ? (
                    <>
                      <div
                        aria-busy={isApplyingFilters}
                        className={`grid gap-5 transition-opacity ${
                          isApplyingFilters ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[repeat(3,minmax(0,1fr))]">
                          {activeClusters.map((cluster) => (
                            <ResearchHomeCard
                              key={cluster.id}
                              home={cluster}
                              onSelect={exploreHome}
                              variant="compact"
                            />
                          ))}
                        </div>
                      </div>
                      {isLoadingMore && activeClusters.length > 0 && (
                        <InfiniteScrollLoadingDots label="Loading more research homes" />
                      )}
                      {!searchExhausted && <div ref={searchSentinelRef} className="h-10 w-full" />}
                    </>
                  ) : (
                    <ResearchZeroResultRecovery
                      isDepartmentSearch={Boolean(departmentSearch)}
                      activeFilterCount={activeStudentFilterCount}
                      selectedSchool={selectedSchool}
                      selectedDepartment={selectedDepartment}
                      selectedResearchAreas={selectedResearchAreas}
                      hostsUndergrads={hostsUndergrads}
                      departmentLabel={departmentFacetLabel}
                      onRemoveSchool={() => applyStudentFilters({ school: '' })}
                      onRemoveDepartment={() => applyStudentFilters({ department: '' })}
                      onRemoveResearchArea={(area) =>
                        applyStudentFilters({
                          researchAreas: selectedResearchAreas.filter((value) => value !== area),
                        })
                      }
                      onRemoveHostsUndergrads={() =>
                        applyStudentFilters({ hostsUndergrads: false })
                      }
                      onClearAllFilters={researchFilterProps.onClearAll}
                      relaxedQuery={relaxedQuerySuggestion}
                      onRelaxQuery={retryRelaxedQuery}
                      researchAreaSuggestions={researchAreaSuggestions}
                      onSelectResearchArea={pivotToResearchArea}
                      onBrowseAll={browseAllResearchHomes}
                    />
                  )}
                </section>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const __resetResearchPageSnapshotForTests = () => {
  researchPageSnapshot = null;
};

export default Research;
