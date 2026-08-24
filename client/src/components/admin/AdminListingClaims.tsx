import { useCallback, useEffect, useState } from 'react';
import axios from '../../utils/axios';

type ReviewStatus = 'pending' | 'changes_requested' | 'approved' | 'rejected';
type ApplyStatus = 'not_applicable' | 'applied' | 'failed';
type Claim = {
  _id: string;
  requestType: 'claim' | 'correction';
  status: ReviewStatus;
  message: string;
  evidenceUrls: string[];
  adminNotes?: string;
  listingSnapshot: { title: string };
  requester: { name: string; userType: string; userConfirmed: boolean; profileVerified: boolean };
  createdAt: string;
  proposedChanges?: Record<string, unknown>;
  applyStatus?: ApplyStatus;
  appliedFields?: string[];
  applyError?: string;
};

const formatProposedChangeValue = (value: unknown): string =>
  Array.isArray(value) ? value.join(', ') : String(value);

export default function AdminListingClaims() {
  const [status, setStatus] = useState<ReviewStatus>('pending');
  const [claims, setClaims] = useState<Claim[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Claim | null>(null);
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const load = useCallback(
    () =>
      axios.get(`/admin/listing-claims?status=${status}&pageSize=100`).then(({ data }) => {
        setClaims(data.requests || []);
        setTotal(data.total || 0);
      }),
    [status],
  );
  useEffect(() => {
    load().catch(() => setError('Could not load listing requests.'));
  }, [load]);
  const review = async (nextStatus: Exclude<ReviewStatus, 'pending'>) => {
    if (!selected || !rationale.trim()) {
      setError('Reviewer rationale is required.');
      return;
    }
    try {
      const { data } = await axios.put(`/admin/listing-claims/${selected._id}`, {
        status: nextStatus,
        adminNotes: rationale.trim(),
      });
      if (nextStatus === 'approved') {
        setSelected(data.request);
      } else {
        setSelected(null);
        setRationale('');
      }
      setError('');
      await load();
    } catch (reviewError: any) {
      setError(reviewError?.response?.data?.error || 'Review could not be saved.');
    }
  };
  const applyToCanonicalData = async () => {
    if (!selected) return;
    if (
      !window.confirm(
        'Apply this correction to the canonical research entity? This writes a manual-admin-edit observation and re-syncs search.',
      )
    ) {
      return;
    }
    setApplying(true);
    try {
      const { data } = await axios.put(`/admin/listing-claims/${selected._id}/apply`, {
        confirmApply: true,
      });
      setSelected(data.request);
      setError('');
      await load();
    } catch (applyError: any) {
      setError(applyError?.response?.data?.error || 'Apply could not be completed.');
    } finally {
      setApplying(false);
    }
  };
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Listing claims and corrections</h3>
          <p className="text-sm text-gray-600">
            {total} {status.replace('_', ' ')} requests
          </p>
        </div>
        <label className="text-sm font-medium text-gray-800">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ReviewStatus)}
            className="ml-2 min-h-11 rounded-md border border-gray-400 px-3"
          >
            <option value="pending">Pending</option>
            <option value="changes_requested">Changes requested</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <ul className="mt-4 divide-y divide-gray-200 border-y border-gray-200">
        {claims.map((claim) => (
          <li key={claim._id}>
            <button
              type="button"
              onClick={() => {
                setSelected(claim);
                setRationale(claim.adminNotes || '');
              }}
              className="min-h-14 w-full px-2 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              <span className="font-semibold text-gray-900">{claim.listingSnapshot.title}</span>
              <span className="ml-2 text-sm capitalize text-gray-600">{claim.requestType}</span>
              <p className="mt-1 line-clamp-2 text-sm text-gray-700">{claim.message}</p>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSelected(null);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md bg-white p-6">
            <h2 id="review-title" className="text-lg font-semibold">
              {selected.listingSnapshot.title}
            </h2>
            <p className="mt-2 text-sm text-gray-700">
              Submitted by {selected.requester.name || 'faculty member'} (
              {selected.requester.userType})
            </p>
            <p className="mt-4 whitespace-pre-wrap text-sm text-gray-800">{selected.message}</p>
            {selected.evidenceUrls.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm">
                {selected.evidenceUrls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 underline"
                    >
                      Review evidence
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {selected.proposedChanges && Object.keys(selected.proposedChanges).length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-gray-900">Proposed changes</h3>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-800">
                  {Object.entries(selected.proposedChanges).map(([field, value]) => (
                    <li key={field}>
                      <span className="font-medium">{field}:</span>{' '}
                      {formatProposedChangeValue(value)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Approving records an administrative decision only; it does not by itself change
              listing ownership or content. A separate, explicitly confirmed apply step is required
              to write a proposed change to the canonical research entity.
            </p>
            {selected.applyStatus === 'applied' && (
              <p role="status" className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-900">
                Applied to canonical data
                {selected.appliedFields?.length ? `: ${selected.appliedFields.join(', ')}` : ''}.
              </p>
            )}
            {selected.applyStatus === 'failed' && (
              <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-900">
                Apply failed: {selected.applyError || 'Unknown error.'}
              </p>
            )}
            {(selected.status === 'pending' || selected.status === 'changes_requested') && (
              <>
                <label htmlFor="review-rationale" className="mt-4 block text-sm font-medium">
                  Reviewer rationale
                </label>
                <textarea
                  id="review-rationale"
                  rows={4}
                  maxLength={4000}
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-400 p-3"
                />
              </>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setSelected(null)} className="min-h-11 px-4">
                Close
              </button>
              {(selected.status === 'pending' || selected.status === 'changes_requested') && (
                <>
                  <button
                    type="button"
                    onClick={() => review('changes_requested')}
                    className="min-h-11 rounded-md border border-amber-600 px-4 font-semibold text-amber-800"
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    onClick={() => review('rejected')}
                    className="min-h-11 rounded-md border border-red-600 px-4 font-semibold text-red-700"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => review('approved')}
                    className="min-h-11 rounded-md bg-green-700 px-4 font-semibold text-white"
                  >
                    Approve review
                  </button>
                </>
              )}
              {selected.status === 'approved' && selected.applyStatus !== 'applied' && (
                <button
                  type="button"
                  onClick={applyToCanonicalData}
                  disabled={applying}
                  className="min-h-11 rounded-md bg-green-700 px-4 font-semibold text-white disabled:opacity-60"
                >
                  {applying ? 'Applying...' : 'Apply to canonical data'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
