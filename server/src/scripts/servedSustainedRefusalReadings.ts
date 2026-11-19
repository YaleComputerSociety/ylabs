import type { Db } from 'mongodb';

import {
  RESEARCH_PAGE_TEXT_FIELD,
  RESEARCH_PAGE_TEXT_SOURCE,
} from '../scrapers/utils/researchPageText';

export interface SustainedRefusalHostFlag {
  firstRefusedAt: string;
  confirmingRefusalAt: string;
  runs: number;
}

export interface StoredResearchPageReading {
  entityId?: string;
  entityKey?: string;
  observedAt: Date;
  urls: string[];
}

export interface ServedRowKeys {
  ids: ReadonlySet<string>;
  slugs: ReadonlySet<string>;
}

export interface UnconfirmedSinceSustainedRefusal extends SustainedRefusalHostFlag {
  host: string;
  servedReadingsUnconfirmed: number;
}

export interface ServedSustainedRefusalReadings {
  runStartedAt: string | null;
  hosts: UnconfirmedSinceSustainedRefusal[];
}

export const NO_SUSTAINED_REFUSAL_RUN: ServedSustainedRefusalReadings = {
  runStartedAt: null,
  hosts: [],
};

export const readingPageHost = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const validIso = (value: unknown): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

export function parseSustainedRefusalHosts(
  metric: unknown,
): Record<string, SustainedRefusalHostFlag> {
  if (!metric || typeof metric !== 'object') return {};
  const flags: Record<string, SustainedRefusalHostFlag> = {};
  for (const [host, entry] of Object.entries(metric as Record<string, unknown>)) {
    const candidate = (entry ?? {}) as Record<string, unknown>;
    const firstRefusedAt = validIso(candidate.firstRefusedAt);
    const confirmingRefusalAt = validIso(candidate.confirmingRefusalAt);
    const runs = Number(candidate.runs);
    if (!host || !firstRefusedAt || !confirmingRefusalAt || !Number.isFinite(runs)) continue;
    flags[host] = { firstRefusedAt, confirmingRefusalAt, runs };
  }
  return flags;
}

const rowKey = (reading: StoredResearchPageReading): string =>
  reading.entityId ? `id:${reading.entityId}` : `key:${reading.entityKey ?? ''}`;

function latestReadingPerRow(
  readings: readonly StoredResearchPageReading[],
): StoredResearchPageReading[] {
  const latest = new Map<string, StoredResearchPageReading>();
  for (const reading of readings) {
    if (!reading.entityId && !reading.entityKey) continue;
    const key = rowKey(reading);
    const known = latest.get(key);
    if (!known || reading.observedAt > known.observedAt) latest.set(key, reading);
  }
  return [...latest.values()];
}

const isServedReading = (reading: StoredResearchPageReading, served: ServedRowKeys): boolean =>
  reading.entityId
    ? served.ids.has(reading.entityId)
    : Boolean(reading.entityKey && served.slugs.has(reading.entityKey));

const soleHost = (reading: StoredResearchPageReading): string | null => {
  const hosts = new Set(reading.urls.map(readingPageHost).filter(Boolean));
  return hosts.size === 1 ? [...hosts][0] : null;
};

/**
 * A served reading is unconfirmed by a sustained refusal when every page it was built from sits
 * on the refusing host and it was last read before that host began refusing: no read since can
 * have confirmed it. This only counts; it changes nothing served (#6195).
 */
export function countServedReadingsUnconfirmedSinceRefusal(input: {
  flaggedHosts: Record<string, SustainedRefusalHostFlag>;
  readings: readonly StoredResearchPageReading[];
  served: ServedRowKeys;
}): UnconfirmedSinceSustainedRefusal[] {
  const counts = new Map<string, number>(Object.keys(input.flaggedHosts).map((host) => [host, 0]));
  for (const reading of latestReadingPerRow(input.readings)) {
    const host = soleHost(reading);
    const flag = host ? input.flaggedHosts[host] : undefined;
    if (!host || !flag || !isServedReading(reading, input.served)) continue;
    if (reading.observedAt.getTime() >= Date.parse(flag.firstRefusedAt)) continue;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts]
    .sort(([hostA], [hostB]) => hostA.localeCompare(hostB))
    .map(([host, servedReadingsUnconfirmed]) => ({
      host,
      ...input.flaggedHosts[host],
      servedReadingsUnconfirmed,
    }));
}

const isoOrNull = (value: unknown): string | null => {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/**
 * Reads the newest successful research-page-text run, because the flag is recomputed from run
 * history on every run, so a host absent from the newest run's metric has answered again or never
 * crossed the bound. Raw driver reads only: the served filter is the scoreboard's own.
 */
export async function loadServedSustainedRefusalReadings(
  db: Db,
  servedFilter: Record<string, unknown>,
): Promise<ServedSustainedRefusalReadings> {
  const newestRun = await db
    .collection('scrape_runs')
    .findOne(
      { sourceName: RESEARCH_PAGE_TEXT_SOURCE, status: 'success' },
      { sort: { startedAt: -1 }, projection: { startedAt: 1, 'metrics.sustainedRefusalHosts': 1 } },
    );
  const runStartedAt = newestRun ? isoOrNull(newestRun.startedAt) : null;
  if (!newestRun || runStartedAt === null) return NO_SUSTAINED_REFUSAL_RUN;
  const flaggedHosts = parseSustainedRefusalHosts(newestRun.metrics?.sustainedRefusalHosts);
  if (Object.keys(flaggedHosts).length === 0) return { runStartedAt, hosts: [] };

  const [servedDocs, readingDocs] = await Promise.all([
    db
      .collection('research_entities')
      .find(servedFilter, { projection: { _id: 1, slug: 1 } })
      .toArray(),
    db
      .collection('observations')
      .find(
        {
          entityType: 'researchEntity',
          field: RESEARCH_PAGE_TEXT_FIELD,
          sourceName: RESEARCH_PAGE_TEXT_SOURCE,
          superseded: false,
        },
        { projection: { entityId: 1, entityKey: 1, observedAt: 1, 'value.url': 1 } },
      )
      .toArray(),
  ]);
  const readings = readingDocs.flatMap((doc): StoredResearchPageReading[] => {
    const observedAt = isoOrNull(doc.observedAt);
    if (observedAt === null) return [];
    const value: unknown[] = Array.isArray(doc.value) ? doc.value : [];
    return [
      {
        entityId: doc.entityId ? String(doc.entityId) : undefined,
        entityKey: typeof doc.entityKey === 'string' ? doc.entityKey : undefined,
        observedAt: new Date(observedAt),
        urls: value.map((entry) => String((entry as { url?: unknown } | null)?.url ?? '')),
      },
    ];
  });
  return {
    runStartedAt,
    hosts: countServedReadingsUnconfirmedSinceRefusal({
      flaggedHosts,
      readings,
      served: {
        ids: new Set(servedDocs.map((doc) => String(doc._id))),
        slugs: new Set(servedDocs.map((doc) => String(doc.slug ?? '')).filter(Boolean)),
      },
    }),
  };
}

export function formatServedSustainedRefusalReadings(
  readings: ServedSustainedRefusalReadings,
): string[] {
  if (readings.runStartedAt === null) {
    return ['research-page-text sustained refusals: no successful research-page-text run found'];
  }
  if (readings.hosts.length === 0) {
    return [
      `research-page-text sustained refusals: none flagged by the run started ${readings.runStartedAt}`,
    ];
  }
  return [
    `research-page-text hosts refusing for a sustained period, flagged by the run started ${readings.runStartedAt} (read-only, nothing served changes):`,
    ...readings.hosts.map(
      (host) =>
        `  - ${host.host}: ${host.servedReadingsUnconfirmed} served readings draw only on it, unconfirmed since ${host.firstRefusedAt} (${host.runs} refused runs, latest ${host.confirmingRefusalAt})`,
    ),
  ];
}
