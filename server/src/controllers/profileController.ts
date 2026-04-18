/**
 * Controller handlers for faculty profile routes.
 */
import { Request, Response } from 'express';
import { User } from '../models/user';
import { getListingModel } from '../db/connections';
import {
  getProfileByNetid,
  updateOwnProfile,
  cascadeDepartmentsToListings,
} from '../services/profileService';
import { fetchCourseTableData } from '../services/courseTableService';

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

    res.json({ profile });
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
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string, 10) || 20));
    const sortBy = (req.query.sortBy as string) || 'year';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    const user = await User.findOne({ netid }).select('+publications').lean();
    if (!user) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const pubs = (user as any).publications || [];

    pubs.sort((a: any, b: any) => {
      const aVal = a[sortBy] ?? 0;
      const bVal = b[sortBy] ?? 0;
      if (aVal < bVal) return -sortOrder;
      if (aVal > bVal) return sortOrder;
      return 0;
    });

    const total = pubs.length;
    const start = (page - 1) * pageSize;
    const paginated = pubs.slice(start, start + pageSize);

    res.json({
      publications: paginated,
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
      .select('-embedding')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ listings });
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

    if (req.body.primary_department !== undefined || req.body.secondary_departments !== undefined) {
      await cascadeDepartmentsToListings(currentUser.netId);
    }

    res.json({ profile: updated });
  } catch (error: any) {
    console.error('Profile: Error updating profile:', error);
    res.status(400).json({ error: error.message });
  }
};

/**
 * PUT /profiles/me/verify — set profileVerified=true
 * Requires primary_department and at least one research_interest.
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
    if (!profile.primary_department?.trim()) {
      return res.status(400).json({ error: 'Primary department is required for verification.' });
    }
    if (!profile.research_interests?.length) {
      return res
        .status(400)
        .json({ error: 'At least one research interest is required for verification.' });
    }

    const user = await User.findOneAndUpdate(
      { netid: currentUser.netId },
      { profileVerified: true },
      { new: true },
    ).lean();

    res.json({ profile: user });
  } catch (error: any) {
    console.error('Profile: Error verifying profile:', error);
    res.status(400).json({ error: error.message });
  }
};
