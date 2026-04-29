/**
 * Mongoose schema and model for the scraper source registry.
 *
 * Each Source represents a place data comes from (an external API, an HTML page, an LLM
 * extractor, or a manual edit channel). The defaultWeight is the trust weight applied to
 * Observations from this source unless overridden per-observation.
 */
import mongoose from 'mongoose';

const sourceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    displayName: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    baseUrl: {
      type: String,
      default: '',
    },
    defaultWeight: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    isManualLock: {
      type: Boolean,
      default: false,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    cadence: {
      type: String,
      default: '',
    },
    notes: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  },
);

sourceSchema.index({ enabled: 1 });

export const Source = mongoose.model('sources', sourceSchema);

export { sourceSchema };
