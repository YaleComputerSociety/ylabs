/**
 * Dashboard page. Every signed-in account sees the same read view organized into
 * two surfaces:
 *   - Dashboard: the saved research homes an account is tracking (canonical
 *     ResearchPlan RESEARCH_ENTITY targets), with notes and the always-available
 *     next step of opening a home to find its official profile and reach out.
 *   - Program Watch: the programs and fellowships an account is watching
 *     (canonical ResearchPlan PROGRAM targets), with deadline, accepting status,
 *     and eligibility.
 * There is no faculty self-edit surface and no faculty/student branching; public
 * profiles are source-derived and admin-curated.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import PlanningOverview from '../components/accounts/PlanningOverview';
import ProgramWatch from '../components/accounts/ProgramWatch';
import SavedResearchPlans from '../components/accounts/SavedResearchPlans';
import useDocumentTitle from '../hooks/useDocumentTitle';

type DashboardSurface = 'dashboard' | 'programs';

type ProgramSummary = {
  count: number;
  nextDeadlineLabel?: string;
  nextDeadlineDate?: string;
  approachingCount?: number;
  notStartedCount?: number;
};

const SURFACES: DashboardSurface[] = ['dashboard', 'programs'];

const Dashboard = () => {
  useDocumentTitle('Dashboard');
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as DashboardSurface | null;
  const [surface, setSurface] = useState<DashboardSurface>(
    tabParam && SURFACES.includes(tabParam) ? tabParam : 'dashboard',
  );
  const [savedResearchCount, setSavedResearchCount] = useState(0);
  const [savedOpenCount, setSavedOpenCount] = useState(0);
  const [programSummary, setProgramSummary] = useState<ProgramSummary>({ count: 0 });
  const tabRefs = useRef<Record<DashboardSurface, HTMLButtonElement | null>>({
    dashboard: null,
    programs: null,
  });

  const activateSurface = (next: DashboardSurface, focusTab = false) => {
    setSurface(next);
    if (focusTab) tabRefs.current[next]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = SURFACES.indexOf(surface);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % SURFACES.length;
        break;
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + SURFACES.length) % SURFACES.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = SURFACES.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    activateSurface(SURFACES[nextIndex], true);
  };

  const tabClass = (active: boolean): string =>
    `inline-flex min-h-[44px] items-center px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${
      active
        ? 'bg-[var(--yr-blue)] text-white'
        : 'bg-[var(--yr-panel)] text-slate-600 hover:bg-[var(--yr-panel-muted)]'
    }`;

  return (
    <div className="yr-page w-full">
      <div className="mx-auto max-w-[1300px] px-6 pt-6 pb-16">
        <PlanningOverview
          savedResearchCount={savedResearchCount}
          savedOpenCount={savedOpenCount}
          savedFellowshipCount={programSummary.count}
          nextDeadlineLabel={programSummary.nextDeadlineLabel}
          watchedDeadlineApproachingCount={programSummary.approachingCount}
          watchedDeadlineNotStartedCount={programSummary.notStartedCount}
          onViewProgramWatch={() => activateSurface('programs', true)}
        />

        <div className="mb-6 flex justify-center">
          <div
            className="yr-card inline-flex overflow-hidden rounded-md"
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
              ref={(el) => {
                tabRefs.current.dashboard = el;
              }}
              onClick={() => activateSurface('dashboard')}
              onKeyDown={handleTabKeyDown}
              className={tabClass(surface === 'dashboard')}
            >
              Dashboard ({savedResearchCount})
            </button>
            <button
              type="button"
              role="tab"
              id="dashboard-programs-tab"
              aria-controls="dashboard-programs-panel"
              aria-selected={surface === 'programs'}
              tabIndex={surface === 'programs' ? 0 : -1}
              ref={(el) => {
                tabRefs.current.programs = el;
              }}
              onClick={() => activateSurface('programs')}
              onKeyDown={handleTabKeyDown}
              className={tabClass(surface === 'programs')}
            >
              Program Watch ({programSummary.count})
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
          <SavedResearchPlans
            onCountChange={setSavedResearchCount}
            onOpenCountChange={setSavedOpenCount}
          />
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
