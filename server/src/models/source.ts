/**
 * Mongoose schema and model for the scraper source registry.
 *
 * Each Source represents a place data comes from (an external API, an HTML page, an LLM
 * extractor, or a manual edit channel). The defaultWeight is the trust weight applied to
 * Observations from this source unless overridden per-observation.
 */
import mongoose from 'mongoose';
import {
  sourceCoverageArtifactTypes,
  sourceCoverageEvidenceCategories,
  sourceCoverageTiers,
} from './sourceCoverageTypes';

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
    coverage: {
      priority: {
        type: Number,
        min: 0,
        max: 100,
        required: false,
      },
      tier: {
        type: String,
        enum: [...sourceCoverageTiers],
        required: false,
      },
      artifactTypes: {
        type: [String],
        enum: [...sourceCoverageArtifactTypes],
        default: [],
      },
      evidenceCategories: {
        type: [String],
        enum: [...sourceCoverageEvidenceCategories],
        default: [],
      },
      defaultConfidence: {
        type: String,
        enum: ['HIGH', 'MEDIUM', 'LOW'],
        required: false,
      },
      notes: {
        type: String,
        default: '',
      },
    },
  },
  {
    timestamps: true,
  },
);

sourceSchema.index({ enabled: 1 });
sourceSchema.index({ 'coverage.priority': 1 });
sourceSchema.index({ 'coverage.artifactTypes': 1 });

export const Source = mongoose.model('Source', sourceSchema);

export { sourceSchema };
