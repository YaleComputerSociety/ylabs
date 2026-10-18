import type { PlanNoteSaveStatus } from '../../hooks/usePlanNoteAutosave';

const STATUS_TEXT: Record<PlanNoteSaveStatus, string> = {
  idle: '',
  pending: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved. Check your connection or sign in again, then retry.',
};

const PlanNoteSaveStatusText = ({ status = 'idle' }: { status?: PlanNoteSaveStatus }) => (
  <p
    className={`mt-1 text-xs ${status === 'error' ? 'text-red-700' : 'text-muted'}`}
    role={status === 'error' ? 'alert' : 'status'}
    aria-live="polite"
  >
    {STATUS_TEXT[status]}
  </p>
);

export default PlanNoteSaveStatusText;
