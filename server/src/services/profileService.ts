/**
 * Faculty profile service for self-editing and verification.
 */
import { User } from '../models/user';
import { listPublicScholarlyLinksForUser } from './scholarlyLinkService';
import { sanitizeProfileResearchTerms } from '../utils/profileResearchTerms';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { ResearchEntity } from '../models/researchEntity';
import { publicResearchEntityDescriptionText } from '../utils/researchEntityDescriptionText';
import { isMaterializableUserBioCandidate } from '../utils/profileBioQuality';
import {
  canonicalizeProfileDepartments,
  type CanonicalProfileDepartmentsResult,
} from './departmentResolver';

export { sanitizeProfileResearchTerms } from '../utils/profileResearchTerms';

const QUOTED_ARTICLE_LINE_RE = /^["“][^"”]+["”]\s*(?:\(|by\b|,)/i;
const PUBLICATION_POINTER_RE = /^for a full list of publications please see\b/i;
const LINK_CHROME_RE = /\b(?:link is external|link opens in new window)\b/i;
const YALE_ADDRESS_RE =
  /([A-Z][A-Za-z0-9 '&.-]*?(?:Tower|Hall|House|Center|Centre|Building|Laboratory|Lab|Library|Museum|Clinic))\s*(?:Room\s*)?(\d{3,4})\s*(\d+\s+[A-Z][A-Za-z0-9 '&.-]*?(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Boulevard|Blvd\.?|Place|Pl\.?|Prospect Street))\s*(New Haven,\s*CT\s*\d{5})/i;

function formatYaleAddressMatch(text: string): string {
  return text
    .replace(YALE_ADDRESS_RE, (_match, building, room, street, cityStateZip) => {
      const streetText = String(street).replace(/\s+/g, ' ').trim();
      return `${String(building).trim()} Room ${String(room).trim()}, ${streetText}, ${String(
        cityStateZip,
      )
        .replace(/\s+/g, ' ')
        .trim()}`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function extractYaleAddress(value: unknown): string {
  const text = String(value || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const match = text.match(YALE_ADDRESS_RE);
  return match ? formatYaleAddressMatch(match[0]) : '';
}

const DIRECTORY_STREET_FIRST_RE =
  /^([A-Za-z0-9 '&.-]*?(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Boulevard|Blvd\.?|Place|Pl\.?)),\s*(\d+[A-Za-z]?)\s*(?:>\s*([A-Za-z0-9-]+))?$/i;

function normalizeStreetSuffix(street: string): string {
  return street.replace(/\b(St|Ave|Rd|Dr|Ln|Blvd|Pl)$/i, '$1.');
}

function normalizeDirectoryStreetFirstLocation(value: unknown): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const match = text.match(DIRECTORY_STREET_FIRST_RE);
  if (!match) return '';

  const street = normalizeStreetSuffix(match[1].trim());
  const number = match[2].trim();
  const room = match[3]?.trim();
  return `${number} ${street}${room ? ` Room ${room}` : ''}`;
}

function isProfileChromeOrAddressParagraph(paragraph: string): boolean {
  if (LINK_CHROME_RE.test(paragraph)) return true;
  if (extractYaleAddress(paragraph)) return true;
  return false;
}

export function sanitizeProfileBio(value: unknown): string {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return '';

  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    if (QUOTED_ARTICLE_LINE_RE.test(paragraph)) break;
    if (PUBLICATION_POINTER_RE.test(paragraph)) break;
    if (isProfileChromeOrAddressParagraph(paragraph)) continue;
    kept.push(paragraph);
  }

  return kept.join('\n\n');
}

function normalizeProfilePhysicalLocation(profile: any): string {
  const rawLocation = profile.physical_location || profile.physicalLocation || '';
  const rawMailingAddress = profile.mailing_address || profile.mailingAddress || '';
  const recoveredAddress =
    extractYaleAddress(rawMailingAddress) ||
    extractYaleAddress(profile.bio) ||
    extractYaleAddress(rawLocation);
  if (recoveredAddress) return recoveredAddress;

  const directoryStreetAddress = normalizeDirectoryStreetFirstLocation(rawLocation);
  if (directoryStreetAddress) return directoryStreetAddress;

  if (typeof rawLocation === 'string' && rawLocation.includes('>')) {
    return rawLocation.replace(/\s*>\s*/g, ' Room ').replace(/\s+/g, ' ').trim();
  }

  return rawLocation;
}

interface NormalizeProfileForClientOptions {
  copiedResearchDescriptions?: unknown[];
  canonicalProfileDepartments?: CanonicalProfileDepartmentsResult;
}

const normalizedComparableText = (value: unknown): string =>
  String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

function firstSentence(value: unknown): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const match = text.match(/^.+?[.!?](?=\s|$)/);
  return match ? match[0].trim() : text;
}

function researchInterestSummaryCandidate(values: unknown[]): string {
  for (const raw of values) {
    const sentence = firstSentence(raw).replace(/^research\s+areas?:\s*/i, '').trim();
    if (/\bresearch interests?\s+include\b/i.test(sentence)) {
      return sentence;
    }
  }
  return '';
}

export const normalizeProfileForClient = (
  profile: any,
  options: NormalizeProfileForClientOptions = {},
) => {
  if (!profile) return profile;
  const researchInterests = sanitizeProfileResearchTerms(
    profile.research_interests || profile.researchInterests || [],
  );
  const topics = sanitizeProfileResearchTerms(profile.topics || []);
  const bio = sanitizeProfileBio(profile.bio);
  const researchInterestSummary =
    researchInterests.length === 0 && topics.length === 0
      ? researchInterestSummaryCandidate([
          bio,
          ...((Array.isArray(profile.research_interests)
            ? profile.research_interests
            : profile.researchInterests) || []),
          ...(Array.isArray(profile.topics) ? profile.topics : []),
        ])
      : '';
  const bioIsUsable = isMaterializableUserBioCandidate(bio);
  const copiedResearchDescriptions = new Set(
    (options.copiedResearchDescriptions || [])
      .map((value) => normalizedComparableText(publicResearchEntityDescriptionText(value)))
      .filter(Boolean),
  );
  const publicBio =
    bioIsUsable && !copiedResearchDescriptions.has(normalizedComparableText(bio)) ? bio : '';
  const canonicalDepartments = options.canonicalProfileDepartments;
  const primaryDepartment =
    canonicalDepartments?.primaryDepartment ||
    profile.primary_department ||
    profile.primaryDepartment ||
    '';
  const secondaryDepartments =
    canonicalDepartments?.secondaryDepartments ||
    profile.secondary_departments ||
    profile.secondaryDepartments ||
    [];
  const departments =
    canonicalDepartments?.departments ||
    profile.departments ||
    [primaryDepartment, ...secondaryDepartments].filter(Boolean);

  return {
    ...profile,
    bio: publicBio,
    image_url: profile.image_url || profile.imageUrl || '',
    primary_department: primaryDepartment,
    secondary_departments: secondaryDepartments,
    departments,
    research_interests: researchInterests,
    research_interest_summary: researchInterestSummary,
    topics,
    website: profile.website || '',
    profile_urls: profile.profile_urls || profile.profileUrls || {},
    physical_location: normalizeProfilePhysicalLocation(profile),
    building_desk: profile.building_desk || profile.buildingDesk || '',
    h_index: profile.h_index ?? profile.hIndex,
    openalex_id: profile.openalex_id || profile.openAlexId || '',
  };
};

export const normalizeProfileUpdateForStorage = (data: any) => {
  if (!data) return {};
  return {
    ...data,
    primaryDepartment: data.primaryDepartment ?? data.primary_department,
    secondaryDepartments: data.secondaryDepartments ?? data.secondary_departments,
    researchInterests: data.researchInterests ?? data.research_interests,
    profileUrls: data.profileUrls ?? data.profile_urls,
    imageUrl: data.imageUrl ?? data.image_url,
    hIndex: data.hIndex ?? data.h_index,
    openAlexId: data.openAlexId ?? data.openalex_id,
    physicalLocation: data.physicalLocation ?? data.physical_location,
    buildingDesk: data.buildingDesk ?? data.building_desk,
  };
};

async function canonicalProfileDepartmentUpdate(
  current: any,
  update: Record<string, any>,
): Promise<void> {
  if (update.primaryDepartment === undefined && update.secondaryDepartments === undefined) return;

  const canonical = await canonicalizeProfileDepartments({
    primaryDepartment: update.primaryDepartment ?? current?.primaryDepartment ?? '',
    secondaryDepartments: update.secondaryDepartments ?? current?.secondaryDepartments ?? [],
    departments: current?.departments ?? [],
  });
  update.primaryDepartment = canonical.primaryDepartment;
  update.secondaryDepartments = canonical.secondaryDepartments;
  update.departments = canonical.departments;
}

/**
 * Get a faculty profile by netid, optionally including publications.
 */
export const getProfileByNetid = async (netid: string, _includePublications = false) => {
  let query = User.findOne({ netid });
  const user = await query.lean();
  if (!user) return normalizeProfileForClient(user);

  const memberRows = await ResearchGroupMember.find({
    userId: (user as any)._id,
    role: { $in: ['pi', 'co-pi', 'director', 'co-director'] },
    isCurrentMember: { $ne: false },
  })
    .select('researchEntityId')
    .lean();
  const researchEntityIds = memberRows
    .map((row: any) => row.researchEntityId)
    .filter(Boolean);
  const researchEntities = researchEntityIds.length
    ? await ResearchEntity.find({ _id: { $in: researchEntityIds }, archived: { $ne: true } })
        .select(
          'slug name displayName kind entityType shortDescription description fullDescription departments researchAreas',
        )
        .lean()
    : [];
  const memberRoleEntries = memberRows
    .map(
      (row: any): [string, unknown] => [
        String(row.researchEntityId || ''),
        row.role,
      ],
    )
    .filter(([id]) => Boolean(id));
  const memberRoleByEntityId = new Map<string, unknown>(memberRoleEntries);
  const publicResearchEntities = researchEntities.map((entity: any) => ({
    _id: String(entity._id),
    slug: entity.slug || '',
    name: entity.name || entity.displayName || '',
    displayName: entity.displayName || entity.name || '',
    kind: entity.kind,
    entityType: entity.entityType,
    shortDescription: entity.shortDescription || '',
    description: entity.description || '',
    departments: Array.isArray(entity.departments) ? entity.departments : [],
    researchAreas: Array.isArray(entity.researchAreas) ? entity.researchAreas : [],
    role: memberRoleByEntityId.get(String(entity._id)) || '',
  }));
  const storedScholarlyLinks = await listPublicScholarlyLinksForUser((user as any)._id);
  const canonicalProfileDepartments = await canonicalizeProfileDepartments({
    primaryDepartment: (user as any).primaryDepartment,
    secondaryDepartments: (user as any).secondaryDepartments,
    departments: (user as any).departments,
  });
  return normalizeProfileForClient(
    {
      ...user,
      scholarlyLinks: storedScholarlyLinks,
      researchEntities: publicResearchEntities,
    },
    {
      copiedResearchDescriptions: researchEntities.flatMap((entity: any) => [
        entity.shortDescription,
        entity.description,
        entity.fullDescription,
      ]),
      canonicalProfileDepartments,
    },
  );
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
  const normalizedData = normalizeProfileUpdateForStorage(data);
  const update: Record<string, any> = {};

  for (const field of ALLOWED_SELF_UPDATE_FIELDS) {
    if (normalizedData[field] !== undefined) {
      update[field] = normalizedData[field];
    }
  }

  if (update.primaryDepartment !== undefined || update.secondaryDepartments !== undefined) {
    const current = await User.findOne({ netid }).lean();
    await canonicalProfileDepartmentUpdate(current, update);
  }

  const user = await User.findOneAndUpdate({ netid }, update, {
    new: true,
    runValidators: true,
  }).lean();

  return normalizeProfileForClient(user);
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
  const normalizedData = normalizeProfileUpdateForStorage(data);
  const update: Record<string, any> = {};

  for (const field of ADMIN_UPDATE_FIELDS) {
    if (normalizedData[field] !== undefined) {
      if (field === 'userType' && normalizedData[field] === 'admin') {
        continue;
      }
      update[field] = normalizedData[field];
    }
  }

  if (update.primaryDepartment !== undefined || update.secondaryDepartments !== undefined) {
    const current = await User.findOne({ netid }).lean();
    await canonicalProfileDepartmentUpdate(current, update);
  }

  if (normalizedData.publications !== undefined) {
    update.publications = normalizedData.publications;
  }

  const user = await User.findOneAndUpdate({ netid }, update, {
    new: true,
    runValidators: true,
  })
    .select('+publications')
    .lean();

  return normalizeProfileForClient(user);
};
