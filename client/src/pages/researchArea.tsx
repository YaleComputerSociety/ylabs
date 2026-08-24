/**
 * Canonical per-research-area and per-research-field page rendered at
 * `/research/area/:slug` and `/research/field/:slug` (issue #1696).
 *
 * Resolves the taxonomy slug from the URL and fetches the aggregated payload
 * from `GET /api/research/area/:slug` (or `/field/:slug`): the area's footprint
 * grouped by the shared research-type buckets plus its documented ways in. It
 * only composes already-gated data; every home links to its canonical
 * `/research/:slug`.
 */
import { useEffect, useMemo, useState } from 'react';
import { isCancel } from 'axios';
import { Link, useParams } from 'react-router-dom';
import axios from '../utils/axios';
import type { ResearchEntity } from '../types/researchEntity';
import ResearchHomeCard from '../components/research/ResearchHomeCard';
import NotFound from './notFound';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { buildGroupedSearchResults } from '../utils/researchDiscoveryAdapters';
import { researchFieldPath } from '../utils/researchAreaSlug';

export type ResearchAreaScopeKind = 'area' | 'field';

interface AreaResearchEntityBucket {
  key: string;
  label: string;
  researchEntities: ResearchEntity[];
  totalCount: number;
}

interface AreaResearchPageData {
  scope: {
    kind: ResearchAreaScopeKind;
    slug: string;
    name: string;
    colorKey: string;
    field?: string;
  };
  buckets: AreaResearchEntityBucket[];
  totalCount: number;
  waysIn: {
    researchEntities: ResearchEntity[];
    totalCount: number;
  };
}

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; data: AreaResearchPageData };

const colorKeyToDotClass: Record<string, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  teal: 'bg-teal-500',
  orange: 'bg-orange-500',
  indigo: 'bg-indigo-500',
  gray: 'bg-slate-400',
};

const HomeCardGrid = ({ researchEntities }: { researchEntities: ResearchEntity[] }) => {
  const clusters = useMemo(
    () =>
      buildGroupedSearchResults({ query: '', researchEntities, pathways: [] }).clusters,
    [researchEntities],
  );
  return (
    <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
      {clusters.map((cluster) => (
        <ResearchHomeCard key={cluster.id} home={cluster} />
      ))}
    </div>
  );
};

const BucketSection = ({ bucket }: { bucket: AreaResearchEntityBucket }) => {
  const headingId = `area-bucket-${bucket.key}`;
  const overflow = bucket.totalCount - bucket.researchEntities.length;
  return (
    <section aria-labelledby={headingId} className="mt-8 first:mt-0">
      <h3 id={headingId} className="yr-kicker text-[0.72rem]">
        {bucket.label} ({bucket.totalCount})
      </h3>
      <HomeCardGrid researchEntities={bucket.researchEntities} />
      {overflow > 0 && (
        <p className="mt-2 text-sm text-gray-500">
          +{overflow} more in this group. Refine on the browse page to see them all.
        </p>
      )}
    </section>
  );
};

interface ResearchAreaProps {
  scope: ResearchAreaScopeKind;
}

const ResearchArea = ({ scope }: ResearchAreaProps) => {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    axios
      .get<AreaResearchPageData>(`/research/${scope}/${encodeURIComponent(slug)}`, {
        signal: controller.signal,
      })
      .then((response) => setState({ status: 'ready', data: response.data }))
      .catch((error) => {
        if (isCancel(error)) return;
        if (error?.response?.status === 404 || error?.response?.status === 400) {
          setState({ status: 'not-found' });
          return;
        }
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [slug, scope]);

  const scopeName = state.status === 'ready' ? state.data.scope.name : undefined;
  const kicker = scope === 'field' ? 'Research field' : 'Research area';

  useDocumentTitle(scopeName ? `${scopeName} research at Yale` : `${kicker}`);

  const browseHref = useMemo(
    () => (scopeName ? `/research?researchAreas=${encodeURIComponent(scopeName)}` : '/research'),
    [scopeName],
  );

  if (state.status === 'loading') {
    return (
      <div
        role="status"
        aria-label={`Loading ${kicker.toLowerCase()}`}
        className="mx-auto flex w-full max-w-screen-2xl justify-center px-4 py-16"
      >
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    );
  }

  if (state.status === 'not-found') return <NotFound />;

  if (state.status === 'error') {
    return (
      <div className="mx-auto w-full max-w-screen-2xl px-4 py-16">
        <h1 className="text-xl font-semibold text-gray-950">We could not load this {kicker.toLowerCase()}</h1>
        <p className="mt-2 text-sm text-gray-600">Something went wrong. Please try again.</p>
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
  const dotClass = colorKeyToDotClass[data.scope.colorKey] ?? colorKeyToDotClass.gray;
  const hasHomes = data.buckets.length > 0;
  const hasWaysIn = data.waysIn.researchEntities.length > 0;

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:py-8 lg:px-8">
      <div className="lg:mx-auto lg:w-full lg:max-w-5xl">
        <nav className="text-sm">
          <Link to="/research" className="yr-link yr-focus-ring rounded-sm">
            ← Explore Research
          </Link>
        </nav>

        <header className="yr-panel mt-4 rounded-md p-5 sm:p-6">
          <p className="yr-kicker text-[0.72rem]">{kicker}</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold leading-tight text-gray-950 sm:text-3xl">
            <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${dotClass}`} />
            <span>{data.scope.name}</span>
          </h1>
          {scope === 'area' && data.scope.field && (
            <p className="mt-1 text-sm text-gray-500">
              Part of{' '}
              <Link to={researchFieldPath(data.scope.field)} className="yr-link yr-focus-ring rounded-sm">
                {data.scope.field}
              </Link>
            </p>
          )}
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
            Labs, centers, programs, and collections working in {data.scope.name}, plus the
            documented ways undergraduates join research here. Everything shown is already published
            for students; anything not documented is left out rather than guessed.
          </p>
          <Link
            to={browseHref}
            className="yr-focus-ring mt-4 inline-flex min-h-11 items-center rounded-md border border-blue-200 bg-[var(--yr-panel)] px-3 py-2 text-sm font-semibold text-[var(--yr-blue)] transition-colors hover:border-blue-300 hover:bg-[var(--yr-blue-soft)]"
          >
            Browse {data.scope.name} in search →
          </Link>
        </header>

        {!hasHomes ? (
          <section aria-label="No research homes" className="yr-card mt-6 rounded-md p-6">
            <h2 className="text-lg font-semibold text-gray-950">No research homes indexed yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              We do not have any published research homes for {data.scope.name} yet. You can still
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
            {hasWaysIn && (
              <section aria-labelledby="area-ways-in-heading" className="mt-8">
                <h2 id="area-ways-in-heading" className="text-lg font-semibold text-gray-950">
                  Ways into {data.scope.name} research ({data.waysIn.totalCount})
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
                  Research homes in {data.scope.name} that document a way in right now: posted
                  openings, recurring programs, application forms, or course-credit pathways.
                </p>
                <HomeCardGrid researchEntities={data.waysIn.researchEntities} />
              </section>
            )}

            <section aria-labelledby="area-homes-heading" className="mt-10">
              <h2 id="area-homes-heading" className="text-lg font-semibold text-gray-950">
                Research homes ({data.totalCount})
              </h2>
              <div className="mt-4">
                {data.buckets.map((bucket) => (
                  <BucketSection key={bucket.key} bucket={bucket} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export const ResearchAreaPage = () => <ResearchArea scope="area" />;
export const ResearchFieldPage = () => <ResearchArea scope="field" />;

export default ResearchArea;
