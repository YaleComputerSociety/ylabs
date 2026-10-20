/**
 * One raw model reading of one stored research page text, keyed by the hash of everything
 * the reading depended on: the text, the prompt and the model (#5296).
 *
 * A cache, not evidence. The materializer reads the entry whose `inputHash` matches a row's
 * current `researchPageText` observation and runs the quote check and post-filters on it
 * against that text, so a filter change needs no new call; an entry no current text hashes
 * to is inert. No row identifier is stored, because two rows
 * with the same page text ask the model the same question.
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts: every entry is a
 * paid call, and a Development refresh must not clear it.
 */
import mongoose from 'mongoose';

export const RESEARCH_TOPICS_DERIVATION_COLLECTION = 'research_topics_derivations';

const quotedTopicSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true },
    quote: { type: String, required: false },
    url: { type: String, required: false },
  },
  { _id: false },
);

const researchTopicsDerivationSchema = new mongoose.Schema(
  {
    inputHash: { type: String, required: true },
    promptHash: { type: String, required: true },
    model: { type: String, required: true },
    extractedTopics: { type: [quotedTopicSchema], default: [] },
    extractedField: { type: quotedTopicSchema, required: false },
    derivedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

researchTopicsDerivationSchema.index({ inputHash: 1 }, { unique: true });

export const ResearchTopicsDerivation = mongoose.model(
  'ResearchTopicsDerivation',
  researchTopicsDerivationSchema,
  RESEARCH_TOPICS_DERIVATION_COLLECTION,
);

export { researchTopicsDerivationSchema };
