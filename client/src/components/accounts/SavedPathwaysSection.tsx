import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../shared/LoadingSpinner';
import type { PathwaySearchHit } from '../../types/pathway';
import axios from '../../utils/axios';
import UserContext from '../../contexts/UserContext';
import { EXTERNAL_LINK_REL, safeHttpUrl, safeHttpUrlList, safeRouteSegment } from '../../utils/url';

type PlanningIntent = 'thesis' | 'outreach' | 'credit' | 'funding' | 'apply' | 'later';
type PlanningStage = 'saved' | 'researching' | 'ready' | 'acted' | 'archived';

export interface PathwayPlan {
  intent: PlanningIntent;
  stage: PlanningStage;
  note: string;
  checklist: Record<string, boolean>;
  checklistHistory: ChecklistHistoryItem[];
  targetDeadline: string | null;
  actedOnDate: string | null;
  followUpIntervalDays: number | null;
}

export interface ChecklistHistoryItem {
  intent: PlanningIntent;
  label: string;
  completedAt: string;
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

interface SavedResearchEntitySummary {
  _id: string;
  slug: string;
  name: string;
  displayName?: string;
  kind?: string;
  entityType?: string;
  departments?: string[];
  school?: string;
  shortDescription?: string;
  description?: string;
}

const savedEntityAsPlanningItem = (entity: SavedResearchEntitySummary): PathwaySearchHit => ({
  _id: entity._id,
  pathwayType: 'RESEARCH_ENTITY',
  status: 'SAVED',
  evidenceStrength: 'UNKNOWN',
  studentFacingLabel: entity.displayName || entity.name,
  explanation: entity.shortDescription || entity.description,
  bestNextStepCategory: 'save-for-later',
  sourceUrls: [],
  evidence: [],
  researchEntity: {
    _id: entity._id,
    slug: entity.slug,
    name: entity.name,
    displayName: entity.displayName,
    kind: entity.kind,
    entityType: entity.entityType,
    departments: entity.departments || [],
    researchAreas: [],
    school: entity.school,
  },
});

type DashboardResponse = Awaited<ReturnType<typeof axios.get>>;
type OptionalDashboardResponse =
  | { value: DashboardResponse; error: false; apiMode?: SavedPlanApiMode }
  | { value: null; error: true };
type SavedPlanDashboardLoad = [
  DashboardResponse,
  OptionalDashboardResponse,
  OptionalDashboardResponse,
  OptionalDashboardResponse,
];
const savedPlanDashboardLoads = new Map<string, Promise<SavedPlanDashboardLoad>>();

const loadSavedPlanDashboard = (owner: string): Promise<SavedPlanDashboardLoad> => {
  const existing = savedPlanDashboardLoads.get(owner);
  if (existing) return existing;
  const legacyPathwaysRequest = axios
    .get('/users/savedResearchPlans', { withCredentials: true })
    .then(
      (value) => ({ value, error: false as const }),
      () => ({ value: null, error: true as const }),
    );
  const request = Promise.all([
    axios.get('/users/savedResearchEntities', { withCredentials: true }).catch(async () => {
      const legacyResult = await legacyPathwaysRequest;
      if (legacyResult.error || !legacyResult.value) {
        throw new Error('Saved research plans unavailable');
      }
      return legacyResult.value;
    }),
    axios
      .get('/users/savedResearchEntityPlans', { withCredentials: true })
      .then(
        (value) => ({ value, apiMode: 'entity' as const }),
        () =>
          axios
            .get('/users/savedResearchPlanDetails', { withCredentials: true })
            .then((value) => ({ value, apiMode: 'pathway' as const })),
      )
      .then(
        ({ value, apiMode }) => ({ value, error: false as const, apiMode }),
        () => ({ value: null, error: true as const }),
      ),
    axios.get('/users/savedResearchPlanFundingMatches', { withCredentials: true }).then(
      (value) => ({ value, error: false as const }),
      () => ({ value: null, error: true as const }),
    ),
    legacyPathwaysRequest,
  ]) as Promise<SavedPlanDashboardLoad>;
  savedPlanDashboardLoads.set(owner, request);
  void request.finally(() => window.setTimeout(() => savedPlanDashboardLoads.delete(owner), 0));
  return request;
};

interface SavedPlanExportItem {
  id: string;
  title: string;
  researchHome: string;
  leadProfessor: string;
  topic: string;
  intent: string;
  stage: string;
  completedChecklist: string[];
  nextStep: string;
  date: string;
  sources: string[];
  note?: string;
}

interface SavedPlanExportPayload {
  exportedAt: string;
  items: SavedPlanExportItem[];
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

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FOLLOW_UP_INTERVALS = [7, 14, 30, 60, 90] as const;
const normalizeDateOnly = (value: unknown): string | null => {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
    ? value
    : null;
};
const normalizeFollowUpInterval = (value: unknown): number | null =>
  typeof value === 'number' &&
  FOLLOW_UP_INTERVALS.includes(value as (typeof FOLLOW_UP_INTERVALS)[number])
    ? value
    : null;
const localToday = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const addLocalDays = (dateOnly: string, days: number): string => {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return localToday(date);
};

export const planningCueForPlan = (
  pathway: PathwaySearchHit,
  plan: PathwayPlan,
  now = new Date(),
): { detail: string; date: string; priority: number } | null => {
  const today = localToday(now);
  const cues: Array<{ detail: string; date: string; priority: number }> = [];
  if (plan.actedOnDate && plan.followUpIntervalDays) {
    const due = addLocalDays(plan.actedOnDate, plan.followUpIntervalDays);
    if (due <= today) {
      cues.push({ detail: `Follow up on ${pathway.studentFacingLabel}`, date: due, priority: 0 });
    }
  }
  if (plan.targetDeadline && plan.targetDeadline >= today) {
    cues.push({
      detail: `${pathway.studentFacingLabel}: Due ${formatDateOnly(plan.targetDeadline)}`,
      date: plan.targetDeadline,
      priority: 1,
    });
  }
  return (
    cues.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.priority - b.priority || a.detail.localeCompare(b.detail),
    )[0] || null
  );
};

const formatDateOnly = (value: string): string => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

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

const intentLabel = (intent: PlanningIntent): string =>
  INTENT_OPTIONS.find((option) => option.value === intent)?.label || intent;

const normalizeChecklistHistory = (value: unknown): ChecklistHistoryItem[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ChecklistHistoryItem => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<ChecklistHistoryItem>;
      return (
        isPlanningIntent(candidate.intent) &&
        typeof candidate.label === 'string' &&
        candidate.label.trim().length > 0 &&
        typeof candidate.completedAt === 'string'
      );
    })
    .slice(-50);
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

const readableSavedPlanExport = (payload: SavedPlanExportPayload): string => {
  const lines = [
    '# Saved Research Plans',
    '',
    `Exported: ${payload.exportedAt ? formatDeadline(payload.exportedAt) : formatDeadline(new Date().toISOString())}`,
    `Plans: ${payload.items.length}`,
    '',
  ];

  for (const [index, item] of payload.items.entries()) {
    lines.push(
      `## ${index + 1}. ${item.title}`,
      '',
      `Research home: ${item.researchHome}`,
      `Lead professor: ${item.leadProfessor}`,
      `Topic: ${item.topic}`,
      `Intent: ${item.intent}`,
      `Stage: ${item.stage}`,
      `Next step: ${item.nextStep}`,
      `Information checked: ${item.date}`,
    );

    if (item.note) {
      lines.push('', 'Included plan note:', item.note);
    }

    if (item.completedChecklist.length > 0) {
      lines.push(
        '',
        'Completed checklist:',
        ...item.completedChecklist.map((label) => `- ${label}`),
      );
    }

    if (item.sources.length > 0) {
      lines.push('', 'Sources:', ...item.sources.map((source) => `- ${source}`));
    }

    lines.push('');
  }

  return lines.join('\n');
};

export const advisingExportItem = (
  pathway: PathwaySearchHit,
  plan: PathwayPlan,
  includeNote = false,
): SavedPlanExportItem => ({
  id: pathway._id,
  title: pathway.studentFacingLabel || 'Saved research plan',
  researchHome:
    pathway.researchEntity.displayName ||
    pathway.researchEntity.name ||
    'Research home unavailable',
  leadProfessor: 'Lead professor unavailable',
  topic:
    pathway.explanation || pathway.researchEntity.researchAreas?.join(', ') || 'Topic unavailable',
  intent: labelForOption(INTENT_OPTIONS, plan.intent),
  stage: labelForOption(STAGE_OPTIONS, plan.stage),
  completedChecklist: CHECKLIST_TEMPLATES[plan.intent]
    .filter((entry) => plan.checklist[entry.key])
    .map((entry) => entry.label),
  nextStep: pathway.bestNextStep || nextStepLabel(pathway.bestNextStepCategory),
  date: pathway.lastObservedAt ? formatDeadline(pathway.lastObservedAt) : 'Date unavailable',
  sources: safeHttpUrlList(pathway.sourceUrls),
  note: includeNote && plan.note.trim() ? plan.note.trim() : undefined,
});

const normalizeStoredPlan = (value: unknown): PathwayPlan | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<PathwayPlan>;
  return {
    intent: isPlanningIntent(candidate.intent) ? candidate.intent : 'later',
    stage: isPlanningStage(candidate.stage) ? candidate.stage : 'saved',
    note: normalizePlanNote(candidate.note),
    checklist: normalizePlanChecklist(candidate.checklist),
    checklistHistory: normalizeChecklistHistory(candidate.checklistHistory),
    targetDeadline: normalizeDateOnly(candidate.targetDeadline),
    actedOnDate: normalizeDateOnly(candidate.actedOnDate),
    followUpIntervalDays: normalizeFollowUpInterval(candidate.followUpIntervalDays),
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
        checklistHistory: [],
        targetDeadline: null,
        actedOnDate: null,
        followUpIntervalDays: null,
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

export const researchEntityIdsByLegacyPathway = (
  pathways: PathwaySearchHit[],
): Record<string, string> =>
  Object.fromEntries(
    pathways.flatMap((pathway) => {
      const pathwayId = String(pathway?._id || '');
      const entityId = String(pathway?.researchEntity?._id || '');
      return STORAGE_PLAN_ID_RE.test(pathwayId) && STORAGE_PLAN_ID_RE.test(entityId)
        ? [[pathwayId, entityId] as const]
        : [];
    }),
  );

export const uniqueLegacyPathwayIdsByResearchEntity = (
  pathways: PathwaySearchHit[],
): Record<string, string> => {
  const pathwayIdsByEntity = new Map<string, string[]>();
  for (const [pathwayId, entityId] of Object.entries(
    researchEntityIdsByLegacyPathway(pathways),
  )) {
    pathwayIdsByEntity.set(entityId, [...(pathwayIdsByEntity.get(entityId) || []), pathwayId]);
  }
  return Object.fromEntries(
    [...pathwayIdsByEntity].flatMap(([entityId, pathwayIds]) =>
      pathwayIds.length === 1 ? [[entityId, pathwayIds[0]] as const] : [],
    ),
  );
};

export const remapLegacyPathwayPlansToResearchEntities = (
  plans: PathwayPlanMap,
  entityIdByPathwayId: Record<string, string>,
  savedResearchEntityIds: Iterable<string>,
): PathwayPlanMap => {
  const savedIds = new Set(savedResearchEntityIds);
  const normalizedPlans = normalizePathwayPlanMap(plans);
  const remapped: PathwayPlanMap = {};
  const sourceIdsByTarget = new Map<string, string[]>();

  for (const id of Object.keys(normalizedPlans).sort()) {
    const targetId = savedIds.has(id) ? id : entityIdByPathwayId[id];
    if (!targetId || !savedIds.has(targetId)) continue;
    sourceIdsByTarget.set(targetId, [...(sourceIdsByTarget.get(targetId) || []), id]);
  }
  for (const [targetId, sourceIds] of sourceIdsByTarget) {
    if (sourceIds.length === 1) remapped[targetId] = normalizedPlans[sourceIds[0]];
  }

  return remapped;
};

export const legacyPathwayPlanTargetsAreUnique = (
  plans: PathwayPlanMap,
  entityIdByPathwayId: Record<string, string>,
  savedResearchEntityIds: Iterable<string>,
): boolean => {
  const savedIds = new Set(savedResearchEntityIds);
  const targetIds = Object.keys(normalizePathwayPlanMap(plans)).flatMap((id) => {
    if (savedIds.has(id)) return [id];
    const entityId = entityIdByPathwayId[id];
    return entityId && savedIds.has(entityId) ? [entityId] : [];
  });
  return targetIds.length === new Set(targetIds).size;
};

export const remapFundingMatchesToResearchEntities = (
  matchesByPathwayId: FundingMatchesByPathway,
  entityIdByPathwayId: Record<string, string>,
  savedResearchEntityIds: Iterable<string>,
): FundingMatchesByPathway => {
  const savedIds = new Set(savedResearchEntityIds);
  const matchesByEntity: FundingMatchesByPathway = {};

  for (const [pathwayId, matches] of Object.entries(matchesByPathwayId || {})) {
    const entityId = savedIds.has(pathwayId) ? pathwayId : entityIdByPathwayId[pathwayId];
    if (!entityId || !savedIds.has(entityId) || !Array.isArray(matches)) continue;
    matchesByEntity[entityId] = [...(matchesByEntity[entityId] || []), ...matches];
  }

  for (const [entityId, matches] of Object.entries(matchesByEntity)) {
    const bestByFellowship = new Map<string, FellowshipFundingMatch>();
    for (const match of matches) {
      const key = match.fellowshipId || `${match.pathwayId}:${match.title}`;
      const current = bestByFellowship.get(key);
      if (!current || match.score > current.score) bestByFellowship.set(key, match);
    }
    matchesByEntity[entityId] = [...bestByFellowship.values()]
      .sort(
        (a, b) =>
          b.score - a.score ||
          String(a.deadline || '').localeCompare(String(b.deadline || '')) ||
          a.title.localeCompare(b.title),
      )
      .slice(0, 5);
  }

  return matchesByEntity;
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

type SavedPlanApiMode = 'entity' | 'pathway';

const SavedPathwaysSection = ({ onSummaryChange }: SavedPathwaysSectionProps) => {
  const { user } = useContext(UserContext);
  const planStorageOwner = normalizeSavedPlanStorageOwner(user?.netId);
  const [pathways, setPathways] = useState<PathwaySearchHit[]>([]);
  const [fundingMatches, setFundingMatches] = useState<FundingMatchesByPathway>({});
  const [plans, setPlans] = useState<PathwayPlanMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [showExportControls, setShowExportControls] = useState(false);
  const [selectedExportIds, setSelectedExportIds] = useState<Record<string, boolean>>({});
  const [includedNoteIds, setIncludedNoteIds] = useState<Record<string, boolean>>({});
  const [showExportPreview, setShowExportPreview] = useState(false);
  const exportPreviewRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const [expandedPlanIds, setExpandedPlanIds] = useState<Record<string, boolean>>({});
  const [hydratedPlanStorageOwner, setHydratedPlanStorageOwner] = useState<string | undefined>();
  const [canRewriteStoredPlans, setCanRewriteStoredPlans] = useState(false);
  const [planApiMode, setPlanApiMode] = useState<SavedPlanApiMode | null>(null);
  const [planApiIdBySavedId, setPlanApiIdBySavedId] = useState<Record<string, string>>({});
  const [planMigrationNotice, setPlanMigrationNotice] = useState('');
  const [planSaveStatus, setPlanSaveStatus] = useState<Record<string, string>>({});
  const [pendingIntentChange, setPendingIntentChange] = useState<{
    pathwayId: string;
    nextIntent: PlanningIntent;
    returnFocus: HTMLSelectElement;
  } | null>(null);
  const confirmIntentButtonRef = useRef<HTMLButtonElement>(null);
  const activePlanStorageOwnerRef = useRef<string | undefined>(undefined);

  const loadPathways = useCallback(async () => {
    const ownerAtLoad = planStorageOwner;
    activePlanStorageOwnerRef.current = ownerAtLoad;
    const isCurrentOwnerLoad = () => activePlanStorageOwnerRef.current === ownerAtLoad;

    setLoading(true);
    setError('');
    setExportError('');
    setHydratedPlanStorageOwner(undefined);
    setCanRewriteStoredPlans(false);
    setPlanApiMode(null);
    setPlanApiIdBySavedId({});
    setPlanMigrationNotice('');
    setPlans({});
    try {
      const [response, plansResult, matchesResult, legacyPathwaysResult] =
        await loadSavedPlanDashboard(ownerAtLoad || 'authenticated-account');
      if (!isCurrentOwnerLoad()) return;
      const responseData = (response as any).data;
      const savedPathways: PathwaySearchHit[] = responseData.savedResearchEntities
        ? (responseData.savedResearchEntities as SavedResearchEntitySummary[]).map(
            savedEntityAsPlanningItem,
          )
        : responseData.savedResearchPlans || [];
      const legacyPathways =
        !legacyPathwaysResult.error && legacyPathwaysResult.value
          ? (legacyPathwaysResult.value as any).data.savedResearchPlans || []
          : responseData.savedResearchPlans || [];
      const entityIdByPathwayId = researchEntityIdsByLegacyPathway(legacyPathways);
      const pathwayIdByEntityId = uniqueLegacyPathwayIdsByResearchEntity(legacyPathways);
      const savedResearchEntityIds = savedPathways.map((pathway: PathwaySearchHit) => pathway._id);
      const hasCanonicalEntityResponse = Array.isArray(responseData.savedResearchEntities);
      const legacyMappingIsComplete = !hasCanonicalEntityResponse || !legacyPathwaysResult.error;
      setPathways(savedPathways);
      if (!plansResult.error && plansResult.value) {
        const plansResponse: any = plansResult.value;
        if (!isCurrentOwnerLoad()) return;
        const rawServerPlans =
          plansResponse.data.savedResearchEntityPlans ||
          plansResponse.data.savedResearchPlanDetails ||
          {};
        const activePlanApiMode = plansResult.apiMode || 'pathway';
        const activePlanApiIdBySavedId =
          activePlanApiMode === 'entity'
            ? {}
            : hasCanonicalEntityResponse
              ? pathwayIdByEntityId
              : Object.fromEntries(savedResearchEntityIds.map((id) => [id, id]));
        const planApiMappingIsComplete =
          activePlanApiMode === 'entity' ||
          savedResearchEntityIds.every((id) => activePlanApiIdBySavedId[id]);
        const serverPlans =
          activePlanApiMode === 'pathway' && hasCanonicalEntityResponse
            ? remapLegacyPathwayPlansToResearchEntities(
                rawServerPlans,
                entityIdByPathwayId,
                savedResearchEntityIds,
              )
            : rawServerPlans;
        const localPlans = readStoredPlans(ownerAtLoad);
        const localPlanTargetsAreUnique = legacyPathwayPlanTargetsAreUnique(
          localPlans,
          entityIdByPathwayId,
          savedResearchEntityIds,
        );
        const localPlansForSavedPathways = remapLegacyPathwayPlansToResearchEntities(
          localPlans,
          entityIdByPathwayId,
          savedResearchEntityIds,
        );
        const mergedPlans = mergeSavedPathwayPlansForHydration(
          localPlansForSavedPathways,
          serverPlans,
        );
        const localOnlyPlanIds = getLocalOnlySavedPathwayPlanIds(
          localPlansForSavedPathways,
          serverPlans,
          savedResearchEntityIds,
        );
        await Promise.all(
          localOnlyPlanIds.flatMap((id) => {
            const apiId =
              activePlanApiMode === 'entity' ? id : activePlanApiIdBySavedId[id];
            return apiId
              ? [
                  axios.put(
                    activePlanApiMode === 'entity'
                      ? `/users/savedResearchEntityPlans/${apiId}`
                      : `/users/savedResearchPlanDetails/${apiId}`,
                    { data: { plan: localPlansForSavedPathways[id] } },
                    { withCredentials: true },
                  ),
                ]
              : [];
          }),
        );
        if (!isCurrentOwnerLoad()) return;
        setPlans(mergedPlans);
        setHydratedPlanStorageOwner(ownerAtLoad);
        setPlanApiMode(activePlanApiMode);
        setPlanApiIdBySavedId(activePlanApiIdBySavedId);
        setCanRewriteStoredPlans(
          legacyMappingIsComplete && localPlanTargetsAreUnique && planApiMappingIsComplete,
        );
        if (!localPlanTargetsAreUnique) {
          setPlanMigrationNotice(
            'Multiple browser-only plans map to the same research profile. Your original browser records were kept so no plan was chosen or overwritten automatically.',
          );
        } else if (!planApiMappingIsComplete) {
          setPlanMigrationNotice(
            'A saved research profile does not have one safe legacy pathway for fallback updates. Your original browser records were kept and no fallback write was attempted.',
          );
        }
      } else {
        console.error('Error loading saved research plan details.');
      }
      if (!matchesResult.error && matchesResult.value) {
        const matchesData = (matchesResult.value as any).data;
        setFundingMatches(
          remapFundingMatchesToResearchEntities(
            matchesData.matchesByResearchEntityId || matchesData.matchesByPathwayId || {},
            entityIdByPathwayId,
            savedResearchEntityIds,
          ),
        );
      } else {
        setFundingMatches({});
      }
    } catch {
      console.error('Error loading saved research plans.');
      if (!isCurrentOwnerLoad()) return;
      setPathways([]);
      setFundingMatches({});
      setPlans({});
      setCanRewriteStoredPlans(false);
      setPlanApiMode(null);
      setPlanApiIdBySavedId({});
      setError('Saved research plans could not be loaded.');
    } finally {
      if (isCurrentOwnerLoad()) setLoading(false);
    }
  }, [planStorageOwner]);

  useEffect(() => {
    loadPathways();
  }, [loadPathways]);

  useEffect(() => {
    if (
      !canRewriteStoredPlans ||
      !planStorageOwner ||
      hydratedPlanStorageOwner !== planStorageOwner
    ) {
      return;
    }
    writeStoredPlans(plans, planStorageOwner);
  }, [canRewriteStoredPlans, hydratedPlanStorageOwner, planStorageOwner, plans]);

  useEffect(() => {
    const watchedReminders = pathways
      .map((pathway) => deadlineReminderForPathway(pathway, fundingMatches[pathway._id] || []))
      .filter((reminder): reminder is DeadlineReminder => !!reminder)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const planCues = pathways.flatMap((pathway) => {
      const plan = plans[pathway._id];
      const cue = plan ? planningCueForPlan(pathway, plan) : null;
      return cue ? [{ ...cue, pathwayId: pathway._id }] : [];
    });
    const candidates = [
      ...planCues.map((cue) => ({
        label: cue.detail,
        date: `${cue.date}T12:00:00`,
        priority: cue.priority,
        tie: cue.pathwayId,
      })),
      ...watchedReminders.map((reminder) => ({
        label: reminder.detail,
        date: reminder.date,
        priority: 2,
        tie: reminder.title,
      })),
    ].sort(
      (a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime() ||
        a.priority - b.priority ||
        a.tie.localeCompare(b.tie),
    );

    onSummaryChange?.({
      count: pathways.length,
      nextDeadlineLabel: candidates[0]?.label,
      nextDeadlineDate: candidates[0]?.date,
    });
  }, [fundingMatches, onSummaryChange, pathways, plans]);

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
        checklistHistory: normalizeChecklistHistory(storedPlan.checklistHistory),
        targetDeadline: normalizeDateOnly(storedPlan.targetDeadline),
        actedOnDate: normalizeDateOnly(storedPlan.actedOnDate),
        followUpIntervalDays: normalizeFollowUpInterval(storedPlan.followUpIntervalDays),
      };
    }

    return {
      intent: defaultIntentForPathway(pathway),
      stage: 'saved',
      note: '',
      checklist: {},
      checklistHistory: [],
      targetDeadline: null,
      actedOnDate: null,
      followUpIntervalDays: null,
    };
  };

  const updatePlan = (pathwayId: string, patch: Partial<PathwayPlan>) => {
    const planApiId = planApiMode === 'entity' ? pathwayId : planApiIdBySavedId[pathwayId];
    if (
      hydratedPlanStorageOwner !== planStorageOwner ||
      !plans[pathwayId] ||
      !planApiMode ||
      !planApiId
    ) {
      return;
    }
    setPlans((current) => {
      const currentPlan = current[pathwayId];
      if (!currentPlan) return current;
      const nextPlan = { ...currentPlan, ...patch };
      setPlanSaveStatus((statuses) => ({ ...statuses, [pathwayId]: 'Saving plan...' }));
      axios
        .put(
          planApiMode === 'entity'
            ? `/users/savedResearchEntityPlans/${planApiId}`
            : `/users/savedResearchPlanDetails/${planApiId}`,
          { data: { plan: nextPlan } },
          { withCredentials: true },
        )
        .then(() => setPlanSaveStatus((statuses) => ({ ...statuses, [pathwayId]: 'Plan saved.' })))
        .catch(() => {
          console.error('Error saving research plan.');
          setPlanSaveStatus((statuses) => ({
            ...statuses,
            [pathwayId]: 'Plan could not be saved.',
          }));
        });
      return {
        ...current,
        [pathwayId]: nextPlan,
      };
    });
  };

  const toggleChecklistItem = (pathwayId: string, itemKey: string, checked: boolean) => {
    const currentPlan = plans[pathwayId];
    if (!currentPlan || hydratedPlanStorageOwner !== planStorageOwner) return;

    updatePlan(pathwayId, {
      checklist: {
        ...(currentPlan.checklist || {}),
        [itemKey]: checked,
      },
    });
  };

  const requestIntentChange = (
    pathwayId: string,
    nextIntent: PlanningIntent,
    control: HTMLSelectElement,
  ) => {
    const currentPlan = plans[pathwayId];
    if (!currentPlan || currentPlan.intent === nextIntent) return;
    const completed = CHECKLIST_TEMPLATES[currentPlan.intent].filter(
      (item) => currentPlan.checklist[item.key],
    );
    if (completed.length === 0) {
      updatePlan(pathwayId, { intent: nextIntent, checklist: {} });
      return;
    }
    setPendingIntentChange({ pathwayId, nextIntent, returnFocus: control });
  };

  const closeIntentConfirmation = () => {
    const returnFocus = pendingIntentChange?.returnFocus;
    setPendingIntentChange(null);
    window.setTimeout(() => returnFocus?.focus(), 0);
  };

  const confirmIntentChange = () => {
    if (!pendingIntentChange) return;
    const { pathwayId, nextIntent, returnFocus } = pendingIntentChange;
    const currentPlan = plans[pathwayId];
    if (currentPlan) {
      const completedAt = new Date().toISOString();
      const archived = CHECKLIST_TEMPLATES[currentPlan.intent]
        .filter((item) => currentPlan.checklist[item.key])
        .map((item) => ({ intent: currentPlan.intent, label: item.label, completedAt }));
      updatePlan(pathwayId, {
        intent: nextIntent,
        checklist: {},
        checklistHistory: [...currentPlan.checklistHistory, ...archived].slice(-50),
      });
    }
    setPendingIntentChange(null);
    window.setTimeout(() => returnFocus.focus(), 0);
  };

  useEffect(() => {
    if (pendingIntentChange) confirmIntentButtonRef.current?.focus();
  }, [pendingIntentChange]);

  const removePathway = async (pathwayId: string) => {
    const planApiId = planApiMode === 'entity' ? pathwayId : planApiIdBySavedId[pathwayId];
    if (!planApiMode || !planApiId) {
      setError('This saved research plan cannot be changed safely while compatibility data is unavailable.');
      return;
    }
    const previous = pathways;
    setPathways((current) => current.filter((pathway) => pathway._id !== pathwayId));
    setExpandedPlanIds((current) => {
      const next = { ...current };
      delete next[pathwayId];
      return next;
    });
    try {
      if (planApiMode === 'pathway') {
        await axios.delete('/users/savedResearchPlans', {
          withCredentials: true,
          data: { savedResearchPlans: [planApiId] },
        });
      } else {
        await axios.delete('/users/savedResearchEntities', {
          withCredentials: true,
          data: { savedResearchEntities: [pathwayId] },
        });
      }
      setPlans((current) => {
        const next = { ...current };
        delete next[pathwayId];
        return next;
      });
      await axios.delete(
        planApiMode === 'pathway'
          ? `/users/savedResearchPlanDetails/${planApiId}`
          : `/users/savedResearchEntityPlans/${planApiId}`,
        { withCredentials: true },
      );
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

  const selectedExportItems = pathways
    .filter((pathway) => selectedExportIds[pathway._id] && plans[pathway._id])
    .map((pathway) =>
      advisingExportItem(pathway, plans[pathway._id], includedNoteIds[pathway._id]),
    );
  const exportPayload = (): SavedPlanExportPayload => ({
    exportedAt: new Date().toISOString(),
    items: selectedExportItems,
  });

  const openExportPreview = () => {
    setExportNotice('');
    if (selectedExportItems.length === 0) {
      setExportError('Select at least one finalist to preview.');
      return;
    }
    setExportError('');
    setShowExportPreview(true);
    window.setTimeout(() => exportPreviewRef.current?.focus(), 0);
  };

  const closeExportPreview = () => {
    setShowExportPreview(false);
    window.setTimeout(() => exportTriggerRef.current?.focus(), 0);
  };

  const downloadExportMarkdown = () => {
    try {
      const payload = exportPayload();
      const blob = new Blob([readableSavedPlanExport(payload)], {
        type: 'text/markdown;charset=utf-8',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'advising-finalists.md';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setExportNotice('Advising Markdown downloaded.');
    } catch {
      console.error('Error exporting saved research plans.');
      setExportError('Saved research plans could not be exported.');
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
              ref={exportTriggerRef}
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
        <div className="mb-4 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-gray-800" aria-live="polite">
              {selectedExportItems.length} of {pathways.length} finalists selected
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setSelectedExportIds(Object.fromEntries(pathways.map(({ _id }) => [_id, true])))
                }
                className="min-h-[44px] rounded-md border bg-white px-3 py-2 text-sm font-semibold"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedExportIds({});
                  setIncludedNoteIds({});
                }}
                className="min-h-[44px] rounded-md border bg-white px-3 py-2 text-sm font-semibold"
              >
                Clear
              </button>
            </div>
          </div>
          <fieldset className="mt-3 space-y-2">
            <legend className="sr-only">Choose advising finalists</legend>
            {pathways.map((pathway) => (
              <div
                key={pathway._id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--yr-line)] pt-2"
              >
                <label className="flex min-h-[44px] items-center gap-2 text-sm font-medium text-gray-800">
                  <input
                    type="checkbox"
                    checked={!!selectedExportIds[pathway._id]}
                    onChange={(event) =>
                      setSelectedExportIds((current) => ({
                        ...current,
                        [pathway._id]: event.target.checked,
                      }))
                    }
                  />
                  <span>{pathway.studentFacingLabel}</span>
                </label>
                <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    disabled={!selectedExportIds[pathway._id] || !plans[pathway._id]?.note.trim()}
                    checked={!!includedNoteIds[pathway._id]}
                    onChange={(event) =>
                      setIncludedNoteIds((current) => ({
                        ...current,
                        [pathway._id]: event.target.checked,
                      }))
                    }
                  />
                  <span>Include this plan note</span>
                </label>
              </div>
            ))}
          </fieldset>
          <button
            type="button"
            onClick={openExportPreview}
            disabled={loading}
            className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Preview advising export
          </button>
        </div>
      )}
      {showExportPreview && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 print:static print:bg-white print:p-0">
          <div
            ref={exportPreviewRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="advising-preview-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeExportPreview();
            }}
            className="mx-auto max-w-3xl rounded-md bg-white p-6 shadow-xl outline-none print:max-w-none print:shadow-none"
          >
            <div className="flex items-start justify-between gap-4 print:hidden">
              <div>
                <h2 id="advising-preview-title" className="text-xl font-bold">
                  Advising export preview
                </h2>
                <p className="text-sm text-gray-600">{selectedExportItems.length} finalists</p>
              </div>
              <button
                type="button"
                onClick={closeExportPreview}
                aria-label="Close preview"
                className="min-h-[44px] min-w-[44px] rounded-md border text-xl"
              >
                ×
              </button>
            </div>
            <div className="mt-5 space-y-8" data-testid="advising-export-preview">
              <header>
                <h1 className="text-2xl font-bold">Saved Research Plans</h1>
                <p className="text-sm text-gray-600">
                  Prepared {formatDeadline(new Date().toISOString())}
                </p>
              </header>
              {selectedExportItems.map((item) => (
                <article key={item.id} className="break-inside-avoid border-t pt-4">
                  <h2 className="text-lg font-bold">{item.title}</h2>
                  <dl className="mt-2 grid gap-1 text-sm">
                    <div>
                      <dt className="inline font-semibold">Research home: </dt>
                      <dd className="inline">{item.researchHome}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Lead professor: </dt>
                      <dd className="inline">{item.leadProfessor}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Topic: </dt>
                      <dd className="inline">{item.topic}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Intent: </dt>
                      <dd className="inline">{item.intent}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Stage: </dt>
                      <dd className="inline">{item.stage}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Next step: </dt>
                      <dd className="inline">{item.nextStep}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Information checked: </dt>
                      <dd className="inline">{item.date}</dd>
                    </div>
                  </dl>
                  {item.completedChecklist.length > 0 && (
                    <div className="mt-3">
                      <h3 className="font-semibold">Completed checklist</h3>
                      <ul className="list-disc pl-5 text-sm">
                        {item.completedChecklist.map((label) => (
                          <li key={label}>{label}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {item.note && (
                    <div className="mt-3">
                      <h3 className="font-semibold">Included plan note</h3>
                      <p className="whitespace-pre-wrap text-sm">{item.note}</p>
                    </div>
                  )}
                </article>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2 print:hidden">
              <button
                type="button"
                onClick={downloadExportMarkdown}
                className="min-h-[44px] rounded-md border px-3 py-2 text-sm font-semibold"
              >
                Download Markdown
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[44px] rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white"
              >
                Print or save PDF
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingIntentChange &&
        (() => {
          const currentPlan = plans[pendingIntentChange.pathwayId];
          const completedCount = currentPlan
            ? CHECKLIST_TEMPLATES[currentPlan.intent].filter(
                (item) => currentPlan.checklist[item.key],
              ).length
            : 0;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="intent-change-title"
                aria-describedby="intent-change-description"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeIntentConfirmation();
                }}
                className="w-full max-w-md rounded-md bg-white p-5 shadow-xl"
              >
                <h2 id="intent-change-title" className="text-lg font-semibold text-gray-950">
                  Update this checklist?
                </h2>
                <p id="intent-change-description" className="mt-2 text-sm text-gray-700">
                  Switching to {intentLabel(pendingIntentChange.nextIntent)} creates a new
                  checklist. Your {completedCount} completed{' '}
                  {completedCount === 1 ? 'step' : 'steps'} will move to completed step history.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeIntentConfirmation}
                    className="rounded-md border px-3 py-2 text-sm font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    ref={confirmIntentButtonRef}
                    type="button"
                    onClick={confirmIntentChange}
                    className="rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white"
                  >
                    Update checklist
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

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

      {planMigrationNotice && (
        <div
          role="status"
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {planMigrationNotice}
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
            find a profile worth tracking for outreach, credit, funding, or an application.
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
            const planIsHydrated =
              hydratedPlanStorageOwner === planStorageOwner && !!plans[pathway._id];

            return (
              <article key={pathway._id} className="rounded-md border border-[var(--yr-line)] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap gap-1.5">
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
                          disabled={!planIsHydrated}
                          aria-busy={!planIsHydrated}
                          onWheel={(event) => event.currentTarget.blur()}
                          onChange={(event) =>
                            requestIntentChange(
                              pathway._id,
                              event.target.value as PlanningIntent,
                              event.currentTarget,
                            )
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
                          disabled={!planIsHydrated}
                          aria-busy={!planIsHydrated}
                          onWheel={(event) => event.currentTarget.blur()}
                          onChange={(event) => {
                            const stage = event.target.value as PlanningStage;
                            updatePlan(pathway._id, {
                              stage,
                              actedOnDate:
                                stage === 'acted' && !plan.actedOnDate
                                  ? localToday()
                                  : plan.actedOnDate,
                            });
                          }}
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

                    <fieldset className="rounded-md border border-[var(--yr-line)] p-3">
                      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Dates and follow-up
                      </legend>
                      <p className="mb-3 text-xs text-gray-500">
                        Dates use your local calendar and are saved without a time zone.
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <label className="text-xs font-semibold text-gray-600">
                          Target deadline
                          <input
                            type="date"
                            value={plan.targetDeadline || ''}
                            disabled={!planIsHydrated}
                            onChange={(event) =>
                              updatePlan(pathway._id, {
                                targetDeadline: normalizeDateOnly(event.target.value),
                              })
                            }
                            className="mt-1 block min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-2 text-sm font-normal text-gray-900 focus:ring-2 focus:ring-blue-500"
                          />
                          {plan.targetDeadline && (
                            <button
                              type="button"
                              disabled={!planIsHydrated}
                              onClick={() => updatePlan(pathway._id, { targetDeadline: null })}
                              className="mt-1 text-xs font-medium text-blue-700 underline underline-offset-2"
                            >
                              Clear deadline
                            </button>
                          )}
                        </label>
                        <label className="text-xs font-semibold text-gray-600">
                          Acted on
                          <input
                            type="date"
                            value={plan.actedOnDate || ''}
                            disabled={!planIsHydrated}
                            onChange={(event) =>
                              updatePlan(pathway._id, {
                                actedOnDate: normalizeDateOnly(event.target.value),
                              })
                            }
                            className="mt-1 block min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] px-2 text-sm font-normal text-gray-900 focus:ring-2 focus:ring-blue-500"
                          />
                          {plan.actedOnDate && (
                            <button
                              type="button"
                              disabled={!planIsHydrated}
                              onClick={() => updatePlan(pathway._id, { actedOnDate: null })}
                              className="mt-1 text-xs font-medium text-blue-700 underline underline-offset-2"
                            >
                              Clear acted date
                            </button>
                          )}
                        </label>
                        <label className="text-xs font-semibold text-gray-600">
                          Follow up after
                          <select
                            value={plan.followUpIntervalDays || ''}
                            disabled={!planIsHydrated}
                            onChange={(event) =>
                              updatePlan(pathway._id, {
                                followUpIntervalDays: event.target.value
                                  ? Number(event.target.value)
                                  : null,
                              })
                            }
                            className="mt-1 block min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] bg-white px-2 text-sm font-normal text-gray-900 focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">No reminder</option>
                            {FOLLOW_UP_INTERVALS.map((days) => (
                              <option key={days} value={days}>
                                {days} days
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </fieldset>

                    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Note
                      <textarea
                        value={plan.note}
                        disabled={!planIsHydrated}
                        aria-busy={!planIsHydrated}
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
                          Checklist for: {intentLabel(plan.intent)}
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
                              disabled={!planIsHydrated}
                              aria-busy={!planIsHydrated}
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
                      {plan.checklistHistory.length > 0 && (
                        <details className="mt-3 border-t border-[var(--yr-line)] pt-2 text-sm text-gray-600">
                          <summary className="cursor-pointer font-semibold">
                            Completed step history ({plan.checklistHistory.length})
                          </summary>
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            {plan.checklistHistory.map((item, index) => (
                              <li key={`${item.completedAt}-${index}`}>
                                {item.label} ({intentLabel(item.intent)})
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>

                    <p className="sr-only" role="status" aria-live="polite">
                      {planSaveStatus[pathway._id] ||
                        (!planIsHydrated ? 'Plan details are loading.' : '')}
                    </p>

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
