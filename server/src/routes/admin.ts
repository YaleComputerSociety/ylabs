/**
 * Admin-only routes for managing listings, fellowships, users, and profiles.
 */
import { Router, Request, Response } from 'express';
import dns from 'dns/promises';
import net from 'net';
import { isAuthenticated, isAdmin, validateObjectId, validateNetid } from '../middleware/index';
import { ResearchArea, ResearchField, fieldColorKeys } from '../models/researchArea';
import { Department, DepartmentCategory, categoryColorKeys } from '../models/department';
import { invalidateConfigCache } from '../services/configService';
import { Fellowship } from '../models/fellowship';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import { User } from '../models/user';
import {
  updateFellowship,
  deleteFellowship,
  archiveFellowship,
  unarchiveFellowship,
} from '../services/fellowshipService';
import { adminUpdateProfile } from '../services/profileService';
import { buildSafeSearchRegex } from '../utils/regex';
import {
  getAccessReviewEntity,
  listAccessReviewEntities,
  updateAccessReviewManualLocks,
  updateAccessReviewRecordReview,
} from '../services/adminAccessReviewService';
import { buildSourceHealthRows } from '../services/sourceHealthService';
import { buildAdminOperatorBoard } from '../services/adminOperatorBoardService';
import {
  AdminAccessError,
  grantAdminAccess,
  listAdminAccess,
  revokeAdminAccess,
} from '../services/adminAccessService';
import { getScrapeRunReport } from '../scrapers/runReport';

const router = Router();

router.use(isAuthenticated, isAdmin);

const retiredAdminListings = (_req: Request, res: Response) =>
  res.status(410).json({
    message:
      'Legacy listing administration has been retired. Use Yale Labs, Programs, and PostedOpportunity workflows instead.',
  });

router.all('/listings', retiredAdminListings);
router.all('/listings/:id', retiredAdminListings);

const NETID_RE = /^[A-Za-z0-9]{2,12}$/;

const currentAdminNetid = (req: Request): string =>
  String((req.user as any)?.netId || (req.user as any)?.netid || '').trim().toLowerCase();

const sendAdminAccessError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof AdminAccessError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(`Admin: ${fallback}:`, error);
  return res.status(500).json({ error: fallback });
};

router.get('/admin-grants', async (_req: Request, res: Response) => {
  try {
    res.json(await listAdminAccess());
  } catch (error) {
    console.error('Admin: Error fetching admin grants:', error);
    res.status(500).json({ error: 'Failed to fetch admin grants' });
  }
});

router.post('/admin-grants', async (req: Request, res: Response) => {
  try {
    const netid = String(req.body?.netid || '').trim();
    if (!NETID_RE.test(netid)) {
      return res.status(400).json({ error: 'Invalid netid' });
    }
    const grant = await grantAdminAccess({
      netid,
      actorNetid: currentAdminNetid(req),
      note: req.body?.note,
    });
    res.status(201).json({ grant });
  } catch (error) {
    sendAdminAccessError(res, error, 'Failed to grant admin access');
  }
});

router.post('/admin-grants/:netid/revoke', validateNetid('netid'), async (req: Request, res: Response) => {
  try {
    const grant = await revokeAdminAccess({
      netid: req.params.netid,
      actorNetid: currentAdminNetid(req),
      note: req.body?.note,
    });
    res.json({ grant });
  } catch (error) {
    sendAdminAccessError(res, error, 'Failed to revoke admin access');
  }
});

router.get('/operator-board', async (_req: Request, res: Response) => {
  try {
    res.json(await buildAdminOperatorBoard());
  } catch (error) {
    console.error('Admin: Error fetching operator board:', error);
    res.status(500).json({ error: 'Failed to fetch operator board' });
  }
});

router.get('/scraper-sources/health', async (req: Request, res: Response) => {
  try {
    const sourceName = typeof req.query.source === 'string' ? req.query.source.trim() : '';
    const days = Math.min(
      365,
      Math.max(1, Number.parseInt(String(req.query.days || '30'), 10) || 30),
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sourceFilter = sourceName ? { name: sourceName } : {};
    const runFilter: Record<string, unknown> = { startedAt: { $gte: since } };
    if (sourceName) runFilter.sourceName = sourceName;

    const [sources, runs] = await Promise.all([
      Source.find(sourceFilter)
        .select('name displayName enabled cadence coverage')
        .lean(),
      ScrapeRun.find(runFilter)
        .select(
          'sourceName status startedAt finishedAt observationCount materializationErrors materializationConflicts invalidated',
        )
        .sort({ startedAt: -1 })
        .lean(),
    ]);
    const rows = buildSourceHealthRows(sources as any[], runs as any[]);
    const riskCounts = rows.reduce(
      (acc, row) => {
        acc[row.risk] += 1;
        return acc;
      },
      { ok: 0, warn: 0, error: 0 },
    );

    res.json({
      generatedAt: new Date().toISOString(),
      windowDays: days,
      source: sourceName || undefined,
      riskCounts,
      rows,
    });
  } catch (error) {
    console.error('Admin: Error fetching scraper source health:', error);
    res.status(500).json({ error: 'Failed to fetch scraper source health' });
  }
});

router.get(
  '/scrape-runs/:id/report',
  validateObjectId('id'),
  async (req: Request, res: Response) => {
    try {
      res.json(await getScrapeRunReport(req.params.id));
    } catch (error: any) {
      const message = error?.message || 'Failed to fetch scrape run report';
      const status = /not found/i.test(message) ? 404 : 500;
      res.status(status).json({ error: message });
    }
  },
);

router.get('/access-review', async (req: Request, res: Response) => {
  try {
    const result = await listAccessReviewEntities({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
    });
    res.json(result);
  } catch (error) {
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

const isPrivateAddress = (addr: string): boolean => {
  const family = net.isIP(addr);
  if (family === 0) return true;
  if (family === 4) {
    const parts = addr.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }
  const lower = addr.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80:')) return true;
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return false;
};

const isPublicHostname = async (hostname: string): Promise<boolean> => {
  if (net.isIP(hostname)) return !isPrivateAddress(hostname);
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.length === 0) return false;
    return records.every((r) => !isPrivateAddress(r.address));
  } catch {
    return false;
  }
};

router.post('/check-urls', async (req: Request, res: Response) => {
  try {
    const { urls } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'urls array is required' });
    }

    const results = await Promise.all(
      urls.map(async (url: string) => {
        try {
          let normalizedUrl = url;
          if (!/^https?:\/\//.test(normalizedUrl)) {
            normalizedUrl = 'https://' + normalizedUrl;
          }

          let parsed: URL;
          try {
            parsed = new URL(normalizedUrl);
          } catch {
            return { url, status: 0, reachable: false, error: 'Invalid URL' };
          }

          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { url, status: 0, reachable: false, error: 'Unsupported scheme' };
          }

          if (!(await isPublicHostname(parsed.hostname))) {
            return { url, status: 0, reachable: false, error: 'Blocked host' };
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(parsed.toString(), {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'manual',
          });

          clearTimeout(timeout);
          return { url, status: response.status, reachable: response.ok };
        } catch (err: any) {
          return {
            url,
            status: 0,
            reachable: false,
            error: err.name === 'AbortError' ? 'Timeout' : 'Unreachable',
          };
        }
      }),
    );

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
      sortBy = 'lname',
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

    if (search && (search as string).trim()) {
      const searchRegex = buildSafeSearchRegex((search as string).trim());
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

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize as string, 10) || 25));

    const sort: any = {};
    const order = sortOrder === 'asc' ? 1 : -1;
    sort[sortBy as string] = order;
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
      sortBy = 'createdAt',
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

    if (search && (search as string).trim()) {
      const searchRegex = buildSafeSearchRegex((search as string).trim());
      filter.$or = [
        { title: searchRegex },
        { summary: searchRegex },
        { description: searchRegex },
        { contactEmail: searchRegex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize as string, 10) || 25));

    const sort: any = {};
    const order = sortOrder === 'asc' ? 1 : -1;
    sort[sortBy as string] = order;
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
