import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { isCancel } from 'axios';
import { Link } from 'react-router-dom';
import axios from '../utils/axios';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { useFavorites } from '../hooks/useFavorites';
import {
  PathwayBestNextStepCategory,
  PathwaySearchFilters,
  PathwaySearchHit,
  PathwaySearchResponse,
  PathwaySortBy,
} from '../types/pathway';

const PAGE_SIZE = 24;

const PATHWAY_OPTIONS = [
  { value: 'POSTED_ROLE', label: 'Posted role' },
  { value: 'EXPLORATORY_CONTACT', label: 'Exploratory outreach' },
  { value: 'VOLUNTEER_OUTREACH', label: 'Volunteer outreach' },
  { value: 'WORK_STUDY', label: 'Work-study' },
  { value: 'CENTER_INTERNSHIP', label: 'Center internship' },
  { value: 'RECURRING_PROGRAM', label: 'Recurring program' },
];

const COMPENSATION_OPTIONS = [
  { value: 'PAID', label: 'Paid' },
  { value: 'COURSE_CREDIT', label: 'Course credit' },
  { value: 'STIPEND', label: 'Stipend' },
  { value: 'VOLUNTEER', label: 'Volunteer' },
  { value: 'WORK_STUDY', label: 'Work-study' },
  { value: 'FELLOWSHIP', label: 'Fellowship' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

const EVIDENCE_OPTIONS = [
  { value: 'DIRECT', label: 'Direct' },
  { value: 'STRONG', label: 'Strong' },
  { value: 'MODERATE', label: 'Moderate' },
  { value: 'WEAK', label: 'Weak' },
];

const NEXT_STEP_OPTIONS: Array<{ value: PathwayBestNextStepCategory; label: string }> = [
  { value: 'apply', label: 'Apply' },
  { value: 'find-funding', label: 'Find funding' },
  { value: 'plan-outreach', label: 'Plan outreach' },
  { value: 'contact-program', label: 'Contact program' },
  { value: 'check-back-later', label: 'Check back later' },
];

const NEXT_STEP_DETAIL: Record<PathwayBestNextStepCategory, string> = {
  apply: 'Application route',
  'register-for-credit': 'Credit route',
  'find-funding': 'Funding route',
  'plan-outreach': 'Outreach prep',
  'contact-program': 'Program contact',
  'save-for-thesis': 'Thesis lead',
  'save-for-later': 'Saved lead',
  'check-back-later': 'Planning lead',
};

const OPTION_LABELS = new Map(
  [...PATHWAY_OPTIONS, ...COMPENSATION_OPTIONS, ...EVIDENCE_OPTIONS, ...NEXT_STEP_OPTIONS].map(
    (option) => [option.value, option.label],
  ),
);

const labelize = (value?: string): string =>
  (value || 'Unknown')
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const compact = <T,>(values: Array<T | undefined | null | false>): T[] =>
  values.filter(Boolean) as T[];

const contactRouteLabel = (routeType?: string): string => {
  switch (routeType) {
    case 'OFFICIAL_APPLICATION':
      return 'Open official route';
    case 'PROGRAM_MANAGER':
      return 'Contact program';
    case 'DEPARTMENT_CONTACT':
      return 'Contact department';
    case 'FELLOWSHIP_OFFICE':
      return 'Contact fellowship office';
    case 'COURSE_INSTRUCTOR':
      return 'Contact course instructor';
    case 'LAB_MANAGER':
      return 'Contact lab manager';
    default:
      return 'Open contact route';
  }
};

const isPostedRole = (pathway: PathwaySearchHit): boolean =>
  pathway.pathwayType === 'POSTED_ROLE' || !!pathway.activePostedOpportunity;

type ArrayFilterKey =
  | 'pathwayType'
  | 'compensation'
  | 'evidenceStrength'
  | 'bestNextStepCategory';

interface CheckboxFilterProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}

const CheckboxFilter: FC<CheckboxFilterProps> = ({ label, options, selected, onToggle }) => (
  <fieldset className="border-t border-slate-200 pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
    <legend className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
      {label}
    </legend>
    <div className="flex flex-col gap-1.5">
      {options.map((option) => (
        <label
          key={option.value}
          className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer hover:text-slate-950"
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            checked={selected.includes(option.value)}
            onChange={() => onToggle(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

const PathwayCard: FC<{
  pathway: PathwaySearchHit;
  isSaved: boolean;
  onToggleSaved: (id: string, saved: boolean) => void;
}> = ({ pathway, isSaved, onToggleSaved }) => {
  const tags = compact([
    pathway.compensation && labelize(pathway.compensation),
    pathway.evidenceStrength && `${labelize(pathway.evidenceStrength)} evidence`,
    pathway.activePostedOpportunity ? 'Posted opening' : undefined,
  ]);
  const entity = pathway.researchEntity;
  const entityDepartments = entity?.departments || [];
  const evidence = Array.isArray(pathway.evidence) ? pathway.evidence : [];
  const nextStep = NEXT_STEP_OPTIONS.find((option) => option.value === pathway.bestNextStepCategory);
  const contactRoute = pathway.contactRoute?.url ? pathway.contactRoute : undefined;
  const entityLabel = entity?.displayName || entity?.name || 'Research profile';
  const entityLink = entity?.slug ? `/research/${entity.slug}` : '/research';
  const nextStepDetail = NEXT_STEP_DETAIL[pathway.bestNextStepCategory] || 'Next step';
  const sourceUrls = Array.from(
    new Set([
      ...(pathway.sourceUrls || []),
      ...evidence.map((item) => item.sourceUrl).filter(Boolean),
    ]),
  ) as string[];

  return (
    <article className="bg-white border border-slate-200 rounded-md p-5 hover:border-blue-300 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
              {labelize(pathway.pathwayType)}
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
              {labelize(pathway.status)}
            </span>
          </div>
          <h2 className="text-lg font-bold text-slate-950 leading-tight">
            {pathway.studentFacingLabel}
          </h2>
          <Link
            to={entityLink}
            className="text-sm font-medium text-blue-700 hover:underline"
          >
            {entityLabel}
          </Link>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 text-right">
          <button
            type="button"
            onClick={() => onToggleSaved(pathway._id, !isSaved)}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
              isSaved
                ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-700'
            }`}
            aria-pressed={isSaved}
          >
            {isSaved ? 'Saved' : 'Save'}
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Best Next Step
          </p>
          <p className="text-sm font-semibold text-slate-950">
            {nextStep?.label || labelize(pathway.bestNextStepCategory)}
          </p>
          <p className="text-xs text-slate-500">{nextStepDetail}</p>
        </div>
      </div>

      {pathway.explanation && (
        <p className="mt-3 text-sm text-slate-600 leading-relaxed">{pathway.explanation}</p>
      )}

      <div className="mt-3 text-sm text-slate-700 bg-slate-50 border border-slate-100 rounded p-3">
        {isPostedRole(pathway)
          ? 'This is tied to a specific posted role or rolling application.'
          : 'This is an evidence-backed way in, not necessarily an active job posting.'}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span key={tag} className="text-xs px-2 py-0.5 rounded bg-slate-50 text-slate-700">
            {tag}
          </span>
        ))}
        {entityDepartments.slice(0, 2).map((department) => (
          <span key={department} className="text-xs px-2 py-0.5 rounded bg-slate-50 text-slate-700">
            {department}
          </span>
        ))}
      </div>

      {evidence.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Evidence
          </p>
          <div className="space-y-1">
            {evidence.slice(0, 2).map((item, index) => (
              <p
                key={`${pathway._id}-${item.signalType}-${index}`}
                className="text-sm text-gray-600"
              >
                <span className="font-medium text-slate-800">{labelize(item.signalType)}</span>
                {item.excerpt ? `: ${item.excerpt}` : ''}
                {item.confidenceScore !== undefined ? (
                  <span className="text-xs text-gray-400">
                    {' '}
                    ({Math.round(item.confidenceScore * 100)}% confidence)
                  </span>
                ) : null}
              </p>
            ))}
          </div>
          {sourceUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {sourceUrls.slice(0, 3).map((url, index) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-blue-700 hover:text-blue-900 underline underline-offset-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  Source {index + 1}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {pathway.activePostedOpportunity ? (
        <Link
          to={`/opportunities/${pathway.activePostedOpportunity._id}`}
          className="inline-flex mt-4 text-sm font-semibold text-blue-700 hover:underline"
        >
          View posted opportunity
        </Link>
      ) : contactRoute ? (
        <a
          href={contactRoute.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex mt-4 text-sm font-semibold text-blue-700 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {contactRoute.label || contactRouteLabel(contactRoute.routeType)}
        </a>
      ) : (
        <Link
          to={entityLink}
          className="inline-flex mt-4 text-sm font-semibold text-blue-700 hover:underline"
        >
          View research profile
        </Link>
      )}
    </article>
  );
};

const PathwayMetricStrip: FC<{
  results: PathwaySearchHit[];
  total: number;
}> = ({ results, total }) => {
  const postedCount = results.filter(isPostedRole).length;
  const strongEvidenceCount = results.filter((pathway) =>
    ['DIRECT', 'STRONG'].includes(pathway.evidenceStrength || ''),
  ).length;
  const applyCount = results.filter((pathway) => pathway.bestNextStepCategory === 'apply').length;

  return (
    <section
      aria-label="Pathway result summary"
      className="mb-4 grid gap-3 md:grid-cols-4"
    >
      {[
        { label: 'Total matches', value: total.toLocaleString(), detail: 'Across all pages' },
        { label: 'Visible now', value: results.length.toLocaleString(), detail: 'Loaded in this view' },
        { label: 'Posted routes', value: postedCount.toLocaleString(), detail: 'Application-linked' },
        { label: 'Direct or strong', value: strongEvidenceCount.toLocaleString(), detail: `${applyCount} apply-first` },
      ].map((item) => (
        <div key={item.label} className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{item.label}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{item.value}</p>
          <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
        </div>
      ))}
    </section>
  );
};

const PathwaysPage: FC = () => {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<PathwaySearchFilters>({});
  const [sortBy, setSortBy] = useState<PathwaySortBy>('relevance');
  const [results, setResults] = useState<PathwaySearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const { favIds: favPathwayIds, setFavorite: setPathwayFavorite } = useFavorites('pathways');

  const activeFilterCount = useMemo(
    () =>
      (filters.pathwayType?.length || 0) +
      (filters.compensation?.length || 0) +
      (filters.evidenceStrength?.length || 0) +
      (filters.bestNextStepCategory?.length || 0) +
      (filters.hasActivePostedOpportunity ? 1 : 0),
    [filters],
  );
  const activeFilterLabels = useMemo(() => {
    const labels = compact([
      query.trim() ? `Search: ${query.trim()}` : undefined,
      ...(filters.pathwayType || []).map((value) => OPTION_LABELS.get(value) || labelize(value)),
      ...(filters.compensation || []).map((value) => OPTION_LABELS.get(value) || labelize(value)),
      ...(filters.evidenceStrength || []).map((value) => OPTION_LABELS.get(value) || labelize(value)),
      ...(filters.bestNextStepCategory || []).map((value) => OPTION_LABELS.get(value) || labelize(value)),
      filters.hasActivePostedOpportunity ? 'Active posted role' : undefined,
    ]);
    return labels;
  }, [filters, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requestId = ++requestIdRef.current;
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setLoading(true);
      setError('');
      axios
        .post<PathwaySearchResponse>(
          '/pathways/search',
          {
            q: query,
            page: 1,
            pageSize: PAGE_SIZE,
            filters,
            sortBy,
            sortOrder: 'desc',
          },
          {
            signal: controller.signal,
          },
        )
        .then((response) => {
          if (requestId !== requestIdRef.current) return;
          setResults(response.data.hits || []);
          setTotal(response.data.estimatedTotalHits || 0);
        })
        .catch((err) => {
          if (isCancel(err) || requestId !== requestIdRef.current) return;
          setError('Failed to load pathways.');
          setResults([]);
          setTotal(0);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) {
            setLoading(false);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      searchAbortRef.current?.abort();
    };
  }, [query, filters, sortBy]);

  const toggleArrayFilter = (
    key: ArrayFilterKey,
    value: string,
  ) => {
    setFilters((prev) => {
      const current = ((prev[key] as string[] | undefined) || []) as string[];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      return {
        ...prev,
        [key]: next.length > 0 ? next : undefined,
      };
    });
  };

  return (
    <div className="mx-auto max-w-[1300px] px-6 w-full min-h-[calc(100vh-12rem)] py-6">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 mb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Ways in</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-950">Pathways into research</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Compare posted roles, outreach routes, and evidence-backed ways to start a Yale research conversation.
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          <span className="font-semibold text-slate-950">{total.toLocaleString()}</span>{' '}
          evidence-backed routes
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <section className="bg-white rounded-md border border-gray-200 p-4">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pathways..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Search pathways"
            />
          </section>

          <section className="max-h-[420px] overflow-y-auto bg-white rounded-md border border-gray-200 p-4 lg:max-h-none">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-900">Filters</h2>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilters({})}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Clear ({activeFilterCount})
                </button>
              )}
            </div>

            {activeFilterLabels.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {activeFilterLabels.slice(0, 6).map((label) => (
                  <span
                    key={label}
                    className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700"
                  >
                    {label}
                  </span>
                ))}
                {activeFilterLabels.length > 6 && (
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                    +{activeFilterLabels.length - 6}
                  </span>
                )}
              </div>
            )}

            <CheckboxFilter
              label="Pathway"
              options={PATHWAY_OPTIONS}
              selected={filters.pathwayType || []}
              onToggle={(value) => toggleArrayFilter('pathwayType', value)}
            />
            <CheckboxFilter
              label="Compensation"
              options={COMPENSATION_OPTIONS}
              selected={filters.compensation || []}
              onToggle={(value) => toggleArrayFilter('compensation', value)}
            />
            <CheckboxFilter
              label="Evidence"
              options={EVIDENCE_OPTIONS}
              selected={filters.evidenceStrength || []}
              onToggle={(value) => toggleArrayFilter('evidenceStrength', value)}
            />
            <CheckboxFilter
              label="Best Next Step"
              options={NEXT_STEP_OPTIONS}
              selected={filters.bestNextStepCategory || []}
              onToggle={(value) => toggleArrayFilter('bestNextStepCategory', value)}
            />

            <fieldset className="border-t border-gray-200 pt-3 mt-3">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Posted
              </legend>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-gray-900">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={filters.hasActivePostedOpportunity === true}
                  onChange={() =>
                    setFilters((prev) => ({
                      ...prev,
                      hasActivePostedOpportunity:
                        prev.hasActivePostedOpportunity === true ? undefined : true,
                    }))
                  }
                />
                <span>Has active posted role</span>
              </label>
            </fieldset>
          </section>
        </aside>

        <div>
          <PathwayMetricStrip results={results} total={total} />

          <div className="flex items-center justify-between mb-3 text-sm text-gray-600">
            <span>
              {total.toLocaleString()} {total === 1 ? 'pathway' : 'pathways'}
            </span>
            <label className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Sort:</span>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as PathwaySortBy)}
                className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="relevance">Relevance</option>
                <option value="confidence">Evidence strength</option>
                <option value="lastObservedAt">Recently observed</option>
                <option value="deadline">Deadline</option>
                <option value="createdAt">Recently added</option>
              </select>
            </label>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          {loading && results.length === 0 ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner size="lg" />
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No pathways match the current filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {results.map((pathway) => (
                <PathwayCard
                  key={pathway._id}
                  pathway={pathway}
                  isSaved={favPathwayIds.includes(pathway._id)}
                  onToggleSaved={setPathwayFavorite}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PathwaysPage;
