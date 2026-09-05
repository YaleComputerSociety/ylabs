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
    body: 'Open it from your Dashboard to find its official profile and reach out, and keep private notes as you plan.',
  },
};

const FirstSaveCallout = ({ kind, onDismiss }: FirstSaveCalloutProps) => {
  const message = copy[kind];

  return (
    <div
      role="status"
      className="mb-4 rounded-md border border-line-brand bg-brand-soft p-4 text-brand-navy"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{message.title}</p>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-brand-navy">{message.body}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            to="/dashboard"
            className="yr-focus-ring inline-flex min-h-[40px] items-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy"
          >
            Open Dashboard
          </Link>
          <button
            type="button"
            onClick={onDismiss}
            className="yr-focus-ring inline-flex min-h-[40px] items-center rounded-md border border-line bg-panel px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-soft"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default FirstSaveCallout;
