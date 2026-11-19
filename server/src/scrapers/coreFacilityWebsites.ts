import { ResearchEntity } from '../models/researchEntity';
import {
  isCoreFacilityPageCitedByPerson,
  isPersonOwnResearchRowShape,
} from '../utils/researchHomeWebsiteUrl';
import { websiteShareKey } from '../utils/websiteShareKey';

/**
 * The websites live `CORE_FACILITY` rows hold as their own (#5788). A person's profile can list
 * the facility they staff as their website; on the person's row that page is the facility's
 * own website rather than the person's, so every resolve refuses it there. The set is read
 * from the rows on each resolve, so it follows facility rows as they are created or archived
 * and nothing is written to the person rows to make the refusal stick.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

const PERSON_WEBSITE_FIELDS: ReadonlySet<string> = new Set(['website', 'websiteUrl']);

const PERSON_ROW_CITATION_FIELDS: ReadonlySet<string> = new Set([
  'website',
  'websiteUrl',
  'sourceUrls',
]);

export interface CoreFacilityWebsiteRow {
  websiteUrl?: unknown;
  website?: unknown;
}

export function coreFacilityWebsiteKeys(rows: Iterable<CoreFacilityWebsiteRow>): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const value of [row.websiteUrl, row.website]) {
      const key = websiteShareKey(value);
      if (key) keys.add(key);
    }
  }
  return keys;
}

export async function readCoreFacilityWebsiteKeys(): Promise<Set<string>> {
  const rows = await ResearchEntity.find(
    { entityType: 'CORE_FACILITY', archived: { $ne: true } },
    { websiteUrl: 1, website: 1 },
  ).lean<CoreFacilityWebsiteRow[]>();
  return coreFacilityWebsiteKeys(rows);
}

let cached: { keys: Promise<Set<string>>; expiresAt: number } | undefined;

export function coreFacilityWebsiteKeysForMaterialization(
  now: number = Date.now(),
): Promise<Set<string>> {
  if (!cached || cached.expiresAt <= now) {
    const keys = readCoreFacilityWebsiteKeys();
    cached = { keys, expiresAt: now + CACHE_TTL_MS };
    keys.catch(() => {
      if (cached?.keys === keys) cached = undefined;
    });
  }
  return cached.keys;
}

export function resetCoreFacilityWebsiteKeysCache(): void {
  cached = undefined;
}

export function isCoreFacilityWebsite(value: unknown, keys: ReadonlySet<string>): boolean {
  const key = websiteShareKey(value);
  return Boolean(key && keys.has(key));
}

export function withoutCoreFacilityPersonWebsiteObservations<
  T extends { field?: unknown; value?: unknown },
>(observations: readonly T[], keys: ReadonlySet<string>): T[] {
  if (keys.size === 0) return [...observations];
  return observations.filter(
    (observation) =>
      !(
        PERSON_WEBSITE_FIELDS.has(String(observation.field ?? '')) &&
        isCoreFacilityWebsite(observation.value, keys)
      ),
  );
}

/**
 * A person row's website and citation observations with every facility page taken out. A
 * citation list keeps its other pages, and an observation left with nothing is dropped, so the
 * resolver ranks the remaining evidence as if the facility page had never been asserted.
 */
export function withoutCoreFacilityCitationsOnPersonRow<
  T extends { field?: unknown; value?: unknown },
>(
  observations: readonly T[],
  row: { entityType?: unknown; kind?: unknown },
  keys: ReadonlySet<string>,
): T[] {
  const identity = { entityType: row.entityType, kind: row.kind, coreFacilityWebsiteKeys: keys };
  if (keys.size === 0 || !isPersonOwnResearchRowShape(identity)) return [...observations];
  const cites = (value: unknown) => isCoreFacilityPageCitedByPerson(value, identity);
  const kept: T[] = [];
  for (const observation of observations) {
    if (!PERSON_ROW_CITATION_FIELDS.has(String(observation.field ?? ''))) {
      kept.push(observation);
      continue;
    }
    if (!Array.isArray(observation.value)) {
      if (!cites(observation.value)) kept.push(observation);
      continue;
    }
    const remaining = observation.value.filter((value) => !cites(value));
    if (remaining.length === observation.value.length) kept.push(observation);
    else if (remaining.length > 0) kept.push({ ...observation, value: remaining });
  }
  return kept;
}

export function withoutCoreFacilityPagesOnPersonRow(
  sourceUrls: readonly unknown[],
  identity: { entityType?: unknown; kind?: unknown; coreFacilityWebsiteKeys?: ReadonlySet<string> },
): unknown[] {
  return sourceUrls.filter((url) => !isCoreFacilityPageCitedByPerson(url, identity));
}
