/**
 * Mongoose schema and model for Paper ↔ ResearchEntity association.
 */
import mongoose from 'mongoose';
import { fieldProvenanceSchema } from './modelPrimitives';

const paperGroupLinkSchema = new mongoose.Schema(
  {
    paperId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Paper',
      required: true,
    },
    researchGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchGroup',
      required: false,
    },
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: false,
    },
    relationship: {
      type: String,
      enum: ['pi-author', 'coauthor', 'featured', 'inferred'],
      default: 'inferred',
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    featuredReason: {
      type: String,
      default: '',
    },
    evidenceUrl: {
      type: String,
      default: '',
    },
    evidenceQuote: {
      type: String,
      default: '',
    },
    matchedFacultyMemberIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'FacultyMember',
      default: [],
    },
    fieldProvenance: {
      type: Map,
      of: fieldProvenanceSchema,
      default: {},
    },
    lastObservedAt: {
      type: Date,
      required: false,
    },
    archived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

paperGroupLinkSchema.index({ paperId: 1, researchGroupId: 1 }, { unique: true });
paperGroupLinkSchema.index({ researchGroupId: 1, isFeatured: 1 });
paperGroupLinkSchema.index(
  { paperId: 1, researchEntityId: 1 },
  {
    unique: true,
    partialFilterExpression: { researchEntityId: { $exists: true } },
  },
);
paperGroupLinkSchema.index({ researchEntityId: 1, isFeatured: 1 });
paperGroupLinkSchema.index({ paperId: 1 });
paperGroupLinkSchema.index({ matchedFacultyMemberIds: 1 });
paperGroupLinkSchema.index({ archived: 1 });
paperGroupLinkSchema.index({ lastObservedAt: 1 });

export const PaperGroupLink = mongoose.model(
  'PaperGroupLink',
  paperGroupLinkSchema,
  'paper_entity_links',
);

export { paperGroupLinkSchema };
