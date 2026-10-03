/**
 * Service layer for fellowship CRUD, search, and filter operations.
 */
import { escapeRegex } from '../utils/regex';
import { foldLatinDiacritics } from '../utils/latinDiacritics';
import {
  correctProgramSearchQuerySpelling,
  PROGRAM_QUERY_STOP_WORDS,
  PROGRAM_SEARCH_SPELLING_FIELDS,
} from './programSearchSpellingVocabulary';
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
import { runStudentVisibilityGate } from './studentVisibilityGateService';
import { Observation } from '../models/observation';
import { clearedProgramStudentVisibilityVerdict } from '../models/entityArchival';
import { programRoleForKind } from './programClassifier';
import { programAudience } from './programAudience';
import { isDepartmentResearchGuidance } from './departmentResearchGuidance';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeCatalogDescription } from '../utils/descriptionHygiene';
import { programLikeCardShortDescription } from '../utils/researchEntityDescriptionQuality';
import { serializedDocumentId } from '../utils/idSerialization';
import { publicHttpUrl } from '../utils/urlSafety';
import { newYorkCalendarDate, newYorkInstant, newYorkWallClock } from '../utils/newYorkTime';
import { programDeadlineClosesAt } from '../utils/programDeadlineInstant';
import {
  servedUpcomingDuplicateWindow,
  type UpcomingDuplicateWindow,
} from './programUpcomingDuplicateWindow';
import {
  inferProgramSubjects,
  PROGRAM_TOPIC_TAXONOMY,
  resolveTopicSubjects,
  topicAliasesForSubjects,
  yearOfStudyAliasesForQuery,
  topicRegexForSubjects,
} from './programTopicService';

export interface FellowshipReadOptions {
  includeNonPublic?: boolean;
  skipIdLimit?: boolean;
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
  'sourcePageTitle',
]);

// The two prose card fields the student-visibility gate reads through
// sanitizeCatalogDescription (programPublicDescriptionState). Serving them
// without the same pass let a card reach student_ready on a clean summary while
// still displaying a description that is internal curation-rationale, a
// staff-contact block, or chrome - text the gate rejects but the serve layer
// only contact-redacted and length-bounded. Sanitizing here restores gate/serve
// parity so served fellowship copy can never contain rationale/chrome/dump text.
const CATALOG_SANITIZED_FELLOWSHIP_FIELDS = new Set(['summary', 'description']);

const PUBLIC_FELLOWSHIP_FIELDS = [
  '_id',
  'id',
  'programCategory',
  'programKind',
  'programRole',
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
  'researchFocused',
  'applicationMaterials',
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
  'sourcePageTitle',
  'sourceLinkHealth',
] as const;

const PUBLIC_FELLOWSHIP_PRIMITIVE_FIELDS = new Set([
  '_id',
  'id',
  'programCategory',
  'programKind',
  'programRole',
  'entryMode',
  'studentFacingCategory',
  'requiresMentorBeforeApply',
  'mentorMatching',
  'undergraduateOnly',
  'yaleCollegeOnly',
  'researchFocused',
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
    if (typeof value !== 'string') return undefined;
    const prose = CATALOG_SANITIZED_FELLOWSHIP_FIELDS.has(field)
      ? sanitizeCatalogDescription(value, { evergreenizeDates: false })
      : value;
    return redactDirectContactInfo(boundedPublicText(prose));
  }

  if ((field === 'prepSteps' || field === 'applicationMaterials') && Array.isArray(value)) {
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

export const toValidDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const deadlineIsPast = (value: unknown, now: Date): boolean => {
  const date = toValidDate(value);
  return date !== undefined && programDeadlineClosesAt(date).getTime() < now.getTime();
};

const RECURRING_PROGRAM_TEXT_RE =
  /\b(fellowship|grant|award|funding|stipend|summer|annual|year|cycle|term|spring|fall|deadline|application)\b/i;

const hasFellowshipSourceUrl = (fellowship: any): boolean => {
  if (
    typeof fellowship.applicationLink === 'string' &&
    /^https?:\/\//i.test(fellowship.applicationLink.trim())
  ) {
    return true;
  }
  return Array.isArray(fellowship.links)
    ? fellowship.links.some(
        (link: any) => typeof link?.url === 'string' && /^https?:\/\//i.test(link.url.trim()),
      )
    : false;
};

const textForRecurrenceDetection = (fellowship: any): string =>
  [
    fellowship.title,
    fellowship.competitionType,
    fellowship.summary,
    fellowship.description,
    fellowship.applicationInformation,
    fellowship.eligibility,
    fellowship.additionalInformation,
    ...(Array.isArray(fellowship.purpose) ? fellowship.purpose : []),
    ...(Array.isArray(fellowship.termOfAward) ? fellowship.termOfAward : []),
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');

export const isLikelyRecurringProgram = (fellowship: any): boolean =>
  hasFellowshipSourceUrl(fellowship) &&
  RECURRING_PROGRAM_TEXT_RE.test(textForRecurrenceDetection(fellowship));

const sameDeadlineNextCycle = (deadline: Date): Date => {
  const stated = newYorkWallClock(deadline);
  const sameDayNextCycle = new Date(Date.UTC(stated.year + 1, stated.monthIndex, stated.day));
  return newYorkInstant({
    ...stated,
    year: sameDayNextCycle.getUTCFullYear(),
    monthIndex: sameDayNextCycle.getUTCMonth(),
    day: sameDayNextCycle.getUTCDate(),
  });
};

// A deadline that closed more than one cycle ago means the source page skipped at least a
// whole cycle, so neither the stated date nor an estimate from it is served (#4363).
export const deadlineIsStale = (closesAt: Date, now: Date): boolean =>
  sameDeadlineNextCycle(closesAt).getTime() < now.getTime();

export const projectNextCycleDeadline = (deadline: Date, now: Date): Date | undefined => {
  const projected = sameDeadlineNextCycle(deadline);
  return projected.getTime() < now.getTime() ? undefined : projected;
};

export interface ServedProgramDeadline {
  deadline: Date | undefined;
  closed: boolean;
  projectedNextCycle: boolean;
  stale: boolean;
  duplicateWindow?: UpcomingDuplicateWindow;
}

export const servedProgramDeadline = (program: any, now: Date): ServedProgramDeadline => {
  const duplicateWindow = servedUpcomingDuplicateWindow(program, now);
  if (duplicateWindow) {
    return {
      deadline: programDeadlineClosesAt(duplicateWindow.deadline),
      closed: false,
      projectedNextCycle: false,
      stale: false,
      duplicateWindow,
    };
  }
  const statedDeadline = toValidDate(program?.deadline);
  if (!statedDeadline) {
    return { deadline: undefined, closed: false, projectedNextCycle: false, stale: false };
  }
  const closesAt = programDeadlineClosesAt(statedDeadline);
  const closed = deadlineIsPast(closesAt, now);
  if (closed && deadlineIsStale(closesAt, now)) {
    return { deadline: undefined, closed, projectedNextCycle: false, stale: true };
  }
  const projectedDeadline =
    closed && isLikelyRecurringProgram(program)
      ? projectNextCycleDeadline(closesAt, now)
      : undefined;
  return projectedDeadline
    ? { deadline: projectedDeadline, closed, projectedNextCycle: true, stale: false }
    : { deadline: closesAt, closed, projectedNextCycle: false, stale: false };
};

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const PRESENTATION_DATE_CLAUSE_RE =
  /\s+by\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})(?=[.,;)\s]|$)/gi;

const stripStalePresentationDate = (text: string, deadline: Date): string => {
  const { year, monthIndex } = newYorkCalendarDate(deadline);
  const deadlineMonthOrdinal = year * 12 + monthIndex;
  return text.replace(
    PRESENTATION_DATE_CLAUSE_RE,
    (match, monthName: string, yearText: string, offset: number, whole: string) => {
      const monthIndex = MONTH_NAME_TO_INDEX[monthName.toLowerCase()];
      if (monthIndex === undefined) return match;
      const contextBefore = whole.slice(Math.max(0, offset - 200), offset).toLowerCase();
      if (!contextBefore.includes('present')) return match;
      const clauseMonthOrdinal = Number(yearText) * 12 + monthIndex;
      if (clauseMonthOrdinal >= deadlineMonthOrdinal) return match;
      return '';
    },
  );
};

// The copy that supplies a served deadline also supplies its opening date when it states one,
// because the two are one statement of one cycle. Otherwise the row's own opening date stands.
export const servedApplicationOpenDate = (program: any, served: ServedProgramDeadline): unknown =>
  served.duplicateWindow?.applicationOpenDate ?? program?.applicationOpenDate;

// The stored flag freezes whatever a lane last wrote, so a window that opened since then would
// still read as closed (#4231). Where the row states a deadline, the served window decides in
// both directions; without both a deadline and a stated opening date the dates cannot show the
// window opened, so the stored flag stands unless the window is closed. A deadline served from
// another copy of the fund (#4382) is that copy's, so where neither copy states an opening date
// the flag that copy's lane read beside the deadline stands instead of the row's own.
export const acceptingFromServedWindow = (
  program: any,
  served: ServedProgramDeadline,
  now: Date,
): boolean | undefined => {
  if (served.stale) return false;
  if (!served.deadline) return undefined;
  if (served.closed || served.projectedNextCycle) return false;
  const opensAt = toValidDate(servedApplicationOpenDate(program, served));
  if (!opensAt) return served.duplicateWindow?.isAcceptingApplications;
  return opensAt.getTime() <= now.getTime();
};

export const publicFellowshipForStudent = (fellowship: any, now: Date = new Date()) => {
  if (!fellowship || typeof fellowship !== 'object') return fellowship;

  const publicFellowship: Record<string, any> = {};
  for (const field of PUBLIC_FELLOWSHIP_FIELDS) {
    if (fellowship[field] !== undefined) {
      publicFellowship[field] = publicFellowshipField(field, fellowship[field]);
    }
  }

  publicFellowship.audience = programAudience(fellowship);
  publicFellowship.departmentResearchGuidance = isDepartmentResearchGuidance(fellowship);

  const served = servedProgramDeadline(fellowship, now);
  if (served.deadline) publicFellowship.deadline = served.deadline;
  if (served.stale) {
    delete publicFellowship.deadline;
    delete publicFellowship.applicationOpenDate;
  }
  if (served.duplicateWindow?.applicationOpenDate) {
    publicFellowship.applicationOpenDate = served.duplicateWindow.applicationOpenDate;
  }
  const windowAcceptance = acceptingFromServedWindow(fellowship, served, now);
  if (windowAcceptance !== undefined) publicFellowship.isAcceptingApplications = windowAcceptance;
  publicFellowship.deadlineProjectedNextCycle = served.projectedNextCycle;
  publicFellowship.deadlineStale = served.stale;

  const deadlineDate = toValidDate(publicFellowship.deadline);
  if (deadlineDate) {
    for (const field of ['summary', 'description'] as const) {
      if (typeof publicFellowship[field] === 'string') {
        publicFellowship[field] = stripStalePresentationDate(publicFellowship[field], deadlineDate);
      }
    }
  }

  // The browse card renders one clamped line, so a summary that is the whole
  // body reaches a student cut off mid-sentence. `summary` stays as stored
  // because the detail surface falls back to it as the body (#2215).
  if (
    typeof publicFellowship.summary === 'string' ||
    typeof publicFellowship.description === 'string'
  ) {
    publicFellowship.cardSummary = programLikeCardShortDescription({
      shortDescription: publicFellowship.summary,
      fullDescription: publicFellowship.description,
    });
  }

  return publicFellowship;
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
  const boundedIds = Array.isArray(ids)
    ? options.skipIdLimit
      ? ids
      : ids.slice(0, MAX_FELLOWSHIP_ID_READS)
    : [];
  const validIds = boundedIds.flatMap((id) => {
    const safeId = normalizeFellowshipObjectId(id);
    return safeId ? [safeId] : [];
  });
  if (validIds.length === 0) return [];

  const fellowships = await Fellowship.find({
    _id: { $in: validIds },
    archived: false,
    ...publicFellowshipFilter(options),
  });
  const rawFellowships = fellowships.map((fellowship: any) => fellowship.toObject());
  return options.includeNonPublic
    ? rawFellowships
    : rawFellowships.map((fellowship) => publicFellowshipForStudent(fellowship));
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
  'studentVisibilityReviewedAt',
  'studentVisibilityReviewedByAccountId',
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
  if ('programKind' in update) update.programRole = programRoleForKind(update.programKind);
  if ('entryMode' in update && !PROGRAM_ENTRY_MODES.has(update.entryMode)) delete update.entryMode;

  if ('studentVisibilityReviewedByAccountId' in update) {
    const id = normalizeFellowshipObjectId(update.studentVisibilityReviewedByAccountId);
    if (id !== undefined) update.studentVisibilityReviewedByAccountId = id;
    else delete update.studentVisibilityReviewedByAccountId;
  }

  return update;
};

const withoutClearedVerdict = (update: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(update).filter(
      ([field]) => !(field in clearedProgramStudentVisibilityVerdict()),
    ),
  );

const VISIBILITY_OVERRIDE_FIELDS = [
  'studentVisibilityOverrideTier',
  'studentVisibilitySuppressionReason',
] as const;

const LIFTED_OVERRIDE_REASON =
  'operator lifted the student-visibility override in the admin editor';

/**
 * Lifting an override clears the stored field and retires the observations that assert it.
 * Clearing the field alone does not stick: a `manual-admin-edit` observation still asserts
 * the old tier, and the next materialization projects it back, which is how per-row repairs
 * of research-entity overrides came undone before #1898.
 */
async function liftFellowshipVisibilityOverride(fellowship: { _id: unknown; sourceKey?: unknown }) {
  const identity: Record<string, unknown>[] = [{ entityId: fellowship._id }];
  if (typeof fellowship.sourceKey === 'string' && fellowship.sourceKey) {
    identity.push({ entityKey: fellowship.sourceKey });
  }
  await Observation.updateMany(
    {
      entityType: 'fellowship',
      $or: identity,
      field: { $in: [...VISIBILITY_OVERRIDE_FIELDS] },
      superseded: { $ne: true },
    },
    {
      $set: {
        superseded: true,
        rollback: { rolledBackAt: new Date(), reason: LIFTED_OVERRIDE_REASON },
      },
    },
  );
  await Fellowship.updateOne(
    { _id: fellowship._id },
    {
      $unset: Object.fromEntries(
        VISIBILITY_OVERRIDE_FIELDS.flatMap((field) => [
          [field, ''],
          [`fieldProvenance.${field}`, ''],
        ]),
      ),
    },
  );
}

export const updateFellowship = async (id: any, data: any) => {
  const safeId = normalizeFellowshipObjectId(id);
  if (!safeId) throw new ObjectIdError('Did not receive expected id type ObjectId');
  const liftsOverride =
    data !== null && typeof data === 'object' && data.studentVisibilityOverrideTier === null;

  const safeData = filterFellowshipUpdate(data);
  const restoring =
    safeData.archived === false &&
    (await Fellowship.exists({ _id: safeId, archived: true })) !== null;
  const withdrawsVerdict = safeData.archived === true || restoring;
  const update = withdrawsVerdict
    ? { $set: withoutClearedVerdict(safeData), $unset: clearedProgramStudentVisibilityVerdict() }
    : safeData;
  const fellowship = await Fellowship.findByIdAndUpdate(safeId, update, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!fellowship) throw new NotFoundError('Fellowship not found');
  if (liftsOverride) await liftFellowshipVisibilityOverride(fellowship);
  if (!restoring && !liftsOverride) return fellowship.toObject();

  await runStudentVisibilityGate({ collection: 'programs', mode: 'apply', recordIds: [safeId] });
  const regated = await Fellowship.findById(safeId).lean();
  return regated || fellowship.toObject();
};

export const archiveFellowship = async (id: any) => updateFellowship(id, { archived: true });

export const unarchiveFellowship = async (id: any) => updateFellowship(id, { archived: false });

export const addView = async (id: any) => {
  return publicFellowshipForStudent(
    await itemOps.addView(Fellowship, id, {
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

const PROGRAM_WORD_PREFIX_MIN_LENGTH = 2;
const PROGRAM_WORD_PREFIX_STOP_WORDS: ReadonlySet<string> = new Set(PROGRAM_QUERY_STOP_WORDS);

// MongoDB `$text` matches whole stemmed words only, so a student typing into the live search
// box sees nothing until the word is finished: `Com` matched no program while 87 carry a word
// starting with it. Every typed word must start some word in the program. See #4537.
export const programQueryWordPrefixClauses = (query: string): Record<string, unknown>[] =>
  [...new Set(foldLatinDiacritics(query.toLowerCase()).match(/[a-z0-9]+/g) ?? [])]
    .filter(
      (token) =>
        token.length >= PROGRAM_WORD_PREFIX_MIN_LENGTH &&
        !PROGRAM_WORD_PREFIX_STOP_WORDS.has(token),
    )
    .map((token) => ({
      $or: PROGRAM_SEARCH_SPELLING_FIELDS.map((field) => ({
        [field]: { $regex: `(?:^|[^a-z0-9])${escapeRegex(token)}`, $options: 'i' },
      })),
    }));

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
  correctSpelling?: boolean;
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
    correctSpelling = true,
  } = params;
  const typedQuery = boundedSearchQuery(query);
  const spelling = correctSpelling
    ? await correctProgramSearchQuerySpelling(typedQuery)
    : { query: typedQuery, corrections: [] };
  const safeQuery = spelling.query;
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
    const searchTerms = [
      safeQuery,
      ...queryTopicAliases,
      ...yearOfStudyAliasesForQuery(safeQuery),
    ].filter(Boolean);
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

  const sortField = publicFellowshipSortField(sortBy, includeNonPublic);
  const fieldSortOptions: Record<string, any> = {
    [sortField]: publicFellowshipSortOrder(sortOrder),
    _id: 1,
  };
  const skip = (page - 1) * pageSize;

  const servePrograms = (fellowships: any[]) =>
    (includeNonPublic
      ? fellowships
      : fellowships.map((fellowship) => publicFellowshipForStudent(fellowship))
    ).map((fellowship) => ({ ...fellowship, inferredSubjects: inferProgramSubjects(fellowship) }));
  const queryCorrection =
    spelling.corrections.length > 0
      ? { originalQuery: typedQuery, correctedQuery: safeQuery }
      : undefined;

  if (!safeQuery) {
    const [fellowships, total] = await Promise.all([
      Fellowship.find(filter).sort(fieldSortOptions).skip(skip).limit(pageSize).lean(),
      Fellowship.countDocuments(filter),
    ]);
    return {
      fellowships: servePrograms(fellowships),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  const { $text: _textClause, ...filterWithoutText } = filter;
  const prefixClauses = programQueryWordPrefixClauses(safeQuery);
  const [textMatches, prefixMatches] = await Promise.all([
    Fellowship.find(filter, { _id: 1, score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' }, ...fieldSortOptions })
      .lean(),
    prefixClauses.length > 0
      ? Fellowship.find(
          { ...filterWithoutText, $and: [...(filterWithoutText.$and ?? []), ...prefixClauses] },
          { _id: 1 },
        )
          .sort(fieldSortOptions)
          .lean()
      : Promise.resolve([]),
  ]);
  const scoreById = new Map<string, number>(
    (textMatches as any[]).map((match) => [String(match._id), match.score]),
  );
  const orderedIds = [
    ...new Set([...(textMatches as any[]), ...(prefixMatches as any[])].map((m) => String(m._id))),
  ];
  const pageIds = orderedIds.slice(skip, skip + pageSize);
  const pageDocuments = pageIds.length
    ? ((await Fellowship.find({ _id: { $in: pageIds } }).lean()) as any[])
    : [];
  const documentById = new Map(pageDocuments.map((document) => [String(document._id), document]));
  const fellowships = pageIds
    .map((id) => documentById.get(id))
    .filter(Boolean)
    .map((document) =>
      scoreById.has(String(document._id))
        ? { ...document, score: scoreById.get(String(document._id)) }
        : document,
    );

  return {
    fellowships: servePrograms(fellowships),
    total: orderedIds.length,
    page,
    pageSize,
    totalPages: Math.ceil(orderedIds.length / pageSize),
    ...(queryCorrection ? { queryCorrection } : {}),
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
