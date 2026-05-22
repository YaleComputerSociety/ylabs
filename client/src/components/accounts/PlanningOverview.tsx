import { Link } from 'react-router-dom';

interface PlanningOverviewProps {
  savedPathwayCount: number;
  savedFellowshipCount: number;
  nextDeadlineLabel?: string;
}

const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const PlanningOverview = ({
  savedPathwayCount,
  savedFellowshipCount,
  nextDeadlineLabel,
}: PlanningOverviewProps) => (
  <section className="mb-6 rounded-md border border-gray-200 bg-white p-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
          Student workspace
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-950">Dashboard</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          {pluralize(savedPathwayCount, 'research plan', 'research plans')} ·{' '}
          {pluralize(savedFellowshipCount, 'saved program', 'saved programs')}
        </p>
      </div>
      <Link
        to="/research"
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
      >
        Find more research homes
      </Link>
    </div>
    <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Next up</p>
      <p className="mt-1 text-sm font-semibold text-gray-950">
        {nextDeadlineLabel || 'No deadline yet'}
      </p>
      <p className="mt-1 text-sm text-gray-600">
        Use saved plan details when you need notes, checklist steps, sources, or funding matches.
      </p>
    </div>
  </section>
);

export default PlanningOverview;
