/**
 * Shared embedded schemas for scraper-backed materialized models.
 */
import mongoose from 'mongoose';

export const fieldProvenanceSchema = new mongoose.Schema(
  {
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'sources',
      required: false,
    },
    sourceName: {
      type: String,
      default: '',
    },
    sourceUrl: {
      type: String,
      default: '',
    },
    observationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'observations',
      required: false,
    },
    observedAt: {
      type: Date,
      required: false,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      required: false,
    },
  },
  { _id: false },
);

export const opennessSignalSchema = new mongoose.Schema(
  {
    signalType: {
      type: String,
      enum: [
        'active-listing',
        'pi-claim',
        'indep-study-course',
        'lab-microsite-llm',
        'prior-undergrad-member',
        'student-outcome',
      ],
      required: true,
    },
    value: {
      type: Boolean,
      required: true,
    },
    strength: {
      type: String,
      enum: ['verified', 'likely', 'weak', 'negative'],
      required: true,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    observedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    expiresAt: {
      type: Date,
      required: false,
    },
    evidenceText: {
      type: String,
      default: '',
    },
    sourceUrl: {
      type: String,
      default: '',
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'sources',
      required: false,
    },
    observationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'observations',
      required: false,
    },
  },
  {
    timestamps: true,
    _id: true,
  },
);
