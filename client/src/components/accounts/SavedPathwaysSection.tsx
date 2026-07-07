import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../shared/LoadingSpinner';
import type { PathwaySearchHit } from '../../types/pathway';
import axios from '../../utils/axios';
import UserContext from '../../contexts/UserContext';
import {
  EXTERNAL_LINK_REL,
  safeHttpUrl,
  safeHttpUrlList,
  safeRouteSegment,
} from '../../utils/url';

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

interface SavedPlanExportItem {
  title?: string;
  researchEntity?: {
    name?: string;
  };
  intent?: string;
  stage?: string;
  checklist?: Record<string, boolean>;
  sourceLinks?: string[];
  bestNextStepCategory?: string;
  privateNote?: string;
}

interface SavedPlanExportPayload {
  exportedAt?: string;
  itemCount?: number;
  privacy?: {
    includesPrivateNotes?: boolean;
  };
  items?: SavedPlanExportItem[];
}

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

export const PLAN_STORAGE_KEY = 'yale-research.savedResearchPlans.v1';
export const MAX_PLAN_STORAGE_VALUE_LENGTH = 100_000;
const PLAN_STORAGE_OWNER_RE = /^[A-Za-z0-9]{2,12}$/;

export const normalizeSavedPlanStorageOwner = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return PLAN_STORAGE_OWNER_RE.test(trimmed) ? trimmed.toLowerCase() : undefined;
};

export const savedPlanStorageKeyForOwner = (owner: unknown): string | undefined => {
  const normalizedOwner = normalizeSavedPlanStorageOwner(owner);
  return normalizedOwner ? `${PLAN_STORAGE_KEY}.${normalizedOwner}` : undefined;
};

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
    { key: 'apply-open', label: 'Open the application or posted opening source' },
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

const labelForOption = <T extends string>(
  options: Array<{ value: T; label: string }>,
  value: T,
): string => options.find((option) => option.value === value)?.label || labelize(value);

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
          label: 'Posted opening deadline',
          title: pathway.activePostedOpportunity.title,
          deadline: pathway.activePostedOpportunity.deadline,
          sourceUrl: pathway.activePostedOpportunity.applicationUrl,
        }
      : null,
    ...matches.map((match) =>
      match.deadline && match.strength !== 'weak_candidate'
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
  if (future.length === 0) return null;

  const selected = future[0];
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

const MAX_STORED_PLAN_COUNT = 100;
const MAX_PLAN_NOTE_LENGTH = 2000;
const MAX_CHECKLIST_ITEM_COUNT = 40;
const STORAGE_PLAN_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const STORAGE_CHECKLIST_KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;

const normalizePlanNote = (value: unknown): string =>
  typeof value === 'string' ? value.slice(0, MAX_PLAN_NOTE_LENGTH) : '';

const normalizePlanChecklist = (value: unknown): Record<string, boolean> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const checklist: Record<string, boolean> = {};
  for (const [key, checked] of Object.entries(value).slice(0, MAX_CHECKLIST_ITEM_COUNT)) {
    if (STORAGE_CHECKLIST_KEY_RE.test(key) && checked === true) {
      checklist[key] = true;
    }
  }
  return checklist;
};

const labelizeExportValue = (value?: string): string =>
  labelize(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase());

const readableSavedPlanExport = (payload: SavedPlanExportPayload): string => {
  const lines = [
    '# Saved Research Plans',
    '',
    `Exported: ${payload.exportedAt ? formatDeadline(payload.exportedAt) : formatDeadline(new Date().toISOString())}`,
    `Private notes: ${payload.privacy?.includesPrivateNotes ? 'included' : 'not included'}`,
    `Plans: ${payload.itemCount ?? payload.items?.length ?? 0}`,
    '',
  ];

  for (const [index, item] of (payload.items || []).entries()) {
    const checkedItems = Object.entries(item.checklist || {})
      .filter(([, checked]) => checked)
      .map(([key]) => labelizeExportValue(key));

    lines.push(
      `## ${index + 1}. ${item.title || 'Saved research plan'}`,
      '',
      `Research home: ${item.researchEntity?.name || 'Unknown'}`,
      `Intent: ${labelizeExportValue(item.intent)}`,
      `Stage: ${labelizeExportValue(item.stage)}`,
      `Next step: ${labelizeExportValue(item.bestNextStepCategory)}`,
    );

    if (item.privateNote) {
      lines.push('', 'Private note:', item.privateNote);
    }

    if (checkedItems.length > 0) {
      lines.push('', 'Completed checklist:', ...checkedItems.map((label) => `- ${label}`));
    }

    if ((item.sourceLinks || []).length > 0) {
      lines.push('', 'Sources:', ...(item.sourceLinks || []).map((source) => `- ${source}`));
    }

    lines.push('');
  }

  return lines.join('\n');
};

const normalizeStoredPlan = (value: unknown): PathwayPlan | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<PathwayPlan>;
  return {
    intent: isPlanningIntent(candidate.intent) ? candidate.intent : 'later',
    stage: isPlanningStage(candidate.stage) ? candidate.stage : 'saved',
    note: normalizePlanNote(candidate.note),
    checklist: normalizePlanChecklist(candidate.checklist),
  };
};

const normalizePathwayPlanMap = (value: unknown): PathwayPlanMap => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const plans: PathwayPlanMap = {};
  for (const [id, plan] of Object.entries(value).slice(0, MAX_STORED_PLAN_COUNT)) {
    if (!STORAGE_PLAN_ID_RE.test(id)) continue;
    const normalizedPlan = normalizeStoredPlan(plan);
    if (normalizedPlan) plans[id] = normalizedPlan;
  }
  return plans;
};

const localStoragePlanMap = (plans: PathwayPlanMap): PathwayPlanMap =>
  Object.fromEntries(
    Object.entries(normalizePathwayPlanMap(plans)).map(([id, plan]) => [
      id,
      {
        intent: plan.intent,
        stage: plan.stage,
        note: '',
        checklist: {},
      },
    ]),
  );

export const readStoredPlans = (owner?: unknown): PathwayPlanMap => {
  try {
    const storageKey = savedPlanStorageKeyForOwner(owner);
    window.localStorage.removeItem(PLAN_STORAGE_KEY);
    if (!storageKey) return {};

    const raw = window.localStorage.getItem(storageKey);
    if (raw && raw.length > MAX_PLAN_STORAGE_VALUE_LENGTH) {
      window.localStorage.removeItem(storageKey);
      return {};
    }
    return raw ? normalizePathwayPlanMap(JSON.parse(raw)) : {};
  } catch {
    console.error('Error reading saved research plans.');
    const storageKey = savedPlanStorageKeyForOwner(owner);
    if (storageKey) window.localStorage.removeItem(storageKey);
    return {};
  }
};

export const writeStoredPlans = (plans: PathwayPlanMap, owner?: unknown): void => {
  try {
    const storageKey = savedPlanStorageKeyForOwner(owner);
    window.localStorage.removeItem(PLAN_STORAGE_KEY);
    if (!storageKey) return;

    const serialized = JSON.stringify(localStoragePlanMap(plans));
    if (typeof serialized !== 'string' || serialized.length > MAX_PLAN_STORAGE_VALUE_LENGTH) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, serialized);
  } catch {
    console.error('Error saving saved research plans.');
  }
};

export const mergeSavedPathwayPlansForHydration = (
  localPlans: PathwayPlanMap,
  serverPlans: PathwayPlanMap,
): PathwayPlanMap => ({
  ...normalizePathwayPlanMap(localPlans),
  ...normalizePathwayPlanMap(serverPlans),
});

export const getLocalOnlySavedPathwayPlanIds = (
  localPlans: PathwayPlanMap,
  serverPlans: PathwayPlanMap,
  savedPathwayIds: Iterable<string>,
): string[] => {
  const allowedIds = new Set(savedPathwayIds);
  return Object.keys(localPlans).filter((id) => allowedIds.has(id) && !serverPlans[id]);
};

export const filterStoredPlansForSavedPathways = (
  plans: PathwayPlanMap,
  savedPathwayIds: Iterable<string>,
): PathwayPlanMap => {
  const allowedIds = new Set(savedPathwayIds);
  const filtered: PathwayPlanMap = {};
  const normalizedPlans = normalizePathwayPlanMap(plans);
  for (const [id, plan] of Object.entries(normalizedPlans)) {
    if (allowedIds.has(id)) filtered[id] = plan;
  }
  return filtered;
};

const sourceUrlsForPathway = (pathway: PathwaySearchHit): string[] =>
  safeHttpUrlList([
    ...(pathway.sourceUrls || []),
    ...pathway.evidence.map((item) => item.sourceUrl).filter(Boolean),
  ]);

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
        'This pathway already has fellowship/project evidence. Use the source links, then compare eligibility and deadlines on the programs page.',
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

interface SavedPathwaysSectionProps {
  onSummaryChange?: (summary: {
    count: number;
    nextDeadlineLabel?: string;
    nextDeadlineDate?: string;
  }) => void;
}

const SavedPathwaysSection = ({ onSummaryChange }: SavedPathwaysSectionProps) => {
  const { user } = useContext(UserContext);
  const planStorageOwner = normalizeSavedPlanStorageOwner(user?.netId);
  const [pathways, setPathways] = useState<PathwaySearchHit[]>([]);
  const [fundingMatches, setFundingMatches] = useState<FundingMatchesByPathway>({});
  const [plans, setPlans] = useState<PathwayPlanMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [includePrivateNotesInExport, setIncludePrivateNotesInExport] = useState(false);
  const [showExportControls, setShowExportControls] = useState(false);
  const [expandedPlanIds, setExpandedPlanIds] = useState<Record<string, boolean>>({});
  const [hydratedPlanStorageOwner, setHydratedPlanStorageOwner] = useState<string | undefined>();
  const activePlanStorageOwnerRef = useRef<string | undefined>(undefined);

  const loadPathways = useCallback(async () => {
    const ownerAtLoad = planStorageOwner;
    activePlanStorageOwnerRef.current = ownerAtLoad;
    const isCurrentOwnerLoad = () => activePlanStorageOwnerRef.current === ownerAtLoad;

    setLoading(true);
    setError('');
    setExportError('');
    setHydratedPlanStorageOwner(undefined);
    setPlans({});
    try {
      const response = await axios.get('/users/savedResearchPlans', { withCredentials: true });
      if (!isCurrentOwnerLoad()) return;
      const savedPathways = response.data.savedResearchPlans || [];
      setPathways(savedPathways);
      try {
        const plansResponse = await axios.get('/users/savedResearchPlanDetails', {
          withCredentials: true,
        });
        if (!isCurrentOwnerLoad()) return;
        const serverPlans = plansResponse.data.savedResearchPlanDetails || {};
        const localPlans = readStoredPlans(ownerAtLoad);
        const savedPathwayIds = savedPathways.map((pathway: PathwaySearchHit) => pathway._id);
        const localPlansForSavedPathways = filterStoredPlansForSavedPathways(
          localPlans,
          savedPathwayIds,
        );
        const mergedPlans = mergeSavedPathwayPlansForHydration(
          localPlansForSavedPathways,
          serverPlans,
        );
        setPlans(mergedPlans);
        setHydratedPlanStorageOwner(ownerAtLoad);
        const localOnlyPlanIds = getLocalOnlySavedPathwayPlanIds(
          localPlansForSavedPathways,
          serverPlans,
          savedPathwayIds,
        );
        await Promise.all(
          localOnlyPlanIds.map((id) =>
            axios.put(
              `/users/savedResearchPlanDetails/${id}`,
              { data: { plan: localPlansForSavedPathways[id] } },
              { withCredentials: true },
            ),
          ),
        );
      } catch {
        console.error('Error loading saved research plan details.');
      }
      try {
        const matchesResponse = await axios.get('/users/savedResearchPlanFundingMatches', {
          withCredentials: true,
        });
        if (!isCurrentOwnerLoad()) return;
        setFundingMatches(matchesResponse.data.matchesByPathwayId || {});
      } catch {
        console.error('Error loading saved research-plan funding matches.');
        if (!isCurrentOwnerLoad()) return;
        setFundingMatches({});
      }
    } catch {
      console.error('Error loading saved research plans.');
      if (!isCurrentOwnerLoad()) return;
      setPathways([]);
      setFundingMatches({});
      setPlans({});
      setError('Saved research plans could not be loaded.');
    } finally {
      if (isCurrentOwnerLoad()) setLoading(false);
    }
  }, [planStorageOwner]);

  useEffect(() => {
    loadPathways();
  }, [loadPathways]);

  useEffect(() => {
    if (!planStorageOwner || hydratedPlanStorageOwner !== planStorageOwner) return;
    writeStoredPlans(plans, planStorageOwner);
  }, [hydratedPlanStorageOwner, planStorageOwner, plans]);

  useEffect(() => {
    const reminders = pathways
      .map((pathway) => deadlineReminderForPathway(pathway, fundingMatches[pathway._id] || []))
      .filter((reminder): reminder is DeadlineReminder => !!reminder)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    onSummaryChange?.({
      count: pathways.length,
      nextDeadlineLabel: reminders[0]?.detail,
      nextDeadlineDate: reminders[0]?.date,
    });
  }, [fundingMatches, onSummaryChange, pathways]);

  const getPlan = (pathway: PathwaySearchHit): PathwayPlan => {
    const storedPlan = plans[pathway._id];
    if (storedPlan) {
      return {
        intent: isPlanningIntent(storedPlan.intent)
          ? storedPlan.intent
          : defaultIntentForPathway(pathway),
        stage: isPlanningStage(storedPlan.stage) ? storedPlan.stage : 'saved',
        note: normalizePlanNote(storedPlan.note),
        checklist: normalizePlanChecklist(storedPlan.checklist),
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
          `/users/savedResearchPlanDetails/${pathwayId}`,
          { data: { plan: nextPlan } },
          { withCredentials: true },
        )
        .catch(() => console.error('Error saving research plan.'));
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
    setExpandedPlanIds((current) => {
      const next = { ...current };
      delete next[pathwayId];
      return next;
    });
    try {
      await axios.delete('/users/savedResearchPlans', {
        withCredentials: true,
        data: { savedResearchPlans: [pathwayId] },
      });
      setPlans((current) => {
        const next = { ...current };
        delete next[pathwayId];
        return next;
      });
      await axios.delete(`/users/savedResearchPlanDetails/${pathwayId}`, { withCredentials: true });
    } catch {
      console.error('Error removing saved research plan.');
      setPathways(previous);
      setError('Could not remove that saved research plan.');
    }
  };

  const toggleExpandedPlan = (pathwayId: string) => {
    setExpandedPlanIds((current) => ({
      ...current,
      [pathwayId]: !current[pathwayId],
    }));
  };

  const exportSavedPathways = async () => {
    setExporting(true);
    setExportError('');
    setExportNotice('');
    try {
      const response = includePrivateNotesInExport
        ? await axios.post(
            '/users/savedResearchPlanDetails/export',
            { includePrivateNotes: true },
            { withCredentials: true },
          )
        : await axios.get('/users/savedResearchPlanDetails/export', {
            withCredentials: true,
          });
      const payload = response.data as SavedPlanExportPayload;
      const blob = new Blob([readableSavedPlanExport(payload)], {
        type: 'text/markdown;charset=utf-8',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = includePrivateNotesInExport
        ? 'saved-research-plan-advising-share.md'
        : 'saved-research-plans.md';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setExportNotice('Advising export downloaded.');
    } catch {
      console.error('Error exporting saved research plans.');
      setExportError('Saved research plans could not be exported.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="mb-8 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-gray-900">Saved Research Plans</h2>
          <p className="text-sm text-gray-500">
            Compact by default. Open details only when you need notes, funding, or source checks.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:shrink-0 sm:justify-end">
          {pathways.length > 0 && (
            <button
              type="button"
              onClick={() => setShowExportControls((current) => !current)}
              aria-expanded={showExportControls}
              className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-3 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-[var(--yr-panel-muted)]"
            >
              Advising export
            </button>
          )}
        </div>
      </div>

      {showExportControls && pathways.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
            <input
              type="checkbox"
              checked={includePrivateNotesInExport}
              onChange={(event) => setIncludePrivateNotesInExport(event.target.checked)}
              className="h-4 w-4 rounded border-[var(--yr-line-strong)] text-blue-600 focus:ring-blue-500"
            />
            <span>Include private notes</span>
          </label>
          <button
            type="button"
            onClick={exportSavedPathways}
            disabled={exporting || loading}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-3 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-[var(--yr-panel-muted)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting ? 'Exporting...' : 'Export for advising'}
          </button>
        </div>
      )}

      {exportError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {exportError}
        </div>
      )}

      {exportNotice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {exportNotice}
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
        <div className="rounded-md border border-dashed border-[var(--yr-line-strong)] bg-[var(--yr-panel-muted)] p-5">
          <h3 className="text-base font-semibold text-gray-950">No saved research plans yet</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
            Start with Yale Research, open profiles that look promising, then save a plan when you
            find a route worth tracking for outreach, credit, funding, or an application.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to="/research"
              className="inline-flex min-h-[44px] items-center rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              Yale Research
            </Link>
            <Link
              to="/programs"
              className="inline-flex min-h-[44px] items-center rounded-md border border-blue-200 bg-[var(--yr-panel)] px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-[var(--yr-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              Programs & Fellowships
            </Link>
          </div>
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
            const deadlineSourceUrl = safeHttpUrl(deadlineReminder?.sourceUrl);
            const isExpanded = Boolean(expandedPlanIds[pathway._id]);
            const profileName = pathway.researchEntity.displayName || pathway.researchEntity.name;
            const stage = labelForOption(STAGE_OPTIONS, plan.stage);

            return (
              <article key={pathway._id} className="rounded-md border border-[var(--yr-line)] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      <span className="rounded bg-[var(--yr-blue-soft)] px-2 py-0.5 text-xs font-semibold text-blue-700">
                        {labelize(pathway.pathwayType)}
                      </span>
                      <span className="rounded bg-[var(--yr-panel-muted)] px-2 py-0.5 text-xs font-semibold text-gray-700">
                        {labelize(pathway.evidenceStrength)} evidence
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
                        {stage}
                      </span>
                    </div>
                    <h3 className="text-base font-bold leading-snug text-gray-900">
                      {pathway.studentFacingLabel}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-gray-700">{profileName}</p>
                  </div>

                  <div className="flex flex-wrap gap-2 md:justify-end">
	                    <Link
	                      to={`/research/${safeRouteSegment(pathway.researchEntity.slug)}`}
	                      className="inline-flex min-h-[44px] items-center rounded-md border border-blue-200 bg-[var(--yr-panel)] px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-[var(--yr-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                    >
                      Open profile
                    </Link>
                    <button
                      type="button"
	                      aria-expanded={isExpanded}
	                      onClick={() => toggleExpandedPlan(pathway._id)}
	                      className="inline-flex min-h-[44px] items-center rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                    >
                      {isExpanded ? 'Hide details' : 'Plan details'}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-3 text-sm text-gray-700">
                    <span className="font-semibold text-gray-900">Next step:</span>{' '}
                    {nextStepLabel(pathway.bestNextStepCategory)}
                  </div>
                  <div className="rounded border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-3 text-sm text-gray-700">
                    <span className="font-semibold text-gray-900">Deadline:</span>{' '}
                    {deadlineReminder ? deadlineReminder.detail : 'No deadline attached'}
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 space-y-4 border-t border-[var(--yr-line)] pt-4">
                    {deadlineSourceUrl && (
                      <a
                        href={deadlineSourceUrl}
                        target="_blank"
                        rel={EXTERNAL_LINK_REL}
                        className="inline-flex text-sm font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
                      >
                        Open deadline source
                      </a>
                    )}

                    {fundingCue && (
                      <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{fundingCue.label}</span>
                          <span className="rounded bg-[var(--yr-panel)]/80 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                            {fundingCue.confidence === 'strong'
                              ? 'Evidence-backed'
                              : 'Planning cue'}
                          </span>
                        </div>
                        <p className="mt-1 text-emerald-800">{fundingCue.detail}</p>
                        <Link
                          to="/programs"
                          className="mt-2 inline-flex text-sm font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-950"
                        >
                          Browse programs
                        </Link>
                      </div>
                    )}

                    {matches.length > 0 && (
                      <div className="rounded-md border border-cyan-100 bg-cyan-50 p-3 text-sm text-cyan-950">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="font-semibold">Fellowship candidates</span>
                          <span className="rounded bg-[var(--yr-panel)]/80 px-2 py-0.5 text-xs font-semibold text-cyan-700">
                            Scored from saved research plan
                          </span>
                        </div>
                        <div className="space-y-2">
                          {matches.slice(0, 2).map((match) => {
                            const deadline = formatDeadline(match.deadline);
                            const fellowshipSourceUrl = safeHttpUrl(
                              match.applicationLink || match.sourceUrls?.[0],
                            );
                            return (
                              <div
                                key={match.fellowshipId}
                                className="rounded border border-cyan-100 bg-[var(--yr-panel)]/80 p-2"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <Link
                                    to={`/programs?program=${safeRouteSegment(match.fellowshipId)}`}
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
                                    rel={EXTERNAL_LINK_REL}
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

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Intent
                        <select
                          value={plan.intent}
                          onChange={(event) =>
                            updatePlan(pathway._id, {
                              intent: event.target.value as PlanningIntent,
                            })
                          }
                          className="mt-1 block w-full rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-2 py-2 text-sm font-normal normal-case tracking-normal text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                            updatePlan(pathway._id, {
                              stage: event.target.value as PlanningStage,
                            })
                          }
                          className="mt-1 block w-full rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-2 py-2 text-sm font-normal normal-case tracking-normal text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {STAGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Note
                      <textarea
                        value={plan.note}
                        onChange={(event) =>
                          updatePlan(pathway._id, { note: normalizePlanNote(event.target.value) })
                        }
                        rows={3}
                        placeholder="Why this route matters, what to check next, or who to ask."
                        className="mt-1 block w-full resize-y rounded-md border border-[var(--yr-line-strong)] px-3 py-2 text-sm font-normal normal-case tracking-normal text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>

                    <div className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-3">
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
                              className="mt-0.5 h-4 w-4 rounded border-[var(--yr-line-strong)] text-blue-600 focus:ring-blue-500"
                            />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {pathway.explanation && (
                      <p className="line-clamp-3 text-sm text-gray-600">{pathway.explanation}</p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {sourceUrls.slice(0, 2).map((url, index) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel={EXTERNAL_LINK_REL}
                          className="text-xs font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
                        >
                          Source {index + 1}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
	                    type="button"
	                    onClick={() => removePathway(pathway._id)}
	                    className="inline-flex min-h-[44px] items-center rounded-md px-2 text-sm font-semibold text-gray-500 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
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
