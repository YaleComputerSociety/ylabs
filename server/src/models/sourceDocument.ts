import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';

export const SOURCE_DOCUMENT_SCHEMA_VERSION = defineCanonicalSchemaVersion({
  currentVersion: 1,
});

export const sourceDocumentHealthStatuses = [
  'HEALTHY',
  'REDIRECTED',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;
export const sourceDocumentSensitivities = ['PUBLIC', 'AUTHENTICATED', 'ADMIN_ONLY'] as const;
export const sourceDocumentRetentionClasses = [
  'EPHEMERAL',
  'STANDARD',
  'AUDIT',
  'RESTRICTED',
] as const;

export type SourceDocumentHealthStatus = (typeof sourceDocumentHealthStatuses)[number];
export type SourceDocumentSensitivity = (typeof sourceDocumentSensitivities)[number];
export type SourceDocumentRetentionClass = (typeof sourceDocumentRetentionClasses)[number];

export const MAX_SOURCE_DOCUMENT_URL_LENGTH = 2_048;
export const MAX_SOURCE_DOCUMENT_EXTERNAL_KEY_LENGTH = 512;
export const MAX_SOURCE_DOCUMENT_KEY_LENGTH = 512;
export const MAX_SOURCE_DOCUMENT_POINTER_LENGTH = 2_048;
export const MAX_SOURCE_DOCUMENT_REDIRECTS = 10;
export const MAX_SOURCE_DOCUMENT_METADATA_TEXT_LENGTH = 512;

export function normalizeSourceDocumentKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export function isNormalizedSourceDocumentKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === normalizeSourceDocumentKey(value) &&
    /^[a-z0-9][a-z0-9._:/@+-]*$/.test(value)
  );
}

export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

const sourceDocumentMetadataSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: '',
      maxlength: MAX_SOURCE_DOCUMENT_METADATA_TEXT_LENGTH,
    },
    mediaType: {
      type: String,
      default: '',
      maxlength: 160,
    },
    language: {
      type: String,
      default: '',
      maxlength: 32,
    },
    etag: {
      type: String,
      default: '',
      maxlength: MAX_SOURCE_DOCUMENT_METADATA_TEXT_LENGTH,
    },
    lastModifiedAt: {
      type: Date,
      required: false,
    },
  },
  { _id: false },
);

export const sourceDocumentSchema = new mongoose.Schema<Record<string, unknown>>(
  {
    schemaVersion: canonicalSchemaVersionField(SOURCE_DOCUMENT_SCHEMA_VERSION),
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Source',
      required: true,
    },
    documentKey: {
      type: String,
      trim: true,
      set: normalizeSourceDocumentKey,
      maxlength: MAX_SOURCE_DOCUMENT_KEY_LENGTH,
      required: true,
      validate: {
        validator: isNormalizedSourceDocumentKey,
        message:
          'documentKey must be a normalized lowercase source identity using safe ASCII separators.',
      },
    },
    canonicalUrl: {
      type: String,
      trim: true,
      maxlength: MAX_SOURCE_DOCUMENT_URL_LENGTH,
      required(this: { externalResourceKey?: string }) {
        return !this.externalResourceKey;
      },
      validate: {
        validator: (value: string | undefined) => !value || isSafeHttpUrl(value),
        message: 'canonicalUrl must be an HTTP(S) URL without embedded credentials.',
      },
    },
    externalResourceKey: {
      type: String,
      trim: true,
      maxlength: MAX_SOURCE_DOCUMENT_EXTERNAL_KEY_LENGTH,
      required(this: { canonicalUrl?: string }) {
        return !this.canonicalUrl;
      },
    },
    retrievedAt: {
      type: Date,
      required: true,
    },
    contentHash: {
      type: String,
      required: true,
      trim: true,
      match: /^[a-f0-9]{64}$/i,
    },
    httpStatusCode: {
      type: Number,
      min: 100,
      max: 599,
      required: false,
    },
    healthStatus: {
      type: String,
      enum: [...sourceDocumentHealthStatuses],
      default: 'UNKNOWN',
      required: true,
    },
    snapshotPointer: {
      type: String,
      default: '',
      maxlength: MAX_SOURCE_DOCUMENT_POINTER_LENGTH,
      select: false,
    },
    sensitivity: {
      type: String,
      enum: [...sourceDocumentSensitivities],
      default: 'ADMIN_ONLY',
      required: true,
    },
    retentionClass: {
      type: String,
      enum: [...sourceDocumentRetentionClasses],
      default: 'STANDARD',
      required: true,
    },
    redirectChain: {
      type: [
        {
          type: String,
          maxlength: MAX_SOURCE_DOCUMENT_URL_LENGTH,
          validate: {
            validator: isSafeHttpUrl,
            message: 'redirectChain entries must be HTTP(S) URLs without embedded credentials.',
          },
        },
      ],
      default: [],
      validate: {
        validator: (values: unknown[]) =>
          Array.isArray(values) && values.length <= MAX_SOURCE_DOCUMENT_REDIRECTS,
        message: `redirectChain must contain at most ${MAX_SOURCE_DOCUMENT_REDIRECTS} URLs.`,
      },
    },
    metadata: {
      type: sourceDocumentMetadataSchema,
      default: () => ({}),
      select: false,
    },
  },
  {
    timestamps: true,
    collection: 'source_documents',
  },
);

sourceDocumentSchema.index({ sourceId: 1, retrievedAt: -1 });
sourceDocumentSchema.index({ sourceId: 1, documentKey: 1, contentHash: 1 }, { unique: true });
sourceDocumentSchema.index({ sourceId: 1, documentKey: 1, retrievedAt: -1 });
sourceDocumentSchema.index({ sourceId: 1, canonicalUrl: 1, retrievedAt: -1 });
sourceDocumentSchema.index({ sourceId: 1, externalResourceKey: 1, retrievedAt: -1 });
sourceDocumentSchema.index({ contentHash: 1 });
sourceDocumentSchema.index({ retentionClass: 1, retrievedAt: 1 });

export const SourceDocument =
  mongoose.models.SourceDocument ||
  mongoose.model('SourceDocument', sourceDocumentSchema, 'source_documents');
