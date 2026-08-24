import mongoose from 'mongoose';
import {
  SavedSearch,
  MAX_SAVED_SEARCHES_PER_ACCOUNT,
  MAX_SAVED_SEARCH_LABEL_LENGTH,
  MAX_SAVED_SEARCH_QUERY_LENGTH,
  MAX_SAVED_SEARCH_FILTER_VALUES,
  MAX_SAVED_SEARCH_FILTER_VALUE_LENGTH,
  MAX_SAVED_SEARCH_URL_PARAMS_LENGTH,
  MAX_SAVED_SEARCH_TRACKED_MATCH_IDS,
  savedSearchCurrentAvailabilityValues,
  savedSearchCompensationValues,
  savedSearchEligibleStudentLevelValues,
  type SavedSearchCurrentAvailability,
  type SavedSearchCompensation,
  type SavedSearchEligibleStudentLevel,
} from '../models/savedSearch';
import { searchResearchGroupsViaMeili } from './researchGroupService';
import type { ResearchGroupFilterInput } from './researchGroupFilters';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { resolveAccountIdByNetid } from './accountService';
import { NotFoundError } from '../utils/errors';
import { sanitizeLogValue } from '../utils/logSanitizer';

const OBJECT_ID_HEX_PATTERN = /^[a-f0-9]{24}$/i;

export interface SavedSearchFilters {
  school: string[];
  departments: string[];
  researchAreas: string[];
  entityType: string[];
  currentAvailability: SavedSearchCurrentAvailability[];
  compensation: SavedSearchCompensation[];
  eligibleStudentLevels: SavedSearchEligibleStudentLevel[];
  hostsUndergrads: boolean;
  hasDocumentedWayIn: boolean;
}

export interface SavedSearchInput {
  label?: unknown;
  queryText?: unknown;
  filters?: unknown;
  urlParams?: unknown;
}

export interface SavedSearchView {
  _id: string;
  label: string;
  queryText: string;
  filters: SavedSearchFilters;
  urlParams: string;
  newMatchCount: number | null;
  lastViewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

const badRequestError = (message: string) => {
  const error: any = new Error(message);
  error.status = 400;
  return error;
};

const conflictError = (message: string) => {
  const error: any = new Error(message);
  error.status = 409;
  return error;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    if (result.length >= MAX_SAVED_SEARCH_FILTER_VALUES) break;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > MAX_SAVED_SEARCH_FILTER_VALUE_LENGTH) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
};

const normalizeEnumArray = <T extends string>(value: unknown, allowed: readonly T[]): T[] => {
  const allowedSet = new Set<string>(allowed);
  const seen = new Set<T>();
  const result: T[] = [];
  if (!Array.isArray(value)) return result;
  for (const raw of value) {
    if (typeof raw !== 'string' || !allowedSet.has(raw) || seen.has(raw as T)) continue;
    seen.add(raw as T);
    result.push(raw as T);
  }
  return result;
};

export const normalizeSavedSearchFilters = (value: unknown): SavedSearchFilters => {
  const record = isPlainRecord(value) ? value : {};
  return {
    school: normalizeStringArray(record.school),
    departments: normalizeStringArray(record.departments),
    researchAreas: normalizeStringArray(record.researchAreas),
    entityType: normalizeStringArray(record.entityType),
    currentAvailability: normalizeEnumArray(
      record.currentAvailability,
      savedSearchCurrentAvailabilityValues,
    ),
    compensation: normalizeEnumArray(record.compensation, savedSearchCompensationValues),
    eligibleStudentLevels: normalizeEnumArray(
      record.eligibleStudentLevels,
      savedSearchEligibleStudentLevelValues,
    ),
    hostsUndergrads: record.hostsUndergrads === true,
    hasDocumentedWayIn: record.hasDocumentedWayIn === true,
  };
};

export const savedSearchFiltersAreEmpty = (filters: SavedSearchFilters): boolean =>
  filters.school.length === 0 &&
  filters.departments.length === 0 &&
  filters.researchAreas.length === 0 &&
  filters.entityType.length === 0 &&
  filters.currentAvailability.length === 0 &&
  filters.compensation.length === 0 &&
  filters.eligibleStudentLevels.length === 0 &&
  !filters.hostsUndergrads &&
  !filters.hasDocumentedWayIn;

const normalizeLabel = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_SAVED_SEARCH_LABEL_LENGTH);
};

const normalizeQueryText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_SAVED_SEARCH_QUERY_LENGTH);
};

const normalizeUrlParams = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/^\?+/, '');
  return trimmed.slice(0, MAX_SAVED_SEARCH_URL_PARAMS_LENGTH);
};

export interface NormalizedSavedSearchInput {
  label: string;
  queryText: string;
  filters: SavedSearchFilters;
  urlParams: string;
}

export const normalizeSavedSearchInput = (
  input: SavedSearchInput,
): NormalizedSavedSearchInput => {
  const record = isPlainRecord(input) ? input : {};
  return {
    label: normalizeLabel(record.label),
    queryText: normalizeQueryText(record.queryText),
    filters: normalizeSavedSearchFilters(record.filters),
    urlParams: normalizeUrlParams(record.urlParams),
  };
};

const savedSearchIsRunnable = (input: NormalizedSavedSearchInput): boolean =>
  Boolean(input.queryText) || !savedSearchFiltersAreEmpty(input.filters);

const toResearchGroupFilterInput = (filters: SavedSearchFilters): ResearchGroupFilterInput => {
  const input: ResearchGroupFilterInput = {
    studentVisibilityTier: [...publicStudentVisibilityTiers],
  };
  if (filters.school.length) input.school = filters.school;
  if (filters.departments.length) input.departments = filters.departments;
  if (filters.researchAreas.length) input.researchAreas = filters.researchAreas;
  if (filters.entityType.length) input.entityType = filters.entityType;
  if (filters.currentAvailability.length) {
    input.currentAvailability =
      filters.currentAvailability as ResearchGroupFilterInput['currentAvailability'];
  }
  if (filters.compensation.length) {
    input.compensation = filters.compensation as ResearchGroupFilterInput['compensation'];
  }
  if (filters.eligibleStudentLevels.length) {
    input.eligibleStudentLevels =
      filters.eligibleStudentLevels as ResearchGroupFilterInput['eligibleStudentLevels'];
  }
  if (filters.hostsUndergrads) input.hostsUndergrads = true;
  if (filters.hasDocumentedWayIn) input.hasDocumentedWayIn = true;
  return input;
};

export const computeSavedSearchMatchIds = async (
  queryText: string,
  filters: SavedSearchFilters,
): Promise<string[]> => {
  const result = await searchResearchGroupsViaMeili(
    queryText,
    toResearchGroupFilterInput(filters),
    1,
    MAX_SAVED_SEARCH_TRACKED_MATCH_IDS,
    {},
    { includeNonPublic: false },
  );
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entity of result.researchEntities as Array<{ _id?: unknown }>) {
    const id = String(entity?._id ?? '')
      .trim()
      .toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_SAVED_SEARCH_TRACKED_MATCH_IDS) break;
  }
  return ids;
};

const toIsoString = (value: unknown): string | undefined => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const savedSearchViewFromDoc = (
  doc: Record<string, any>,
  newMatchCount: number | null,
): SavedSearchView => ({
  _id: String(doc._id),
  label: typeof doc.label === 'string' ? doc.label : '',
  queryText: typeof doc.queryText === 'string' ? doc.queryText : '',
  filters: normalizeSavedSearchFilters(doc.filters),
  urlParams: typeof doc.urlParams === 'string' ? doc.urlParams : '',
  newMatchCount,
  ...(toIsoString(doc.lastViewedAt) ? { lastViewedAt: toIsoString(doc.lastViewedAt) } : {}),
  ...(toIsoString(doc.createdAt) ? { createdAt: toIsoString(doc.createdAt) } : {}),
  ...(toIsoString(doc.updatedAt) ? { updatedAt: toIsoString(doc.updatedAt) } : {}),
});

const countNewMatches = (currentIds: string[], lastSeen: unknown): number => {
  const seen = new Set<string>(
    (Array.isArray(lastSeen) ? lastSeen : []).map((id) => String(id).trim().toLowerCase()),
  );
  return currentIds.filter((id) => !seen.has(id)).length;
};

const resolveNewMatchCount = async (doc: Record<string, any>): Promise<number | null> => {
  try {
    const filters = normalizeSavedSearchFilters(doc.filters);
    const currentIds = await computeSavedSearchMatchIds(
      typeof doc.queryText === 'string' ? doc.queryText : '',
      filters,
    );
    return countNewMatches(currentIds, doc.lastSeenEntityIds);
  } catch (error) {
    console.error('Saved search new-match computation failed:', sanitizeLogValue(error));
    return null;
  }
};

export const listSavedSearches = async (netid: any): Promise<SavedSearchView[]> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const docs = (await SavedSearch.find({ accountId })
    .sort({ updatedAt: -1 })
    .lean()) as Array<Record<string, any>>;
  return Promise.all(
    docs.map(async (doc) => savedSearchViewFromDoc(doc, await resolveNewMatchCount(doc))),
  );
};

export const createSavedSearch = async (
  netid: any,
  input: SavedSearchInput,
): Promise<SavedSearchView[]> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const normalized = normalizeSavedSearchInput(input);
  if (!savedSearchIsRunnable(normalized)) {
    throw badRequestError('A saved search needs a query or at least one filter');
  }

  const count = await SavedSearch.countDocuments({ accountId });
  if (count >= MAX_SAVED_SEARCHES_PER_ACCOUNT) {
    throw conflictError('Saved search limit reached');
  }

  let seedIds: string[] = [];
  try {
    seedIds = await computeSavedSearchMatchIds(normalized.queryText, normalized.filters);
  } catch (error) {
    console.error('Saved search seed computation failed:', sanitizeLogValue(error));
    seedIds = [];
  }

  await SavedSearch.create({
    accountId,
    label: normalized.label,
    queryText: normalized.queryText,
    filters: normalized.filters,
    urlParams: normalized.urlParams,
    lastSeenEntityIds: seedIds.slice(0, MAX_SAVED_SEARCH_TRACKED_MATCH_IDS),
    lastViewedAt: new Date(),
  });

  return listSavedSearches(netid);
};

const resolveSavedSearchObjectId = (id: unknown): mongoose.Types.ObjectId => {
  const value = typeof id === 'string' ? id.trim() : '';
  if (!OBJECT_ID_HEX_PATTERN.test(value)) {
    throw badRequestError('Invalid saved search id');
  }
  return new mongoose.Types.ObjectId(value.toLowerCase());
};

export const renameSavedSearch = async (
  netid: any,
  id: string,
  label: unknown,
): Promise<SavedSearchView[]> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const objectId = resolveSavedSearchObjectId(id);
  const result = await SavedSearch.updateOne(
    { _id: objectId, accountId },
    { $set: { label: normalizeLabel(label) } },
    { runValidators: true },
  );
  if (!result.matchedCount) {
    throw new NotFoundError('Saved search not found');
  }
  return listSavedSearches(netid);
};

export const markSavedSearchViewed = async (
  netid: any,
  id: string,
): Promise<SavedSearchView[]> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const objectId = resolveSavedSearchObjectId(id);
  const doc = (await SavedSearch.findOne({ _id: objectId, accountId }).lean()) as Record<
    string,
    any
  > | null;
  if (!doc) {
    throw new NotFoundError('Saved search not found');
  }

  const update: Record<string, unknown> = { lastViewedAt: new Date() };
  try {
    const currentIds = await computeSavedSearchMatchIds(
      typeof doc.queryText === 'string' ? doc.queryText : '',
      normalizeSavedSearchFilters(doc.filters),
    );
    update.lastSeenEntityIds = currentIds.slice(0, MAX_SAVED_SEARCH_TRACKED_MATCH_IDS);
  } catch (error) {
    console.error('Saved search view refresh failed:', sanitizeLogValue(error));
  }

  await SavedSearch.updateOne(
    { _id: objectId, accountId },
    { $set: update },
    { runValidators: true },
  );
  return listSavedSearches(netid);
};

export const deleteSavedSearch = async (netid: any, id: string): Promise<SavedSearchView[]> => {
  const accountId = await resolveAccountIdByNetid(netid);
  const objectId = resolveSavedSearchObjectId(id);
  await SavedSearch.deleteOne({ _id: objectId, accountId });
  return listSavedSearches(netid);
};
