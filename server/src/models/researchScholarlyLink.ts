import mongoose from 'mongoose';

const researchScholarlyLinkSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    researchEntityId: { type: mongoose.Schema.Types.ObjectId, ref: 'ResearchEntity' },
    title: { type: String, default: '' },
    url: { type: String, default: '' },
    destinationKind: { type: String, default: 'OTHER' },
    displaySource: { type: String, default: '' },
    freeFullTextUrl: { type: String, default: '' },
    freeFullTextLabel: { type: String, default: '' },
    discoveredVia: { type: String, default: '' },
    year: Number,
    venue: String,
    confidence: Number,
    observedAt: Date,
    sourceUrl: String,
    externalIds: { type: mongoose.Schema.Types.Mixed, default: {} },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false },
);

export const ResearchScholarlyLink =
  mongoose.models.ResearchScholarlyLink ||
  mongoose.model(
    'ResearchScholarlyLink',
    researchScholarlyLinkSchema,
    'research_scholarly_links',
  );
