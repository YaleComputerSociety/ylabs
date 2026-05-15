import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../shared/LoadingSpinner';
import type { PathwaySearchHit } from '../../types/pathway';
import axios from '../../utils/axios';

type PlanningIntent = 'thesis' | 'outreach' | 'credit' | 'funding' | 'apply' | 'later';
type PlanningStage = 'saved' | 'researching' | 'ready' | 'acted' | 'archived';

export interface PathwayPlan {
  intent: PlanningIntent;
  stage: PlanningStage;
  note: string;
  checklist: Record<string, boolean>;
}

export type PathwayPlanMap = Record<string, PathwayPlan>;

export interface FellowshipFundingMatch {
  fellowshipId: string;
  pathwayId: string;
  title: string;
  score: number;
  strength: 'confirmed_by_source' | 'candidate' | 'weak_candidate';
  reasons: string[];
  caveats: string[];
  sourceUrls: string[];
  deadline?: string | null;
  applicationLink?: string;
  contactOffice?: string;
  isAcceptingApplications?: boolean;
  applicationCycle?: {
    sourceUrls: string[];
    applicationLink?: string;
    applicationOpenDate?: string | null;
    deadline?: string | null;
    isAcceptingApplications?: boolean;
    contactOffice?: string;
    sourceBacked: boolean;
    activeCycle: boolean;
    supportsFellowshipFundedProject: boolean;
    supportsFellowshipCompatible: boolean;
    supportsOfficialApplicationRoute: boolean;
    applicationHasOpened?: boolean;
    deadlineHasNotPassed?: boolean;
  };
}

type FundingMatchesByPathway = Record<string, FellowshipFundingMatch[]>;

export interface DeadlineReminder {
  kind: 'posted-opportunity' | 'fellowship';
  label: string;
  title: string;
  detail: string;
  date: string;
  urgency: 'overdue' | 'soon' | 'later';
  urgencyLabel: string;
  sourceUrl?: string;
}

const PLAN_STORAGE_KEY = 'ylabs.savedPathwayPlans.v1';

const INTENT_OPTIONS: Array<{ value: PlanningIntent; label: string }> = [
  { value: 'thesis', label: 'Thesis idea' },
  { value: 'outreach', label: 'Outreach' },
  { value: 'credit', label: 'Course credit' },
  { value: 'funding', label: 'Funding' },
  { value: 'apply', label: 'Apply' },
  { value: 'later', label: 'Later' },
];

const STAGE_OPTIONS: Array<{ value: PlanningStage; label: string }> = [
  { value: 'saved', label: 'Saved' },
  { value: 'researching', label: 'Researching' },
  { value: 'ready', label: 'Ready to act' },
  { value: 'acted', label: 'Acted' },
  { value: 'archived', label: 'Archived' },
];

const isPlanningIntent = (value: unknown): value is PlanningIntent =>
  INTENT_OPTIONS.some((option) => option.value === value);

const isPlanningStage = (value: unknown): value is PlanningStage =>
  STAGE_OPTIONS.some((option) => option.value === value);

const CHECKLIST_TEMPLATES: Record<PlanningIntent, Array<{ key: string; label: string }>> = {
  thesis: [
    { key: 'thesis-review-evidence', label: 'Review the source evidence for thesis fit' },
    { key: 'thesis-fit', label: 'Note how the research connects to your interests' },
    { key: 'thesis-norms', label: 'Check department thesis or senior project expectations' },
    {
      key: 'thesis-question',
      label: 'Write one specific question for a faculty or program contact',
    },
  ],
  outreach: [
    { key: 'outreach-route', label: 'Review the official contact route or policy' },
    {
      key: 'outreach-context',
      label: 'Identify the project, method, or evidence you will reference',
    },
    { key: 'outreach-question', label: 'Draft a focused question or next-step request' },
    { key: 'outreach-followup', label: 'Mark whether follow-up is needed' },
  ],
  credit: [
    { key: 'credit-registration', label: 'Check the registration or independent study path' },
    { key: 'credit-sponsor', label: 'Confirm the likely instructor, sponsor, or program office' },
    { key: 'credit-deadline', label: 'Note any form, proposal, or add/drop deadline' },
    { key: 'credit-fit', label: 'Write how this could become credit-bearing work' },
  ],
  funding: [
    { key: 'funding-source', label: 'Identify a possible funding or fellowship source' },
    { key: 'funding-eligibility', label: 'Capture eligibility constraints' },
    { key: 'funding-deadline', label: 'Check deadline or application cycle timing' },
    { key: 'funding-project-fit', label: 'Connect the pathway to a fundable project idea' },
  ],
  apply: [
    { key: 'apply-open', label: 'Open the application or posted role source' },
    { key: 'apply-requirements', label: 'Check requirements, timing, and materials' },
    { key: 'apply-materials', label: 'Draft or gather application materials' },
    { key: 'apply-submitted', label: 'Mark when submitted or no longer relevant' },
  ],
  later: [
    { key: 'later-evidence', label: 'Skim the Evidence and Best Next Step' },
    { key: 'later-reason', label: 'Add why this pathway is worth saving' },
    { key: 'later-review', label: 'Choose when to review it again' },
    { key: 'later-keep-archive', label: 'Decide whether to keep or archive it' },
  ],
};

const labelize = (value?: string): string =>
  (value || 'Unknown')
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const nextStepLabel = (value?: string): string => {
  switch (value) {
    case 'apply':
      return 'Apply';
    case 'register-for-credit':
      return 'Register for credit';
    case 'find-funding':
      return 'Find funding';
    case 'plan-outreach':
      return 'Plan outreach';
    case 'contact-program':
      return 'Contact program';
    case 'save-for-thesis':
      return 'Save for thesis';
    case 'check-back-later':
      return 'Check back later';
    default:
      return 'Save for later';
  }
};

const matchStrengthLabel = (value: FellowshipFundingMatch['strength']): string => {
  switch (value) {
    case 'confirmed_by_source':
      return 'Source-backed candidate';
    case 'candidate':
      return 'Candidate';
    default:
      return 'Weak candidate';
  }
};

const formatDeadline = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const parsedDeadline = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysUntil = (deadline: Date, now: Date): number =>
  Math.ceil((deadline.getTime() - now.getTime()) / MS_PER_DAY);

const reminderUrgency = (days: number): DeadlineReminder['urgency'] => {
  if (days < 0) return 'overdue';
  if (days <= 14) return 'soon';
  return 'later';
};

const reminderUrgencyLabel = (urgency: DeadlineReminder['urgency']): string => {
  switch (urgency) {
    case 'overdue':
      return 'Past';
    case 'soon':
      return 'Soon';
    default:
      return 'Upcoming';
  }
};

export const defaultIntentForPathway = (pathway: PathwaySearchHit): PlanningIntent => {
  switch (pathway.bestNextStepCategory) {
    case 'apply':
      return 'apply';
    case 'register-for-credit':
      return 'credit';
    case 'find-funding':
      return 'funding';
    case 'save-for-thesis':
      return 'thesis';
    case 'plan-outreach':
    case 'contact-program':
      return 'outreach';
    default:
      return 'later';
  }
};

export const deadlineReminderForPathway = (
  pathway: PathwaySearchHit,
  matches: FellowshipFundingMatch[] = [],
  now = new Date(),
): DeadlineReminder | null => {
  const candidates = [
    pathway.activePostedOpportunity?.deadline
      ? {
          kind: 'posted-opportunity' as const,
          label: 'Posted role deadline',
          title: pathway.activePostedOpportunity.title,
          deadline: pathway.activePostedOpportunity.deadline,
          sourceUrl: pathway.activePostedOpportunity.applicationUrl,
        }
      : null,
    ...matches.map((match) =>
      match.deadline
        ? {
            kind: 'fellowship' as const,
            label: 'Fellowship deadline',
            title: match.title,
            deadline: match.deadline,
            sourceUrl: match.applicationLink || match.sourceUrls?.[0],
          }
        : null,
    ),
  ]
    .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
    .map((candidate) => {
      const date = parsedDeadline(candidate.deadline);
      return date ? { ...candidate, date, days: daysUntil(date, now) } : null;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate);

  if (candidates.length === 0) return null;

  const future = candidates
    .filter((candidate) => candidate.days >= 0)
    .sort((a, b) => a.days - b.days);
  const selected = future[0] || candidates.sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  const urgency = reminderUrgency(selected.days);
  const dueWord = urgency === 'overdue' ? 'Passed' : 'Due';
  const formattedDate = formatDeadline(selected.deadline);

  return {
    kind: selected.kind,
    label: selected.label,
    title: selected.title,
    detail: `${selected.title}: ${dueWord} ${formattedDate}`,
    date: selected.date.toISOString(),
    urgency,
    urgencyLabel: reminderUrgencyLabel(urgency),
    sourceUrl: selected.sourceUrl,
  };
};

const readStoredPlans = (): PathwayPlanMap => {
  try {
    const raw = window.localStorage.getItem(PLAN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('Error reading saved pathway plans:', err);
    return {};
  }
};

export const mergeSavedPathwayPlansForHydration = (
  localPlans: PathwayPlanMap,
  serverPlans: PathwayPlanMap,
): PathwayPlanMap => ({
  ...localPlans,
  ...serverPlans,
});

export const getLocalOnlySavedPathwayPlanIds = (
  localPlans: PathwayPlanMap,
  serverPlans: PathwayPlanMap,
  savedPathwayIds: Iterable<string>,
): string[] => {
  const allowedIds = new Set(savedPathwayIds);
  return Object.keys(localPlans).filter((id) => allowedIds.has(id) && !serverPlans[id]);
};

const sourceUrlsForPathway = (pathway: PathwaySearchHit): string[] =>
  Array.from(
    new Set([
      ...(pathway.sourceUrls || []),
      ...pathway.evidence.map((item) => item.sourceUrl).filter(Boolean),
    ]),
  ) as string[];

export const fundingCueForPathway = (
  pathway: PathwaySearchHit,
  plan: PathwayPlan,
): { label: string; detail: string; confidence: 'strong' | 'possible' } | null => {
  const wantsFunding =
    plan.intent === 'funding' ||
    pathway.bestNextStepCategory === 'find-funding' ||
    pathway.pathwayType === 'FELLOWSHIP_FUNDED_PROJECT' ||
    pathway.compensation === 'FELLOWSHIP' ||
    pathway.compensation === 'STIPEND' ||
    pathway.compensation === 'VOLUNTEER';

  if (!wantsFunding) return null;

  if (pathway.pathwayType === 'FELLOWSHIP_FUNDED_PROJECT') {
    return {
      label: 'Fellowship-funded route',
      detail:
        'This pathway already has fellowship/project evidence. Use the source links, then compare eligibility and deadlines on the fellowships page.',
      confidence: 'strong',
    };
  }

  if (pathway.compensation === 'FELLOWSHIP' || pathway.bestNextStepCategory === 'find-funding') {
    return {
      label: 'Funding likely matters',
      detail:
        'The pathway is tagged for funding or fellowship action. Treat this as a planning cue until a specific fellowship source confirms eligibility.',
      confidence: 'possible',
    };
  }

  if (pathway.compensation === 'STIPEND') {
    return {
      label: 'Stipend clue',
      detail:
        'Stipend language suggests funding may be available, but the pathway source should be checked before assuming eligibility.',
      confidence: 'possible',
    };
  }

  if (pathway.compensation === 'VOLUNTEER') {
    return {
      label: 'Funding may be useful',
      detail:
        'Because this route may be unpaid, fellowships or research grants could be worth checking before committing time.',
      confidence: 'possible',
    };
  }

  return {
    label: 'Funding planning cue',
    detail:
      'You marked this for funding. Compare the pathway evidence with fellowship eligibility before treating it as a match.',
    confidence: 'possible',
  };
};

const SavedPathwaysSection = () => {
  const [pathways, setPathways] = useState<PathwaySearchHit[]>([]);
  const [fundingMatches, setFundingMatches] = useState<FundingMatchesByPathway>({});
  const [plans, setPlans] = useState<PathwayPlanMap>(() => readStoredPlans());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [includePrivateNotesInExport, setIncludePrivateNotesInExport] = useState(false);

  const loadPathways = useCallback(async () => {
    setLoading(true);
    setError('');
    setExportError('');
    try {
      const response = await axios.get('/users/favPathways', { withCredentials: true });
      const savedPathways = response.data.favPathways || [];
      setPathways(savedPathways);
      try {
        const plansResponse = await axios.get('/users/favPathwayPlans', {
          withCredentials: true,
        });
        const serverPlans = plansResponse.data.savedPathwayPlans || {};
        const localPlans = readStoredPlans();
        const mergedPlans = mergeSavedPathwayPlansForHydration(localPlans, serverPlans);
        setPlans(mergedPlans);
        const savedPathwayIds = savedPathways.map((pathway: PathwaySearchHit) => pathway._id);
        const localOnlyPlanIds = getLocalOnlySavedPathwayPlanIds(
          localPlans,
          serverPlans,
          savedPathwayIds,
        );
        await Promise.all(
          localOnlyPlanIds.map((id) =>
            axios.put(
              `/users/favPathwayPlans/${id}`,
              { data: { plan: localPlans[id] } },
              { withCredentials: true },
            ),
          ),
        );
      } catch (planErr) {
        console.error('Error loading saved pathway plans:', planErr);
      }
      try {
        const matchesResponse = await axios.get('/users/favPathwayFundingMatches', {
          withCredentials: true,
        });
        setFundingMatches(matchesResponse.data.matchesByPathwayId || {});
      } catch (matchErr) {
        console.error('Error loading saved pathway funding matches:', matchErr);
        setFundingMatches({});
      }
    } catch (err) {
      console.error('Error loading saved pathways:', err);
      setPathways([]);
      setFundingMatches({});
      setError('Saved pathways could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPathways();
  }, [loadPathways]);

  useEffect(() => {
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plans));
  }, [plans]);

  const getPlan = (pathway: PathwaySearchHit): PathwayPlan => {
    const storedPlan = plans[pathway._id];
    if (storedPlan) {
      return {
        intent: isPlanningIntent(storedPlan.intent)
          ? storedPlan.intent
          : defaultIntentForPathway(pathway),
        stage: isPlanningStage(storedPlan.stage) ? storedPlan.stage : 'saved',
        note: typeof storedPlan.note === 'string' ? storedPlan.note : '',
        checklist: storedPlan.checklist || {},
      };
    }

    return {
      intent: defaultIntentForPathway(pathway),
      stage: 'saved',
      note: '',
      checklist: {},
    };
  };

  const updatePlan = (pathwayId: string, patch: Partial<PathwayPlan>) => {
    setPlans((current) => {
      const nextPlan = {
        ...(current[pathwayId] || { intent: 'later', stage: 'saved', note: '', checklist: {} }),
        ...patch,
      };
      axios
        .put(
          `/users/favPathwayPlans/${pathwayId}`,
          { data: { plan: nextPlan } },
          { withCredentials: true },
        )
        .catch((err) => console.error('Error saving pathway plan:', err));
      return {
        ...current,
        [pathwayId]: nextPlan,
      };
    });
  };

  const toggleChecklistItem = (pathwayId: string, itemKey: string, checked: boolean) => {
    const currentPlan = plans[pathwayId] || {
      intent: 'later' as PlanningIntent,
      stage: 'saved' as PlanningStage,
      note: '',
      checklist: {},
    };

    updatePlan(pathwayId, {
      checklist: {
        ...(currentPlan.checklist || {}),
        [itemKey]: checked,
      },
    });
  };

  const removePathway = async (pathwayId: string) => {
    const previous = pathways;
    setPathways((current) => current.filter((pathway) => pathway._id !== pathwayId));
    try {
      await axios.delete('/users/favPathways', {
        withCredentials: true,
        data: { favPathways: [pathwayId] },
      });
      setPlans((current) => {
        const next = { ...current };
        delete next[pathwayId];
        return next;
      });
      await axios.delete(`/users/favPathwayPlans/${pathwayId}`, { withCredentials: true });
    } catch (err) {
      console.error('Error removing saved pathway:', err);
      setPathways(previous);
      setError('Could not remove that saved pathway.');
    }
  };

  const exportSavedPathways = async () => {
    setExporting(true);
    setExportError('');
    try {
      const response = await axios.get('/users/favPathwayPlans/export', {
        withCredentials: true,
        params: includePrivateNotesInExport ? { includePrivateNotes: 'true' } : undefined,
      });
      const blob = new Blob([JSON.stringify(response.data, null, 2)], {
        type: 'application/json',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = includePrivateNotesInExport
        ? 'saved-pathway-advising-share.json'
        : 'saved-pathway-plans.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting saved pathway plans:', err);
      setExportError('Saved pathways could not be exported.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="mb-8 rounded-md border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Saved Pathways</h2>
          <p className="text-sm text-gray-500">
            Keep track of thesis ideas, future outreach routes, and practical Ways In.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          {pathways.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                <input
                  type="checkbox"
                  checked={includePrivateNotesInExport}
                  onChange={(event) => setIncludePrivateNotesInExport(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Include private notes</span>
              </label>
              <button
                type="button"
                onClick={exportSavedPathways}
                disabled={exporting || loading}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exporting ? 'Exporting...' : 'Export for advising'}
              </button>
            </>
          )}
          <Link to="/pathways" className="text-sm font-semibold text-blue-700 hover:underline">
            Browse pathways
          </Link>
        </div>
      </div>

      {exportError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {exportError}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <LoadingSpinner size="md" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : pathways.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-5 text-sm text-gray-500">
          Saved pathways will appear here when you save routes from the Pathways page.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {pathways.map((pathway) => {
            const plan = getPlan(pathway);
            const sourceUrls = sourceUrlsForPathway(pathway);
            const checklistItems = CHECKLIST_TEMPLATES[plan.intent];
            const completedChecklistItems = checklistItems.filter(
              (item) => plan.checklist?.[item.key],
            ).length;
            const fundingCue = fundingCueForPathway(pathway, plan);
            const matches = fundingMatches[pathway._id] || [];
            const deadlineReminder = deadlineReminderForPathway(pathway, matches);

            return (
              <article key={pathway._id} className="rounded-md border border-gray-200 p-4">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                    {labelize(pathway.pathwayType)}
                  </span>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
                    {labelize(pathway.evidenceStrength)} evidence
                  </span>
                </div>

                <h3 className="text-base font-bold leading-snug text-gray-900">
                  {pathway.studentFacingLabel}
                </h3>
                <Link
                  to={`/research/${pathway.researchEntity.slug}`}
                  className="text-sm font-medium text-blue-700 hover:underline"
                >
                  {pathway.researchEntity.displayName || pathway.researchEntity.name}
                </Link>

                <div className="mt-3 rounded border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700">
                  <span className="font-semibold text-gray-900">Best next step:</span>{' '}
                  {nextStepLabel(pathway.bestNextStepCategory)}
                </div>

                {deadlineReminder && (
                  <div
                    className={`mt-3 rounded-md border p-3 text-sm ${
                      deadlineReminder.urgency === 'overdue'
                        ? 'border-rose-100 bg-rose-50 text-rose-900'
                        : deadlineReminder.urgency === 'soon'
                          ? 'border-amber-100 bg-amber-50 text-amber-950'
                          : 'border-blue-100 bg-blue-50 text-blue-950'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{deadlineReminder.label}</span>
                      <span className="rounded bg-white/80 px-2 py-0.5 text-xs font-semibold">
                        {deadlineReminder.urgencyLabel}
                      </span>
                    </div>
                    <p className="mt-1">{deadlineReminder.detail}</p>
                    {deadlineReminder.sourceUrl && (
                      <a
                        href={deadlineReminder.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex text-sm font-semibold underline underline-offset-2"
                      >
                        Open source
                      </a>
                    )}
                  </div>
                )}

                {fundingCue && (
                  <div className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{fundingCue.label}</span>
                      <span className="rounded bg-white/80 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        {fundingCue.confidence === 'strong' ? 'Evidence-backed' : 'Planning cue'}
                      </span>
                    </div>
                    <p className="mt-1 text-emerald-800">{fundingCue.detail}</p>
                    <Link
                      to="/fellowships"
                      className="mt-2 inline-flex text-sm font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-950"
                    >
                      Browse fellowships
                    </Link>
                  </div>
                )}

                {matches.length > 0 && (
                  <div className="mt-3 rounded-md border border-cyan-100 bg-cyan-50 p-3 text-sm text-cyan-950">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-semibold">Fellowship candidates</span>
                      <span className="rounded bg-white/80 px-2 py-0.5 text-xs font-semibold text-cyan-700">
                        Scored from saved pathway
                      </span>
                    </div>
                    <div className="space-y-2">
                      {matches.slice(0, 2).map((match) => {
                        const deadline = formatDeadline(match.deadline);
                        const fellowshipSourceUrl = match.applicationLink || match.sourceUrls?.[0];
                        return (
                          <div
                            key={match.fellowshipId}
                            className="rounded border border-cyan-100 bg-white/80 p-2"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                to={`/fellowships?fellowship=${match.fellowshipId}`}
                                className="font-semibold text-cyan-900 underline underline-offset-2 hover:text-cyan-700"
                              >
                                {match.title}
                              </Link>
                              <span className="rounded bg-cyan-100 px-2 py-0.5 text-xs font-semibold text-cyan-800">
                                {matchStrengthLabel(match.strength)}
                              </span>
                              {deadline && (
                                <span className="text-xs font-medium text-cyan-700">
                                  Due {deadline}
                                </span>
                              )}
                            </div>
                            {match.reasons[0] && (
                              <p className="mt-1 text-xs text-cyan-800">{match.reasons[0]}</p>
                            )}
                            {match.caveats[0] && (
                              <p className="mt-1 text-xs text-cyan-700">
                                Caveat: {match.caveats[0]}
                              </p>
                            )}
                            {fellowshipSourceUrl && (
                              <a
                                href={fellowshipSourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex text-xs font-semibold text-cyan-800 underline underline-offset-2 hover:text-cyan-950"
                              >
                                Open fellowship source
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Intent
                    <select
                      value={plan.intent}
                      onChange={(event) =>
                        updatePlan(pathway._id, { intent: event.target.value as PlanningIntent })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {INTENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Stage
                    <select
                      value={plan.stage}
                      onChange={(event) =>
                        updatePlan(pathway._id, { stage: event.target.value as PlanningStage })
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {STAGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Note
                  <textarea
                    value={plan.note}
                    onChange={(event) => updatePlan(pathway._id, { note: event.target.value })}
                    rows={3}
                    placeholder="Why this route matters, what to check next, or who to ask."
                    className="mt-1 block w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <div className="mt-4 rounded-md border border-gray-100 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Checklist
                    </h4>
                    <span className="text-xs font-medium text-gray-500">
                      {completedChecklistItems}/{checklistItems.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {checklistItems.map((item) => (
                      <label
                        key={item.key}
                        className="flex items-start gap-2 text-sm text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={!!plan.checklist?.[item.key]}
                          onChange={(event) =>
                            toggleChecklistItem(pathway._id, item.key, event.target.checked)
                          }
                          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {pathway.explanation && (
                  <p className="mt-3 line-clamp-3 text-sm text-gray-600">{pathway.explanation}</p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {sourceUrls.slice(0, 2).map((url, index) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
                    >
                      Source {index + 1}
                    </a>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    to={`/research/${pathway.researchEntity.slug}`}
                    className="text-sm font-semibold text-blue-700 hover:underline"
                  >
                    View research profile
                  </Link>
                  <button
                    type="button"
                    onClick={() => removePathway(pathway._id)}
                    className="text-sm font-semibold text-gray-500 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default SavedPathwaysSection;
