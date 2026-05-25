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
}: PlanningOverviewProps) => {
  const savedPlanLabel = pluralize(savedPathwayCount, 'research plan', 'research plans');
  const savedProgramLabel = pluralize(savedFellowshipCount, 'saved program', 'saved programs');

  return (
    <section className="mb-6 rounded-md border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
            Student workspace
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Dashboard</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            {savedPlanLabel} · {savedProgramLabel}. Use this page to keep promising
            routes, program deadlines, notes, and sources in one review queue.
          </p>
        </div>
        <Link
          to="/research"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          Find more research homes
        </Link>
      </div>

      <div
        aria-label="Saved research planning summary"
        className="mt-5 grid gap-3 md:grid-cols-3"
      >
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Research plans
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-950">{savedPathwayCount}</p>
          <p className="mt-1 text-xs text-slate-500">Outreach, credit, thesis, or application routes</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Saved programs
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-950">{savedFellowshipCount}</p>
          <p className="mt-1 text-xs text-slate-500">Funding and structured research leads</p>
        </div>
        <div className="rounded-md border border-blue-100 bg-blue-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Next up</p>
          <p className="mt-1 text-sm font-semibold text-slate-950">
            {nextDeadlineLabel || 'No deadline yet'}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Check saved details for notes, sources, checklist steps, and funding matches.
          </p>
        </div>
      </div>
    </section>
  );
};

export default PlanningOverview;
