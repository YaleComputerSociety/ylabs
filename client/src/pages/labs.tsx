/**
 * `/labs` browse page — students search and filter ALL Yale research groups
 * (labs, centers, individual prof pages) with semantic + keyword search.
 *
 * State (query, filters, page, results) is owned by `LabSearchContextProvider`.
 * This page is the smart component: composes the search bar, the filter
 * sidebar, and the results grid. Card / list item presentation is delegated
 * to the small `LabCard` component below — kept inline because it differs
 * enough from the shared `BrowseCard` (which is hardcoded to listings &
 * fellowships) that pulling it into the BrowsableItem union would be more
 * disruption than reuse.
 */
import { FC, ReactNode, useContext, useMemo } from 'react';
import { Link } from 'react-router-dom';
import LabSearchContext from '../contexts/LabSearchContext';
import LabSearchContextProvider from '../providers/LabSearchContextProvider';
import { useConfig } from '../hooks/useConfig';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import {
  AcceptanceLevelFilter,
  ResearchGroup,
  ResearchGroupSearchFilters,
} from '../types/researchGroup';
import {
  computeAcceptanceVerdict,
  verdictBadgeStyles,
  verdictLabel,
} from '../utils/undergradAcceptance';

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'lab', label: 'Lab' },
  { value: 'center', label: 'Center' },
  { value: 'institute', label: 'Institute' },
  { value: 'program', label: 'Program' },
  { value: 'initiative', label: 'Initiative' },
  { value: 'group', label: 'Group' },
  { value: 'individual', label: 'Individual' },
];

const OPENNESS_OPTIONS: { value: string; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'inquire', label: 'Inquire' },
  { value: 'closed', label: 'Closed' },
];

const ACCEPTANCE_LEVEL_OPTIONS: { value: AcceptanceLevelFilter; label: string }[] = [
  { value: 'all', label: 'All groups' },
  { value: 'verified-or-likely', label: 'Verified or likely accepting' },
  { value: 'verified', label: 'Verified accepting only' },
];

const SCHOOL_OPTIONS: string[] = [
  'Yale College',
  'School of Medicine',
  'School of Public Health',
  'School of Engineering & Applied Science',
  'School of the Environment',
  'Graduate School of Arts & Sciences',
  'School of Management',
  'Law School',
  'Divinity School',
  'School of Music',
  'School of Architecture',
  'School of Art',
  'School of Drama',
  'School of Nursing',
];

interface CheckboxGroupProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}

const CheckboxGroup: FC<CheckboxGroupProps> = ({ label, options, selected, onToggle }) => (
  <fieldset className="border-t border-gray-200 pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
    <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
      {label}
    </legend>
    <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
      {options.map((opt) => (
        <label
          key={opt.value}
          className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-gray-900"
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            checked={selected.includes(opt.value)}
            onChange={() => onToggle(opt.value)}
          />
          <span className="truncate">{opt.label}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

interface LabCardProps {
  group: ResearchGroup;
}

const LabCard: FC<LabCardProps> = ({ group }) => {
  const slug = group.slug;
  const primaryDepartment = group.departments?.[0];
  const cta = group.hasActiveListing ? 'View opening' : 'Inquire';
  const ctaClass = group.hasActiveListing
    ? 'bg-blue-600 text-white hover:bg-blue-700'
    : 'bg-gray-100 text-gray-700 hover:bg-gray-200';

  // Trust gradient — replaces the legacy kind-only badge. The card surface
  // doesn't yet know whether listings are attached, so we fall back to the
  // `hasActiveListing` flag when present (set elsewhere by hydration code).
  const { verdict, evidence } = computeAcceptanceVerdict(
    group,
    group.hasActiveListing === true,
  );
  const verdictClasses = verdictBadgeStyles(verdict);
  const verdictText = verdictLabel(verdict);
  // Show one chip when we have positive evidence — picks the strongest item.
  const showEvidenceChip =
    (verdict === 'verified-accepting' || verdict === 'likely-accepting') &&
    evidence.length > 0;
  const headlineEvidence = showEvidenceChip ? evidence[0] : null;

  return (
    <Link
      to={`/labs/${slug}`}
      className="group flex flex-col h-full bg-white rounded-md border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-200 overflow-hidden"
    >
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span
            className={`text-xs font-semibold px-1.5 py-0.5 rounded ${verdictClasses}`}
            data-verdict={verdict}
          >
            {verdictText}
          </span>
          {group.school && (
            <span className="text-xs text-gray-500 truncate">{group.school}</span>
          )}
        </div>

        <h3 className="text-base font-bold text-gray-900 leading-tight line-clamp-2">
          {group.name}
        </h3>

        {headlineEvidence && (
          <p
            className="text-xs text-emerald-700 mt-1 truncate"
            title={headlineEvidence.detail}
          >
            {headlineEvidence.label}
            {headlineEvidence.detail ? ` ${headlineEvidence.detail}` : ''}
          </p>
        )}

        {primaryDepartment && (
          <p className="text-sm font-semibold text-blue-700 truncate mt-1">
            {primaryDepartment}
          </p>
        )}

        {group.description && (
          <p className="text-sm text-gray-500 mt-2 leading-snug line-clamp-3">
            {group.description}
          </p>
        )}

        <div className="flex-1" />

        {group.researchAreas && group.researchAreas.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {group.researchAreas.slice(0, 3).map((area) => (
              <span
                key={area}
                className="bg-gray-100 text-gray-700 text-xs px-1.5 py-0.5 rounded"
              >
                {area}
              </span>
            ))}
            {group.researchAreas.length > 3 && (
              <span className="text-xs text-gray-400">+{group.researchAreas.length - 3}</span>
            )}
          </div>
        )}

        <div className="mt-4">
          <span
            className={`inline-block text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${ctaClass}`}
          >
            {cta}
          </span>
        </div>
      </div>
    </Link>
  );
};

interface SectionProps {
  children: ReactNode;
}

const Section: FC<SectionProps> = ({ children }) => (
  <section className="bg-white rounded-md border border-gray-200 p-4">{children}</section>
);

const LabsPageBody: FC = () => {
  const {
    queryString,
    setQueryString,
    filters,
    setFilters,
    clearFilters,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    page,
    setPage,
    pageSize,
    results,
    totalHits,
    isLoading,
    error,
    searchExhausted,
  } = useContext(LabSearchContext);

  const { departments, departmentCategories, isLoaded: configLoaded } = useConfig();

  const departmentOptions = useMemo(
    () =>
      departments
        .map((d) => ({ value: d.displayName, label: d.displayName }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [departments],
  );

  const researchAreaOptions = useMemo(
    () =>
      [...departmentCategories]
        .sort((a, b) => a.localeCompare(b))
        .map((c) => ({ value: c, label: c })),
    [departmentCategories],
  );

  const toggleArrayFilter = (key: keyof ResearchGroupSearchFilters, value: string) => {
    setFilters((prev) => {
      const current = (prev[key] as string[] | undefined) ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const updated: ResearchGroupSearchFilters = { ...prev };
      if (next.length === 0) {
        delete (updated as Record<string, unknown>)[key];
      } else {
        (updated as Record<string, unknown>)[key] = next;
      }
      return updated;
    });
  };

  const toggleAcceptingUndergrads = () => {
    setFilters((prev) => {
      const updated: ResearchGroupSearchFilters = { ...prev };
      if (prev.acceptingUndergrads === true) {
        delete updated.acceptingUndergrads;
      } else {
        updated.acceptingUndergrads = true;
      }
      return updated;
    });
  };

  const setAcceptanceLevel = (level: AcceptanceLevelFilter) => {
    setFilters((prev) => ({ ...prev, acceptanceLevel: level }));
  };

  const sentinelRef = useInfiniteScroll({
    searchExhausted,
    isLoading,
    setPage,
  });

  const acceptanceLevel: AcceptanceLevelFilter = filters.acceptanceLevel ?? 'all';
  const activeFilterCount =
    (filters.kind?.length ?? 0) +
    (filters.school?.length ?? 0) +
    (filters.departments?.length ?? 0) +
    (filters.researchAreas?.length ?? 0) +
    (filters.openness?.length ?? 0) +
    (filters.acceptingUndergrads === true ? 1 : 0) +
    (acceptanceLevel !== 'all' ? 1 : 0);

  const showInitialLoader = isLoading && results.length === 0;

  return (
    <div className="mx-auto max-w-[1300px] px-6 w-full min-h-[calc(100vh-12rem)] py-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Yale Labs</h1>
          <p className="text-sm text-gray-500">
            Browse research groups across Yale — labs, centers, and faculty research pages.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <aside className="space-y-4">
          <Section>
            <input
              type="search"
              value={queryString}
              onChange={(e) => setQueryString(e.target.value)}
              placeholder="Search labs..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Search labs"
            />
          </Section>

          <Section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-900">Filters</h2>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-blue-600 hover:underline"
                  type="button"
                >
                  Clear ({activeFilterCount})
                </button>
              )}
            </div>

            <fieldset className="border-t border-gray-200 pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Acceptance
              </legend>
              <div className="flex flex-col gap-1.5">
                {ACCEPTANCE_LEVEL_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-gray-900"
                  >
                    <input
                      type="radio"
                      name="acceptanceLevel"
                      className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={acceptanceLevel === opt.value}
                      onChange={() => setAcceptanceLevel(opt.value)}
                    />
                    <span className="truncate">{opt.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <CheckboxGroup
              label="Kind"
              options={KIND_OPTIONS}
              selected={filters.kind ?? []}
              onToggle={(v) => toggleArrayFilter('kind', v)}
            />

            <CheckboxGroup
              label="School"
              options={SCHOOL_OPTIONS.map((s) => ({ value: s, label: s }))}
              selected={filters.school ?? []}
              onToggle={(v) => toggleArrayFilter('school', v)}
            />

            {configLoaded && departmentOptions.length > 0 && (
              <CheckboxGroup
                label="Departments"
                options={departmentOptions}
                selected={filters.departments ?? []}
                onToggle={(v) => toggleArrayFilter('departments', v)}
              />
            )}

            {configLoaded && researchAreaOptions.length > 0 && (
              <CheckboxGroup
                label="Research Areas"
                options={researchAreaOptions}
                selected={filters.researchAreas ?? []}
                onToggle={(v) => toggleArrayFilter('researchAreas', v)}
              />
            )}

            <CheckboxGroup
              label="Openness"
              options={OPENNESS_OPTIONS}
              selected={filters.openness ?? []}
              onToggle={(v) => toggleArrayFilter('openness', v)}
            />

            <fieldset className="border-t border-gray-200 pt-3 mt-3">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Undergrads
              </legend>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:text-gray-900">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={filters.acceptingUndergrads === true}
                  onChange={toggleAcceptingUndergrads}
                />
                <span>Accepting undergraduates</span>
              </label>
            </fieldset>
          </Section>
        </aside>

        <div>
          <div className="flex items-center justify-between mb-3 text-sm text-gray-600">
            <span>
              {totalHits.toLocaleString()} {totalHits === 1 ? 'group' : 'groups'}
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor="lab-sort" className="text-xs text-gray-500">
                Sort:
              </label>
              <select
                id="lab-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="default">Relevance</option>
                <option value="lastObservedAt">Recently observed</option>
                <option value="name">Name</option>
              </select>
              {sortBy !== 'default' && (
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="text-xs text-gray-600 border border-gray-300 rounded-md px-2 py-1 hover:bg-gray-50"
                  type="button"
                  aria-label="Toggle sort direction"
                >
                  {sortOrder === 'asc' ? 'Asc' : 'Desc'}
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          {showInitialLoader ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner size="lg" />
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No research groups match the current filters.</p>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="mt-2 text-blue-600 hover:underline text-sm"
                  type="button"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {results.map((g) => (
                  <LabCard key={g._id || g.id || g.slug} group={g} />
                ))}
              </div>

              {!searchExhausted && <div ref={sentinelRef} className="h-10 w-full" />}

              {isLoading && results.length > 0 && (
                <div className="flex justify-center py-6">
                  <LoadingSpinner size="lg" />
                </div>
              )}
            </>
          )}

          {/* page is exposed for keyboard pagination control / debug; reading
              suppresses unused-var lint and pageSize keeps API symmetric. */}
          <span className="sr-only">
            Page {page} · page size {pageSize}
          </span>
        </div>
      </div>
    </div>
  );
};

const LabsPage: FC = () => (
  <LabSearchContextProvider>
    <LabsPageBody />
  </LabSearchContextProvider>
);

export default LabsPage;
