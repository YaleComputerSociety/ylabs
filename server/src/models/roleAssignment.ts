import mongoose from 'mongoose';
import '../db/devWriteGuard';
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

export const rosterIdentityBases = ['profile-url', 'identity-evidence'] as const;
export type RosterIdentityBasis = (typeof rosterIdentityBases)[number];

export const isRosterIdentityBasis = (value: unknown): value is RosterIdentityBasis =>
  typeof value === 'string' && (rosterIdentityBases as readonly string[]).includes(value);

export interface RoleAssignmentRosterProvenance {
  sourceName?: string;
  sourceUrl?: string;
  profileUrl?: string;
  sectionLabel?: string;
  listingTitle?: string;
  evidenceStatus?: string;
  membershipKey?: string;
  observedAt?: Date;
  freshnessExpiresAt?: Date;
  adoptedAt?: Date;
  identityBasis?: RosterIdentityBasis;
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
  reviewedBy?: string;
  reviewedByAgent?: boolean;
  reviewedAt?: Date;
  rosterProvenance?: RoleAssignmentRosterProvenance;
  operatorEnd?: RoleAssignmentOperatorEnd;
  archived: boolean;
}

export interface RoleAssignmentOperatorEnd {
  endedAt: Date;
  reason: string;
  citationUrl: string;
  decidedBy: 'owner' | 'agent';
  recordedBy?: string;
  recordedAt: Date;
  previousState: RoleAssignmentState;
  previousEndedAt?: Date;
  firstObservedAt?: Date;
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
    // When a lane first saw the edge, never a start the source states: every writer sets it
    // from its first observation or write time (#5979). A lane that parses stated start years
    // must add a basis field before writing one here.
    startedAt: {
      type: Date,
      required: false,
    },
    endedAt: {
      type: Date,
      required: false,
      validate: {
        validator: function (this: unknown, value?: Date) {
          const { startedAt, state } = this as { startedAt?: Date; state?: RoleAssignmentState };
          if (state === 'CURRENT' && value !== undefined) return false;
          return value === undefined || startedAt === undefined || value >= startedAt;
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
    reviewedBy: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    reviewedByAgent: {
      type: Boolean,
      required: false,
    },
    reviewedAt: {
      type: Date,
      required: false,
    },
    operatorEnd: {
      type: new mongoose.Schema<RoleAssignmentOperatorEnd>(
        {
          endedAt: { type: Date, required: true },
          reason: { type: String, trim: true, required: true, maxlength: 500 },
          citationUrl: { type: String, trim: true, required: true, maxlength: 2048 },
          decidedBy: { type: String, enum: ['owner', 'agent'], required: true },
          recordedBy: { type: String, trim: true, maxlength: 120 },
          recordedAt: { type: Date, required: true },
          previousState: { type: String, enum: [...roleAssignmentStates], required: true },
          previousEndedAt: { type: Date },
          firstObservedAt: { type: Date },
        },
        { _id: false },
      ),
      required: false,
      default: undefined,
    },
    rosterProvenance: {
      type: new mongoose.Schema<RoleAssignmentRosterProvenance>(
        {
          sourceName: { type: String, trim: true, maxlength: 240 },
          sourceUrl: { type: String, trim: true, maxlength: 2048 },
          profileUrl: { type: String, trim: true, maxlength: 2048 },
          sectionLabel: { type: String, trim: true, maxlength: 240 },
          listingTitle: { type: String, trim: true, maxlength: 240 },
          evidenceStatus: { type: String, trim: true, maxlength: 240 },
          membershipKey: { type: String, trim: true, maxlength: 512 },
          observedAt: { type: Date },
          freshnessExpiresAt: { type: Date },
          adoptedAt: { type: Date },
          identityBasis: { type: String, enum: rosterIdentityBases },
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

/**
 * An operator ended this exact `(personId, target, role)` edge after reading the pages: the
 * person really held the role and no longer does. A lane re-reading a page that still lists
 * them must not revive it or mint a twin beside it, so every evidence writer refuses the
 * triple while the record stands, and only `role-assignments:restore-detached-edge` clears it.
 */
export async function operatorEndedEdgeBlocksWrite(
  upsertFilter: Record<string, unknown>,
): Promise<boolean> {
  return Boolean(
    await RoleAssignment.exists({ ...upsertFilter, 'operatorEnd.endedAt': { $exists: true } }),
  );
}

export type ProtectedRoleEdge = 'operator-ended' | 'disputed';

/**
 * The refusal an existing `(personId, target, role)` edge records, if any, that a write must not
 * touch. An operator-ended edge refuses always. A `DISPUTED` detachment refuses when no live edge
 * matches, because the unpinned upsert would land on the detached edge and overwrite its state,
 * provenance and `endedAt` while the reattach guard keeps it archived (#5979).
 */
export async function protectedRoleEdgeFor(
  upsertFilter: Record<string, unknown>,
): Promise<ProtectedRoleEdge | null> {
  if (await operatorEndedEdgeBlocksWrite(upsertFilter)) return 'operator-ended';
  const disputed = await RoleAssignment.exists({
    ...upsertFilter,
    archived: true,
    reviewStatus: DETACHED_ROLE_ASSIGNMENT_REVIEW_STATUS,
  });
  if (!disputed) return null;
  const live = await RoleAssignment.exists({
    ...upsertFilter,
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  });
  return live ? null : 'disputed';
}

export const RoleAssignment =
  mongoose.models.RoleAssignment ||
  mongoose.model<RoleAssignmentRecord>('RoleAssignment', roleAssignmentSchema, 'role_assignments');

// The `(personId, target, role)` upsert filter matches retired edges too, and the target
// index orders `HISTORICAL` ahead of `UNKNOWN`, so an unpinned write revives a retired twin
// beside the live edge and mints a second live edge for the same person and role (#4791).
export async function pinRoleAssignmentUpsertToLiveEdge(
  upsertFilter: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const live = (await RoleAssignment.findOne({
    ...upsertFilter,
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .sort({ _id: 1 })
    .select('_id')
    .lean()) as { _id?: mongoose.Types.ObjectId } | null;
  return live?._id ? { ...upsertFilter, _id: live._id } : upsertFilter;
}
