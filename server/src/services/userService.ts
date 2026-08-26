/**
 * Service layer for user account CRUD and owned-listing management.
 */
import { User } from '../models/index';
import { NotFoundError } from '../utils/errors';
import {
  readListing,
  confirmListing,
  unconfirmListing,
} from './listingService';
import mongoose from 'mongoose';
import { escapeRegex } from '../utils/regex';

const MAX_ACCOUNT_MUTATION_IDS = 100;
const MAX_USER_UPDATE_VALUE_DEPTH = 20;
const MAX_USER_UPDATE_VALUE_ARRAY_ITEMS = 200;
const MAX_USER_UPDATE_VALUE_OBJECT_KEYS = 200;
const NETID_LOOKUP_RE = /^[A-Za-z0-9]{2,12}$/;
const USER_UPDATE_OPERATORS = new Set(['$set', '$unset', '$addToSet']);
const USER_UPDATE_PATH_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

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

export function normalizeObjectIdStringForUserMutation(value: unknown, fieldName: string): string {
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

export const createUser = async (userData: any) => {
  const user = new User(userData);
  await user.save();
  return user.toObject();
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
    const user = await User.findByIdAndUpdate(objectId, safeData, {
      new: true,
      runValidators: true,
    });
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user.toObject();
  } else {
    const netidFilter = buildCaseInsensitiveNetidFilter(id);
    const user = await User.findOneAndUpdate(netidFilter, safeData, {
      new: true,
      runValidators: true,
    });
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user.toObject();
  }
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


