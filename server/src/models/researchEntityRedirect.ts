/**
 * Durable canonical redirects for research entities collapsed by a dedupe merge
 * (`research_entity_redirects`).
 *
 * A merge archives a shell entity into a canonical survivor and stamps the shell
 * with a `canonicalGroupId` tombstone. That tombstone lives on the shell row, so
 * it vanishes the moment the shell is deleted. This collection records the same
 * shell -> canonical mapping keyed on the shell's stable source identifiers (slug
 * and original id), so a later re-scrape of the shell's source resolves straight
 * to the canonical entity even after the shell row is gone (issue #1957, PR 3).
 */
import mongoose from 'mongoose';

const researchEntityRedirectSchema = new mongoose.Schema(
  {
    mergedSlug: {
      type: String,
      required: false,
    },
    mergedEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: false,
    },
    canonicalEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: true,
    },
    canonicalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: false,
      default: null,
    },
    mergedAt: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

researchEntityRedirectSchema.index(
  { mergedSlug: 1 },
  { unique: true, partialFilterExpression: { mergedSlug: { $type: 'string' } } },
);
researchEntityRedirectSchema.index(
  { mergedEntityId: 1 },
  { unique: true, partialFilterExpression: { mergedEntityId: { $type: 'objectId' } } },
);
researchEntityRedirectSchema.index({ canonicalEntityId: 1 });

export const ResearchEntityRedirect =
  mongoose.models.ResearchEntityRedirect ||
  mongoose.model(
    'ResearchEntityRedirect',
    researchEntityRedirectSchema,
    'research_entity_redirects',
  );

export { researchEntityRedirectSchema };
