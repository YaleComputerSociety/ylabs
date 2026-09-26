import { ScrapeRun } from '../models/scrapeRun';

/**
 * `scrapeRun.invalidated` is how an operator quarantines the evidence a bad run
 * produced. Before #2469 it fenced nothing on the write path: `sourceHealthService`
 * honoured it, but `materializeFromRun` and `observations:catch-up-materialize`
 * both ignored it, so a quarantined run's observations were structurally
 * indistinguishable from good ones and any catch-up pass would materialize them.
 *
 * A flag that reads as a fence and is only a comment is worse than no flag,
 * because the operator who sets it stops looking for a real remedy.
 *
 * Cached because the write path asks per entity key and the set is tiny and
 * operator-driven (8 rows on Development). The TTL bounds how long an in-flight
 * pass keeps acting on a stale answer after an operator quarantines a run
 * mid-pass; `invalidated` is indexed, so the refresh is cheap.
 */
const CACHE_TTL_MS = 30_000;

let cachedIds: string[] | undefined;
let cachedAt = 0;

export function resetInvalidatedScrapeRunCache(): void {
  cachedIds = undefined;
  cachedAt = 0;
}

export async function invalidatedScrapeRunIds(now: number = Date.now()): Promise<string[]> {
  if (cachedIds && now - cachedAt < CACHE_TTL_MS) return cachedIds;
  const rows = (await ScrapeRun.find({ invalidated: true }, { _id: 1 }).lean()) as Array<{
    _id: unknown;
  }>;
  cachedIds = rows.map((row) => String(row._id));
  cachedAt = now;
  return cachedIds;
}

export async function isScrapeRunInvalidated(scrapeRunId: unknown): Promise<boolean> {
  const id = scrapeRunId == null ? '' : String(scrapeRunId);
  if (!id) return false;
  return (await invalidatedScrapeRunIds()).includes(id);
}

/**
 * Partition observations by whether their emitting run is quarantined. Returns
 * both sides rather than just the keepers so a caller can tell "no evidence" from
 * "evidence withheld" - reporting zero written for both is the ambiguity that made
 * the empty-observation guard invisible in #2467.
 */
export function partitionObservationsByInvalidatedRun<T extends { scrapeRunId?: unknown }>(
  observations: readonly T[],
  invalidatedRunIds: readonly string[],
): { kept: T[]; withheld: T[] } {
  if (invalidatedRunIds.length === 0) return { kept: [...observations], withheld: [] };
  const invalidated = new Set(invalidatedRunIds);
  const kept: T[] = [];
  const withheld: T[] = [];
  for (const observation of observations) {
    const runId = observation.scrapeRunId == null ? '' : String(observation.scrapeRunId);
    if (runId && invalidated.has(runId)) withheld.push(observation);
    else kept.push(observation);
  }
  return { kept, withheld };
}
