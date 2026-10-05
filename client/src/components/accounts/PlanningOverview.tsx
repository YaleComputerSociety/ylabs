import { Link } from 'react-router-dom';

import {
  approachingDeadlineAriaLabel,
  approachingDeadlineLabel,
  notStartedEmphasis,
} from '../../utils/watchedDeadlineSummary';

interface PlanningOverviewProps {
  savedResearchCount: number | null;
  savedFellowshipCount: number | null;
  nextDeadlineLabel?: string;
  watchedDeadlineApproachingCount?: number;
  watchedDeadlineNotStartedCount?: number;
  onViewProgramWatch?: () => void;
}

const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const nextUpLabel = (
  savedResearchCount: number | null,
  savedFellowshipCount: number | null,
  nextDeadlineLabel?: string,
): string => {
  if (nextDeadlineLabel) return nextDeadlineLabel;
  if (savedResearchCount !== null && savedResearchCount > 0) {
    return 'Reach out about saved research';
  }
  if (savedFellowshipCount !== null && savedFellowshipCount > 0) {
    return 'Review a program you are watching';
  }
  if (savedResearchCount === null || savedFellowshipCount === null) {
    return 'Review your saved research and watched programs';
  }
  return 'Save research to start planning';
};

const knownCountsSummary = (
  savedResearchCount: number | null,
  savedFellowshipCount: number | null,
): string =>
  [
    savedResearchCount === null
      ? null
      : pluralize(savedResearchCount, 'research plan', 'research plans'),
    savedFellowshipCount === null
      ? null
      : pluralize(savedFellowshipCount, 'watched program', 'watched programs'),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

const PlanningOverview = ({
  savedResearchCount,
  savedFellowshipCount,
  nextDeadlineLabel,
  watchedDeadlineApproachingCount = 0,
  watchedDeadlineNotStartedCount = 0,
  onViewProgramWatch,
}: PlanningOverviewProps) => {
  const countsSummary = knownCountsSummary(savedResearchCount, savedFellowshipCount);
  return (
    <section className="mb-6 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">
            Your workspace
          </p>
          <h1 className="yr-display mt-1 text-2xl font-semibold text-ink">Dashboard</h1>
          {countsSummary && (
            <p className="mt-2 text-sm leading-relaxed text-muted">{countsSummary}</p>
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
          className="yr-pressable inline-flex min-h-[44px] items-center justify-center rounded-control bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy yr-focus-ring"
        >
          Find more research
        </Link>
      </div>
      <div className="mt-4 rounded-card border border-line-brand bg-brand-soft p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Next up</p>
        <p className="mt-1 text-sm font-semibold text-ink">
          {nextUpLabel(savedResearchCount, savedFellowshipCount, nextDeadlineLabel)}
        </p>
        <p className="mt-1 text-sm text-muted">
          Open saved research to find its official profile and reach out, and keep private notes.
          Watch programs to track their deadlines.
        </p>
      </div>
    </section>
  );
};

export default PlanningOverview;
