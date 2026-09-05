import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';

export const taxonomyTermSchemaVersion = defineCanonicalSchemaVersion({ currentVersion: 1 });

export const taxonomyTermKinds = ['TOPIC', 'METHOD'] as const;
export type TaxonomyTermKind = (typeof taxonomyTermKinds)[number];

export const taxonomyTermReviewStatuses = ['UNREVIEWED', 'APPROVED', 'DISPUTED'] as const;
export type TaxonomyTermReviewStatus = (typeof taxonomyTermReviewStatuses)[number];

export const taxonomyTermStatuses = ['ACTIVE', 'INACTIVE'] as const;
export type TaxonomyTermStatus = (typeof taxonomyTermStatuses)[number];

export interface TaxonomyTermRecord {
  schemaVersion: number;
  kind: TaxonomyTermKind;
  label: string;
  normalizedLabel: string;
  aliases: string[];
  reviewStatus: TaxonomyTermReviewStatus;
  status: TaxonomyTermStatus;
  archived: boolean;
}

export const MAX_TAXONOMY_ALIASES = 30;

export function normalizeTaxonomyLabel(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function hasBoundedUniqueAliases(
  this: { normalizedLabel?: string },
  values: readonly string[],
): boolean {
  const normalized = values.map(normalizeTaxonomyLabel);
  return (
    values.length <= MAX_TAXONOMY_ALIASES &&
    new Set(normalized).size === values.length &&
    !normalized.includes(this.normalizedLabel ?? '')
  );
}

export const taxonomyTermSchema = new mongoose.Schema<TaxonomyTermRecord>(
  {
    schemaVersion: canonicalSchemaVersionField(taxonomyTermSchemaVersion),
    kind: {
      type: String,
      enum: [...taxonomyTermKinds],
      required: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 240,
    },
    normalizedLabel: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 1,
      maxlength: 240,
      default: function (this: { label?: string }) {
        return normalizeTaxonomyLabel(this.label ?? '');
      },
      set: normalizeTaxonomyLabel,
      validate: {
        validator: function (this: { label?: string }, value: string) {
          return this.label !== undefined && value === normalizeTaxonomyLabel(this.label);
        },
        message: 'normalizedLabel must match the canonical label.',
      },
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
        message: `aliases must contain at most ${MAX_TAXONOMY_ALIASES} unique labels.`,
      },
    },
    reviewStatus: {
      type: String,
      enum: [...taxonomyTermReviewStatuses],
      default: 'UNREVIEWED',
    },
    status: {
      type: String,
      enum: [...taxonomyTermStatuses],
      default: 'ACTIVE',
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

taxonomyTermSchema.index({ kind: 1, normalizedLabel: 1 }, { unique: true });

export const TaxonomyTerm =
  mongoose.models.TaxonomyTerm ||
  mongoose.model<TaxonomyTermRecord>('TaxonomyTerm', taxonomyTermSchema, 'taxonomy_terms');
