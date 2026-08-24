/**
 * Account page. Every signed-in account sees the same read view organized into
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
import ResearchInterestsEditor from '../components/accounts/ResearchInterestsEditor';
import SavedResearchPlans from '../components/accounts/SavedResearchPlans';
import SavedSearches from '../components/accounts/SavedSearches';
import useDocumentTitle from '../hooks/useDocumentTitle';
import type { WatchedProgramUrgencySummary } from '../utils/watchedProgramUrgency';

type AccountSurface = 'dashboard' | 'programs' | 'searches' | 'interests';

type ProgramSummary = { count: number } & Partial<WatchedProgramUrgencySummary>;

const SURFACES: AccountSurface[] = ['dashboard', 'programs', 'searches', 'interests'];

const isAccountSurface = (value: string | null): value is AccountSurface =>
  SURFACES.includes(value as AccountSurface);

const Account = () => {
  useDocumentTitle('Dashboard');
  const [searchParams] = useSearchParams();
  const [surface, setSurface] = useState<AccountSurface>(() => {
    const tab = searchParams.get('tab');
    return isAccountSurface(tab) ? tab : 'dashboard';
  });
  const [savedResearchCount, setSavedResearchCount] = useState(0);
  const [savedOpenCount, setSavedOpenCount] = useState(0);
  const [programSummary, setProgramSummary] = useState<ProgramSummary>({ count: 0 });
  const [savedSearchCount, setSavedSearchCount] = useState(0);
  const tabRefs = useRef<Record<AccountSurface, HTMLButtonElement | null>>({
    dashboard: null,
    programs: null,
    searches: null,
    interests: null,
  });

  const activateSurface = (next: AccountSurface, focusTab = false) => {
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
          closingWithin14DaysCount={programSummary.closingWithin14DaysCount}
          hasNotStartedClosingSoon={programSummary.hasNotStartedClosingSoon}
          onViewProgramWatch={() => activateSurface('programs', true)}
        />

        <div className="mb-6 flex justify-center">
          <div
            className="yr-card inline-flex overflow-hidden rounded-md"
            role="tablist"
            aria-label="Account surfaces"
          >
            <button
              type="button"
              role="tab"
              id="account-dashboard-tab"
              aria-controls="account-dashboard-panel"
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
              id="account-programs-tab"
              aria-controls="account-programs-panel"
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
            <button
              type="button"
              role="tab"
              id="account-searches-tab"
              aria-controls="account-searches-panel"
              aria-selected={surface === 'searches'}
              tabIndex={surface === 'searches' ? 0 : -1}
              ref={(el) => {
                tabRefs.current.searches = el;
              }}
              onClick={() => activateSurface('searches')}
              onKeyDown={handleTabKeyDown}
              className={tabClass(surface === 'searches')}
            >
              Saved Searches ({savedSearchCount})
            </button>
            <button
              type="button"
              role="tab"
              id="account-interests-tab"
              aria-controls="account-interests-panel"
              aria-selected={surface === 'interests'}
              tabIndex={surface === 'interests' ? 0 : -1}
              ref={(el) => {
                tabRefs.current.interests = el;
              }}
              onClick={() => activateSurface('interests')}
              onKeyDown={handleTabKeyDown}
              className={tabClass(surface === 'interests')}
            >
              Interests
            </button>
          </div>
        </div>

        <div
          id="account-dashboard-panel"
          role="tabpanel"
          aria-labelledby="account-dashboard-tab"
          tabIndex={0}
          className={surface === 'dashboard' ? '' : 'hidden'}
        >
          <SavedResearchPlans
            onCountChange={setSavedResearchCount}
            onOpenCountChange={setSavedOpenCount}
          />
        </div>
        <div
          id="account-programs-panel"
          role="tabpanel"
          aria-labelledby="account-programs-tab"
          tabIndex={0}
          className={surface === 'programs' ? '' : 'hidden'}
        >
          <ProgramWatch onSummaryChange={setProgramSummary} />
        </div>
        <div
          id="account-searches-panel"
          role="tabpanel"
          aria-labelledby="account-searches-tab"
          tabIndex={0}
          className={surface === 'searches' ? '' : 'hidden'}
        >
          <SavedSearches onCountChange={setSavedSearchCount} />
        </div>
        <div
          id="account-interests-panel"
          role="tabpanel"
          aria-labelledby="account-interests-tab"
          tabIndex={0}
          className={surface === 'interests' ? '' : 'hidden'}
        >
          {surface === 'interests' && <ResearchInterestsEditor />}
        </div>
      </div>
    </div>
  );
};

export default Account;
