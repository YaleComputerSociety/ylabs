import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import {
  Researcher,
  type ResearcherDisplayProfile,
  type ResearcherProfileLink,
} from '../models/researcher';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { toPublicResearchEntityDto, type PublicResearchEntityDto } from './researchEntityDto';
import { researchEntityServesPublicDetail } from './researchEntityPublicDescription';
import {
  MAX_AGGREGATED_RESEARCHER_HOMES,
  toPublicResearcherDto,
  type PublicResearcherProfile,
} from './researcherDto';

export type { PublicResearcherProfile } from './researcherDto';

const OBJECT_ID_HEX_PATTERN = /^[0-9a-f]{24}$/i;
const PERSON_PUBLIC_KEY_PREFIX_PATTERN = /^([0-9a-f]{24})(?:-|$)/;

const personIdFromPublicKey = (rawPublicKey: unknown): mongoose.Types.ObjectId | undefined => {
  if (typeof rawPublicKey !== 'string') return undefined;
  const match = PERSON_PUBLIC_KEY_PREFIX_PATTERN.exec(rawPublicKey.trim().toLowerCase());
  if (!match) return undefined;
  return new mongoose.Types.ObjectId(match[1]);
};

const personIdFromRawId = (rawId: unknown): mongoose.Types.ObjectId | undefined => {
  if (typeof rawId !== 'string') return undefined;
  const trimmed = rawId.trim();
  if (!OBJECT_ID_HEX_PATTERN.test(trimmed)) return undefined;
  return new mongoose.Types.ObjectId(trimmed);
};

interface ResearcherLean {
  _id: mongoose.Types.ObjectId;
  displayName?: string;
  profile?: ResearcherDisplayProfile;
  profileLinks?: ResearcherProfileLink[];
}

export async function resolvePublicResearchHomesForPerson(
  personId: mongoose.Types.ObjectId,
): Promise<PublicResearchEntityDto[]> {
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
        .filter(
          (id: unknown): id is mongoose.Types.ObjectId => id instanceof mongoose.Types.ObjectId,
        )
        .map((id: mongoose.Types.ObjectId) => id.toString()),
    ),
  ).map((id) => new mongoose.Types.ObjectId(id));
  if (entityIds.length === 0) return [];

  const entities = await ResearchEntity.find({
    _id: { $in: entityIds },
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  }).lean();

  return (entities as Record<string, any>[])
    .filter((entity) => publicStudentVisibilityTiers.includes(entity.studentVisibilityTier))
    .filter(researchEntityServesPublicDetail)
    .slice(0, MAX_AGGREGATED_RESEARCHER_HOMES)
    .map((entity) => toPublicResearchEntityDto(entity, { forList: true }));
}

async function resolvePublicResearcherProfile(
  personId: mongoose.Types.ObjectId,
): Promise<PublicResearcherProfile | null> {
  const researcher = (await Researcher.findOne({
    _id: personId,
    archived: { $ne: true },
    status: { $ne: 'DEPARTED' },
  })
    .select('_id displayName profile profileLinks')
    .lean()) as ResearcherLean | null;
  if (!researcher) return null;

  const homes = await resolvePublicResearchHomesForPerson(personId);
  return toPublicResearcherDto({
    id: researcher._id,
    displayName: researcher.displayName,
    profile: researcher.profile,
    profileLinks: researcher.profileLinks,
    homes,
  });
}

/**
 * The served member/lead public key is `slug(personId:role)` from
 * publicMemberKeyForResearchDetail, and the identity component is the person's
 * ObjectId hex. Aggregation keys on that identity, so changing how that key is
 * built also requires updating this reverse resolution.
 */
export async function getResearcherProfileByPublicKey(
  rawPublicKey: string,
): Promise<PublicResearcherProfile | null> {
  const personId = personIdFromPublicKey(rawPublicKey);
  if (!personId) return null;
  return resolvePublicResearcherProfile(personId);
}

export async function getResearcherProfileById(
  rawId: string,
): Promise<PublicResearcherProfile | null> {
  const personId = personIdFromRawId(rawId);
  if (!personId) return null;
  return resolvePublicResearcherProfile(personId);
}
