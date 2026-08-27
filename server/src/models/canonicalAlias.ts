/**
 * Unified canonical-alias ledger (`canonical_aliases`).
 *
 * Generalizes the delete-safe shell -> canonical mapping of
 * `research_entity_redirects` into one collection keyed on any identity
 * namespace (slug, entity id, netid, email, orcid, ...) across every canonical
 * type. A row records that some alias identifier resolves to a canonical record,
 * so the resolve-at-mint resolver can consult it before creating a duplicate.
 * Aliases are retired by setting `active: false` (a split re-keys rather than
 * deletes), and resolution never reads the loser row, so the mapping survives
 * deletion of the merged record.
 */
import mongoose from 'mongoose';

export type CanonicalType = 'researchEntity' | 'researcher' | 'fellowship';

export const CANONICAL_ALIAS_TYPES: CanonicalType[] = [
  'researchEntity',
  'researcher',
  'fellowship',
];

const canonicalAliasSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: CANONICAL_ALIAS_TYPES },
    aliasNs: { type: String, required: true },
    aliasValue: { type: String, required: true },
    canonicalType: { type: String, required: true, enum: CANONICAL_ALIAS_TYPES },
    canonicalId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reason: { type: String, required: false },
    mergedAt: { type: Date, required: true },
    supersededBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CanonicalAlias',
      required: false,
      default: null,
    },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

canonicalAliasSchema.index(
  { type: 1, aliasNs: 1, aliasValue: 1 },
  { unique: true, partialFilterExpression: { aliasValue: { $type: 'string' } } },
);
canonicalAliasSchema.index({ canonicalType: 1, canonicalId: 1 });

export const CanonicalAlias =
  mongoose.models.CanonicalAlias ||
  mongoose.model('CanonicalAlias', canonicalAliasSchema, 'canonical_aliases');

export { canonicalAliasSchema };
