/**
 * Account dashboard page. Every signed-in account sees the same read view:
 * a planning overview plus the saved-programs manager. There is no faculty
 * self-edit surface; public profiles are source-derived and admin-curated.
 */
import { useState } from 'react';
import FavoritesManager from '../components/accounts/FavoritesManager';
import PlanningOverview from '../components/accounts/PlanningOverview';
import useDocumentTitle from '../hooks/useDocumentTitle';
import useFavorites from '../hooks/useFavorites';

type PlanningSummary = {
  count: number;
  nextDeadlineLabel?: string;
  nextDeadlineDate?: string;
};

const parsePlanningDate = (value?: string): number => {
  if (!value) return Infinity;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Infinity : time;
};

const nextPlanningCue = (savedFellowshipSummary: PlanningSummary): string | undefined => {
  const candidates = [savedFellowshipSummary].filter((summary) => summary.nextDeadlineLabel);
  if (candidates.length === 0) return undefined;
  return candidates.sort(
    (a, b) => parsePlanningDate(a.nextDeadlineDate) - parsePlanningDate(b.nextDeadlineDate),
  )[0].nextDeadlineLabel;
};

const Account = () => {
  useDocumentTitle('Dashboard');
  const [savedFellowshipSummary, setSavedFellowshipSummary] = useState<PlanningSummary>({
    count: 0,
  });
  const { favIds: savedResearchEntityIds } = useFavorites('researchPlans');

  return (
    <div className="yr-page w-full">
      <div className="mx-auto max-w-[1300px] px-6 pt-6 pb-16">
        <PlanningOverview
          savedResearchCount={savedResearchEntityIds.length}
          savedFellowshipCount={savedFellowshipSummary.count}
          nextDeadlineLabel={nextPlanningCue(savedFellowshipSummary)}
        />

        <FavoritesManager onSummaryChange={setSavedFellowshipSummary} />
      </div>
    </div>
  );
};

export default Account;
