/**
 * Unified canonical-alias ledger (`canonical_aliases`).
 *
 * Designed to generalize the delete-safe shell -> canonical mapping of
 * `research_entity_redirects` into one collection keyed on any identity
 * namespace (slug, entity id, netid, email, orcid, ...) across every canonical
 * type. A row records that some alias identifier resolves to a canonical record,
 * so the resolve-at-mint resolver can consult it before creating a duplicate.
 * Aliases are retired by setting `active: false` (a split re-keys rather than
 * deletes), and resolution never reads the loser row, so the mapping survives
 * deletion of the merged record.
 *
 * It does not generalize that mapping yet, and a reader should not treat it as
 * the place a merge is recorded. The only writer is `reserveEntityCanonicalAliases`
 * in `entityMaterializer.ts`, behind `C4_RESOLVE_AT_MINT_ENTITIES` and reached
 * only when a new entity mints, so no merge lane records an alias and nothing
 * carried the existing `research_entity_redirects` rows across (the backfill that
 * would have was deleted with the legacy User model in #2122). Development holds
 * 5 alias rows against 1,090 redirects, so `researchEntityMergeRedirectService`
 * remains the authority for an entity merge and `type: 'researcher'` has no
 * writer at all (#2063).
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
