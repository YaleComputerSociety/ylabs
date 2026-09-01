import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';

export const orgUnitSchemaVersion = defineCanonicalSchemaVersion({ currentVersion: 1 });

export const orgUnitKinds = ['SCHOOL', 'DEPARTMENT', 'DIVISION', 'OFFICE'] as const;
export type OrgUnitKind = (typeof orgUnitKinds)[number];

export const orgUnitStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN'] as const;
export type OrgUnitStatus = (typeof orgUnitStatuses)[number];

export interface OrgUnitRecord {
  schemaVersion: number;
  slug: string;
  name: string;
  kind: OrgUnitKind;
  aliases: string[];
  parentOrgUnitId?: mongoose.Types.ObjectId;
  status: OrgUnitStatus;
  archived: boolean;
}

export const MAX_ORG_UNIT_ALIASES = 20;

function hasBoundedUniqueAliases(values: readonly string[]): boolean {
  const normalized = values.map((value) => value.trim().toLocaleLowerCase());
  return values.length <= MAX_ORG_UNIT_ALIASES && new Set(normalized).size === values.length;
}

export const orgUnitSchema = new mongoose.Schema<OrgUnitRecord>(
  {
    schemaVersion: canonicalSchemaVersionField(orgUnitSchemaVersion),
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 240,
    },
    kind: {
      type: String,
      enum: [...orgUnitKinds],
      required: true,
    },
    aliases: {
      type: [
        {
          type: String,
          trim: true,
          minlength: 1,
          maxlength: 240,
        },
      ],
      default: [],
      validate: {
        validator: hasBoundedUniqueAliases,
        message: `aliases must contain at most ${MAX_ORG_UNIT_ALIASES} unique labels.`,
      },
    },
    parentOrgUnitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrgUnit',
      required: false,
      validate: {
        validator: function (
          this: { _id: mongoose.Types.ObjectId },
          value?: mongoose.Types.ObjectId,
        ) {
          return value === undefined || !value.equals(this._id);
        },
        message: 'parentOrgUnitId cannot reference the same OrgUnit.',
      },
    },
    status: {
      type: String,
      enum: [...orgUnitStatuses],
      default: 'UNKNOWN',
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

orgUnitSchema.index({ parentOrgUnitId: 1, kind: 1, status: 1, archived: 1 });
orgUnitSchema.index({ kind: 1, name: 1 });

export const OrgUnit =
  mongoose.models.OrgUnit || mongoose.model<OrgUnitRecord>('OrgUnit', orgUnitSchema, 'org_units');
