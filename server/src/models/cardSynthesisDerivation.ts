/**
 * The card prompt hash sits beside the key, not in it, so a prompt edit keeps every cached
 * card that still passes the card checks (#5537).
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts: every entry is a
 * paid card draft, and a Development refresh must not clear it.
 */
import mongoose from 'mongoose';

export const CARD_SYNTHESIS_DERIVATION_COLLECTION = 'card_synthesis_derivations';

const cardSynthesisDerivationSchema = new mongoose.Schema(
  {
    inputHash: { type: String, required: true },
    promptHash: { type: String, required: true },
    model: { type: String, required: true },
    writer: { type: String, required: true },
    rawCards: { type: [String], default: [] },
    derivedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

cardSynthesisDerivationSchema.index({ inputHash: 1 }, { unique: true });

export const CardSynthesisDerivation = mongoose.model(
  'CardSynthesisDerivation',
  cardSynthesisDerivationSchema,
  CARD_SYNTHESIS_DERIVATION_COLLECTION,
);

export { cardSynthesisDerivationSchema };
