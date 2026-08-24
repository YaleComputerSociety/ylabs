/**
 * Recency analogue of the coverage-gap registries (#1705): the coverage
 * registries (`facultyDirectoryRegistry.ts` and siblings) answer "what has
 * never been covered", this answers "what was covered but has gone stale".
 */
import type { SourceCoverageTier } from '../models/sourceCoverageTypes';

export interface SourceFreshnessInput {
  name: string;
  displayName?: string;
  enabled?: boolean;
  lastCrawledAt?: Date | null;
  cadenceDays?: number | null;
  coverage?: { priority?: number; tier?: SourceCoverageTier } | null;
}

export type SourceFreshnessStatus = 'never-crawled' | 'overdue' | 'due-soon' | 'fresh';

export interface SourceFreshnessEntry {
  name: string;
  displayName: string;
  status: SourceFreshnessStatus;
  lastCrawledAt: Date | null;
  cadenceDays: number;
  daysSinceLastCrawl: number | null;
  priority: number;
  staleness: number;
}

// MANUAL_OVERRIDE sources (manual-edit channels, no live pages of their own)
// are exempt from re-crawl freshness entirely, mirroring how
// `sourceHealthService.ts` already excludes that tier from run-cadence risk.
const DEFAULT_CADENCE_DAYS_BY_TIER: Record<SourceCoverageTier, number | null> = {
  PRIMARY_OFFICIAL: 14,
  OFFICIAL_INDEX: 30,
  DERIVED_OFFICIAL: 45,
  THIRD_PARTY_ENRICHMENT: 60,
  MANUAL_OVERRIDE: null,
};

const FALLBACK_CADENCE_DAYS = 30;
const DEFAULT_PRIORITY = 50;
const DUE_SOON_STALENESS_RATIO = 0.8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function resolveCadenceDays(input: SourceFreshnessInput): number | null {
  if (typeof input.cadenceDays === 'number' && input.cadenceDays > 0) return input.cadenceDays;
  const tier = input.coverage?.tier;
  if (tier) return DEFAULT_CADENCE_DAYS_BY_TIER[tier];
  return FALLBACK_CADENCE_DAYS;
}

/**
 * Classifies a single Source's re-crawl freshness, or returns null when the
 * source is disabled or exempt (MANUAL_OVERRIDE) and so has no re-crawl
 * expectation to measure.
 */
export function classifySourceFreshness(
  input: SourceFreshnessInput,
  now: Date,
): SourceFreshnessEntry | null {
  if (input.enabled === false) return null;
  const cadenceDays = resolveCadenceDays(input);
  if (cadenceDays === null) return null;

  const priority =
    typeof input.coverage?.priority === 'number' ? input.coverage.priority : DEFAULT_PRIORITY;
  const lastCrawledAt = input.lastCrawledAt ?? null;

  if (!lastCrawledAt) {
    return {
      name: input.name,
      displayName: input.displayName || input.name,
      status: 'never-crawled',
      lastCrawledAt: null,
      cadenceDays,
      daysSinceLastCrawl: null,
      priority,
      staleness: Infinity,
    };
  }

  const daysSinceLastCrawl = Math.max(0, (now.getTime() - lastCrawledAt.getTime()) / MS_PER_DAY);
  const staleness = daysSinceLastCrawl / cadenceDays;
  const status: SourceFreshnessStatus =
    staleness >= 1 ? 'overdue' : staleness >= DUE_SOON_STALENESS_RATIO ? 'due-soon' : 'fresh';

  return {
    name: input.name,
    displayName: input.displayName || input.name,
    status,
    lastCrawledAt,
    cadenceDays,
    daysSinceLastCrawl,
    priority,
    staleness,
  };
}

export function computeSourceFreshness(
  sources: SourceFreshnessInput[],
  now: Date,
): SourceFreshnessEntry[] {
  return sources
    .map((source) => classifySourceFreshness(source, now))
    .filter((entry): entry is SourceFreshnessEntry => entry !== null);
}

/**
 * Impact-ranked re-crawl worklist: never-crawled sources rank above overdue
 * sources (an unknown-magnitude staleness outranks a measured one), then each
 * group is ordered by student impact (`coverage.priority`) times overdue
 * magnitude, mirroring `getFacultyDirectoryGaps()`'s tier-then-magnitude sort.
 */
export function getStaleSources(
  sources: SourceFreshnessInput[],
  now: Date,
): SourceFreshnessEntry[] {
  return computeSourceFreshness(sources, now)
    .filter((entry) => entry.status === 'never-crawled' || entry.status === 'overdue')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'never-crawled' ? -1 : 1;
      if (a.status === 'never-crawled') return b.priority - a.priority;
      return b.priority * b.staleness - a.priority * a.staleness;
    });
}

export interface SourceFreshnessSummary {
  fresh: number;
  dueSoon: number;
  overdue: number;
  neverCrawled: number;
  exempt: number;
}

export function summarizeSourceFreshness(
  sources: SourceFreshnessInput[],
  now: Date,
): SourceFreshnessSummary {
  const entries = computeSourceFreshness(sources, now);
  return {
    fresh: entries.filter((entry) => entry.status === 'fresh').length,
    dueSoon: entries.filter((entry) => entry.status === 'due-soon').length,
    overdue: entries.filter((entry) => entry.status === 'overdue').length,
    neverCrawled: entries.filter((entry) => entry.status === 'never-crawled').length,
    exempt: sources.length - entries.length,
  };
}
