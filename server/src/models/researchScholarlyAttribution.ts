import mongoose from 'mongoose';

const researchScholarlyAttributionSchema = new mongoose.Schema(
  {
    scholarlyLinkId: { type: mongoose.Schema.Types.ObjectId, ref: 'ResearchScholarlyLink' },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    researchEntityId: { type: mongoose.Schema.Types.ObjectId, ref: 'ResearchEntity' },
    relationshipBasis: { type: String, default: '' },
    evidenceLabel: { type: String, default: '' },
    confidence: Number,
    observedAt: Date,
    sourceName: String,
    sourceUrl: String,
    archived: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false },
);

export const ResearchScholarlyAttribution =
  mongoose.models.ResearchScholarlyAttribution ||
  mongoose.model(
    'ResearchScholarlyAttribution',
    researchScholarlyAttributionSchema,
    'research_scholarly_attributions',
  );
