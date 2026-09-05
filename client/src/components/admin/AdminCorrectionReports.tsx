import { useCallback, useEffect, useState } from 'react';
import axios from '../../utils/axios';
import { safeRouteSegment } from '../../utils/url';

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
  wrong_research_areas: 'Wrong research areas',
  stale_availability: 'Stale availability',
  broken_link: 'Broken link',
  not_my_lab: 'Not my lab',
  other: 'Other',
};

export default function AdminCorrectionReports() {
  const [status, setStatus] = useState<ReportStatus>('unreviewed');
  const [reports, setReports] = useState<CorrectionReport[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<CorrectionReport | null>(null);
  const [reviewerNote, setReviewerNote] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(
    () =>
      axios.get(`/admin/correction-reports?status=${status}&pageSize=100`).then(({ data }) => {
        setReports(data.reports || []);
        setTotal(data.total || 0);
      }),
    [status],
  );

  useEffect(() => {
    load().catch(() => setError('Could not load correction reports.'));
  }, [load]);

  const review = async (nextStatus: Exclude<ReportStatus, 'unreviewed'>) => {
    if (!selected) return;
    try {
      await axios.put(`/admin/correction-reports/${selected._id}`, {
        status: nextStatus,
        reviewerNote: reviewerNote.trim(),
      });
      setSelected(null);
      setReviewerNote('');
      setError('');
      await load();
    } catch (reviewError: any) {
      setError(reviewError?.response?.data?.error || 'Review could not be saved.');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Page correction reports</h3>
          <p className="text-sm text-gray-600">
            {total} {status} reports
          </p>
        </div>
        <label className="text-sm font-medium text-gray-800">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ReportStatus)}
            className="ml-2 min-h-11 rounded-md border border-gray-400 px-3"
          >
            <option value="unreviewed">Unreviewed</option>
            <option value="accepted">Accepted</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <ul className="mt-4 divide-y divide-gray-200 border-y border-gray-200">
        {reports.map((report) => (
          <li key={report._id}>
            <button
              type="button"
              onClick={() => {
                setSelected(report);
                setReviewerNote(report.reviewerNote || '');
              }}
              className="min-h-14 w-full px-2 py-3 text-left yr-focus-ring"
            >
              <span className="font-semibold text-gray-900">
                {report.entitySnapshot.name || report.entitySlug}
              </span>
              <span className="ml-2 text-sm text-gray-600">{CATEGORY_LABELS[report.category]}</span>
              <span className="ml-2 text-xs text-gray-500">({report.reporter.role})</span>
              {report.note && (
                <p className="mt-1 line-clamp-2 text-sm text-gray-700">{report.note}</p>
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
            if (event.key === 'Escape') setSelected(null);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md bg-white p-6">
            <h2 id="report-review-title" className="text-lg font-semibold">
              {selected.entitySnapshot.name || selected.entitySlug}
            </h2>
            <p className="mt-2 text-sm text-gray-700">
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
              <p className="mt-4 whitespace-pre-wrap text-sm text-gray-800">{selected.note}</p>
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
              className="mt-1 w-full rounded-md border border-gray-400 p-3"
            />
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="min-h-11 px-4 yr-focus-ring"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => review('dismissed')}
                className="min-h-11 rounded-md border border-gray-600 px-4 font-semibold text-gray-700 yr-focus-ring"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => review('accepted')}
                className="min-h-11 rounded-md bg-green-700 px-4 font-semibold text-white yr-focus-ring"
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
