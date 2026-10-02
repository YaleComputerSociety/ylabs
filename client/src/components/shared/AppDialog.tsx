import Dialog from '@mui/material/Dialog';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useEffect, useId } from 'react';

import { CheckIcon, WarningIcon } from './icons';

export type AppDialogTone = 'success' | 'error' | 'warning' | 'info';

export type AppDialogRequest =
  | {
      kind: 'alert';
      tone: AppDialogTone;
      text: string;
      autoCloseMs?: number;
    }
  | {
      kind: 'confirm';
      tone: AppDialogTone;
      title: string;
      text: string;
      confirmLabel: string;
      cancelLabel?: string;
      destructive?: boolean;
    };

interface AppDialogProps {
  request: AppDialogRequest | null;
  requestId: number;
  open: boolean;
  onResolve: (confirmed: boolean) => void;
  onExited: () => void;
}

const TONE_BADGE_CLASS: Record<AppDialogTone, string> = {
  success: 'bg-success-soft text-success',
  error: 'bg-red-50 text-red-700',
  warning: 'bg-amber-50 text-amber-900',
  info: 'bg-brand-soft text-brand',
};

const BUTTON_BASE_CLASS =
  'min-h-11 min-w-[88px] rounded-control px-4 text-sm font-semibold yr-focus-ring';
const SECONDARY_BUTTON_CLASS = `${BUTTON_BASE_CLASS} border border-line bg-panel text-brand hover:bg-brand-soft`;
const PRIMARY_BUTTON_CLASS = `${BUTTON_BASE_CLASS} bg-brand text-white hover:bg-brand-navy`;
const DESTRUCTIVE_BUTTON_CLASS = `${BUTTON_BASE_CLASS} bg-red-600 text-white hover:bg-red-700`;

const ToneIcon = ({ tone }: { tone: AppDialogTone }) => {
  if (tone === 'info') return null;
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${TONE_BADGE_CLASS[tone]}`}
    >
      {tone === 'success' ? <CheckIcon size={20} /> : <WarningIcon size={20} />}
    </span>
  );
};

const AppDialog = ({ request, requestId, open, onResolve, onExited }: AppDialogProps) => {
  const titleId = useId();
  const textId = useId();
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const autoCloseMs = request?.kind === 'alert' ? request.autoCloseMs : undefined;

  useEffect(() => {
    if (!open || autoCloseMs === undefined) return undefined;
    const timer = window.setTimeout(() => onResolve(true), autoCloseMs);
    return () => window.clearTimeout(timer);
  }, [open, autoCloseMs, requestId, onResolve]);

  if (!request) return null;

  const isConfirm = request.kind === 'confirm';
  const cancelFirst = isConfirm && request.destructive === true;

  return (
    <Dialog
      open={open}
      onClose={() => onResolve(false)}
      role="alertdialog"
      aria-labelledby={isConfirm ? titleId : textId}
      aria-describedby={isConfirm ? textId : undefined}
      maxWidth="xs"
      fullWidth
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
        transition: { onExited },
      }}
    >
      <div key={requestId} className="p-6">
        <div className="flex items-start gap-4">
          <ToneIcon tone={request.tone} />
          <div className="min-w-0 flex-1 pt-1">
            {isConfirm && (
              <h2 id={titleId} className="text-lg font-semibold text-ink">
                {request.title}
              </h2>
            )}
            <p
              id={textId}
              className={isConfirm ? 'mt-2 text-sm text-ink-soft' : 'text-base text-ink'}
            >
              {request.text}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {isConfirm ? (
            <>
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                autoFocus={cancelFirst}
                onClick={() => onResolve(false)}
              >
                {request.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                className={request.destructive ? DESTRUCTIVE_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
                autoFocus={!cancelFirst}
                onClick={() => onResolve(true)}
              >
                {request.confirmLabel}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={PRIMARY_BUTTON_CLASS}
              autoFocus
              onClick={() => onResolve(true)}
            >
              OK
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
};

export default AppDialog;
