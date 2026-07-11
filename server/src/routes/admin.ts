/**
 * Admin-only routes for managing listings, fellowships, users, and profiles.
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import http from 'http';
import https from 'https';
import { isPrivateAddress, isPublicHostname, ssrfSafeLookup } from '../utils/ssrfGuard';
import { containsAsciiControl, replaceAsciiControls } from '../utils/asciiControl';
// Re-exported for back-compat with existing imports/tests that reference these from this module.
export { isPrivateAddress, isPublicHostname, ssrfSafeLookup };
import { isAuthenticated, isAdmin, validateObjectId, validateNetid } from '../middleware/index';
import { updateListing, deleteListing } from '../services/listingService';
import { getListingModel } from '../db/connections';
import { ResearchArea, ResearchField, fieldColorKeys } from '../models/researchArea';
import { Department, DepartmentCategory, categoryColorKeys } from '../models/department';
import { invalidateConfigCache } from '../services/configService';
import { Fellowship } from '../models/fellowship';
import { User } from '../models/user';
import {
  updateFellowship,
  deleteFellowship,
  archiveFellowship,
  unarchiveFellowship,
} from '../services/fellowshipService';
import {
  getAdminListingClaimRequest,
  listAdminListingClaimRequests,
  reviewAdminListingClaimRequest,
} from '../controllers/listingClaimRequestController';
import { adminUpdateProfile, cascadeDepartmentsToListings } from '../services/profileService';
import { buildSafeSearchRegex } from '../utils/regex';
import {
  AccessReviewRequestError,
  getAccessReviewEntity,
  listAccessReviewEntities,
  updateAccessReviewManualLocks,
  updateAccessReviewRecordReview,
} from '../services/adminAccessReviewService';
import {
  AdminGrantValidationError,
  grantAdminAccess,
  listAdminGrants,
  revokeAdminAccess,
} from '../services/adminGrantService';
import { buildAdminOperatorBoard } from '../services/adminOperatorBoardService';
import { listVisibilityReleaseQueue } from '../services/studentVisibilityGateService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { publicHttpUrl } from '../utils/urlSafety';

const router = Router();

function setPrivateAdminCacheHeaders(_req: Request, res: Response, next: () => void) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

router.use(setPrivateAdminCacheHeaders, isAuthenticated, isAdmin);

export const MAX_ADMIN_URL_CHECK_URLS = 25;
export const MAX_ADMIN_URL_CHECK_URL_LENGTH = 2048;
export const ADMIN_URL_CHECK_TIMEOUT_MS = 10000;
const hasUnsafeAdminUrlInput = (value: string): boolean =>
  containsAsciiControl(value) || /[\s\\]/.test(value);
const MAX_ADMIN_LIST_PAGE = 1000;
const MAX_ADMIN_LIST_PAGE_SIZE = 100;
const ADMIN_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const ADMIN_URL_CHECK_ALLOWED_PORTS = new Set(['', '80', '443']);
const ADMIN_LISTING_SORT_FIELDS = new Set([
  'title',
  'ownerFirstName',
  'ownerLastName',
  'descriptionLength',
  'views',
  'favorites',
  'createdAt',
  'redFlags',
]);
const ADMIN_PROFILE_SORT_FIELDS = new Set(['lname', 'primary_department', 'h_index', 'createdAt']);
const ADMIN_FELLOWSHIP_SORT_FIELDS = new Set([
  'title',
  'deadline',
  'views',
  'favorites',
  'createdAt',
]);
const ACCESS_REVIEW_RECORD_TYPES = new Set([
  'entryPathway',
  'accessSignal',
  'contactRoute',
  'postedOpportunity',
]);
const MAX_ADMIN_ACCESS_REVIEW_NOTE_LENGTH = 2000;
const MAX_ADMIN_ACCESS_REVIEW_LOCKED_FIELDS = 100;
const MAX_ADMIN_ACCESS_REVIEW_LOCKED_FIELD_LENGTH = 120;
const ADMIN_PROFILE_PUBLICATION_LIMIT = 500;

const adminProfilePublications = (value: unknown) =>
  Array.isArray(value) ? value.slice(0, ADMIN_PROFILE_PUBLICATION_LIMIT) : [];

export const adminProfileDto = (user: any, includePublications = false) => {
  const ownListings = Array.isArray(user?.ownListings) ? user.ownListings : [];
  const secondaryDepartments = Array.isArray(user?.secondaryDepartments)
    ? user.secondaryDepartments
    : [];
  const researchInterests = Array.isArray(user?.researchInterests) ? user.researchInterests : [];
  const topics = Array.isArray(user?.topics) ? user.topics : [];
  const profileUrls =
    user?.profileUrls && typeof user.profileUrls === 'object' && !Array.isArray(user.profileUrls)
      ? user.profileUrls
      : {};
  const hIndex = Number.isFinite(Number(user?.hIndex)) ? Number(user.hIndex) : undefined;

  const profile: Record<string, unknown> = {
    netid: user?.netid || '',
    fname: user?.fname || '',
    lname: user?.lname || '',
    email: user?.email || '',
    title: user?.title || '',
    bio: user?.bio || '',
    phone: user?.phone || '',
    primaryDepartment: user?.primaryDepartment || '',
    primary_department: user?.primaryDepartment || '',
    secondaryDepartments,
    secondary_departments: secondaryDepartments,
    researchInterests,
    research_interests: researchInterests,
    hIndex,
    h_index: hIndex,
    orcid: user?.orcid || '',
    openAlexId: user?.openAlexId || '',
    openalex_id: user?.openAlexId || '',
    imageUrl: user?.imageUrl || '',
    image_url: user?.imageUrl || '',
    profileUrls,
    profile_urls: profileUrls,
    topics,
    profileVerified: user?.profileVerified === true,
    profileVerificationRequestedAt: user?.profileVerificationRequestedAt,
    userType: user?.userType || 'professor',
    userConfirmed: user?.userConfirmed === true,
    ownListingCount: ownListings.length,
    createdAt: user?.createdAt,
    updatedAt: user?.updatedAt,
  };

  if (includePublications) {
    profile.publications = adminProfilePublications(user?.publications);
  }

  return profile;
};

const adminPayloadId = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return '';
};

const adminAccessReviewLockedFields = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.slice(0, MAX_ADMIN_ACCESS_REVIEW_LOCKED_FIELDS).flatMap((field) => {
        if (typeof field !== 'string') return [];
        const text = field.trim().slice(0, MAX_ADMIN_ACCESS_REVIEW_LOCKED_FIELD_LENGTH);
        return text ? [text] : [];
      })
    : [];

export const adminAccessReviewRecordUpdateDto = (record: any) => {
  const id = adminPayloadId(record?._id || record?.id);
  const review = record?.review && typeof record.review === 'object' ? record.review : {};

  return {
    _id: id,
    id,
    archived: record?.archived === true,
    review: {
      status: typeof review.status === 'string' ? review.status : 'unreviewed',
      reviewedAt: review.reviewedAt,
      note:
        typeof review.note === 'string'
          ? review.note.trim().slice(0, MAX_ADMIN_ACCESS_REVIEW_NOTE_LENGTH)
          : '',
      lockedFields: adminAccessReviewLockedFields(review.lockedFields),
    },
  };
};

export const adminResearchAreaDto = (area: any) => ({
  _id: adminPayloadId(area?._id),
  name: area?.name || '',
  field: area?.field || '',
  colorKey: area?.colorKey || 'gray',
  isDefault: area?.isDefault === true,
});

export const adminDepartmentDto = (dept: any) => ({
  _id: adminPayloadId(dept?._id),
  abbreviation: dept?.abbreviation || '',
  name: dept?.name || '',
  displayName: dept?.displayName || '',
  categories: Array.isArray(dept?.categories) ? dept.categories : [],
  primaryCategory: dept?.primaryCategory || '',
  colorKey: Number.isFinite(Number(dept?.colorKey)) ? Number(dept.colorKey) : 0,
  isActive: dept?.isActive !== false,
});

const MAX_ADMIN_LISTING_TEXT_LENGTH = 5000;
const MAX_ADMIN_LISTING_SHORT_TEXT_LENGTH = 250;
const MAX_ADMIN_LISTING_ARRAY_ITEMS = 100;

const adminListingText = (
  value: unknown,
  maxLength = MAX_ADMIN_LISTING_TEXT_LENGTH,
): string | undefined => (typeof value === 'string' ? value.trim().slice(0, maxLength) : undefined);

const adminListingTextArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.slice(0, MAX_ADMIN_LISTING_ARRAY_ITEMS).flatMap((item) => {
        const text = adminListingText(item, MAX_ADMIN_LISTING_SHORT_TEXT_LENGTH);
        return text ? [text] : [];
      })
    : [];

const adminListingUrlArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.slice(0, MAX_ADMIN_LISTING_ARRAY_ITEMS).flatMap((item) => {
        const url = publicHttpUrl(item);
        return url ? [url] : [];
      })
    : [];

const adminListingNumber = (value: unknown, fallback = 0): number => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

export const adminListingDto = (listing: any) => {
  const id = adminPayloadId(listing?._id || listing?.id);

  return {
    _id: id,
    id,
    ownerId: adminListingText(listing?.ownerId, MAX_ADMIN_LISTING_SHORT_TEXT_LENGTH) || '',
    ownerFirstName:
      adminListingText(listing?.ownerFirstName, MAX_ADMIN_LISTING_SHORT_TEXT_LENGTH) || '',
    ownerLastName:
      adminListingText(listing?.ownerLastName, MAX_ADMIN_LISTING_SHORT_TEXT_LENGTH) || '',
    ownerEmail: adminListingText(listing?.ownerEmail, MAX_ADMIN_LISTING_SHORT_TEXT_LENGTH) || '',
    ownerTitle: adminListingText(listing?.ownerTitle, MAX_ADMIN_LISTING_SHORT_TEXT_LENGTH),
    ownerPrimaryDepartment: adminListingText(
      listing?.ownerPrimaryDepartment,
      MAX_ADMIN_LISTING_SHORT_TEXT_LENGTH,
    ),
    professorIds: adminListingTextArray(listing?.professorIds),
    professorNames: adminListingTextArray(listing?.professorNames),
    departments: adminListingTextArray(listing?.departments),
    emails: adminListingTextArray(listing?.emails),
    websites: adminListingUrlArray(listing?.websites),
    title: adminListingText(listing?.title) || '',
    hiringStatus: adminListingNumber(listing?.hiringStatus),
    description: adminListingText(listing?.description) || '',
    applicantDescription: adminListingText(listing?.applicantDescription) || '',
    researchAreas: adminListingTextArray(listing?.researchAreas),
    keywords: adminListingTextArray(listing?.keywords),
    established: Number.isFinite(Number(listing?.established))
      ? Number(listing.established)
      : undefined,
    views: adminListingNumber(listing?.views),
    favorites: adminListingNumber(listing?.favorites),
    archived: listing?.archived === true,
    confirmed: listing?.confirmed === true,
    audited: listing?.audited === true,
    expiresAt: listing?.expiresAt,
    createdAt: listing?.createdAt,
    updatedAt: listing?.updatedAt,
    descriptionLength: Number.isFinite(Number(listing?.descriptionLength))
      ? Number(listing.descriptionLength)
      : undefined,
    redFlagScore: Number.isFinite(Number(listing?.redFlagScore))
      ? Number(listing.redFlagScore)
      : undefined,
  };
};

const MAX_ADMIN_FELLOWSHIP_TEXT_LENGTH = 5000;
const MAX_ADMIN_FELLOWSHIP_SHORT_TEXT_LENGTH = 250;
const MAX_ADMIN_FELLOWSHIP_ARRAY_ITEMS = 100;
const MAX_ADMIN_FELLOWSHIP_LINKS = 100;

const adminFellowshipText = (
  value: unknown,
  maxLength = MAX_ADMIN_FELLOWSHIP_TEXT_LENGTH,
): string | undefined => (typeof value === 'string' ? value.trim().slice(0, maxLength) : undefined);

const adminFellowshipStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.slice(0, MAX_ADMIN_FELLOWSHIP_ARRAY_ITEMS).flatMap((item) => {
        const text = adminFellowshipText(item, MAX_ADMIN_FELLOWSHIP_SHORT_TEXT_LENGTH);
        return text ? [text] : [];
      })
    : [];

const adminFellowshipLinks = (value: unknown): Array<{ label: string; url: string }> =>
  Array.isArray(value)
    ? value.slice(0, MAX_ADMIN_FELLOWSHIP_LINKS).flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const record = item as Record<string, unknown>;
        const url = publicHttpUrl(record.url);
        if (!url) return [];
        return [
          {
            label: adminFellowshipText(record.label, MAX_ADMIN_FELLOWSHIP_SHORT_TEXT_LENGTH) || '',
            url,
          },
        ];
      })
    : [];

const adminFellowshipNumber = (value: unknown, fallback = 0): number => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

export const adminFellowshipDto = (fellowship: any) => {
  const id = adminPayloadId(fellowship?._id || fellowship?.id);

  return {
    _id: id,
    id,
    title: adminFellowshipText(fellowship?.title) || '',
    competitionType:
      adminFellowshipText(fellowship?.competitionType, MAX_ADMIN_FELLOWSHIP_SHORT_TEXT_LENGTH) ||
      '',
    summary: adminFellowshipText(fellowship?.summary) || '',
    description: adminFellowshipText(fellowship?.description) || '',
    applicationInformation: adminFellowshipText(fellowship?.applicationInformation) || '',
    eligibility: adminFellowshipText(fellowship?.eligibility) || '',
    restrictionsToUseOfAward: adminFellowshipText(fellowship?.restrictionsToUseOfAward) || '',
    additionalInformation: adminFellowshipText(fellowship?.additionalInformation) || '',
    links: adminFellowshipLinks(fellowship?.links),
    applicationLink: publicHttpUrl(fellowship?.applicationLink) || '',
    awardAmount:
      adminFellowshipText(fellowship?.awardAmount, MAX_ADMIN_FELLOWSHIP_SHORT_TEXT_LENGTH) || '',
    isAcceptingApplications: fellowship?.isAcceptingApplications === true,
    applicationOpenDate: fellowship?.applicationOpenDate || null,
    deadline: fellowship?.deadline || null,
    contactName:
      adminFellowshipText(fellowship?.contactName, MAX_ADMIN_FELLOWSHIP_SHORT_TEXT_LENGTH) || '',
    contactEmail:
      adminFellowshipText(fellowship?.contactEmail, MAX_ADMIN_FELLOWSHIP_SHORT_TEXT_LENGTH) || '',
    contactPhone:
      adminFellowshipText(fellowship?.contactPhone, MAX_ADMIN_FELLOWSHIP_SHORT_TEXT_LENGTH) || '',
    contactOffice:
      adminFellowshipText(fellowship?.contactOffice, MAX_ADMIN_FELLOWSHIP_SHORT_TEXT_LENGTH) || '',
    yearOfStudy: adminFellowshipStringArray(fellowship?.yearOfStudy),
    termOfAward: adminFellowshipStringArray(fellowship?.termOfAward),
    purpose: adminFellowshipStringArray(fellowship?.purpose),
    globalRegions: adminFellowshipStringArray(fellowship?.globalRegions),
    citizenshipStatus: adminFellowshipStringArray(fellowship?.citizenshipStatus),
    archived: fellowship?.archived === true,
    audited: fellowship?.audited === true,
    views: adminFellowshipNumber(fellowship?.views),
    favorites: adminFellowshipNumber(fellowship?.favorites),
    createdAt: fellowship?.createdAt,
    updatedAt: fellowship?.updatedAt,
  };
};

export const normalizeAdminObjectId = (value: unknown): string | undefined => {
  const id =
    typeof value === 'string'
      ? value.trim()
      : value instanceof mongoose.Types.ObjectId
        ? value.toHexString()
        : '';
  return ADMIN_OBJECT_ID_RE.test(id) ? id : undefined;
};
const MAX_ADMIN_SEARCH_QUERY_LENGTH = 120;
const MAX_ADMIN_PAGINATION_PARAM_LENGTH = 16;
export const MAX_ADMIN_TAXONOMY_LABEL_LENGTH = 160;
export const MAX_ADMIN_DEPARTMENT_ABBREVIATION_LENGTH = 24;
export const MAX_ADMIN_DEPARTMENT_CATEGORIES = 10;
type AdminSearchErrorCode = 'notString' | 'tooLong';
const ADMIN_SEARCH_ERROR_MESSAGES: Record<AdminSearchErrorCode, string> = {
  notString: 'Search query must be a string',
  tooLong: 'Search query is too long',
};

interface AdminUrlCheckResult {
  url: string;
  status: number;
  reachable: boolean;
  error?: string;
}

const adminUrlCheckDisplayText = (value: string): string =>
  replaceAsciiControls(value, '').trim().slice(0, MAX_ADMIN_URL_CHECK_URL_LENGTH);

const adminUrlCheckDisplayUrl = (url: string, parsed?: URL): string => {
  const candidate = parsed
    ? new URL(parsed.toString())
    : (() => {
        try {
          const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
          return new URL(normalized);
        } catch {
          return null;
        }
      })();

  if (!candidate?.username && !candidate?.password) {
    return adminUrlCheckDisplayText(url);
  }

  candidate.username = '';
  candidate.password = '';
  return adminUrlCheckDisplayText(candidate.toString());
};

const ADMIN_ACTOR_NETID_RE = /^[A-Za-z0-9]{2,12}$/;

const adminActorNetid = (value: unknown): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ADMIN_ACTOR_NETID_RE.test(normalized) ? normalized : '';
};

const currentActorNetid = (req: Request) =>
  adminActorNetid((req.user as any)?.netId) || adminActorNetid((req.user as any)?.netid);

export const resolveAdminSortField = (
  value: unknown,
  allowedFields: ReadonlySet<string>,
  fallback: string,
) => (typeof value === 'string' && allowedFields.has(value) ? value : fallback);

export const normalizeAdminPagination = (
  page: unknown,
  pageSize: unknown,
): { page: number; pageSize: number } => {
  const parseCompactPositiveInteger = (value: unknown, fallback: number): number => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string' && typeof value !== 'number') return fallback;

    const raw = typeof value === 'number' ? String(value) : value.trim();
    if (!raw || raw.length > MAX_ADMIN_PAGINATION_PARAM_LENGTH) return fallback;

    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    page: Math.min(MAX_ADMIN_LIST_PAGE, parseCompactPositiveInteger(page, 1)),
    pageSize: Math.min(MAX_ADMIN_LIST_PAGE_SIZE, parseCompactPositiveInteger(pageSize, 25)),
  };
};

export const normalizeAdminSearchTerm = (
  value: unknown,
): { searchTerm: string; errorCode?: AdminSearchErrorCode } => {
  if (value === undefined || value === null) return { searchTerm: '' };
  if (typeof value !== 'string') {
    return { searchTerm: '', errorCode: 'notString' };
  }

  if (value.length > MAX_ADMIN_SEARCH_QUERY_LENGTH) {
    return { searchTerm: '', errorCode: 'tooLong' };
  }

  const searchTerm = value.trim();
  if (searchTerm.length > MAX_ADMIN_SEARCH_QUERY_LENGTH) {
    return { searchTerm: '', errorCode: 'tooLong' };
  }

  return { searchTerm };
};

const MAX_RESEARCH_AREA_NAME_LENGTH = 120;

export const normalizeAdminTaxonomyLabel = (
  value: unknown,
  fieldName: string,
  maxLength = MAX_ADMIN_TAXONOMY_LABEL_LENGTH,
): string => {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${fieldName}`);
  }

  const normalized = replaceAsciiControls(value, ' ').replace(/\s+/g, ' ').trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    redactDirectContactInfo(normalized) !== normalized
  ) {
    throw new Error(`Invalid ${fieldName}`);
  }

  return normalized;
};

export const normalizeAdminDepartmentCategory = (value: unknown): DepartmentCategory => {
  if (!Object.values(DepartmentCategory).includes(value as DepartmentCategory)) {
    throw new Error('Invalid department category');
  }
  return value as DepartmentCategory;
};

export const normalizeAdminDepartmentCategories = (
  value: unknown,
  fallbackPrimaryCategory?: DepartmentCategory,
): DepartmentCategory[] => {
  const rawValues =
    value === undefined ? [fallbackPrimaryCategory] : Array.isArray(value) ? value : [value];
  if (rawValues.length === 0 || rawValues.length > MAX_ADMIN_DEPARTMENT_CATEGORIES) {
    throw new Error('Invalid department categories');
  }

  const categories = Array.from(
    new Set(rawValues.map((category) => normalizeAdminDepartmentCategory(category))),
  );
  if (categories.length === 0) {
    throw new Error('Invalid department categories');
  }
  return categories;
};

const sendAdminGrantError = (res: Response, error: unknown, fallbackMessage: string) => {
  const isValidationFailure = error instanceof AdminGrantValidationError;
  res.status(isValidationFailure ? 400 : 500).json({
    error: isValidationFailure ? 'Invalid admin grant request' : fallbackMessage,
  });
};

router.get('/admin-grants', async (_req: Request, res: Response) => {
  try {
    res.json(await listAdminGrants());
  } catch (error) {
    console.error('Admin: Error fetching admin grants:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch admin grants' });
  }
});

router.post('/admin-grants', async (req: Request, res: Response) => {
  try {
    const grant = await grantAdminAccess({
      netid: req.body?.netid,
      actorNetid: currentActorNetid(req),
      note: req.body?.note,
    });
    res.status(201).json({ grant });
  } catch (error) {
    sendAdminGrantError(res, error, 'Failed to grant admin access');
  }
});

router.post(
  '/admin-grants/:netid/revoke',
  validateNetid('netid'),
  async (req: Request, res: Response) => {
    try {
      const grant = await revokeAdminAccess({
        netid: req.params.netid,
        actorNetid: currentActorNetid(req),
        note: req.body?.note,
      });
      if (!grant) return res.status(404).json({ error: 'Active admin grant not found' });
      res.json({ grant });
    } catch (error) {
      sendAdminGrantError(res, error, 'Failed to revoke admin access');
    }
  },
);

router.get('/operator-board', async (_req: Request, res: Response) => {
  try {
    res.json(await buildAdminOperatorBoard());
  } catch (error) {
    console.error('Admin: Error fetching operator board:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch operator board' });
  }
});

router.get('/release-queue', async (req: Request, res: Response) => {
  try {
    res.json(
      await listVisibilityReleaseQueue({
        collection:
          req.query.collection === 'research' || req.query.collection === 'programs'
            ? req.query.collection
            : undefined,
        reason: typeof req.query.reason === 'string' ? req.query.reason : undefined,
        sourceName: typeof req.query.sourceName === 'string' ? req.query.sourceName : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        page: req.query.page,
        pageSize: req.query.pageSize,
      }),
    );
  } catch (error) {
    console.error('Admin: Error fetching release queue:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch release queue' });
  }
});

router.get('/access-review', async (req: Request, res: Response) => {
  try {
    const result = await listAccessReviewEntities({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof AccessReviewRequestError) {
      return res.status(400).json({ error: 'Search query is too long' });
    }
    console.error('Admin: Error fetching access review entities:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch access review entities' });
  }
});

router.get('/access-review/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const result = await getAccessReviewEntity(req.params.id);
    if (!result) return res.status(404).json({ error: 'Research entity not found' });
    res.json(result);
  } catch (error) {
    console.error('Admin: Error fetching access review entity:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch access review entity' });
  }
});

router.put(
  '/access-review/:id/manual-locks',
  validateObjectId('id'),
  async (req: Request, res: Response) => {
    try {
      const group = await updateAccessReviewManualLocks(req.params.id, req.body?.fields);
      if (!group) return res.status(400).json({ error: 'Invalid manual lock fields' });
      res.json({ group });
    } catch (error) {
      console.error('Admin: Error updating access review manual locks:', sanitizeLogValue(error));
      res.status(400).json({ error: 'Request failed' });
    }
  },
);

router.put(
  '/access-review/records/:type/:recordId/review',
  validateObjectId('recordId'),
  async (req: Request, res: Response) => {
    try {
      const type = typeof req.params.type === 'string' ? req.params.type : '';
      if (!ACCESS_REVIEW_RECORD_TYPES.has(type)) {
        return res.status(400).json({ error: 'Invalid review record type' });
      }

      const record = await updateAccessReviewRecordReview({
        type: type as any,
        id: req.params.recordId,
        status: req.body?.status,
        note: req.body?.note,
        lockedFields: req.body?.lockedFields,
        reviewerId: (req.user as any)?._id,
      });
      if (!record) return res.status(400).json({ error: 'Invalid review update' });
      res.json({ record: adminAccessReviewRecordUpdateDto(record) });
    } catch (error) {
      console.error('Admin: Error updating access review record:', sanitizeLogValue(error));
      res.status(400).json({ error: 'Request failed' });
    }
  },
);

router.get('/listing-claims', listAdminListingClaimRequests);
router.get('/listing-claims/:id', validateObjectId('id'), getAdminListingClaimRequest);
router.put('/listing-claims/:id', validateObjectId('id'), reviewAdminListingClaimRequest);

router.get('/listings', async (req: Request, res: Response) => {
  try {
    const {
      search,
      sortBy: rawSortBy = 'createdAt',
      sortOrder = 'desc',
      page = '1',
      pageSize = '25',
      archived,
      confirmed,
      audited,
    } = req.query;

    const filter: any = {};

    if (archived === 'true') filter.archived = true;
    else if (archived === 'false') filter.archived = false;

    if (confirmed === 'true') filter.confirmed = true;
    else if (confirmed === 'false') filter.confirmed = false;

    if (audited === 'true') filter.audited = true;
    else if (audited === 'false') filter.audited = { $ne: true };

    const adminSearch = normalizeAdminSearchTerm(search);
    if (adminSearch.errorCode) {
      return res.status(400).json({ error: ADMIN_SEARCH_ERROR_MESSAGES[adminSearch.errorCode] });
    }

    if (adminSearch.searchTerm) {
      const searchRegex = buildSafeSearchRegex(adminSearch.searchTerm);
      filter.$or = [
        { title: searchRegex },
        { ownerFirstName: searchRegex },
        { ownerLastName: searchRegex },
        { description: searchRegex },
        { ownerId: searchRegex },
      ];
    }

    const { page: pageNum, pageSize: pageSizeNum } = normalizeAdminPagination(page, pageSize);

    const sort: any = {};
    const order = sortOrder === 'asc' ? 1 : -1;
    const sortBy = resolveAdminSortField(rawSortBy, ADMIN_LISTING_SORT_FIELDS, 'createdAt');

    if (sortBy === 'descriptionLength') {
      const pipeline: any[] = [
        { $match: filter },
        {
          $addFields: {
            descriptionLength: {
              $cond: {
                if: { $isArray: '$description' },
                then: 0,
                else: { $strLenCP: { $ifNull: ['$description', ''] } },
              },
            },
          },
        },
        { $sort: { descriptionLength: order, _id: 1 } },
        { $skip: (pageNum - 1) * pageSizeNum },
        { $limit: pageSizeNum },
        { $project: { embedding: 0 } },
      ];

      const [results, countResult] = await Promise.all([
        getListingModel().aggregate(pipeline),
        getListingModel().countDocuments(filter),
      ]);

      return res.json({
        listings: results.map(adminListingDto),
        total: countResult,
        page: pageNum,
        pageSize: pageSizeNum,
        totalPages: Math.ceil(countResult / pageSizeNum),
      });
    }

    if (sortBy === 'redFlags') {
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

      const pipeline: any[] = [
        { $match: filter },
        {
          $addFields: {
            redFlagScore: {
              $add: [
                {
                  $cond: [
                    {
                      $or: [
                        { $eq: [{ $size: { $ifNull: ['$departments', []] } }, 0] },
                        { $eq: ['$departments', null] },
                      ],
                    },
                    10,
                    0,
                  ],
                },
                { $cond: [{ $eq: [{ $ifNull: ['$views', 0] }, 0] }, 5, 0] },
                {
                  $cond: [
                    {
                      $and: [
                        { $gt: [{ $ifNull: ['$views', 0] }, 0] },
                        { $lte: [{ $ifNull: ['$views', 0] }, 5] },
                      ],
                    },
                    2,
                    0,
                  ],
                },
                { $cond: [{ $lt: ['$createdAt', twoYearsAgo] }, 5, 0] },
                {
                  $cond: [
                    {
                      $or: [
                        { $eq: [{ $size: { $ifNull: ['$researchAreas', []] } }, 0] },
                        { $eq: ['$researchAreas', null] },
                      ],
                    },
                    3,
                    0,
                  ],
                },
                {
                  $cond: [{ $lt: [{ $strLenCP: { $ifNull: ['$description', ''] } }, 100] }, 2, 0],
                },
              ],
            },
          },
        },
        { $sort: { redFlagScore: order, _id: 1 } },
        { $skip: (pageNum - 1) * pageSizeNum },
        { $limit: pageSizeNum },
        { $project: { embedding: 0 } },
      ];

      const [results, countResult] = await Promise.all([
        getListingModel().aggregate(pipeline),
        getListingModel().countDocuments(filter),
      ]);

      return res.json({
        listings: results.map(adminListingDto),
        total: countResult,
        page: pageNum,
        pageSize: pageSizeNum,
        totalPages: Math.ceil(countResult / pageSizeNum),
      });
    }

    sort[/^[A-Za-z0-9_]+$/.test(String(sortBy)) ? String(sortBy) : 'createdAt'] = order;
    sort._id = 1;

    const [listings, total] = await Promise.all([
      getListingModel()
        .find(filter)
        .select('-embedding')
        .sort(sort)
        .skip((pageNum - 1) * pageSizeNum)
        .limit(pageSizeNum)
        .lean(),
      getListingModel().countDocuments(filter),
    ]);

    res.json({
      listings: listings.map(adminListingDto),
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
    });
  } catch (error) {
    console.error('Admin: Error fetching listings:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

router.put('/listings/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const safeId = normalizeAdminObjectId(req.params.id);
    if (!safeId) return res.status(400).json({ error: 'Invalid id' });
    const currentUser = req.user as { netId?: string };
    const { data, resetCreatedAt } = req.body;

    let listing = await updateListing(safeId, currentUser.netId as string, data, true);

    if (resetCreatedAt && listing) {
      const originalDate = new Date(listing.createdAt);
      const newCreatedAt = new Date(2025, originalDate.getMonth(), originalDate.getDate());

      await getListingModel().collection.updateOne(
        { _id: new mongoose.Types.ObjectId(safeId) },
        { $set: { createdAt: newCreatedAt } },
      );
      listing = await getListingModel().findById(safeId).lean();
    }

    res.json({ listing: adminListingDto(listing) });
  } catch (error) {
    console.error('Admin: Error updating listing:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

router.delete('/listings/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const safeId = normalizeAdminObjectId(req.params.id);
    if (!safeId) return res.status(400).json({ error: 'Invalid id' });
    await deleteListing(safeId);
    res.json({ message: 'Listing deleted' });
  } catch (error) {
    console.error('Admin: Error deleting listing:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

router.get('/research-areas', async (_req: Request, res: Response) => {
  try {
    const areas = await ResearchArea.find().sort({ name: 1 }).lean();
    res.json({ researchAreas: areas.map(adminResearchAreaDto) });
  } catch (error) {
    console.error('Admin: Error fetching research areas:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch research areas' });
  }
});

router.put('/research-areas/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const safeId = normalizeAdminObjectId(req.params.id);
    if (!safeId) return res.status(400).json({ error: 'Invalid id' });
    const { name, field } = req.body;
    const update: any = {};

    if (name !== undefined) {
      update.name = normalizeAdminTaxonomyLabel(
        name,
        'research area name',
        MAX_RESEARCH_AREA_NAME_LENGTH,
      );
    }
    if (field !== undefined) {
      if (!Object.values(ResearchField).includes(field)) {
        return res.status(400).json({ error: 'Invalid field value' });
      }
      update.field = field;
      update.colorKey = fieldColorKeys[field as ResearchField] || 'gray';
    }

    const area = await ResearchArea.findByIdAndUpdate(safeId, update, {
      new: true,
      runValidators: true,
    });

    if (!area) {
      return res.status(404).json({ error: 'Research area not found' });
    }

    invalidateConfigCache();
    res.json({ researchArea: adminResearchAreaDto(area) });
  } catch (error) {
    console.error('Admin: Error updating research area:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

router.delete(
  '/research-areas/:id',
  validateObjectId('id'),
  async (req: Request, res: Response) => {
    try {
      const safeId = normalizeAdminObjectId(req.params.id);
      if (!safeId) return res.status(400).json({ error: 'Invalid id' });
      const area = await ResearchArea.findByIdAndDelete(safeId);
      if (!area) {
        return res.status(404).json({ error: 'Research area not found' });
      }

      invalidateConfigCache();
      res.json({ message: 'Research area deleted' });
    } catch (error) {
      console.error('Admin: Error deleting research area:', sanitizeLogValue(error));
      res.status(400).json({ error: 'Request failed' });
    }
  },
);

router.get('/departments', async (_req: Request, res: Response) => {
  try {
    const departments = await Department.find().sort({ abbreviation: 1 }).lean();
    res.json({ departments: departments.map(adminDepartmentDto) });
  } catch (error) {
    console.error('Admin: Error fetching departments:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

router.post('/departments', async (req: Request, res: Response) => {
  try {
    const { abbreviation, name, displayName, categories, primaryCategory } = req.body;

    if (!abbreviation || !name || !primaryCategory) {
      return res
        .status(400)
        .json({ error: 'abbreviation, name, and primaryCategory are required' });
    }

    const normalizedAbbreviation = normalizeAdminTaxonomyLabel(
      abbreviation,
      'department abbreviation',
      MAX_ADMIN_DEPARTMENT_ABBREVIATION_LENGTH,
    );
    const normalizedName = normalizeAdminTaxonomyLabel(name, 'department name');
    const normalizedPrimaryCategory = normalizeAdminDepartmentCategory(primaryCategory);
    const normalizedCategories = normalizeAdminDepartmentCategories(
      categories,
      normalizedPrimaryCategory,
    );
    const normalizedDisplayName =
      displayName !== undefined
        ? normalizeAdminTaxonomyLabel(displayName, 'department display name')
        : `${normalizedAbbreviation} - ${normalizedName}`;
    const colorKey = categoryColorKeys[normalizedPrimaryCategory] ?? 0;

    const dept = new Department({
      abbreviation: normalizedAbbreviation,
      name: normalizedName,
      displayName: normalizedDisplayName,
      categories: normalizedCategories,
      primaryCategory: normalizedPrimaryCategory,
      colorKey,
    });

    await dept.save();
    invalidateConfigCache();
    res.status(201).json({ department: adminDepartmentDto(dept) });
  } catch (error) {
    console.error('Admin: Error creating department:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

router.put('/departments/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const safeId = normalizeAdminObjectId(req.params.id);
    if (!safeId) return res.status(400).json({ error: 'Invalid id' });
    const { abbreviation, name, displayName, categories, primaryCategory, isActive } = req.body;
    const update: any = {};

    if (abbreviation !== undefined) {
      update.abbreviation = normalizeAdminTaxonomyLabel(
        abbreviation,
        'department abbreviation',
        MAX_ADMIN_DEPARTMENT_ABBREVIATION_LENGTH,
      );
    }
    if (name !== undefined) update.name = normalizeAdminTaxonomyLabel(name, 'department name');
    if (displayName !== undefined) {
      update.displayName = normalizeAdminTaxonomyLabel(displayName, 'department display name');
    }
    if (categories !== undefined)
      update.categories = normalizeAdminDepartmentCategories(categories);
    if (primaryCategory !== undefined) {
      const normalizedPrimaryCategory = normalizeAdminDepartmentCategory(primaryCategory);
      update.primaryCategory = normalizedPrimaryCategory;
      update.colorKey = categoryColorKeys[normalizedPrimaryCategory] ?? 0;
    }
    if (isActive !== undefined) update.isActive = isActive === true;

    const dept = await Department.findByIdAndUpdate(safeId, update, {
      new: true,
      runValidators: true,
    });

    if (!dept) {
      return res.status(404).json({ error: 'Department not found' });
    }

    invalidateConfigCache();
    res.json({ department: adminDepartmentDto(dept) });
  } catch (error) {
    console.error('Admin: Error updating department:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

router.delete('/departments/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const safeId = normalizeAdminObjectId(req.params.id);
    if (!safeId) return res.status(400).json({ error: 'Invalid id' });
    const dept = await Department.findByIdAndDelete(safeId);
    if (!dept) {
      return res.status(404).json({ error: 'Department not found' });
    }

    invalidateConfigCache();
    res.json({ message: 'Department deleted' });
  } catch (error) {
    console.error('Admin: Error deleting department:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

const requestHead = (parsed: URL): Promise<{ status: number; reachable: boolean }> =>
  new Promise((resolve, reject) => {
    const client = parsed.protocol === 'https:' ? https : http;
    const agent =
      parsed.protocol === 'https:'
        ? new https.Agent({ lookup: ssrfSafeLookup })
        : new http.Agent({ lookup: ssrfSafeLookup });

    const req = client.request(
      parsed,
      {
        method: 'HEAD',
        agent,
        timeout: ADMIN_URL_CHECK_TIMEOUT_MS,
        headers: {
          'User-Agent': 'YaleResearchAdminUrlCheck/1.0',
        },
      },
      (response) => {
        response.resume();
        resolve({
          status: response.statusCode || 0,
          reachable: Boolean(
            response.statusCode && response.statusCode >= 200 && response.statusCode < 300,
          ),
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('Timeout'), { name: 'AbortError' }));
    });
    req.on('error', reject);
    req.end();
  });

export const checkAdminUrlReachability = async (url: string): Promise<AdminUrlCheckResult> => {
  let displayUrl = adminUrlCheckDisplayUrl(url);
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0 || url.length > MAX_ADMIN_URL_CHECK_URL_LENGTH) {
    return { url: displayUrl, status: 0, reachable: false, error: 'URL too long' };
  }
  if (hasUnsafeAdminUrlInput(trimmedUrl)) {
    return { url: displayUrl, status: 0, reachable: false, error: 'Invalid URL' };
  }

  try {
    let normalizedUrl = trimmedUrl;
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    let parsed: URL;
    try {
      parsed = new URL(normalizedUrl);
      displayUrl = adminUrlCheckDisplayUrl(url, parsed);
    } catch {
      return { url: displayUrl, status: 0, reachable: false, error: 'Invalid URL' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url: displayUrl, status: 0, reachable: false, error: 'Unsupported scheme' };
    }

    if (parsed.username || parsed.password) {
      return { url: displayUrl, status: 0, reachable: false, error: 'Credentials not supported' };
    }

    if (!ADMIN_URL_CHECK_ALLOWED_PORTS.has(parsed.port)) {
      return { url: displayUrl, status: 0, reachable: false, error: 'Unsupported port' };
    }

    if (!(await isPublicHostname(parsed.hostname))) {
      return { url: displayUrl, status: 0, reachable: false, error: 'Blocked host' };
    }

    const result = await requestHead(parsed);
    return { url: displayUrl, ...result };
  } catch (err: any) {
    return {
      url: displayUrl,
      status: 0,
      reachable: false,
      error: err.name === 'AbortError' ? 'Timeout' : 'Unreachable',
    };
  }
};

router.post('/check-urls', async (req: Request, res: Response) => {
  try {
    const { urls } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'urls array is required' });
    }

    if (urls.length > MAX_ADMIN_URL_CHECK_URLS) {
      return res
        .status(400)
        .json({ error: `At most ${MAX_ADMIN_URL_CHECK_URLS} URLs can be checked at once` });
    }

    const normalizedInputs: string[] = [];
    for (const value of urls) {
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'Each URL must be a string' });
      }
      const trimmed = value.trim();
      if (trimmed.length === 0 || trimmed.length > MAX_ADMIN_URL_CHECK_URL_LENGTH) {
        return res.status(400).json({ error: 'Each URL must be between 1 and 2048 characters' });
      }
      if (hasUnsafeAdminUrlInput(trimmed)) {
        return res.status(400).json({ error: 'Each URL must be a canonical HTTP(S) URL' });
      }
      normalizedInputs.push(trimmed);
    }

    const urlsToCheck = Array.from(new Set(normalizedInputs));

    const results = await Promise.all(urlsToCheck.map(checkAdminUrlReachability));

    res.json({ results });
  } catch (error) {
    console.error('Admin: Error checking URLs:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to check URLs' });
  }
});

router.get('/profiles', async (req: Request, res: Response) => {
  try {
    const {
      search,
      sortBy: rawSortBy = 'lname',
      sortOrder = 'asc',
      page = '1',
      pageSize = '25',
      profileVerified,
      hasListings,
    } = req.query;

    const filter: any = {
      userType: { $in: ['professor', 'faculty'] },
    };

    if (profileVerified === 'true') filter.profileVerified = true;
    else if (profileVerified === 'false') filter.profileVerified = { $ne: true };

    if (hasListings === 'true') filter.ownListings = { $exists: true, $not: { $size: 0 } };
    else if (hasListings === 'false')
      filter.$or = [{ ownListings: { $exists: false } }, { ownListings: { $size: 0 } }];

    const adminSearch = normalizeAdminSearchTerm(search);
    if (adminSearch.errorCode) {
      return res.status(400).json({ error: ADMIN_SEARCH_ERROR_MESSAGES[adminSearch.errorCode] });
    }

    if (adminSearch.searchTerm) {
      const searchRegex = buildSafeSearchRegex(adminSearch.searchTerm);
      const searchOr = [
        { fname: searchRegex },
        { lname: searchRegex },
        { netid: searchRegex },
        { email: searchRegex },
        { primaryDepartment: searchRegex },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    const { page: pageNum, pageSize: pageSizeNum } = normalizeAdminPagination(page, pageSize);

    const sort: any = {};
    const order = sortOrder === 'asc' ? 1 : -1;
    const sortBy = resolveAdminSortField(rawSortBy, ADMIN_PROFILE_SORT_FIELDS, 'lname');
    sort[/^[A-Za-z0-9_]+$/.test(String(sortBy)) ? String(sortBy) : 'lname'] = order;
    sort._id = 1;

    const [profiles, total] = await Promise.all([
      User.find(filter)
        .select('-publications')
        .sort(sort)
        .skip((pageNum - 1) * pageSizeNum)
        .limit(pageSizeNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      profiles: profiles.map((profile) => adminProfileDto(profile)),
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
    });
  } catch (error: any) {
    console.error('Admin: Error fetching profiles:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

router.get('/profiles/:netid', validateNetid('netid'), async (req: Request, res: Response) => {
  try {
    const user = await User.findOne({ netid: req.params.netid }).select('+publications').lean();

    if (!user) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ profile: adminProfileDto(user, true) });
  } catch (error: any) {
    console.error('Admin: Error fetching profile:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.put('/profiles/:netid', validateNetid('netid'), async (req: Request, res: Response) => {
  try {
    const data = req.body?.data;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Missing data payload' });
    }

    const profile = await adminUpdateProfile(req.params.netid, data);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    if (data.primaryDepartment !== undefined || data.secondaryDepartments !== undefined) {
      await cascadeDepartmentsToListings(req.params.netid);
    }

    res.json({ profile: adminProfileDto(profile) });
  } catch (error: any) {
    console.error('Admin: Error updating profile:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

router.get('/fellowships', async (req: Request, res: Response) => {
  try {
    const {
      search,
      sortBy: rawSortBy = 'createdAt',
      sortOrder = 'desc',
      page = '1',
      pageSize = '25',
      archived,
      audited,
    } = req.query;

    const filter: any = {};

    if (archived === 'true') filter.archived = true;
    else if (archived === 'false') filter.archived = false;

    if (audited === 'true') filter.audited = true;
    else if (audited === 'false') filter.audited = { $ne: true };

    const adminSearch = normalizeAdminSearchTerm(search);
    if (adminSearch.errorCode) {
      return res.status(400).json({ error: ADMIN_SEARCH_ERROR_MESSAGES[adminSearch.errorCode] });
    }

    if (adminSearch.searchTerm) {
      const searchRegex = buildSafeSearchRegex(adminSearch.searchTerm);
      filter.$or = [
        { title: searchRegex },
        { summary: searchRegex },
        { description: searchRegex },
        { contactEmail: searchRegex },
      ];
    }

    const { page: pageNum, pageSize: pageSizeNum } = normalizeAdminPagination(page, pageSize);

    const sort: any = {};
    const order = sortOrder === 'asc' ? 1 : -1;
    const sortBy = resolveAdminSortField(rawSortBy, ADMIN_FELLOWSHIP_SORT_FIELDS, 'createdAt');
    sort[/^[A-Za-z0-9_]+$/.test(String(sortBy)) ? String(sortBy) : 'createdAt'] = order;
    sort._id = 1;

    const [fellowships, total] = await Promise.all([
      Fellowship.find(filter)
        .sort(sort)
        .skip((pageNum - 1) * pageSizeNum)
        .limit(pageSizeNum)
        .lean(),
      Fellowship.countDocuments(filter),
    ]);

    res.json({
      fellowships: fellowships.map(adminFellowshipDto),
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
    });
  } catch (error) {
    console.error('Admin: Error fetching fellowships:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch fellowships' });
  }
});

router.put('/fellowships/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const fellowship = await updateFellowship(req.params.id, req.body.data);
    res.json({ fellowship: adminFellowshipDto(fellowship) });
  } catch (error) {
    console.error('Admin: Error updating fellowship:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

router.put(
  '/fellowships/:id/archive',
  validateObjectId('id'),
  async (req: Request, res: Response) => {
    try {
      const fellowship = await archiveFellowship(req.params.id);
      res.json({ fellowship: adminFellowshipDto(fellowship) });
    } catch (error) {
      console.error('Admin: Error archiving fellowship:', sanitizeLogValue(error));
      res.status(400).json({ error: 'Request failed' });
    }
  },
);

router.put(
  '/fellowships/:id/unarchive',
  validateObjectId('id'),
  async (req: Request, res: Response) => {
    try {
      const fellowship = await unarchiveFellowship(req.params.id);
      res.json({ fellowship: adminFellowshipDto(fellowship) });
    } catch (error) {
      console.error('Admin: Error unarchiving fellowship:', sanitizeLogValue(error));
      res.status(400).json({ error: 'Request failed' });
    }
  },
);

router.delete('/fellowships/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    await deleteFellowship(req.params.id);
    res.json({ message: 'Fellowship deleted' });
  } catch (error) {
    console.error('Admin: Error deleting fellowship:', sanitizeLogValue(error));
    res.status(400).json({ error: 'Request failed' });
  }
});

export default router;
