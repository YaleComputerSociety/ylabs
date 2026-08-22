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
import { useState } from 'react';
import PlanningOverview from '../components/accounts/PlanningOverview';
import ProgramWatch from '../components/accounts/ProgramWatch';
import SavedResearchPlans from '../components/accounts/SavedResearchPlans';
import useDocumentTitle from '../hooks/useDocumentTitle';

type AccountSurface = 'dashboard' | 'programs';

type ProgramSummary = {
  count: number;
  nextDeadlineLabel?: string;
  nextDeadlineDate?: string;
};

const Account = () => {
  useDocumentTitle('Dashboard');
  const [surface, setSurface] = useState<AccountSurface>('dashboard');
  const [savedResearchCount, setSavedResearchCount] = useState(0);
  const [programSummary, setProgramSummary] = useState<ProgramSummary>({ count: 0 });

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
          savedFellowshipCount={programSummary.count}
          nextDeadlineLabel={programSummary.nextDeadlineLabel}
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
              aria-selected={surface === 'dashboard'}
              onClick={() => setSurface('dashboard')}
              className={tabClass(surface === 'dashboard')}
            >
              Dashboard ({savedResearchCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={surface === 'programs'}
              onClick={() => setSurface('programs')}
              className={tabClass(surface === 'programs')}
            >
              Program Watch ({programSummary.count})
            </button>
          </div>
        </div>

        <div className={surface === 'dashboard' ? '' : 'hidden'}>
          <SavedResearchPlans onCountChange={setSavedResearchCount} />
        </div>
        <div className={surface === 'programs' ? '' : 'hidden'}>
          <ProgramWatch onSummaryChange={setProgramSummary} />
        </div>
      </div>
    </div>
  );
};

export default Account;
