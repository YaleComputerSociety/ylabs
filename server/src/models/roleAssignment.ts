import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';

export const roleAssignmentSchemaVersion = defineCanonicalSchemaVersion({ currentVersion: 1 });

export const roleAssignmentTargetKinds = ['RESEARCH_ENTITY', 'ORG_UNIT'] as const;
export type RoleAssignmentTargetKind = (typeof roleAssignmentTargetKinds)[number];

export const roleAssignmentRoles = [
  'PI',
  'CO_PI',
  'DIRECTOR',
  'CO_DIRECTOR',
  'CORE_FACULTY',
  'AFFILIATED',
  'STAFF',
  'POSTDOC',
  'GRADUATE_STUDENT',
  'UNDERGRADUATE',
] as const;
export type RoleAssignmentRole = (typeof roleAssignmentRoles)[number];

export const roleAssignmentStates = ['CURRENT', 'HISTORICAL', 'UNKNOWN'] as const;
export type RoleAssignmentState = (typeof roleAssignmentStates)[number];

export const roleAssignmentReviewStatuses = ['UNREVIEWED', 'APPROVED', 'DISPUTED'] as const;
export type RoleAssignmentReviewStatus = (typeof roleAssignmentReviewStatuses)[number];

export interface RoleAssignmentTarget {
  kind: RoleAssignmentTargetKind;
  id: mongoose.Types.ObjectId;
}

export interface RoleAssignmentRecord {
  schemaVersion: number;
  personId: mongoose.Types.ObjectId;
  target: RoleAssignmentTarget;
  role: RoleAssignmentRole;
  state: RoleAssignmentState;
  startedAt?: Date;
  endedAt?: Date;
  evidenceClaimIds: mongoose.Types.ObjectId[];
  confidence: number;
  reviewStatus: RoleAssignmentReviewStatus;
  archived: boolean;
}

const MAX_EVIDENCE_CLAIMS_PER_ROLE = 100;

function hasBoundedUniqueObjectIds(values: readonly mongoose.Types.ObjectId[]): boolean {
  return (
    values.length <= MAX_EVIDENCE_CLAIMS_PER_ROLE &&
    new Set(values.map((value) => value.toString())).size === values.length
  );
}

export const roleAssignmentTargetSchema = new mongoose.Schema<RoleAssignmentTarget>(
  {
    kind: {
      type: String,
      enum: [...roleAssignmentTargetKinds],
      required: true,
    },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
  },
  {
    _id: false,
  },
);

export const roleAssignmentSchema = new mongoose.Schema<RoleAssignmentRecord>(
  {
    schemaVersion: canonicalSchemaVersionField(roleAssignmentSchemaVersion),
    personId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Person',
      required: true,
    },
    target: {
      type: roleAssignmentTargetSchema,
      required: true,
    },
    role: {
      type: String,
      enum: [...roleAssignmentRoles],
      required: true,
    },
    state: {
      type: String,
      enum: [...roleAssignmentStates],
      default: 'UNKNOWN',
      validate: {
        validator: function (this: { endedAt?: Date }, value: RoleAssignmentState) {
          return value !== 'HISTORICAL' || this.endedAt !== undefined;
        },
        message: 'HISTORICAL role assignments require endedAt.',
      },
    },
    startedAt: {
      type: Date,
      required: false,
    },
    endedAt: {
      type: Date,
      required: false,
      validate: {
        validator: function (
          this: { startedAt?: Date; state?: RoleAssignmentState },
          value?: Date,
        ) {
          if (this.state === 'CURRENT' && value !== undefined) return false;
          return value === undefined || this.startedAt === undefined || value >= this.startedAt;
        },
        message: 'endedAt must follow startedAt and cannot be set on a CURRENT role assignment.',
      },
    },
    evidenceClaimIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'EvidenceClaim',
        },
      ],
      default: [],
      validate: {
        validator: hasBoundedUniqueObjectIds,
        message: `evidenceClaimIds must contain at most ${MAX_EVIDENCE_CLAIMS_PER_ROLE} unique ids.`,
      },
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    reviewStatus: {
      type: String,
      enum: [...roleAssignmentReviewStatuses],
      default: 'UNREVIEWED',
    },
    archived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

roleAssignmentSchema.index({ personId: 1, state: 1, archived: 1 });
roleAssignmentSchema.index({
  'target.kind': 1,
  'target.id': 1,
  state: 1,
  archived: 1,
});

export const RoleAssignment =
  mongoose.models.RoleAssignment ||
  mongoose.model<RoleAssignmentRecord>('RoleAssignment', roleAssignmentSchema, 'role_assignments');
