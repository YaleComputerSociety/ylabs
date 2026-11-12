/**
 * The prompt hash sits beside the key, not in it, so a prompt edit keeps every entry whose
 * draft still passes the current checks (#5537).
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts: every entry is a
 * paid draft, and a Development refresh must not clear it.
 */
import mongoose from 'mongoose';
import '../db/devWriteGuard';

export const WRITTEN_DESCRIPTION_DERIVATION_COLLECTION = 'written_description_derivations';

const rawWriterOutputSchema = new mongoose.Schema(
  {
    fullDescription: { type: String, default: '' },
    usedSnippetIndexes: { type: [Number], default: [] },
  },
  { _id: false },
);

const supersededWriterDraftSchema = new mongoose.Schema(
  {
    writer: { type: String, required: true },
    rawOutput: { type: rawWriterOutputSchema, required: true },
    derivedAt: { type: Date, required: true },
    at: { type: Date, required: true },
    reason: { type: String, required: true },
    decidedBy: { type: String, required: true },
  },
  { _id: false },
);

const writtenDescriptionDerivationSchema = new mongoose.Schema(
  {
    inputHash: { type: String, required: true },
    promptHash: { type: String, required: true },
    model: { type: String, required: true },
    writer: { type: String, required: true },
    rawOutput: { type: rawWriterOutputSchema, required: true },
    snippetSentenceHashes: { type: [[String]], default: [] },
    researchPageHeadingHashes: { type: [String], default: [] },
    derivedAt: { type: Date, required: true, default: () => new Date() },
    supersedes: { type: [supersededWriterDraftSchema], default: undefined },
  },
  { timestamps: false },
);

writtenDescriptionDerivationSchema.index({ inputHash: 1 }, { unique: true });

export const WrittenDescriptionDerivation = mongoose.model(
  'WrittenDescriptionDerivation',
  writtenDescriptionDerivationSchema,
  WRITTEN_DESCRIPTION_DERIVATION_COLLECTION,
);

export { writtenDescriptionDerivationSchema };
