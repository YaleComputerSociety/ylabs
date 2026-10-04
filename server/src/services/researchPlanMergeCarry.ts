import mongoose from 'mongoose';
import {
  ResearchPlan,
  MAX_RESEARCH_PLAN_CHECKLIST_ITEMS,
  MAX_RESEARCH_PLAN_DEADLINES,
  MAX_RESEARCH_PLAN_NOTES_LENGTH,
  researchPlanStages,
  type ResearchPlanStage,
} from '../models/researchPlan';

export const MERGED_RESEARCH_PLAN_NOTES_SEPARATOR =
  '\n\n---- Notes carried over from a merged duplicate listing ----\n\n';

const RESEARCH_ENTITY_TARGET_KIND = 'RESEARCH_ENTITY';
const DUPLICATE_KEY_ERROR = 11000;

type ObjectIdLike = mongoose.Types.ObjectId | string;

export interface StoredResearchPlanChecklistItem {
  _id?: unknown;
  label?: unknown;
  completed?: unknown;
  completedAt?: unknown;
}

export interface StoredResearchPlanDeadline {
  _id?: unknown;
  label?: unknown;
  dueAt?: unknown;
}

export interface StoredResearchPlanExportPreferences {
  includePrivateNotes?: unknown;
  includeChecklist?: unknown;
  includeDeadlines?: unknown;
}

export interface StoredResearchPlan {
  _id: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  target?: { kind?: string; id?: mongoose.Types.ObjectId };
  stage?: unknown;
  privateNotes?: unknown;
  checklist?: unknown;
  deadlines?: unknown;
  exportPreferences?: StoredResearchPlanExportPreferences;
  archived?: unknown;
  archivedReason?: unknown;
  restorableUntil?: unknown;
}

export interface CombinedResearchPlanFields {
  stage: ResearchPlanStage;
  privateNotes: string;
  checklist: StoredResearchPlanChecklistItem[];
  deadlines: StoredResearchPlanDeadline[];
  exportPreferences: {
    includePrivateNotes: boolean;
    includeChecklist: boolean;
    includeDeadlines: boolean;
  };
}

export type ResearchPlanCombineOverflow = 'privateNotes' | 'checklist' | 'deadlines';

export type ResearchPlanCombineResult =
  | { ok: true; fields: CombinedResearchPlanFields }
  | { ok: false; overflow: ResearchPlanCombineOverflow[] };

export type ResearchPlanCarryDecision =
  | { action: 'move'; duplicatePlan: StoredResearchPlan }
  | {
      action: 'replace-archived-survivor-plan';
      duplicatePlan: StoredResearchPlan;
      survivorPlan: StoredResearchPlan;
    }
  | {
      action: 'merge';
      duplicatePlan: StoredResearchPlan;
      survivorPlan: StoredResearchPlan;
      fields: CombinedResearchPlanFields;
    }
  | {
      action: 'hold-over-capacity';
      duplicatePlan: StoredResearchPlan;
      survivorPlan: StoredResearchPlan;
      overflow: ResearchPlanCombineOverflow[];
    }
  | {
      action: 'keep-student-archived-plan';
      duplicatePlan: StoredResearchPlan;
      survivorPlan: StoredResearchPlan;
    };

export interface ResearchPlanCarryReport {
  plansOnDuplicates: number;
  moved: number;
  merged: number;
  replacedArchivedSurvivorPlans: number;
  heldOverCapacity: number;
  keptStudentArchivedPlans: number;
  restoredSystemArchivedPlans: number;
}

export const emptyResearchPlanCarryReport = (): ResearchPlanCarryReport => ({
  plansOnDuplicates: 0,
  moved: 0,
  merged: 0,
  replacedArchivedSurvivorPlans: 0,
  heldOverCapacity: 0,
  keptStudentArchivedPlans: 0,
  restoredSystemArchivedPlans: 0,
});

export const addResearchPlanCarryReports = (
  left: ResearchPlanCarryReport,
  right: ResearchPlanCarryReport,
): ResearchPlanCarryReport => ({
  plansOnDuplicates: left.plansOnDuplicates + right.plansOnDuplicates,
  moved: left.moved + right.moved,
  merged: left.merged + right.merged,
  replacedArchivedSurvivorPlans:
    left.replacedArchivedSurvivorPlans + right.replacedArchivedSurvivorPlans,
  heldOverCapacity: left.heldOverCapacity + right.heldOverCapacity,
  keptStudentArchivedPlans: left.keptStudentArchivedPlans + right.keptStudentArchivedPlans,
  restoredSystemArchivedPlans: left.restoredSystemArchivedPlans + right.restoredSystemArchivedPlans,
});

export const researchPlansThatWouldMove = (report: ResearchPlanCarryReport): number =>
  report.moved + report.merged + report.replacedArchivedSurvivorPlans;

const isSystemArchived = (plan: StoredResearchPlan): boolean =>
  plan.archived === true &&
  typeof plan.archivedReason === 'string' &&
  plan.archivedReason.trim() !== '';

const isStudentArchived = (plan: StoredResearchPlan): boolean =>
  plan.archived === true && !isSystemArchived(plan);

const stageRank = (stage: unknown): number => {
  const rank = researchPlanStages.indexOf(stage as ResearchPlanStage);
  return rank < 0 ? 0 : rank;
};

export const moreAdvancedResearchPlanStage = (left: unknown, right: unknown): ResearchPlanStage =>
  researchPlanStages[Math.max(stageRank(left), stageRank(right))];

const notesText = (value: unknown): string => (typeof value === 'string' ? value : '');

export const combineResearchPlanNotes = (
  survivorNotes: unknown,
  duplicateNotes: unknown,
): string => {
  const survivor = notesText(survivorNotes);
  const duplicate = notesText(duplicateNotes);
  if (!duplicate.trim() || duplicate.trim() === survivor.trim()) return survivor;
  if (!survivor.trim()) return duplicate;
  return `${survivor}${MERGED_RESEARCH_PLAN_NOTES_SEPARATOR}${duplicate}`;
};

const itemKey = (label: unknown): string =>
  typeof label === 'string' ? label.trim().replace(/\s+/g, ' ').toLowerCase() : '';

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const timeOf = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return Number.NaN;
  return new Date(value as string | number | Date).getTime();
};

const completedChecklistItem = (
  left: StoredResearchPlanChecklistItem,
  right: StoredResearchPlanChecklistItem,
): StoredResearchPlanChecklistItem => {
  const completed = [left, right].filter((item) => item.completed === true);
  if (completed.length === 0) return left;
  if (completed.length === 1) return completed[0];
  return timeOf(completed[1].completedAt) < timeOf(completed[0].completedAt)
    ? completed[1]
    : completed[0];
};

export const unionResearchPlanChecklists = (
  survivorChecklist: unknown,
  duplicateChecklist: unknown,
): StoredResearchPlanChecklistItem[] => {
  const byKey = new Map<string, StoredResearchPlanChecklistItem>();
  const order: string[] = [];
  for (const item of [
    ...asArray<StoredResearchPlanChecklistItem>(survivorChecklist),
    ...asArray<StoredResearchPlanChecklistItem>(duplicateChecklist),
  ]) {
    const key = itemKey(item?.label);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) order.push(key);
    byKey.set(key, existing ? completedChecklistItem(existing, item) : item);
  }
  return order.map((key) => byKey.get(key)!);
};

const preferredDeadline = (
  left: StoredResearchPlanDeadline,
  right: StoredResearchPlanDeadline,
  now: Date,
): StoredResearchPlanDeadline => {
  const nowTime = now.getTime();
  const leftTime = timeOf(left.dueAt);
  const rightTime = timeOf(right.dueAt);
  const leftOpen = leftTime >= nowTime;
  const rightOpen = rightTime >= nowTime;
  if (leftOpen && rightOpen) return rightTime < leftTime ? right : left;
  if (leftOpen) return left;
  if (rightOpen) return right;
  return rightTime > leftTime ? right : left;
};

export const unionResearchPlanDeadlines = (
  survivorDeadlines: unknown,
  duplicateDeadlines: unknown,
  now: Date,
): StoredResearchPlanDeadline[] => {
  const byKey = new Map<string, StoredResearchPlanDeadline>();
  const order: string[] = [];
  for (const deadline of [
    ...asArray<StoredResearchPlanDeadline>(survivorDeadlines),
    ...asArray<StoredResearchPlanDeadline>(duplicateDeadlines),
  ]) {
    const key = itemKey(deadline?.label);
    if (!key || Number.isNaN(timeOf(deadline.dueAt))) continue;
    const existing = byKey.get(key);
    if (!existing) order.push(key);
    byKey.set(key, existing ? preferredDeadline(existing, deadline, now) : deadline);
  }
  return order.map((key) => byKey.get(key)!);
};

const bothOptedIn = (
  left: StoredResearchPlanExportPreferences | undefined,
  right: StoredResearchPlanExportPreferences | undefined,
  field: keyof StoredResearchPlanExportPreferences,
): boolean => left?.[field] === true && right?.[field] === true;

export const combineResearchPlans = (
  survivorPlan: StoredResearchPlan,
  duplicatePlan: StoredResearchPlan,
  now: Date,
): ResearchPlanCombineResult => {
  const fields: CombinedResearchPlanFields = {
    stage: moreAdvancedResearchPlanStage(survivorPlan.stage, duplicatePlan.stage),
    privateNotes: combineResearchPlanNotes(survivorPlan.privateNotes, duplicatePlan.privateNotes),
    checklist: unionResearchPlanChecklists(survivorPlan.checklist, duplicatePlan.checklist),
    deadlines: unionResearchPlanDeadlines(survivorPlan.deadlines, duplicatePlan.deadlines, now),
    exportPreferences: {
      includePrivateNotes: bothOptedIn(
        survivorPlan.exportPreferences,
        duplicatePlan.exportPreferences,
        'includePrivateNotes',
      ),
      includeChecklist: bothOptedIn(
        survivorPlan.exportPreferences,
        duplicatePlan.exportPreferences,
        'includeChecklist',
      ),
      includeDeadlines: bothOptedIn(
        survivorPlan.exportPreferences,
        duplicatePlan.exportPreferences,
        'includeDeadlines',
      ),
    },
  };
  const overflow: ResearchPlanCombineOverflow[] = [];
  if (fields.privateNotes.length > MAX_RESEARCH_PLAN_NOTES_LENGTH) overflow.push('privateNotes');
  if (fields.checklist.length > MAX_RESEARCH_PLAN_CHECKLIST_ITEMS) overflow.push('checklist');
  if (fields.deadlines.length > MAX_RESEARCH_PLAN_DEADLINES) overflow.push('deadlines');
  return overflow.length > 0 ? { ok: false, overflow } : { ok: true, fields };
};

export const decideResearchPlanCarry = (
  duplicatePlan: StoredResearchPlan,
  survivorPlan: StoredResearchPlan | undefined,
  now: Date,
): ResearchPlanCarryDecision => {
  if (!survivorPlan) return { action: 'move', duplicatePlan };
  if (isStudentArchived(duplicatePlan)) {
    return { action: 'keep-student-archived-plan', duplicatePlan, survivorPlan };
  }
  if (isStudentArchived(survivorPlan)) {
    return { action: 'replace-archived-survivor-plan', duplicatePlan, survivorPlan };
  }
  const combined = combineResearchPlans(survivorPlan, duplicatePlan, now);
  if (!combined.ok) {
    return {
      action: 'hold-over-capacity',
      duplicatePlan,
      survivorPlan,
      overflow: combined.overflow,
    };
  }
  return { action: 'merge', duplicatePlan, survivorPlan, fields: combined.fields };
};

const toObjectId = (value: ObjectIdLike): mongoose.Types.ObjectId | null => {
  const text = String(value);
  return mongoose.Types.ObjectId.isValid(text) ? new mongoose.Types.ObjectId(text) : null;
};

const PLAN_PROJECTION = {
  _id: 1,
  accountId: 1,
  target: 1,
  stage: 1,
  privateNotes: 1,
  checklist: 1,
  deadlines: 1,
  exportPreferences: 1,
  archived: 1,
  archivedReason: 1,
  restorableUntil: 1,
} as const;

const loadEntityPlans = async (
  targetIds: mongoose.Types.ObjectId[],
): Promise<StoredResearchPlan[]> =>
  (await ResearchPlan.collection
    .find(
      { 'target.kind': RESEARCH_ENTITY_TARGET_KIND, 'target.id': { $in: targetIds } },
      { projection: PLAN_PROJECTION },
    )
    .sort({ _id: 1 })
    .toArray()) as unknown as StoredResearchPlan[];

const loadAccountEntityPlans = async (
  accountId: mongoose.Types.ObjectId,
  targetId: mongoose.Types.ObjectId,
): Promise<StoredResearchPlan[]> =>
  (await ResearchPlan.collection
    .find(
      { accountId, 'target.kind': RESEARCH_ENTITY_TARGET_KIND, 'target.id': targetId },
      { projection: PLAN_PROJECTION },
    )
    .toArray()) as unknown as StoredResearchPlan[];

const accountKey = (plan: StoredResearchPlan): string => String(plan.accountId);

const RESTORED_PLAN_UNSET = { archivedReason: '', archivedAt: '', restorableUntil: '' } as const;

const RESTORED_PLAN_STATE = {
  archived: false,
  archivedReason: undefined,
  restorableUntil: undefined,
} as const;

const carryOntoSurvivorUpdate = (
  plan: StoredResearchPlan,
  survivorId: mongoose.Types.ObjectId,
  now: Date,
) =>
  isStudentArchived(plan)
    ? { $set: { 'target.id': survivorId, updatedAt: now } }
    : {
        $set: { 'target.id': survivorId, archived: false, updatedAt: now },
        $unset: RESTORED_PLAN_UNSET,
      };

const applyResearchPlanCarryDecision = async (
  decision: ResearchPlanCarryDecision,
  survivorId: mongoose.Types.ObjectId,
  now: Date,
): Promise<void> => {
  const collection = ResearchPlan.collection;
  if (decision.action === 'move') {
    await collection.updateOne(
      { _id: decision.duplicatePlan._id },
      carryOntoSurvivorUpdate(decision.duplicatePlan, survivorId, now),
    );
    return;
  }
  if (decision.action === 'replace-archived-survivor-plan') {
    await collection.deleteOne({ _id: decision.survivorPlan._id, archived: true });
    await collection.updateOne(
      { _id: decision.duplicatePlan._id },
      carryOntoSurvivorUpdate(decision.duplicatePlan, survivorId, now),
    );
    return;
  }
  if (decision.action === 'merge') {
    await collection.updateOne(
      { _id: decision.survivorPlan._id },
      {
        $set: { ...decision.fields, archived: false, updatedAt: now },
        $unset: RESTORED_PLAN_UNSET,
      },
    );
    await collection.deleteOne({ _id: decision.duplicatePlan._id });
  }
};

const restoresSystemArchivedPlan = (decision: ResearchPlanCarryDecision): boolean => {
  if (decision.action === 'move' || decision.action === 'replace-archived-survivor-plan') {
    return isSystemArchived(decision.duplicatePlan);
  }
  if (decision.action === 'merge') {
    return isSystemArchived(decision.duplicatePlan) || isSystemArchived(decision.survivorPlan);
  }
  return false;
};

const countDecision = (report: ResearchPlanCarryReport, decision: ResearchPlanCarryDecision) => {
  if (restoresSystemArchivedPlan(decision)) report.restoredSystemArchivedPlans += 1;
  if (decision.action === 'move') report.moved += 1;
  else if (decision.action === 'merge') report.merged += 1;
  else if (decision.action === 'replace-archived-survivor-plan')
    report.replacedArchivedSurvivorPlans += 1;
  else if (decision.action === 'hold-over-capacity') report.heldOverCapacity += 1;
  else report.keptStudentArchivedPlans += 1;
};

const liveFirst = (left: StoredResearchPlan, right: StoredResearchPlan): number =>
  Number(isStudentArchived(left)) - Number(isStudentArchived(right));

export async function carryResearchPlansToSurvivor(input: {
  survivorId: ObjectIdLike;
  duplicateIds: ObjectIdLike[];
  apply: boolean;
  now?: Date;
}): Promise<ResearchPlanCarryReport> {
  const report = emptyResearchPlanCarryReport();
  const survivorId = toObjectId(input.survivorId);
  if (!survivorId) return report;
  const duplicateIds = input.duplicateIds
    .map(toObjectId)
    .filter((id): id is mongoose.Types.ObjectId => id !== null && !id.equals(survivorId));
  if (duplicateIds.length === 0) return report;
  const now = input.now ?? new Date();

  const duplicatePlans = (await loadEntityPlans(duplicateIds)).sort(liveFirst);
  report.plansOnDuplicates = duplicatePlans.length;
  if (duplicatePlans.length === 0) return report;

  const survivorPlanByAccount = new Map(
    (await loadEntityPlans([survivorId])).map((plan) => [accountKey(plan), plan]),
  );

  for (const duplicatePlan of duplicatePlans) {
    const decide = () =>
      decideResearchPlanCarry(
        duplicatePlan,
        survivorPlanByAccount.get(accountKey(duplicatePlan)),
        now,
      );
    let decision = decide();
    if (input.apply) {
      try {
        await applyResearchPlanCarryDecision(decision, survivorId, now);
      } catch (error: any) {
        if (error?.code !== DUPLICATE_KEY_ERROR) throw error;
        const [concurrentSurvivorPlan] = await loadAccountEntityPlans(
          duplicatePlan.accountId,
          survivorId,
        );
        if (concurrentSurvivorPlan) {
          survivorPlanByAccount.set(accountKey(duplicatePlan), concurrentSurvivorPlan);
        }
        decision = decide();
        await applyResearchPlanCarryDecision(decision, survivorId, now);
      }
    }
    countDecision(report, decision);
    projectDecisionOntoSurvivor(survivorPlanByAccount, decision, survivorId);
  }
  return report;
}

const projectDecisionOntoSurvivor = (
  survivorPlanByAccount: Map<string, StoredResearchPlan>,
  decision: ResearchPlanCarryDecision,
  survivorId: mongoose.Types.ObjectId,
) => {
  const key = accountKey(decision.duplicatePlan);
  if (decision.action === 'move' || decision.action === 'replace-archived-survivor-plan') {
    survivorPlanByAccount.set(key, {
      ...decision.duplicatePlan,
      ...(isStudentArchived(decision.duplicatePlan) ? {} : RESTORED_PLAN_STATE),
      target: { kind: RESEARCH_ENTITY_TARGET_KIND, id: survivorId },
    });
  } else if (decision.action === 'merge') {
    survivorPlanByAccount.set(key, {
      ...decision.survivorPlan,
      ...decision.fields,
      ...RESTORED_PLAN_STATE,
    });
  }
};
