import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import {
  buildUserIdentityDedupePlan,
  type UserIdentityCollision,
} from '../scripts/dedupeUsersByIdentityCore';
import {
  buildResearchEntityPiDedupePlan,
  type ResearchEntityPiDedupeRow,
} from '../scripts/researchEntityPiDedupeCore';

export type PostMaterializationIntegrityStatus = 'pass' | 'failure';
export type IntegrityWarningClassification =
  | 'must_fix_before_promotion'
  | 'accepted_release_warning'
  | 'post_promotion_backlog';

export type PostMaterializationIntegrityFailureName =
  | 'samePiSameNameResearchEntities'
  | 'officialLabUrlResearchEntities'
  | 'duplicatePeople'
  | 'duplicateResearchPapers'
  | 'duplicateCurrentMembers'
  | 'currentMembersOnArchivedEntities'
  | 'duplicateExploratoryContactPathways'
  | 'duplicateAccessSignals'
  | 'activeArtifactsOnArchivedEntities';

export interface SamePiNameDuplicateGroup {
  userId: string;
  normalizedName: string;
  entityIds: string[];
}

export interface OfficialLabUrlDuplicateGroup {
  officialLabUrl: string;
  entityIds: string[];
}

export interface DuplicateCurrentMemberGroup {
  researchEntityId: string;
  userId: string;
  role?: string;
  memberIds: string[];
}

export interface DuplicatePersonGroup {
  identityField: 'netid' | 'email' | 'orcid' | 'openAlexId' | 'googleScholarId';
  identityValue: string;
  userIds: string[];
}

export interface DuplicateResearchPaperGroup {
  identityField: 'openAlexId' | 'semanticScholarId' | 'arxivId' | 'doi';
  identityValue: string;
  paperIds: string[];
}

export interface DuplicateAccessSignalGroup {
  researchEntityId: string;
  signalType: string;
  identityField: 'derivationKey' | 'sourceEvidenceId' | 'observationId';
  identityValue: string;
  signalIds: string[];
}

export interface CurrentMemberOnArchivedEntity {
  researchEntityId: string;
  memberId: string;
  userId?: string;
  role?: string;
  canonicalGroupId?: string | null;
}

export interface DuplicateExploratoryContactPathwayGroup {
  researchEntityId: string;
  pathwayIds: string[];
  derivationKeys: string[];
}

export interface ActiveArtifactOnArchivedEntity {
  artifactType: 'EntryPathway' | 'AccessSignal' | 'ContactRoute' | 'PostedOpportunity';
  artifactId: string;
  researchEntityId: string;
  canonicalGroupId?: string | null;
}

export interface PostMaterializationIntegrityWarning {
  name: string;
  count: number;
  message: string;
  classification?: IntegrityWarningClassification;
  owner?: string;
  nextCommand?: string;
}

export interface BuildPostMaterializationIntegrityInput {
  samePiNameDuplicateGroups?: SamePiNameDuplicateGroup[];
  officialLabUrlDuplicateGroups?: OfficialLabUrlDuplicateGroup[];
  duplicatePersonGroups?: DuplicatePersonGroup[];
  duplicateResearchPaperGroups?: DuplicateResearchPaperGroup[];
  duplicateCurrentMemberGroups?: DuplicateCurrentMemberGroup[];
  currentMembersOnArchivedEntities?: CurrentMemberOnArchivedEntity[];
  duplicateExploratoryContactPathwayGroups?: DuplicateExploratoryContactPathwayGroup[];
  duplicateAccessSignalGroups?: DuplicateAccessSignalGroup[];
  activeArtifactsOnArchivedEntities?: ActiveArtifactOnArchivedEntity[];
  warnings?: PostMaterializationIntegrityWarning[];
  limit?: number;
  sourceRunId?: string;
}

export interface PostMaterializationIntegritySummary {
  status: PostMaterializationIntegrityStatus;
  sourceRunId?: string;
  counts: Record<PostMaterializationIntegrityFailureName, number>;
  failureNames: PostMaterializationIntegrityFailureName[];
  samples: {
    samePiSameNameResearchEntities: SamePiNameDuplicateGroup[];
    officialLabUrlResearchEntities: OfficialLabUrlDuplicateGroup[];
    duplicatePeople: DuplicatePersonGroup[];
    duplicateResearchPapers: DuplicateResearchPaperGroup[];
    duplicateCurrentMembers: DuplicateCurrentMemberGroup[];
    currentMembersOnArchivedEntities: CurrentMemberOnArchivedEntity[];
    duplicateExploratoryContactPathways: DuplicateExploratoryContactPathwayGroup[];
    duplicateAccessSignals: DuplicateAccessSignalGroup[];
    activeArtifactsOnArchivedEntities: ActiveArtifactOnArchivedEntity[];
  };
  warnings: PostMaterializationIntegrityWarning[];
  recommendedCommands: string[];
}

export interface RunPostMaterializationIntegrityGateOptions {
  includeSamples?: boolean;
  limit?: number;
  sourceRunId?: string;
}

const DEFAULT_SAMPLE_LIMIT = 25;
const DUPLICATE_PEOPLE_SCAN_LIMIT_PER_FIELD = 5000;

const FAILURE_ORDER: PostMaterializationIntegrityFailureName[] = [
  'samePiSameNameResearchEntities',
  'officialLabUrlResearchEntities',
  'duplicatePeople',
  'duplicateResearchPapers',
  'duplicateCurrentMembers',
  'currentMembersOnArchivedEntities',
  'duplicateExploratoryContactPathways',
  'duplicateAccessSignals',
  'activeArtifactsOnArchivedEntities',
];

const RECOMMENDED_COMMANDS = [
  'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --apply',
  'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --official-lab-url-only --apply',
  'yarn --cwd server users:dedupe-by-identity --limit=1000 --apply',
  'yarn --cwd server pathways:dedupe-exploratory --limit=1000 --apply',
  'yarn --cwd server meili:rebuild-pathways --clear',
  'yarn --cwd server meili:rebuild-research-entities --clear',
];
const SAME_PI_ENTITY_SCAN_LIMIT = 10000;

const INTEGRITY_WARNING_OPERATOR_METADATA: Record<
  string,
  Pick<PostMaterializationIntegrityWarning, 'classification' | 'owner' | 'nextCommand'>
> = {
  duplicatePersonIdentityConflicts: {
    classification: 'must_fix_before_promotion',
    owner: 'identity/account operator',
    nextCommand: 'yarn --cwd server users:dedupe-by-identity --limit=1000',
  },
};

function sample<T>(rows: T[] | undefined, limit: number): T[] {
  return (rows || []).slice(0, limit);
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

export function buildPostMaterializationIntegritySummary(
  input: BuildPostMaterializationIntegrityInput,
): PostMaterializationIntegritySummary {
  const limit = input.limit ?? DEFAULT_SAMPLE_LIMIT;
  const counts: Record<PostMaterializationIntegrityFailureName, number> = {
    samePiSameNameResearchEntities: input.samePiNameDuplicateGroups?.length || 0,
    officialLabUrlResearchEntities: input.officialLabUrlDuplicateGroups?.length || 0,
    duplicatePeople: input.duplicatePersonGroups?.length || 0,
    duplicateResearchPapers: input.duplicateResearchPaperGroups?.length || 0,
    duplicateCurrentMembers: input.duplicateCurrentMemberGroups?.length || 0,
    currentMembersOnArchivedEntities: input.currentMembersOnArchivedEntities?.length || 0,
    duplicateExploratoryContactPathways:
      input.duplicateExploratoryContactPathwayGroups?.length || 0,
    duplicateAccessSignals: input.duplicateAccessSignalGroups?.length || 0,
    activeArtifactsOnArchivedEntities: input.activeArtifactsOnArchivedEntities?.length || 0,
  };
  const failureNames = FAILURE_ORDER.filter((name) => counts[name] > 0);
  const warnings = enrichIntegrityWarnings(input.warnings || []);
  const warningCommands = warnings
    .map((warning) => warning.nextCommand)
    .filter((command): command is string => Boolean(command));

  return {
    status: failureNames.length > 0 ? 'failure' : 'pass',
    sourceRunId: input.sourceRunId,
    counts,
    failureNames,
    samples: {
      samePiSameNameResearchEntities: sample(input.samePiNameDuplicateGroups, limit),
      officialLabUrlResearchEntities: sample(input.officialLabUrlDuplicateGroups, limit),
      duplicatePeople: sample(input.duplicatePersonGroups, limit),
      duplicateResearchPapers: sample(input.duplicateResearchPaperGroups, limit),
      duplicateCurrentMembers: sample(input.duplicateCurrentMemberGroups, limit),
      currentMembersOnArchivedEntities: sample(input.currentMembersOnArchivedEntities, limit),
      duplicateExploratoryContactPathways: sample(
        input.duplicateExploratoryContactPathwayGroups,
        limit,
      ),
      duplicateAccessSignals: sample(input.duplicateAccessSignalGroups, limit),
      activeArtifactsOnArchivedEntities: sample(input.activeArtifactsOnArchivedEntities, limit),
    },
    warnings,
    recommendedCommands: [
      ...(failureNames.length > 0 ? RECOMMENDED_COMMANDS : []),
      ...warningCommands,
    ],
  };
}

function enrichIntegrityWarnings(
  warnings: PostMaterializationIntegrityWarning[],
): PostMaterializationIntegrityWarning[] {
  return warnings.map((warning) => ({
    ...warning,
    ...INTEGRITY_WARNING_OPERATOR_METADATA[warning.name],
  }));
}

async function loadDuplicatePeopleIntegrity(): Promise<{
  groups: DuplicatePersonGroup[];
  warnings: PostMaterializationIntegrityWarning[];
}> {
  const fields: DuplicatePersonGroup['identityField'][] = [
    'netid',
    'email',
    'orcid',
    'openAlexId',
    'googleScholarId',
  ];
  const collisions: UserIdentityCollision[] = [];

  for (const field of fields) {
    const rows = await User.aggregate([
      {
        $project: {
          identityValue: { $trim: { input: { $toLower: `$${field}` } } },
          user: {
            id: { $toString: '$_id' },
            netid: '$netid',
            email: '$email',
            fname: '$fname',
            lname: '$lname',
            userConfirmed: '$userConfirmed',
            lastLogin: '$lastLogin',
            lastLoginAt: '$lastLoginAt',
            lastActive: '$lastActive',
            loginCount: '$loginCount',
            departments: '$departments',
            primaryDepartment: '$primaryDepartment',
            orcid: '$orcid',
            openAlexId: '$openAlexId',
            googleScholarId: '$googleScholarId',
            createdAt: '$createdAt',
            updatedAt: '$updatedAt',
          },
        },
      },
      {
        $match: {
          identityValue: { $nin: ['', 'na', 'n/a', 'unknown'] },
        },
      },
      {
        $group: {
          _id: '$identityValue',
          users: { $push: '$user' },
        },
      },
      { $match: { 'users.1': { $exists: true } } },
      { $limit: DUPLICATE_PEOPLE_SCAN_LIMIT_PER_FIELD },
    ]);

    for (const row of rows) {
      collisions.push({
        identityField: field,
        identityValue: stringId(row._id),
        users: row.users || [],
      });
    }
  }

  const plan = buildUserIdentityDedupePlan(collisions);
  return {
    groups: plan.groups.map((group) => ({
      identityField: group.identityField,
      identityValue: group.identityValue,
      userIds: [group.canonicalUserId, ...group.duplicateUserIds],
    })),
    warnings:
      plan.warningGroups.length > 0
        ? [
            {
              name: 'duplicatePersonIdentityConflicts',
              count: plan.warningGroups.length,
              message:
                'Some user identity values are shared by different names; review or repair source identity fields before merging.',
            },
          ]
        : [],
  };
}

async function loadDuplicateResearchPaperGroups(
  limit: number,
): Promise<DuplicateResearchPaperGroup[]> {
  void limit;
  return [];
}

async function loadSamePiNameDuplicateGroups(limit: number): Promise<SamePiNameDuplicateGroup[]> {
  const rows = await ResearchGroupMember.aggregate([
    {
      $match: {
        role: 'pi',
        isCurrentMember: { $ne: false },
        researchEntityId: { $exists: true, $ne: null },
        userId: { $exists: true, $ne: null },
      },
    },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'researchEntityId',
        foreignField: '_id',
        as: 'entity',
      },
    },
    { $unwind: '$entity' },
    { $match: { 'entity.archived': { $ne: true } } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        userId: { $toString: '$userId' },
        piFirstName: '$user.fname',
        piLastName: '$user.lname',
        entity: {
          id: { $toString: '$entity._id' },
          slug: '$entity.slug',
          name: '$entity.name',
          websiteUrl: '$entity.websiteUrl',
          sourceUrls: '$entity.sourceUrls',
          departments: '$entity.departments',
          researchAreas: '$entity.researchAreas',
        },
      },
    },
    {
      $group: {
        _id: { userId: '$userId' },
        piFirstName: { $first: '$piFirstName' },
        piLastName: { $first: '$piLastName' },
        entities: { $addToSet: '$entity' },
      },
    },
    { $match: { 'entities.1': { $exists: true } } },
    { $limit: SAME_PI_ENTITY_SCAN_LIMIT },
  ]);

  return buildSamePiNameDuplicateGroupsFromDedupeRows(
    rows.map((row: any) => ({
      userId: stringId(row._id?.userId),
      normalizedName: `same-pi:${stringId(row._id?.userId)}`,
      piFirstName: stringId(row.piFirstName),
      piLastName: stringId(row.piLastName),
      entities: row.entities || [],
    })),
  ).slice(0, limit);
}

export function buildSamePiNameDuplicateGroupsFromDedupeRows(
  rows: ResearchEntityPiDedupeRow[],
): SamePiNameDuplicateGroup[] {
  return buildResearchEntityPiDedupePlan(rows).map((group) => ({
    userId: group.userId,
    normalizedName: group.normalizedName,
    entityIds: [group.canonicalEntityId, ...group.duplicateEntityIds],
  }));
}

async function loadOfficialLabUrlDuplicateGroups(
  limit: number,
): Promise<OfficialLabUrlDuplicateGroup[]> {
  const rows = await ResearchEntity.aggregate([
    { $match: { archived: { $ne: true } } },
    {
      $project: {
        entityId: { $toString: '$_id' },
        urls: {
          $setUnion: [
            {
              $cond: [
                {
                  $and: [
                    { $ne: ['$websiteUrl', null] },
                    { $ne: [{ $trim: { input: '$websiteUrl' } }, ''] },
                  ],
                },
                ['$websiteUrl'],
                [],
              ],
            },
            { $ifNull: ['$sourceUrls', []] },
          ],
        },
      },
    },
    { $unwind: '$urls' },
    {
      $project: {
        officialLabUrl: { $trim: { input: { $toLower: '$urls' } } },
        entityId: 1,
      },
    },
    {
      $match: {
        officialLabUrl: { $regex: '^https://medicine\\.yale\\.edu/lab/[^/]+/?$' },
      },
    },
    {
      $group: {
        _id: '$officialLabUrl',
        entityIds: { $addToSet: '$entityId' },
      },
    },
    { $match: { 'entityIds.1': { $exists: true } } },
    { $sort: { _id: 1 } },
    { $limit: limit },
  ]);

  return rows.map((row: any) => ({
    officialLabUrl: stringId(row._id),
    entityIds: (row.entityIds || []).map(stringId),
  }));
}

async function loadDuplicateCurrentMemberGroups(
  limit: number,
): Promise<DuplicateCurrentMemberGroup[]> {
  const rows = await ResearchGroupMember.aggregate([
    {
      $match: {
        isCurrentMember: { $ne: false },
        researchEntityId: { $exists: true, $ne: null },
        userId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: {
          researchEntityId: '$researchEntityId',
          userId: '$userId',
          role: '$role',
        },
        memberIds: { $push: { $toString: '$_id' } },
      },
    },
    { $match: { 'memberIds.1': { $exists: true } } },
    { $limit: limit },
  ]);

  return rows.map((row: any) => ({
    researchEntityId: stringId(row._id?.researchEntityId),
    userId: stringId(row._id?.userId),
    role: row._id?.role,
    memberIds: (row.memberIds || []).map(stringId).filter(Boolean),
  }));
}

async function loadCurrentMembersOnArchivedEntities(
  limit: number,
): Promise<CurrentMemberOnArchivedEntity[]> {
  const rows = await ResearchGroupMember.aggregate([
    {
      $match: {
        isCurrentMember: { $ne: false },
        researchEntityId: { $exists: true, $ne: null },
      },
    },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'researchEntityId',
        foreignField: '_id',
        as: 'entity',
      },
    },
    { $unwind: '$entity' },
    { $match: { 'entity.archived': true } },
    {
      $project: {
        memberId: { $toString: '$_id' },
        researchEntityId: { $toString: '$researchEntityId' },
        userId: { $toString: '$userId' },
        role: '$role',
        canonicalGroupId: { $toString: '$entity.canonicalGroupId' },
      },
    },
    { $limit: limit },
  ]);

  return rows.map((row: any) => ({
    researchEntityId: stringId(row.researchEntityId),
    memberId: stringId(row.memberId),
    userId: stringId(row.userId) || undefined,
    role: row.role,
    canonicalGroupId: stringId(row.canonicalGroupId) || null,
  }));
}

async function loadDuplicateExploratoryContactPathwayGroups(
  limit: number,
): Promise<DuplicateExploratoryContactPathwayGroup[]> {
  const rows = await EntryPathway.aggregate([
    {
      $match: {
        archived: { $ne: true },
        pathwayType: 'EXPLORATORY_CONTACT',
        researchEntityId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: '$researchEntityId',
        pathwayIds: { $push: { $toString: '$_id' } },
        derivationKeys: { $addToSet: '$derivationKey' },
      },
    },
    { $match: { 'pathwayIds.1': { $exists: true } } },
    { $limit: limit },
  ]);

  return rows.map((row: any) => ({
    researchEntityId: stringId(row._id),
    pathwayIds: (row.pathwayIds || []).map(stringId).filter(Boolean),
    derivationKeys: (row.derivationKeys || []).map(stringId).filter(Boolean),
  }));
}

async function loadDuplicateAccessSignalGroups(
  limit: number,
): Promise<DuplicateAccessSignalGroup[]> {
  const fields: DuplicateAccessSignalGroup['identityField'][] = [
    'derivationKey',
    'sourceEvidenceId',
    'observationId',
  ];
  const groups: DuplicateAccessSignalGroup[] = [];

  for (const field of fields) {
    const rows = await AccessSignal.aggregate([
      {
        $match: {
          archived: { $ne: true },
          researchEntityId: { $exists: true, $ne: null },
          signalType: { $exists: true, $ne: '' },
          [field]: { $exists: true, $ne: null },
        },
      },
      {
        $project: {
          researchEntityId: { $toString: '$researchEntityId' },
          signalType: '$signalType',
          identityValue: { $toString: `$${field}` },
          signalId: { $toString: '$_id' },
        },
      },
      { $match: { identityValue: { $nin: ['', 'null', 'undefined'] } } },
      {
        $group: {
          _id: {
            researchEntityId: '$researchEntityId',
            signalType: '$signalType',
            identityValue: '$identityValue',
          },
          signalIds: { $addToSet: '$signalId' },
        },
      },
      { $match: { 'signalIds.1': { $exists: true } } },
      { $limit: Math.max(1, limit - groups.length) },
    ]);

    for (const row of rows) {
      groups.push({
        researchEntityId: stringId(row._id?.researchEntityId),
        signalType: stringId(row._id?.signalType),
        identityField: field,
        identityValue: stringId(row._id?.identityValue),
        signalIds: (row.signalIds || []).map(stringId).filter(Boolean),
      });
      if (groups.length >= limit) return groups;
    }
  }

  return groups;
}

async function loadActiveArtifactsOnArchivedEntities(
  limit: number,
): Promise<ActiveArtifactOnArchivedEntity[]> {
  const artifactSpecs = [
    { artifactType: 'EntryPathway' as const, model: EntryPathway },
    { artifactType: 'AccessSignal' as const, model: AccessSignal },
    { artifactType: 'ContactRoute' as const, model: ContactRoute },
    { artifactType: 'PostedOpportunity' as const, model: PostedOpportunity },
  ];
  const results: ActiveArtifactOnArchivedEntity[] = [];

  for (const spec of artifactSpecs) {
    const rows = await spec.model.aggregate([
      {
        $match: {
          archived: { $ne: true },
          researchEntityId: { $exists: true, $ne: null },
        },
      },
      {
        $lookup: {
          from: 'research_entities',
          localField: 'researchEntityId',
          foreignField: '_id',
          as: 'entity',
        },
      },
      { $unwind: '$entity' },
      { $match: { 'entity.archived': true } },
      {
        $project: {
          artifactId: { $toString: '$_id' },
          researchEntityId: { $toString: '$researchEntityId' },
          canonicalGroupId: { $toString: '$entity.canonicalGroupId' },
        },
      },
      { $limit: Math.max(1, limit - results.length) },
    ]);

    for (const row of rows) {
      results.push({
        artifactType: spec.artifactType,
        artifactId: stringId(row.artifactId),
        researchEntityId: stringId(row.researchEntityId),
        canonicalGroupId: stringId(row.canonicalGroupId) || null,
      });
      if (results.length >= limit) return results;
    }
  }

  return results;
}

async function loadAmbiguousSameNameWarning(): Promise<PostMaterializationIntegrityWarning[]> {
  return [];
}

export async function runPostMaterializationIntegrityGate(
  options: RunPostMaterializationIntegrityGateOptions = {},
): Promise<PostMaterializationIntegritySummary> {
  const limit = Math.max(1, Math.floor(options.limit || DEFAULT_SAMPLE_LIMIT));
  const queryLimit = options.includeSamples ? limit : 1;
  const [
    samePiNameDuplicateGroups,
    officialLabUrlDuplicateGroups,
    duplicatePersonIntegrity,
    duplicateResearchPaperGroups,
    duplicateCurrentMemberGroups,
    currentMembersOnArchivedEntities,
    duplicateExploratoryContactPathwayGroups,
    duplicateAccessSignalGroups,
    activeArtifactsOnArchivedEntities,
    warnings,
  ] = await Promise.all([
    loadSamePiNameDuplicateGroups(queryLimit),
    loadOfficialLabUrlDuplicateGroups(queryLimit),
    loadDuplicatePeopleIntegrity(),
    loadDuplicateResearchPaperGroups(queryLimit),
    loadDuplicateCurrentMemberGroups(queryLimit),
    loadCurrentMembersOnArchivedEntities(queryLimit),
    loadDuplicateExploratoryContactPathwayGroups(queryLimit),
    loadDuplicateAccessSignalGroups(queryLimit),
    loadActiveArtifactsOnArchivedEntities(queryLimit),
    loadAmbiguousSameNameWarning(),
  ]);

  return buildPostMaterializationIntegritySummary({
    samePiNameDuplicateGroups,
    officialLabUrlDuplicateGroups,
    duplicatePersonGroups: duplicatePersonIntegrity.groups,
    duplicateResearchPaperGroups,
    duplicateCurrentMemberGroups,
    currentMembersOnArchivedEntities,
    duplicateExploratoryContactPathwayGroups,
    duplicateAccessSignalGroups,
    activeArtifactsOnArchivedEntities,
    warnings: [...warnings, ...duplicatePersonIntegrity.warnings],
    limit: options.includeSamples ? limit : 0,
    sourceRunId: options.sourceRunId,
  });
}

export function isIntegrityGateFailure(
  summary: PostMaterializationIntegritySummary | undefined,
): boolean {
  return summary?.status === 'failure';
}
