import { describe, expect, it } from 'vitest';
import {
  CORPUS_QUALITY_SNAPSHOT_DTO_PROJECTION,
  toCorpusQualitySnapshotDto,
} from '../corpusQualitySnapshotDto';

const ratio = (n: number, of = 50) => ({ n, of });

const storedRow = () => ({
  _id: '6aa88346255d7e0bc7758319',
  __v: 0,
  createdAt: new Date('2026-09-14T23:29:10.536Z'),
  updatedAt: new Date('2026-09-14T23:29:10.536Z'),
  measuredAt: new Date('2026-09-14T23:28:55.762Z'),
  environment: 'development',
  databaseName: 'Development',
  surface: 'served student_ready rows, roster-resolved',
  coverage: { entities: 100, archived: 10, studentReady: 50, byTier: [], studentReadyBySchool: [] },
  richness: {
    hasResearchWebsite: ratio(25),
    hasTopic: ratio(48),
    hasSourceUrl: ratio(50),
    topicTotal: ratio(150),
    noResearchWebsiteAndNoTopics: ratio(1),
  },
  description: {
    fullDescriptionUseful: ratio(50),
    shortDescriptionUseful: ratio(50),
    leadSentenceStatesResearch: ratio(24),
    shortDescriptionIsAreaEchoOnly: ratio(2),
    nameIsGenericFacultyResearchTitle: ratio(20),
  },
  integrity: { publicDescriptionInvariantFails: ratio(0) },
});

describe('toCorpusQualitySnapshotDto', () => {
  it('serves exactly the measured blocks and nothing else', () => {
    expect(Object.keys(toCorpusQualitySnapshotDto(storedRow())).sort()).toEqual([
      'description',
      'environment',
      'integrity',
      'measuredAt',
      'richness',
    ]);
  });

  it('drops Mongo bookkeeping, which no reader uses', () => {
    const dto = toCorpusQualitySnapshotDto(storedRow()) as Record<string, unknown>;

    for (const key of ['_id', '__v', 'createdAt', 'updatedAt', 'databaseName', 'surface']) {
      expect(dto[key]).toBeUndefined();
    }
  });

  /**
   * Coverage is read live since #2730, and every ratio carries its own
   * denominator, so a trend needs nothing from the stored coverage block.
   */
  it('does not serve the stored coverage block', () => {
    expect(
      (toCorpusQualitySnapshotDto(storedRow()) as Record<string, unknown>).coverage,
    ).toBeUndefined();
  });

  it('serialises the measurement time as an ISO string', () => {
    expect(toCorpusQualitySnapshotDto(storedRow()).measuredAt).toBe('2026-09-14T23:28:55.762Z');
    expect(toCorpusQualitySnapshotDto({ measuredAt: '2026-09-14T23:28:55.762Z' }).measuredAt).toBe(
      '2026-09-14T23:28:55.762Z',
    );
  });

  it('keeps every ratio, so adding a metric to the schema needs one edit here', () => {
    const dto = toCorpusQualitySnapshotDto(storedRow());

    expect(dto.richness.hasResearchWebsite).toEqual({ n: 25, of: 50 });
    expect(dto.description.leadSentenceStatesResearch).toEqual({ n: 24, of: 50 });
    expect(dto.integrity.publicDescriptionInvariantFails).toEqual({ n: 0, of: 50 });
  });

  it('fills a missing ratio with zeros rather than serving undefined', () => {
    const dto = toCorpusQualitySnapshotDto({ measuredAt: new Date(), environment: 'beta' });

    expect(dto.richness.hasTopic).toEqual({ n: 0, of: 0 });
    expect(dto.integrity.publicDescriptionInvariantFails).toEqual({ n: 0, of: 0 });
  });

  it('projects only the fields the mapper reads, so Mongo does not ship the rest', () => {
    expect(Object.keys(CORPUS_QUALITY_SNAPSHOT_DTO_PROJECTION).sort()).toEqual([
      'description',
      'environment',
      'integrity',
      'measuredAt',
      'richness',
    ]);
  });
});
