import type {
  ResearchDetailOperatorPreview,
  ResearchDetailWithholdingCheck,
} from '../../types/labDetail';

const TIER_LABELS: Record<string, string> = {
  student_ready: 'Ready',
  limited_but_safe: 'Limited',
  operator_review: 'Review',
  suppressed: 'Suppressed',
};

const WITHHOLDING_CHECK_LABELS: Record<ResearchDetailWithholdingCheck, string> = {
  visibility_tier: 'Visibility tier is not public',
  deceased_lead: 'Lead is recorded as deceased',
  description_invariant: 'Description fails the public description check',
};

const humanizeReason = (reason: string): string => reason.replace(/[_-]+/g, ' ').trim();

const humanizeReasons = (reasons: string[] | undefined): string[] =>
  (reasons ?? []).map(humanizeReason).filter(Boolean);

const OperatorPreviewNotice = ({ preview }: { preview: ResearchDetailOperatorPreview }) => {
  const tierLabel = TIER_LABELS[preview.studentVisibilityTier] ?? preview.studentVisibilityTier;
  const blockingReasons = humanizeReasons(preview.studentVisibilityBlockingReasons);
  const signalReasons = humanizeReasons(preview.studentVisibilitySignalReasons);
  const hasGateReasons = blockingReasons.length > 0 || signalReasons.length > 0;

  return (
    <section
      aria-label="Admin preview"
      className="mb-4 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-semibold">
        Admin preview: students cannot see this page. Tier: {tierLabel}.
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5">
        {preview.withheldBy.map((check) => (
          <li key={check}>{WITHHOLDING_CHECK_LABELS[check] ?? check}</li>
        ))}
      </ul>
      {preview.studentVisibilitySuppressionReason && (
        <p className="mt-2">Suppression reason: {preview.studentVisibilitySuppressionReason}</p>
      )}
      {hasGateReasons && (
        <p className="mt-2">
          <span className="font-medium">Held because:</span>{' '}
          {blockingReasons.length > 0
            ? blockingReasons.join(', ')
            : 'no blocking reason is recorded, only the signals below.'}
        </p>
      )}
      {signalReasons.length > 0 && (
        <p className="mt-1 text-amber-800">
          <span className="font-medium">Signals:</span> {signalReasons.join(', ')}
        </p>
      )}
    </section>
  );
};

export default OperatorPreviewNotice;
