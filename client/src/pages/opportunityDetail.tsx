import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { isCancel } from 'axios';
import { Link, useParams } from 'react-router-dom';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import LongText from '../components/shared/LongText';
import axios from '../utils/axios';
import { OpportunityDetailPayload } from '../types/opportunity';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { EXTERNAL_LINK_REL, safeHttpUrl, safeHttpUrlList } from '../utils/url';

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
      return 'yr-pill-green';
    case 'CLOSED':
    case 'ARCHIVED':
      return '';
    default:
      return 'yr-pill-gold';
  }
};

const uniq = (values: Array<string | undefined>): string[] =>
  Array.from(
    new Set(values.filter((value): value is string => !!value && value.trim().length > 0)),
  );

const DetailField: FC<{ label: string; value?: string | number }> = ({ label, value }) => {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="border-t border-[var(--yr-line)] py-3 first:border-t-0 first:pt-0">
      <dt className="yr-kicker text-[0.68rem]">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-950">{value}</dd>
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
  useDocumentTitle(opportunity?.title || 'Posted opportunity');

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

    return safeHttpUrlList([...opportunitySourceUrls, ...pathwaySourceUrls, ...evidenceSourceUrls]);
  }, [opportunity]);

  if (loading) {
    return (
      <div className="yr-page mx-auto max-w-5xl px-4 py-16">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !opportunity) {
    return (
      <div className="yr-page flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-16">
        <div className="yr-panel max-w-lg rounded-md p-6 text-center">
          <p className="yr-kicker mb-3">Posted opportunity</p>
          <h1 className="text-2xl font-semibold text-slate-950">
            {error || 'Opportunity not found.'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            This page only shows real posted openings that are still present in the research access
            model.
          </p>
          <Link
            to="/research"
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Browse Yale Research
          </Link>
        </div>
      </div>
    );
  }

  const applicationUrl = safeHttpUrl(opportunity.applicationUrl);

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
  const opportunityKindLabel =
    opportunity.provenance === 'LISTING_BRIDGED' ? 'Listing-derived signal' : 'Posted opportunity';

  return (
    <div className="yr-page min-h-[calc(100vh-8rem)]">
      <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link
          to="/research"
          className="yr-link inline-flex min-h-[44px] items-center rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          Back to Yale Research
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <article className="lg:col-span-2 space-y-8">
          <header className="yr-panel rounded-md p-5">
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="yr-pill yr-pill-blue min-h-0 rounded px-2 py-1">
                {labelize(opportunity.status)}
              </span>
              <span
                className={`yr-pill min-h-0 rounded px-2 py-1 ${applicationStateTone(
                  opportunity.applicationState,
                )}`}
              >
                {opportunity.applicationLabel}
              </span>
              {opportunity.term && (
                <span className="yr-pill min-h-0 rounded px-2 py-1">
                  {opportunity.term}
                </span>
              )}
              <span className="yr-pill yr-pill-green min-h-0 rounded px-2 py-1">
                {opportunityKindLabel}
              </span>
              <span className="yr-pill min-h-0 rounded px-2 py-1">
                {opportunity.provenanceLabel}
              </span>
            </div>
            <h1 className="text-3xl font-semibold text-slate-950 leading-tight">{opportunity.title}</h1>
            <Link
              to={researchLink}
              className="yr-link inline-flex mt-3 text-base font-semibold"
            >
              {researchDisplayName}
            </Link>
            {entity?.shortDescription && (
              <LongText
                text={entity.shortDescription}
                className="mt-4 text-sm leading-relaxed text-gray-600"
              />
            )}
            {opportunity.description && (
              <LongText
                text={opportunity.description}
                className="mt-4 border-t border-[var(--yr-line)] pt-4 text-sm leading-relaxed text-slate-700"
              />
            )}
          </header>

          <section>
            <h2 className="yr-kicker mb-3">
              Best Next Step
            </h2>
            <div className="yr-card rounded-md p-4">
              <p className="text-sm font-semibold text-gray-900">
                {pathway?.bestNextStep || 'Use the official application route when available.'}
              </p>
              {pathway?.explanation && (
                <LongText
                  text={pathway.explanation}
                  className="mt-2 text-sm leading-relaxed text-gray-600"
                />
              )}
              {(opportunity.applicationState === 'APPLY_NOW' ||
                opportunity.applicationState === 'ROLLING') &&
                applicationUrl && (
                  <a
                    href={applicationUrl}
                    target="_blank"
                    rel={EXTERNAL_LINK_REL}
                    className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--yr-blue)] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
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
              <h2 className="yr-kicker mb-3">
                Eligibility and Compensation
              </h2>
              <div className="yr-card rounded-md p-4 space-y-3">
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
            <h2 className="yr-kicker mb-3">
              Evidence
            </h2>
            <div className="yr-card rounded-md p-4">
              {evidence.length > 0 ? (
                <div className="space-y-3">
                  {evidence.map((item, index) => {
                    const evidenceSourceUrl = safeHttpUrl(item.sourceUrl);
                    return (
                      <div
                        key={`${item.sourceUrl || item.sourceName || 'evidence'}-${index}`}
                        className="border-t border-[var(--yr-line)] pt-3 first:border-t-0 first:pt-0"
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
                          <p className="mt-1 text-sm leading-relaxed text-gray-600">
                            {item.excerpt}
                          </p>
                        )}
                        {evidenceSourceUrl && (
                          <a
                            href={evidenceSourceUrl}
                            target="_blank"
                            rel={EXTERNAL_LINK_REL}
                            className="yr-link mt-1 inline-flex min-h-[44px] items-center rounded-md text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                          >
                            Open source
                          </a>
                        )}
                      </div>
                    );
                  })}
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
          <div className="yr-panel lg:sticky lg:top-8 rounded-md p-5">
            <h2 className="text-sm font-semibold text-slate-950 mb-4">Opportunity Details</h2>
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
              <div className="border-t border-[var(--yr-line)] pt-4 mt-1">
                <h3 className="yr-kicker">
                  Sources
                </h3>
                <div className="mt-2 flex flex-col gap-2">
                  {sourceUrls.slice(0, 5).map((url, index) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel={EXTERNAL_LINK_REL}
                      className="yr-link inline-flex min-h-[44px] items-center rounded-md text-sm font-medium break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
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
    </div>
  );
};

export default OpportunityDetail;
