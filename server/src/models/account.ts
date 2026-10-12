import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';
import { looksLikeYaleNetid } from '../utils/yaleNetid';

export const accountSchemaVersion = defineCanonicalSchemaVersion({ currentVersion: 1 });

export const accountStatuses = ['ACTIVE', 'DISABLED', 'UNKNOWN'] as const;
export type AccountStatus = (typeof accountStatuses)[number];

export const accountArchivedReasons = [
  'merged-local-part-netid-twin',
  'lone-local-part-netid-account',
] as const;
export type AccountArchivedReason = (typeof accountArchivedReasons)[number];

export interface AccountProfile {
  firstName?: string;
  lastName?: string;
  userType?: string;
  title?: string;
  department?: string;
}

export interface AccountRecord {
  schemaVersion: number;
  netid: string;
  email: string;
  status: AccountStatus;
  lastLoginAt?: Date;
  profile?: AccountProfile;
  archived: boolean;
  archivedReason?: AccountArchivedReason;
  archivedAt?: Date;
  mergedIntoAccountId?: mongoose.Types.ObjectId;
  sessionVersion?: number;
}

export const accountProfileSchema = new mongoose.Schema<AccountProfile>(
  {
    firstName: { type: String, trim: true, maxlength: 120 },
    lastName: { type: String, trim: true, maxlength: 120 },
    userType: { type: String, trim: true, maxlength: 40 },
    title: { type: String, trim: true, maxlength: 240 },
    department: { type: String, trim: true, maxlength: 240 },
  },
  {
    _id: false,
  },
);

export const accountSchema = new mongoose.Schema<AccountRecord>(
  {
    schemaVersion: canonicalSchemaVersionField(accountSchemaVersion),
    netid: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 2,
      maxlength: 64,
      match: /^[a-z0-9][a-z0-9._-]*$/,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    status: {
      type: String,
      enum: [...accountStatuses],
      default: 'ACTIVE',
    },
    lastLoginAt: {
      type: Date,
      required: false,
    },
    profile: {
      type: accountProfileSchema,
      default: undefined,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    archivedReason: {
      type: String,
      enum: [...accountArchivedReasons],
      required: false,
    },
    archivedAt: {
      type: Date,
      required: false,
    },
    mergedIntoAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: false,
    },
    sessionVersion: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * The schema `match` above still admits a dotted netid, because 170 Development accounts
 * hold one and a collection validator derived from a tighter pattern would refuse every
 * later update to them. Minting is the defect, so minting is what is refused: on
 * 2026-08-27 an upsert without `runValidators` stored an email local part as a netid
 * 170 times, and no validator ran (#4773). A hook runs on every Mongoose write path
 * whatever its options. Raw-driver copies (promotion, sync) intentionally bypass it.
 */
export class UnmintableAccountNetidError extends Error {
  constructor() {
    super('An account netid must be a Yale netid, not an email local part or other key.');
    this.name = 'UnmintableAccountNetidError';
  }
}

function assertMintableNetid(value: unknown): void {
  if (value === undefined) return;
  if (!looksLikeYaleNetid(value)) throw new UnmintableAccountNetidError();
}

type UpdateDocument = Record<string, unknown> & {
  $set?: Record<string, unknown>;
  $setOnInsert?: Record<string, unknown>;
};

function netidsAnUpdateWouldStore(
  filter: Record<string, unknown>,
  update: UpdateDocument | null | undefined,
  upsert: boolean,
): unknown[] {
  const written: unknown[] = [];
  if (update) {
    if ('netid' in update) written.push(update.netid);
    if (update.$set && 'netid' in update.$set) written.push(update.$set.netid);
    if (upsert && update.$setOnInsert && 'netid' in update.$setOnInsert) {
      written.push(update.$setOnInsert.netid);
    }
  }
  const filterNetid = filter?.netid;
  if (upsert && typeof filterNetid === 'string') written.push(filterNetid);
  return written;
}

accountSchema.pre('save', function () {
  if (this.isNew || this.isModified('netid')) assertMintableNetid(this.get('netid'));
});

accountSchema.pre('insertMany', function (docs: unknown) {
  for (const doc of Array.isArray(docs) ? docs : [docs]) {
    assertMintableNetid((doc as { netid?: unknown } | null)?.netid);
  }
});

accountSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'],
  function (this: mongoose.Query<unknown, unknown>) {
    const upsert = this.getOptions().upsert === true;
    const filter = this.getFilter() as Record<string, unknown>;
    for (const netid of netidsAnUpdateWouldStore(
      filter,
      this.getUpdate() as UpdateDocument | null,
      upsert,
    )) {
      assertMintableNetid(netid);
    }
  },
);

accountSchema.index({ email: 1 });
accountSchema.index({ status: 1, archived: 1 });

export const Account =
  mongoose.models.Account || mongoose.model<AccountRecord>('Account', accountSchema, 'accounts');
