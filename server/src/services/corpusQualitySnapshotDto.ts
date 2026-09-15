import type { CorpusQualityRatio } from './corpusQualityReportCore';

/**
 * What the dashboard is told about a stored measurement.
 *
 * Explicit rather than the lean document, so the response shape is a decision
 * instead of a consequence of the schema. A raw row also ships `_id`,
 * `createdAt`, `updatedAt` and `__v`, which no reader uses, and a field added to
 * the schema for an internal reason would otherwise start being served without
 * anyone choosing that.
 *
 * `coverage` is deliberately absent: since #2730 every coverage number the panel
 * renders is read live, and each ratio carries its own denominator, so a trend
 * needs nothing from the stored coverage block. The stored row keeps it.
 */
export interface CorpusQualitySnapshotDto {
  measuredAt: string;
  environment: string;
  richness: {
    hasResearchWebsite: CorpusQualityRatio;
    hasTopic: CorpusQualityRatio;
    hasSourceUrl: CorpusQualityRatio;
    topicTotal: CorpusQualityRatio;
    noResearchWebsiteAndNoTopics: CorpusQualityRatio;
  };
  description: {
    fullDescriptionUseful: CorpusQualityRatio;
    shortDescriptionUseful: CorpusQualityRatio;
    leadSentenceStatesResearch: CorpusQualityRatio;
    shortDescriptionIsAreaEchoOnly: CorpusQualityRatio;
    nameIsGenericFacultyResearchTitle: CorpusQualityRatio;
  };
  integrity: {
    publicDescriptionInvariantFails: CorpusQualityRatio;
  };
}

export const CORPUS_QUALITY_SNAPSHOT_DTO_PROJECTION = {
  measuredAt: 1,
  environment: 1,
  richness: 1,
  description: 1,
  integrity: 1,
} as const;

const ratio = (value: unknown): CorpusQualityRatio => {
  const source = (value || {}) as { n?: unknown; of?: unknown };
  return { n: Number(source.n) || 0, of: Number(source.of) || 0 };
};

const ratioGroup = <Key extends string>(
  value: unknown,
  keys: readonly Key[],
): Record<Key, CorpusQualityRatio> => {
  const source = (value || {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, ratio(source[key])])) as Record<
    Key,
    CorpusQualityRatio
  >;
};

const RICHNESS_KEYS = [
  'hasResearchWebsite',
  'hasTopic',
  'hasSourceUrl',
  'topicTotal',
  'noResearchWebsiteAndNoTopics',
] as const;

const DESCRIPTION_KEYS = [
  'fullDescriptionUseful',
  'shortDescriptionUseful',
  'leadSentenceStatesResearch',
  'shortDescriptionIsAreaEchoOnly',
  'nameIsGenericFacultyResearchTitle',
] as const;

const INTEGRITY_KEYS = ['publicDescriptionInvariantFails'] as const;

const isoString = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
};

export function toCorpusQualitySnapshotDto(row: Record<string, unknown>): CorpusQualitySnapshotDto {
  return {
    measuredAt: isoString(row.measuredAt),
    environment: typeof row.environment === 'string' ? row.environment : '',
    richness: ratioGroup(row.richness, RICHNESS_KEYS),
    description: ratioGroup(row.description, DESCRIPTION_KEYS),
    integrity: ratioGroup(row.integrity, INTEGRITY_KEYS),
  };
}
