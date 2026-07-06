/**
 * Service layer for user account CRUD and favorites management.
 */
import { User } from '../models/index';
import { NotFoundError } from '../utils/errors';
import {
  readListing,
  readPublicListings,
  confirmListing,
  unconfirmListing,
  addFavorite,
  removeFavorite,
} from './listingService';
import {
  readFellowships,
  addFavorite as addFellowshipFavorite,
  removeFavorite as removeFellowshipFavorite,
} from './fellowshipService';
import { getPathwaysByIds, type PathwaySearchHit } from './pathwaySearchService';
import mongoose from 'mongoose';
import { escapeRegex } from '../utils/regex';
import { isPublicHttpUrl } from '../utils/urlSafety';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { safeSpreadsheetCell } from '../utils/spreadsheetSafety';

const PLANNING_INTENTS = new Set(['thesis', 'outreach', 'credit', 'funding', 'apply', 'later']);
const PLANNING_STAGES = new Set(['saved', 'researching', 'ready', 'acted', 'archived']);
const MAX_ACCOUNT_MUTATION_IDS = 100;
const MAX_SAVED_PATHWAY_CHECKLIST_ITEMS = 50;
const MAX_SAVED_PATHWAY_CHECKLIST_KEY_LENGTH = 120;
const MAX_SAVED_PATHWAY_PLAN_RESPONSE_ITEMS = 100;
const MAX_USER_UPDATE_VALUE_DEPTH = 20;
const MAX_USER_UPDATE_VALUE_ARRAY_ITEMS = 200;
const MAX_USER_UPDATE_VALUE_OBJECT_KEYS = 200;
export const MAX_SAVED_PATHWAY_NOTE_LENGTH = 5000;
const NETID_LOOKUP_RE = /^[A-Za-z0-9]{2,12}$/;
const USER_UPDATE_OPERATORS = new Set(['$set', '$unset', '$addToSet']);
const USER_UPDATE_PATH_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
type FavoriteObjectIdArrayField = 'favListings' | 'favFellowships' | 'favPathways';

const recordFavoriteCounterSideEffect = async (
  label: string,
  operation: () => Promise<unknown>,
) => {
  try {
    await operation();
  } catch (error) {
    console.error(`${label} failed:`, sanitizeLogValue(error));
  }
};

export interface SavedPathwayPlanInput {
  intent?: string;
  stage?: string;
  note?: string;
  checklist?: Record<string, unknown>;
}

export interface SavedPathwayPlansExportOptions {
  includePrivateNotes?: boolean;
  exportedAt?: Date;
}

export interface SavedPathwayPlansExportItem {
  pathwayId: string;
  title: string;
  researchEntity: {
    id: string;
    slug: string;
    name: string;
  };
  intent: string;
  stage: string;
  checklist: Record<string, boolean>;
  sourceLinks: string[];
  bestNextStepCategory: string;
  privateNote?: string;
}

export interface SavedPathwayPlansExport {
  schemaVersion: 1;
  exportedAt: string;
  itemCount: number;
  privacy: {
    includesPrivateNotes: boolean;
    includesContactRoutes: false;
    includesNonPublicContactEmails: false;
  };
  items: SavedPathwayPlansExportItem[];
}

const sanitizeSavedPathwayChecklistKey = (key: unknown): string | undefined => {
  if (typeof key !== 'string') return undefined;
  const trimmed = key.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_SAVED_PATHWAY_CHECKLIST_KEY_LENGTH ||
    trimmed === '__proto__' ||
    trimmed === 'constructor' ||
    trimmed === 'prototype'
  ) {
    return undefined;
  }
  return trimmed.replace(/^\$+/, '_').replace(/\./g, '_');
};

export function sanitizeSavedPathwayPlanForStorage(
  plan: unknown,
): Required<SavedPathwayPlanInput> {
  const candidate =
    plan && typeof plan === 'object' ? (plan as SavedPathwayPlanInput) : {};
  const checklist: Record<string, boolean> = {};
  const rawChecklist =
    candidate.checklist && typeof candidate.checklist === 'object' && !Array.isArray(candidate.checklist)
      ? candidate.checklist
      : {};
  let checklistCount = 0;

  for (const key in rawChecklist) {
    if (checklistCount >= MAX_SAVED_PATHWAY_CHECKLIST_ITEMS) break;
    if (!Object.prototype.hasOwnProperty.call(rawChecklist, key)) continue;
    const normalizedKey = sanitizeSavedPathwayChecklistKey(key);
    if (normalizedKey) {
      checklist[normalizedKey] = rawChecklist[key] === true;
      checklistCount += 1;
    }
  }

  return {
    intent:
      candidate.intent && PLANNING_INTENTS.has(candidate.intent) ? candidate.intent : 'later',
    stage: candidate.stage && PLANNING_STAGES.has(candidate.stage) ? candidate.stage : 'saved',
    note:
      typeof candidate.note === 'string'
        ? candidate.note.slice(0, MAX_SAVED_PATHWAY_NOTE_LENGTH)
        : '',
    checklist,
  };
}

export function sanitizeSavedPathwayPlansForResponse(
  savedPathwayPlans: unknown,
): Record<string, Required<SavedPathwayPlanInput>> {
  if (!savedPathwayPlans || typeof savedPathwayPlans !== 'object' || Array.isArray(savedPathwayPlans)) {
    return {};
  }

  const sanitized: Record<string, Required<SavedPathwayPlanInput>> = {};
  let count = 0;
  for (const [pathwayId, plan] of Object.entries(savedPathwayPlans as Record<string, unknown>)) {
    if (count >= MAX_SAVED_PATHWAY_PLAN_RESPONSE_ITEMS) break;
    let pathwayKey = '';
    try {
      pathwayKey = normalizeObjectIdStringForUserMutation(pathwayId, 'pathway');
    } catch {
      continue;
    }
    sanitized[pathwayKey] = sanitizeSavedPathwayPlanForStorage(plan);
    count += 1;
  }
  return sanitized;
}

const isHttpUrl = (value: unknown): value is string => {
  return isPublicHttpUrl(value);
};

const sourceLinksForPathwayExport = (pathway: PathwaySearchHit): string[] =>
  Array.from(
    new Set(
      [
        ...(pathway.sourceUrls || []),
        ...(pathway.evidence || []).map((item) => item.sourceUrl),
        pathway.activePostedOpportunity?.applicationUrl,
      ].filter(isHttpUrl),
    ),
  );

const defaultIntentForPathwayExport = (pathway: PathwaySearchHit): string => {
  switch (pathway.bestNextStepCategory) {
    case 'apply':
      return 'apply';
    case 'find-funding':
      return 'funding';
    case 'plan-outreach':
    case 'contact-program':
      return 'outreach';
    default:
      return 'later';
  }
};

const exportTextWithoutDirectContact = (value: unknown): string =>
  safeSpreadsheetCell(redactDirectContactInfo(String(value || '')));

const exportUserTextForSpreadsheet = (value: unknown): string =>
  safeSpreadsheetCell(String(value || ''));

const exportChecklistForSpreadsheet = (checklist: Record<string, boolean>): Record<string, boolean> =>
  Object.fromEntries(
    Object.entries(checklist).map(([key, value]) => [
      exportUserTextForSpreadsheet(key),
      value,
    ]),
  );

export const buildSavedPathwayPlansExport = (
  pathways: PathwaySearchHit[],
  savedPathwayPlans: Record<string, SavedPathwayPlanInput | undefined>,
  options: SavedPathwayPlansExportOptions = {},
): SavedPathwayPlansExport => {
  const includePrivateNotes = options.includePrivateNotes === true;

  return {
    schemaVersion: 1,
    exportedAt: (options.exportedAt || new Date()).toISOString(),
    itemCount: pathways.length,
    privacy: {
      includesPrivateNotes: includePrivateNotes,
      includesContactRoutes: false,
      includesNonPublicContactEmails: false,
    },
    items: pathways.map((pathway) => {
      const rawPlan = savedPathwayPlans[pathway._id] || {
        intent: defaultIntentForPathwayExport(pathway),
        stage: 'saved',
        note: '',
        checklist: {},
      };
      const plan = sanitizeSavedPathwayPlanForStorage(rawPlan);
      const item: SavedPathwayPlansExportItem = {
        pathwayId: pathway._id,
        title: exportTextWithoutDirectContact(pathway.studentFacingLabel),
        researchEntity: {
          id: pathway.researchEntity._id,
          slug: pathway.researchEntity.slug,
          name: exportTextWithoutDirectContact(
            pathway.researchEntity.displayName || pathway.researchEntity.name,
          ),
        },
        intent: plan.intent,
        stage: plan.stage,
        checklist: exportChecklistForSpreadsheet(plan.checklist as Record<string, boolean>),
        sourceLinks: sourceLinksForPathwayExport(pathway),
        bestNextStepCategory: pathway.bestNextStepCategory,
      };

      if (includePrivateNotes && plan.note) {
        item.privateNote = exportUserTextForSpreadsheet(plan.note);
      }

      return item;
    }),
  };
};

export function pruneSavedPathwayPlansForExistingPathways(
  savedPathwayPlans: Record<string, SavedPathwayPlanInput | undefined> = {},
  pathwayIds: Array<string | mongoose.Types.ObjectId>,
): Record<string, SavedPathwayPlanInput | undefined> {
  const validIds = new Set(
    pathwayIds
      .map((id) => normalizeObjectIdStringForUserMutation(id, 'pathway'))
      .filter(Boolean),
  );
  return Object.fromEntries(
    Object.entries(savedPathwayPlans).filter(([pathwayId]) => validIds.has(pathwayId)),
  );
}

export function buildSavedPathwayPlanUnsetForIds(
  pathwayIds: Array<string | mongoose.Types.ObjectId>,
): Record<string, ''> {
  return Object.fromEntries(
    pathwayIds
      .map((pathwayId) => normalizeObjectIdStringForUserMutation(pathwayId, 'pathway'))
      .map((pathwayId) => [`savedPathwayPlans.${pathwayId}`, '']),
  );
}

const badRequestError = (message: string) => {
  const error: any = new Error(message);
  error.status = 400;
  return error;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPrototypePollutionKey = (key: string): boolean =>
  key === '__proto__' || key === 'constructor' || key === 'prototype';

const isUnsafeNestedUserUpdateValue = (value: unknown, depth = 0): boolean => {
  if (depth > MAX_USER_UPDATE_VALUE_DEPTH) return true;
  if (Array.isArray(value)) {
    if (value.length > MAX_USER_UPDATE_VALUE_ARRAY_ITEMS) return true;
    return value.some((item) => isUnsafeNestedUserUpdateValue(item, depth + 1));
  }
  if (!isPlainRecord(value)) return false;

  const keys = Object.keys(value);
  if (keys.length > MAX_USER_UPDATE_VALUE_OBJECT_KEYS) return true;
  return keys.some(
    (key) =>
      key.startsWith('$') ||
      key.includes('.') ||
      isPrototypePollutionKey(key) ||
      isUnsafeNestedUserUpdateValue(value[key], depth + 1),
  );
};

const isSafeUserUpdatePath = (path: string): boolean => {
  const parts = path.split('.');
  return (
    parts.length > 0 &&
    parts.every(
      (part) =>
        part.length > 0 &&
        USER_UPDATE_PATH_SEGMENT_RE.test(part) &&
        !part.startsWith('$') &&
        !isPrototypePollutionKey(part),
    )
  );
};

const assertSafeUserUpdateDocument = (data: unknown): Record<string, unknown> => {
  if (!isPlainRecord(data)) {
    throw badRequestError('Invalid user update payload');
  }

  const keys = Object.keys(data);
  const operatorKeys = keys.filter((key) => key.startsWith('$'));
  if (operatorKeys.length > 0) {
    if (operatorKeys.length !== keys.length) {
      throw badRequestError('Invalid user update payload');
    }
    for (const operator of operatorKeys) {
      if (!USER_UPDATE_OPERATORS.has(operator)) {
        throw badRequestError('Invalid user update payload');
      }
      const operatorPayload = data[operator];
      if (!isPlainRecord(operatorPayload)) {
        throw badRequestError('Invalid user update payload');
      }
      for (const [path, value] of Object.entries(operatorPayload)) {
        if (!isSafeUserUpdatePath(path) || isUnsafeNestedUserUpdateValue(value)) {
          throw badRequestError('Invalid user update payload');
        }
      }
    }
    return data;
  }

  for (const [key, value] of Object.entries(data)) {
    if (
      key.startsWith('$') ||
      key.includes('.') ||
      isPrototypePollutionKey(key) ||
      isUnsafeNestedUserUpdateValue(value)
    ) {
      throw badRequestError('Invalid user update payload');
    }
  }
  return data;
};

export function normalizeObjectIdStringForUserMutation(
  value: unknown,
  fieldName: string,
): string {
  const id =
    typeof value === 'string'
      ? value.trim()
      : value instanceof mongoose.Types.ObjectId
        ? value.toHexString()
        : '';
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    throw badRequestError(`Invalid ${fieldName} id`);
  }
  return id;
}

export function normalizeObjectIdsForUserMutation(
  values: unknown[],
  fieldName: string,
): mongoose.Types.ObjectId[] {
  if (!Array.isArray(values)) {
    throw badRequestError(`Invalid ${fieldName} ids`);
  }
  if (values.length > MAX_ACCOUNT_MUTATION_IDS) {
    throw badRequestError(`Too many ${fieldName} ids`);
  }

  const seen = new Set<string>();
  const ids: mongoose.Types.ObjectId[] = [];
  for (const value of values) {
    const id = normalizeObjectIdStringForUserMutation(value, fieldName).toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(new mongoose.Types.ObjectId(id));
  }
  return ids;
}

const normalizeStoredObjectIdsForUserMutation = (
  values: unknown,
  fieldName: string,
): mongoose.Types.ObjectId[] => {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const ids: mongoose.Types.ObjectId[] = [];
  for (const value of values.slice(0, MAX_ACCOUNT_MUTATION_IDS)) {
    try {
      const id = normalizeObjectIdStringForUserMutation(value, fieldName).toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(new mongoose.Types.ObjectId(id));
    } catch {
      continue;
    }
  }
  return ids;
};

const mergeStoredObjectIdsForUserMutation = (
  existingValues: unknown,
  addedValues: mongoose.Types.ObjectId[],
  fieldName: string,
): mongoose.Types.ObjectId[] =>
  normalizeStoredObjectIdsForUserMutation(
    [...addedValues, ...normalizeStoredObjectIdsForUserMutation(existingValues, fieldName)],
    fieldName,
  );

const removeStoredObjectIdsForUserMutation = (
  existingValues: unknown,
  removedValues: mongoose.Types.ObjectId[],
  fieldName: string,
): mongoose.Types.ObjectId[] => {
  const removed = new Set(removedValues.map((value) => value.toHexString().toLowerCase()));
  return normalizeStoredObjectIdsForUserMutation(existingValues, fieldName).filter(
    (value) => !removed.has(value.toHexString().toLowerCase()),
  );
};

const storedObjectIdStringsForUserMutation = (values: unknown, fieldName: string): string[] =>
  normalizeStoredObjectIdsForUserMutation(values, fieldName).map((value) => value.toHexString());

const userLookupFilterForMutation = (id: any): Record<string, unknown> => {
  const objectId = normalizeUserLookupObjectId(id);
  return objectId ? { _id: objectId } : buildCaseInsensitiveNetidFilter(id);
};

const addFavoriteObjectIdIfMissing = async (
  id: any,
  fieldName: FavoriteObjectIdArrayField,
  value: mongoose.Types.ObjectId,
): Promise<{ user: any; added: boolean }> => {
  const baseFilter = userLookupFilterForMutation(id);
  const user = await User.findOneAndUpdate(
    { ...baseFilter, [fieldName]: { $ne: value } },
    { $addToSet: { [fieldName]: value } },
    { new: true, runValidators: true },
  );

  if (user) {
    return { user: user.toObject(), added: true };
  }

  const existingUser = await User.findOne(baseFilter);
  if (!existingUser) {
    throw new NotFoundError('User not found');
  }
  return { user: existingUser.toObject(), added: false };
};

const removeFavoriteObjectIdIfPresent = async (
  id: any,
  fieldName: FavoriteObjectIdArrayField,
  value: mongoose.Types.ObjectId,
): Promise<{ user: any; removed: boolean }> => {
  const baseFilter = userLookupFilterForMutation(id);
  const user = await User.findOneAndUpdate(
    { ...baseFilter, [fieldName]: value },
    { $pull: { [fieldName]: value } },
    { new: true, runValidators: true },
  );

  if (user) {
    return { user: user.toObject(), removed: true };
  }

  const existingUser = await User.findOne(baseFilter);
  if (!existingUser) {
    throw new NotFoundError('User not found');
  }
  return { user: existingUser.toObject(), removed: false };
};

const removeFavoriteObjectIdsWithoutCounters = async (
  id: any,
  fieldName: FavoriteObjectIdArrayField,
  values: mongoose.Types.ObjectId[],
): Promise<any> => {
  const baseFilter = userLookupFilterForMutation(id);
  const user = await User.findOneAndUpdate(
    baseFilter,
    { $pull: { [fieldName]: { $in: values } } },
    { new: true, runValidators: true },
  );
  if (!user) {
    throw new NotFoundError('User not found');
  }
  return user.toObject();
};

const removeSavedPathwayIdsAndPlans = async (
  id: any,
  values: mongoose.Types.ObjectId[],
): Promise<any> => {
  if (values.length === 0) {
    return readUser(id);
  }

  const unset = buildSavedPathwayPlanUnsetForIds(values);
  const baseFilter = userLookupFilterForMutation(id);
  const user = await User.findOneAndUpdate(
    baseFilter,
    {
      $pull: { favPathways: { $in: values } },
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    },
    { new: true, runValidators: true },
  );
  if (!user) {
    throw new NotFoundError('User not found');
  }
  return user.toObject();
};

export const createUser = async (userData: any) => {
  const user = new User(userData);
  await user.save();
  return user.toObject();
};

export const readAllUsers = async () => {
  const users = await User.find();
  return users.map((user: any) => user.toObject());
};

export const buildCaseInsensitiveNetidFilter = (id: unknown) => ({
  netid: { $regex: `^${escapeRegex(normalizeUserLookupNetid(id))}$`, $options: 'i' },
});

const normalizeUserLookupNetid = (id: unknown): string => {
  const netid = typeof id === 'string' ? id.trim() : '';
  if (!NETID_LOOKUP_RE.test(netid)) {
    throw badRequestError('Invalid netid');
  }
  return netid;
};

export const normalizeUserLookupObjectId = (id: unknown): string | null => {
  const value =
    typeof id === 'string'
      ? id.trim()
      : id instanceof mongoose.Types.ObjectId
        ? id.toHexString()
        : '';
  return /^[a-f0-9]{24}$/i.test(value) ? value : null;
};

export const readUser = async (id: any) => {
  const objectId = normalizeUserLookupObjectId(id);
  if (objectId) {
    const user = await User.findById(objectId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user.toObject();
  } else {
    const netidFilter = buildCaseInsensitiveNetidFilter(id);
    const user = await User.findOne(netidFilter);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user.toObject();
  }
};

export const validateUser = async (id: any) => {
  const objectId = normalizeUserLookupObjectId(id);
  if (objectId) {
    const user = await User.findById(objectId);
    if (!user) {
      return null;
    }
    return user.toObject();
  } else {
    const user = await User.findOne(buildCaseInsensitiveNetidFilter(id));
    if (!user) {
      return null;
    }
    return user.toObject();
  }
};

export const userExists = async (id: any) => {
  const objectId = normalizeUserLookupObjectId(id);
  if (objectId) {
    const user = await User.findById(objectId);
    if (!user) {
      return false;
    }
    return true;
  } else {
    const user = await User.findOne(buildCaseInsensitiveNetidFilter(id));
    if (!user) {
      return false;
    }
    return true;
  }
};

export const updateUser = async (id: any, data: any) => {
  const safeData = assertSafeUserUpdateDocument(data);
  const objectId = normalizeUserLookupObjectId(id);
  if (objectId) {
    const user = await User.findByIdAndUpdate(objectId, safeData, { new: true, runValidators: true });
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user.toObject();
  } else {
    const netidFilter = buildCaseInsensitiveNetidFilter(id);
    const user = await User.findOneAndUpdate(netidFilter, safeData, { new: true, runValidators: true });
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user.toObject();
  }
};

export const confirmUser = async (id: any) => {
  const user = await updateUser(id, { userConfirmed: true });
  for (const listingId of storedObjectIdStringsForUserMutation(user.ownListings, 'ownListings')) {
    const listing = await readListing(listingId);
    if (listing && listing.ownerId === user.netid) {
      await confirmListing(listingId, user.netid);
    }
  }
  return user;
};

export const unconfirmUser = async (id: any) => {
  const user = await updateUser(id, { userConfirmed: false });
  for (const listingId of storedObjectIdStringsForUserMutation(user.ownListings, 'ownListings')) {
    const listing = await readListing(listingId);
    if (listing && listing.ownerId === user.netid) {
      await unconfirmListing(listingId, user.netid);
    }
  }
  return user;
};

export const deleteUser = async (id: any) => {
  const objectId = normalizeUserLookupObjectId(id);
  if (objectId) {
    const user = await User.findById(objectId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    await User.findByIdAndDelete(objectId);

    return user.toObject();
  } else {
    const netidFilter = buildCaseInsensitiveNetidFilter(id);
    const user = await User.findOne(netidFilter);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    await User.findOneAndDelete(netidFilter);
  }
};

export const addDepartments = async (id: any, newDepartments: [string]) => {
  const user = await readUser(id);

  user.departments.unshift(...newDepartments);
  user.departments = Array.from(new Set(user.departments));

  const newUser = await updateUser(id, { departments: user.departments });

  return newUser;
};

export const deleteDepartments = async (id: any, removedDepartments: [string]) => {
  const user = await readUser(id);

  user.departments = user.departments.filter(
    (department: string) => removedDepartments.indexOf(department) < 0,
  );

  const newUser = await updateUser(id, { departments: user.departments });

  return newUser;
};

export const clearDepartments = async (id: any) => {
  const newUser = await updateUser(id, { departments: [] });

  return newUser;
};

export const addOwnListings = async (id: any, Listings: [mongoose.Types.ObjectId]) => {
  const user = await readUser(id);
  const listingIds = normalizeObjectIdsForUserMutation(Listings, 'ownListings');

  user.ownListings = mergeStoredObjectIdsForUserMutation(
    user.ownListings,
    listingIds,
    'ownListings',
  );

  const newUser = await updateUser(id, { ownListings: user.ownListings });

  return newUser;
};

export const deleteOwnListings = async (id: any, removedListings: [mongoose.Types.ObjectId]) => {
  const user = await readUser(id);
  const listingIds = normalizeObjectIdsForUserMutation(removedListings, 'ownListings');

  user.ownListings = removeStoredObjectIdsForUserMutation(
    user.ownListings,
    listingIds,
    'ownListings',
  );

  const newUser = await updateUser(id, { ownListings: user.ownListings });

  return newUser;
};

export const clearOwnListings = async (id: any) => {
  const newUser = await updateUser(id, { ownListings: [] });

  return newUser;
};

export const addFavListings = async (id: any, Listings: [mongoose.Types.ObjectId]) => {
  const listingIds = normalizeObjectIdsForUserMutation(Listings, 'favListings');
  const visibleListings = await readPublicListings(listingIds);
  const visibleListingIds = normalizeObjectIdsForUserMutation(
    visibleListings.map((listing) => listing._id),
    'favListings',
  );
  let newUser = await readUser(id);

  for (const listingId of visibleListingIds) {
    const result = await addFavoriteObjectIdIfMissing(id, 'favListings', listingId);
    newUser = result.user;
    if (!result.added) continue;
    await recordFavoriteCounterSideEffect(
      'Listing favorite counter increment',
      () => addFavorite(listingId.toHexString(), id),
    );
  }

  return newUser;
};

export const deleteFavListings = async (id: any, removedListings: [mongoose.Types.ObjectId]) => {
  const listingIds = normalizeObjectIdsForUserMutation(removedListings, 'favListings');
  const visibleListings = await readPublicListings(listingIds);
  const visibleListingIds = normalizeObjectIdsForUserMutation(
    visibleListings.map((listing) => listing._id),
    'favListings',
  );
  let newUser = await readUser(id);

  for (const listingId of visibleListingIds) {
    const result = await removeFavoriteObjectIdIfPresent(id, 'favListings', listingId);
    newUser = result.user;
    if (!result.removed) continue;
    await recordFavoriteCounterSideEffect(
      'Listing favorite counter decrement',
      () => removeFavorite(listingId.toHexString(), id),
    );
  }

  newUser = await removeFavoriteObjectIdsWithoutCounters(id, 'favListings', listingIds);

  return newUser;
};

export const clearFavListings = async (id: any) => {
  const newUser = await updateUser(id, { favListings: [] });

  return newUser;
};

export const addFavFellowships = async (id: any, fellowships: mongoose.Types.ObjectId[]) => {
  const fellowshipIds = normalizeObjectIdsForUserMutation(fellowships, 'favFellowships');
  const visibleFellowships = await readFellowships(fellowshipIds);
  const visibleFellowshipIds = normalizeObjectIdsForUserMutation(
    visibleFellowships.map((fellowship) => fellowship._id),
    'favFellowships',
  );
  let newUser = await readUser(id);

  for (const fellowshipId of visibleFellowshipIds) {
    const result = await addFavoriteObjectIdIfMissing(id, 'favFellowships', fellowshipId);
    newUser = result.user;
    if (!result.added) continue;
    await recordFavoriteCounterSideEffect(
      'Fellowship favorite counter increment',
      () => addFellowshipFavorite(fellowshipId.toHexString()),
    );
  }

  return newUser;
};

export const deleteFavFellowships = async (
  id: any,
  removedFellowships: mongoose.Types.ObjectId[],
) => {
  const fellowshipIds = normalizeObjectIdsForUserMutation(removedFellowships, 'favFellowships');
  const visibleFellowships = await readFellowships(fellowshipIds);
  const visibleFellowshipIds = normalizeObjectIdsForUserMutation(
    visibleFellowships.map((fellowship) => fellowship._id),
    'favFellowships',
  );
  let newUser = await readUser(id);

  for (const fellowshipId of visibleFellowshipIds) {
    const result = await removeFavoriteObjectIdIfPresent(id, 'favFellowships', fellowshipId);
    newUser = result.user;
    if (!result.removed) continue;
    await recordFavoriteCounterSideEffect(
      'Fellowship favorite counter decrement',
      () => removeFellowshipFavorite(fellowshipId.toHexString()),
    );
  }

  newUser = await removeFavoriteObjectIdsWithoutCounters(id, 'favFellowships', fellowshipIds);

  return newUser;
};

export const clearFavFellowships = async (id: any) => {
  const newUser = await updateUser(id, { favFellowships: [] });

  return newUser;
};

export const addFavPathways = async (id: any, pathways: [mongoose.Types.ObjectId]) => {
  const pathwayIds = normalizeObjectIdsForUserMutation(pathways, 'favPathways');
  const visiblePathways = await getPathwaysByIds(pathwayIds.map((pathwayId) => pathwayId.toHexString()));
  const visiblePathwayIds = normalizeObjectIdsForUserMutation(
    visiblePathways.map((pathway) => pathway._id),
    'favPathways',
  );
  let newUser = await readUser(id);

  for (const pathwayId of visiblePathwayIds) {
    const result = await addFavoriteObjectIdIfMissing(id, 'favPathways', pathwayId);
    newUser = result.user;
  }

  return newUser;
};

export const deleteFavPathways = async (
  id: any,
  removedPathways: [mongoose.Types.ObjectId],
) => {
  const pathwayIds = normalizeObjectIdsForUserMutation(removedPathways, 'favPathways');
  const newUser = await removeSavedPathwayIdsAndPlans(id, pathwayIds);

  return newUser;
};

export const clearFavPathways = async (id: any) => {
  const newUser = await updateUser(id, { favPathways: [], savedPathwayPlans: {} });

  return newUser;
};

export const getSavedPathwayPlans = async (id: any) => {
  const user = await readUser(id);
  const savedPathwayPlans = sanitizeSavedPathwayPlansForResponse(user.savedPathwayPlans);
  const visiblePathways = await getPathwaysByIds(Object.keys(savedPathwayPlans));
  return pruneSavedPathwayPlansForExistingPathways(
    savedPathwayPlans,
    visiblePathways.map((pathway) => pathway._id),
  );
};

export const exportSavedPathwayPlans = async (
  id: any,
  options: SavedPathwayPlansExportOptions = {},
) => {
  const user = await readUser(id);
  const pathwayIds = storedObjectIdStringsForUserMutation(user.favPathways, 'favPathways');
  const pathways = await getPathwaysByIds(pathwayIds);

  return buildSavedPathwayPlansExport(pathways, user.savedPathwayPlans || {}, options);
};

export const updateSavedPathwayPlan = async (
  id: any,
  pathwayId: string,
  plan: SavedPathwayPlanInput,
) => {
  const [normalizedPathwayId] = normalizeObjectIdsForUserMutation([pathwayId], 'pathway');
  const pathwayKey = normalizedPathwayId.toString();
  const [visiblePathway] = await getPathwaysByIds([pathwayKey]);
  if (!visiblePathway) {
    throw new NotFoundError('Pathway not found');
  }
  const sanitized = sanitizeSavedPathwayPlanForStorage(plan);
  const user = await updateUser(id, {
    $set: {
      [`savedPathwayPlans.${pathwayKey}`]: sanitized,
    },
  });
  return sanitizeSavedPathwayPlansForResponse(user.savedPathwayPlans);
};

export const deleteSavedPathwayPlan = async (id: any, pathwayId: string) => {
  const [normalizedPathwayId] = normalizeObjectIdsForUserMutation([pathwayId], 'pathway');
  const pathwayKey = normalizedPathwayId.toString();
  const user = await updateUser(id, {
    $unset: {
      [`savedPathwayPlans.${pathwayKey}`]: '',
    },
  });
  return sanitizeSavedPathwayPlansForResponse(user.savedPathwayPlans);
};
