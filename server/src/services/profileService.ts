/**
 * Faculty profile service for self-editing, verification, and department cascading.
 */
import { User } from '../models/user';
import { getListingModel } from '../db/connections';

/**
 * Cascade a professor's department data to all their listings.
 * - For owned listings: set departments from owner's profile
 * - For co-PI listings: merge departments from all PIs (owner's primary first)
 */
export const cascadeDepartmentsToListings = async (netid: string) => {
  const user = await User.findOne({ netid }).lean();
  if (!user) return;

  const userDepts = [
    (user as any).primaryDepartment,
    ...((user as any).secondaryDepartments || []),
  ].filter(Boolean);

  const ownedListings = await getListingModel().find({ ownerId: netid }).lean();

  for (const listing of ownedListings) {
    const coPIIds = (listing.professorIds || []).filter((id: string) => id !== netid);

    let finalDepts: string[];

    if (coPIIds.length > 0) {
      const coPIs = await User.find({ netid: { $in: coPIIds } })
        .select('primaryDepartment secondaryDepartments')
        .lean();

      const allDepts = new Set<string>(userDepts);
      for (const pi of coPIs) {
        if ((pi as any).primaryDepartment) allDepts.add((pi as any).primaryDepartment);
        for (const d of (pi as any).secondaryDepartments || []) {
          allDepts.add(d);
        }
      }
      finalDepts = Array.from(allDepts);
    } else {
      finalDepts = userDepts;
    }

    await getListingModel().findByIdAndUpdate(listing._id, {
      departments: finalDepts,
      ownerPrimaryDepartment: (user as any).primaryDepartment || '',
      ownerTitle: (user as any).title || '',
    });
  }

  const coPIListings = await getListingModel()
    .find({ professorIds: netid, ownerId: { $ne: netid } })
    .lean();

  for (const listing of coPIListings) {
    const allPIIds = [listing.ownerId, ...(listing.professorIds || [])];
    const uniqueIds = [...new Set(allPIIds)];

    const allPIs = await User.find({ netid: { $in: uniqueIds } })
      .select('primaryDepartment secondaryDepartments')
      .lean();

    const owner = allPIs.find((p: any) => p.netid === listing.ownerId);
    const ownerPrimary = (owner as any)?.primaryDepartment;

    const allDepts = new Set<string>();
    if (ownerPrimary) allDepts.add(ownerPrimary);

    for (const pi of allPIs) {
      if ((pi as any).primaryDepartment) allDepts.add((pi as any).primaryDepartment);
      for (const d of (pi as any).secondaryDepartments || []) {
        allDepts.add(d);
      }
    }

    await getListingModel().findByIdAndUpdate(listing._id, {
      departments: Array.from(allDepts),
    });
  }
};

/**
 * Get a faculty profile by netid, optionally including publications.
 */
export const getProfileByNetid = async (netid: string, includePublications = false) => {
  let query = User.findOne({ netid });
  if (includePublications) {
    query = query.select('+publications');
  }
  const user = await query.lean();
  return user;
};

/**
 * Update allowed profile fields for a professor.
 * Returns the updated user.
 */
const ALLOWED_SELF_UPDATE_FIELDS = [
  'bio',
  'primaryDepartment',
  'secondaryDepartments',
  'researchInterests',
  'topics',
  'imageUrl',
  'profileUrls',
  'website',
];

export const updateOwnProfile = async (netid: string, data: any) => {
  const update: Record<string, any> = {};

  for (const field of ALLOWED_SELF_UPDATE_FIELDS) {
    if (data[field] !== undefined) {
      update[field] = data[field];
    }
  }

  if (update.primaryDepartment !== undefined || update.secondaryDepartments !== undefined) {
    const current = await User.findOne({ netid }).lean();
    const primary = update.primaryDepartment ?? (current as any)?.primaryDepartment ?? '';
    const secondary = update.secondaryDepartments ?? (current as any)?.secondaryDepartments ?? [];
    update.departments = [primary, ...secondary].filter(Boolean);
  }

  const user = await User.findOneAndUpdate({ netid }, update, {
    new: true,
    runValidators: true,
  }).lean();

  return user;
};

/**
 * Admin: update any profile field.
 */
const ADMIN_UPDATE_FIELDS = [
  ...ALLOWED_SELF_UPDATE_FIELDS,
  'fname',
  'lname',
  'email',
  'title',
  'hIndex',
  'orcid',
  'openAlexId',
  'profileVerified',
  'userType',
  'userConfirmed',
];

export const adminUpdateProfile = async (netid: string, data: any) => {
  const update: Record<string, any> = {};

  for (const field of ADMIN_UPDATE_FIELDS) {
    if (data[field] !== undefined) {
      update[field] = data[field];
    }
  }

  if (update.primaryDepartment !== undefined || update.secondaryDepartments !== undefined) {
    const current = await User.findOne({ netid }).lean();
    const primary = update.primaryDepartment ?? (current as any)?.primaryDepartment ?? '';
    const secondary = update.secondaryDepartments ?? (current as any)?.secondaryDepartments ?? [];
    update.departments = [primary, ...secondary].filter(Boolean);
  }

  if (data.publications !== undefined) {
    update.publications = data.publications;
  }

  const user = await User.findOneAndUpdate({ netid }, update, {
    new: true,
    runValidators: true,
  })
    .select('+publications')
    .lean();

  return user;
};
