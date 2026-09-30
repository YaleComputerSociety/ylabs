/**
 * Dashboard page. Every signed-in account sees the same read view organized into
 * two surfaces:
 *   - Dashboard: the saved research an account is tracking (canonical
 *     ResearchPlan RESEARCH_ENTITY targets), with notes and the always-available
 *     next step of opening a home to find its official profile and reach out.
 *   - Program Watch: the programs and fellowships an account is watching
 *     (canonical ResearchPlan PROGRAM targets), with deadline, accepting status,
 *     and eligibility.
 * There is no faculty self-edit surface and no faculty/student branching; public
 * profiles are source-derived and admin-curated.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PlanningOverview from '../components/accounts/PlanningOverview';
import ProgramWatch from '../components/accounts/ProgramWatch';
import SavedResearchPlans from '../components/accounts/SavedResearchPlans';
import useDocumentTitle from '../hooks/useDocumentTitle';
import useRovingTabs from '../hooks/useRovingTabs';

type DashboardSurface = 'dashboard' | 'programs';

type ProgramSummary = {
  count: number | null;
  nextDeadlineLabel?: string;
  nextDeadlineDate?: string;
  approachingCount?: number;
  notStartedCount?: number;
};

const SURFACES: DashboardSurface[] = ['dashboard', 'programs'];

const withCount = (label: string, count: number | null): string =>
  count === null ? label : `${label} (${count})`;

const Dashboard = () => {
  useDocumentTitle('Dashboard');
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as DashboardSurface | null;
  const {
    activeTab: surface,
    activateTab: activateSurface,
    handleTabKeyDown,
    registerTab,
  } = useRovingTabs<DashboardSurface>(
    SURFACES,
    tabParam && SURFACES.includes(tabParam) ? tabParam : 'dashboard',
  );
  const [savedResearchCount, setSavedResearchCount] = useState<number | null>(null);
  const [programSummary, setProgramSummary] = useState<ProgramSummary>({ count: null });

  const tabClass = (active: boolean): string =>
    `inline-flex min-h-[44px] items-center px-4 py-2 text-sm font-medium transition-colors yr-focus-ring ${
      active
        ? 'bg-[var(--yr-blue)] text-white'
        : 'bg-[var(--yr-panel)] text-muted hover:bg-[var(--yr-panel-muted)]'
    }`;

  return (
    <div className="yr-page w-full">
      <div className="mx-auto max-w-[1300px] px-6 pt-6 pb-16">
        <PlanningOverview
          savedResearchCount={savedResearchCount}
          savedFellowshipCount={programSummary.count}
          nextDeadlineLabel={programSummary.nextDeadlineLabel}
          watchedDeadlineApproachingCount={programSummary.approachingCount}
          watchedDeadlineNotStartedCount={programSummary.notStartedCount}
          onViewProgramWatch={() => activateSurface('programs', true)}
        />

        <div className="mb-6 flex justify-center">
          <div
            className="yr-card yr-segmented inline-flex rounded-card"
            role="tablist"
            aria-label="Dashboard surfaces"
          >
            <button
              type="button"
              role="tab"
              id="dashboard-plans-tab"
              aria-controls="dashboard-plans-panel"
              aria-selected={surface === 'dashboard'}
              tabIndex={surface === 'dashboard' ? 0 : -1}
              ref={registerTab('dashboard')}
              onClick={() => activateSurface('dashboard')}
              onKeyDown={handleTabKeyDown}
              className={tabClass(surface === 'dashboard')}
            >
              {withCount('Dashboard', savedResearchCount)}
            </button>
            <button
              type="button"
              role="tab"
              id="dashboard-programs-tab"
              aria-controls="dashboard-programs-panel"
              aria-selected={surface === 'programs'}
              tabIndex={surface === 'programs' ? 0 : -1}
              ref={registerTab('programs')}
              onClick={() => activateSurface('programs')}
              onKeyDown={handleTabKeyDown}
              className={tabClass(surface === 'programs')}
            >
              {withCount('Program Watch', programSummary.count)}
            </button>
          </div>
        </div>

        <div
          id="dashboard-plans-panel"
          role="tabpanel"
          aria-labelledby="dashboard-plans-tab"
          tabIndex={0}
          className={surface === 'dashboard' ? '' : 'hidden'}
        >
          <SavedResearchPlans onCountChange={setSavedResearchCount} />
        </div>
        <div
          id="dashboard-programs-panel"
          role="tabpanel"
          aria-labelledby="dashboard-programs-tab"
          tabIndex={0}
          className={surface === 'programs' ? '' : 'hidden'}
        >
          <ProgramWatch onSummaryChange={setProgramSummary} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
