import { FormEvent, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isCancel } from 'axios';
import { useSearchParams } from 'react-router-dom';

import ResearchHomeCard from '../components/research/ResearchHomeCard';
import InfiniteScrollLoadingDots from '../components/shared/InfiniteScrollLoadingDots';
import LabPapersList from '../components/labs/LabPapersList';
import UserContext from '../contexts/UserContext';
import useConfig from '../hooks/useConfig';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import axios from '../utils/axios';
import {
  buildGroupedSearchResults,
  GroupedResearchResults,
} from '../utils/researchDiscoveryAdapters';
import {
  normalizeResearchEntitySearchResponse,
  ResearchEntity,
  ResearchEntitySearchResponse,
  StudentVisibilityTier,
} from '../types/researchEntity';
import { getUniqueDepartmentLabels } from '../utils/departmentNames';
import useDocumentTitle from '../hooks/useDocumentTitle';
import type { PathwaySearchFilters, PathwaySearchHit } from '../types/pathway';

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

type ResearchSearchFilters = PathwaySearchFilters & {
  kind?: string[];
  school?: string[];
  openness?: string[];
  acceptanceLevel?: 'verified' | 'verified-or-likely' | 'all';
};

type ResearchQualityFilter = 'description-issue' | 'missing-lead' | 'profile-fallback';
type ResearchTrustTierFilter = StudentVisibilityTier;

const DEFAULT_RESEARCH_HOME_LABEL = 'all Yale research';
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

const emptyGroupedResults = (query: string): GroupedResearchResults =>
  buildGroupedSearchResults({
    query,
    researchEntities: [],
    pathways: [],
    papers: [],
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
  requireUndergradEvidence: boolean;
  facetDistribution: Record<string, Record<string, number>>;
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
  defaultSearchError: string;
}

interface ResearchEntitySearchOptions {
  lowQualityFirst?: boolean;
  qualityFilters?: ResearchQualityFilter[];
  trustTierFilters?: ResearchTrustTierFilter[];
  includeSuppressed?: boolean;
}

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

const waysInFromResearchEntities = (researchEntities: ResearchEntity[]): PathwaySearchHit[] =>
  researchEntities.flatMap((entity) => (Array.isArray(entity.waysIn) ? entity.waysIn : []));

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
): string => {
  if (loading) return `Searching Yale Research for ${query}.`;
  const matchingHomeCount = results.clusters.length;
  if (
    departmentGapLabel &&
    results.clusters.length === 0 &&
    matchingHomeCount === 0 &&
    results.people.length === 0 &&
    results.papers.length === 0
  ) {
    return `No indexed research homes yet for ${departmentGapLabel}.`;
  }
  const parts = [pluralize(matchingHomeCount, 'research home')];
  if (results.people.length > 0) {
    parts.push(pluralize(results.people.length, 'contact', 'contacts'));
  }
  if (results.papers.length > 0) {
    parts.push(`${pluralize(results.papers.length, 'paper')} via profiles`);
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useContext(UserContext);
  const { departments } = useConfig();
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
  const [requireUndergradEvidence, setRequireUndergradEvidence] = useState(
    () =>
      restoredSnapshotRef.current?.requireUndergradEvidence ??
      searchParams.get('undergrad') === '1',
  );
  const [facetDistribution, setFacetDistribution] = useState<
    Record<string, Record<string, number>>
  >(() => restoredSnapshotRef.current?.facetDistribution ?? {});
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
  const [searchLoading, setSearchLoading] = useState(false);
  const [defaultSearchLoading, setDefaultSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(
    () => restoredSnapshotRef.current?.searchError ?? '',
  );
  const [defaultSearchError, setDefaultSearchError] = useState(
    () => restoredSnapshotRef.current?.defaultSearchError ?? '',
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchRequestIdRef = useRef(0);
  const defaultSearchRequestIdRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const defaultSearchAbortRef = useRef<AbortController | null>(null);
  const restoredSnapshotSyncKeyRef = useRef(
    restoredSnapshotRef.current
      ? `${pageSnapshotKey}|${String(isAdmin)}|${String(showWeakestProfilesFirst)}|${qualityFilters.join(',')}|${trustTierFilters.join(',')}`
      : null,
  );
  const departmentSearchTargets = useMemo(
    () => buildDepartmentSearchTargets(departments),
    [departments],
  );
  const departmentSearchTargetByLabel = useMemo(
    () => new Map(departmentSearchTargets.map((target) => [target.label.toLowerCase(), target])),
    [departmentSearchTargets],
  );

  useDocumentTitle('Yale Research');

  const writeResearchSearchParams = (
    nextState: {
      query?: string;
      departmentLabel?: string | null;
      showWeakest?: boolean;
      quality?: ResearchQualityFilter[];
      trustTiers?: ResearchTrustTierFilter[];
      school?: string;
      department?: string;
      requireUndergradEvidence?: boolean;
    },
    options: { replace?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    const nextQuery = (nextState.query || '').trim();
    if (nextQuery) params.set('q', nextQuery);
    const departmentLabel = (nextState.departmentLabel || '').trim();
    if (departmentLabel) params.set('dept', departmentLabel);
    if (nextState.school?.trim()) params.set('school', nextState.school.trim());
    if (nextState.department?.trim()) params.set('department', nextState.department.trim());
    if (nextState.requireUndergradEvidence) params.set('undergrad', '1');

    if (isAdmin) {
      if (nextState.showWeakest) params.set('weak', '1');
      if (nextState.quality?.length) params.set('quality', nextState.quality.join(','));
      if (nextState.trustTiers?.length) params.set('tier', nextState.trustTiers.join(','));
    }

    setSearchParams(params, { replace: Boolean(options.replace) });
  };

  useEffect(
    () => () => {
      searchAbortRef.current?.abort();
      defaultSearchAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (isAdmin) return;
    if (showWeakestProfilesFirst) setShowWeakestProfilesFirst(false);
    if (qualityFilters.length > 0) setQualityFilters([]);
    if (trustTierFilters.length > 0) setTrustTierFilters([]);
  }, [isAdmin, showWeakestProfilesFirst, qualityFilters.length, trustTierFilters.length]);

  const runDefaultResearchHomeSearch = async (page = 1) => {
    const requestId = ++defaultSearchRequestIdRef.current;
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
        },
      );

      if (requestId !== defaultSearchRequestIdRef.current || controller.signal.aborted) return;

      const researchEntities = researchEntitiesPage.researchEntities;

      setDefaultResearchEntities((current) =>
        page === 1 ? researchEntities : [...current, ...researchEntities],
      );
      setDefaultSearchTotal(researchEntitiesPage.estimatedTotalHits);
      setDefaultSearchExhausted(isResearchEntitySearchExhausted(researchEntitiesPage));
      setDefaultSearchError('');
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
    } = {},
  ) => {
    defaultSearchAbortRef.current?.abort();
    const trimmed = nextQuery.trim();
    const searchQuery = options.searchQuery ?? trimmed;
    const filters = options.filters ?? {};
    const hasFilters = hasStructuredFilters(filters) || Boolean(options.hasFilterSelections);
    if (!trimmed && !hasFilters) return;
    if (!searchQuery.trim() && !hasFilters) return;
    const resultQueryLabel = trimmed || 'filtered research';

    const requestId = ++searchRequestIdRef.current;
    const controller = new AbortController();
    searchAbortRef.current?.abort();
    searchAbortRef.current = controller;

    setDefaultSearchExhausted(true);
    setSearchPage(1);
    setSearchTotal(0);
    setSearchExhausted(false);
    setSearchResultResearchEntities([]);
    setActiveSearchRequest({
      searchQuery: searchQuery.trim(),
      filters,
      options: {
        trustTierFilters: isAdmin ? trustTierFilters : [],
        includeSuppressed: isAdmin && trustTierFilters.includes('suppressed'),
      },
    });
    setQuery(trimmed);
    setSubmittedQuery(resultQueryLabel);
    setDepartmentSearch(options.departmentSearch ?? null);
    setSearchLoading(true);
    setSearchError('');
    setGroupedResults(emptyGroupedResults(resultQueryLabel));
    if (options.syncUrl !== false) {
      writeResearchSearchParams({
        query: trimmed,
        departmentLabel: options.departmentSearch?.label,
        school: filters.school?.[0],
        department: filters.departments?.[0],
        requireUndergradEvidence: filters.acceptanceLevel === 'verified-or-likely',
        showWeakest: showWeakestProfilesFirst,
        quality: qualityFilters,
        trustTiers: trustTierFilters,
      });
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
        },
      );

      if (requestId !== searchRequestIdRef.current || controller.signal.aborted) return;

      const researchEntities = researchEntitiesPage.researchEntities;
      const pathways = waysInFromResearchEntities(researchEntities);

      setSearchError('');
      setSearchResultResearchEntities(researchEntities);
      setSearchTotal(researchEntitiesPage.estimatedTotalHits);
      setFacetDistribution(researchEntitiesPage.facetDistribution);
      setSearchExhausted(isResearchEntitySearchExhausted(researchEntitiesPage));

      setGroupedResults(
        buildGroupedSearchResults({
          query: resultQueryLabel,
          researchEntities,
          pathways,
          papers: [],
        }),
      );
    } catch (error) {
      if (
        requestId === searchRequestIdRef.current &&
        !controller.signal.aborted &&
        !isCancel(error)
      ) {
        setSearchError(
          'Live search metadata is unavailable right now. Try another topic or check back soon.',
        );
        setSearchExhausted(true);
      }
    } finally {
      if (requestId === searchRequestIdRef.current && !controller.signal.aborted) {
        setSearchLoading(false);
      }
    }
  };

  const runSearchResultsPage = async (page: number) => {
    if (!activeSearchRequest) return;
    const requestId = ++searchRequestIdRef.current;
    const controller = new AbortController();
    searchAbortRef.current?.abort();
    searchAbortRef.current = controller;

    setSearchLoading(true);

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
        setGroupedResults(
          buildGroupedSearchResults({
            query: submittedQuery,
            researchEntities: nextResearchEntities,
            pathways: waysInFromResearchEntities(nextResearchEntities),
            papers: [],
          }),
        );
        return nextResearchEntities;
      });
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
        setSearchLoading(false);
      }
    }
  };

  const studentSearchFilters = (
    school = selectedSchool,
    department = selectedDepartment,
    undergradEvidence = requireUndergradEvidence,
  ): ResearchSearchFilters => ({
    ...(school ? { school: [school] } : {}),
    ...(department ? { departments: [department] } : {}),
    ...(undergradEvidence ? { acceptanceLevel: 'verified-or-likely' as const } : {}),
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
    setRequireUndergradEvidence(false);
    setFacetDistribution({});
    setGroupedResults(emptyGroupedResults(''));
    setSearchResultResearchEntities([]);
    setSearchPage(1);
    setSearchTotal(0);
    setSearchExhausted(true);
    setActiveSearchRequest(null);
    setSearchError('');
    setSearchLoading(false);
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
    const urlQuery = searchParams.get('q') || '';
    const urlDepartmentLabel = searchParams.get('dept') || '';
    const urlSchool = searchParams.get('school') || '';
    const urlDepartment = searchParams.get('department') || '';
    const urlRequiresUndergradEvidence = searchParams.get('undergrad') === '1';
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
    if (requireUndergradEvidence !== urlRequiresUndergradEvidence) {
      setRequireUndergradEvidence(urlRequiresUndergradEvidence);
      return;
    }

    const studentFilters: ResearchSearchFilters = {
      ...(urlSchool ? { school: [urlSchool] } : {}),
      ...(urlDepartment ? { departments: [urlDepartment] } : {}),
      ...(urlRequiresUndergradEvidence ? { acceptanceLevel: 'verified-or-likely' as const } : {}),
    };

    const urlDepartmentSearch = urlDepartmentLabel
      ? (departmentSearchTargetByLabel.get(urlDepartmentLabel.toLowerCase()) ?? null)
      : null;

    if (urlDepartmentSearch) {
      if (departmentSearch?.label === urlDepartmentSearch.label && hasSubmittedSearch) {
        return;
      }
      runSearch(urlDepartmentSearch.label, {
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
      runSearch(urlQuery, { filters: studentFilters, syncUrl: false });
      return;
    }

    if (hasStructuredFilters(studentFilters)) {
      if (
        submittedQuery === 'filtered research' &&
        JSON.stringify(activeSearchRequest?.filters || {}) === JSON.stringify(studentFilters)
      ) {
        return;
      }
      runSearch('', {
        filters: studentFilters,
        hasFilterSelections: true,
        syncUrl: false,
      });
      return;
    }

    setQuery('');
    setSubmittedQuery('');
    setDepartmentSearch(null);
    setGroupedResults(emptyGroupedResults(''));
    setSearchResultResearchEntities([]);
    setSearchPage(1);
    setSearchTotal(0);
    setSearchExhausted(true);
    setActiveSearchRequest(null);
    setSearchError('');
    setSearchLoading(false);
    setDefaultResearchEntities([]);
    setDefaultSearchTotal(0);
    setDefaultSearchExhausted(false);
    setDefaultSearchPage(1);
    runDefaultResearchHomeSearch(1);
  }, [
    searchParams,
    pageSnapshotKey,
    isAdmin,
    showWeakestProfilesFirst,
    qualityFilters,
    trustTierFilters,
    selectedSchool,
    selectedDepartment,
    requireUndergradEvidence,
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
      requireUndergradEvidence,
      facetDistribution,
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
      defaultSearchError,
    };
  }, [
    pageSnapshotKey,
    query,
    submittedQuery,
    departmentSearch,
    showWeakestProfilesFirst,
    qualityFilters,
    trustTierFilters,
    selectedSchool,
    selectedDepartment,
    requireUndergradEvidence,
    facetDistribution,
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
    defaultSearchError,
  ]);

  useEffect(() => {
    if (hasSubmittedSearch || defaultSearchPage <= 1) return;
    runDefaultResearchHomeSearch(defaultSearchPage);
  }, [defaultSearchPage, hasSubmittedSearch]);

  useEffect(() => {
    if (!hasSubmittedSearch || searchPage <= 1 || !activeSearchRequest) return;
    runSearchResultsPage(searchPage);
  }, [activeSearchRequest, hasSubmittedSearch, searchPage]);

  const activeResults = useMemo(() => groupedResults, [groupedResults]);
  const defaultGroupedResults = useMemo(
    () =>
      buildGroupedSearchResults({
        query: DEFAULT_RESEARCH_HOME_LABEL,
        researchEntities: defaultResearchEntities,
        pathways: waysInFromResearchEntities(defaultResearchEntities),
        papers: [],
      }),
    [defaultResearchEntities],
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
    isLoading: searchLoading,
    setPage: setSearchPage,
    totalRawCount: searchTotal,
    filteredCount: searchResultResearchEntities.length,
  });
  const hasStudentFacetSelection = Boolean(
    selectedSchool || selectedDepartment || requireUndergradEvidence,
  );
  const searchDisabled = searchLoading || (query.trim().length === 0 && !hasStudentFacetSelection);
  const searchHelpText = query.trim()
    ? 'Press Enter or Search to see matching research homes.'
    : hasStudentFacetSelection
      ? 'Search with the selected filters.'
      : 'Enter a topic or name to enable Search.';
  const schoolOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...Object.keys(facetDistribution.school || {}),
          ...(selectedSchool ? [selectedSchool] : []),
        ]),
      ).sort((a, b) => a.localeCompare(b)),
    [facetDistribution.school, selectedSchool],
  );
  const departmentOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...Object.keys(facetDistribution.departments || {}),
          ...(selectedDepartment ? [selectedDepartment] : []),
        ]),
      ).sort((a, b) => a.localeCompare(b)),
    [facetDistribution.departments, selectedDepartment],
  );
  const applyStudentFacets = (school: string, department: string, undergradEvidence: boolean) => {
    setSelectedSchool(school);
    setSelectedDepartment(department);
    setRequireUndergradEvidence(undergradEvidence);
    const filters = studentSearchFilters(school, department, undergradEvidence);
    if (!query.trim() && !hasStructuredFilters(filters)) {
      resetSearch();
      return;
    }
    runSearch(query.trim(), {
      filters,
      hasFilterSelections: hasStructuredFilters(filters),
    });
  };
  const runDepartmentSearch = (target: DepartmentSearchTarget) =>
    runSearch(target.label, {
      searchQuery: '',
      filters: { departments: target.filters.departments },
      hasFilterSelections: true,
      departmentSearch: target,
    });
  const exploreHome = (label: string) => {
    scrollResearchViewportToTop();
    const target = departmentSearchTargetByLabel.get(label.toLowerCase());
    if (target) {
      runDepartmentSearch(target);
      return;
    }
    runSearch(label);
  };
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

  return (
    <div className="yr-page min-h-[calc(100vh-8rem)]">
      <div className="mx-auto w-full max-w-screen-2xl px-5 py-5 sm:py-8 lg:px-8">
        <div className="grid gap-5 sm:gap-6 2xl:grid-cols-[22rem_minmax(0,1fr)] 2xl:items-start 2xl:gap-8">
          <header className="yr-panel rounded-md p-4 sm:p-6 2xl:sticky 2xl:top-6">
            <p className="yr-kicker mb-3">Yale Research</p>
            <h1 className="max-w-3xl text-2xl font-semibold leading-tight tracking-normal text-slate-950 sm:text-4xl">
              Find a Yale lab that fits you.
            </h1>
            <p
              id="research-search-context"
              className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 sm:mt-3 sm:text-base"
            >
              Search by interest, professor, course topic, method, or question. We&apos;ll help you
              find relevant research profiles and possible next steps.
            </p>

            <form onSubmit={onSubmit} className="mt-4 sm:mt-7">
              <label
                htmlFor="research-search"
                className="mb-2 block text-sm font-semibold text-slate-950"
              >
                Search Yale research
              </label>
              <div className="flex flex-col gap-2 sm:flex-row 2xl:flex-col">
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
                  placeholder="Type a topic, professor, lab, method, or research question"
                  className="min-h-12 min-w-0 flex-1 rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-4 text-base text-slate-950 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 sm:min-h-14"
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
            </form>
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
                {defaultSearchLoading && defaultGroupedResults.clusters.length === 0 ? (
                  <div className="grid gap-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <ClusterLoadingCard key={index} />
                    ))}
                  </div>
                ) : defaultGroupedResults.clusters.length > 0 ? (
                  <div className="grid gap-5">
                    <div>
                      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[repeat(3,minmax(0,1fr))]">
                        {defaultGroupedResults.clusters.map((cluster) => (
                          <ResearchHomeCard
                            key={cluster.id}
                            home={cluster}
                            onSelect={exploreHome}
                            variant="compact"
                            showAdminQuality={isAdmin && showWeakestProfilesFirst}
                          />
                        ))}
                      </div>
                      {defaultSearchLoading && defaultGroupedResults.clusters.length > 0 && (
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
                    method, or research question.
                  </EmptyGroup>
                )}
              </section>
            )}

            {hasSubmittedSearch && (
              <section aria-busy={searchLoading} aria-label="Search results">
                <div className="yr-card rounded-md p-4 md:flex md:items-center md:justify-between md:gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">
                      Showing research matches for &apos;{submittedQuery}&apos;
                    </h2>
                    <p
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                      className="mt-1 text-sm text-slate-600"
                    >
                      {resultSummary(
                        activeResults,
                        submittedQuery,
                        searchLoading,
                        departmentSearch?.label,
                      )}
                    </p>
                  </div>
                </div>

                <fieldset className="mt-3 border-0 p-0">
                  <legend className="sr-only">Narrow research results</legend>
                  <div className="grid gap-4 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] xl:items-end">
                    <label className="block text-sm font-medium text-slate-800">
                      School
                      <select
                        aria-label="Filter by school"
                        value={selectedSchool}
                        onChange={(event) =>
                          applyStudentFacets(
                            event.target.value,
                            selectedDepartment,
                            requireUndergradEvidence,
                          )
                        }
                        className="mt-1 min-h-11 w-full rounded-md border border-[var(--yr-line-strong)] bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                      >
                        <option value="">All schools</option>
                        {schoolOptions.map((school) => (
                          <option key={school} value={school}>
                            {school} ({facetDistribution.school?.[school] ?? searchTotal})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm font-medium text-slate-800">
                      Department
                      <select
                        aria-label="Filter by department"
                        value={selectedDepartment}
                        onChange={(event) =>
                          applyStudentFacets(
                            selectedSchool,
                            event.target.value,
                            requireUndergradEvidence,
                          )
                        }
                        className="mt-1 min-h-11 w-full rounded-md border border-[var(--yr-line-strong)] bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                      >
                        <option value="">All departments</option>
                        {departmentOptions.map((department) => (
                          <option key={department} value={department}>
                            {getUniqueDepartmentLabels([department], departments)[0] || department}{' '}
                            ({facetDistribution.departments?.[department] ?? searchTotal})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--yr-line)] bg-white px-3 py-2 text-sm font-medium text-slate-800">
                      <input
                        type="checkbox"
                        checked={requireUndergradEvidence}
                        onChange={(event) =>
                          applyStudentFacets(
                            selectedSchool,
                            selectedDepartment,
                            event.target.checked,
                          )
                        }
                        className="h-4 w-4 rounded border-[var(--yr-line-strong)] text-blue-700 focus:ring-blue-200"
                      />
                      Has undergraduate evidence
                    </label>
                    {hasStudentFacetSelection && (
                      <button
                        type="button"
                        onClick={() => applyStudentFacets('', '', false)}
                        className="min-h-11 rounded-md border border-[var(--yr-line-strong)] bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </fieldset>

                {searchError && (
                  <div
                    role="alert"
                    className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    {searchError}
                  </div>
                )}

                <section className="mt-5">
                  <SectionHeading>Research homes</SectionHeading>
                  {searchLoading && activeResults.clusters.length === 0 ? (
                    <div className="grid gap-3">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <ClusterLoadingCard key={index} />
                      ))}
                    </div>
                  ) : activeResults.clusters.length > 0 ? (
                    <>
                      <div className="grid gap-5">
                        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[repeat(3,minmax(0,1fr))]">
                          {activeResults.clusters.map((cluster) => (
                            <ResearchHomeCard
                              key={cluster.id}
                              home={cluster}
                              onSelect={exploreHome}
                              variant="compact"
                            />
                          ))}
                        </div>
                      </div>
                      {searchLoading && activeResults.clusters.length > 0 && (
                        <InfiniteScrollLoadingDots label="Loading more research homes" />
                      )}
                      {!searchExhausted && <div ref={searchSentinelRef} className="h-10 w-full" />}
                    </>
                  ) : (
                    <EmptyGroup>
                      {departmentSearch
                        ? 'This is a data coverage gap, not proof that the department has no undergraduate research. Try a topic, method, professor, or adjacent department while this department is being seeded.'
                        : 'No indexed research homes matched this search yet. Try a broader topic, related method, professor, or adjacent department while coverage improves.'}
                    </EmptyGroup>
                  )}
                </section>

                {activeResults.papers.length > 0 && (
                  <section className="mt-5">
                    <SectionHeading>Papers via profiles</SectionHeading>
                    <LabPapersList
                      papers={activeResults.papers}
                      emptyText="No related profile papers matched this search yet."
                    />
                  </section>
                )}
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
