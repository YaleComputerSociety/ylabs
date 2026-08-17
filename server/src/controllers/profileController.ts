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
import { sanitizeLogValue } from '../utils/logSanitizer';
import { redactDirectContactInfo } from '../utils/contactRedaction';

const MAX_PUBLIC_PROFILE_URLS = 20;

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
    ? values.slice(0, MAX_PUBLIC_PROFILE_URLS).map(publicHttpUrl).filter((value): value is string => Boolean(value))
    : [];

const publicProfileListingText = (value: unknown): string | undefined =>
  typeof value === 'string' ? redactDirectContactInfo(value) : undefined;

const publicProfileListingTextArray = (values: unknown): string[] =>
  Array.isArray(values)
    ? values.flatMap((value) => publicProfileListingText(value) ?? [])
    : [];

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
    console.error('Profile: Error updating profile:', sanitizeLogValue(error));
    sendProfileMutationError(res, error, 'Failed to update profile');
  }
};

/**
 * PUT /profiles/me/verify — request admin verification for a complete profile.
 * Kept as a compatibility endpoint; profile saves request automatically.
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
        .json({ error: 'Only faculty accounts can request profile verification.' });
    }
    if (!profile.primaryDepartment?.trim()) {
      return res.status(400).json({ error: 'Primary department is required for verification.' });
    }
    if (!profile.researchInterests?.length) {
      return res
        .status(400)
        .json({ error: 'At least one research interest is required for verification.' });
    }
    if (!profile.bio?.trim() || !profile.imageUrl?.trim()) {
      return res.status(400).json({ error: 'Bio and profile image are required for verification.' });
    }

    const user = await User.findOneAndUpdate(
      {
        netid: currentUser.netId,
        profileVerified: { $ne: true },
        profileVerificationRequestedAt: { $exists: false },
      },
      { $set: { profileVerificationRequestedAt: new Date() } },
      { new: true },
    ).lean();

    res.json({ profile: normalizePublicProfile((user || existing) as any) });
  } catch (error: any) {
    console.error('Profile: Error verifying profile:', sanitizeLogValue(error));
    sendProfileMutationError(res, error, 'Failed to verify profile');
  }
};
