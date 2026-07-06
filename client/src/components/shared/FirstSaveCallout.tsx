import { Link } from 'react-router-dom';

interface FirstSaveCalloutProps {
  kind: 'program' | 'researchPlan';
  onDismiss: () => void;
}

const copy = {
  program: {
    title: 'Program saved',
    body: 'Track application notes and compare it with saved research plans from your Dashboard.',
  },
  researchPlan: {
    title: 'Research plan saved',
    body:
      'Use your Dashboard to add notes, compare funding matches, and keep the next step visible.',
  },
};

const FirstSaveCallout = ({ kind, onDismiss }: FirstSaveCalloutProps) => {
  const message = copy[kind];

  return (
    <div
      role="status"
      className="mb-4 rounded-md border border-blue-200 bg-[var(--yr-blue-soft)] p-4 text-blue-950"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{message.title}</p>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-blue-900">
            {message.body}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            to="/account"
            className="inline-flex min-h-[40px] items-center rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Open Dashboard
          </Link>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-[40px] items-center rounded-md border border-blue-200 bg-[var(--yr-panel)] px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-[var(--yr-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default FirstSaveCallout;
