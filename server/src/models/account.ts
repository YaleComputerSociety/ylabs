import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';

export const accountSchemaVersion = defineCanonicalSchemaVersion({ currentVersion: 1 });

export const accountStatuses = ['ACTIVE', 'DISABLED', 'UNKNOWN'] as const;
export type AccountStatus = (typeof accountStatuses)[number];

export interface AccountProfile {
  firstName?: string;
  lastName?: string;
  userType?: string;
  title?: string;
  department?: string;
  college?: string;
  year?: string;
  major?: string[];
}

export interface AccountRecord {
  schemaVersion: number;
  netid: string;
  email: string;
  status: AccountStatus;
  lastLoginAt?: Date;
  profile?: AccountProfile;
  archived: boolean;
}

export const accountProfileSchema = new mongoose.Schema<AccountProfile>(
  {
    firstName: { type: String, trim: true, maxlength: 120 },
    lastName: { type: String, trim: true, maxlength: 120 },
    userType: { type: String, trim: true, maxlength: 40 },
    title: { type: String, trim: true, maxlength: 240 },
    department: { type: String, trim: true, maxlength: 240 },
    college: { type: String, trim: true, maxlength: 120 },
    year: { type: String, trim: true, maxlength: 12 },
    major: { type: [String], default: undefined },
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
  },
  {
    timestamps: true,
  },
);

accountSchema.index({ email: 1 });
accountSchema.index({ status: 1, archived: 1 });

export const Account =
  mongoose.models.Account || mongoose.model<AccountRecord>('Account', accountSchema, 'accounts');
