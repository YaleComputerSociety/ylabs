/**
 * Research detail page rendered at `/research/:slug`.
 *
 * Smart-component responsibilities:
 *   - Resolve the slug from the URL and fetch the detail payload from
 *     `GET /api/research/:slug` via the labDetailReducer.
 *   - Compose the small presentational components in `components/labs/`.
 *   - Own the "Inquire" modal toggle (delegated to the reducer so the
 *     transitions are pure and testable).
 *
 * No business logic lives in the layout components themselves — they take
 * props and render. This keeps the page consistent with the
 * `pages/profile.tsx` pattern.
 */
import { useEffect, useReducer, useRef } from 'react';
import { isCancel } from 'axios';
import { Link, useParams } from 'react-router-dom';
import axios from '../utils/axios';
import {
  createInitialLabDetailState,
  labDetailReducer,
} from '../reducers/labDetailReducer';
import LabHeader from '../components/labs/LabHeader';
import LabMembersList from '../components/labs/LabMembersList';
import LabPapersList from '../components/labs/LabPapersList';
import LabActiveListings from '../components/labs/LabActiveListings';
import LabInquireCard from '../components/labs/LabInquireCard';
import LabInquireModal from '../components/labs/LabInquireModal';
import {
  LabAccessSignal,
  LabContactRoute,
  LabEntryPathway,
  LabPostedOpportunity,
} from '../types/labDetail';
import { normalizeResearchEntityDetailPayload } from '../types/researchEntity';
import {
  buildResearchDetailSources,
  labelizeResearchDetailValue,
  ResearchDetailSource,
} from '../utils/researchDetailSources';

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
    {children}
  </h2>
);

const labelize = labelizeResearchDetailValue;

const sourceHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const WaysInSection = ({
  pathways,
  postedOpportunities,
}: {
  pathways: LabEntryPathway[];
  postedOpportunities: LabPostedOpportunity[];
}) => {
  if (pathways.length === 0 && postedOpportunities.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No evidence-backed pathways have been materialized for this research profile yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {pathways.slice(0, 5).map((pathway) => {
        const posted = postedOpportunities.find((item) => item.entryPathwayId === pathway._id);
        return (
          <article key={pathway._id} className="border border-gray-200 rounded-md p-4 bg-white">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="font-semibold text-gray-900">{pathway.studentFacingLabel}</h3>
              <span className="text-xs bg-blue-50 text-blue-700 rounded px-2 py-0.5">
                {labelize(pathway.pathwayType)}
              </span>
              <span className="text-xs bg-gray-100 text-gray-700 rounded px-2 py-0.5">
                {posted ? 'Posted role' : 'Exploratory pathway'}
              </span>
            </div>
            {pathway.explanation && (
              <p className="text-sm text-gray-600 leading-relaxed">{pathway.explanation}</p>
            )}
            <p className="text-sm text-gray-800 mt-2">
              <span className="font-semibold">Best Next Step:</span>{' '}
              {pathway.bestNextStep || 'Review the evidence and official route before reaching out.'}
            </p>
            <div className="flex flex-wrap gap-2 mt-3 text-xs text-gray-600">
              <span className="bg-gray-50 border border-gray-100 rounded px-2 py-1">
                {labelize(pathway.evidenceStrength)} evidence
              </span>
              <span className="bg-gray-50 border border-gray-100 rounded px-2 py-1">
                {labelize(pathway.compensation)}
              </span>
              {(pathway.sourceUrls?.length ?? 0) > 0 && (
                <span className="bg-gray-50 border border-gray-100 rounded px-2 py-1">
                  Evidence-backed
                </span>
              )}
              {typeof pathway.confidence === 'number' && (
                <span className="bg-gray-50 border border-gray-100 rounded px-2 py-1">
                  {Math.round(pathway.confidence * 100)}% confidence
                </span>
              )}
            </div>
            {posted && (
              <Link
                to={`/opportunities/${posted._id}`}
                className="inline-flex mt-3 text-sm font-semibold text-blue-700 hover:text-blue-900 underline underline-offset-2"
              >
                View posted opportunity
              </Link>
            )}
          </article>
        );
      })}
    </div>
  );
};

const EvidenceSection = ({ signals }: { signals: LabAccessSignal[] }) => {
  if (signals.length === 0) {
    return <p className="text-sm text-gray-500">No access evidence is attached yet.</p>;
  }

  return (
    <div className="space-y-3">
      {signals.slice(0, 5).map((signal) => (
        <article key={signal._id} className="border border-gray-200 rounded-md p-4 bg-white">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="font-semibold text-gray-900">{labelize(signal.signalType)}</span>
            <span className="text-xs bg-gray-100 text-gray-700 rounded px-2 py-0.5">
              {labelize(signal.confidence)}
            </span>
            {typeof signal.confidenceScore === 'number' && (
              <span className="text-xs bg-gray-100 text-gray-700 rounded px-2 py-0.5">
                {Math.round(signal.confidenceScore * 100)}% confidence
              </span>
            )}
          </div>
          {signal.excerpt && <p className="text-sm text-gray-600 leading-relaxed">{signal.excerpt}</p>}
        </article>
      ))}
    </div>
  );
};

const SourcesSection = ({ sources }: { sources: ResearchDetailSource[] }) => {
  if (sources.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <p className="text-sm text-gray-600">
          These official pages support the pathways, evidence, and contact routes shown above.
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {sources.map((source) => (
          <article key={source.url} className="px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{source.label}</h3>
                <p className="mt-1 break-all text-xs text-gray-500">{sourceHost(source.url)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {source.contexts.map((context) => (
                    <span
                      key={context}
                      className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600"
                    >
                      {context}
                    </span>
                  ))}
                </div>
              </div>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-gray-300 px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Open source
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

const BestNextStepSection = ({
  pathways,
  contactRoutes,
}: {
  pathways: LabEntryPathway[];
  contactRoutes: LabContactRoute[];
}) => {
  const pathway = pathways.find((item) => item.bestNextStep) || pathways[0];
  const route = contactRoutes[0];

  if (!pathway && !route) {
    return (
      <p className="text-sm text-gray-500">
        No recommended next step is available yet. Check active opportunities and official profile links.
      </p>
    );
  }

  return (
    <div className="border border-gray-200 rounded-md p-4 bg-white">
      {pathway && (
        <p className="text-sm text-gray-800">
          <span className="font-semibold">{pathway.studentFacingLabel}:</span>{' '}
          {pathway.bestNextStep || 'Use the strongest available evidence before taking action.'}
        </p>
      )}
      {route && (
        <div className="mt-3 text-sm text-gray-700">
          <p>
            <span className="font-semibold">Preferred route:</span>{' '}
            {route.label || route.name || labelize(route.routeType)}
          </p>
          {route.rationale && <p className="text-gray-600 mt-1">{route.rationale}</p>}
          {route.url && (
            <a
              href={route.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex mt-2 text-sm font-semibold text-blue-700 hover:text-blue-900 underline underline-offset-2"
            >
              Open official route
            </a>
          )}
        </div>
      )}
    </div>
  );
};

const LabDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const [state, dispatch] = useReducer(
    labDetailReducer,
    undefined,
    () => createInitialLabDetailState(),
  );
  const { payload, loading, error, isInquireModalOpen } = state;
  const requestIdRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!slug) return;
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    fetchAbortRef.current?.abort();
    fetchAbortRef.current = controller;
    dispatch({ type: 'FETCH_START' });
    axios
      .get(`/research/${slug}`, { signal: controller.signal })
      .then((res) => {
        if (requestId !== requestIdRef.current || controller.signal.aborted) return;
        dispatch({
          type: 'FETCH_SUCCESS',
          payload: normalizeResearchEntityDetailPayload(res.data),
        });
      })
      .catch((err) => {
        if (isCancel(err) || requestId !== requestIdRef.current) return;
        if (err?.response?.status === 404) {
          dispatch({ type: 'FETCH_FAILURE', payload: 'Research profile not found.' });
        } else {
          dispatch({ type: 'FETCH_FAILURE', payload: 'Failed to load this research profile.' });
        }
      });
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, [slug]);

  if (loading && !payload) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 flex justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 text-center">
        <h2 className="text-xl font-semibold text-gray-800">{error}</h2>
        <p className="text-gray-500 mt-2">
          The research profile you're looking for may not exist or may have been removed.
        </p>
      </div>
    );
  }

  if (!payload) return null;

  const {
    group: legacyGroup,
    researchEntity,
    members,
    recentPapers,
    recentArxivPreprints = [],
    activeListings,
    contactRoutes = [],
    entryPathways = [],
    accessSignals = [],
    postedOpportunities = [],
  } = payload;
  const group = legacyGroup ?? researchEntity;
  const hasActiveListing = (activeListings?.length ?? 0) > 0;
  const sources = buildResearchDetailSources({
    group,
    pathways: entryPathways,
    accessSignals,
    contactRoutes,
    postedOpportunities,
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-10">
          <LabHeader group={group} hasActiveListing={hasActiveListing} />

          <section>
            <SectionHeading>Ways In</SectionHeading>
            <WaysInSection
              pathways={entryPathways}
              postedOpportunities={postedOpportunities}
            />
          </section>

          <section>
            <SectionHeading>Evidence</SectionHeading>
            <EvidenceSection signals={accessSignals} />
          </section>

          <section>
            <SectionHeading>Best Next Step</SectionHeading>
            <BestNextStepSection pathways={entryPathways} contactRoutes={contactRoutes} />
          </section>

          {sources.length > 0 && (
            <section>
              <SectionHeading>Sources</SectionHeading>
              <SourcesSection sources={sources} />
            </section>
          )}

          <section>
            <SectionHeading>Active Opportunities</SectionHeading>
            <LabActiveListings listings={activeListings} />
          </section>

          <section>
            <SectionHeading>People</SectionHeading>
            <LabMembersList members={members} />
          </section>

          <section>
            <SectionHeading>Recent Papers</SectionHeading>
            <LabPapersList papers={recentPapers} />
          </section>

          <section>
            <SectionHeading>Recent Research</SectionHeading>
            <LabPapersList
              papers={recentArxivPreprints}
              emptyText="No recent arXiv preprints found for this research profile."
              showPreprintMeta
            />
          </section>

        </div>

        <aside className="lg:col-span-1">
          <div className="lg:sticky lg:top-8">
            <LabInquireCard
              group={group}
              members={members}
              contactRoutes={contactRoutes}
              hasActiveListing={hasActiveListing}
              onInquire={() => dispatch({ type: 'OPEN_INQUIRE_MODAL' })}
            />
          </div>
        </aside>
      </div>

      <LabInquireModal
        isOpen={isInquireModalOpen}
        onClose={() => dispatch({ type: 'CLOSE_INQUIRE_MODAL' })}
        group={group}
        members={members}
      />
    </div>
  );
};

export default LabDetail;
