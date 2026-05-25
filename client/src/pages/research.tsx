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
import type {
  PathwaySearchFilters,
  PathwaySearchHit,
} from '../types/pathway';

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
}

interface ActiveResearchSearchRequest {
  searchQuery: string;
  filters: ResearchSearchFilters;
  options?: ResearchEntitySearchOptions;
}

interface ResearchPageSnapshot {
  key: string;
  query: string;
  submittedQuery: string;
  departmentSearch: DepartmentSearchTarget | null;
  showWeakestProfilesFirst: boolean;
  qualityFilters: ResearchQualityFilter[];
  trustTierFilters: ResearchTrustTierFilter[];
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
    <h2 className="yr-kicker min-w-0 flex-1">
      {children}
    </h2>
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
  const wayInCount = results.clusters.reduce((sum, cluster) => sum + cluster.pathwayCount, 0);
  if (
    departmentGapLabel &&
    results.clusters.length === 0 &&
    matchingHomeCount === 0 &&
    wayInCount === 0 &&
    results.people.length === 0 &&
    results.papers.length === 0
  ) {
    return `No indexed research homes yet for ${departmentGapLabel}.`;
  }
  const parts = [
    pluralize(matchingHomeCount, 'research home'),
    pluralize(wayInCount, 'way in', 'ways in'),
  ];
  if (results.people.length > 0) {
    parts.push(pluralize(results.people.length, 'contact', 'contacts'));
  }
  if (results.papers.length > 0) {
    parts.push(`${pluralize(results.papers.length, 'paper')} via profiles`);
  }
  return parts.join(', ');
};

const EmptyGroup = ({ children }: { children: string }) => (
  <div className="rounded-md border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-500">
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
  const [searchParams] = useSearchParams();
  const { user } = useContext(UserContext);
  const { departments } = useConfig();
  const isAdmin = user?.userType === 'admin';
  const pageSnapshotKey = searchParams.toString();
  const restoredSnapshotRef = useRef<ResearchPageSnapshot | null>(
    researchPageSnapshot?.key === pageSnapshotKey ? researchPageSnapshot : null,
  );
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
    () => restoredSnapshotRef.current?.showWeakestProfilesFirst ?? false,
  );
  const [qualityFilters, setQualityFilters] = useState<ResearchQualityFilter[]>(
    () => restoredSnapshotRef.current?.qualityFilters ?? [],
  );
  const [trustTierFilters, setTrustTierFilters] = useState<ResearchTrustTierFilter[]>(
    () => restoredSnapshotRef.current?.trustTierFilters ?? [],
  );
  const [groupedResults, setGroupedResults] = useState<GroupedResearchResults>(() =>
    restoredSnapshotRef.current?.groupedResults ?? emptyGroupedResults(''),
  );
  const [searchResultResearchEntities, setSearchResultResearchEntities] = useState<ResearchEntity[]>(
    () => restoredSnapshotRef.current?.searchResultResearchEntities ?? [],
  );
  const [searchPage, setSearchPage] = useState(() => restoredSnapshotRef.current?.searchPage ?? 1);
  const [searchTotal, setSearchTotal] = useState(() => restoredSnapshotRef.current?.searchTotal ?? 0);
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

  useDocumentTitle('Yale Research');

  useEffect(() => () => {
    searchAbortRef.current?.abort();
    defaultSearchAbortRef.current?.abort();
  }, []);

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

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runSearch(query.trim());
  };

  const resetSearch = () => {
    searchAbortRef.current?.abort();
    searchRequestIdRef.current += 1;
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
    setDefaultSearchExhausted(false);
    setDefaultSearchPage(1);
    if (defaultResearchEntities.length === 0) {
      setDefaultSearchTotal(0);
      runDefaultResearchHomeSearch(1);
    }
  };

  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    const syncKey = `${pageSnapshotKey}|${String(isAdmin)}|${String(showWeakestProfilesFirst)}|${qualityFilters.join(',')}|${trustTierFilters.join(',')}`;

    if (restoredSnapshotSyncKeyRef.current === syncKey) {
      restoredSnapshotRef.current = null;
      return;
    }

    if (urlQuery.trim()) {
      runSearch(urlQuery);
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
  }, [searchParams, pageSnapshotKey, isAdmin, showWeakestProfilesFirst, qualityFilters, trustTierFilters]);

  useEffect(() => {
    researchPageSnapshot = {
      key: pageSnapshotKey,
      query,
      submittedQuery,
      departmentSearch,
      showWeakestProfilesFirst,
      qualityFilters,
      trustTierFilters,
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

  const hasSubmittedSearch = submittedQuery.trim().length > 0;

  useEffect(() => {
    if (hasSubmittedSearch || defaultSearchPage <= 1) return;
    runDefaultResearchHomeSearch(defaultSearchPage);
  }, [defaultSearchPage, hasSubmittedSearch]);

  useEffect(() => {
    if (!hasSubmittedSearch || searchPage <= 1 || !activeSearchRequest) return;
    runSearchResultsPage(searchPage);
  }, [activeSearchRequest, hasSubmittedSearch, searchPage]);

  const activeResults = useMemo(
    () => groupedResults,
    [groupedResults],
  );
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
  const departmentSearchTargets = useMemo(
    () => buildDepartmentSearchTargets(departments),
    [departments],
  );
  const departmentSearchTargetByLabel = useMemo(
    () =>
      new Map(
        departmentSearchTargets.map((target) => [target.label.toLowerCase(), target]),
      ),
    [departmentSearchTargets],
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
  const searchDisabled = searchLoading || query.trim().length === 0;
  const searchHelpText = query.trim()
    ? 'Press Enter or Search to see matching research homes.'
    : 'Enter a topic or name to enable Search.';
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
    setQualityFilters((current) =>
      current.includes(filter)
        ? current.filter((value) => value !== filter)
        : [...current, filter],
    );
  };
  const toggleTrustTierFilter = (filter: ResearchTrustTierFilter) => {
    setTrustTierFilters((current) =>
      current.includes(filter)
        ? current.filter((value) => value !== filter)
        : [...current, filter],
    );
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
            <label htmlFor="research-search" className="mb-2 block text-sm font-semibold text-slate-950">
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
                className="min-h-12 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 sm:min-h-14"
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
              <span className="yr-kicker text-[0.7rem]">
                Try a starting point
              </span>
              <div className="flex flex-wrap gap-2">
                {QUICK_START_PROMPTS.map((prompt) => (
                  <button
                    key={prompt.query}
                    type="button"
                    onClick={() => {
                      setQuery(prompt.query);
                      runSearch(prompt.query);
                    }}
                    className="yr-pill yr-pill-blue min-h-[44px] rounded-md px-3 py-2 transition-colors hover:border-blue-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
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
                  Open a profile to see people, evidence, sources, and possible ways in.
                </p>
              </div>
              {defaultSearchTotal > 0 && (
                <span className="yr-pill yr-pill-blue shrink-0 rounded-md px-3 py-2">
                  {defaultSearchTotal.toLocaleString()} indexed profiles
                </span>
              )}
              {isAdmin && (
                <label className="yr-card inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={showWeakestProfilesFirst}
                    onChange={(event) => setShowWeakestProfilesFirst(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-200"
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
                className="mb-4 flex flex-wrap gap-2 rounded-md border border-blue-100 bg-blue-50/70 p-2"
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
                          ? 'border-blue-700 bg-white text-blue-900'
                          : 'border-blue-100 bg-transparent text-slate-700 hover:bg-white'
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
                className="mb-4 flex flex-wrap gap-2 rounded-md border border-slate-200 bg-white p-2"
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
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
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
                  {!defaultSearchExhausted && <div ref={defaultSentinelRef} className="h-10 w-full" />}
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
