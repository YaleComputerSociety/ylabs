/**
 * Service layer for fellowship CRUD, search, and filter operations.
 */
import { NotFoundError, ObjectIdError } from '../utils/errors';
import {
  Fellowship,
  programCategories,
  programEntryModes,
  programKinds,
} from '../models/fellowship';
import {
  isStudentVisibilityTier,
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import * as itemOps from './itemOperations';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import { publicHttpUrl } from '../utils/urlSafety';
import {
  inferProgramSubjects,
  PROGRAM_TOPIC_TAXONOMY,
  resolveTopicSubjects,
  topicAliasesForSubjects,
  topicRegexForSubjects,
} from './programTopicService';

export interface FellowshipReadOptions {
  includeNonPublic?: boolean;
}

const PUBLIC_FELLOWSHIP_SORT_FIELDS = new Set([
  'title',
  'deadline',
  'applicationOpenDate',
  'views',
  'favorites',
]);
const OPERATOR_FELLOWSHIP_SORT_FIELDS = new Set([
  ...PUBLIC_FELLOWSHIP_SORT_FIELDS,
  'updatedAt',
  'createdAt',
]);
const DEFAULT_PUBLIC_FELLOWSHIP_SORT_FIELD = 'deadline';
const MAX_SEARCH_PAGE = 1000;
const MAX_SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_QUERY_LENGTH = 512;
const MAX_SEARCH_FILTER_VALUES = 50;
const MAX_SEARCH_FILTER_VALUE_LENGTH = 120;
const MAX_SEARCH_PAGINATION_PARAM_LENGTH = 16;
const MAX_PUBLIC_FELLOWSHIP_TEXT_LENGTH = 5000;
const MAX_PUBLIC_FELLOWSHIP_ARRAY_ITEMS = 50;
const MAX_PUBLIC_FELLOWSHIP_LINKS = 50;
const MAX_FELLOWSHIP_ID_READS = 100;
const MAX_ADMIN_FELLOWSHIP_NUMBER = 1_000_000;
const MONGO_OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const POSITIVE_INTEGER_PARAM_RE = /^[1-9]\d*$/;
const PROGRAM_CATEGORIES = new Set<string>(programCategories);
const PROGRAM_KINDS = new Set<string>(programKinds);
const PROGRAM_ENTRY_MODES = new Set<string>(programEntryModes);

const normalizeFellowshipObjectId = (id: unknown): string | undefined => {
  const value = serializedDocumentId(id);
  return value && MONGO_OBJECT_ID_RE.test(value) ? value : undefined;
};

const publicFellowshipSortField = (value: unknown, includeNonPublic = false): string => {
  const allowedFields = includeNonPublic
    ? OPERATOR_FELLOWSHIP_SORT_FIELDS
    : PUBLIC_FELLOWSHIP_SORT_FIELDS;
  return typeof value === 'string' && allowedFields.has(value)
    ? value
    : DEFAULT_PUBLIC_FELLOWSHIP_SORT_FIELD;
};

const numericSearchParam = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }

  const raw = value.trim();
  if (!raw || raw.length > MAX_SEARCH_PAGINATION_PARAM_LENGTH) return undefined;
  if (!POSITIVE_INTEGER_PARAM_RE.test(raw)) return undefined;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const publicFellowshipSortOrder = (value: unknown): 1 | -1 =>
  numericSearchParam(value) === 1 ? 1 : -1;

const boundedSearchQuery = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
};

const boundedSearchFilterValues = (values?: unknown[]): string[] => {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const clean: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const boundedValue = value.trim().slice(0, MAX_SEARCH_FILTER_VALUE_LENGTH);
    if (!boundedValue || seen.has(boundedValue)) continue;
    seen.add(boundedValue);
    clean.push(boundedValue);
    if (clean.length >= MAX_SEARCH_FILTER_VALUES) break;
  }

  return clean;
};

const publicFellowshipFilter = (options: FellowshipReadOptions = {}) =>
  options.includeNonPublic ? {} : { studentVisibilityTier: { $in: publicStudentVisibilityTiers } };

const PUBLIC_FELLOWSHIP_TEXT_FIELDS = new Set([
  'compensationSummary',
  'programDates',
  'bestNextStep',
  'title',
  'competitionType',
  'summary',
  'description',
  'applicationInformation',
  'eligibility',
  'restrictionsToUseOfAward',
  'additionalInformation',
  'contactOffice',
  'sourceName',
]);

const PUBLIC_FELLOWSHIP_FIELDS = [
  '_id',
  'id',
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
  'title',
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
  'contactOffice',
  'yearOfStudy',
  'termOfAward',
  'purpose',
  'globalRegions',
  'citizenshipStatus',
  'sourceName',
  'sourceUrl',
] as const;

const PUBLIC_FELLOWSHIP_PRIMITIVE_FIELDS = new Set([
  '_id',
  'id',
  'programCategory',
  'programKind',
  'entryMode',
  'studentFacingCategory',
  'requiresMentorBeforeApply',
  'mentorMatching',
  'undergraduateOnly',
  'yaleCollegeOnly',
  'hoursPerWeek',
  'awardAmount',
  'isAcceptingApplications',
  'applicationOpenDate',
  'deadline',
  'yearOfStudy',
  'termOfAward',
  'purpose',
  'globalRegions',
  'citizenshipStatus',
]);

const boundedPublicText = (value: string): string =>
  value.slice(0, MAX_PUBLIC_FELLOWSHIP_TEXT_LENGTH).trim();

const publicFellowshipLinks = (links: unknown): Array<{ label?: string; url: string }> =>
  Array.isArray(links)
    ? links.slice(0, MAX_PUBLIC_FELLOWSHIP_LINKS).flatMap((link) => {
        if (!link || typeof link !== 'object') return [];
        const record = link as Record<string, unknown>;
        const url = publicHttpUrl(record.url);
        if (!url) return [];
        const label =
          typeof record.label === 'string' && boundedPublicText(record.label)
            ? redactDirectContactInfo(boundedPublicText(record.label))
            : undefined;
        return [{ ...(label ? { label } : {}), url }];
      })
    : [];

const adminFellowshipText = (value: unknown): string | undefined =>
  typeof value === 'string' ? redactDirectContactInfo(boundedPublicText(value)) : undefined;

const adminFellowshipStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, MAX_PUBLIC_FELLOWSHIP_ARRAY_ITEMS).flatMap((item) => {
    const text = adminFellowshipText(item);
    return text ? [text] : [];
  });
};

const adminFellowshipLinks = (
  value: unknown,
): Array<{ label?: string; url: string }> | undefined =>
  Array.isArray(value) ? publicFellowshipLinks(value) : undefined;

const adminFellowshipDate = (value: unknown): Date | undefined => {
  if (value === null || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const adminFellowshipNumber = (
  value: unknown,
  { min = 0, max = MAX_ADMIN_FELLOWSHIP_NUMBER }: { min?: number; max?: number } = {},
): number | undefined => {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < min || number > max) return undefined;
  return Math.trunc(number);
};

const publicFellowshipField = (field: string, value: unknown): unknown => {
  if (field === 'applicationLink' || field === 'sourceUrl') return publicHttpUrl(value);

  if (field === 'links') return publicFellowshipLinks(value);

  if (PUBLIC_FELLOWSHIP_TEXT_FIELDS.has(field)) {
    return typeof value === 'string'
      ? redactDirectContactInfo(boundedPublicText(value))
      : undefined;
  }

  if (field === 'prepSteps' && Array.isArray(value)) {
    return value
      .slice(0, MAX_PUBLIC_FELLOWSHIP_ARRAY_ITEMS)
      .flatMap((item) =>
        typeof item === 'string' ? [redactDirectContactInfo(boundedPublicText(item))] : [],
      );
  }

  if (PUBLIC_FELLOWSHIP_PRIMITIVE_FIELDS.has(field)) {
    if (field === '_id') return serializedDocumentId(value);
    if (typeof value === 'string') return boundedPublicText(value);
    if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date)
      return value;
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_PUBLIC_FELLOWSHIP_ARRAY_ITEMS)
        .flatMap((item) => (typeof item === 'string' ? [boundedPublicText(item)] : []));
    }
    return undefined;
  }

  return value;
};

export const publicFellowshipForStudent = (fellowship: any) => {
  if (!fellowship || typeof fellowship !== 'object') return fellowship;

  const publicFellowship: Record<string, any> = {};
  for (const field of PUBLIC_FELLOWSHIP_FIELDS) {
    if (fellowship[field] !== undefined) {
      publicFellowship[field] = publicFellowshipField(field, fellowship[field]);
    }
  }
  return publicFellowship;
};

export const createFellowship = async (data: any) => {
  const fellowship = new Fellowship(data);
  await fellowship.save();
  return fellowship.toObject();
};

export const readFellowship = async (id: any, options: FellowshipReadOptions = {}) => {
  const safeId = normalizeFellowshipObjectId(id);
  if (safeId) {
    const fellowship = await Fellowship.findOne({
      _id: safeId,
      archived: false,
      ...publicFellowshipFilter(options),
    });
    if (!fellowship) {
      throw new NotFoundError('Fellowship not found');
    }
    const rawFellowship = fellowship.toObject();
    return options.includeNonPublic ? rawFellowship : publicFellowshipForStudent(rawFellowship);
  } else {
    throw new ObjectIdError('Did not receive expected id type ObjectId');
  }
};

export const readFellowships = async (ids: any[], options: FellowshipReadOptions = {}) => {
  const validIds = Array.isArray(ids)
    ? ids.slice(0, MAX_FELLOWSHIP_ID_READS).flatMap((id) => {
        const safeId = normalizeFellowshipObjectId(id);
        return safeId ? [safeId] : [];
      })
    : [];
  if (validIds.length === 0) return [];

  const fellowships = await Fellowship.find({
    _id: { $in: validIds },
    archived: false,
    ...publicFellowshipFilter(options),
  });
  const rawFellowships = fellowships.map((fellowship: any) => fellowship.toObject());
  return options.includeNonPublic ? rawFellowships : rawFellowships.map(publicFellowshipForStudent);
};

export const readAllFellowships = async () => {
  const fellowships = await Fellowship.find({
    archived: false,
    ...publicFellowshipFilter(),
  });
  return fellowships.map((fellowship: any) => publicFellowshipForStudent(fellowship.toObject()));
};

export const fellowshipExists = async (id: any) => {
  const safeId = normalizeFellowshipObjectId(id);
  if (safeId) {
    const fellowship = await Fellowship.findById(safeId);
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
  if (!data || typeof data !== 'object' || Array.isArray(data)) return update;
  for (const field of FELLOWSHIP_ADMIN_UPDATABLE_FIELDS) {
    if (data[field] !== undefined) {
      update[field] = data[field];
    }
  }

  for (const field of [
    'studentFacingCategory',
    'compensationSummary',
    'programDates',
    'bestNextStep',
    'title',
    'competitionType',
    'summary',
    'description',
    'applicationInformation',
    'eligibility',
    'restrictionsToUseOfAward',
    'additionalInformation',
    'applicationLink',
    'awardAmount',
    'contactName',
    'contactEmail',
    'contactPhone',
    'contactOffice',
    'sourceName',
    'sourceUrl',
    'sourceKey',
    'sourceFingerprint',
    'studentVisibilitySuppressionReason',
    'studentVisibilityVersion',
  ]) {
    if (field in update) {
      const text = adminFellowshipText(update[field]);
      if (text !== undefined) update[field] = text;
      else delete update[field];
    }
  }

  for (const field of ['applicationLink', 'sourceUrl']) {
    if (field in update) {
      const url = publicHttpUrl(update[field]);
      if (url) update[field] = url;
      else delete update[field];
    }
  }

  for (const field of [
    'prepSteps',
    'yearOfStudy',
    'termOfAward',
    'purpose',
    'globalRegions',
    'citizenshipStatus',
    'studentVisibilityReasons',
  ]) {
    if (field in update) {
      const values = adminFellowshipStringArray(update[field]);
      if (values !== undefined) update[field] = values;
      else delete update[field];
    }
  }

  if ('links' in update) {
    const links = adminFellowshipLinks(update.links);
    if (links !== undefined) update.links = links;
    else delete update.links;
  }

  for (const field of [
    'requiresMentorBeforeApply',
    'mentorMatching',
    'undergraduateOnly',
    'yaleCollegeOnly',
    'isAcceptingApplications',
    'archived',
    'audited',
  ]) {
    if (field in update && typeof update[field] !== 'boolean') delete update[field];
  }

  if ('hoursPerWeek' in update) {
    const hoursPerWeek = adminFellowshipNumber(update.hoursPerWeek);
    if (hoursPerWeek !== undefined) update.hoursPerWeek = hoursPerWeek;
    else delete update.hoursPerWeek;
  }

  for (const field of [
    'applicationOpenDate',
    'deadline',
    'sourceLastVerifiedAt',
    'sourceLastChangedAt',
    'studentVisibilityComputedAt',
    'studentVisibilityReviewedAt',
  ]) {
    if (field in update) {
      const date = adminFellowshipDate(update[field]);
      if (date !== undefined) update[field] = date;
      else delete update[field];
    }
  }

  for (const field of [
    'studentVisibilityTier',
    'studentVisibilityComputedTier',
    'studentVisibilityOverrideTier',
  ]) {
    if (field in update && !isStudentVisibilityTier(update[field])) delete update[field];
  }

  if ('programCategory' in update && !PROGRAM_CATEGORIES.has(update.programCategory))
    delete update.programCategory;
  if ('programKind' in update && !PROGRAM_KINDS.has(update.programKind)) delete update.programKind;
  if ('entryMode' in update && !PROGRAM_ENTRY_MODES.has(update.entryMode)) delete update.entryMode;

  if ('studentVisibilityReviewedByUserId' in update) {
    const id = normalizeFellowshipObjectId(update.studentVisibilityReviewedByUserId);
    if (id !== undefined) update.studentVisibilityReviewedByUserId = id;
    else delete update.studentVisibilityReviewedByUserId;
  }

  return update;
};

export const updateFellowship = async (id: any, data: any) => {
  const safeId = normalizeFellowshipObjectId(id);
  if (safeId) {
    const safeData = filterFellowshipUpdate(data);
    const fellowship = await Fellowship.findByIdAndUpdate(safeId, safeData, {
      new: true,
      runValidators: true,
    });

    if (!fellowship) {
      throw new NotFoundError('Fellowship not found');
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
  return publicFellowshipForStudent(
    await itemOps.addView(Fellowship, id, {
      archived: false,
      ...publicFellowshipFilter(),
    }),
  );
};

export const addFavorite = async (id: any) => {
  return publicFellowshipForStudent(
    await itemOps.addFavorite(Fellowship, id, {
      archived: false,
      ...publicFellowshipFilter(),
    }),
  );
};

export const removeFavorite = async (id: any) => {
  return publicFellowshipForStudent(
    await itemOps.removeFavorite(Fellowship, id, {
      archived: false,
      ...publicFellowshipFilter(),
    }),
  );
};

export const deleteFellowship = async (id: any) => {
  const safeId = normalizeFellowshipObjectId(id);
  if (safeId) {
    const fellowship = await Fellowship.findById(safeId);
    if (!fellowship) {
      throw new NotFoundError('Fellowship not found');
    }
    await Fellowship.findByIdAndDelete(safeId);
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
  subjects?: string[];
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
    page: requestedPage = 1,
    pageSize: requestedPageSize = 20,
    sortBy = DEFAULT_PUBLIC_FELLOWSHIP_SORT_FIELD,
    sortOrder = 1,
    yearOfStudy = [],
    termOfAward = [],
    purpose = [],
    globalRegions = [],
    citizenshipStatus = [],
    programCategory = [],
    programKind = [],
    entryMode = [],
    studentFacingCategory = [],
    subjects = [],
    requiresMentorBeforeApply,
    mentorMatching,
    undergraduateOnly,
    yaleCollegeOnly,
    studentVisibilityTier = [],
    includeNonPublic = false,
    includeOperatorReview = false,
    includeSuppressed = false,
  } = params;
  const safeQuery = boundedSearchQuery(query);
  const safeYearOfStudy = boundedSearchFilterValues(yearOfStudy);
  const safeTermOfAward = boundedSearchFilterValues(termOfAward);
  const safePurpose = boundedSearchFilterValues(purpose);
  const safeGlobalRegions = boundedSearchFilterValues(globalRegions);
  const safeCitizenshipStatus = boundedSearchFilterValues(citizenshipStatus);
  const safeProgramCategory = boundedSearchFilterValues(programCategory);
  const safeProgramKind = boundedSearchFilterValues(programKind);
  const safeEntryMode = boundedSearchFilterValues(entryMode);
  const safeStudentFacingCategory = boundedSearchFilterValues(studentFacingCategory);
  const safeSubjects = boundedSearchFilterValues(subjects).filter((subject) =>
    PROGRAM_TOPIC_TAXONOMY.some((topic) => topic.subject === subject),
  );
  const safeStudentVisibilityTier =
    boundedSearchFilterValues(studentVisibilityTier).filter(isStudentVisibilityTier);
  const page = Math.min(
    MAX_SEARCH_PAGE,
    Math.max(1, Math.floor(numericSearchParam(requestedPage) || 1)),
  );
  const pageSize = Math.min(
    MAX_SEARCH_PAGE_SIZE,
    Math.max(1, Math.floor(numericSearchParam(requestedPageSize) || 20)),
  );

  const filter: any = { archived: false };
  if (includeNonPublic && safeStudentVisibilityTier.length > 0) {
    filter.studentVisibilityTier = { $in: safeStudentVisibilityTier };
  } else if (includeNonPublic && includeSuppressed) {
    // Admin/operator mode: keep all archived=false tiers in scope.
  } else if (includeNonPublic && includeOperatorReview) {
    filter.studentVisibilityTier = {
      $in: [...publicStudentVisibilityTiers, 'operator_review'],
    };
  } else {
    filter.studentVisibilityTier = { $in: publicStudentVisibilityTiers };
  }

  const querySubjects = resolveTopicSubjects([safeQuery]);
  const queryTopicAliases = topicAliasesForSubjects(querySubjects);
  if (safeQuery) {
    const searchTerms = [safeQuery, ...queryTopicAliases].filter(Boolean);
    filter.$text = { $search: searchTerms.join(' ') };
  }
  if (safeSubjects.length > 0) {
    const subjectPattern = topicRegexForSubjects(safeSubjects);
    filter.$or = [
      'title',
      'competitionType',
      'summary',
      'description',
      'applicationInformation',
      'eligibility',
      'restrictionsToUseOfAward',
      'additionalInformation',
      'purpose',
      'studentFacingCategory',
    ].map((field) => ({ [field]: { $regex: subjectPattern, $options: 'i' } }));
  }

  if (safeYearOfStudy.length > 0) {
    filter.yearOfStudy = { $in: safeYearOfStudy };
  }
  if (safeTermOfAward.length > 0) {
    filter.termOfAward = { $in: safeTermOfAward };
  }
  if (safePurpose.length > 0) {
    filter.purpose = { $in: safePurpose };
  }
  if (safeGlobalRegions.length > 0) {
    filter.globalRegions = { $in: safeGlobalRegions };
  }
  if (safeCitizenshipStatus.length > 0) {
    filter.citizenshipStatus = { $in: safeCitizenshipStatus };
  }
  if (safeProgramCategory.length > 0) {
    filter.programCategory = { $in: safeProgramCategory };
  }
  if (safeProgramKind.length > 0) {
    filter.programKind = { $in: safeProgramKind };
  }
  if (safeEntryMode.length > 0) {
    filter.entryMode = { $in: safeEntryMode };
  }
  if (safeStudentFacingCategory.length > 0) {
    filter.studentFacingCategory = { $in: safeStudentFacingCategory };
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
  if (safeQuery) {
    sortOptions.score = { $meta: 'textScore' };
  }
  sortOptions[publicFellowshipSortField(sortBy, includeNonPublic)] =
    publicFellowshipSortOrder(sortOrder);

  const skip = (page - 1) * pageSize;

  let fellowshipsQuery = Fellowship.find(filter);

  if (safeQuery) {
    fellowshipsQuery = fellowshipsQuery.select({ score: { $meta: 'textScore' } });
  }

  const [fellowships, total] = await Promise.all([
    fellowshipsQuery.sort(sortOptions).skip(skip).limit(pageSize).lean(),
    Fellowship.countDocuments(filter),
  ]);

  return {
    fellowships: (includeNonPublic ? fellowships : fellowships.map(publicFellowshipForStudent)).map(
      (fellowship) => ({ ...fellowship, inferredSubjects: inferProgramSubjects(fellowship) }),
    ),
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
    subjects: PROGRAM_TOPIC_TAXONOMY.map((topic) => topic.subject),
  };
};

export const bulkCreateFellowships = async (fellowships: any[]) => {
  const result = await Fellowship.insertMany(fellowships);
  return result.map((f: any) => f.toObject());
};
