import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import {
  OWNERSHIP_GUARDED_DESCRIPTION_FIELDS,
  OWNERSHIP_GUARDED_ENTITY_TYPE,
  isOwnershipGuardedDescription,
  refusesDescriptionOnSharedPage,
} from './descriptionSourceOwnership';
import { normalizeEvidenceUrl } from './utils/sharedEvidenceUrls';

/**
 * Keeps a description observation out of resolution when the page it cites is already
 * the description source for other rows.
 *
 * #3500 put that bar at ingest, so no lane can store a new one. It does not reach what
 * is already stored, and the resolver ranks every live observation: a pre-guard shared
 * page observation can still win a field. Measured while clearing the standing corpus,
 * 4 of 46 rows whose borrowed description was refused rematerialized straight onto
 * ANOTHER borrowed description, because the refusal is keyed on the value it named and
 * the next candidate was a different shared page (#3481).
 *
 * Screening here is what makes that repair the last one of its kind. It sits beside
 * `refusedResolverObservations` for the same reason and with the same shape: drop the
 * candidate, never the field, so whatever rivals remain still resolve and a field with
 * no admissible candidate resolves to nothing.
 */
export interface OwnershipScreenableObservation {
  entityType?: unknown;
  field: string;
  value: unknown;
  sourceUrl?: unknown;
}

export interface OwnershipScreenResult<T> {
  kept: T[];
  dropped: Array<{ field: string; citedUrl: string; foreignCiters: number }>;
}

/**
 * `foreignCitersByUrl` maps a normalized URL to the entity keys that cite it as a
 * description source. The row being materialized is excluded by `ownEntityKeys`, so
 * re-observing a page this row already cites never reads as a foreign citer.
 */
export function screenDescriptionsOnSharedPages<T extends OwnershipScreenableObservation>(
  observations: readonly T[],
  foreignCitersByUrl: ReadonlyMap<string, ReadonlyMap<string, string>>,
  ownEntityKeys: ReadonlySet<string>,
  ownName?: unknown,
): OwnershipScreenResult<T> {
  const kept: T[] = [];
  const dropped: Array<{ field: string; citedUrl: string; foreignCiters: number }> = [];
  for (const observation of observations) {
    const candidate = {
      entityType: String(observation.entityType ?? OWNERSHIP_GUARDED_ENTITY_TYPE),
      field: observation.field,
      sourceUrl: observation.sourceUrl,
      ownName,
    };
    if (!isOwnershipGuardedDescription(candidate)) {
      kept.push(observation);
      continue;
    }
    const citedUrl = normalizeEvidenceUrl(observation.sourceUrl);
    const citers = foreignCitersByUrl.get(citedUrl);
    const foreignNames = citers
      ? [...citers.entries()].filter(([key]) => !ownEntityKeys.has(key)).map(([, name]) => name)
      : [];
    if (refusesDescriptionOnSharedPage(candidate, foreignNames)) {
      dropped.push({ field: observation.field, citedUrl, foreignCiters: foreignNames.length });
      continue;
    }
    kept.push(observation);
  }
  return { kept, dropped };
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Entity keys citing each of the given pages as a description source.
 *
 * Filtered by HOST and normalized in JavaScript, never matched on the normalized
 * string. `normalizeEvidenceUrl` drops a query string, a trailing slash and a `www.`,
 * so a stored `.../directory-name/` never equals its own normalized form and an `$in`
 * on normalized values reads zero citers for a page 130 rows cite.
 *
 * Cached across rows because a materialize sweep walks thousands of rows whose
 * candidate URLs repeat heavily - the repetition is the defect being screened - so
 * the uncached cost would be one query per row. `appendObservations` and
 * `retireObservations` in `observationStore.ts` drop the cache whenever they change
 * a live description citation, so an in-process writer lane never reads a stale one.
 *
 * The cache is filled once, from every live description citation, and each row is
 * admitted under the same host pattern the per-host query used, so a lookup answers
 * exactly what that query answered. Keyed by URL, the cache re-read a whole host for
 * each new page: on Development that was 201 host reads, each 0.25 s to 0.5 s over up
 * to 9,288 rows, for 400 roster rows, 40% of their materialization, while one read of
 * all 19,679 live citations takes about 0.7 s (#3568).
 */
let citersByUrl: Map<string, Map<string, string>> | undefined;

export function resetDescriptionOwnershipCitersCache(): void {
  citersByUrl = undefined;
}

const hostOfUrl = (url: string): string | undefined => {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
};

const citationHostPattern = (host: string): RegExp =>
  new RegExp(`^https?://(www\\.)?${escapeRegExp(host)}(/|$|\\?)`, 'i');

async function loadAllDescriptionSourceCiters(): Promise<Map<string, Map<string, string>>> {
  const rows = (await Observation.find(
    {
      entityType: OWNERSHIP_GUARDED_ENTITY_TYPE,
      field: { $in: [...OWNERSHIP_GUARDED_DESCRIPTION_FIELDS] },
      superseded: { $ne: true },
    },
    { sourceUrl: 1, entityKey: 1, entityId: 1 },
  ).lean()) as any[];
  const byUrl = new Map<string, Map<string, string>>();
  const patternByHost = new Map<string, RegExp>();
  for (const row of rows) {
    const key = String(row.entityKey || row.entityId || '');
    if (!key || typeof row.sourceUrl !== 'string') continue;
    const url = normalizeEvidenceUrl(row.sourceUrl);
    const host = url ? hostOfUrl(url) : undefined;
    if (!host) continue;
    let pattern = patternByHost.get(host);
    if (!pattern) {
      pattern = citationHostPattern(host);
      patternByHost.set(host, pattern);
    }
    if (!pattern.test(row.sourceUrl)) continue;
    const existing = byUrl.get(url) ?? new Map<string, string>();
    if (!existing.has(key)) existing.set(key, '');
    byUrl.set(url, existing);
  }

  // Subject identity is decided from NAMES, so every citer key is resolved once here.
  // A citer COUNT cannot tell a faculty directory from a lab whose members were each
  // minted as their own row, and that is the defect this replaces: 72 of 217 multi-citer
  // pages on Development were one subject, so the count was wrong about a third of them
  // and 234 rows were exposed (#3481).
  const keys = [...new Set([...byUrl.values()].flatMap((citers) => [...citers.keys()]))];
  if (keys.length > 0) {
    // Raw collection, not the model: registering ResearchEntity here creates its indexes
    // as a side effect, which two dry-run tests assert does not happen.
    const db = mongoose.connection?.db;
    const objectIds = keys
      .filter((key) => /^[a-f0-9]{24}$/i.test(key))
      .map((key) => new mongoose.Types.ObjectId(key));
    const named = db
      ? ((await db
          .collection('research_entities')
          .find(
            {
              $or: [
                { slug: { $in: keys } },
                ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
              ],
            },
            { projection: { slug: 1, name: 1, displayName: 1 } },
          )
          .toArray()) as any[])
      : [];
    const nameByKey = new Map<string, string>();
    for (const row of named) {
      const label = String(row.displayName || row.name || '');
      nameByKey.set(String(row.slug), label);
      nameByKey.set(String(row._id), label);
    }
    for (const citers of byUrl.values()) {
      for (const key of [...citers.keys()]) citers.set(key, nameByKey.get(key) ?? '');
    }
  }
  return byUrl;
}

export async function loadDescriptionSourceCiters(
  urls: readonly string[],
): Promise<Map<string, Map<string, string>>> {
  const wanted = [...new Set(urls.map((url) => normalizeEvidenceUrl(url)).filter(Boolean))].filter(
    (url) => hostOfUrl(url),
  );
  const result = new Map<string, Map<string, string>>();
  if (wanted.length === 0) return result;
  citersByUrl ??= await loadAllDescriptionSourceCiters();
  for (const url of wanted) {
    const entry = citersByUrl.get(url) ?? new Map<string, string>();
    citersByUrl.set(url, entry);
    result.set(url, entry);
  }
  return result;
}
