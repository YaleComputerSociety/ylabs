import crypto from 'crypto';

export const DEFAULT_EVAL_SAMPLE_SEED = 'pipeline-eval';

const rank = (seed: string, id: string): string =>
  crypto.createHash('sha256').update(`${seed}:${id}`).digest('hex');

/**
 * The same `size` ids for the same seed and population, which `$sample` cannot give: two runs
 * of an unseeded sample score different rows, so no difference between them is known to be
 * real (#3514). A row joining the population only displaces rows ranked after it.
 */
export function seededSample(ids: readonly string[], size: number, seed: string): string[] {
  return [...new Set(ids)]
    .map((id) => ({ id, rank: rank(seed, id) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .slice(0, Math.max(0, size))
    .map((entry) => entry.id);
}
