import { Link } from 'react-router-dom';

interface PlanningOverviewProps {
  savedResearchCount: number;
  savedResearchOpenCount?: number;
  savedFellowshipCount: number;
  nextDeadlineLabel?: string;
}

const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const openSavedHomesLabel = (savedResearchOpenCount: number): string =>
  savedResearchOpenCount === 1
    ? '1 of your saved homes is currently open to undergraduates'
    : `${savedResearchOpenCount} of your saved homes are currently open to undergraduates`;

const nextUpLabel = (
  savedResearchCount: number,
  savedResearchOpenCount: number,
  savedFellowshipCount: number,
  nextDeadlineLabel?: string,
): string => {
  if (nextDeadlineLabel) return nextDeadlineLabel;
  if (savedResearchOpenCount > 0) return openSavedHomesLabel(savedResearchOpenCount);
  if (savedResearchCount > 0) return 'Reach out to a saved research home';
  if (savedFellowshipCount > 0) return 'Review a program you are watching';
  return 'Save a research home to start planning';
};

const PlanningOverview = ({
  savedResearchCount,
  savedResearchOpenCount = 0,
  savedFellowshipCount,
  nextDeadlineLabel,
}: PlanningOverviewProps) => (
  <section className="mb-6 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
          Your workspace
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-950">Dashboard</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          {pluralize(savedResearchCount, 'research plan', 'research plans')} ·{' '}
          {pluralize(savedFellowshipCount, 'watched program', 'watched programs')}
        </p>
      </div>
      <Link
        to="/research"
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
      >
        Find more research homes
      </Link>
    </div>
    <div className="mt-4 rounded-md border border-blue-100 bg-[var(--yr-blue-soft)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Next up</p>
      <p className="mt-1 text-sm font-semibold text-gray-950">
        {nextUpLabel(savedResearchCount, savedResearchOpenCount, savedFellowshipCount, nextDeadlineLabel)}
      </p>
      <p className="mt-1 text-sm text-gray-600">
        Open a saved research home to find its official profile and reach out, and keep private
        notes. Watch programs to track their deadlines.
      </p>
    </div>
  </section>
);

export default PlanningOverview;
