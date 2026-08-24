import { useEffect, useMemo, useReducer, useRef } from 'react';
import { isCancel } from 'axios';
import { Link, useParams } from 'react-router-dom';
import axios from '../utils/axios';
import {
  createInitialResearchPersonState,
  researchPersonReducer,
} from '../reducers/researchPersonReducer';
import { ResearcherProfilePayload } from '../types/researcherProfile';
import ResearchHomeCard from '../components/research/ResearchHomeCard';
import NotFound from './notFound';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { buildGroupedSearchResults } from '../utils/researchDiscoveryAdapters';
import { EXTERNAL_LINK_REL, safeHttpUrl } from '../utils/url';

const IdentityLink = ({ href, label }: { href: string | undefined; label: string }) => {
  const safeHref = safeHttpUrl(href);
  if (!safeHref) return null;
  return (
    <a
      href={safeHref}
      target="_blank"
      rel={EXTERNAL_LINK_REL}
      className="inline-flex min-h-11 items-center rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 py-2 text-sm font-semibold text-[var(--yr-blue)] transition-colors hover:border-blue-300 hover:bg-[var(--yr-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
    >
      {label}
    </a>
  );
};

const ResearchPerson = () => {
  const { publicKey, id } = useParams<{ publicKey?: string; id?: string }>();
  const personRef = id ?? publicKey;
  const endpoint = id ? `/research/researchers/${id}` : `/research/person/${publicKey}`;
  const [state, dispatch] = useReducer(
    researchPersonReducer,
    undefined,
    createInitialResearchPersonState,
  );
  const { payload, loading, error, notFound } = state;
  const fetchAbortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useDocumentTitle(payload?.displayName ? `${payload.displayName} - Yale Research` : 'Researcher');

  useEffect(() => {
    if (!personRef) return;
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = controller;
    dispatch({ type: 'FETCH_START' });
    axios
      .get<ResearcherProfilePayload>(endpoint, { signal: controller.signal })
      .then((res) => {
        if (requestId !== requestIdRef.current) return;
        dispatch({ type: 'FETCH_SUCCESS', payload: res.data });
      })
      .catch((err) => {
        if (isCancel(err) || requestId !== requestIdRef.current) return;
        if (err?.response?.status === 404 || err?.response?.status === 400) {
          dispatch({ type: 'FETCH_NOT_FOUND' });
        } else {
          dispatch({ type: 'FETCH_FAILURE', payload: 'Failed to load this researcher.' });
        }
      });
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, [personRef, endpoint]);

  const clusters = useMemo(
    () =>
      payload
        ? buildGroupedSearchResults({ query: '', researchEntities: payload.homes, pathways: [] })
            .clusters
        : [],
    [payload],
  );

  if (loading && !payload) {
    return (
      <div
        role="status"
        aria-label="Loading researcher"
        className="mx-auto flex max-w-6xl justify-center px-4 py-16"
      >
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    );
  }

  if (notFound) return <NotFound />;

  if (error && !payload) {
    return (
      <div className="yr-page flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-14">
        <div className="yr-panel max-w-md rounded-md p-6 text-center">
          <h2 className="mb-4 text-2xl font-semibold leading-tight text-slate-950">{error}</h2>
          <p className="mb-8 text-slate-600">
            Something went wrong loading this researcher. Please try again, or head back to Explore
            Research to keep looking.
          </p>
          <Link
            to="/research"
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--yr-blue)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Explore Yale Research
          </Link>
        </div>
      </div>
    );
  }

  if (!payload) return null;

  const affiliationLine = [payload.primaryDepartment, payload.school]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:py-8 lg:px-8">
      <div className="lg:mx-auto lg:w-full lg:max-w-5xl space-y-6 sm:space-y-8">
        <nav className="text-sm">
          <Link to="/research" className="yr-link yr-focus-ring rounded-sm">
            ← Explore Research
          </Link>
        </nav>

        <header className="yr-panel rounded-md p-5 sm:p-6">
          <p className="yr-kicker text-[0.68rem]">Researcher</p>
          <h1 className="mt-1 text-2xl font-semibold leading-tight text-gray-950 sm:text-3xl">
            {payload.displayName}
          </h1>
          {payload.title && (
            <p className="mt-1 text-sm font-medium text-gray-700">{payload.title}</p>
          )}
          {affiliationLine && <p className="mt-1 text-sm text-gray-500">{affiliationLine}</p>}
          {(payload.officialProfileUrl || payload.scholarUrl || payload.orcidUrl) && (
            <div className="mt-4 flex flex-wrap gap-2">
              <IdentityLink href={payload.officialProfileUrl} label="View official profile" />
              <IdentityLink href={payload.scholarUrl} label="Google Scholar" />
              <IdentityLink href={payload.orcidUrl} label="ORCID" />
            </div>
          )}
        </header>

        <section aria-labelledby="research-homes-heading" className="space-y-4">
          <h2
            id="research-homes-heading"
            className="text-xs font-semibold uppercase tracking-wider text-gray-600"
          >
            Research homes at Yale
          </h2>
          {clusters.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {clusters.map((cluster) => (
                <ResearchHomeCard key={cluster.id} home={cluster} />
              ))}
            </div>
          ) : (
            <p className="yr-panel rounded-md p-4 text-sm text-gray-600">
              No public research homes are listed for this researcher yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
};

export default ResearchPerson;
