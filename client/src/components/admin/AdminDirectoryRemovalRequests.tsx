import { useCallback, useRef, useState } from 'react';
import axios from '../../utils/axios';
import useLatestRequest from '../../hooks/useLatestRequest';
import useLoadEffect from '../../hooks/useLoadEffect';

type RequestStatus = 'pending' | 'accepted' | 'declined';
type Decision = Exclude<RequestStatus, 'pending'>;

type RemovalRequest = {
  _id: string;
  requesterNetid: string;
  researcherId: string;
  researcherDisplayName: string;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
};

const LOAD_ERROR = 'Could not load removal requests.';
const DECIDE_ERROR = 'The decision could not be saved.';

const formatDay = (value: string | null): string =>
  value ? new Date(value).toISOString().slice(0, 10) : '';

export default function AdminDirectoryRemovalRequests() {
  const [status, setStatus] = useState<RequestStatus>('pending');
  const [requests, setRequests] = useState<RemovalRequest[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [listError, setListError] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const listRequest = useLatestRequest();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const request = listRequest.begin();
    setListError('');
    try {
      const { data } = await axios.get(`/admin/directory-removal-requests?status=${status}`, {
        signal: request.signal,
      });
      if (!request.isCurrent()) return;
      setRequests(data.requests || []);
      setTotal(data.total ?? 0);
    } catch {
      if (!request.isCurrent()) return;
      setListError(LOAD_ERROR);
    }
  }, [listRequest, status]);

  useLoadEffect(load);

  const decide = async (request: RemovalRequest, decision: Decision) => {
    if (decidingId) return;
    setDecidingId(request._id);
    setDecisionError('');
    try {
      await axios.put(`/admin/directory-removal-requests/${request._id}`, { status: decision });
    } catch (error: any) {
      setDecisionError(error?.response?.data?.error || DECIDE_ERROR);
      setDecidingId(null);
      return;
    }
    setDecidingId(null);
    headingRef.current?.focus();
    await load();
  };

  return (
    <section aria-labelledby="directory-removal-requests-heading" className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3
            ref={headingRef}
            id="directory-removal-requests-heading"
            tabIndex={-1}
            className="text-xl font-semibold text-ink focus:outline-hidden"
          >
            Directory removal requests
          </h3>
          <p className="text-sm text-muted">
            {total === null ? 'Loading requests…' : `${total} ${status} requests`}
          </p>
        </div>
        <label className="text-sm font-medium text-ink">
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as RequestStatus);
              setTotal(null);
              setRequests([]);
            }}
            className="ml-2 min-h-11 rounded-md border border-line-control px-3"
          >
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="declined">Declined</option>
          </select>
        </label>
      </div>
      <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
        Accepting only marks the request. Record the removal on Development with{' '}
        <code>yarn --cwd server directory-removal:record</code>.
      </p>
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
      {decisionError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {decisionError}
        </p>
      )}
      {total === 0 && !listError && (
        <p className="mt-4 text-sm text-muted">No {status} requests.</p>
      )}
      {requests.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {requests.map((request) => {
            const label = request.researcherDisplayName || request.researcherId;
            const isDeciding = decidingId === request._id;
            return (
              <li key={request._id} className="flex flex-wrap items-center gap-3 px-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{label}</p>
                  <p className="text-sm text-muted">
                    {request.requesterNetid} asked on {formatDay(request.createdAt)}
                    {request.decidedBy &&
                      `, ${request.status} by ${request.decidedBy} on ${formatDay(request.decidedAt)}`}
                  </p>
                </div>
                {request.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void decide(request, 'declined')}
                      aria-disabled={decidingId !== null}
                      aria-label={`Decline removal request for ${label}`}
                      className="min-h-11 rounded-md border border-muted px-4 font-semibold text-ink-soft aria-disabled:cursor-wait aria-disabled:opacity-50 yr-focus-ring"
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(request, 'accepted')}
                      aria-disabled={decidingId !== null}
                      aria-busy={isDeciding}
                      aria-label={`Accept removal request for ${label}`}
                      className="min-h-11 rounded-md bg-green-700 px-4 font-semibold text-white aria-disabled:cursor-wait aria-disabled:opacity-50 yr-focus-ring"
                    >
                      Accept
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
