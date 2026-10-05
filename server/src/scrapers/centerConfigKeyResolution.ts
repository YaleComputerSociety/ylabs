import { ResearchEntity } from '../models/researchEntity';
import { resolveResearchEntityCanonicalIdentity } from '../services/researchEntityCanonicalTombstone';

export type CenterConfigKeyResolution =
  | { kind: 'live' }
  | { kind: 'unminted' }
  | { kind: 'survivor'; survivorKey: string }
  | { kind: 'archived-without-survivor' };

/**
 * Where a center config's observations belong: its own row, the live survivor a merge folded
 * that row into, or nowhere, because every consumer skips an archived key and a roster written
 * under one is neither served nor retired (#4021).
 */
export async function resolveCenterConfigKey(
  entityKey: string,
): Promise<CenterConfigKeyResolution> {
  const row = (await ResearchEntity.findOne({ slug: entityKey }).select('_id archived').lean()) as {
    archived?: boolean;
  } | null;
  if (!row) return { kind: 'unminted' };
  if (row.archived !== true) return { kind: 'live' };
  const survivor = await resolveResearchEntityCanonicalIdentity({ slug: entityKey });
  const survivorKey = typeof survivor?.slug === 'string' ? survivor.slug : '';
  return survivorKey ? { kind: 'survivor', survivorKey } : { kind: 'archived-without-survivor' };
}
