/**
 * Controller handlers for faculty profile routes.
 */
import { Request, Response } from 'express';
import { User } from '../models/user';
import { getListingModel } from '../db/connections';
import {
  getProfileByNetid,
  normalizePublicProfile,
  updateOwnProfile,
  cascadeDepartmentsToListings,
} from '../services/profileService';
import { fetchCourseTableData } from '../services/courseTableService';
import { isPublicHttpUrl } from '../utils/urlSafety';

const MAX_PUBLICATION_PAGE = 1000;

const publicProfileListing = (listing: any) => ({
  _id: listing._id,
  title: listing.title,
  description: listing.description,
  applicantDescription: listing.applicantDescription,
  websites: publicHttpUrls(listing.websites),
  departments: Array.isArray(listing.departments) ? listing.departments : [],
  researchAreas: Array.isArray(listing.researchAreas) ? listing.researchAreas : [],
  keywords: Array.isArray(listing.keywords) ? listing.keywords : [],
  type: listing.type,
  commitment: listing.commitment,
  compensationType: listing.compensationType,
  expiresAt: listing.expiresAt,
});

const addIfDefined = (target: Record<string, any>, key: string, value: any) => {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
};

const publicHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    return isPublicHttpUrl(trimmed) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const publicHttpUrls = (values: unknown): string[] =>
  Array.isArray(values)
    ? values.map(publicHttpUrl).filter((value): value is string => Boolean(value))
    : [];

const publicProfilePublication = (publication: any) => {
  const result: Record<string, any> = {};
  addIfDefined(result, 'title', publication.title);
  addIfDefined(result, 'doi', publication.doi);
  addIfDefined(result, 'year', publication.year);
  addIfDefined(result, 'venue', publication.venue);
  addIfDefined(result, 'cited_by_count', publication.cited_by_count ?? publication.citedByCount);
  addIfDefined(
    result,
    'open_access_url',
    publicHttpUrl(publication.open_access_url ?? publication.openAccessUrl),
  );
  addIfDefined(result, 'source', publication.source);
  return result;
};

const PUBLICATION_SORT_FIELDS = new Set([
  'title',
  'year',
  'venue',
  'cited_by_count',
  'open_access_url',
  'source',
]);

const publicPublicationSortField = (value: unknown): string =>
  typeof value === 'string' && PUBLICATION_SORT_FIELDS.has(value) ? value : 'year';

const publicPublicationSortOrder = (sortBy: unknown, sortOrder: unknown): 1 | -1 => {
  if (typeof sortBy === 'string' && PUBLICATION_SORT_FIELDS.has(sortBy)) {
    return sortOrder === 'asc' ? 1 : -1;
  }
  return -1;
};

const publicationSortValue = (publication: any, sortBy: string) => {
  if (sortBy === 'cited_by_count') return publication.cited_by_count ?? publication.citedByCount ?? 0;
  if (sortBy === 'open_access_url') return publication.open_access_url ?? publication.openAccessUrl ?? '';
  return publication[sortBy] ?? 0;
};

const sendProfileMutationError = (res: Response, error: any, fallbackMessage: string) => {
  if (error?.name === 'ValidationError') {
    return res.status(400).json({ error: 'Validation error' });
  }

  return res.status(500).json({ error: fallbackMessage });
};

/**
 * GET /profiles/:netid — public profile (any authenticated user)
 */
export const getProfile = async (req: Request, res: Response) => {
  try {
    const { netid } = req.params;
    const profile = await getProfileByNetid(netid, false);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ profile: normalizePublicProfile(profile as any) });
  } catch (error: any) {
    console.error('Profile: Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

/**
 * GET /profiles/:netid/publications — paginated publications
 */
export const getPublications = async (req: Request, res: Response) => {
  try {
    const { netid } = req.params;
    const page = Math.min(
      MAX_PUBLICATION_PAGE,
      Math.max(1, parseInt(req.query.page as string, 10) || 1),
    );
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string, 10) || 20));
    const sortBy = publicPublicationSortField(req.query.sortBy);
    const sortOrder = publicPublicationSortOrder(req.query.sortBy, req.query.sortOrder);

    const user = await User.findOne({ netid }).select('+publications').lean();
    if (!user) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const pubs = (user as any).publications || [];

    pubs.sort((a: any, b: any) => {
      const aVal = publicationSortValue(a, sortBy);
      const bVal = publicationSortValue(b, sortBy);
      if (aVal < bVal) return -sortOrder;
      if (aVal > bVal) return sortOrder;
      return 0;
    });

    const total = pubs.length;
    const start = (page - 1) * pageSize;
    const paginated = pubs.slice(start, start + pageSize);

    res.json({
      publications: paginated.map(publicProfilePublication),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: any) {
    console.error('Profile: Error fetching publications:', error);
    res.status(500).json({ error: 'Failed to fetch publications' });
  }
};

/**
 * GET /profiles/:netid/listings — professor's active listings
 */
export const getProfileListings = async (req: Request, res: Response) => {
  try {
    const { netid } = req.params;

    const listings = await getListingModel()
      .find({
        $or: [{ ownerId: netid }, { professorIds: netid }],
        archived: false,
      })
      .select(
        '_id title description applicantDescription websites departments researchAreas keywords type commitment compensationType expiresAt',
      )
      .sort({ createdAt: -1 })
      .lean();

    res.json({ listings: listings.map(publicProfileListing) });
  } catch (error: any) {
    console.error('Profile: Error fetching listings:', error);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
};

/**
 * GET /profiles/:netid/courses — CourseTable proxy
 */
export const getProfileCourses = async (req: Request, res: Response) => {
  try {
    const { netid } = req.params;

    const user = await User.findOne({ netid }).select('fname lname').lean();

    if (!user) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const professorName = `${(user as any).fname} ${(user as any).lname}`;
    const courses = await fetchCourseTableData(professorName);

    if (!courses) {
      return res.json({ courses: [], available: false });
    }

    res.json({ courses, available: true });
  } catch (error: any) {
    console.error('Profile: Error fetching courses:', error);
    res.json({ courses: [], available: false });
  }
};

/**
 * PUT /profiles/me — update own profile (professor only)
 */
export const updateProfile = async (req: Request, res: Response) => {
  try {
    const currentUser = req.user as { netId: string };
    const updated = await updateOwnProfile(currentUser.netId, req.body);

    if (!updated) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    if (req.body.primaryDepartment !== undefined || req.body.secondaryDepartments !== undefined) {
      await cascadeDepartmentsToListings(currentUser.netId);
    }

    res.json({ profile: normalizePublicProfile(updated as any) });
  } catch (error: any) {
    console.error('Profile: Error updating profile:', error);
    sendProfileMutationError(res, error, 'Failed to update profile');
  }
};

/**
 * PUT /profiles/me/verify — set profileVerified=true
 * Requires primaryDepartment and at least one research_interest.
 */
export const verifyProfile = async (req: Request, res: Response) => {
  try {
    const currentUser = req.user as { netId: string };

    const existing = await User.findOne({ netid: currentUser.netId }).lean();
    if (!existing) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = existing as any;
    if (profile.userType !== 'professor' && profile.userType !== 'faculty') {
      return res
        .status(403)
        .json({ error: 'Only faculty accounts can self-verify their profile.' });
    }
    if (!profile.primaryDepartment?.trim()) {
      return res.status(400).json({ error: 'Primary department is required for verification.' });
    }
    if (!profile.researchInterests?.length) {
      return res
        .status(400)
        .json({ error: 'At least one research interest is required for verification.' });
    }

    const user = await User.findOneAndUpdate(
      { netid: currentUser.netId },
      { profileVerified: true },
      { new: true },
    ).lean();

    res.json({ profile: normalizePublicProfile(user as any) });
  } catch (error: any) {
    console.error('Profile: Error verifying profile:', error);
    sendProfileMutationError(res, error, 'Failed to verify profile');
  }
};
