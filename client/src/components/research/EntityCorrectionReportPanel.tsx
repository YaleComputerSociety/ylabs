import { FormEvent, useCallback, useEffect, useState } from 'react';
import axios from '../../utils/axios';

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
  createdAt: string;
};

const CATEGORY_OPTIONS: { value: ReportCategory; label: string }[] = [
  { value: 'wrong_description', label: 'The description is wrong or misleading' },
  { value: 'wrong_lead', label: 'The wrong lead or PI is shown' },
  { value: 'wrong_research_areas', label: 'The research areas are wrong' },
  { value: 'stale_availability', label: 'Availability is stale or incorrect' },
  { value: 'broken_link', label: 'A link is broken' },
  { value: 'not_my_lab', label: "This isn't my lab" },
  { value: 'other', label: 'Something else' },
];

const CATEGORY_LABELS: Record<ReportCategory, string> = CATEGORY_OPTIONS.reduce(
  (labels, option) => ({ ...labels, [option.value]: option.label }),
  {} as Record<ReportCategory, string>,
);

const STATUS_LABELS: Record<ReportStatus, string> = {
  unreviewed: 'awaiting review',
  accepted: 'accepted',
  dismissed: 'dismissed',
};

const MAX_NOTE_LENGTH = 2000;

export default function EntityCorrectionReportPanel({
  slug,
  entityName,
}: {
  slug: string;
  entityName: string;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory>('wrong_description');
  const [note, setNote] = useState('');
  const [reports, setReports] = useState<CorrectionReport[]>([]);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadHistory = useCallback(() => {
    axios
      .get(`/research/${slug}/reports/mine?pageSize=100`)
      .then(({ data }) => setReports(data.reports || []))
      .catch(() => setReports([]));
  }, [slug]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFeedback('');
    try {
      await axios.post(`/research/${slug}/report`, {
        category,
        note: note.trim(),
      });
      setFeedback('Thanks. Your report was sent for review. No page content was changed.');
      setNote('');
      loadHistory();
    } catch (error: any) {
      setFeedback(
        error?.response?.status === 409
          ? 'You already have an open report of this type for this page.'
          : error?.response?.data?.error || 'Your report could not be submitted.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
        See something wrong?
      </h2>
      <p className="mt-2 text-sm text-gray-700">
        This page is assembled from public sources and may be inaccurate. Signed-in members can flag
        an issue for our team to review.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="yr-focus-ring mt-3 min-h-11 rounded-md border border-line px-4 py-2 text-sm font-semibold text-brand"
      >
        Report an issue with this page
      </button>
      {reports.length > 0 && (
        <div className="mt-4" aria-label="Your report history">
          <h3 className="text-sm font-semibold text-gray-900">Your reports for this page</h3>
          <ul className="mt-2 space-y-2">
            {reports.map((report) => (
              <li
                key={report._id}
                className="border-l-2 border-gray-300 pl-3 text-sm text-gray-700"
              >
                <span className="font-medium">{CATEGORY_LABELS[report.category]}</span>:{' '}
                {STATUS_LABELS[report.status]}
                {report.reviewerNote && <p className="mt-1">Reviewer: {report.reviewerNote}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <form onSubmit={submit} className="w-full max-w-lg rounded-md bg-white p-6 shadow-xl">
            <h2 id="report-title" className="text-lg font-semibold text-gray-900">
              Report an issue
            </h2>
            <p className="mt-1 text-sm text-gray-600">{entityName}</p>
            <label
              className="mt-4 block text-sm font-medium text-gray-800"
              htmlFor="report-category"
            >
              What is wrong?
            </label>
            <select
              id="report-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as ReportCategory)}
              className="mt-1 min-h-11 w-full rounded-md border border-gray-400 px-3"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="mt-4 block text-sm font-medium text-gray-800" htmlFor="report-note">
              Add details (optional)
            </label>
            <textarea
              id="report-note"
              maxLength={MAX_NOTE_LENGTH}
              rows={5}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-400 p-3"
            />
            <p className="mt-2 text-xs text-gray-500">
              Your netid is included so our team can follow up. Reports are reviewed by a person and
              never publish content directly.
            </p>
            {feedback && (
              <p role="status" className="mt-3 text-sm text-gray-800">
                {feedback}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 px-4 text-sm font-semibold text-gray-700 yr-focus-ring"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-11 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 yr-focus-ring"
              >
                {submitting ? 'Submitting...' : 'Submit report'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
