import { useCallback, useEffect, useState } from 'react';
import axios from '../../utils/axios';
import { safeRouteSegment } from '../../utils/url';
import useLatestRequest from '../../hooks/useLatestRequest';

type ReportStatus = 'unreviewed' | 'accepted' | 'dismissed';

type ReportCategory =
  | 'wrong_description'
  | 'wrong_lead'
  | 'wrong_research_areas'
  | 'stale_availability'
  | 'broken_link'
  | 'not_my_lab'
  | 'other';

type CorrectionReport = {
  _id: string;
  category: ReportCategory;
  status: ReportStatus;
  note?: string;
  reviewerNote?: string;
  entitySlug: string;
  entitySnapshot: { name: string; kind?: string; entityType?: string };
  reporter: { name: string; netId: string; role: string; userType: string };
  createdAt: string;
};

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  wrong_description: 'Wrong description',
  wrong_lead: 'Wrong lead / PI',
  wrong_research_areas: 'Wrong topics',
  stale_availability: 'Stale availability',
  broken_link: 'Broken link',
  not_my_lab: 'Not my lab',
  other: 'Other',
};

const LOAD_ERROR = 'Could not load correction reports.';
const RELOAD_AFTER_REVIEW_ERROR =
  'The review was saved, but the list could not refresh. Try again to see the current queue.';

export default function AdminCorrectionReports() {
  const [status, setStatus] = useState<ReportStatus>('unreviewed');
  const [reports, setReports] = useState<CorrectionReport[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<CorrectionReport | null>(null);
  const [reviewerNote, setReviewerNote] = useState('');
  const [listError, setListError] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const listRequest = useLatestRequest();

  const load = useCallback(
    async (failureMessage: string = LOAD_ERROR) => {
      const request = listRequest.begin();
      setListError('');
      try {
        const { data } = await axios.get(
          `/admin/correction-reports?status=${status}&pageSize=100`,
          { signal: request.signal },
        );
        if (!request.isCurrent()) return;
        setReports(data.reports || []);
        setTotal(data.total || 0);
      } catch {
        if (!request.isCurrent()) return;
        setListError(failureMessage);
      }
    },
    [listRequest, status],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const openReview = (report: CorrectionReport) => {
    setSelected(report);
    setReviewerNote(report.reviewerNote || '');
    setReviewError('');
  };

  const closeReview = () => {
    if (isSaving) return;
    setSelected(null);
    setReviewError('');
  };

  const review = async (nextStatus: Exclude<ReportStatus, 'unreviewed'>) => {
    if (!selected || isSaving) return;
    setIsSaving(true);
    setReviewError('');
    try {
      await axios.put(`/admin/correction-reports/${selected._id}`, {
        status: nextStatus,
        reviewerNote: reviewerNote.trim(),
      });
    } catch (saveError: any) {
      setReviewError(saveError?.response?.data?.error || 'Review could not be saved.');
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    setSelected(null);
    setReviewerNote('');
    await load(RELOAD_AFTER_REVIEW_ERROR);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-ink">Page correction reports</h3>
          <p className="text-sm text-muted">
            {total} {status} reports
          </p>
        </div>
        <label className="text-sm font-medium text-ink">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ReportStatus)}
            className="ml-2 min-h-11 rounded-md border border-line-strong px-3"
          >
            <option value="unreviewed">Unreviewed</option>
            <option value="accepted">Accepted</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>
      </div>
      {listError && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-700">
          <p>{listError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="min-h-11 rounded-md border border-line-strong px-3 font-semibold text-ink-soft yr-focus-ring"
          >
            Try again
          </button>
        </div>
      )}
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {reports.map((report) => (
          <li key={report._id}>
            <button
              type="button"
              onClick={() => openReview(report)}
              className="min-h-14 w-full px-2 py-3 text-left yr-focus-ring"
            >
              <span className="font-semibold text-ink">
                {report.entitySnapshot.name || report.entitySlug}
              </span>
              <span className="ml-2 text-sm text-muted">{CATEGORY_LABELS[report.category]}</span>
              <span className="ml-2 text-xs text-muted">({report.reporter.role})</span>
              {report.note && (
                <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{report.note}</p>
              )}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-review-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeReview();
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md bg-white p-6">
            <h2 id="report-review-title" className="text-lg font-semibold">
              {selected.entitySnapshot.name || selected.entitySlug}
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              {CATEGORY_LABELS[selected.category]} reported by{' '}
              {selected.reporter.name || selected.reporter.netId} ({selected.reporter.role})
            </p>
            <a
              href={`/research/${safeRouteSegment(selected.entitySlug)}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-sm text-brand underline yr-focus-ring"
            >
              Open page
            </a>
            {selected.note && (
              <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{selected.note}</p>
            )}
            <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Recording a decision does not change any page content or visibility. It only logs the
              disposition of this report.
            </p>
            <label htmlFor="report-reviewer-note" className="mt-4 block text-sm font-medium">
              Reviewer note (optional)
            </label>
            <textarea
              id="report-reviewer-note"
              rows={4}
              maxLength={2000}
              value={reviewerNote}
              onChange={(event) => setReviewerNote(event.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong p-3"
            />
            {reviewError && (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {reviewError}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeReview}
                disabled={isSaving}
                className="min-h-11 px-4 disabled:cursor-not-allowed disabled:opacity-50 yr-focus-ring"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void review('dismissed')}
                disabled={isSaving}
                className="min-h-11 rounded-md border border-muted px-4 font-semibold text-ink-soft disabled:cursor-not-allowed disabled:opacity-50 yr-focus-ring"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => void review('accepted')}
                disabled={isSaving}
                className="min-h-11 rounded-md bg-green-700 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 yr-focus-ring"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
