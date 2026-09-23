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

export interface RoleAssignmentRosterProvenance {
  sourceName?: string;
  sourceUrl?: string;
  profileUrl?: string;
  sectionLabel?: string;
  evidenceStatus?: string;
  membershipKey?: string;
  observedAt?: Date;
  freshnessExpiresAt?: Date;
}

export interface RoleAssignmentRecord {
  schemaVersion: number;
  personId: mongoose.Types.ObjectId;
  target: RoleAssignmentTarget;
  role: RoleAssignmentRole;
  state: RoleAssignmentState;
  startedAt?: Date;
  endedAt?: Date;
  confidence: number;
  reviewStatus: RoleAssignmentReviewStatus;
  reviewNotes?: string;
  rosterProvenance?: RoleAssignmentRosterProvenance;
  archived: boolean;
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
      ref: 'Researcher',
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
    // Why an edge reached its reviewStatus. Two retirement lanes already set this
    // field, and without it in the schema mongoose dropped the value silently, so
    // every edge either of them archived carries a verdict and no reason (#2880).
    reviewNotes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    rosterProvenance: {
      type: new mongoose.Schema<RoleAssignmentRosterProvenance>(
        {
          sourceName: { type: String, trim: true, maxlength: 240 },
          sourceUrl: { type: String, trim: true, maxlength: 2048 },
          profileUrl: { type: String, trim: true, maxlength: 2048 },
          sectionLabel: { type: String, trim: true, maxlength: 240 },
          evidenceStatus: { type: String, trim: true, maxlength: 240 },
          membershipKey: { type: String, trim: true, maxlength: 512 },
          observedAt: { type: Date },
          freshnessExpiresAt: { type: Date },
        },
        { _id: false },
      ),
      required: false,
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

/**
 * The verdict a retirement repair writes on an edge it detached. It is the one
 * signal that outranks a source: a scrape may re-observe the underlying listing
 * forever without re-attaching the edge, and only a human clearing the dispute
 * lets it back.
 */
export const DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS: RoleAssignmentReviewStatus = 'DISPUTED';

/**
 * The guarded second write that re-attaches an edge a source still asserts.
 *
 * Every writer keys its upsert on `(personId, target, role)` and none of them can
 * exclude a detached row from that filter, because `role_assignments` carries no
 * unique index on those fields and a filter that skipped the detached row would
 * insert a second, un-detached edge for the same person. So `archived` and
 * `reviewStatus` leave the upsert's `$set` entirely and move here, behind a
 * `reviewStatus` guard.
 *
 * Without this, a `$set` of `archived: false` reached the rows a repair had just
 * archived: measured on Development, 133 of 391 retired edges were back to
 * `archived: false` and `UNREVIEWED` with the repair's own `reviewNotes` still
 * attached, across #2880, #1897 and #2768 (#3143). Any new role-assignment writer
 * must route its `archived`/`reviewStatus` write through here.
 */
export function roleAssignmentReattachWrite(
  upsertFilter: Record<string, unknown>,
  reviewStatus: RoleAssignmentReviewStatus,
): { filter: Record<string, unknown>; update: Record<string, unknown> } {
  return {
    filter: { ...upsertFilter, reviewStatus: { $ne: DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS } },
    update: { $set: { archived: false, reviewStatus } },
  };
}

export const RoleAssignment =
  mongoose.models.RoleAssignment ||
  mongoose.model<RoleAssignmentRecord>('RoleAssignment', roleAssignmentSchema, 'role_assignments');
