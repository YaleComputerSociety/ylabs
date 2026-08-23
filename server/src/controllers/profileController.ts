/**
 * Controller handlers for faculty profile routes.
 */
import { Request, Response, NextFunction } from 'express';
import { User, normalizeUserType } from '../models/user';
import { getListingModel } from '../db/connections';
import { getProfileByNetid } from '../services/profileService';
import { fetchCourseTableData } from '../services/courseTableService';
import { isPublicHttpUrl } from '../utils/urlSafety';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { redactDirectContactInfo } from '../utils/contactRedaction';

const MAX_PUBLIC_PROFILE_URLS = 20;

/**
 * Faculty/staff accounts are the only ones with a legitimate public-facing
 * profile: PI links on research/lab pages and listing investigator links
 * (see principalInvestigatorLinks.ts, ListingDetailModal.tsx) point students
 * at these netids by design. Student accounts have no such discovery path,
 * so cross-viewing a student's profile is never an intended feature.
 */
const PUBLICLY_DISCOVERABLE_PROFILE_USER_TYPES = new Set(['professor', 'staff']);

/**
 * Authorization guard for GET /profiles/:netid and its sub-routes — a viewer
 * may always see their own profile; otherwise the target account must be a
 * publicly discoverable faculty/staff profile. Returns 404 (not 403) so a
 * disallowed lookup can't be used to enumerate which netids exist.
 */
export const canViewProfile = async (req: Request, res: Response, next: NextFunction) => {
  const { netid } = req.params;
  const viewer = req.user as { netId?: unknown; netid?: unknown } | undefined;
  const viewerNetid = String(viewer?.netId ?? viewer?.netid ?? '').toLowerCase();

  if (viewerNetid && viewerNetid === netid.toLowerCase()) {
    return next();
  }

  try {
    const targetUser = await User.findOne({ netid }).select('userType').lean();
    const targetUserType = normalizeUserType((targetUser as any)?.userType);
    if (targetUser && PUBLICLY_DISCOVERABLE_PROFILE_USER_TYPES.has(targetUserType)) {
      return next();
    }
  } catch (error: any) {
    console.error('Profile: Error authorizing profile view:', sanitizeLogValue(error));
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }

  return res.status(404).json({ error: 'Profile not found' });
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
    ? values
        .slice(0, MAX_PUBLIC_PROFILE_URLS)
        .map(publicHttpUrl)
        .filter((value): value is string => Boolean(value))
    : [];

const publicProfileListingText = (value: unknown): string | undefined =>
  typeof value === 'string' ? redactDirectContactInfo(value) : undefined;

const publicProfileListingTextArray = (values: unknown): string[] =>
  Array.isArray(values) ? values.flatMap((value) => publicProfileListingText(value) ?? []) : [];

const publicProfileListing = (listing: any) => ({
  _id: listing._id,
  title: publicProfileListingText(listing.title),
  description: publicProfileListingText(listing.description),
  applicantDescription: publicProfileListingText(listing.applicantDescription),
  websites: publicHttpUrls(listing.websites),
  departments: publicProfileListingTextArray(listing.departments),
  researchAreas: publicProfileListingTextArray(listing.researchAreas),
  keywords: publicProfileListingTextArray(listing.keywords),
  type: publicProfileListingText(listing.type),
  commitment: publicProfileListingText(listing.commitment),
  compensationType: publicProfileListingText(listing.compensationType),
  expiresAt: listing.expiresAt,
});

/**
 * GET /profiles/:netid — public profile (any authenticated user)
 */
export const getProfile = async (req: Request, res: Response) => {
  try {
    const { netid } = req.params;
    const profile = await getProfileByNetid(netid);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // `getProfileByNetid` already returns a normalized public profile (with its
    // research homes + derived interest tags). Re-normalizing here would drop
    // the loaded researchEntities and re-derive interests from nothing.
    res.json({ profile });
  } catch (error: any) {
    console.error('Profile: Error fetching profile:', sanitizeLogValue(error));
    res.status(500).json({ error: 'Failed to fetch profile' });
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
        confirmed: true,
      })
      .select(
        '_id title description applicantDescription websites departments researchAreas keywords type commitment compensationType expiresAt',
      )
      .sort({ createdAt: -1 })
      .lean();

    res.json({ listings: listings.map(publicProfileListing) });
  } catch (error: any) {
    console.error('Profile: Error fetching listings:', sanitizeLogValue(error));
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
    console.error('Profile: Error fetching courses:', sanitizeLogValue(error));
    res.json({ courses: [], available: false });
  }
};
