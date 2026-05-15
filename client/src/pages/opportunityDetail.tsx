import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { isCancel } from 'axios';
import { Link, useParams } from 'react-router-dom';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import axios from '../utils/axios';
import { OpportunityDetailPayload } from '../types/opportunity';

const labelize = (value?: string): string =>
  (value || 'Unknown')
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const formatDate = (value?: string): string => {
  if (!value) return 'Not listed';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not listed';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
};

const deadlineStateLabel = (value?: string): string => {
  switch (value) {
    case 'UPCOMING':
      return 'Upcoming deadline';
    case 'DUE_TODAY':
      return 'Due today';
    case 'PAST':
      return 'Past deadline';
    case 'ARCHIVED':
      return 'Archived';
    case 'NO_DEADLINE':
    default:
      return 'No deadline listed';
  }
};

const applicationStateTone = (value?: string): string => {
  switch (value) {
    case 'APPLY_NOW':
    case 'ROLLING':
      return 'bg-emerald-50 text-emerald-700';
    case 'CLOSED':
    case 'ARCHIVED':
      return 'bg-gray-100 text-gray-600';
    default:
      return 'bg-amber-50 text-amber-700';
  }
};

const uniq = (values: Array<string | undefined>): string[] =>
  Array.from(
    new Set(values.filter((value): value is string => !!value && value.trim().length > 0)),
  );

const DetailField: FC<{ label: string; value?: string | number }> = ({ label, value }) => {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="border-t border-gray-100 py-3 first:border-t-0 first:pt-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-gray-900">{value}</dd>
    </div>
  );
};

const OpportunityDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [opportunity, setOpportunity] = useState<OpportunityDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!id) return;
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    fetchAbortRef.current?.abort();
    fetchAbortRef.current = controller;

    setLoading(true);
    setError('');
    axios
      .get<OpportunityDetailPayload>(`/opportunities/${id}`, {
        signal: controller.signal,
      })
      .then((response) => {
        if (requestId !== requestIdRef.current || controller.signal.aborted) return;
        setOpportunity(response.data);
      })
      .catch((err) => {
        if (isCancel(err) || requestId !== requestIdRef.current) return;
        if (err?.response?.status === 404) {
          setError('Opportunity not found.');
        } else {
          setError('Failed to load this opportunity.');
        }
        setOpportunity(null);
      })
      .finally(() => {
        if (requestId === requestIdRef.current && !controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      fetchAbortRef.current?.abort();
    };
  }, [id]);

  const sourceUrls = useMemo(() => {
    const opportunitySourceUrls = Array.isArray(opportunity?.sourceUrls)
      ? opportunity.sourceUrls
      : [];
    const pathwaySourceUrls = Array.isArray(opportunity?.pathway?.sourceUrls)
      ? opportunity?.pathway?.sourceUrls
      : [];
    const evidenceSourceUrls = Array.isArray(opportunity?.evidence)
      ? opportunity.evidence
          .map((item) => item?.sourceUrl)
          .filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];

    return uniq([...opportunitySourceUrls, ...pathwaySourceUrls, ...evidenceSourceUrls]);
  }, [opportunity]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !opportunity) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-gray-900">{error || 'Opportunity not found.'}</h1>
        <p className="mt-2 text-gray-600">
          This page only shows real posted openings that are still present in the research access
          model.
        </p>
        <Link
          to="/pathways"
          className="inline-flex mt-6 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Browse Pathways
        </Link>
      </div>
    );
  }

  const entity = opportunity.researchEntity;
  const pathway = opportunity.pathway;
  const evidence = Array.isArray(opportunity.evidence) ? opportunity.evidence : [];
  const compensation = uniq([
    opportunity.payRate,
    opportunity.compensationType && labelize(opportunity.compensationType),
    pathway?.compensation && labelize(pathway?.compensation),
  ]).join(' / ');
  const researchLink = entity?.slug ? `/research/${entity.slug}` : '/research';
  const researchDisplayName = entity?.displayName || entity?.name || 'Research profile';
  const researchHostType = entity?.entityType || entity?.kind || 'Research home';

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link to="/pathways" className="text-sm font-medium text-blue-700 hover:underline">
          Back to Pathways
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <article className="lg:col-span-2 space-y-8">
          <header className="border-b border-gray-200 pb-6">
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="text-xs font-semibold rounded bg-blue-50 px-2 py-1 text-blue-700">
                {labelize(opportunity.status)}
              </span>
              <span
                className={`text-xs font-semibold rounded px-2 py-1 ${applicationStateTone(
                  opportunity.applicationState,
                )}`}
              >
                {opportunity.applicationLabel}
              </span>
              {opportunity.term && (
                <span className="text-xs font-semibold rounded bg-gray-100 px-2 py-1 text-gray-700">
                  {opportunity.term}
                </span>
              )}
              <span className="text-xs font-semibold rounded bg-emerald-50 px-2 py-1 text-emerald-700">
                Posted opportunity
              </span>
              <span className="text-xs font-semibold rounded bg-slate-100 px-2 py-1 text-slate-700">
                {opportunity.provenanceLabel}
              </span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 leading-tight">{opportunity.title}</h1>
            <Link
              to={researchLink}
              className="inline-flex mt-3 text-base font-semibold text-blue-700 hover:underline"
            >
              {researchDisplayName}
            </Link>
            {entity?.shortDescription && (
              <p className="mt-4 text-sm leading-relaxed text-gray-600">
                {entity.shortDescription}
              </p>
            )}
          </header>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Best Next Step
            </h2>
            <div className="border border-gray-200 rounded-md bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">
                {pathway?.bestNextStep || 'Use the official application route when available.'}
              </p>
              {pathway?.explanation && (
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{pathway.explanation}</p>
              )}
              {(opportunity.applicationState === 'APPLY_NOW' ||
                opportunity.applicationState === 'ROLLING') &&
                opportunity.applicationUrl && (
                  <a
                    href={opportunity.applicationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    {opportunity.applicationLabel}
                  </a>
                )}
              {opportunity.applicationState !== 'APPLY_NOW' &&
                opportunity.applicationState !== 'ROLLING' && (
                  <p className="mt-3 text-sm font-medium text-gray-500">
                    {opportunity.applicationLabel}
                  </p>
                )}
            </div>
          </section>

          {(opportunity.eligibility || compensation) && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                Eligibility and Compensation
              </h2>
              <div className="border border-gray-200 rounded-md bg-white p-4 space-y-3">
                {opportunity.eligibility && (
                  <p className="text-sm leading-relaxed text-gray-700">
                    <span className="font-semibold text-gray-900">Eligibility:</span>{' '}
                    {opportunity.eligibility}
                  </p>
                )}
                {compensation && (
                  <p className="text-sm leading-relaxed text-gray-700">
                    <span className="font-semibold text-gray-900">Compensation:</span>{' '}
                    {compensation}
                  </p>
                )}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Evidence
            </h2>
            <div className="border border-gray-200 rounded-md bg-white p-4">
              {evidence.length > 0 ? (
                <div className="space-y-3">
                  {evidence.map((item) => (
                    <div
                      key={item._id}
                      className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0"
                    >
                      <p className="text-sm font-semibold text-gray-900">
                        {item.sourceName || 'Source evidence'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {item.field ? labelize(item.field) : 'Posting evidence'}
                        {typeof item.confidence === 'number'
                          ? ` | ${Math.round(item.confidence * 100)}% confidence`
                          : ''}
                        {item.observedAt ? ` | Observed ${formatDate(item.observedAt)}` : ''}
                      </p>
                      {item.excerpt && (
                        <p className="mt-1 text-sm leading-relaxed text-gray-600">{item.excerpt}</p>
                      )}
                      {item.sourceUrl && (
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex mt-1 text-xs font-medium text-blue-700 hover:underline"
                        >
                          Open source
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  Source URLs are available, but no observation records are attached yet.
                </p>
              )}
            </div>
          </section>
        </article>

        <aside className="lg:col-span-1">
          <div className="lg:sticky lg:top-8 border border-gray-200 rounded-md bg-white p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4">Opportunity Details</h2>
            <dl>
              <DetailField label="Status" value={labelize(opportunity.status)} />
              <DetailField label="Application" value={opportunity.applicationLabel} />
              <DetailField label="Deadline" value={formatDate(opportunity.deadline)} />
              <DetailField
                label="Deadline state"
                value={deadlineStateLabel(opportunity.deadlineState)}
              />
              <DetailField label="Source type" value={opportunity.provenanceLabel} />
              <DetailField label="Term" value={opportunity.term} />
              <DetailField label="Hours per week" value={opportunity.hoursPerWeek} />
              <DetailField label="Pathway" value={pathway?.studentFacingLabel} />
              <DetailField label="Evidence strength" value={labelize(pathway?.evidenceStrength)} />
              <DetailField label="Host type" value={labelize(researchHostType)} />
              <DetailField label="School" value={entity?.school} />
            </dl>

            {sourceUrls.length > 0 && (
              <div className="border-t border-gray-100 pt-4 mt-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Sources
                </h3>
                <div className="mt-2 flex flex-col gap-2">
                  {sourceUrls.slice(0, 5).map((url, index) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-blue-700 hover:underline break-words"
                    >
                      Source {index + 1}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default OpportunityDetail;
