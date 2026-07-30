import type {
  UndergraduateLogisticsClaim,
  UndergraduateLogisticsPayload,
} from '../../types/labDetail';
import { safeHttpUrl } from '../../utils/url';

const CLAIM_LABELS: Record<UndergraduateLogisticsClaim['claimType'], string> = {
  STUDENT_LEVEL: 'Eligible years',
  COMPENSATION: 'Compensation or credit',
  TIME_COMMITMENT: 'Time commitment',
  MODALITY: 'Modality',
  CURRENT_AVAILABILITY: 'Current availability',
};

const VALUE_LABELS: Record<string, string> = {
  FIRST_YEAR: 'First-year',
  SOPHOMORE: 'Sophomore',
  JUNIOR: 'Junior',
  SENIOR: 'Senior',
  PAID: 'Paid',
  STIPEND: 'Stipend',
  COURSE_CREDIT: 'Course credit',
  VOLUNTEER: 'Volunteer',
  WORK_STUDY: 'Work-study',
  FELLOWSHIP: 'Fellowship-funded',
  IN_PERSON: 'In person',
  HYBRID: 'Hybrid',
  REMOTE: 'Remote',
  OPEN: 'Open now',
  ROLLING: 'Rolling',
  NOT_CURRENTLY_AVAILABLE: 'Not currently available',
};

export const formatUndergraduateLogisticsValue = (
  claim: UndergraduateLogisticsClaim,
): string | null => {
  const value = claim.value;
  if (!value) return null;
  if (claim.claimType === 'STUDENT_LEVEL') {
    return value.levels?.map((item) => VALUE_LABELS[item] || item).join(', ') || null;
  }
  if (claim.claimType === 'COMPENSATION' || claim.claimType === 'MODALITY') {
    return value.modes?.map((item) => VALUE_LABELS[item] || item).join(', ') || null;
  }
  if (claim.claimType === 'CURRENT_AVAILABILITY') {
    return value.status ? VALUE_LABELS[value.status] || value.status : null;
  }
  const min = value.minHours;
  const max = value.maxHours;
  if (typeof min === 'number' && typeof max === 'number') {
    return min === max ? `${min} hours per week` : `${min}-${max} hours per week`;
  }
  if (typeof min === 'number') return `At least ${min} hours per week`;
  if (typeof max === 'number') return `Up to ${max} hours per week`;
  return null;
};

const reviewMessage = (claim: UndergraduateLogisticsClaim): string =>
  claim.state === 'conflicting_withheld'
    ? 'Conflicting official evidence is under review. No value is shown.'
    : 'The latest evidence is stale and is being reviewed. No value is shown.';

export const UndergraduateLogisticsSection = ({
  logistics,
}: {
  logistics?: UndergraduateLogisticsPayload;
}) => {
  if (!logistics || logistics.status === 'unavailable') {
    return (
      <section aria-labelledby="undergraduate-logistics-heading">
        <h2
          id="undergraduate-logistics-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-600"
        >
          Undergraduate logistics
        </h2>
        <div className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
          <p className="text-sm text-gray-700">
            Logistics could not be loaded. The rest of this research profile is still available.
          </p>
        </div>
      </section>
    );
  }

  const known = logistics.claims.filter(
    (claim) => claim.state === 'known' && Boolean(formatUndergraduateLogisticsValue(claim)),
  );
  const underReview = logistics.claims.filter(
    (claim) => claim.state === 'stale_under_review' || claim.state === 'conflicting_withheld',
  );
  const unknownCount = logistics.claims.filter((claim) => claim.state === 'unknown').length;

  return (
    <section aria-labelledby="undergraduate-logistics-heading">
      <h2
        id="undergraduate-logistics-heading"
        className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-600"
      >
        Undergraduate logistics
      </h2>
      {known.length === 0 && underReview.length === 0 ? (
        <div className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
          <p className="text-sm leading-relaxed text-gray-700">
            These logistics are not documented on an official source yet. This does not mean the
            research home is unavailable.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {known.map((claim) => {
              const sourceUrl = safeHttpUrl(claim.evidence?.sourceUrl);
              return (
                <article
                  key={claim.claimType}
                  className="min-w-0 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {CLAIM_LABELS[claim.claimType]}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {formatUndergraduateLogisticsValue(claim)}
                  </p>
                  {claim.evidence?.excerpt && (
                    <p className="mt-2 text-sm leading-relaxed text-gray-600">
                      {claim.evidence.excerpt}
                    </p>
                  )}
                  {sourceUrl && (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 hover:text-blue-900"
                    >
                      Official evidence
                    </a>
                  )}
                </article>
              );
            })}
            {underReview.map((claim) => (
              <article
                key={claim.claimType}
                className="min-w-0 rounded-md border border-amber-200 bg-amber-50 p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  {CLAIM_LABELS[claim.claimType]}
                </p>
                <p className="mt-1 text-sm text-amber-950">{reviewMessage(claim)}</p>
              </article>
            ))}
          </div>
          {unknownCount > 0 && (
            <p className="text-sm text-gray-600">
              {unknownCount === logistics.claims.length
                ? 'Logistics are not documented yet.'
                : 'Other logistics are not documented yet. Missing details are unknown, not negative answers.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
