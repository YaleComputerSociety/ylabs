import { describe, expect, it } from 'vitest';
import {
  buildCorpusQualityReport,
  type CorpusQualityServedRowFacts,
} from '../corpusQualityReportCore';

const row = (
  overrides: Partial<CorpusQualityServedRowFacts> = {},
): CorpusQualityServedRowFacts => ({
  school: 'School of Medicine',
  hasResearchWebsite: true,
  hasTopic: true,
  hasSourceUrl: true,
  topicCount: 4,
  fullDescriptionUseful: true,
  shortDescriptionUseful: true,
  leadSentenceStatesResearch: true,
  shortDescriptionIsAreaEchoOnly: false,
  nameIsGenericFacultyResearchTitle: false,
  publicDescriptionInvariantPasses: true,
  ...overrides,
});

const corpus = {
  entities: 10,
  archived: 2,
  studentReady: 4,
  byTier: [{ tier: 'student_ready', count: 4 }],
};

describe('buildCorpusQualityReport', () => {
  it('reports every metric as a numerator over the served denominator', () => {
    const report = buildCorpusQualityReport({
      facts: [row(), row({ hasResearchWebsite: false }), row({ hasResearchWebsite: false })],
      corpus,
    });

    expect(report.richness.hasResearchWebsite).toEqual({ n: 1, of: 3 });
    expect(report.description.leadSentenceStatesResearch).toEqual({ n: 3, of: 3 });
  });

  it('counts a row with neither a research home nor an area as a dead end', () => {
    const report = buildCorpusQualityReport({
      facts: [
        row({ hasResearchWebsite: false, hasTopic: false, topicCount: 0 }),
        row({ hasResearchWebsite: false, hasTopic: true }),
        row(),
      ],
      corpus,
    });

    expect(report.richness.noResearchWebsiteAndNoTopics).toEqual({ n: 1, of: 3 });
  });

  it('reports research areas as a total over rows so a mean can be derived with its denominator', () => {
    const report = buildCorpusQualityReport({
      facts: [row({ topicCount: 5 }), row({ topicCount: 1 })],
      corpus,
    });

    expect(report.richness.topicTotal).toEqual({ n: 6, of: 2 });
  });

  it('counts invariant failures rather than passes so a rise always reads as worse', () => {
    const report = buildCorpusQualityReport({
      facts: [row(), row({ publicDescriptionInvariantPasses: false })],
      corpus,
    });

    expect(report.integrity.publicDescriptionInvariantFails).toEqual({ n: 1, of: 2 });
  });

  it('groups served rows by school, largest first, and names a blank school', () => {
    const report = buildCorpusQualityReport({
      facts: [
        row({ school: 'School of Medicine' }),
        row({ school: 'School of Medicine' }),
        row({ school: 'Divinity School' }),
        row({ school: '  ' }),
      ],
      corpus,
    });

    expect(report.coverage.studentReadyBySchool).toEqual([
      { school: 'School of Medicine', count: 2 },
      { school: 'Divinity School', count: 1 },
      { school: 'unknown', count: 1 },
    ]);
  });

  it('does not divide by zero when no row is served', () => {
    const report = buildCorpusQualityReport({
      facts: [],
      corpus: { entities: 3, archived: 3, studentReady: 0, byTier: [] },
    });

    expect(report.richness.hasResearchWebsite).toEqual({ n: 0, of: 0 });
    expect(report.coverage.studentReadyBySchool).toEqual([]);
  });
});
