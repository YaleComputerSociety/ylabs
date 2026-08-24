import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';

export const SAVED_SEARCH_SCHEMA_VERSION = defineCanonicalSchemaVersion({
  currentVersion: 1,
});

export const MAX_SAVED_SEARCHES_PER_ACCOUNT = 30;
export const MAX_SAVED_SEARCH_LABEL_LENGTH = 120;
export const MAX_SAVED_SEARCH_QUERY_LENGTH = 512;
export const MAX_SAVED_SEARCH_FILTER_VALUES = 50;
export const MAX_SAVED_SEARCH_FILTER_VALUE_LENGTH = 120;
export const MAX_SAVED_SEARCH_URL_PARAMS_LENGTH = 2_048;
export const MAX_SAVED_SEARCH_TRACKED_MATCH_IDS = 200;

export const savedSearchCurrentAvailabilityValues = ['OPEN', 'ROLLING'] as const;
export const savedSearchCompensationValues = ['PAID_OR_STIPEND', 'COURSE_CREDIT'] as const;

export type SavedSearchCurrentAvailability = (typeof savedSearchCurrentAvailabilityValues)[number];
export type SavedSearchCompensation = (typeof savedSearchCompensationValues)[number];

const boundedStringArray = (label: string) => ({
  validator: (values: unknown[]) =>
    Array.isArray(values) &&
    values.length <= MAX_SAVED_SEARCH_FILTER_VALUES &&
    values.every(
      (value) =>
        typeof value === 'string' && value.length <= MAX_SAVED_SEARCH_FILTER_VALUE_LENGTH,
    ),
  message: `${label} must contain at most ${MAX_SAVED_SEARCH_FILTER_VALUES} short string values.`,
});

const savedSearchFiltersSchema = new mongoose.Schema(
  {
    school: { type: [String], default: [], validate: boundedStringArray('school') },
    departments: { type: [String], default: [], validate: boundedStringArray('departments') },
    researchAreas: {
      type: [String],
      default: [],
      validate: boundedStringArray('researchAreas'),
    },
    entityType: { type: [String], default: [], validate: boundedStringArray('entityType') },
    currentAvailability: {
      type: [String],
      default: [],
      enum: [...savedSearchCurrentAvailabilityValues],
    },
    compensation: {
      type: [String],
      default: [],
      enum: [...savedSearchCompensationValues],
    },
    hostsUndergrads: { type: Boolean, default: false },
    hasDocumentedWayIn: { type: Boolean, default: false },
  },
  { _id: false },
);

export const savedSearchSchema = new mongoose.Schema<Record<string, unknown>>(
  {
    schemaVersion: canonicalSchemaVersionField(SAVED_SEARCH_SCHEMA_VERSION),
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      immutable: true,
    },
    label: {
      type: String,
      default: '',
      trim: true,
      maxlength: MAX_SAVED_SEARCH_LABEL_LENGTH,
    },
    queryText: {
      type: String,
      default: '',
      maxlength: MAX_SAVED_SEARCH_QUERY_LENGTH,
    },
    filters: {
      type: savedSearchFiltersSchema,
      default: () => ({}),
    },
    urlParams: {
      type: String,
      default: '',
      maxlength: MAX_SAVED_SEARCH_URL_PARAMS_LENGTH,
    },
    lastSeenEntityIds: {
      type: [String],
      default: [],
      validate: {
        validator: (values: unknown[]) =>
          Array.isArray(values) && values.length <= MAX_SAVED_SEARCH_TRACKED_MATCH_IDS,
        message: `lastSeenEntityIds must contain at most ${MAX_SAVED_SEARCH_TRACKED_MATCH_IDS} ids.`,
      },
    },
    lastViewedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'saved_searches',
  },
);

savedSearchSchema.index({ accountId: 1, updatedAt: -1 });

export const SavedSearch =
  mongoose.models.SavedSearch ||
  mongoose.model('SavedSearch', savedSearchSchema, 'saved_searches');
