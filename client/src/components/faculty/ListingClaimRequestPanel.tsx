import { FormEvent, useEffect, useState } from 'react';
import axios from '../../utils/axios';
import type { Listing } from '../../types/types';

type ClaimStatus = 'pending' | 'changes_requested' | 'approved' | 'rejected';
type ClaimRequest = {
  _id: string;
  requestType: 'claim' | 'correction';
  status: ClaimStatus;
  message: string;
  adminNotes?: string;
  createdAt: string;
};

export default function ListingClaimRequestPanel({ listing }: { listing: Listing }) {
  const [open, setOpen] = useState(false);
  const [requestType, setRequestType] = useState<'claim' | 'correction'>('correction');
  const [message, setMessage] = useState('');
  const [evidence, setEvidence] = useState('');
  const [requests, setRequests] = useState<ClaimRequest[]>([]);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadHistory = () => {
    axios
      .get('/listings/claims/mine?pageSize=100')
      .then(({ data }) => setRequests(data.requests || []))
      .catch(() => setRequests([]));
  };
  useEffect(loadHistory, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) {
      setFeedback('Describe what should be claimed or corrected.');
      return;
    }
    setSubmitting(true);
    setFeedback('');
    try {
      await axios.post(`/listings/${listing.id}/claim`, {
        requestType,
        message: message.trim(),
        evidenceUrls: evidence
          .split(/\n|,/)
          .map((url) => url.trim())
          .filter(Boolean),
      });
      setFeedback('Request submitted for administrator review. No listing changes were made.');
      setMessage('');
      setEvidence('');
      loadHistory();
    } catch (error: any) {
      setFeedback(
        error?.response?.status === 409
          ? 'You already have a pending request of this type for this listing.'
          : error?.response?.data?.error || 'Request could not be submitted.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const listingRequests = requests.filter(
    (request: any) => String(request.listingId) === listing.id,
  );

  return (
    <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
        Faculty listing support
      </h2>
      <p className="mt-2 text-sm text-gray-700">
        Request an ownership review or flag inaccurate public information for {listing.title}.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 min-h-11 rounded-md border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
      >
        Claim this listing / Request a correction
      </button>
      {listingRequests.length > 0 && (
        <div className="mt-4" aria-label="Your request history">
          <h3 className="text-sm font-semibold text-gray-900">Your request history</h3>
          <ul className="mt-2 space-y-2">
            {listingRequests.map((request) => (
              <li
                key={request._id}
                className="border-l-2 border-gray-300 pl-3 text-sm text-gray-700"
              >
                <span className="font-medium capitalize">{request.requestType}</span>:{' '}
                {request.status.replace('_', ' ')}
                {request.adminNotes && <p className="mt-1">Reviewer: {request.adminNotes}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="claim-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <form onSubmit={submit} className="w-full max-w-lg rounded-md bg-white p-6 shadow-xl">
            <h2 id="claim-title" className="text-lg font-semibold text-gray-900">
              Listing review request
            </h2>
            <p className="mt-1 text-sm text-gray-600">{listing.title}</p>
            <label className="mt-4 block text-sm font-medium text-gray-800" htmlFor="claim-type">
              Request type
            </label>
            <select
              id="claim-type"
              value={requestType}
              onChange={(event) => setRequestType(event.target.value as 'claim' | 'correction')}
              className="mt-1 min-h-11 w-full rounded-md border border-gray-400 px-3"
            >
              <option value="correction">Request a correction</option>
              <option value="claim">Claim this listing</option>
            </select>
            <label className="mt-4 block text-sm font-medium text-gray-800" htmlFor="claim-details">
              Details
            </label>
            <textarea
              id="claim-details"
              required
              maxLength={4000}
              rows={5}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-400 p-3"
            />
            <label
              className="mt-4 block text-sm font-medium text-gray-800"
              htmlFor="claim-evidence"
            >
              Evidence links (optional, one per line)
            </label>
            <textarea
              id="claim-evidence"
              rows={3}
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-400 p-3"
            />
            {feedback && (
              <p role="status" className="mt-3 text-sm text-gray-800">
                {feedback}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 px-4 text-sm font-semibold text-gray-700"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-11 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {submitting ? 'Submitting...' : 'Submit request'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
