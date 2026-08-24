/**
 * Canonical per-department research page at `/research/department/:slug`.
 *
 * Aggregates a department's `student_ready` research homes (already fetched
 * public-scoped from `GET /api/research/department/:slug`) into the shared
 * research-type buckets, plus a distinct "how students join" section for the
 * department's course-sequence, RA, and fellowship pathways.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from '../utils/axios';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { ResearchEntity } from '../types/researchEntity';
import { RESEARCH_TYPE_BUCKETS } from '../utils/researchTypeBuckets';
import { sanitizeResearchEntityCopy } from '../utils/researchEntityCopy';
import { safeRouteSegment } from '../utils/url';

interface DepartmentResearchPageResponse {
  department: string;
  slug: string;
  entities: ResearchEntity[];
  estimatedTotalHits: number;
}

const WAYS_IN_ENTITY_TYPES = new Set(['COURSE_SEQUENCE', 'RA_PROGRAM', 'FELLOWSHIP_PROGRAM']);

const entityCardDescription = (entity: ResearchEntity): string =>
  sanitizeResearchEntityCopy(
    entity.cardDescription?.text || entity.shortDescription || entity.fullDescription || '',
    entity,
  );

const ResearchDepartmentPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<DepartmentResearchPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchPage = useCallback(() => {
    if (!slug) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    setLoading(true);
    setNotFound(false);
    axios
      .get(`/research/department/${encodeURIComponent(slug)}`)
      .then((res) => {
        setPage(res.data as DepartmentResearchPageResponse);
      })
      .catch(() => {
        setPage(null);
        setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  useDocumentTitle(page ? `${page.department} research` : 'Department research');

  if (loading) {
    return (
      <div className="yr-page flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-16">
        <div
          className="h-10 w-10 animate-spin rounded-full border-b-2 border-[var(--yr-blue)]"
          aria-label="Loading department research"
        />
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="yr-page flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-16">
        <div className="yr-panel max-w-md rounded-md p-6 text-center">
          <p className="yr-kicker mb-3">Department</p>
          <h1 className="text-2xl font-semibold text-slate-950">We couldn't find that department</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            It may not have any indexed research homes yet.
          </p>
          <Link
            to="/research"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Browse all research
          </Link>
        </div>
      </div>
    );
  }

  const waysIn = page.entities.filter((entity) =>
    WAYS_IN_ENTITY_TYPES.has(entity.entityType || ''),
  );

  // Ways-in entities get their own section above, so bucket listings exclude
  // them to avoid rendering the same research home twice on one page.
  const buckets = RESEARCH_TYPE_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    entities: page.entities.filter(
      (entity) =>
        bucket.entityTypes.includes(entity.entityType || '') &&
        !WAYS_IN_ENTITY_TYPES.has(entity.entityType || ''),
    ),
  })).filter((bucket) => bucket.entities.length > 0);

  const browseHref = `/research?department=${encodeURIComponent(page.department)}`;

  return (
    <div className="yr-page mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="yr-kicker mb-2">Department</p>
        <h1 className="text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">
          {page.department}
        </h1>
        <Link
          to={browseHref}
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--yr-blue)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          Browse all {page.department} research on /research
        </Link>
      </header>

      {buckets.length === 0 && waysIn.length === 0 ? (
        <p className="text-sm leading-relaxed text-slate-600">
          No indexed research homes yet for {page.department}.
        </p>
      ) : (
        <>
          {waysIn.length > 0 && (
            <section aria-labelledby="ways-in-heading" className="mb-10">
              <h2 id="ways-in-heading" className="mb-3 text-xl font-semibold text-slate-950">
                How students join research in {page.department}
              </h2>
              <ul className="flex flex-col gap-3">
                {waysIn.map((entity) => (
                  <li key={entity.slug} className="yr-panel rounded-md p-4">
                    <Link
                      to={`/research/${safeRouteSegment(entity.slug)}`}
                      className="font-semibold text-slate-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                    >
                      {entity.name}
                    </Link>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                      {entityCardDescription(entity)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {buckets.map((bucket) => (
            <section key={bucket.key} aria-labelledby={`bucket-${bucket.key}-heading`} className="mb-10">
              <h2
                id={`bucket-${bucket.key}-heading`}
                className="mb-3 text-xl font-semibold text-slate-950"
              >
                {bucket.label}
              </h2>
              <ul className="flex flex-col gap-3">
                {bucket.entities.map((entity) => (
                  <li key={entity.slug} className="yr-panel rounded-md p-4">
                    <Link
                      to={`/research/${safeRouteSegment(entity.slug)}`}
                      className="font-semibold text-slate-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                    >
                      {entity.name}
                    </Link>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                      {entityCardDescription(entity)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
};

export default ResearchDepartmentPage;
