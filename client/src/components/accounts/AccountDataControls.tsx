import Dialog from '@mui/material/Dialog';
import useMediaQuery from '@mui/material/useMediaQuery';
import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  ACCOUNT_DATA_DELETION_CONFIRM_PHRASE,
  type AccountDataDeletionOutcome,
  deleteAccountData,
  downloadAccountData,
  isDeletionConfirmPhrase,
  leaveAfterAccountDeletion,
  reauthenticateForDeletionUrl,
} from '../../utils/accountData';
import { PRIVACY_PATH } from '../../utils/privacyNotice';
import { WarningIcon } from '../shared/icons';

const BUTTON_BASE_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2 text-sm font-semibold yr-focus-ring disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY_BUTTON_CLASS = `${BUTTON_BASE_CLASS} border border-line bg-panel text-brand hover:bg-brand-soft`;
const DESTRUCTIVE_BUTTON_CLASS = `${BUTTON_BASE_CLASS} bg-red-600 text-white hover:bg-red-700`;
const DESTRUCTIVE_OUTLINE_BUTTON_CLASS = `${BUTTON_BASE_CLASS} border border-red-300 bg-panel text-red-700 hover:bg-red-50`;

const DELETED_ITEMS = [
  'Your account: netid, email, name, and role at Yale.',
  'Your saved research and watched programs, with their notes, checklists, and deadlines.',
  'Your activity records, including the text of your searches. Only monthly counts by type of activity are kept, with nothing that identifies you.',
  'Your y/labs product analytics in PostHog, where they were collected.',
  'Your admin access, if you have it.',
];

type DownloadState = 'idle' | 'pending' | 'failed';

const useAccountDataDownload = () => {
  const [state, setState] = useState<DownloadState>('idle');
  const start = async () => {
    if (state === 'pending') return;
    setState('pending');
    try {
      await downloadAccountData();
      setState('idle');
    } catch {
      setState('failed');
    }
  };
  return { state, start };
};

const DownloadButton = ({
  download,
  className,
}: {
  download: ReturnType<typeof useAccountDataDownload>;
  className: string;
}) => (
  <button
    type="button"
    className={className}
    disabled={download.state === 'pending'}
    aria-busy={download.state === 'pending'}
    onClick={() => void download.start()}
  >
    {download.state === 'pending' ? 'Preparing download…' : 'Download my data'}
  </button>
);

const DownloadFailedText = ({
  download,
}: {
  download: ReturnType<typeof useAccountDataDownload>;
}) =>
  download.state === 'failed' ? (
    <p role="alert" className="mt-2 text-sm text-red-700">
      The download did not start. Please try again.
    </p>
  ) : null;

const DeletionOutcomeNotice = ({ outcome }: { outcome: AccountDataDeletionOutcome | null }) => {
  if (outcome === 'recent_sign_in_required') {
    return (
      <div role="alert" className="mt-4 rounded-card border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-900">
          To delete your data, confirm it is you by entering your Yale password again. You will come
          back here to finish.
        </p>
        <a
          href={reauthenticateForDeletionUrl()}
          className="yr-pressable yr-focus-ring mt-3 inline-flex min-h-11 items-center rounded-control border border-brand bg-panel px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-soft"
        >
          Sign in again
        </a>
      </div>
    );
  }
  if (outcome === 'blocked') {
    return (
      <p role="alert" className="mt-4 text-sm text-red-700">
        This account is linked to directory data, so it cannot be deleted here. The{' '}
        <Link to={PRIVACY_PATH} className="yr-link yr-focus-ring -my-1.5 inline-block py-1.5">
          privacy page
        </Link>{' '}
        says how to ask for it to be deleted.
      </p>
    );
  }
  if (outcome === 'failed') {
    return (
      <p role="alert" className="mt-4 text-sm text-red-700">
        Deletion did not finish. Please try again; anything already removed stays removed.
      </p>
    );
  }
  return null;
};

const DeleteAccountDataDialog = ({
  open,
  onClose,
  download,
}: {
  open: boolean;
  onClose: () => void;
  download: ReturnType<typeof useAccountDataDownload>;
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const phraseId = useId();
  const phraseHintId = useId();
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [phrase, setPhrase] = useState('');
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<AccountDataDeletionOutcome | null>(null);
  const phraseMatches = isDeletionConfirmPhrase(phrase);

  const close = () => {
    if (pending) return;
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!phraseMatches || pending) return;
    setPending(true);
    setOutcome(null);
    const result = await deleteAccountData();
    if (result === 'deleted') {
      leaveAfterAccountDeletion();
      return;
    }
    setOutcome(result);
    setPending(false);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      maxWidth="sm"
      fullWidth
      disableScrollLock
      transitionDuration={prefersReducedMotion ? 0 : undefined}
      slotProps={{
        backdrop: { sx: { backgroundColor: 'var(--yr-scrim)' } },
        paper: {
          elevation: 0,
          sx: {
            borderRadius: 'var(--yr-radius-overlay)',
            boxShadow: 'var(--yr-shadow-modal)',
            margin: 2,
            width: 'calc(100% - 32px)',
          },
        },
        transition: {
          onExited: () => {
            setPhrase('');
            setOutcome(null);
          },
        },
      }}
    >
      <form className="p-6" onSubmit={(event) => void submit(event)}>
        <div className="flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700">
            <WarningIcon size={20} />
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              Delete your y/labs data
            </h2>
            <div id={descriptionId}>
              <p className="mt-2 text-sm text-ink-soft">
                This happens at once and cannot be undone. y/labs deletes:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {DELETED_ITEMS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-ink-soft">
                Correction reports you sent stay, because they are about public directory pages, but
                your name, netid, and email are removed from them.
              </p>
              <p className="mt-3 text-sm text-ink-soft">
                If you also signed in to another copy of y/labs, such as its beta site, a maintainer
                deletes that account too, in a separate run. Signing in again later starts a new,
                empty account.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-card border border-line bg-panel-muted p-4">
          <p className="text-sm text-ink">Keep a copy first: the download is your only undo.</p>
          <div className="mt-3">
            <DownloadButton download={download} className={SECONDARY_BUTTON_CLASS} />
          </div>
          <DownloadFailedText download={download} />
        </div>

        <label htmlFor={phraseId} className="mt-5 block text-sm font-medium text-ink">
          Type <span className="font-semibold">{ACCOUNT_DATA_DELETION_CONFIRM_PHRASE}</span> to
          confirm
        </label>
        <input
          id={phraseId}
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          aria-describedby={phraseHintId}
          className="mt-1 min-h-11 w-full rounded-control border border-line-control px-3 text-base text-ink yr-focus-ring"
        />
        <p id={phraseHintId} className="mt-1 text-xs text-muted">
          {phraseMatches
            ? 'Ready to delete.'
            : 'The delete button turns on once the phrase matches.'}
        </p>

        <DeletionOutcomeNotice outcome={outcome} />

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            onClick={close}
            disabled={pending}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="submit"
            className={DESTRUCTIVE_BUTTON_CLASS}
            disabled={!phraseMatches || pending}
            aria-busy={pending}
          >
            {pending ? 'Deleting…' : 'Delete my data'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

interface AccountDataControlsProps {
  openDeleteOnMount?: boolean;
  onDeleteIntentConsumed?: () => void;
}

const AccountDataControls = ({
  openDeleteOnMount = false,
  onDeleteIntentConsumed,
}: AccountDataControlsProps) => {
  const headingId = useId();
  const download = useAccountDataDownload();
  const [deleteOpen, setDeleteOpen] = useState(openDeleteOnMount);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const consumedIntent = useRef(false);

  useEffect(() => {
    if (!openDeleteOnMount || consumedIntent.current) return;
    consumedIntent.current = true;
    onDeleteIntentConsumed?.();
  }, [openDeleteOnMount, onDeleteIntentConsumed]);

  const closeDelete = () => {
    setDeleteOpen(false);
    deleteTriggerRef.current?.focus();
  };

  return (
    <section
      aria-labelledby={headingId}
      className="mt-10 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-5"
    >
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        Your data
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
        Download a copy of everything y/labs keeps with your account, or delete it. The{' '}
        <Link to={PRIVACY_PATH} className="yr-link yr-focus-ring -my-1.5 inline-block py-1.5">
          privacy page
        </Link>{' '}
        lists what that is.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <DownloadButton download={download} className={SECONDARY_BUTTON_CLASS} />
        <button
          ref={deleteTriggerRef}
          type="button"
          className={DESTRUCTIVE_OUTLINE_BUTTON_CLASS}
          onClick={() => setDeleteOpen(true)}
        >
          Delete my data
        </button>
      </div>
      <DownloadFailedText download={download} />
      <DeleteAccountDataDialog open={deleteOpen} onClose={closeDelete} download={download} />
    </section>
  );
};

export default AccountDataControls;
