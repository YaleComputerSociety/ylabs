import { Link } from 'react-router-dom';

interface FirstSaveCalloutProps {
  kind: 'program' | 'researchPlan';
  onDismiss: () => void;
}

const copy = {
  program: {
    title: 'Watching this program',
    body: 'Track its deadline and keep application notes from Watched programs on your Dashboard.',
    linkTo: '/dashboard?tab=programs',
    linkLabel: 'Open Watched programs',
  },
  researchPlan: {
    title: 'Research plan saved',
    body: 'Open it from your Dashboard to find its official profile and reach out, and keep private notes as you plan.',
    linkTo: '/dashboard',
    linkLabel: 'Open Dashboard',
  },
};

const FirstSaveCallout = ({ kind, onDismiss }: FirstSaveCalloutProps) => {
  const message = copy[kind];

  return (
    <div
      role="status"
      className="mb-4 rounded-card border border-line-brand bg-brand-soft p-4 text-brand-navy"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{message.title}</p>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-brand-navy">{message.body}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            to={message.linkTo}
            className="yr-pressable yr-focus-ring inline-flex min-h-[40px] items-center rounded-control bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy"
          >
            {message.linkLabel}
          </Link>
          <button
            type="button"
            onClick={onDismiss}
            className="yr-focus-ring inline-flex min-h-[40px] items-center rounded-card border border-line bg-panel px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-soft"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default FirstSaveCallout;
