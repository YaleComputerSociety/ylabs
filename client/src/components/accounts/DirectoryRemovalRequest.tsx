import { useCallback, useRef, useState } from 'react';
import axios from '../../utils/axios';
import useLatestRequest from '../../hooks/useLatestRequest';
import useLoadEffect from '../../hooks/useLoadEffect';
import RemovalRequestEmailLink from '../privacy/RemovalRequestEmailLink';

export const DIRECTORY_REMOVAL_REQUEST_PATH = '/users/directoryRemovalRequest';
export const REMOVE_ME_LABEL = 'Remove me from y/labs';
export const REMOVAL_REQUESTED_MESSAGE =
  "We'll stop showing you within 7 days. You can ask to be listed again at any time.";
export const REMOVAL_ACCEPTED_MESSAGE =
  'Your request was accepted. You will stop appearing on y/labs within 7 days.';
const RemovalDeclinedMessage = () => (
  <>
    We could not confirm this request. You can send it again, or email <RemovalRequestEmailLink />{' '}
    from the address Yale publishes for you.
  </>
);
const SUBMIT_ERROR = 'Your request could not be sent. Please try again.';

type RequestStatus = 'pending' | 'accepted' | 'declined';

type Eligibility = {
  eligible: boolean;
  request: { status: RequestStatus } | null;
};

const STATUS_MESSAGES: Partial<Record<RequestStatus, string>> = {
  pending: REMOVAL_REQUESTED_MESSAGE,
  accepted: REMOVAL_ACCEPTED_MESSAGE,
};

const DirectoryRemovalRequest = () => {
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const focusMessageOnMount = useRef(false);
  const loadRequest = useLatestRequest();

  const load = useCallback(async () => {
    const request = loadRequest.begin();
    try {
      const { data } = await axios.get<Eligibility>(DIRECTORY_REMOVAL_REQUEST_PATH, {
        signal: request.signal,
      });
      if (!request.isCurrent()) return;
      setEligibility({ eligible: data?.eligible === true, request: data?.request ?? null });
    } catch {
      if (!request.isCurrent()) return;
      setEligibility(null);
    }
  }, [loadRequest]);

  useLoadEffect(load);

  const messageRef = useCallback((message: HTMLParagraphElement | null) => {
    if (!message || !focusMessageOnMount.current) return;
    focusMessageOnMount.current = false;
    message.focus();
  }, []);

  const submit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const { data } = await axios.post(DIRECTORY_REMOVAL_REQUEST_PATH);
      focusMessageOnMount.current = true;
      setEligibility({ eligible: true, request: data?.request ?? { status: 'pending' } });
    } catch {
      setSubmitError(SUBMIT_ERROR);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!eligibility?.eligible) return null;

  const status = eligibility.request?.status;
  const statusMessage = status ? STATUS_MESSAGES[status] : undefined;

  return (
    <section
      aria-label="Your y/labs listing"
      className="yr-card mt-12 rounded-card border border-line p-5 sm:p-6"
    >
      {statusMessage ? (
        <p
          ref={messageRef}
          role="status"
          tabIndex={-1}
          className="text-base leading-relaxed text-ink-soft focus:outline-hidden"
        >
          {statusMessage}
        </p>
      ) : (
        <>
          {status === 'declined' && (
            <p className="mb-4 text-base leading-relaxed text-ink-soft">
              <RemovalDeclinedMessage />
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              aria-disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="yr-focus-ring inline-grid min-h-[44px] items-center rounded-control border border-line-strong bg-panel px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-[var(--yr-panel-muted)] aria-disabled:cursor-wait aria-disabled:opacity-60"
            >
              <span
                aria-hidden={isSubmitting}
                className={`col-start-1 row-start-1 ${isSubmitting ? 'invisible' : ''}`}
              >
                {REMOVE_ME_LABEL}
              </span>
              <span
                aria-hidden={!isSubmitting}
                className={`col-start-1 row-start-1 ${isSubmitting ? '' : 'invisible'}`}
              >
                Sending…
              </span>
            </button>
            {submitError && (
              <p role="alert" className="text-sm text-red-700">
                {submitError}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export default DirectoryRemovalRequest;
