import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import { ResearchEntity } from '../models/researchEntity';
import {
  tombstoneTerminalCauseIsMalformed,
  walkResearchEntityTombstoneChainWithCause,
  type ResearchEntityTombstoneNode,
} from '../services/researchEntityCanonicalTombstone';
import { RoleAssignment, type RoleAssignmentRole } from '../models/roleAssignment';
import { LEGACY_ROLE_BY_CANONICAL } from '../models/canonicalRoleMapping';
import mongoose from 'mongoose';
import { Account } from '../models/account';
import { Researcher } from '../models/researcher';
import { splitName } from './utils/scraperHelpers';
import {
  buildResearchEntityPiDedupePlan,
  type ResearchEntityPiDedupeRow,
} from '../scripts/researchEntityPiDedupeCore';

export type PostMaterializationIntegrityStatus = 'pass' | 'failure';
export type IntegrityWarningClassification =
  'must_fix_before_promotion' | 'accepted_release_warning' | 'post_promotion_backlog';

export type PostMaterializationIntegrityFailureName =
  | 'samePiSameNameResearchEntities'
  | 'officialLabUrlResearchEntities'
  | 'duplicatePeople'
  | 'duplicateCurrentMembers'
  | 'currentMembersOnArchivedEntities'
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

export interface ActiveArtifactOnArchivedEntity {
  artifactType: 'AccessSignal';
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
  duplicateCurrentMemberGroups?: DuplicateCurrentMemberGroup[];
  currentMembersOnArchivedEntities?: CurrentMemberOnArchivedEntity[];
  duplicateAccessSignalGroups?: DuplicateAccessSignalGroup[];
  activeArtifactsOnArchivedEntities?: ActiveArtifactOnArchivedEntity[];
  warnings?: PostMaterializationIntegrityWarning[];
  limit?: number;
  truncatedChecks?: PostMaterializationIntegrityFailureName[];
  populationCounts?: Partial<Record<PostMaterializationIntegrityFailureName, number>>;
  sourceRunId?: string;
  commandEnvironment?: string;
}

export interface PostMaterializationIntegritySummary {
  status: PostMaterializationIntegrityStatus;
  sourceRunId?: string;
  counts: Record<PostMaterializationIntegrityFailureName, number>;
  countLabels: Record<PostMaterializationIntegrityFailureName, string>;
  failureNames: PostMaterializationIntegrityFailureName[];
  samples: {
    samePiSameNameResearchEntities: SamePiNameDuplicateGroup[];
    officialLabUrlResearchEntities: OfficialLabUrlDuplicateGroup[];
    duplicatePeople: DuplicatePersonGroup[];
    duplicateCurrentMembers: DuplicateCurrentMemberGroup[];
    currentMembersOnArchivedEntities: CurrentMemberOnArchivedEntity[];
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
  commandEnvironment?: string;
}

const DEFAULT_SAMPLE_LIMIT = 25;
const DEFAULT_COMMAND_ENVIRONMENT = 'development';

function environmentCommand(command: string, environment: string): string {
  const trimmed = command.trim();
  if (!trimmed || /^[A-Z_][A-Z0-9_]*=/.test(trimmed)) return trimmed;
  if (trimmed.startsWith('yarn --cwd server ')) return `SCRAPER_ENV=${environment} ${trimmed}`;
  return trimmed;
}

const FAILURE_ORDER: PostMaterializationIntegrityFailureName[] = [
  'samePiSameNameResearchEntities',
  'officialLabUrlResearchEntities',
  'duplicatePeople',
  'duplicateCurrentMembers',
  'currentMembersOnArchivedEntities',
  'duplicateAccessSignals',
  'activeArtifactsOnArchivedEntities',
];

const SAME_PI_DEDUPE_REVIEW_COMMAND =
  'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json --allow-empty-decisions --decision-template-output /tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json --output /tmp/ylabs-research-entity-dedupe.json';

const RECOMMENDED_COMMANDS_BY_FAILURE: Record<PostMaterializationIntegrityFailureName, string[]> = {
  samePiSameNameResearchEntities: [SAME_PI_DEDUPE_REVIEW_COMMAND],
  officialLabUrlResearchEntities: [
    'yarn --cwd server research-entity:dedupe-by-pi --limit=10000 --official-lab-url-only --output /tmp/ylabs-research-entity-dedupe-official-lab-url.json',
  ],
  duplicatePeople: [
    'yarn --cwd server researchers:dedupe-accountless-shells --output /tmp/ylabs-accountless-researcher-shell-dedupe.json',
  ],
  duplicateCurrentMembers: [SAME_PI_DEDUPE_REVIEW_COMMAND],
  currentMembersOnArchivedEntities: [
    'yarn --cwd server research-entity:repair-archived-artifacts --artifact-type=role-assignment --limit=5000 --output /tmp/ylabs-archived-entity-artifact-repair.json',
  ],
  duplicateAccessSignals: [
    'yarn --cwd server access-signals:repair-duplicates --limit=1000 --output /tmp/ylabs-duplicate-access-signal-repair.json',
  ],
  activeArtifactsOnArchivedEntities: [
    'yarn --cwd server research-entity:repair-archived-artifacts --artifact-type=access-signal --limit=5000 --output /tmp/ylabs-archived-entity-artifact-repair.json',
  ],
};
const SAME_PI_ENTITY_SCAN_LIMIT = 10000;

const INTEGRITY_WARNING_OPERATOR_METADATA: Record<
  string,
  Pick<PostMaterializationIntegrityWarning, 'classification' | 'owner' | 'nextCommand'>
> = {
  deadEndTombstoneChains: {
    classification: 'post_promotion_backlog',
    owner: 'research-entity operator',
    nextCommand: 'yarn --cwd server research-entity:repair-dead-end-tombstones',
  },
  duplicatePersonIdentityConflicts: {
    classification: 'must_fix_before_promotion',
    owner: 'identity/account operator',
    nextCommand:
      'yarn --cwd server users:repair-mismatched-emails --limit=10000 --output /tmp/ylabs-mismatched-person-email-repair.json',
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
  const sampledCounts: Record<PostMaterializationIntegrityFailureName, number> = {
    samePiSameNameResearchEntities: input.samePiNameDuplicateGroups?.length || 0,
    officialLabUrlResearchEntities: input.officialLabUrlDuplicateGroups?.length || 0,
    duplicatePeople: input.duplicatePersonGroups?.length || 0,
    duplicateCurrentMembers: input.duplicateCurrentMemberGroups?.length || 0,
    currentMembersOnArchivedEntities: input.currentMembersOnArchivedEntities?.length || 0,
    duplicateAccessSignals: input.duplicateAccessSignalGroups?.length || 0,
    activeArtifactsOnArchivedEntities: input.activeArtifactsOnArchivedEntities?.length || 0,
  };
  const samples: PostMaterializationIntegritySummary['samples'] = {
    samePiSameNameResearchEntities: sample(input.samePiNameDuplicateGroups, limit),
    officialLabUrlResearchEntities: sample(input.officialLabUrlDuplicateGroups, limit),
    duplicatePeople: sample(input.duplicatePersonGroups, limit),
    duplicateCurrentMembers: sample(input.duplicateCurrentMemberGroups, limit),
    currentMembersOnArchivedEntities: sample(input.currentMembersOnArchivedEntities, limit),
    duplicateAccessSignals: sample(input.duplicateAccessSignalGroups, limit),
    activeArtifactsOnArchivedEntities: sample(input.activeArtifactsOnArchivedEntities, limit),
  };
  const { counts, countLabels } = resolveIntegrityCounts(
    sampledCounts,
    input.populationCounts || {},
    new Set(input.truncatedChecks),
    limit > 0 ? samples : undefined,
  );
  const failureNames = FAILURE_ORDER.filter((name) => counts[name] > 0);
  const commandEnvironment = input.commandEnvironment || DEFAULT_COMMAND_ENVIRONMENT;
  const warnings = enrichIntegrityWarnings(input.warnings || [], commandEnvironment);
  const warningCommands = warnings
    .map((warning) => warning.nextCommand)
    .filter((command): command is string => Boolean(command));

  return {
    status: failureNames.length > 0 ? 'failure' : 'pass',
    sourceRunId: input.sourceRunId,
    counts,
    countLabels,
    failureNames,
    samples,
    warnings,
    recommendedCommands: [
      ...recommendedCommandsForFailures(failureNames, commandEnvironment),
      ...warningCommands,
    ],
  };
}

function resolveIntegrityCounts(
  sampledCounts: Record<PostMaterializationIntegrityFailureName, number>,
  populationCounts: Partial<Record<PostMaterializationIntegrityFailureName, number>>,
  truncatedChecks: ReadonlySet<PostMaterializationIntegrityFailureName>,
  samples: PostMaterializationIntegritySummary['samples'] | undefined,
): Pick<PostMaterializationIntegritySummary, 'counts' | 'countLabels'> {
  const counts = {} as Record<PostMaterializationIntegrityFailureName, number>;
  const countLabels = {} as Record<PostMaterializationIntegrityFailureName, string>;
  for (const name of FAILURE_ORDER) {
    const population = populationCounts[name];
    const count = population ?? sampledCounts[name];
    const lowerBound = population === undefined && truncatedChecks.has(name);
    const sampled = samples?.[name].length;
    const sampleNote = sampled !== undefined && sampled < count ? ` (sample of ${sampled})` : '';
    counts[name] = count;
    countLabels[name] = `${lowerBound ? `at least ${count}` : String(count)}${sampleNote}`;
  }
  return { counts, countLabels };
}

function recommendedCommandsForFailures(
  failureNames: PostMaterializationIntegrityFailureName[],
  environment: string,
): string[] {
  return [
    ...new Set(
      failureNames.flatMap((failureName) =>
        RECOMMENDED_COMMANDS_BY_FAILURE[failureName].map((command) =>
          environmentCommand(command, environment),
        ),
      ),
    ),
  ];
}

function enrichIntegrityWarnings(
  warnings: PostMaterializationIntegrityWarning[],
  environment: string,
): PostMaterializationIntegrityWarning[] {
  return warnings.map((warning) => {
    const metadata = INTEGRITY_WARNING_OPERATOR_METADATA[warning.name];
    if (!metadata) return warning;
    return {
      ...warning,
      ...metadata,
      ...(metadata.nextCommand
        ? { nextCommand: environmentCommand(metadata.nextCommand, environment) }
        : {}),
    };
  });
}

const PLACEHOLDER_IDENTITY_VALUES = ['', 'na', 'n/a', 'unknown'];

const normalizedIdentityValue = (expression: unknown): Record<string, unknown> => ({
  $trim: { input: { $toLower: { $ifNull: [expression, ''] } } },
});

interface CountedSample<T> {
  sample: T[];
  total: number;
}

async function countAndSample(
  model: mongoose.Model<any, any, any, any>,
  pipeline: mongoose.PipelineStage[],
  sampleStages: mongoose.PipelineStage[],
  limit: number,
): Promise<{ rows: any[]; total: number }> {
  const [total, rows] = await Promise.all([
    countPipeline(model, pipeline),
    model.aggregate([...pipeline, ...sampleStages, { $limit: limit }]),
  ]);
  return { rows, total };
}

const identityCollisionPipeline = (valuePath: string): mongoose.PipelineStage[] => [
  { $match: { archived: { $ne: true } } },
  {
    $project: {
      identityValue: normalizedIdentityValue(`$${valuePath}`),
      personId: { $toString: '$_id' },
    },
  },
  { $match: { identityValue: { $nin: PLACEHOLDER_IDENTITY_VALUES } } },
  { $group: { _id: '$identityValue', personIds: { $push: '$personId' } } },
  { $match: { 'personIds.1': { $exists: true } } },
];

async function loadIdentityCollisionGroups(
  model: mongoose.Model<any, any, any, any>,
  identityField: DuplicatePersonGroup['identityField'],
  valuePath: string,
  limit: number,
): Promise<CountedSample<DuplicatePersonGroup>> {
  const { rows, total } = await countAndSample(
    model,
    identityCollisionPipeline(valuePath),
    [],
    limit,
  );
  return {
    total,
    sample: rows.map((row: any) => ({
      identityField,
      identityValue: stringId(row._id),
      userIds: row.personIds || [],
    })),
  };
}

const researcherNetidCollisionPipeline = (): mongoose.PipelineStage[] => [
  { $match: { archived: { $ne: true } } },
  {
    $lookup: {
      from: 'accounts',
      localField: 'accountId',
      foreignField: '_id',
      as: 'account',
    },
  },
  {
    $project: {
      personId: { $toString: '$_id' },
      identityValues: {
        $setUnion: [
          [normalizedIdentityValue('$identifiers.netid')],
          [normalizedIdentityValue({ $arrayElemAt: ['$account.netid', 0] })],
        ],
      },
    },
  },
  { $unwind: '$identityValues' },
  { $project: { personId: 1, identityValue: '$identityValues' } },
  { $match: { identityValue: { $nin: PLACEHOLDER_IDENTITY_VALUES } } },
  { $group: { _id: '$identityValue', personIds: { $addToSet: '$personId' } } },
  { $match: { 'personIds.1': { $exists: true } } },
];

async function loadResearcherNetidCollisionGroups(
  limit: number,
): Promise<CountedSample<DuplicatePersonGroup>> {
  const { rows, total } = await countAndSample(
    Researcher,
    researcherNetidCollisionPipeline(),
    [],
    limit,
  );
  return {
    total,
    sample: rows.map((row: any) => ({
      identityField: 'netid' as const,
      identityValue: stringId(row._id),
      userIds: row.personIds || [],
    })),
  };
}

async function loadDuplicatePeopleIntegrity(limit: number): Promise<{
  groups: DuplicatePersonGroup[];
  total: number;
  warnings: PostMaterializationIntegrityWarning[];
}> {
  const byField = await Promise.all([
    loadIdentityCollisionGroups(Account, 'email', 'email', limit),
    loadIdentityCollisionGroups(Researcher, 'orcid', 'identifiers.orcid', limit),
    loadResearcherNetidCollisionGroups(limit),
  ]);
  return {
    groups: byField.flatMap((field) => field.sample),
    total: byField.reduce((sum, field) => sum + field.total, 0),
    warnings: [],
  };
}

async function loadSamePiNameDuplicateGroups(): Promise<{
  groups: SamePiNameDuplicateGroup[];
  truncated: boolean;
}> {
  const rows = await RoleAssignment.aggregate([
    {
      $match: {
        role: 'PI',
        state: { $ne: 'HISTORICAL' },
        archived: { $ne: true },
        'target.kind': 'RESEARCH_ENTITY',
        'target.id': { $exists: true, $ne: null },
        personId: { $exists: true, $ne: null },
      },
    },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'target.id',
        foreignField: '_id',
        as: 'entity',
      },
    },
    { $unwind: '$entity' },
    { $match: { 'entity.archived': { $ne: true } } },
    {
      $lookup: {
        from: 'researchers',
        localField: 'personId',
        foreignField: '_id',
        as: 'person',
      },
    },
    { $unwind: { path: '$person', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        personId: { $toString: '$personId' },
        personDisplayName: '$person.displayName',
        entity: {
          id: { $toString: '$entity._id' },
          slug: '$entity.slug',
          name: '$entity.name',
          kind: '$entity.kind',
          entityType: '$entity.entityType',
          websiteUrl: '$entity.websiteUrl',
          sourceUrls: '$entity.sourceUrls',
          departments: '$entity.departments',
          researchAreas: '$entity.researchAreas',
        },
      },
    },
    {
      $group: {
        _id: { personId: '$personId' },
        personDisplayName: { $first: '$personDisplayName' },
        entities: { $addToSet: '$entity' },
      },
    },
    { $match: { 'entities.1': { $exists: true } } },
    { $limit: SAME_PI_ENTITY_SCAN_LIMIT + 1 },
  ]);
  const truncated = rows.length > SAME_PI_ENTITY_SCAN_LIMIT;

  const groups = buildSamePiNameDuplicateGroupsFromDedupeRows(
    rows.slice(0, SAME_PI_ENTITY_SCAN_LIMIT).map((row: any) => {
      const personId = stringId(row._id?.personId);
      const { first, last } = splitName(stringId(row.personDisplayName));
      return {
        userId: personId,
        normalizedName: `same-pi:${personId}`,
        piFirstName: first,
        piLastName: last,
        entities: row.entities || [],
      };
    }),
  );
  return { groups, truncated };
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

const officialLabUrlDuplicatePipeline = (): mongoose.PipelineStage[] => [
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
];

async function loadOfficialLabUrlDuplicateGroups(
  limit: number,
): Promise<CountedSample<OfficialLabUrlDuplicateGroup>> {
  const { rows, total } = await countAndSample(
    ResearchEntity,
    officialLabUrlDuplicatePipeline(),
    [{ $sort: { _id: 1 } }],
    limit,
  );
  return {
    total,
    sample: rows.map((row: any) => ({
      officialLabUrl: stringId(row._id),
      entityIds: (row.entityIds || []).map(stringId),
    })),
  };
}

const duplicateCurrentMemberPipeline = (): mongoose.PipelineStage[] => [
  {
    $match: {
      state: { $ne: 'HISTORICAL' },
      archived: { $ne: true },
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': { $exists: true, $ne: null },
      personId: { $exists: true, $ne: null },
    },
  },
  {
    $group: {
      _id: {
        researchEntityId: '$target.id',
        personId: '$personId',
        role: '$role',
      },
      memberIds: { $push: { $toString: '$_id' } },
    },
  },
  { $match: { 'memberIds.1': { $exists: true } } },
];

async function loadDuplicateCurrentMemberGroups(
  limit: number,
): Promise<CountedSample<DuplicateCurrentMemberGroup>> {
  const { rows, total } = await countAndSample(
    RoleAssignment,
    duplicateCurrentMemberPipeline(),
    [],
    limit,
  );
  return {
    total,
    sample: rows.map((row: any) => ({
      researchEntityId: stringId(row._id?.researchEntityId),
      userId: stringId(row._id?.personId),
      role: LEGACY_ROLE_BY_CANONICAL[row._id?.role as RoleAssignmentRole] ?? row._id?.role,
      memberIds: (row.memberIds || []).map(stringId).filter(Boolean),
    })),
  };
}

const currentMembersOnArchivedEntitiesPipeline = (): mongoose.PipelineStage[] => [
  {
    $match: {
      archived: { $ne: true },
      state: { $ne: 'HISTORICAL' },
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': { $exists: true, $ne: null },
    },
  },
  {
    $lookup: {
      from: 'research_entities',
      localField: 'target.id',
      foreignField: '_id',
      as: 'entity',
    },
  },
  { $unwind: '$entity' },
  { $match: { 'entity.archived': true } },
];

async function countPipeline(
  model: mongoose.Model<any, any, any, any>,
  pipeline: mongoose.PipelineStage[],
): Promise<number> {
  const [row] = await model.aggregate([...pipeline, { $count: 'total' }]);
  return Number(row?.total) || 0;
}

async function loadCurrentMembersOnArchivedEntities(
  limit: number,
): Promise<CurrentMemberOnArchivedEntity[]> {
  const rows = await RoleAssignment.aggregate([
    ...currentMembersOnArchivedEntitiesPipeline(),
    {
      $project: {
        memberId: { $toString: '$_id' },
        researchEntityId: { $toString: '$target.id' },
        personId: { $toString: '$personId' },
        role: '$role',
        canonicalGroupId: { $toString: '$entity.canonicalGroupId' },
      },
    },
    { $limit: limit },
  ]);

  return rows.map((row: any) => ({
    researchEntityId: stringId(row.researchEntityId),
    memberId: stringId(row.memberId),
    userId: stringId(row.personId) || undefined,
    role: LEGACY_ROLE_BY_CANONICAL[row.role as RoleAssignmentRole] ?? row.role,
    canonicalGroupId: stringId(row.canonicalGroupId) || null,
  }));
}

const DUPLICATE_ACCESS_SIGNAL_IDENTITY_FIELDS: DuplicateAccessSignalGroup['identityField'][] = [
  'derivationKey',
  'sourceEvidenceId',
  'observationId',
];

const DUPLICATE_ACCESS_SIGNAL_IDENTITY_PATH: Record<
  DuplicateAccessSignalGroup['identityField'],
  string
> = {
  derivationKey: 'derivationKey',
  sourceEvidenceId: 'source.evidenceIds',
  observationId: 'source.evidenceIds',
};

const duplicateAccessSignalPipeline = (
  field: DuplicateAccessSignalGroup['identityField'],
): mongoose.PipelineStage[] => {
  const path = DUPLICATE_ACCESS_SIGNAL_IDENTITY_PATH[field];
  const identityExpr =
    field === 'derivationKey'
      ? { $toString: `$${path}` }
      : { $toString: { $arrayElemAt: [`$${path}`, 0] } };
  return [
    {
      $match: {
        archived: { $ne: true },
        type: { $in: [...accessSignalTypes] },
        researchEntityId: { $exists: true, $ne: null },
        [path]: { $exists: true, $ne: null },
      },
    },
    {
      $project: {
        researchEntityId: { $toString: '$researchEntityId' },
        signalType: '$type',
        identityValue: identityExpr,
        signalId: { $toString: '$_id' },
      },
    },
    // Null is excluded here rather than by the row builder so the $count agrees with the sample.
    { $match: { identityValue: { $nin: ['', 'null', 'undefined', null] } } },
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
  ];
};

async function loadDuplicateAccessSignalGroups(
  limit: number,
): Promise<CountedSample<DuplicateAccessSignalGroup>> {
  const totals = await Promise.all(
    DUPLICATE_ACCESS_SIGNAL_IDENTITY_FIELDS.map((field) =>
      countPipeline(Signal, duplicateAccessSignalPipeline(field)),
    ),
  );
  const groups: DuplicateAccessSignalGroup[] = [];

  for (const field of DUPLICATE_ACCESS_SIGNAL_IDENTITY_FIELDS) {
    if (groups.length >= limit) break;
    const rows = await Signal.aggregate([
      ...duplicateAccessSignalPipeline(field),
      { $limit: limit - groups.length },
    ]);

    groups.push(
      ...buildDuplicateAccessSignalGroupsFromRows(
        rows.map((row: any) => ({
          researchEntityId: row._id?.researchEntityId,
          signalType: row._id?.signalType,
          identityField: field,
          identityValue: row._id?.identityValue,
          signalIds: row.signalIds || [],
        })),
      ),
    );
  }

  return {
    sample: groups.slice(0, limit),
    total: totals.reduce((sum, total) => sum + total, 0),
  };
}

export function buildDuplicateAccessSignalGroupsFromRows(
  rows: Array<{
    researchEntityId?: unknown;
    signalType?: unknown;
    identityField: DuplicateAccessSignalGroup['identityField'];
    identityValue?: unknown;
    signalIds?: unknown[];
  }>,
): DuplicateAccessSignalGroup[] {
  return rows.flatMap((row) => {
    const researchEntityId = stringId(row.researchEntityId);
    const signalType = stringId(row.signalType);
    const identityValue = stringId(row.identityValue);
    const signalIds = (row.signalIds || []).map(stringId).filter(Boolean);
    if (!researchEntityId || !signalType || !identityValue || signalIds.length < 2) {
      return [];
    }
    return [
      {
        researchEntityId,
        signalType,
        identityField: row.identityField,
        identityValue,
        signalIds,
      },
    ];
  });
}

const activeAccessSignalsOnArchivedEntitiesPipeline = (): mongoose.PipelineStage[] => [
  {
    $match: {
      archived: { $ne: true },
      researchEntityId: { $exists: true, $ne: null },
      type: { $in: [...accessSignalTypes] },
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
];

async function loadActiveArtifactsOnArchivedEntities(
  limit: number,
): Promise<ActiveArtifactOnArchivedEntity[]> {
  const rows = await Signal.aggregate([
    ...activeAccessSignalsOnArchivedEntitiesPipeline(),
    {
      $project: {
        artifactId: { $toString: '$_id' },
        researchEntityId: { $toString: '$researchEntityId' },
        canonicalGroupId: { $toString: '$entity.canonicalGroupId' },
      },
    },
    { $limit: limit },
  ]);

  return rows.map((row: any) => ({
    artifactType: 'AccessSignal' as const,
    artifactId: stringId(row.artifactId),
    researchEntityId: stringId(row.researchEntityId),
    canonicalGroupId: stringId(row.canonicalGroupId) || null,
  }));
}

async function loadArchivedEntityPopulationCounts(): Promise<
  Partial<Record<PostMaterializationIntegrityFailureName, number>>
> {
  const [currentMembersOnArchivedEntities, activeArtifactsOnArchivedEntities] = await Promise.all([
    countPipeline(RoleAssignment, currentMembersOnArchivedEntitiesPipeline()),
    countPipeline(Signal, activeAccessSignalsOnArchivedEntitiesPipeline()),
  ]);
  return { currentMembersOnArchivedEntities, activeArtifactsOnArchivedEntities };
}

async function loadAmbiguousSameNameWarning(): Promise<PostMaterializationIntegrityWarning[]> {
  return [];
}

/**
 * A tombstone whose `canonicalGroupId` chain is malformed: it cycles, or it points at a row
 * that is not there. Either way the row's slug redirects to nothing and no evidence names
 * where it should go.
 *
 * A warning rather than a failure, because clearing the pointer is an operator act: the
 * repair is to CLEAR it rather than to pick a destination, since guessing one from a name is
 * the graft channel #2378 recorded. Clearing keeps the row, so it keeps its slug and its own
 * description, citations and website, which is the material anyone needs to decide later
 * where the slug should point.
 *
 * A chain that simply ends on an archived row is deliberately NOT counted. That is
 * well-formed data whose answer is that the subject has no live home, and a not-found states
 * it truthfully. Counting it would put 40 correct rows in a warning that fires forever, which
 * is noise rather than a signal.
 *
 * This detection used to live only in `research-entity:repair-dead-end-tombstones`, on that
 * script's own sync copy of the production walk, so nothing in the engine could see a
 * malformed pointer and the state was visible only when somebody remembered to run the
 * script (#3704).
 */
export async function loadDeadEndTombstoneChains(
  limit: number,
): Promise<PostMaterializationIntegrityWarning[]> {
  const tombstones = (await ResearchEntity.find({
    archived: true,
    canonicalGroupId: { $ne: null },
  })
    .select('_id archived canonicalGroupId')
    .lean()) as unknown as ResearchEntityTombstoneNode[];
  if (tombstones.length === 0) return [];

  const byId = new Map(tombstones.map((row) => [String(row._id), row]));
  // Every archived row with a pointer is loaded above, so a chain can only leave that set on
  // its final hop. One read of those final targets makes every hop a map lookup, and a target
  // missing from the map is genuinely absent.
  const finalTargetIds = [
    ...new Set(
      tombstones
        .map((row) => String(row.canonicalGroupId))
        .filter((id) => !byId.has(id) && mongoose.Types.ObjectId.isValid(id)),
    ),
  ];
  if (finalTargetIds.length > 0) {
    const targets = (await ResearchEntity.find({
      _id: { $in: finalTargetIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select('_id archived canonicalGroupId')
      .lean()) as unknown as ResearchEntityTombstoneNode[];
    for (const target of targets) byId.set(String(target._id), target);
  }
  const findById = async (id: string) => byId.get(id) ?? null;

  const malformed: Array<{ entityId: string; terminalCause: string }> = [];
  for (const tombstone of tombstones) {
    const chain = await walkResearchEntityTombstoneChainWithCause(tombstone, { findById });
    if (chain.canonical) continue;
    if (!tombstoneTerminalCauseIsMalformed(chain.terminalCause)) continue;
    malformed.push({
      entityId: String(tombstone._id),
      terminalCause: String(chain.terminalCause),
    });
  }
  if (malformed.length === 0) return [];

  const byCause = malformed.reduce<Record<string, number>>((counts, row) => {
    counts[row.terminalCause] = (counts[row.terminalCause] ?? 0) + 1;
    return counts;
  }, {});
  const causeSummary = Object.entries(byCause)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cause, count]) => `${cause}=${count}`)
    .join(', ');

  return [
    {
      name: 'deadEndTombstoneChains',
      count: malformed.length,
      message:
        `${malformed.length} archived row(s) of ${tombstones.length} scanned point at a canonical ` +
        `that cannot be reached (${causeSummary}), so the slug redirects to nothing. Clearing the ` +
        `pointer is an operator act: it keeps the row and its evidence rather than guessing a ` +
        `destination. Sample: ${malformed
          .slice(0, limit)
          .map((row) => row.entityId)
          .join(', ')}`,
    },
  ];
}

function normalizePostMaterializationIntegrityLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_SAMPLE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('--limit must be a safe positive integer');
  }
  return limit;
}

export async function runPostMaterializationIntegrityGate(
  options: RunPostMaterializationIntegrityGateOptions = {},
): Promise<PostMaterializationIntegritySummary> {
  const limit = normalizePostMaterializationIntegrityLimit(options.limit);
  const sampleLimit = options.includeSamples ? limit : 1;
  const [
    samePiNameDuplicates,
    officialLabUrlDuplicates,
    duplicatePersonIntegrity,
    duplicateCurrentMembers,
    currentMembersOnArchivedEntities,
    duplicateAccessSignals,
    activeArtifactsOnArchivedEntities,
    warnings,
    deadEndTombstoneChainWarnings,
    archivedEntityPopulationCounts,
  ] = await Promise.all([
    loadSamePiNameDuplicateGroups(),
    loadOfficialLabUrlDuplicateGroups(sampleLimit),
    loadDuplicatePeopleIntegrity(sampleLimit),
    loadDuplicateCurrentMemberGroups(sampleLimit),
    loadCurrentMembersOnArchivedEntities(sampleLimit),
    loadDuplicateAccessSignalGroups(sampleLimit),
    loadActiveArtifactsOnArchivedEntities(sampleLimit),
    loadAmbiguousSameNameWarning(),
    loadDeadEndTombstoneChains(sampleLimit),
    loadArchivedEntityPopulationCounts(),
  ]);

  return buildPostMaterializationIntegritySummary({
    samePiNameDuplicateGroups: samePiNameDuplicates.groups,
    officialLabUrlDuplicateGroups: officialLabUrlDuplicates.sample,
    duplicatePersonGroups: duplicatePersonIntegrity.groups,
    duplicateCurrentMemberGroups: duplicateCurrentMembers.sample,
    currentMembersOnArchivedEntities,
    duplicateAccessSignalGroups: duplicateAccessSignals.sample,
    activeArtifactsOnArchivedEntities,
    warnings: [...warnings, ...duplicatePersonIntegrity.warnings, ...deadEndTombstoneChainWarnings],
    limit: options.includeSamples ? limit : 0,
    truncatedChecks: samePiNameDuplicates.truncated ? ['samePiSameNameResearchEntities'] : [],
    populationCounts: {
      ...archivedEntityPopulationCounts,
      officialLabUrlResearchEntities: officialLabUrlDuplicates.total,
      duplicatePeople: duplicatePersonIntegrity.total,
      duplicateCurrentMembers: duplicateCurrentMembers.total,
      duplicateAccessSignals: duplicateAccessSignals.total,
    },
    sourceRunId: options.sourceRunId,
    commandEnvironment: options.commandEnvironment,
  });
}

export function isIntegrityGateFailure(
  summary: PostMaterializationIntegritySummary | undefined,
): boolean {
  return summary?.status === 'failure';
}
