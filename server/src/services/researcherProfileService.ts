import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import {
  Researcher,
  type ResearcherDisplayProfile,
  type ResearcherProfileLink,
  type ResearcherStatus,
} from '../models/researcher';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { toPublicResearchEntityDto, type PublicResearchEntityDto } from './researchEntityDto';
import { researchEntityServesPublicDetail } from './researchEntityPublicDescription';
import {
  publiclyFindableResearcherDisplayName,
  researcherHasPrimaryIdentityLink,
  researcherIsPubliclyFindable,
} from './researcherFindability';

export interface PublicResearcherProfile {
  publicKey: string;
  displayName: string;
  title?: string;
  primaryDepartment?: string;
  school?: string;
  officialProfileUrl?: string;
  scholarUrl?: string;
  orcidUrl?: string;
  homes: PublicResearchEntityDto[];
}

const PERSON_PUBLIC_KEY_PATTERN = /^([0-9a-f]{24})(?:-|$)/;
const MAX_AGGREGATED_HOMES = 50;

const normalizePersonPublicKey = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
  return normalized || undefined;
};

/**
 * The served member/lead public key is `slug(personId:role)` from
 * publicMemberKeyForResearchDetail, and the identity component is the person's
 * ObjectId hex. Aggregation keys on that identity, so changing how that key is
 * built also requires updating this reverse resolution.
 */
const personIdFromPublicKey = (publicKey: string): mongoose.Types.ObjectId | undefined => {
  const match = PERSON_PUBLIC_KEY_PATTERN.exec(publicKey);
  if (!match) return undefined;
  const candidate = match[1];
  return mongoose.isValidObjectId(candidate) ? new mongoose.Types.ObjectId(candidate) : undefined;
};

const profileLinkUrl = (
  links: readonly ResearcherProfileLink[] | undefined,
  kinds: readonly ResearcherProfileLink['kind'][],
): string | undefined => {
  if (!Array.isArray(links)) return undefined;
  for (const kind of kinds) {
    const match = links.find(
      (link) => link?.kind === kind && typeof link.url === 'string' && link.url.trim(),
    );
    if (match) return match.url.trim();
  }
  return undefined;
};

const mostCommonSchool = (homes: PublicResearchEntityDto[]): string | undefined => {
  const counts = new Map<string, number>();
  for (const home of homes) {
    const school = typeof home.school === 'string' ? home.school.trim() : '';
    if (school) counts.set(school, (counts.get(school) || 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [school, count] of counts) {
    if (count > bestCount) {
      best = school;
      bestCount = count;
    }
  }
  return best;
};

export async function getResearcherProfileByPublicKey(
  rawPublicKey: string,
): Promise<PublicResearcherProfile | null> {
  const publicKey = normalizePersonPublicKey(rawPublicKey);
  if (!publicKey) return null;

  const personId = personIdFromPublicKey(publicKey);
  if (!personId) return null;

  const researcher = (await Researcher.findOne({
    _id: personId,
    archived: { $ne: true },
    status: { $ne: 'DEPARTED' },
  })
    .select('_id displayName status profile profileLinks')
    .lean()) as {
    displayName?: string;
    status?: ResearcherStatus;
    profile?: ResearcherDisplayProfile;
    profileLinks?: ResearcherProfileLink[];
  } | null;
  if (!researcher) return null;

  const displayName = publiclyFindableResearcherDisplayName(researcher.displayName);
  if (!displayName) return null;

  const assignments = await RoleAssignment.find({
    personId,
    'target.kind': 'RESEARCH_ENTITY',
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('target.id')
    .lean();

  const entityIds = Array.from(
    new Set(
      assignments
        .map((assignment: any) => assignment?.target?.id)
        .filter((id: unknown): id is mongoose.Types.ObjectId => id instanceof mongoose.Types.ObjectId)
        .map((id: mongoose.Types.ObjectId) => id.toString()),
    ),
  ).map((id) => new mongoose.Types.ObjectId(id));

  let homes: PublicResearchEntityDto[] = [];
  if (entityIds.length > 0) {
    const entities = await ResearchEntity.find({
      _id: { $in: entityIds },
      archived: { $ne: true },
      studentVisibilityTier: { $in: publicStudentVisibilityTiers },
    }).lean();

    const servableEntities = (entities as Record<string, any>[])
      .filter((entity) => publicStudentVisibilityTiers.includes(entity.studentVisibilityTier))
      .filter(researchEntityServesPublicDetail);

    homes = servableEntities
      .slice(0, MAX_AGGREGATED_HOMES)
      .map((entity) => toPublicResearchEntityDto(entity, { forList: true }));
  }

  const profileLinks = researcher.profileLinks as ResearcherProfileLink[] | undefined;

  if (
    !researcherIsPubliclyFindable({
      status: researcher.status,
      displayName: researcher.displayName,
      servableHomeCount: homes.length,
      hasPrimaryIdentityLink: researcherHasPrimaryIdentityLink(profileLinks),
    })
  ) {
    return null;
  }

  const officialProfileUrl = profileLinkUrl(profileLinks, [
    'YALE_OFFICIAL',
    'LAB_ABOUT',
    'PERSONAL_ACADEMIC',
  ]);
  const scholarUrl = profileLinkUrl(profileLinks, ['GOOGLE_SCHOLAR']);
  const orcidUrl = profileLinkUrl(profileLinks, ['ORCID']);
  const title =
    typeof researcher.profile?.title === 'string' ? researcher.profile.title.trim() : undefined;
  const primaryDepartment =
    typeof researcher.profile?.primaryDepartment === 'string'
      ? researcher.profile.primaryDepartment.trim()
      : undefined;
  const school = mostCommonSchool(homes);

  return {
    publicKey,
    displayName,
    ...(title ? { title } : {}),
    ...(primaryDepartment ? { primaryDepartment } : {}),
    ...(school ? { school } : {}),
    ...(officialProfileUrl ? { officialProfileUrl } : {}),
    ...(scholarUrl ? { scholarUrl } : {}),
    ...(orcidUrl ? { orcidUrl } : {}),
    homes,
  };
}
