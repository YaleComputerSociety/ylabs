/**
 * Account dashboard page. Composes the extracted sections:
 *   - ProfileEditor (professor-side profile form, if in professor view)
 *   - FavoritesManager (saved labs + programs; variant shifts UI between
 *     the kanban-heavy student view and the simpler professor-side browse view)
 *
 * The page itself only owns the admin view toggle and the confirmation banner.
 */
import { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import UserContext from '../contexts/UserContext';
import ProfileEditor from '../components/accounts/ProfileEditor';
import FavoritesManager from '../components/accounts/FavoritesManager';
import SavedPathwaysSection from '../components/accounts/SavedPathwaysSection';
import PlanningOverview from '../components/accounts/PlanningOverview';
import FacultyOpportunityManager from '../components/faculty/FacultyOpportunityManager';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { safeRouteSegment } from '../utils/url';

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

const nextPlanningCue = (
  savedPathwaySummary: PlanningSummary,
  savedFellowshipSummary: PlanningSummary,
): string | undefined => {
  const candidates = [savedPathwaySummary, savedFellowshipSummary].filter(
    (summary) => summary.nextDeadlineLabel,
  );
  if (candidates.length === 0) return undefined;
  return candidates.sort(
    (a, b) => parsePlanningDate(a.nextDeadlineDate) - parsePlanningDate(b.nextDeadlineDate),
  )[0].nextDeadlineLabel;
};

const Account = () => {
  const { user } = useContext(UserContext);
  useDocumentTitle('Dashboard');
  const [adminViewMode, setAdminViewMode] = useState<'student' | 'professor'>('student');
  const [savedPathwaySummary, setSavedPathwaySummary] = useState<PlanningSummary>({
    count: 0,
    nextDeadlineLabel: '',
  });
  const [savedFellowshipSummary, setSavedFellowshipSummary] = useState<PlanningSummary>({
    count: 0,
  });

  const isAdmin = user?.userType === 'admin';
  const isProfessorUser = user?.userType === 'professor' || user?.userType === 'faculty';
  const showProfView = isAdmin ? adminViewMode === 'professor' : isProfessorUser;
  const dashboardCopy = showProfView
    ? {
        eyebrow: 'Faculty profile center',
        title: 'Manage your public research profile',
        body: 'Review what students see, keep your research interests current, and make your profile easier to evaluate before outreach.',
      }
    : {
        eyebrow: 'Dashboard',
        title: 'Plan your next research move',
        body: 'Saved research plans, program candidates, notes, and checklist progress live here. Start in Yale Research when you need a new lead.',
      };

  return (
    <div className="yr-page w-full">
      <div className="mx-auto max-w-[1300px] px-6 pt-6 pb-16">
        {showProfView && (
          <header className="yr-panel mb-6 rounded-md p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="yr-kicker">{dashboardCopy.eyebrow}</p>
                <h1 className="mt-1 text-2xl font-semibold text-slate-950">
                  {dashboardCopy.title}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                  {dashboardCopy.body}
                </p>
              </div>
              {user?.netId && (
                <Link
                  to={`/profile/${safeRouteSegment(user.netId)}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-blue-200 bg-[var(--yr-blue-soft)] px-4 py-2 text-sm font-semibold text-[var(--yr-blue)] hover:bg-[var(--yr-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  View public profile
                </Link>
              )}
            </div>
          </header>
        )}

        {isAdmin && (
          <div className="flex justify-center mb-6">
            <div
              className="yr-card inline-flex overflow-hidden rounded-md"
              role="group"
              aria-label="Dashboard preview mode"
            >
              <button
                type="button"
                aria-pressed={adminViewMode === 'student'}
                onClick={() => setAdminViewMode('student')}
                className={`inline-flex min-h-[44px] items-center px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${
                  adminViewMode === 'student'
                    ? 'bg-[var(--yr-blue)] text-white'
                    : 'bg-[var(--yr-panel)] text-slate-600 hover:bg-[var(--yr-panel-muted)]'
                }`}
              >
                Student Dashboard
              </button>
              <button
                type="button"
                aria-pressed={adminViewMode === 'professor'}
                onClick={() => setAdminViewMode('professor')}
                className={`inline-flex min-h-[44px] items-center px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${
                  adminViewMode === 'professor'
                    ? 'bg-[var(--yr-blue)] text-white'
                    : 'bg-[var(--yr-panel)] text-slate-600 hover:bg-[var(--yr-panel-muted)]'
                }`}
              >
                Faculty Profile Preview
              </button>
            </div>
          </div>
        )}

        {isAdmin && showProfView && (
          <div className="mb-6 rounded-md border border-blue-100 bg-[var(--yr-blue-soft)] px-4 py-3 text-sm text-blue-800">
            Previewing the signed-in admin account in the faculty layout. Edit specific professors
            from Faculty Profiles in Analytics.
          </div>
        )}

        {user &&
          !user.userConfirmed &&
          (user.userType === 'professor' || user.userType === 'faculty') && (
            <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-700 p-4 mb-6 rounded shadow-sm">
              <div className="flex items-center">
                <p className="font-medium">
                  Your account is pending confirmation. Any research profiles that you create will
                  not be publicly visible until your account is confirmed.
                </p>
              </div>
            </div>
          )}

        {showProfView && user && <ProfileEditor netid={user.netId} />}

        {showProfView && isProfessorUser && <FacultyOpportunityManager />}

        {!showProfView && (
          <PlanningOverview
            savedPathwayCount={savedPathwaySummary.count}
            savedFellowshipCount={savedFellowshipSummary.count}
            nextDeadlineLabel={nextPlanningCue(savedPathwaySummary, savedFellowshipSummary)}
          />
        )}

        {!showProfView && <SavedPathwaysSection onSummaryChange={setSavedPathwaySummary} />}
        <FavoritesManager
          variant={showProfView ? 'professor' : 'student'}
          onSummaryChange={setSavedFellowshipSummary}
        />
      </div>
    </div>
  );
};

export default Account;
