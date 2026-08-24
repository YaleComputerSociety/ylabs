import { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from '../../utils/axios';
import { safeMailtoHref, safeRouteSegment } from '../../utils/url';
import { composeStudentFollowUpEmailDraft } from '../../utils/introEmailComposer';

export interface FollowUpNudgeData {
  entityName: string;
  daysSinceOutreach: number;
  followUpsSent: number;
  recipientEmail?: string;
  leadName?: string;
}

interface FollowUpNudgeProps {
  entityId: string;
  slug: string;
  displayName: string;
  followUp: FollowUpNudgeData;
  onSent: (entityId: string) => void;
  onDismissed: (entityId: string) => void;
}

const followUpCopy = (days: number): string => {
  if (days <= 0) return 'A short, polite follow-up is completely normal.';
  const dayLabel = days === 1 ? '1 day' : `${days} days`;
  return `It has been ${dayLabel} since you reached out - a short, polite follow-up is completely normal.`;
};

const FollowUpNudge = ({
  entityId,
  slug,
  displayName,
  followUp,
  onSent,
  onDismissed,
}: FollowUpNudgeProps) => {
  const [isDismissing, setIsDismissing] = useState(false);
  const [dismissFailed, setDismissFailed] = useState(false);

  const draft = composeStudentFollowUpEmailDraft({
    entityName: followUp.entityName,
    leadName: followUp.leadName,
  });
  const mailtoHref = followUp.recipientEmail
    ? safeMailtoHref(followUp.recipientEmail, { subject: draft.subject, body: draft.body })
    : '';

  const recordFollowUp = () => {
    if (!slug) return;
    void axios
      .post(`/research/${slug}/outreach`, {
        deliveryMethod: 'mailto',
        emailGeneratedByPlatform: draft.generatedByPlatform,
        templateVersion: draft.templateVersion,
      })
      .catch(() => {});
    onSent(entityId);
  };

  const dismiss = async () => {
    setIsDismissing(true);
    setDismissFailed(false);
    try {
      await axios.post(`/users/savedResearchFollowUps/${entityId}/dismiss`);
      onDismissed(entityId);
    } catch {
      console.error('Error dismissing follow-up nudge.');
      setDismissFailed(true);
      setIsDismissing(false);
    }
  };

  return (
    <div className="mt-3 rounded-md border border-blue-100 bg-[var(--yr-blue-soft)] p-3">
      <p className="text-xs font-semibold text-blue-800">Send a follow-up</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-700">{followUpCopy(followUp.daysSinceOutreach)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {mailtoHref ? (
          <a
            href={mailtoHref}
            onClick={recordFollowUp}
            className="inline-flex min-h-[44px] items-center rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
          >
            Send a follow-up to {displayName}
          </a>
        ) : (
          <Link
            to={`/research/${safeRouteSegment(slug)}`}
            onClick={recordFollowUp}
            className="inline-flex min-h-[44px] items-center rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
          >
            Open {displayName} to follow up
          </Link>
        )}
        <button
          type="button"
          onClick={() => void dismiss()}
          disabled={isDismissing}
          className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line)] px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-[var(--yr-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDismissing ? 'Dismissing...' : 'Not now'}
        </button>
      </div>
      {dismissFailed && (
        <p className="mt-1 text-xs text-red-700" role="alert">
          Could not dismiss. Check your connection or sign in again, then retry.
        </p>
      )}
    </div>
  );
};

export default FollowUpNudge;
