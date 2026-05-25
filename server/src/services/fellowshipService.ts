/**
 * Service layer for fellowship CRUD, search, and filter operations.
 */
import { NotFoundError, ObjectIdError } from '../utils/errors';
import mongoose from 'mongoose';
import { Fellowship } from '../models/fellowship';
import {
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import * as itemOps from './itemOperations';

export interface FellowshipReadOptions {
  includeNonPublic?: boolean;
}

const publicFellowshipFilter = (options: FellowshipReadOptions = {}) =>
  options.includeNonPublic
    ? {}
    : { studentVisibilityTier: { $in: publicStudentVisibilityTiers } };

export const createFellowship = async (data: any) => {
  const fellowship = new Fellowship(data);
  await fellowship.save();
  return fellowship.toObject();
};

export const readFellowship = async (id: any, options: FellowshipReadOptions = {}) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    const fellowship = await Fellowship.findOne({
      _id: id,
      archived: false,
      ...publicFellowshipFilter(options),
    });
    if (!fellowship) {
      throw new NotFoundError(`Fellowship not found with ObjectId: ${id}`);
    }
    return fellowship.toObject();
  } else {
    throw new ObjectIdError('Did not receive expected id type ObjectId');
  }
};

export const readFellowships = async (ids: any[], options: FellowshipReadOptions = {}) => {
  const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) return [];

  const fellowships = await Fellowship.find({
    _id: { $in: validIds },
    archived: false,
    ...publicFellowshipFilter(options),
  });
  return fellowships.map((fellowship: any) => fellowship.toObject());
};

export const readAllFellowships = async () => {
  const fellowships = await Fellowship.find({
    archived: false,
    ...publicFellowshipFilter(),
  });
  return fellowships.map((fellowship: any) => fellowship.toObject());
};

export const fellowshipExists = async (id: any) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    const fellowship = await Fellowship.findById(id);
    return !!fellowship;
  } else {
    throw new ObjectIdError('Did not receive expected id type ObjectId');
  }
};

const FELLOWSHIP_ADMIN_UPDATABLE_FIELDS = [
  'title',
  'programCategory',
  'programKind',
  'entryMode',
  'studentFacingCategory',
  'requiresMentorBeforeApply',
  'mentorMatching',
  'undergraduateOnly',
  'yaleCollegeOnly',
  'compensationSummary',
  'hoursPerWeek',
  'programDates',
  'bestNextStep',
  'prepSteps',
  'competitionType',
  'summary',
  'description',
  'applicationInformation',
  'eligibility',
  'restrictionsToUseOfAward',
  'additionalInformation',
  'links',
  'applicationLink',
  'awardAmount',
  'isAcceptingApplications',
  'applicationOpenDate',
  'deadline',
  'contactName',
  'contactEmail',
  'contactPhone',
  'contactOffice',
  'yearOfStudy',
  'termOfAward',
  'purpose',
  'globalRegions',
  'citizenshipStatus',
  'sourceName',
  'sourceUrl',
  'sourceKey',
  'sourceFingerprint',
  'sourceLastVerifiedAt',
  'sourceLastChangedAt',
  'studentVisibilityTier',
  'studentVisibilityComputedTier',
  'studentVisibilityOverrideTier',
  'studentVisibilityReasons',
  'studentVisibilitySuppressionReason',
  'studentVisibilityComputedAt',
  'studentVisibilityVersion',
  'studentVisibilityReviewedAt',
  'studentVisibilityReviewedByUserId',
  'archived',
  'audited',
] as const;

const filterFellowshipUpdate = (data: any): Record<string, any> => {
  const update: Record<string, any> = {};
  if (!data || typeof data !== 'object') return update;
  for (const field of FELLOWSHIP_ADMIN_UPDATABLE_FIELDS) {
    if (data[field] !== undefined) {
      update[field] = data[field];
    }
  }
  return update;
};

export const updateFellowship = async (id: any, data: any) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    const safeData = filterFellowshipUpdate(data);
    const fellowship = await Fellowship.findByIdAndUpdate(id, safeData, {
      new: true,
      runValidators: true,
    });

    if (!fellowship) {
      throw new NotFoundError(`Fellowship not found with ObjectId: ${id}`);
    }

    return fellowship.toObject();
  } else {
    throw new ObjectIdError('Did not receive expected id type ObjectId');
  }
};

export const archiveFellowship = async (id: any) => {
  return await updateFellowship(id, { archived: true });
};

export const unarchiveFellowship = async (id: any) => {
  return await updateFellowship(id, { archived: false });
};

export const addView = async (id: any) => {
  return itemOps.addView(Fellowship, id);
};

export const addFavorite = async (id: any) => {
  return itemOps.addFavorite(Fellowship, id);
};

export const removeFavorite = async (id: any) => {
  return itemOps.removeFavorite(Fellowship, id);
};

export const deleteFellowship = async (id: any) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    const fellowship = await Fellowship.findById(id);
    if (!fellowship) {
      throw new NotFoundError(`Fellowship not found with ObjectId: ${id}`);
    }
    await Fellowship.findByIdAndDelete(id);
  } else {
    throw new ObjectIdError('Did not receive expected id type ObjectId');
  }
};

export const searchFellowships = async (params: {
  query?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: number;
  yearOfStudy?: string[];
  termOfAward?: string[];
  purpose?: string[];
  globalRegions?: string[];
  citizenshipStatus?: string[];
  programCategory?: string[];
  programKind?: string[];
  entryMode?: string[];
  studentFacingCategory?: string[];
  requiresMentorBeforeApply?: boolean;
  mentorMatching?: boolean;
  undergraduateOnly?: boolean;
  yaleCollegeOnly?: boolean;
  studentVisibilityTier?: StudentVisibilityTier[];
  includeNonPublic?: boolean;
  includeOperatorReview?: boolean;
  includeSuppressed?: boolean;
}) => {
  const {
    query = '',
    page = 1,
    pageSize = 20,
    sortBy = 'updatedAt',
    sortOrder = -1,
    yearOfStudy = [],
    termOfAward = [],
    purpose = [],
    globalRegions = [],
    citizenshipStatus = [],
    programCategory = [],
    programKind = [],
    entryMode = [],
    studentFacingCategory = [],
    requiresMentorBeforeApply,
    mentorMatching,
    undergraduateOnly,
    yaleCollegeOnly,
    studentVisibilityTier = [],
    includeNonPublic = false,
    includeOperatorReview = false,
    includeSuppressed = false,
  } = params;

  const filter: any = { archived: false };
  if (includeNonPublic && studentVisibilityTier.length > 0) {
    filter.studentVisibilityTier = { $in: studentVisibilityTier };
  } else if (includeNonPublic && includeSuppressed) {
    // Admin/operator mode: keep all archived=false tiers in scope.
  } else if (includeNonPublic && includeOperatorReview) {
    filter.studentVisibilityTier = {
      $in: [...publicStudentVisibilityTiers, 'operator_review'],
    };
  } else {
    filter.studentVisibilityTier = { $in: publicStudentVisibilityTiers };
  }

  if (query && query.trim()) {
    filter.$text = { $search: query };
  }

  if (yearOfStudy.length > 0) {
    filter.yearOfStudy = { $in: yearOfStudy };
  }
  if (termOfAward.length > 0) {
    filter.termOfAward = { $in: termOfAward };
  }
  if (purpose.length > 0) {
    filter.purpose = { $in: purpose };
  }
  if (globalRegions.length > 0) {
    filter.globalRegions = { $in: globalRegions };
  }
  if (citizenshipStatus.length > 0) {
    filter.citizenshipStatus = { $in: citizenshipStatus };
  }
  if (programCategory.length > 0) {
    filter.programCategory = { $in: programCategory };
  }
  if (programKind.length > 0) {
    filter.programKind = { $in: programKind };
  }
  if (entryMode.length > 0) {
    filter.entryMode = { $in: entryMode };
  }
  if (studentFacingCategory.length > 0) {
    filter.studentFacingCategory = { $in: studentFacingCategory };
  }
  if (typeof requiresMentorBeforeApply === 'boolean') {
    filter.requiresMentorBeforeApply = requiresMentorBeforeApply;
  }
  if (typeof mentorMatching === 'boolean') {
    filter.mentorMatching = mentorMatching;
  }
  if (typeof undergraduateOnly === 'boolean') {
    filter.undergraduateOnly = undergraduateOnly;
  }
  if (typeof yaleCollegeOnly === 'boolean') {
    filter.yaleCollegeOnly = yaleCollegeOnly;
  }

  const sortOptions: any = {};
  if (query && query.trim()) {
    sortOptions.score = { $meta: 'textScore' };
  }
  sortOptions[sortBy] = sortOrder;

  const skip = (page - 1) * pageSize;

  let fellowshipsQuery = Fellowship.find(filter);

  if (query && query.trim()) {
    fellowshipsQuery = fellowshipsQuery.select({ score: { $meta: 'textScore' } });
  }

  const [fellowships, total] = await Promise.all([
    fellowshipsQuery.sort(sortOptions).skip(skip).limit(pageSize).lean(),
    Fellowship.countDocuments(filter),
  ]);

  return {
    fellowships,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
};

export const getFilterOptions = async () => {
  const visibleFilter = {
    archived: false,
    ...publicFellowshipFilter(),
  };
  const [
    yearOfStudyOptions,
    termOfAwardOptions,
    purposeOptions,
    globalRegionsOptions,
    citizenshipStatusOptions,
    programCategoryOptions,
    programKindOptions,
    entryModeOptions,
    studentFacingCategoryOptions,
  ] = await Promise.all([
    Fellowship.distinct('yearOfStudy', visibleFilter),
    Fellowship.distinct('termOfAward', visibleFilter),
    Fellowship.distinct('purpose', visibleFilter),
    Fellowship.distinct('globalRegions', visibleFilter),
    Fellowship.distinct('citizenshipStatus', visibleFilter),
    Fellowship.distinct('programCategory', visibleFilter),
    Fellowship.distinct('programKind', visibleFilter),
    Fellowship.distinct('entryMode', visibleFilter),
    Fellowship.distinct('studentFacingCategory', visibleFilter),
  ]);

  return {
    yearOfStudy: yearOfStudyOptions.filter(Boolean).sort(),
    termOfAward: termOfAwardOptions.filter(Boolean).sort(),
    purpose: purposeOptions.filter(Boolean).sort(),
    globalRegions: globalRegionsOptions.filter(Boolean).sort(),
    citizenshipStatus: citizenshipStatusOptions.filter(Boolean).sort(),
    programCategory: programCategoryOptions.filter(Boolean).sort(),
    programKind: programKindOptions.filter(Boolean).sort(),
    entryMode: entryModeOptions.filter(Boolean).sort(),
    studentFacingCategory: studentFacingCategoryOptions.filter(Boolean).sort(),
  };
};

export const bulkCreateFellowships = async (fellowships: any[]) => {
  const result = await Fellowship.insertMany(fellowships);
  return result.map((f: any) => f.toObject());
};
