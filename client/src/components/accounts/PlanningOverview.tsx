import { Link } from 'react-router-dom';

import {
  approachingDeadlineAriaLabel,
  approachingDeadlineLabel,
  notStartedEmphasis,
} from '../../utils/watchedDeadlineSummary';

interface PlanningOverviewProps {
  savedResearchCount: number;
  savedOpenCount?: number;
  savedFellowshipCount: number;
  nextDeadlineLabel?: string;
  watchedDeadlineApproachingCount?: number;
  watchedDeadlineNotStartedCount?: number;
  onViewProgramWatch?: () => void;
}

const openHomesSummary = (savedOpenCount: number): string =>
  `${savedOpenCount} of your saved ${savedOpenCount === 1 ? 'home is' : 'homes are'} currently open to undergraduates.`;

const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const nextUpLabel = (
  savedResearchCount: number,
  savedFellowshipCount: number,
  nextDeadlineLabel?: string,
): string => {
  if (nextDeadlineLabel) return nextDeadlineLabel;
  if (savedResearchCount > 0) return 'Reach out to a saved research home';
  if (savedFellowshipCount > 0) return 'Review a program you are watching';
  return 'Save a research home to start planning';
};

const PlanningOverview = ({
  savedResearchCount,
  savedOpenCount = 0,
  savedFellowshipCount,
  nextDeadlineLabel,
  watchedDeadlineApproachingCount = 0,
  watchedDeadlineNotStartedCount = 0,
  onViewProgramWatch,
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
        {savedOpenCount > 0 && (
          <p className="mt-1 text-sm font-semibold text-emerald-800">
            {openHomesSummary(savedOpenCount)}
          </p>
        )}
        {watchedDeadlineApproachingCount > 0 && onViewProgramWatch && (
          <button
            type="button"
            onClick={onViewProgramWatch}
            aria-label={approachingDeadlineAriaLabel(
              watchedDeadlineApproachingCount,
              watchedDeadlineNotStartedCount,
            )}
            className="mt-1 block text-sm font-semibold text-amber-800 underline-offset-2 hover:underline yr-focus-ring"
          >
            {approachingDeadlineLabel(watchedDeadlineApproachingCount)}
            {notStartedEmphasis(watchedDeadlineNotStartedCount) && (
              <span className="font-normal text-amber-700">
                {' · '}
                {notStartedEmphasis(watchedDeadlineNotStartedCount)}
              </span>
            )}
          </button>
        )}
      </div>
      <Link
        to="/research"
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy yr-focus-ring"
      >
        Find more research homes
      </Link>
    </div>
    <div className="mt-4 rounded-md border border-blue-100 bg-[var(--yr-blue-soft)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Next up</p>
      <p className="mt-1 text-sm font-semibold text-gray-950">
        {nextUpLabel(savedResearchCount, savedFellowshipCount, nextDeadlineLabel)}
      </p>
      <p className="mt-1 text-sm text-gray-600">
        Open a saved research home to find its official profile and reach out, and keep private
        notes. Watch programs to track their deadlines.
      </p>
    </div>
  </section>
);

export default PlanningOverview;
