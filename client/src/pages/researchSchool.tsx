/**
 * Canonical per-school research page rendered at `/research/school/:slug`
 * (issue #1707).
 *
 * Resolves the school slug from the URL and fetches the aggregated payload from
 * `GET /api/research/school/:slug`: the school's departments with home counts,
 * its cross-cutting centers and institutes, a representative set of research
 * homes, and the school-wide documented ways into research. It only composes
 * already-gated data; every home links to its canonical `/research/:slug` and
 * every department to its `/research/department/:slug` page.
 */
import { useEffect, useState } from 'react';
import { isCancel } from 'axios';
import { Link, useParams } from 'react-router-dom';
import axios from '../utils/axios';
import NotFound from './notFound';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { safeRouteSegment } from '../utils/url';
import type { ResearchEntity } from '../types/researchEntity';

interface SchoolEntityGroup {
  entityType: string;
  label: string;
  researchEntities: ResearchEntity[];
  totalCount: number;
}

interface SchoolDepartmentSummary {
  slug: string;
  label: string;
  homeCount: number;
}

interface SchoolResearchPageData {
  school: { slug: string; label: string };
  departments: SchoolDepartmentSummary[];
  crossCuttingGroups: SchoolEntityGroup[];
  homeGroups: SchoolEntityGroup[];
  waysIn: SchoolEntityGroup[];
  totalHomeCount: number;
  totalWayInCount: number;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; data: SchoolResearchPageData };

const entityBlurb = (entity: ResearchEntity): string =>
  entity.cardDescription?.text?.trim() || entity.shortDescription?.trim() || '';

const SchoolEntityCard = ({ entity }: { entity: ResearchEntity }) => {
  const slug = safeRouteSegment(entity.slug);
  const blurb = entityBlurb(entity);
  const areas = (entity.researchAreas || []).slice(0, 4);
  const heading = entity.displayName || entity.name || 'Untitled research home';

  return (
    <article className="yr-card rounded-md p-4">
      <h3 className="text-base font-semibold leading-tight text-gray-950">
        {slug ? (
          <Link
            to={`/research/${safeRouteSegment(entity.slug)}`}
            className="yr-link yr-focus-ring rounded-sm"
          >
            {heading}
          </Link>
        ) : (
          heading
        )}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        {blurb || 'Description not available yet.'}
      </p>
      {areas.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {areas.map((area) => (
            <span key={area} className="yr-pill min-h-0 rounded px-2 py-0.5">
              {area}
            </span>
          ))}
        </div>
      )}
    </article>
  );
};

const SchoolEntityGroupSection = ({ group }: { group: SchoolEntityGroup }) => {
  const headingId = `school-group-${group.entityType.toLowerCase()}`;
  const overflow = group.totalCount - group.researchEntities.length;
  return (
    <section aria-labelledby={headingId} className="mt-6 first:mt-0">
      <h3 id={headingId} className="yr-kicker text-[0.72rem]">
        {group.label} ({group.totalCount})
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {group.researchEntities.map((entity) => (
          <SchoolEntityCard key={entity.slug || entity.id} entity={entity} />
        ))}
      </div>
      {overflow > 0 && (
        <p className="mt-2 text-sm text-gray-500">
          +{overflow} more in this group. Refine on the browse page to see them all.
        </p>
      )}
    </section>
  );
};

const ResearchSchool = () => {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    axios
      .get<SchoolResearchPageData>(`/research/school/${encodeURIComponent(slug)}`, {
        signal: controller.signal,
      })
      .then((response) => {
        setState({ status: 'ready', data: response.data });
      })
      .catch((error) => {
        if (isCancel(error)) return;
        if (error?.response?.status === 404) {
          setState({ status: 'not-found' });
          return;
        }
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [slug]);

  const schoolLabel = state.status === 'ready' ? state.data.school.label : undefined;

  useDocumentTitle(schoolLabel ? `Research at ${schoolLabel}` : 'School research');

  if (state.status === 'loading') {
    return (
      <div
        role="status"
        aria-label="Loading school research"
        className="mx-auto flex w-full max-w-screen-2xl justify-center px-4 py-16"
      >
        <LoadingSpinner />
      </div>
    );
  }

  if (state.status === 'not-found') {
    return <NotFound />;
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto w-full max-w-screen-2xl px-4 py-16">
        <h1 className="text-xl font-semibold text-gray-950">We could not load this school</h1>
        <p className="mt-2 text-sm text-gray-600">
          Something went wrong fetching this school. Please try again.
        </p>
        <Link
          to="/research"
          className="yr-link yr-focus-ring mt-4 inline-flex rounded-sm text-sm font-semibold"
        >
          Back to browse research
        </Link>
      </div>
    );
  }

  const { data } = state;
  const browseHref = `/research?school=${encodeURIComponent(data.school.label)}`;
  const hasDepartments = data.departments.length > 0;
  const hasCrossCutting = data.crossCuttingGroups.length > 0;
  const hasHomes = data.homeGroups.length > 0;
  const hasWaysIn = data.waysIn.length > 0;
  const isEmpty = !hasDepartments && !hasCrossCutting && !hasHomes && !hasWaysIn;

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:py-8">
      <header className="yr-panel rounded-md p-5 sm:p-6">
        <p className="yr-kicker text-[0.72rem]">School research</p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight text-gray-950">
          Research at {data.school.label}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
          The departments, centers, and research homes within {data.school.label}, plus the
          documented ways undergraduates join research here. Everything shown is already published
          for students; anything not documented is left out rather than guessed.
        </p>
        <Link
          to={browseHref}
          className="yr-focus-ring mt-4 inline-flex min-h-11 items-center rounded-md border border-blue-200 bg-[var(--yr-panel)] px-3 py-2 text-sm font-semibold text-[var(--yr-blue)] transition-colors hover:border-blue-300 hover:bg-[var(--yr-blue-soft)]"
        >
          Browse {data.school.label} in search →
        </Link>
      </header>

      {isEmpty ? (
        <section aria-label="No research homes" className="yr-card mt-6 rounded-md p-6">
          <h2 className="text-lg font-semibold text-gray-950">No research homes indexed yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            We do not have any published research homes for {data.school.label} yet. You can still
            explore related research from the browse page.
          </p>
          <Link
            to="/research"
            className="yr-link yr-focus-ring mt-4 inline-flex rounded-sm text-sm font-semibold"
          >
            Back to browse research
          </Link>
        </section>
      ) : (
        <>
          {hasDepartments && (
            <section aria-labelledby="school-departments-heading" className="mt-8">
              <h2
                id="school-departments-heading"
                className="text-lg font-semibold text-gray-950"
              >
                Departments ({data.departments.length})
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
                Departments within {data.school.label} that have research homes. Open a department
                to see its labs, centers, and ways in.
              </p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {data.departments.map((department) => (
                  <li key={department.slug}>
                    <Link
                      to={`/research/department/${safeRouteSegment(department.slug)}`}
                      className="yr-card yr-focus-ring flex items-center justify-between gap-3 rounded-md p-4 transition-colors hover:border-blue-300"
                    >
                      <span className="text-base font-semibold leading-tight text-gray-950">
                        {department.label}
                      </span>
                      <span className="yr-pill min-h-0 rounded px-2 py-0.5">
                        {department.homeCount}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasCrossCutting && (
            <section aria-labelledby="school-centers-heading" className="mt-10">
              <h2 id="school-centers-heading" className="text-lg font-semibold text-gray-950">
                Cross-cutting centers and institutes
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
                Centers and institutes anchored to {data.school.label} that span more than one
                department.
              </p>
              <div className="mt-4">
                {data.crossCuttingGroups.map((group) => (
                  <SchoolEntityGroupSection key={group.entityType} group={group} />
                ))}
              </div>
            </section>
          )}

          {hasHomes && (
            <section aria-labelledby="school-homes-heading" className="mt-10">
              <h2 id="school-homes-heading" className="text-lg font-semibold text-gray-950">
                Research homes ({data.totalHomeCount})
              </h2>
              <div className="mt-4">
                {data.homeGroups.map((group) => (
                  <SchoolEntityGroupSection key={group.entityType} group={group} />
                ))}
              </div>
            </section>
          )}

          {hasWaysIn && (
            <section aria-labelledby="school-ways-in-heading" className="mt-10">
              <h2 id="school-ways-in-heading" className="text-lg font-semibold text-gray-950">
                How students join research at {data.school.label}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
                Documented pathways into research at this school: directed-research and course
                sequences, research assistant programs, and fellowships.
              </p>
              <div className="mt-4">
                {data.waysIn.map((group) => (
                  <SchoolEntityGroupSection key={group.entityType} group={group} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default ResearchSchool;
