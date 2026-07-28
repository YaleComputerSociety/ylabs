import mongoose from 'mongoose';
import { EVIDENCE_CLAIM_SCHEMA_VERSION, EvidenceClaim } from '../models/evidenceClaim';
import {
  evidenceClaimSubjectKinds,
  type EvidenceClaimPredicate,
  type EvidenceClaimSubjectKind,
} from '../models/evidencePredicateRegistry';
import {
  OrgUnit,
  orgUnitSchemaVersion,
  type OrgUnitKind,
  type OrgUnitStatus,
} from '../models/orgUnit';
import {
  Person,
  personSchemaVersion,
  type PersonProfileLink,
  type PersonStatus,
} from '../models/person';
import {
  RESEARCH_PLAN_SCHEMA_VERSION,
  ResearchPlan,
  type ResearchPlanStage,
  type ResearchPlanTargetKind,
} from '../models/researchPlan';
import {
  RoleAssignment,
  roleAssignmentSchemaVersion,
  roleAssignmentTargetKinds,
  type RoleAssignmentReviewStatus,
  type RoleAssignmentRole,
  type RoleAssignmentState,
  type RoleAssignmentTargetKind,
} from '../models/roleAssignment';
import {
  TaxonomyTerm,
  taxonomyTermSchemaVersion,
  type TaxonomyTermKind,
  type TaxonomyTermReviewStatus,
  type TaxonomyTermStatus,
} from '../models/taxonomyTerm';

export const MAX_CANONICAL_LOADER_IDS = 100;
export const MAX_CANONICAL_LOADER_RESULTS = 100;

export const CANONICAL_PERSON_READ_FIELDS =
  '_id schemaVersion displayName profileLinks status archived';
export const CANONICAL_ROLE_READ_FIELDS =
  '_id schemaVersion personId target role state reviewStatus archived';
export const CANONICAL_ORG_UNIT_READ_FIELDS =
  '_id schemaVersion slug name kind aliases parentOrgUnitId status archived';
export const CANONICAL_TAXONOMY_READ_FIELDS =
  '_id schemaVersion kind label aliases parentTermId reviewStatus status archived';
export const CANONICAL_PUBLIC_EVIDENCE_READ_FIELDS =
  '_id schemaVersion subject predicate observedAt confidence sensitivity status';
export const CANONICAL_RESEARCH_PLAN_READ_FIELDS =
  '_id schemaVersion accountId target stage exportPreferences archived createdAt updatedAt';

type CanonicalObjectIdInput = string | mongoose.Types.ObjectId;
type CanonicalRecord = Record<string, unknown>;

export interface CanonicalPublicPersonRecord extends CanonicalRecord {
  _id: mongoose.Types.ObjectId;
  schemaVersion: number;
  displayName: string;
  profileLinks: PersonProfileLink[];
  status: PersonStatus;
  archived: false;
}

export interface CanonicalCurrentRoleRecord extends CanonicalRecord {
  _id: mongoose.Types.ObjectId;
  schemaVersion: number;
  personId: mongoose.Types.ObjectId;
  target: {
    kind: RoleAssignmentTargetKind;
    id: mongoose.Types.ObjectId;
  };
  role: RoleAssignmentRole;
  state: RoleAssignmentState;
  reviewStatus: RoleAssignmentReviewStatus;
  archived: false;
}

export interface CanonicalOrgUnitReadRecord extends CanonicalRecord {
  _id: mongoose.Types.ObjectId;
  schemaVersion: number;
  slug: string;
  name: string;
  kind: OrgUnitKind;
  aliases: string[];
  parentOrgUnitId?: mongoose.Types.ObjectId;
  status: OrgUnitStatus;
  archived: false;
}

export interface CanonicalTaxonomyReadRecord extends CanonicalRecord {
  _id: mongoose.Types.ObjectId;
  schemaVersion: number;
  kind: TaxonomyTermKind;
  label: string;
  aliases: string[];
  parentTermId?: mongoose.Types.ObjectId;
  reviewStatus: TaxonomyTermReviewStatus;
  status: TaxonomyTermStatus;
  archived: false;
}

export interface CanonicalPublicEvidenceRecord extends CanonicalRecord {
  _id: mongoose.Types.ObjectId;
  schemaVersion: number;
  subject: {
    kind: EvidenceClaimSubjectKind;
    id: mongoose.Types.ObjectId;
  };
  predicate: EvidenceClaimPredicate;
  observedAt: Date;
  confidence: number;
  sensitivity: 'PUBLIC';
  status: 'ACTIVE';
}

export interface CanonicalResearchPlanReadRecord extends CanonicalRecord {
  _id: mongoose.Types.ObjectId;
  schemaVersion: number;
  accountId: mongoose.Types.ObjectId;
  target: {
    kind: ResearchPlanTargetKind;
    id: mongoose.Types.ObjectId;
  };
  stage: ResearchPlanStage;
  exportPreferences: {
    includePrivateNotes: boolean;
    includeChecklist: boolean;
    includeDeadlines: boolean;
  };
  archived: false;
  privateNotes?: string;
  checklist?: unknown[];
  deadlines?: unknown[];
  createdAt: Date;
  updatedAt: Date;
}

interface CanonicalQuery {
  select(fields: string): CanonicalQuery;
  sort(sort: Record<string, 1 | -1>): CanonicalQuery;
  limit(limit: number): CanonicalQuery;
  lean(): CanonicalQuery;
  exec(): Promise<CanonicalRecord[]>;
}

export interface CanonicalReadModel {
  find(filter: Record<string, unknown>): CanonicalQuery;
}

export interface CanonicalReadModels {
  EvidenceClaim: CanonicalReadModel;
  OrgUnit: CanonicalReadModel;
  Person: CanonicalReadModel;
  ResearchPlan: CanonicalReadModel;
  RoleAssignment: CanonicalReadModel;
  TaxonomyTerm: CanonicalReadModel;
}

export interface CanonicalRoleTargetInput {
  kind: RoleAssignmentTargetKind;
  id: CanonicalObjectIdInput;
}

export interface CanonicalEvidenceSubjectInput {
  kind: EvidenceClaimSubjectKind;
  id: CanonicalObjectIdInput;
}

export interface OwnedResearchPlanLoadInput {
  requesterAccountId: CanonicalObjectIdInput;
  ownerAccountId: CanonicalObjectIdInput;
  target?: {
    kind: ResearchPlanTargetKind;
    ids?: CanonicalObjectIdInput[];
  };
  includePrivateFields?: boolean;
  limit?: number;
}

export class CanonicalReadAuthorizationError extends Error {
  constructor(message = 'The canonical read is outside the requester boundary.') {
    super(message);
    this.name = 'CanonicalReadAuthorizationError';
  }
}

const DEFAULT_MODELS: CanonicalReadModels = {
  EvidenceClaim: EvidenceClaim as unknown as CanonicalReadModel,
  OrgUnit: OrgUnit as unknown as CanonicalReadModel,
  Person: Person as unknown as CanonicalReadModel,
  ResearchPlan: ResearchPlan as unknown as CanonicalReadModel,
  RoleAssignment: RoleAssignment as unknown as CanonicalReadModel,
  TaxonomyTerm: TaxonomyTerm as unknown as CanonicalReadModel,
};

function canonicalObjectId(value: unknown, label: string): mongoose.Types.ObjectId {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (mongoose.isObjectIdOrHexString(trimmed)) {
      return new mongoose.Types.ObjectId(trimmed);
    }
  }
  throw new TypeError(`${label} must be a valid ObjectId.`);
}

function boundedObjectIds(
  values: readonly CanonicalObjectIdInput[],
  label: string,
): mongoose.Types.ObjectId[] {
  if (!Array.isArray(values)) {
    throw new TypeError(`${label} must be an array.`);
  }
  if (values.length > MAX_CANONICAL_LOADER_IDS) {
    throw new RangeError(`${label} must contain at most ${MAX_CANONICAL_LOADER_IDS} identifiers.`);
  }

  const ids = new Map<string, mongoose.Types.ObjectId>();
  for (const value of values) {
    const id = canonicalObjectId(value, label);
    ids.set(id.toHexString(), id);
  }
  return [...ids.values()];
}

function boundedLimit(value: unknown): number {
  if (value === undefined) return MAX_CANONICAL_LOADER_RESULTS;
  if (
    !Number.isInteger(value) ||
    Number(value) < 1 ||
    Number(value) > MAX_CANONICAL_LOADER_RESULTS
  ) {
    throw new RangeError(`limit must be an integer from 1 to ${MAX_CANONICAL_LOADER_RESULTS}.`);
  }
  return Number(value);
}

async function findRecords<T extends CanonicalRecord>({
  model,
  filter,
  fields,
  sort = { _id: 1 },
  limit = MAX_CANONICAL_LOADER_RESULTS,
}: {
  model: CanonicalReadModel;
  filter: Record<string, unknown>;
  fields: string;
  sort?: Record<string, 1 | -1>;
  limit?: number;
}): Promise<T[]> {
  return model.find(filter).select(fields).sort(sort).limit(limit).lean().exec() as Promise<T[]>;
}

function assertRoleTargets(
  values: readonly CanonicalRoleTargetInput[],
): Array<{ kind: RoleAssignmentTargetKind; id: mongoose.Types.ObjectId }> {
  if (!Array.isArray(values)) throw new TypeError('role targets must be an array.');
  if (values.length > MAX_CANONICAL_LOADER_IDS) {
    throw new RangeError(
      `role targets must contain at most ${MAX_CANONICAL_LOADER_IDS} identifiers.`,
    );
  }

  const targets = new Map<
    string,
    { kind: RoleAssignmentTargetKind; id: mongoose.Types.ObjectId }
  >();
  for (const value of values) {
    if (!value || !roleAssignmentTargetKinds.includes(value.kind)) {
      throw new TypeError('role target kind is invalid.');
    }
    const id = canonicalObjectId(value.id, 'role target id');
    targets.set(`${value.kind}:${id.toHexString()}`, { kind: value.kind, id });
  }
  return [...targets.values()];
}

function assertEvidenceSubjects(
  values: readonly CanonicalEvidenceSubjectInput[],
): Array<{ kind: EvidenceClaimSubjectKind; id: mongoose.Types.ObjectId }> {
  if (!Array.isArray(values)) throw new TypeError('evidence subjects must be an array.');
  if (values.length > MAX_CANONICAL_LOADER_IDS) {
    throw new RangeError(
      `evidence subjects must contain at most ${MAX_CANONICAL_LOADER_IDS} identifiers.`,
    );
  }

  const subjects = new Map<
    string,
    { kind: EvidenceClaimSubjectKind; id: mongoose.Types.ObjectId }
  >();
  for (const value of values) {
    if (!value || !evidenceClaimSubjectKinds.includes(value.kind)) {
      throw new TypeError('evidence subject kind is invalid.');
    }
    const id = canonicalObjectId(value.id, 'evidence subject id');
    subjects.set(`${value.kind}:${id.toHexString()}`, { kind: value.kind, id });
  }
  return [...subjects.values()];
}

/**
 * Creates bounded, read-only canonical loaders.
 *
 * The default models use MongoDB, while dependency injection keeps the query and
 * authorization contracts directly testable.
 */
export function createCanonicalDomainLoaders(models: CanonicalReadModels = DEFAULT_MODELS) {
  return {
    async loadPublicPeopleByIds(
      values: readonly CanonicalObjectIdInput[],
    ): Promise<CanonicalPublicPersonRecord[]> {
      const ids = boundedObjectIds(values, 'person ids');
      if (ids.length === 0) return [];
      return findRecords({
        model: models.Person,
        filter: {
          _id: { $in: ids },
          schemaVersion: { $in: personSchemaVersion.supportedVersions },
          archived: false,
          status: { $in: ['ACTIVE', 'UNKNOWN'] },
        },
        fields: CANONICAL_PERSON_READ_FIELDS,
        limit: ids.length,
      });
    },

    async loadCurrentApprovedRolesForTargets(
      values: readonly CanonicalRoleTargetInput[],
    ): Promise<CanonicalCurrentRoleRecord[]> {
      const targets = assertRoleTargets(values);
      if (targets.length === 0) return [];
      return findRecords({
        model: models.RoleAssignment,
        filter: {
          $or: targets.map((target) => ({
            'target.kind': target.kind,
            'target.id': target.id,
          })),
          schemaVersion: { $in: roleAssignmentSchemaVersion.supportedVersions },
          state: 'CURRENT',
          reviewStatus: 'APPROVED',
          archived: false,
          endedAt: { $exists: false },
        },
        fields: CANONICAL_ROLE_READ_FIELDS,
      });
    },

    async loadActiveOrgUnitsByIds(
      values: readonly CanonicalObjectIdInput[],
    ): Promise<CanonicalOrgUnitReadRecord[]> {
      const ids = boundedObjectIds(values, 'organization ids');
      if (ids.length === 0) return [];
      return findRecords({
        model: models.OrgUnit,
        filter: {
          _id: { $in: ids },
          schemaVersion: { $in: orgUnitSchemaVersion.supportedVersions },
          status: 'ACTIVE',
          archived: false,
        },
        fields: CANONICAL_ORG_UNIT_READ_FIELDS,
        limit: ids.length,
      });
    },

    async loadApprovedTaxonomyTermsByIds(
      values: readonly CanonicalObjectIdInput[],
    ): Promise<CanonicalTaxonomyReadRecord[]> {
      const ids = boundedObjectIds(values, 'taxonomy term ids');
      if (ids.length === 0) return [];
      return findRecords({
        model: models.TaxonomyTerm,
        filter: {
          _id: { $in: ids },
          schemaVersion: { $in: taxonomyTermSchemaVersion.supportedVersions },
          reviewStatus: 'APPROVED',
          status: 'ACTIVE',
          archived: false,
        },
        fields: CANONICAL_TAXONOMY_READ_FIELDS,
        limit: ids.length,
      });
    },

    async loadPublicEvidenceForSubjects(
      values: readonly CanonicalEvidenceSubjectInput[],
    ): Promise<CanonicalPublicEvidenceRecord[]> {
      const subjects = assertEvidenceSubjects(values);
      if (subjects.length === 0) return [];
      return findRecords({
        model: models.EvidenceClaim,
        filter: {
          $or: subjects.map((subject) => ({
            'subject.kind': subject.kind,
            'subject.id': subject.id,
          })),
          schemaVersion: { $in: EVIDENCE_CLAIM_SCHEMA_VERSION.supportedVersions },
          sensitivity: 'PUBLIC',
          status: 'ACTIVE',
          observedAt: { $lte: new Date() },
        },
        fields: CANONICAL_PUBLIC_EVIDENCE_READ_FIELDS,
        sort: { observedAt: -1, _id: 1 },
      });
    },

    async loadOwnedResearchPlans(
      input: OwnedResearchPlanLoadInput,
    ): Promise<CanonicalResearchPlanReadRecord[]> {
      const requesterAccountId = canonicalObjectId(
        input.requesterAccountId,
        'requester account id',
      );
      const ownerAccountId = canonicalObjectId(input.ownerAccountId, 'owner account id');
      if (!requesterAccountId.equals(ownerAccountId)) {
        throw new CanonicalReadAuthorizationError();
      }

      const filter: Record<string, unknown> = {
        accountId: ownerAccountId,
        schemaVersion: { $in: RESEARCH_PLAN_SCHEMA_VERSION.supportedVersions },
        archived: false,
      };
      if (input.target) {
        if (!['RESEARCH_ENTITY', 'PROGRAM'].includes(input.target.kind)) {
          throw new TypeError('research plan target kind is invalid.');
        }
        filter['target.kind'] = input.target.kind;
        if (input.target.ids !== undefined) {
          const ids = boundedObjectIds(input.target.ids, 'research plan target ids');
          if (ids.length === 0) return [];
          filter['target.id'] = { $in: ids };
        }
      }

      const privateFields = input.includePrivateFields
        ? ' +privateNotes +checklist +deadlines'
        : '';
      return findRecords({
        model: models.ResearchPlan,
        filter,
        fields: `${CANONICAL_RESEARCH_PLAN_READ_FIELDS}${privateFields}`,
        sort: { updatedAt: -1, _id: 1 },
        limit: boundedLimit(input.limit),
      });
    },
  };
}

export type CanonicalDomainLoaders = ReturnType<typeof createCanonicalDomainLoaders>;
