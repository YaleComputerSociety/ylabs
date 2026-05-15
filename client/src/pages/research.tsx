import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { isCancel } from 'axios';

import IdentityConfidenceCard from '../components/research/IdentityConfidenceCard';
import PathwayActionCard from '../components/research/PathwayActionCard';
import ResearchHomeCard from '../components/research/ResearchHomeCard';
import axios from '../utils/axios';
import {
  buildDynamicSearchSuggestions,
  buildGroupedSearchResults,
  buildMetadataClusters,
  GroupedResearchResults,
  ResearchCluster,
} from '../utils/researchDiscoveryAdapters';
import {
  normalizeResearchEntitySearchResponse,
  ResearchEntity,
  ResearchEntitySearchResponse,
} from '../types/researchEntity';
import type { PathwaySearchHit, PathwaySearchResponse } from '../types/pathway';

const SUGGESTED_SEARCH_FALLBACK = [
  'machine learning',
  'mechanism design',
  'neuroscience',
  'protein folding',
];
const HOME_QUERIES = ['machine learning', 'mechanism design', 'neuroscience'];

interface HomeClusterRow {
  query: string;
  clusters: ResearchCluster[];
  loading: boolean;
  error?: string;
}

const emptyGroupedResults = (query: string): GroupedResearchResults =>
  buildGroupedSearchResults({
    query,
    researchEntities: [],
    pathways: [],
    papers: [],
  });

const initialHomeRows = (): HomeClusterRow[] =>
  HOME_QUERIES.map((query) => ({
    query,
    clusters: [],
    loading: true,
  }));

const searchResearchEntities = async (
  q: string,
  pageSize = 18,
  signal?: AbortSignal,
): Promise<ResearchEntity[]> => {
  const response = await axios.post<ResearchEntitySearchResponse>(
    '/research/search',
    {
      q,
      page: 1,
      pageSize,
      filters: {},
    },
    { signal },
  );
  const normalized = normalizeResearchEntitySearchResponse(response.data);
  return normalized.researchEntities || [];
};

const searchPathways = async (q: string, signal?: AbortSignal): Promise<PathwaySearchHit[]> => {
  const response = await axios.post<PathwaySearchResponse>(
    '/pathways/search',
    {
      q,
      page: 1,
      pageSize: 8,
      filters: {},
      sortBy: 'relevance',
      sortOrder: 'desc',
    },
    { signal },
  );
  const hits = response.data.hits || [];
  return Array.isArray(hits) ? hits : [];
};

const SectionHeading = ({
  children,
  count,
}: {
  children: string;
  count?: number;
}) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </h2>
    {typeof count === 'number' && (
      <span className="text-xs text-gray-500">{count.toLocaleString()}</span>
    )}
  </div>
);

const ClusterLoadingCard = () => (
  <div className="rounded-md border border-gray-200 bg-white p-4">
    <div className="h-3 w-2/3 rounded bg-gray-100" />
    <div className="mt-3 h-2 w-full rounded bg-gray-100" />
    <div className="mt-2 h-2 w-5/6 rounded bg-gray-100" />
    <p className="mt-4 text-xs text-gray-400">Loading research homes</p>
  </div>
);

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count.toLocaleString()} ${count === 1 ? singular : plural}`;

const resultSummary = (
  results: GroupedResearchResults,
  query: string,
  loading: boolean,
): string => {
  if (loading) return `Searching Yale Research for ${query}.`;
  const parts = [
    pluralize(results.clusters.length, 'research home'),
    pluralize(results.pathways.length, 'next-step pathway'),
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
  <div className="rounded-md border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-500">
    {children}
  </div>
);

const Research = () => {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [homeRows, setHomeRows] = useState<HomeClusterRow[]>(() => initialHomeRows());
  const [groupedResults, setGroupedResults] = useState<GroupedResearchResults>(() =>
    emptyGroupedResults(''),
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchRequestIdRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Yale Research';

    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;

    let cancelled = false;
    const rowControllers = HOME_QUERIES.map(() => new AbortController());
    setHomeRows((rows) => rows.map((row) => ({ ...row, loading: true, error: undefined })));

    Promise.all(
      HOME_QUERIES.map(async (homeQuery, index) => {
        try {
          const entities = await searchResearchEntities(homeQuery, 12, rowControllers[index].signal);
          const clusters = buildMetadataClusters(entities, { limit: 3 });
          return {
            query: homeQuery,
            clusters,
            loading: false,
            error: clusters.length > 0 ? undefined : 'No matching research homes are available yet.',
          };
        } catch {
          if (rowControllers[index].signal.aborted) {
            return {
              query: homeQuery,
              clusters: [],
              loading: false,
              error: undefined,
            };
          }

          return {
            query: homeQuery,
            clusters: [],
            loading: false,
            error: 'Live research-home metadata is unavailable right now.',
          };
        }
      }),
    ).then((rows) => {
      if (!cancelled) setHomeRows(rows);
    });

    return () => {
      cancelled = true;
      rowControllers.forEach((controller) => controller.abort());
    };
  }, []);

  useEffect(() => () => {
    searchAbortRef.current?.abort();
  }, []);

  const runSearch = async (nextQuery: string) => {
    const trimmed = nextQuery.trim();
    if (!trimmed) return;

    const requestId = ++searchRequestIdRef.current;
    const controller = new AbortController();
    searchAbortRef.current?.abort();
    searchAbortRef.current = controller;

    setQuery(trimmed);
    setSubmittedQuery(trimmed);
    setSearchLoading(true);
    setSearchError('');
    setGroupedResults(emptyGroupedResults(trimmed));

    try {
      const [researchEntitiesResult, pathwaysResult] = await Promise.allSettled([
        searchResearchEntities(trimmed, 24, controller.signal),
        searchPathways(trimmed, controller.signal),
      ]);

      if (requestId !== searchRequestIdRef.current || controller.signal.aborted) return;

      const researchEntities =
        researchEntitiesResult.status === 'fulfilled' ? researchEntitiesResult.value : [];
      const pathways = pathwaysResult.status === 'fulfilled' ? pathwaysResult.value : [];
      const failures: string[] = [];

      if (researchEntitiesResult.status === 'rejected' && !isCancel(researchEntitiesResult.reason)) {
        failures.push('research metadata');
      }
      if (pathwaysResult.status === 'rejected' && !isCancel(pathwaysResult.reason)) {
        failures.push('pathway');
      }

      if (failures.length === 2) {
        setSearchError('Search metadata is unavailable for both research and pathways queries.');
      } else if (failures.length === 1) {
        setSearchError(
          `${failures[0] === 'research metadata' ? 'Research metadata' : 'Pathway'} search is temporarily unavailable.`,
        );
      } else {
        setSearchError('');
      }

      setGroupedResults(
        buildGroupedSearchResults({
          query: trimmed,
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
      }
    } finally {
      if (requestId === searchRequestIdRef.current && !controller.signal.aborted) {
        setSearchLoading(false);
      }
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runSearch(query);
  };

  const activeResults = useMemo(
    () => groupedResults,
    [groupedResults],
  );
  const suggestedSearches = useMemo(
    () =>
      buildDynamicSearchSuggestions(
        homeRows.flatMap((row) =>
          row.clusters.flatMap((cluster) => cluster.entities),
        ),
        {
          fallback: SUGGESTED_SEARCH_FALLBACK,
          limit: 4,
        },
      ),
    [homeRows],
  );
  const hasSubmittedSearch = submittedQuery.trim().length > 0;
  const searchDisabled = searchLoading || query.trim().length === 0;

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-slate-50">
      <div className="mx-auto flex w-full max-w-[1260px] flex-col gap-8 px-5 py-8 lg:px-8">
        <header className="border-b border-gray-200 pb-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
              Yale Research
            </span>
            <span className="rounded bg-white px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
              Topic-first discovery
            </span>
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
            <div>
              <h1 className="max-w-3xl text-3xl font-semibold tracking-normal text-gray-950">
                Map an idea to Yale papers, people, labs, and pathways.
              </h1>
              <p
                id="research-search-context"
                className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-600"
              >
                Search by topic, method, professor, program, or question. Results connect you to
                Yale research homes, evidence, and practical next steps.
              </p>
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Trust constraint
              </p>
              <p className="mt-1 text-sm leading-relaxed text-gray-700">
                Every suggestion keeps its source context visible, so you can tell whether it is a
                posted role, a recurring route, or exploratory evidence.
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="mt-6">
            <label htmlFor="research-search" className="mb-2 block text-sm font-semibold text-gray-900">
              Search Yale research
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="research-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-describedby="research-search-context"
                placeholder="Search by topic, method, professor, program, or question"
                className="min-h-[48px] flex-1 rounded-md border border-gray-300 bg-white px-4 text-base text-gray-950 placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              />
              <button
                type="submit"
                className="min-h-[48px] rounded-md bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:bg-gray-300"
                disabled={searchDisabled}
              >
                {searchLoading ? 'Searching...' : 'Search'}
              </button>
            </div>
            <div className="mt-3">
              <p className="mb-2 text-xs font-medium text-gray-500">Suggested searches</p>
              <div className="flex flex-wrap gap-2">
              {suggestedSearches.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => runSearch(topic)}
                  className="inline-flex min-h-[44px] items-center rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-blue-200 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  {topic}
                </button>
              ))}
              </div>
            </div>
          </form>
        </header>

        {hasSubmittedSearch && (
          <section aria-busy={searchLoading} aria-label="Search results">
            <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-950">
                  Results for {submittedQuery}
                </h2>
                <p
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="mt-1 text-sm text-gray-500"
                >
                  {resultSummary(activeResults, submittedQuery, searchLoading)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeResults.interpretationChips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded bg-white px-2 py-1 text-xs text-gray-700 ring-1 ring-gray-200"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            {searchError && (
              <div
                role="alert"
                className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
              >
                {searchError}
              </div>
            )}

            <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)]">
              <div className="space-y-6">
                <section>
                  <SectionHeading count={activeResults.clusters.length}>Matching Research Homes</SectionHeading>
                  {activeResults.clusters.length > 0 ? (
                    <div className="grid gap-3">
                      {activeResults.clusters.map((cluster) => (
                        <ResearchHomeCard
                          key={cluster.id}
                          home={cluster}
                          onSelect={(label) => runSearch(label)}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyGroup>
                      Search an idea or choose a suggested search to see matching Yale research homes.
                    </EmptyGroup>
                  )}
                </section>

                {activeResults.papers.length > 0 && (
                  <section>
                    <SectionHeading count={activeResults.papers.length}>Papers via profiles</SectionHeading>
                    <div className="grid gap-3">
                      {activeResults.papers.map((paper) => (
                        <article key={paper._id} className="rounded-md border border-gray-200 bg-white p-4">
                          <h3 className="text-sm font-semibold text-gray-950">{paper.title}</h3>
                          <p className="mt-1 text-xs text-gray-500">
                            {[paper.venue, paper.year].filter(Boolean).join(' | ')}
                          </p>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              <div className="space-y-6">
                <section>
                  <SectionHeading count={activeResults.pathways.length}>Best Next Steps</SectionHeading>
                  {activeResults.pathways.length > 0 ? (
                    <div className="grid gap-3">
                      {activeResults.pathways.map((pathway) => (
                        <PathwayActionCard key={pathway._id} pathway={pathway} />
                      ))}
                    </div>
                  ) : (
                    <EmptyGroup>
                      Best next steps appear when pathway search finds an evidence-backed route.
                    </EmptyGroup>
                  )}
                </section>

                <section>
                  <SectionHeading count={activeResults.people.length}>People and Contacts</SectionHeading>
                  {activeResults.people.length > 0 ? (
                    <div className="grid gap-3">
                      {activeResults.people.map((identity) => (
                        <IdentityConfidenceCard key={identity.id} identity={identity} />
                      ))}
                    </div>
                  ) : (
                    <EmptyGroup>
                      People and contacts appear when existing research metadata includes names, profile links, or source context.
                    </EmptyGroup>
                  )}
                </section>
              </div>
            </div>
          </section>
        )}

        <section>
          <SectionHeading>{hasSubmittedSearch ? 'Keep Exploring' : 'Browse Research Areas'}</SectionHeading>
          <div className="grid gap-4 lg:grid-cols-3">
            {homeRows.map((row) => (
              <div key={row.query} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">{row.query}</h3>
                </div>
                {row.loading ? (
                  <ClusterLoadingCard />
                ) : row.error ? (
                  <EmptyGroup>{row.error}</EmptyGroup>
                ) : row.clusters.length > 0 ? (
                  row.clusters.slice(0, 1).map((cluster) => (
                    <ResearchHomeCard
                      key={cluster.id}
                      home={cluster}
                      onSelect={(label) => runSearch(label)}
                    />
                  ))
                ) : (
                  <EmptyGroup>Research homes will appear here when matching profiles are available.</EmptyGroup>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Research;
