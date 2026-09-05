import { Observation } from '../models/observation';

export const OBSERVATION_STORE_EMPTY_REASON =
  'observation store holds no documents in this database';

/**
 * Whether this database carries an observation store at all, as distinct from
 * whether a particular entity has evidence in it.
 *
 * The `beta` and `production` databases hold the materialized corpus without the
 * observations it was derived from, because the promotion path copies
 * materialized collections and not the evidence store. So every observation read
 * returns empty there, and a reader that treats empty as a verdict states a
 * false positive ("this entity has no source evidence") or retires a record it
 * simply cannot see the justification for (#2458).
 *
 * Population, never presence: the collection *exists* with zero documents, and
 * `autoIndex` recreates a dropped collection empty rather than erroring, so an
 * existence check passes exactly where the danger is. `exists({})` is a bounded
 * lookup rather than a count, so this is cheap enough to call once per run
 * without caching - and it must not be cached, because the visibility repair
 * queue mints observations and can flip the answer within a process lifetime.
 */
export async function observationStoreIsPopulated(): Promise<boolean> {
  return Boolean(await Observation.exists({}));
}
