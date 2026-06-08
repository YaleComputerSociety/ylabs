/**
 * Service layer for user account CRUD and favorites management.
 */
import { User } from '../models/index';
import { NotFoundError } from '../utils/errors';
import {
  readListing,
  confirmListing,
  unconfirmListing,
  addFavorite,
  removeFavorite,
} from './listingService';
import {
  addFavorite as addFellowshipFavorite,
  removeFavorite as removeFellowshipFavorite,
} from './fellowshipService';
import { getPathwaysByIds, type PathwaySearchHit } from './pathwaySearchService';
import mongoose from 'mongoose';
import { escapeRegex } from '../utils/regex';
import { isPublicHttpUrl } from '../utils/urlSafety';

const PLANNING_INTENTS = new Set(['thesis', 'outreach', 'credit', 'funding', 'apply', 'later']);
const PLANNING_STAGES = new Set(['saved', 'researching', 'ready', 'acted', 'archived']);
const MAX_ACCOUNT_MUTATION_IDS = 100;
const MAX_SAVED_PATHWAY_CHECKLIST_ITEMS = 50;
const MAX_SAVED_PATHWAY_CHECKLIST_KEY_LENGTH = 120;

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

export function sanitizeSavedPathwayPlanForStorage(
  plan: unknown,
): Required<SavedPathwayPlanInput> {
  const candidate =
    plan && typeof plan === 'object' ? (plan as SavedPathwayPlanInput) : {};
  const checklist = Object.fromEntries(
    Object.entries(candidate.checklist || {})
      .filter(
        ([key]) =>
          typeof key === 'string' &&
          key.length > 0 &&
          key.length <= MAX_SAVED_PATHWAY_CHECKLIST_KEY_LENGTH,
      )
      .slice(0, MAX_SAVED_PATHWAY_CHECKLIST_ITEMS)
      .map(([key, value]) => [key, value === true]),
  );

  return {
    intent:
      candidate.intent && PLANNING_INTENTS.has(candidate.intent) ? candidate.intent : 'later',
    stage: candidate.stage && PLANNING_STAGES.has(candidate.stage) ? candidate.stage : 'saved',
    note: typeof candidate.note === 'string' ? candidate.note.slice(0, 5000) : '',
    checklist,
  };
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
        title: pathway.studentFacingLabel,
        researchEntity: {
          id: pathway.researchEntity._id,
          slug: pathway.researchEntity.slug,
          name: pathway.researchEntity.displayName || pathway.researchEntity.name,
        },
        intent: plan.intent,
        stage: plan.stage,
        checklist: plan.checklist as Record<string, boolean>,
        sourceLinks: sourceLinksForPathwayExport(pathway),
        bestNextStepCategory: pathway.bestNextStepCategory,
      };

      if (includePrivateNotes && plan.note) {
        item.privateNote = plan.note;
      }

      return item;
    }),
  };
};

export function pruneSavedPathwayPlansForExistingPathways(
  savedPathwayPlans: Record<string, SavedPathwayPlanInput | undefined> = {},
  pathwayIds: Array<string | mongoose.Types.ObjectId>,
): Record<string, SavedPathwayPlanInput | undefined> {
  const validIds = new Set(pathwayIds.map((id) => String(id)));
  return Object.fromEntries(
    Object.entries(savedPathwayPlans).filter(([pathwayId]) => validIds.has(pathwayId)),
  );
}

export function buildSavedPathwayPlanUnsetForIds(
  pathwayIds: Array<string | mongoose.Types.ObjectId>,
): Record<string, ''> {
  return Object.fromEntries(
    pathwayIds
      .map((pathwayId) => String(pathwayId))
      .filter((pathwayId) => pathwayId.length > 0)
      .map((pathwayId) => [`savedPathwayPlans.${pathwayId}`, '']),
  );
}

const badRequestError = (message: string) => {
  const error: any = new Error(message);
  error.status = 400;
  return error;
};

export function normalizeObjectIdsForUserMutation(
  values: unknown[],
  fieldName: string,
): mongoose.Types.ObjectId[] {
  if (values.length > MAX_ACCOUNT_MUTATION_IDS) {
    throw badRequestError(`Too many ${fieldName} ids`);
  }

  return values.map((value) => {
    const id = String(value || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(id)) {
      throw badRequestError(`Invalid ${fieldName} id`);
    }
    return new mongoose.Types.ObjectId(id);
  });
}

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
  netid: { $regex: `^${escapeRegex(String(id ?? ''))}$`, $options: 'i' },
});

export const readUser = async (id: any) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    const user = await User.findById(id);
    if (!user) {
      throw new NotFoundError(`User not found with ObjectId: ${id}`);
    }
    return user.toObject();
  } else {
    const user = await User.findOne(buildCaseInsensitiveNetidFilter(id));
    if (!user) {
      throw new NotFoundError(`User not found with NetId: ${id}`);
    }
    return user.toObject();
  }
};

export const validateUser = async (id: any) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    const user = await User.findById(id);
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
  if (mongoose.Types.ObjectId.isValid(id)) {
    const user = await User.findById(id);
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
  if (mongoose.Types.ObjectId.isValid(id)) {
    const user = await User.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!user) {
      throw new NotFoundError(`User not found with ObjectId: ${id}`);
    }
    return user.toObject();
  } else {
    const user = await User.findOneAndUpdate(
      buildCaseInsensitiveNetidFilter(id),
      data,
      { new: true, runValidators: true },
    );
    if (!user) {
      throw new NotFoundError(`User not found with NetId: ${id}`);
    }
    return user.toObject();
  }
};

export const confirmUser = async (id: any) => {
  const user = await updateUser(id, { userConfirmed: true });
  for (const id of user.ownListings) {
    const listing = await readListing(id);
    if (listing && listing.ownerId === user.netid) {
      await confirmListing(id, user.netid);
    }
  }
  return user;
};

export const unconfirmUser = async (id: any) => {
  const user = await updateUser(id, { userConfirmed: false });
  for (const id of user.ownListings) {
    const listing = await readListing(id);
    if (listing && listing.ownerId === user.netid) {
      await unconfirmListing(id, user.netid);
    }
  }
  return user;
};

export const deleteUser = async (id: any) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    const user = await User.findById(id);
    if (!user) {
      throw new NotFoundError(`User not found with ObjectId: ${id}`);
    }

    await User.findByIdAndDelete(id);

    return user.toObject();
  } else {
    const user = await User.findOne(buildCaseInsensitiveNetidFilter(id));
    if (!user) {
      throw new NotFoundError(`User not found with NetId: ${id}`);
    }
    await User.findOneAndDelete(buildCaseInsensitiveNetidFilter(id));
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

  user.ownListings.unshift(...Listings);
  user.ownListings = Array.from(
    new Set(user.ownListings.map((listing: any) => listing.toString())),
  ).map((listing) => new mongoose.Types.ObjectId(listing as string));

  const newUser = await updateUser(id, { ownListings: user.ownListings });

  return newUser;
};

export const deleteOwnListings = async (id: any, removedListings: [mongoose.Types.ObjectId]) => {
  const user = await readUser(id);

  const removedListingsStrings = removedListings.map((listing) => listing.toString());

  user.ownListings = user.ownListings.filter(
    (listing: any) => removedListingsStrings.indexOf(listing.toString()) < 0,
  );

  const newUser = await updateUser(id, { ownListings: user.ownListings });

  return newUser;
};

export const clearOwnListings = async (id: any) => {
  const newUser = await updateUser(id, { ownListings: [] });

  return newUser;
};

export const addFavListings = async (id: any, Listings: [mongoose.Types.ObjectId]) => {
  const user = await readUser(id);
  const listingIds = normalizeObjectIdsForUserMutation(Listings, 'favListings');

  user.favListings.unshift(...listingIds);
  user.favListings = Array.from(
    new Set(user.favListings.map((listing: any) => listing.toString())),
  ).map((listing: string) => new mongoose.Types.ObjectId(listing));

  const newUser = await updateUser(id, { favListings: user.favListings });

  for (const listingId of listingIds) {
    await addFavorite(listingId.toString(), id);
  }

  return newUser;
};

export const deleteFavListings = async (id: any, removedListings: [mongoose.Types.ObjectId]) => {
  const user = await readUser(id);
  const listingIds = normalizeObjectIdsForUserMutation(removedListings, 'favListings');

  const removedListingsStrings = listingIds.map((listing) => listing.toString());

  user.favListings = user.favListings.filter(
    (listing: any) => removedListingsStrings.indexOf(listing.toString()) < 0,
  );

  const newUser = await updateUser(id, { favListings: user.favListings });

  for (const listingId of listingIds) {
    await removeFavorite(listingId.toString(), id);
  }

  return newUser;
};

export const clearFavListings = async (id: any) => {
  const newUser = await updateUser(id, { favListings: [] });

  return newUser;
};

export const addFavFellowships = async (id: any, fellowships: mongoose.Types.ObjectId[]) => {
  const user = await readUser(id);
  const fellowshipIds = normalizeObjectIdsForUserMutation(fellowships, 'favFellowships');

  user.favFellowships.unshift(...fellowshipIds);
  user.favFellowships = Array.from(new Set(user.favFellowships.map((f: any) => f.toString()))).map(
    (f: string) => new mongoose.Types.ObjectId(f),
  ) as mongoose.Types.ObjectId[];

  const newUser = await updateUser(id, { favFellowships: user.favFellowships });

  for (const fellowshipId of fellowshipIds) {
    await addFellowshipFavorite(fellowshipId.toString());
  }

  return newUser;
};

export const deleteFavFellowships = async (
  id: any,
  removedFellowships: mongoose.Types.ObjectId[],
) => {
  const user = await readUser(id);
  const fellowshipIds = normalizeObjectIdsForUserMutation(removedFellowships, 'favFellowships');

  const removedFellowshipsStrings = fellowshipIds.map((f) => f.toString());

  user.favFellowships = user.favFellowships.filter(
    (f: any) => removedFellowshipsStrings.indexOf(f.toString()) < 0,
  );

  const newUser = await updateUser(id, { favFellowships: user.favFellowships });

  for (const fellowshipId of fellowshipIds) {
    await removeFellowshipFavorite(fellowshipId.toString());
  }

  return newUser;
};

export const clearFavFellowships = async (id: any) => {
  const newUser = await updateUser(id, { favFellowships: [] });

  return newUser;
};

export const addFavPathways = async (id: any, pathways: [mongoose.Types.ObjectId]) => {
  const user = await readUser(id);
  const pathwayIds = normalizeObjectIdsForUserMutation(pathways, 'favPathways');

  user.favPathways = user.favPathways || [];
  user.favPathways.unshift(...pathwayIds);
  user.favPathways = Array.from(new Set(user.favPathways.map((p: any) => p.toString()))).map(
    (p: string) => new mongoose.Types.ObjectId(p),
  ) as mongoose.Types.ObjectId[];

  const newUser = await updateUser(id, { favPathways: user.favPathways });

  return newUser;
};

export const deleteFavPathways = async (
  id: any,
  removedPathways: [mongoose.Types.ObjectId],
) => {
  const user = await readUser(id);
  const pathwayIds = normalizeObjectIdsForUserMutation(removedPathways, 'favPathways');

  const removedPathwayStrings = pathwayIds.map((p) => p.toString());

  user.favPathways = (user.favPathways || []).filter(
    (p: any) => removedPathwayStrings.indexOf(p.toString()) < 0,
  );

  const unset = buildSavedPathwayPlanUnsetForIds(removedPathwayStrings);
  const update =
    Object.keys(unset).length > 0
      ? { $set: { favPathways: user.favPathways }, $unset: unset }
      : { favPathways: user.favPathways };
  const newUser = await updateUser(id, update);

  return newUser;
};

export const clearFavPathways = async (id: any) => {
  const newUser = await updateUser(id, { favPathways: [], savedPathwayPlans: {} });

  return newUser;
};

export const getSavedPathwayPlans = async (id: any) => {
  const user = await readUser(id);
  return user.savedPathwayPlans || {};
};

export const exportSavedPathwayPlans = async (
  id: any,
  options: SavedPathwayPlansExportOptions = {},
) => {
  const user = await readUser(id);
  const pathwayIds = (user.favPathways || []).map((pathwayId: mongoose.Types.ObjectId | string) =>
    pathwayId.toString(),
  );
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
  const sanitized = sanitizeSavedPathwayPlanForStorage(plan);
  const user = await updateUser(id, {
    $set: {
      [`savedPathwayPlans.${pathwayKey}`]: sanitized,
    },
  });
  return user.savedPathwayPlans || {};
};

export const deleteSavedPathwayPlan = async (id: any, pathwayId: string) => {
  const [normalizedPathwayId] = normalizeObjectIdsForUserMutation([pathwayId], 'pathway');
  const pathwayKey = normalizedPathwayId.toString();
  const user = await updateUser(id, {
    $unset: {
      [`savedPathwayPlans.${pathwayKey}`]: '',
    },
  });
  return user.savedPathwayPlans || {};
};
