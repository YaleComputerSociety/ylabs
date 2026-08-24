import mongoose from 'mongoose';
import { ResearchEntity, ResearchPlan } from '../models/index';
import { readPrograms } from './programService';
import {
  MAX_RESEARCH_PLAN_CHECKLIST_ITEMS,
  MAX_RESEARCH_PLAN_DEADLINES,
  MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH,
  MAX_RESEARCH_PLAN_NOTES_LENGTH,
  researchPlanStages,
  type ResearchPlanStage,
} from '../models/researchPlan';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { researchEntityServesPublicDetail } from './researchEntityPublicDescription';
import { sanitizeServedResearchEntityCopyFields } from '../utils/researchEntityDescriptionText';
import { NotFoundError } from '../utils/errors';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { safeSpreadsheetCell } from '../utils/spreadsheetSafety';
import { resolveAccountIdByNetid } from './accountService';

const RESEARCH_ENTITY_TARGET_KIND = 'RESEARCH_ENTITY' as const;
const PROGRAM_TARGET_KIND = 'PROGRAM' as const;
const MAX_ACCOUNT_MUTATION_IDS = 100;
export const MAX_SAVED_RESEARCH_ENTITY_SHORT_DESCRIPTION_LENGTH = 300;
const OBJECT_ID_HEX_PATTERN = /^[a-f0-9]{24}$/i;
const RESEARCH_ENTITY_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,159}$/i;
const researchPlanStageSet = new Set<ResearchPlanStage>(researchPlanStages);

const badRequestError = (message: string) => {
  const error: any = new Error(message);
  error.status = 400;
  return error;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeObjectIdString = (value: unknown, fieldName: string): string => {
  const id =
    typeof value === 'string'
      ? value.trim()
      : value instanceof mongoose.Types.ObjectId
        ? value.toHexString()
        : '';
  if (!OBJECT_ID_HEX_PATTERN.test(id)) {
    throw badRequestError(`Invalid ${fieldName} id`);
  }
  return id.toLowerCase();
};

export interface SavedResearchEntitySummary {
  _id: string;
  slug: string;
  name: string;
  displayName?: string;
  kind: string;
  entityType?: string;
  departments: string[];
  school?: string;
  shortDescription?: string;
  description?: string;
  undergraduateCurrentAvailability?: string;
  accessAcceptanceLevel?: string;
  hasUndergradHostingEvidence?: boolean;
}

export interface ResearchPlanChecklistItem {
  label: string;
  completed: boolean;
  completedAt?: string;
}

export interface ResearchPlanDeadline {
  label: string;
  dueAt: string;
}

export interface ResearchPlanExportPreferences {
  includePrivateNotes: boolean;
  includeChecklist: boolean;
  includeDeadlines: boolean;
}

export interface ResearchPlanView {
  stage: ResearchPlanStage;
  privateNotes: string;
  checklist: ResearchPlanChecklistItem[];
  deadlines: ResearchPlanDeadline[];
  exportPreferences: ResearchPlanExportPreferences;
  updatedAt?: string;
}

export interface ResearchPlanInput {
  stage?: unknown;
  privateNotes?: unknown;
  note?: unknown;
  checklist?: unknown;
  deadlines?: unknown;
  exportPreferences?: unknown;
}

export interface SavedResearchEntitiesExportOptions {
  includePrivateNotes?: boolean;
  exportedAt?: Date;
}

export const boundSavedResearchEntitySummaryText = (
  value: unknown,
  maxLength: number,
): string | undefined => {
  if (typeof value !== 'string' || !value) return undefined;
  return value.slice(0, maxLength);
};

const savedResearchEntityProjection =
  '_id slug name displayName kind entityType departments school shortDescription fullDescription profileSynthesisDescription sourceUrls website websiteUrl undergraduateCurrentAvailability accessAcceptanceLevel hasUndergradHostingEvidence';

const exportTextWithoutDirectContact = (value: unknown): string =>
  safeSpreadsheetCell(redactDirectContactInfo(String(value || '')));

const exportUserTextForSpreadsheet = (value: unknown): string =>
  safeSpreadsheetCell(String(value || ''));

const asBoolean = (value: unknown): boolean => value === true;

const normalizeChecklistItem = (value: unknown, now: Date): ResearchPlanChecklistItem | null => {
  if (!isPlainRecord(value)) return null;
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  if (!label) return null;
  const completed = asBoolean(value.completed);
  const boundedLabel = label.slice(0, MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH);
  if (!completed) return { label: boundedLabel, completed: false };
  const parsed =
    typeof value.completedAt === 'string' && !Number.isNaN(Date.parse(value.completedAt))
      ? new Date(value.completedAt)
      : now;
  return { label: boundedLabel, completed: true, completedAt: parsed.toISOString() };
};

const normalizeChecklistInput = (value: unknown, now: Date): ResearchPlanChecklistItem[] => {
  const items: ResearchPlanChecklistItem[] = [];
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (items.length >= MAX_RESEARCH_PLAN_CHECKLIST_ITEMS) break;
      const item = normalizeChecklistItem(raw, now);
      if (item) items.push(item);
    }
  }
  return items;
};

const normalizeDeadlineInput = (value: unknown): ResearchPlanDeadline[] => {
  const deadlines: ResearchPlanDeadline[] = [];
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (deadlines.length >= MAX_RESEARCH_PLAN_DEADLINES) break;
      if (!isPlainRecord(raw)) continue;
      const label = typeof raw.label === 'string' ? raw.label.trim() : '';
      const due =
        typeof raw.dueAt === 'string' && !Number.isNaN(Date.parse(raw.dueAt))
          ? new Date(raw.dueAt)
          : null;
      if (!label || !due) continue;
      deadlines.push({
        label: label.slice(0, MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH),
        dueAt: due.toISOString(),
      });
    }
  }
  return deadlines;
};

const normalizeExportPreferences = (value: unknown): ResearchPlanExportPreferences => {
  const record = isPlainRecord(value) ? value : {};
  return {
    includePrivateNotes: asBoolean(record.includePrivateNotes),
    includeChecklist: asBoolean(record.includeChecklist),
    includeDeadlines: asBoolean(record.includeDeadlines),
  };
};

const coerceStoredDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const serializeStoredChecklistItem = (value: unknown): ResearchPlanChecklistItem | null => {
  if (!isPlainRecord(value)) return null;
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  if (!label) return null;
  const boundedLabel = label.slice(0, MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH);
  if (!asBoolean(value.completed)) return { label: boundedLabel, completed: false };
  const completedAt = coerceStoredDate(value.completedAt);
  if (!completedAt) return { label: boundedLabel, completed: true };
  return { label: boundedLabel, completed: true, completedAt: completedAt.toISOString() };
};

const serializeStoredChecklist = (value: unknown): ResearchPlanChecklistItem[] => {
  const items: ResearchPlanChecklistItem[] = [];
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (items.length >= MAX_RESEARCH_PLAN_CHECKLIST_ITEMS) break;
      const item = serializeStoredChecklistItem(raw);
      if (item) items.push(item);
    }
  }
  return items;
};

const serializeStoredDeadlines = (value: unknown): ResearchPlanDeadline[] => {
  const deadlines: ResearchPlanDeadline[] = [];
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (deadlines.length >= MAX_RESEARCH_PLAN_DEADLINES) break;
      if (!isPlainRecord(raw)) continue;
      const label = typeof raw.label === 'string' ? raw.label.trim() : '';
      const due = coerceStoredDate(raw.dueAt);
      if (!label || !due) continue;
      deadlines.push({
        label: label.slice(0, MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH),
        dueAt: due.toISOString(),
      });
    }
  }
  return deadlines;
};

const emptyResearchPlanView = (): ResearchPlanView => ({
  stage: 'SAVED',
  privateNotes: '',
  checklist: [],
  deadlines: [],
  exportPreferences: {
    includePrivateNotes: false,
    includeChecklist: false,
    includeDeadlines: false,
  },
});

const clearedResearchPlanFields = (): Record<string, unknown> => ({
  stage: 'SAVED',
  privateNotes: '',
  checklist: [],
  deadlines: [],
  exportPreferences: {
    includePrivateNotes: false,
    includeChecklist: false,
    includeDeadlines: false,
  },
});

export const researchPlanViewFromDoc = (doc: Record<string, unknown>): ResearchPlanView => {
  const stage =
    typeof doc.stage === 'string' && researchPlanStageSet.has(doc.stage as ResearchPlanStage)
      ? (doc.stage as ResearchPlanStage)
      : 'SAVED';
  return {
    stage,
    privateNotes:
      typeof doc.privateNotes === 'string'
        ? doc.privateNotes.slice(0, MAX_RESEARCH_PLAN_NOTES_LENGTH)
        : '',
    checklist: serializeStoredChecklist(doc.checklist),
    deadlines: serializeStoredDeadlines(doc.deadlines),
    exportPreferences: normalizeExportPreferences(doc.exportPreferences),
    updatedAt: doc.updatedAt ? new Date(String(doc.updatedAt)).toISOString() : undefined,
  };
};

export const normalizeResearchPlanUpdate = (plan: ResearchPlanInput): Record<string, unknown> => {
  const input = isPlainRecord(plan) ? plan : {};
  const now = new Date();
  const update: Record<string, unknown> = {};

  if (
    typeof input.stage === 'string' &&
    researchPlanStageSet.has(input.stage as ResearchPlanStage)
  ) {
    update.stage = input.stage;
  }

  const noteSource = input.privateNotes ?? input.note;
  if (typeof noteSource === 'string') {
    update.privateNotes = noteSource.slice(0, MAX_RESEARCH_PLAN_NOTES_LENGTH);
  }

  if (input.checklist !== undefined) {
    update.checklist = normalizeChecklistInput(input.checklist, now);
  }

  if (input.deadlines !== undefined) {
    update.deadlines = normalizeDeadlineInput(input.deadlines);
  }

  if (input.exportPreferences !== undefined) {
    update.exportPreferences = normalizeExportPreferences(input.exportPreferences);
  }

  return update;
};

const SERVED_UNDERGRADUATE_AVAILABILITY_VALUES: ReadonlySet<string> = new Set([
  'OPEN',
  'ROLLING',
  'NOT_CURRENTLY_AVAILABLE',
]);

const SERVED_ACCESS_ACCEPTANCE_LEVELS: ReadonlySet<string> = new Set(['verified', 'likely']);

const servedUndergraduateAccessFields = (
  entity: any,
): Pick<
  SavedResearchEntitySummary,
  'undergraduateCurrentAvailability' | 'accessAcceptanceLevel' | 'hasUndergradHostingEvidence'
> => {
  const fields: Pick<
    SavedResearchEntitySummary,
    'undergraduateCurrentAvailability' | 'accessAcceptanceLevel' | 'hasUndergradHostingEvidence'
  > = {};
  const availability = String(entity.undergraduateCurrentAvailability || '');
  if (SERVED_UNDERGRADUATE_AVAILABILITY_VALUES.has(availability)) {
    fields.undergraduateCurrentAvailability = availability;
  }
  const acceptance = String(entity.accessAcceptanceLevel || '');
  if (SERVED_ACCESS_ACCEPTANCE_LEVELS.has(acceptance)) {
    fields.accessAcceptanceLevel = acceptance;
  }
  if (entity.hasUndergradHostingEvidence === true) {
    fields.hasUndergradHostingEvidence = true;
  }
  return fields;
};

const visibleSavedResearchEntities = async (
  ids: Array<string | mongoose.Types.ObjectId>,
): Promise<SavedResearchEntitySummary[]> => {
  if (!ids.length) return [];
  const objectIds = ids.map(
    (id) => new mongoose.Types.ObjectId(normalizeObjectIdString(id, 'savedResearchEntities')),
  );
  const entities = await ResearchEntity.find({
    _id: { $in: objectIds },
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  })
    .select(savedResearchEntityProjection)
    .lean();
  return entities.filter(researchEntityServesPublicDetail).flatMap((entity: any) => {
    const served = sanitizeServedResearchEntityCopyFields(entity);
    const shortDescription = boundSavedResearchEntitySummaryText(
      served.shortDescription,
      MAX_SAVED_RESEARCH_ENTITY_SHORT_DESCRIPTION_LENGTH,
    );
    return [
      {
        _id: String(entity._id),
        slug: String(entity.slug || ''),
        name: String(served.name || served.displayName || 'Research profile'),
        ...(served.displayName ? { displayName: String(served.displayName) } : {}),
        kind: String(entity.kind || 'group'),
        ...(entity.entityType ? { entityType: String(entity.entityType) } : {}),
        departments: Array.isArray(entity.departments)
          ? entity.departments.slice(0, 20).map(String)
          : [],
        ...(entity.school ? { school: String(entity.school) } : {}),
        ...(shortDescription ? { shortDescription } : {}),
        ...servedUndergraduateAccessFields(entity),
      },
    ];
  });
};

export const resolveSavedResearchEntityObjectIds = async (
  values: unknown[],
): Promise<mongoose.Types.ObjectId[]> => {
  if (!Array.isArray(values)) {
    throw badRequestError('Invalid savedResearchEntities ids');
  }
  if (values.length > MAX_ACCOUNT_MUTATION_IDS) {
    throw badRequestError('Too many savedResearchEntities ids');
  }

  const objectIds: mongoose.Types.ObjectId[] = [];
  const slugs: string[] = [];
  for (const value of values) {
    if (value instanceof mongoose.Types.ObjectId) {
      objectIds.push(value);
      continue;
    }
    const text = typeof value === 'string' ? value.trim() : '';
    if (OBJECT_ID_HEX_PATTERN.test(text)) {
      objectIds.push(new mongoose.Types.ObjectId(text.toLowerCase()));
    } else if (RESEARCH_ENTITY_SLUG_PATTERN.test(text)) {
      slugs.push(text);
    } else {
      throw badRequestError('Invalid savedResearchEntities id');
    }
  }

  if (slugs.length) {
    const entities = await ResearchEntity.find({
      slug: { $in: slugs },
      archived: { $ne: true },
      studentVisibilityTier: { $in: publicStudentVisibilityTiers },
    })
      .select('_id')
      .lean();
    for (const entity of entities as Array<{ _id: mongoose.Types.ObjectId }>) {
      objectIds.push(new mongoose.Types.ObjectId(entity._id));
    }
  }

  const seen = new Set<string>();
  const deduped: mongoose.Types.ObjectId[] = [];
  for (const objectId of objectIds) {
    const key = objectId.toHexString().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(objectId);
  }
  return deduped;
};

const resolveSavedResearchEntityTargetId = async (
  entityId: string,
): Promise<mongoose.Types.ObjectId> => {
  const [targetId] = await resolveSavedResearchEntityObjectIds([entityId]);
  if (!targetId) {
    throw new NotFoundError('Saved research entity not found');
  }
  return targetId;
};

interface LoadedPlans {
  accountId: mongoose.Types.ObjectId;
  entities: SavedResearchEntitySummary[];
  plansByEntityId: Map<string, Record<string, unknown>>;
}

const loadVisibleAccountPlans = async (
  netid: any,
  { withDetail }: { withDetail: boolean },
): Promise<LoadedPlans> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const query = ResearchPlan.find({
    accountId,
    'target.kind': RESEARCH_ENTITY_TARGET_KIND,
    archived: { $ne: true },
  }).sort({ updatedAt: -1 });
  if (withDetail) query.select('+privateNotes +checklist +deadlines');
  const plans = await query.lean();

  const planByEntity = new Map<string, Record<string, unknown>>();
  for (const plan of plans as Array<Record<string, any>>) {
    const entityId = String(plan.target?.id ?? '').toLowerCase();
    if (entityId && !planByEntity.has(entityId)) {
      planByEntity.set(entityId, plan);
    }
  }

  const orderedIds = Array.from(planByEntity.keys());
  const visible = await visibleSavedResearchEntities(orderedIds);
  const visibleById = new Map(visible.map((entity) => [entity._id.toLowerCase(), entity]));
  const orderedVisible = orderedIds
    .map((id) => visibleById.get(id))
    .filter((entity): entity is SavedResearchEntitySummary => Boolean(entity));

  const plansByEntityId = new Map<string, Record<string, unknown>>();
  for (const entity of orderedVisible) {
    const plan = planByEntity.get(entity._id.toLowerCase());
    if (plan) plansByEntityId.set(entity._id, plan);
  }

  return { accountId, entities: orderedVisible, plansByEntityId };
};

export const getSavedResearchEntities = async (
  netid: any,
): Promise<SavedResearchEntitySummary[]> => {
  const { entities } = await loadVisibleAccountPlans(netid, { withDetail: false });
  return entities;
};

export const getSavedResearchEntityIds = async (netid: any): Promise<string[]> => {
  const { entities } = await loadVisibleAccountPlans(netid, { withDetail: false });
  return entities.map((entity) => entity._id);
};

export const getSavedResearchEntitySlugs = async (netid: any): Promise<string[]> => {
  const { entities } = await loadVisibleAccountPlans(netid, { withDetail: false });
  return entities.flatMap((entity) => (entity.slug ? [entity.slug] : []));
};

export const getSavedResearchEntityPlans = async (
  netid: any,
): Promise<Record<string, ResearchPlanView>> => {
  const { plansByEntityId } = await loadVisibleAccountPlans(netid, { withDetail: true });
  const result: Record<string, ResearchPlanView> = {};
  for (const [entityId, plan] of plansByEntityId) {
    result[entityId] = researchPlanViewFromDoc(plan);
  }
  return result;
};

export const addSavedResearchEntities = async (
  netid: any,
  values: unknown[],
): Promise<string[]> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const ids = await resolveSavedResearchEntityObjectIds(values);
  const visible = await visibleSavedResearchEntities(ids);
  for (const entity of visible) {
    const targetId = new mongoose.Types.ObjectId(entity._id);
    await ResearchPlan.updateOne(
      { accountId, 'target.kind': RESEARCH_ENTITY_TARGET_KIND, 'target.id': targetId },
      {
        $set: { archived: false },
        $setOnInsert: {
          accountId,
          target: { kind: RESEARCH_ENTITY_TARGET_KIND, id: targetId },
          stage: 'SAVED',
        },
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  }
  return getSavedResearchEntitySlugs(netid);
};

export const removeSavedResearchEntities = async (
  netid: any,
  values: unknown[],
): Promise<string[]> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const ids = await resolveSavedResearchEntityObjectIds(values);
  if (ids.length) {
    await ResearchPlan.updateMany(
      {
        accountId,
        'target.kind': RESEARCH_ENTITY_TARGET_KIND,
        'target.id': { $in: ids },
      },
      { $set: { archived: true, ...clearedResearchPlanFields() } },
      { runValidators: true },
    );
  }
  return getSavedResearchEntitySlugs(netid);
};

export const updateSavedResearchEntityPlan = async (
  netid: any,
  entityId: string,
  plan: ResearchPlanInput,
): Promise<Record<string, ResearchPlanView>> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const targetId = await resolveSavedResearchEntityTargetId(entityId);
  const update = normalizeResearchPlanUpdate(plan);
  const filter = {
    accountId,
    'target.kind': RESEARCH_ENTITY_TARGET_KIND,
    'target.id': targetId,
    archived: { $ne: true },
  };
  if (Object.keys(update).length === 0) {
    const existing = await ResearchPlan.exists(filter);
    if (!existing) {
      throw new NotFoundError('Saved research entity not found');
    }
    return getSavedResearchEntityPlans(netid);
  }
  const result = await ResearchPlan.updateOne(filter, { $set: update }, { runValidators: true });
  if (!result.matchedCount) {
    throw new NotFoundError('Saved research entity not found');
  }
  return getSavedResearchEntityPlans(netid);
};

export const deleteSavedResearchEntityPlan = async (
  netid: any,
  entityId: string,
): Promise<Record<string, ResearchPlanView>> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const targetId = await resolveSavedResearchEntityTargetId(entityId);
  await ResearchPlan.updateOne(
    {
      accountId,
      'target.kind': RESEARCH_ENTITY_TARGET_KIND,
      'target.id': targetId,
      archived: { $ne: true },
    },
    { $set: clearedResearchPlanFields() },
    { runValidators: true },
  );
  return getSavedResearchEntityPlans(netid);
};

const resolveWatchedProgramObjectIds = async (
  values: unknown[],
): Promise<mongoose.Types.ObjectId[]> => {
  if (!Array.isArray(values)) {
    throw badRequestError('Invalid watchedPrograms ids');
  }
  if (values.length > MAX_ACCOUNT_MUTATION_IDS) {
    throw badRequestError('Too many watchedPrograms ids');
  }
  const seen = new Set<string>();
  const deduped: mongoose.Types.ObjectId[] = [];
  for (const value of values) {
    const id = normalizeObjectIdString(value, 'watchedPrograms');
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(new mongoose.Types.ObjectId(id));
  }
  return deduped;
};

interface LoadedWatchedPrograms {
  accountId: mongoose.Types.ObjectId;
  programs: Record<string, any>[];
  plansByProgramId: Map<string, Record<string, unknown>>;
}

const loadVisibleWatchedPrograms = async (
  netid: any,
  { withDetail }: { withDetail: boolean },
): Promise<LoadedWatchedPrograms> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const query = ResearchPlan.find({
    accountId,
    'target.kind': PROGRAM_TARGET_KIND,
    archived: { $ne: true },
  }).sort({ updatedAt: -1 });
  if (withDetail) query.select('+privateNotes +checklist +deadlines');
  const plans = await query.lean();

  const planByProgram = new Map<string, Record<string, unknown>>();
  for (const plan of plans as Array<Record<string, any>>) {
    const programId = String(plan.target?.id ?? '').toLowerCase();
    if (programId && !planByProgram.has(programId)) {
      planByProgram.set(programId, plan);
    }
  }

  const orderedIds = Array.from(planByProgram.keys());
  const visiblePrograms = await readPrograms(orderedIds, { skipIdLimit: true });
  const visibleById = new Map(
    (visiblePrograms as Array<Record<string, any>>).map((program) => [
      String(program._id).toLowerCase(),
      program,
    ]),
  );
  const orderedVisible = orderedIds
    .map((id) => visibleById.get(id))
    .filter((program): program is Record<string, any> => Boolean(program));

  const plansByProgramId = new Map<string, Record<string, unknown>>();
  for (const program of orderedVisible) {
    const programId = String(program._id).toLowerCase();
    const plan = planByProgram.get(programId);
    if (plan) plansByProgramId.set(programId, plan);
  }

  return { accountId, programs: orderedVisible, plansByProgramId };
};

export const getWatchedPrograms = async (netid: any): Promise<Record<string, any>[]> => {
  const { programs } = await loadVisibleWatchedPrograms(netid, { withDetail: false });
  return programs;
};

export const getWatchedProgramIds = async (netid: any): Promise<string[]> => {
  const { programs } = await loadVisibleWatchedPrograms(netid, { withDetail: false });
  return programs.map((program) => String(program._id));
};

export const getWatchedProgramPlans = async (
  netid: any,
): Promise<Record<string, ResearchPlanView>> => {
  const { plansByProgramId } = await loadVisibleWatchedPrograms(netid, { withDetail: true });
  const result: Record<string, ResearchPlanView> = {};
  for (const [programId, plan] of plansByProgramId) {
    result[programId] = researchPlanViewFromDoc(plan);
  }
  return result;
};

export const addWatchedPrograms = async (netid: any, values: unknown[]): Promise<string[]> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const ids = await resolveWatchedProgramObjectIds(values);
  const visiblePrograms = await readPrograms(ids);
  for (const program of visiblePrograms as Array<Record<string, any>>) {
    const targetId = new mongoose.Types.ObjectId(String(program._id));
    await ResearchPlan.updateOne(
      { accountId, 'target.kind': PROGRAM_TARGET_KIND, 'target.id': targetId },
      {
        $set: { archived: false },
        $setOnInsert: {
          accountId,
          target: { kind: PROGRAM_TARGET_KIND, id: targetId },
          stage: 'SAVED',
        },
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  }
  return getWatchedProgramIds(netid);
};

export const removeWatchedPrograms = async (netid: any, values: unknown[]): Promise<string[]> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const ids = await resolveWatchedProgramObjectIds(values);
  if (ids.length) {
    await ResearchPlan.updateMany(
      {
        accountId,
        'target.kind': PROGRAM_TARGET_KIND,
        'target.id': { $in: ids },
      },
      { $set: { archived: true, ...clearedResearchPlanFields() } },
      { runValidators: true },
    );
  }
  return getWatchedProgramIds(netid);
};

export const updateWatchedProgramPlan = async (
  netid: any,
  programId: string,
  plan: ResearchPlanInput,
): Promise<Record<string, ResearchPlanView>> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const targetId = new mongoose.Types.ObjectId(normalizeObjectIdString(programId, 'program'));
  const update = normalizeResearchPlanUpdate(plan);
  const filter = {
    accountId,
    'target.kind': PROGRAM_TARGET_KIND,
    'target.id': targetId,
    archived: { $ne: true },
  };
  if (Object.keys(update).length === 0) {
    const existing = await ResearchPlan.exists(filter);
    if (!existing) {
      throw new NotFoundError('Watched program not found');
    }
    return getWatchedProgramPlans(netid);
  }
  const result = await ResearchPlan.updateOne(filter, { $set: update }, { runValidators: true });
  if (!result.matchedCount) {
    throw new NotFoundError('Watched program not found');
  }
  return getWatchedProgramPlans(netid);
};

export const deleteWatchedProgramPlan = async (
  netid: any,
  programId: string,
): Promise<Record<string, ResearchPlanView>> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const targetId = new mongoose.Types.ObjectId(normalizeObjectIdString(programId, 'program'));
  await ResearchPlan.updateOne(
    {
      accountId,
      'target.kind': PROGRAM_TARGET_KIND,
      'target.id': targetId,
      archived: { $ne: true },
    },
    { $set: clearedResearchPlanFields() },
    { runValidators: true },
  );
  return getWatchedProgramPlans(netid);
};

export const exportSavedResearchEntities = async (
  netid: any,
  options: SavedResearchEntitiesExportOptions = {},
) => {
  const { entities, plansByEntityId } = await loadVisibleAccountPlans(netid, { withDetail: true });
  const forceIncludePrivateNotes = options.includePrivateNotes === true;

  let includedAnyPrivateNote = false;
  const items = entities.map((entity) => {
    const view = plansByEntityId.has(entity._id)
      ? researchPlanViewFromDoc(plansByEntityId.get(entity._id) as Record<string, unknown>)
      : emptyResearchPlanView();
    const preferences = view.exportPreferences;
    const includePrivateNote =
      Boolean(view.privateNotes) && (forceIncludePrivateNotes || preferences.includePrivateNotes);
    if (includePrivateNote) includedAnyPrivateNote = true;
    return {
      researchEntity: {
        id: entity._id,
        slug: entity.slug,
        name: exportTextWithoutDirectContact(entity.displayName || entity.name),
      },
      stage: view.stage,
      ...(preferences.includeChecklist
        ? {
            checklist: view.checklist.map((item) => ({
              label: exportUserTextForSpreadsheet(item.label),
              completed: item.completed,
            })),
          }
        : {}),
      ...(preferences.includeDeadlines
        ? {
            deadlines: view.deadlines.map((deadline) => ({
              label: exportUserTextForSpreadsheet(deadline.label),
              dueAt: deadline.dueAt,
            })),
          }
        : {}),
      ...(includePrivateNote
        ? { privateNote: exportUserTextForSpreadsheet(view.privateNotes) }
        : {}),
    };
  });

  return {
    schemaVersion: 2 as const,
    exportedAt: (options.exportedAt || new Date()).toISOString(),
    itemCount: entities.length,
    privacy: {
      includesPrivateNotes: includedAnyPrivateNote,
      includesContactRoutes: false as const,
      includesNonPublicContactEmails: false as const,
    },
    items,
  };
};
