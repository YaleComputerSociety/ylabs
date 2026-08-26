/**
 * Controller handlers for faculty profile routes.
 */
import { Request, Response } from 'express';
import { User } from '../models/user';
import { getProfileByNetid, isPublicFacultyProfileUserType } from '../services/profileService';
import { fetchCourseTableData } from '../services/courseTableService';
import { sanitizeLogValue } from '../utils/logSanitizer';

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
 * GET /profiles/:netid/courses — CourseTable proxy
 */
export const getProfileCourses = async (req: Request, res: Response) => {
  try {
    const { netid } = req.params;

    const user = await User.findOne({ netid }).select('fname lname userType').lean();

    if (!user || !isPublicFacultyProfileUserType((user as any).userType)) {
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
