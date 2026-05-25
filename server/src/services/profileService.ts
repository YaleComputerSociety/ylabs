/**
 * Faculty profile service for self-editing, verification, and department cascading.
 */
import { User } from '../models/user';
import { getListingModel } from '../db/connections';
import { Paper } from '../models/paper';
import { PaperAuthor } from '../models/paperAuthor';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';

const normalizeNameToken = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const nameTokens = (value: unknown): string[] =>
  normalizeNameToken(value)
    .split(/\s+/)
    .filter((token) => token.length > 1);

const safeObject = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, url]) => typeof url === 'string' && url.trim(),
    ),
  ) as Record<string, string>;
};

const isLikelyPersonUrl = (url: string, firstName: string, lastName: string): boolean => {
  const tokens = nameTokens(url);
  const firstTokens = nameTokens(firstName);
  const lastTokens = nameTokens(lastName);
  if (firstTokens.length === 0 || lastTokens.length === 0) return true;

  return firstTokens.every((token) => tokens.includes(token)) && lastTokens.every((token) => tokens.includes(token));
};

export const isLikelySameNameContaminatedProfile = (user: Record<string, any>): boolean => {
  const firstName = user.fname || '';
  const lastName = user.lname || '';
  const fullName = normalizeNameToken(`${firstName} ${lastName}`);
  if (!fullName) return false;

  const bio = typeof user.bio === 'string' ? user.bio.trim() : '';
  const possessiveWebsiteMatch = bio.match(/^(.{2,80}?)[’']s\s+website\b/i);
  if (possessiveWebsiteMatch) {
    const bioName = normalizeNameToken(possessiveWebsiteMatch[1]);
    if (bioName && bioName !== fullName) return true;
  }

  const profileUrls = safeObject(user.profileUrls || user.profile_urls);
  const profileUrlValues = Object.entries(profileUrls)
    .filter(([key]) => key !== 'orcid')
    .map(([, url]) => url);
  if (profileUrlValues.length > 0) {
    return profileUrlValues.every((url) => !isLikelyPersonUrl(url, firstName, lastName));
  }

  return false;
};

export const cleanProfileUrlsForPerson = (user: Record<string, any>): Record<string, string> => {
  const profileUrls = safeObject(user.profileUrls || user.profile_urls);
  return Object.fromEntries(
    Object.entries(profileUrls).filter(([key, url]) =>
      key === 'orcid' || isLikelyPersonUrl(url, user.fname || '', user.lname || ''),
    ),
  );
};

export const paperToScholarlyLink = (paper: Record<string, any>, userId?: unknown) => {
  const doi = typeof paper.doi === 'string' ? paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : '';
  const doiUrl = doi ? `https://doi.org/${doi}` : '';
  const url = doiUrl || paper.landingPageUrl || paper.openAccessUrl || paper.url || paper.pdfUrl || '';
  const freeFullTextUrl =
    paper.pdfUrl && paper.pdfUrl !== url
      ? paper.pdfUrl
      : paper.openAccessUrl && paper.openAccessUrl !== url
        ? paper.openAccessUrl
        : undefined;

  return {
    _id: String(paper._id || paper.id || paper.openAlexId || paper.title),
    userId: userId ? String(userId) : undefined,
    title: paper.title || 'Untitled research activity',
    url,
    destinationKind: doiUrl ? 'DOI' : paper.openAccessUrl || paper.pdfUrl ? 'OPENALEX' : 'OTHER',
    displaySource: doiUrl ? 'DOI' : paper.openAccessUrl || paper.pdfUrl ? 'Open access' : 'Paper',
    freeFullTextUrl,
    freeFullTextLabel: freeFullTextUrl ? 'Free full text' : undefined,
    discoveredVia: paper.sources?.includes('orcid') ? 'ORCID' : 'OPENALEX',
    year: paper.year,
    venue: paper.venue,
    confidence: 0.9,
    observedAt: paper.lastObservedAt?.toISOString?.() || paper.updatedAt?.toISOString?.(),
    externalIds: {
      doi: doi || undefined,
      openAlexId: paper.openAlexId,
      arxivId: paper.arxivId,
    },
  };
};

export const normalizePublicProfile = (
  user: Record<string, any>,
  extras: { scholarlyLinks?: any[]; researchEntities?: any[] } = {},
) => {
  const contaminated = isLikelySameNameContaminatedProfile(user);
  const researchInterests = user.researchInterests || user.research_interests || [];
  const bio = contaminated ? '' : user.bio || '';

  return {
    ...user,
    bio,
    image_url: user.imageUrl || user.image_url || '',
    primary_department: user.primaryDepartment || user.primary_department || '',
    secondary_departments: user.secondaryDepartments || user.secondary_departments || [],
    physical_location: user.physicalLocation || user.physical_location || '',
    building_desk: user.buildingDesk || user.building_desk || '',
    h_index: contaminated && researchInterests.length === 0 ? undefined : user.hIndex || user.h_index,
    openalex_id:
      contaminated && researchInterests.length === 0 ? undefined : user.openAlexId || user.openalex_id,
    profile_urls: contaminated ? {} : cleanProfileUrlsForPerson(user),
    research_interests: researchInterests,
    research_interest_summary: user.researchInterestSummary || user.research_interest_summary || '',
    topics: contaminated && researchInterests.length === 0 ? [] : user.topics || [],
    scholarlyLinks: contaminated ? [] : extras.scholarlyLinks || [],
    researchEntities: contaminated ? [] : extras.researchEntities || [],
  };
};

const loadProfileScholarlyLinks = async (user: Record<string, any>) => {
  const userId = user._id;
  if (!userId) return [];

  const authorIdentityClauses: Record<string, unknown>[] = [{ userId }];
  if (user.facultyMemberId) authorIdentityClauses.push({ facultyMemberId: user.facultyMemberId });

  const authorRows = await PaperAuthor.find({ $or: authorIdentityClauses })
    .select('paperId')
    .sort({ lastObservedAt: -1, updatedAt: -1 })
    .limit(50)
    .lean();
  const paperIds = [...new Set(authorRows.map((row: any) => String(row.paperId)).filter(Boolean))];
  if (paperIds.length === 0) return [];

  const papers = await Paper.find({ _id: { $in: paperIds }, archived: { $ne: true } })
    .select(
      '_id title doi openAlexId arxivId url openAccessUrl landingPageUrl pdfUrl year venue citationCount publishedAt postedAt versionDate sources lastObservedAt updatedAt',
    )
    .sort({ publishedAt: -1, year: -1, citationCount: -1 })
    .limit(10)
    .lean();

  return papers.map((paper: any) => paperToScholarlyLink(paper, userId));
};

const loadProfileResearchEntities = async (user: Record<string, any>) => {
  const userId = user._id;
  if (!userId) return [];

  const memberships = await ResearchGroupMember.find({
    userId,
    isCurrentMember: { $ne: false },
    researchEntityId: { $exists: true, $ne: null },
  })
    .select('researchEntityId role')
    .lean();
  const entityIds = [
    ...new Set(memberships.map((membership: any) => String(membership.researchEntityId)).filter(Boolean)),
  ];
  if (entityIds.length === 0) return [];

  const roleByEntityId = new Map(
    memberships.map((membership: any) => [String(membership.researchEntityId), membership.role]),
  );
  const entities = await ResearchEntity.find({
    _id: { $in: entityIds },
    archived: { $ne: true },
    studentVisibilityTier: { $in: ['student_ready', 'limited_but_safe'] },
  })
    .select('_id slug name displayName shortDescription description departments researchAreas')
    .limit(12)
    .lean();

  return entities.map((entity: any) => ({
    _id: String(entity._id),
    slug: entity.slug || '',
    name: entity.name || '',
    displayName: entity.displayName || '',
    shortDescription: entity.shortDescription || '',
    description: entity.description || '',
    departments: entity.departments || [],
    researchAreas: entity.researchAreas || [],
    role: roleByEntityId.get(String(entity._id)) || '',
  }));
};

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
  if (!user) return user;

  const [scholarlyLinks, researchEntities] = await Promise.all([
    loadProfileScholarlyLinks(user as any),
    loadProfileResearchEntities(user as any),
  ]);

  return normalizePublicProfile(user as any, { scholarlyLinks, researchEntities });
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
