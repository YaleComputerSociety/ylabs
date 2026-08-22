import {
  MAX_RESEARCH_PLAN_CHECKLIST_ITEMS,
  MAX_RESEARCH_PLAN_DEADLINES,
  MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH,
  MAX_RESEARCH_PLAN_NOTES_LENGTH,
  researchPlanStages,
  type ResearchPlanStage,
} from '../models/researchPlan';

export const RESEARCH_ENTITY_TARGET_KIND = 'RESEARCH_ENTITY' as const;
const OBJECT_ID_HEX_PATTERN = /^[a-f0-9]{24}$/i;

const LEGACY_STAGE_TO_CANONICAL: Record<string, ResearchPlanStage> = {
  saved: 'SAVED',
  researching: 'EXPLORING',
  ready: 'PREPARING',
  acted: 'CONTACTED',
  archived: 'CLOSED',
};

const LOSSY_LEGACY_FIELDS = ['intent', 'checklistHistory', 'actedOnDate', 'followUpIntervalDays'];

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeEntityId = (value: unknown): string | null => {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return OBJECT_ID_HEX_PATTERN.test(id) ? id : null;
};

export interface BackfillUserInput {
  netid: string;
  accountId: string | null;
  savedResearchEntities: unknown[];
  savedResearchEntityPlans: Record<string, unknown>;
}

export interface MappedResearchPlanFields {
  stage: ResearchPlanStage;
  privateNotes: string;
  checklist: Array<{ label: string; completed: boolean; completedAt?: string }>;
  deadlines: Array<{ label: string; dueAt: string }>;
  exportPreferences: {
    includePrivateNotes: boolean;
    includeChecklist: boolean;
    includeDeadlines: boolean;
  };
}

export interface PlannedResearchPlanRow {
  netid: string;
  accountId: string;
  targetId: string;
  fields: MappedResearchPlanFields;
  droppedLegacyFields: string[];
}

export interface BackfillConflictReport {
  collisions: string[];
  orphanPlans: string[];
  unresolvedAccount?: boolean;
}

export interface ResearchPlanBackfillPlan {
  rows: PlannedResearchPlanRow[];
  conflictsByNetid: Record<string, BackfillConflictReport>;
  stats: {
    users: number;
    usersWithSaves: number;
    rowsPlanned: number;
    collisions: number;
    unresolvedAccounts: number;
    orphanPlans: number;
    usersWithDroppedLegacyFields: number;
  };
}

export const mapLegacyStage = (value: unknown): ResearchPlanStage => {
  if (typeof value === 'string' && LEGACY_STAGE_TO_CANONICAL[value]) {
    return LEGACY_STAGE_TO_CANONICAL[value];
  }
  if (typeof value === 'string' && (researchPlanStages as readonly string[]).includes(value)) {
    return value as ResearchPlanStage;
  }
  return 'SAVED';
};

const dateOnlyToIso = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
};

export const mapLegacyPlan = (
  legacyPlan: unknown,
  options: { observedAt: string },
): { fields: MappedResearchPlanFields; droppedLegacyFields: string[] } => {
  const plan = isPlainRecord(legacyPlan) ? legacyPlan : {};

  const privateNotes =
    typeof plan.note === 'string' ? plan.note.slice(0, MAX_RESEARCH_PLAN_NOTES_LENGTH) : '';

  const checklist: MappedResearchPlanFields['checklist'] = [];
  if (isPlainRecord(plan.checklist)) {
    for (const [label, done] of Object.entries(plan.checklist)) {
      if (checklist.length >= MAX_RESEARCH_PLAN_CHECKLIST_ITEMS) break;
      const trimmed = label.trim();
      if (!trimmed) continue;
      const completed = done === true;
      checklist.push({
        label: trimmed.slice(0, MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH),
        completed,
        ...(completed ? { completedAt: options.observedAt } : {}),
      });
    }
  }

  const deadlines: MappedResearchPlanFields['deadlines'] = [];
  const targetDeadline = dateOnlyToIso(plan.targetDeadline);
  if (targetDeadline && deadlines.length < MAX_RESEARCH_PLAN_DEADLINES) {
    deadlines.push({ label: 'Target deadline', dueAt: targetDeadline });
  }

  const droppedLegacyFields = LOSSY_LEGACY_FIELDS.filter((field) => {
    const value = plan[field];
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });

  return {
    fields: {
      stage: mapLegacyStage(plan.stage),
      privateNotes,
      checklist,
      deadlines,
      exportPreferences: {
        includePrivateNotes: false,
        includeChecklist: false,
        includeDeadlines: false,
      },
    },
    droppedLegacyFields,
  };
};

export const researchPlanBackfillKey = (accountId: string, targetId: string): string =>
  `${accountId.toLowerCase()}:${targetId.toLowerCase()}`;

export const planResearchPlanBackfill = (
  users: BackfillUserInput[],
  existingPlanKeys: Set<string>,
  options: { observedAt: string },
): ResearchPlanBackfillPlan => {
  const rows: PlannedResearchPlanRow[] = [];
  const conflictsByNetid: Record<string, BackfillConflictReport> = {};
  const stats = {
    users: users.length,
    usersWithSaves: 0,
    rowsPlanned: 0,
    collisions: 0,
    unresolvedAccounts: 0,
    orphanPlans: 0,
    usersWithDroppedLegacyFields: 0,
  };

  for (const user of users) {
    const savedIds = Array.isArray(user.savedResearchEntities)
      ? user.savedResearchEntities
          .map(normalizeEntityId)
          .filter((id): id is string => Boolean(id))
      : [];
    const dedupedSavedIds = Array.from(new Set(savedIds));
    const planMap = isPlainRecord(user.savedResearchEntityPlans)
      ? user.savedResearchEntityPlans
      : {};

    if (dedupedSavedIds.length === 0 && Object.keys(planMap).length === 0) {
      continue;
    }
    stats.usersWithSaves += 1;

    const report: BackfillConflictReport = { collisions: [], orphanPlans: [] };
    let userHadDroppedFields = false;

    if (!user.accountId) {
      report.unresolvedAccount = true;
      stats.unresolvedAccounts += 1;
      conflictsByNetid[user.netid] = report;
      continue;
    }

    const savedIdSet = new Set(dedupedSavedIds);
    for (const entityId of Object.keys(planMap)) {
      const normalized = normalizeEntityId(entityId);
      if (!normalized || !savedIdSet.has(normalized)) {
        report.orphanPlans.push(entityId);
        stats.orphanPlans += 1;
      }
    }

    for (const targetId of dedupedSavedIds) {
      const key = researchPlanBackfillKey(user.accountId, targetId);
      if (existingPlanKeys.has(key)) {
        report.collisions.push(targetId);
        stats.collisions += 1;
        continue;
      }
      const { fields, droppedLegacyFields } = mapLegacyPlan(planMap[targetId], options);
      if (droppedLegacyFields.length > 0) userHadDroppedFields = true;
      rows.push({
        netid: user.netid,
        accountId: user.accountId,
        targetId,
        fields,
        droppedLegacyFields,
      });
      existingPlanKeys.add(key);
      stats.rowsPlanned += 1;
    }

    if (userHadDroppedFields) stats.usersWithDroppedLegacyFields += 1;
    if (report.collisions.length > 0 || report.orphanPlans.length > 0) {
      conflictsByNetid[user.netid] = report;
    }
  }

  return { rows, conflictsByNetid, stats };
};
