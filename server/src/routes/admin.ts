/**
 * Admin-only routes for managing listings, fellowships, users, and profiles.
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import http from 'http';
import https from 'https';
import { isPrivateAddress, isPublicHostname, ssrfSafeLookup } from '../utils/ssrfGuard';
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
import { adminUpdateProfile, cascadeDepartmentsToListings } from '../services/profileService';
import { buildSafeSearchRegex } from '../utils/regex';
import {
  getAccessReviewEntity,
  listAccessReviewEntities,
  updateAccessReviewManualLocks,
  updateAccessReviewRecordReview,
} from '../services/adminAccessReviewService';
import {
  grantAdminAccess,
  listAdminGrants,
  revokeAdminAccess,
} from '../services/adminGrantService';
import { buildAdminOperatorBoard } from '../services/adminOperatorBoardService';
import { listVisibilityReleaseQueue } from '../services/studentVisibilityGateService';

const router = Router();

function setPrivateAdminCacheHeaders(_req: Request, res: Response, next: () => void) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
}

router.use(setPrivateAdminCacheHeaders, isAuthenticated, isAdmin);

export const MAX_ADMIN_URL_CHECK_URLS = 25;
export const MAX_ADMIN_URL_CHECK_URL_LENGTH = 2048;
export const ADMIN_URL_CHECK_TIMEOUT_MS = 10000;
const MAX_ADMIN_LIST_PAGE = 1000;
const MAX_ADMIN_LIST_PAGE_SIZE = 100;
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
const MAX_ADMIN_SEARCH_QUERY_LENGTH = 120;

interface AdminUrlCheckResult {
  url: string;
  status: number;
  reachable: boolean;
  error?: string;
}

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
    return url;
  }

  candidate.username = '';
  candidate.password = '';
  return candidate.toString();
};

const currentActorNetid = (req: Request) =>
  String((req.user as any)?.netId || (req.user as any)?.netid || '').trim().toLowerCase();

export const resolveAdminSortField = (
  value: unknown,
  allowedFields: ReadonlySet<string>,
  fallback: string,
) => (typeof value === 'string' && allowedFields.has(value) ? value : fallback);

export const normalizeAdminPagination = (
  page: unknown,
  pageSize: unknown,
): { page: number; pageSize: number } => ({
  page: Math.min(MAX_ADMIN_LIST_PAGE, Math.max(1, parseInt(String(page), 10) || 1)),
  pageSize: Math.min(
    MAX_ADMIN_LIST_PAGE_SIZE,
    Math.max(1, parseInt(String(pageSize), 10) || 25),
  ),
});

export const normalizeAdminSearchTerm = (
  value: unknown,
): { searchTerm: string; error?: string } => {
  if (value === undefined || value === null) return { searchTerm: '' };
  if (typeof value !== 'string') {
    return { searchTerm: '', error: 'Search query must be a string' };
  }

  const searchTerm = value.trim();
  if (searchTerm.length > MAX_ADMIN_SEARCH_QUERY_LENGTH) {
    return { searchTerm: '', error: 'Search query is too long' };
  }

  return { searchTerm };
};

const sendAdminGrantError = (
  res: Response,
  error: unknown,
  fallbackMessage: string,
) => {
  const message = error instanceof Error ? error.message : '';
  const isValidationFailure = message.startsWith('Invalid');
  res.status(isValidationFailure ? 400 : 500).json({
    error: isValidationFailure ? 'Invalid admin grant request' : fallbackMessage,
  });
};

router.get('/admin-grants', async (_req: Request, res: Response) => {
  try {
    res.json(await listAdminGrants());
  } catch (error) {
    console.error('Admin: Error fetching admin grants:', error);
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
    console.error('Admin: Error fetching operator board:', error);
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
        page: Number(req.query.page),
        pageSize: Number(req.query.pageSize),
      }),
    );
  } catch (error) {
    console.error('Admin: Error fetching release queue:', error);
    res.status(500).json({ error: 'Failed to fetch release queue' });
  }
});

router.get('/access-review', async (req: Request, res: Response) => {
  try {
    const result = await listAccessReviewEntities({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
    });
    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Search query is too long') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Admin: Error fetching access review entities:', error);
    res.status(500).json({ error: 'Failed to fetch access review entities' });
  }
});

router.get(
  '/access-review/:id',
  validateObjectId('id'),
  async (req: Request, res: Response) => {
    try {
      const result = await getAccessReviewEntity(req.params.id);
      if (!result) return res.status(404).json({ error: 'Research entity not found' });
      res.json(result);
    } catch (error) {
      console.error('Admin: Error fetching access review entity:', error);
      res.status(500).json({ error: 'Failed to fetch access review entity' });
    }
  },
);

router.put(
  '/access-review/:id/manual-locks',
  validateObjectId('id'),
  async (req: Request, res: Response) => {
    try {
      const group = await updateAccessReviewManualLocks(req.params.id, req.body?.fields);
      if (!group) return res.status(400).json({ error: 'Invalid manual lock fields' });
      res.json({ group });
    } catch (error) {
      console.error('Admin: Error updating access review manual locks:', error);
      res.status(400).json({ error: 'Request failed' });
    }
  },
);

router.put(
  '/access-review/records/:type/:recordId/review',
  validateObjectId('recordId'),
  async (req: Request, res: Response) => {
    try {
      const record = await updateAccessReviewRecordReview({
        type: req.params.type as any,
        id: req.params.recordId,
        status: req.body?.status,
        note: req.body?.note,
        lockedFields: req.body?.lockedFields,
        reviewerId: (req.user as any)?._id,
      });
      if (!record) return res.status(400).json({ error: 'Invalid review update' });
      res.json({ record });
    } catch (error) {
      console.error('Admin: Error updating access review record:', error);
      res.status(400).json({ error: 'Request failed' });
    }
  },
);

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
    if (adminSearch.error) return res.status(400).json({ error: adminSearch.error });

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
        listings: results,
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
        listings: results,
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
      listings,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
    });
  } catch (error) {
    console.error('Admin: Error fetching listings:', error);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

router.put('/listings/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user as { netId?: string };
    const { data, resetCreatedAt } = req.body;

    let listing = await updateListing(req.params.id, currentUser.netId as string, data, true);

    if (resetCreatedAt && listing) {
      const originalDate = new Date(listing.createdAt);
      const newCreatedAt = new Date(2025, originalDate.getMonth(), originalDate.getDate());

      await getListingModel().collection.updateOne(
        { _id: new mongoose.Types.ObjectId(req.params.id) },
        { $set: { createdAt: newCreatedAt } },
      );
      listing = await getListingModel().findById(req.params.id).lean();
    }

    res.json({ listing });
  } catch (error) {
    console.error('Admin: Error updating listing:', error);
    res.status(400).json({ error: 'Request failed' });
  }
});

router.delete('/listings/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    await deleteListing(req.params.id);
    res.json({ message: 'Listing deleted' });
  } catch (error) {
    console.error('Admin: Error deleting listing:', error);
    res.status(400).json({ error: 'Request failed' });
  }
});

router.get('/research-areas', async (_req: Request, res: Response) => {
  try {
    const areas = await ResearchArea.find().sort({ name: 1 }).lean();
    res.json({ researchAreas: areas });
  } catch (error) {
    console.error('Admin: Error fetching research areas:', error);
    res.status(500).json({ error: 'Failed to fetch research areas' });
  }
});

router.put('/research-areas/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const { name, field } = req.body;
    const update: any = {};

    if (name !== undefined) update.name = name.trim();
    if (field !== undefined) {
      if (!Object.values(ResearchField).includes(field)) {
        return res.status(400).json({ error: 'Invalid field value' });
      }
      update.field = field;
      update.colorKey = fieldColorKeys[field as ResearchField] || 'gray';
    }

    const area = await ResearchArea.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!area) {
      return res.status(404).json({ error: 'Research area not found' });
    }

    invalidateConfigCache();
    res.json({ researchArea: area });
  } catch (error) {
    console.error('Admin: Error updating research area:', error);
    res.status(400).json({ error: 'Request failed' });
  }
});

router.delete(
  '/research-areas/:id',
  validateObjectId('id'),
  async (req: Request, res: Response) => {
    try {
      const area = await ResearchArea.findByIdAndDelete(req.params.id);
      if (!area) {
        return res.status(404).json({ error: 'Research area not found' });
      }

      invalidateConfigCache();
      res.json({ message: 'Research area deleted' });
    } catch (error) {
      console.error('Admin: Error deleting research area:', error);
      res.status(400).json({ error: 'Request failed' });
    }
  },
);

router.get('/departments', async (_req: Request, res: Response) => {
  try {
    const departments = await Department.find().sort({ abbreviation: 1 }).lean();
    res.json({ departments });
  } catch (error) {
    console.error('Admin: Error fetching departments:', error);
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

    const colorKey = categoryColorKeys[primaryCategory as DepartmentCategory] ?? 0;

    const dept = new Department({
      abbreviation: abbreviation.trim(),
      name: name.trim(),
      displayName: displayName || `${abbreviation.trim()} - ${name.trim()}`,
      categories: categories || [primaryCategory],
      primaryCategory,
      colorKey,
    });

    await dept.save();
    invalidateConfigCache();
    res.status(201).json({ department: dept });
  } catch (error) {
    console.error('Admin: Error creating department:', error);
    res.status(400).json({ error: 'Request failed' });
  }
});

router.put('/departments/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const { abbreviation, name, displayName, categories, primaryCategory, isActive } = req.body;
    const update: any = {};

    if (abbreviation !== undefined) update.abbreviation = abbreviation.trim();
    if (name !== undefined) update.name = name.trim();
    if (displayName !== undefined) update.displayName = displayName.trim();
    if (categories !== undefined) update.categories = categories;
    if (primaryCategory !== undefined) {
      update.primaryCategory = primaryCategory;
      update.colorKey = categoryColorKeys[primaryCategory as DepartmentCategory] ?? 0;
    }
    if (isActive !== undefined) update.isActive = isActive;

    const dept = await Department.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!dept) {
      return res.status(404).json({ error: 'Department not found' });
    }

    invalidateConfigCache();
    res.json({ department: dept });
  } catch (error) {
    console.error('Admin: Error updating department:', error);
    res.status(400).json({ error: 'Request failed' });
  }
});

router.delete('/departments/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const dept = await Department.findByIdAndDelete(req.params.id);
    if (!dept) {
      return res.status(404).json({ error: 'Department not found' });
    }

    invalidateConfigCache();
    res.json({ message: 'Department deleted' });
  } catch (error) {
    console.error('Admin: Error deleting department:', error);
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
          reachable: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300),
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
  try {
    let normalizedUrl = url;
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
      normalizedInputs.push(trimmed);
    }

    const urlsToCheck = Array.from(new Set(normalizedInputs));

    const results = await Promise.all(urlsToCheck.map(checkAdminUrlReachability));

    res.json({ results });
  } catch (error) {
    console.error('Admin: Error checking URLs:', error);
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
    if (adminSearch.error) return res.status(400).json({ error: adminSearch.error });

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
      profiles,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
    });
  } catch (error: any) {
    console.error('Admin: Error fetching profiles:', error);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

router.get('/profiles/:netid', validateNetid('netid'), async (req: Request, res: Response) => {
  try {
    const user = await User.findOne({ netid: req.params.netid }).select('+publications').lean();

    if (!user) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ profile: user });
  } catch (error: any) {
    console.error('Admin: Error fetching profile:', error);
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

    res.json({ profile });
  } catch (error: any) {
    console.error('Admin: Error updating profile:', error);
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
    if (adminSearch.error) return res.status(400).json({ error: adminSearch.error });

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
      fellowships,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
    });
  } catch (error) {
    console.error('Admin: Error fetching fellowships:', error);
    res.status(500).json({ error: 'Failed to fetch fellowships' });
  }
});

router.put('/fellowships/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    const fellowship = await updateFellowship(req.params.id, req.body.data);
    res.json({ fellowship });
  } catch (error) {
    console.error('Admin: Error updating fellowship:', error);
    res.status(400).json({ error: 'Request failed' });
  }
});

router.put(
  '/fellowships/:id/archive',
  validateObjectId('id'),
  async (req: Request, res: Response) => {
    try {
      const fellowship = await archiveFellowship(req.params.id);
      res.json({ fellowship });
    } catch (error) {
      console.error('Admin: Error archiving fellowship:', error);
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
      res.json({ fellowship });
    } catch (error) {
      console.error('Admin: Error unarchiving fellowship:', error);
      res.status(400).json({ error: 'Request failed' });
    }
  },
);

router.delete('/fellowships/:id', validateObjectId('id'), async (req: Request, res: Response) => {
  try {
    await deleteFellowship(req.params.id);
    res.json({ message: 'Fellowship deleted' });
  } catch (error) {
    console.error('Admin: Error deleting fellowship:', error);
    res.status(400).json({ error: 'Request failed' });
  }
});

export default router;
