import { Observation } from '../../models/observation';
import { mongooseConnectionWasOpened } from '../../utils/mongooseConnectionWasOpened';

export type TitledPersonKeysLoader = (sourceName: string) => Promise<ReadonlySet<string>>;

/**
 * The person keys a lane has already read a first-hand title for. A profile the lane now
 * screens out of enrichment still refreshes that title, so the read stays fresh (#5801).
 */
export async function loadLaneTitledPersonKeys(sourceName: string): Promise<ReadonlySet<string>> {
  if (!mongooseConnectionWasOpened()) return new Set();
  const keys = await Observation.distinct('entityKey', {
    sourceName,
    entityType: 'user',
    field: 'title',
    superseded: { $ne: true },
  });
  return new Set(keys.map(String));
}
