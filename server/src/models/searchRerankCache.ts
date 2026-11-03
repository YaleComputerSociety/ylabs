/**
 * Relevance scores for the top results of one research search, produced offline and read
 * at serve time to reorder those results (#5448). Keyed by `searchRerankCacheQueryKey`, the
 * normalized query plus the student-chosen filters.
 *
 * A stale entry only reorders rows search already returned: it never adds or hides a row.
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts: each environment
 * is seeded separately by `research-search:seed-rerank-cache`, and the entries pair real
 * student queries with research rows, so they are never committed to the repository.
 */
import mongoose from 'mongoose';

export const SEARCH_RERANK_CACHE_COLLECTION = 'search_rerank_cache';
export const SEARCH_RERANK_MIN_SCORE = 0;
export const SEARCH_RERANK_MAX_SCORE = 3;

const rerankScoreSchema = new mongoose.Schema(
  {
    entityId: { type: String, required: true },
    score: {
      type: Number,
      required: true,
      min: SEARCH_RERANK_MIN_SCORE,
      max: SEARCH_RERANK_MAX_SCORE,
    },
  },
  { _id: false },
);

const rerankFiltersSchema = new mongoose.Schema(
  {
    kind: { type: [String], default: undefined },
    entityType: { type: [String], default: undefined },
    school: { type: [String], default: undefined },
    departments: { type: [String], default: undefined },
    researchAreas: { type: [String], default: undefined },
    hostsUndergrads: { type: Boolean, required: false },
    welcomesUndergrads: { type: Boolean, required: false },
  },
  { _id: false },
);

const searchRerankCacheSchema = new mongoose.Schema(
  {
    queryKey: { type: String, required: true },
    queryText: { type: String, required: true },
    filters: { type: rerankFiltersSchema, default: () => ({}) },
    scores: { type: [rerankScoreSchema], default: [] },
    scoredAt: { type: Date, required: true },
    indexVersion: { type: String, required: true },
    source: { type: String, required: true },
  },
  { timestamps: false },
);

searchRerankCacheSchema.index({ queryKey: 1 }, { unique: true });

export const SearchRerankCache = mongoose.model(
  'SearchRerankCache',
  searchRerankCacheSchema,
  SEARCH_RERANK_CACHE_COLLECTION,
);

export { searchRerankCacheSchema };
