import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import CorpusQualityPanel from '../CorpusQualityPanel';
import type { CorpusQualityResponse, CorpusQualitySnapshotRow } from '../corpusQualityTypes';

const measurement = (measuredAt: string, served: number): CorpusQualitySnapshotRow => ({
  measuredAt,
  environment: 'development',
  richness: {
    hasResearchWebsite: { n: 40, of: 100 },
    hasTopic: { n: served, of: 100 },
    hasSourceUrl: { n: 100, of: 100 },
    topicTotal: { n: 250, of: 100 },
    noResearchWebsiteAndNoTopics: { n: 100 - served, of: 100 },
  },
  description: {
    fullDescriptionUseful: { n: 90, of: 100 },
    shortDescriptionUseful: { n: 90, of: 100 },
    leadSentenceStatesResearch: { n: 70, of: 100 },
    shortDescriptionIsAreaEchoOnly: { n: 5, of: 100 },
    nameIsGenericFacultyResearchTitle: { n: 10, of: 100 },
  },
  integrity: { publicDescriptionInvariantFails: { n: 0, of: 100 } },
});

const storedRichness = {
  hasResearchWebsite: { n: 41, of: 100 },
  hasSourceUrl: { n: 100, of: 100 },
  hasTopic: { n: 99, of: 100 },
  topicTotal: { n: 400, of: 100 },
  noResearchWebsiteAndNoTopics: { n: 1, of: 100 },
};

const response = (): CorpusQualityResponse => {
  const latest = measurement('2026-09-29T08:00:00.000Z', 88);
  return {
    live: {
      computedAt: '2026-09-30T08:00:00.000Z',
      coverage: {
        entities: 120,
        archived: 5,
        studentReady: 100,
        byTier: [],
        studentReadyBySchool: [],
      },
      richness: storedRichness,
      description: { nameIsGenericFacultyResearchTitle: { n: 10, of: 100 } },
    },
    latest,
    history: [measurement('2026-09-28T08:00:00.000Z', 80), latest],
    snapshotOnlyMetrics: [
      'leadSentenceStatesResearch',
      'shortDescriptionIsAreaEchoOnly',
      'publicDescriptionInvariantFails',
      'hasTopic',
      'topicTotal',
      'noResearchWebsiteAndNoTopics',
    ],
    measurementCollection: 'corpus_quality_snapshots',
    refreshCommand: 'yarn --cwd server corpus:snapshot',
  };
};

const metricRow = (label: string) => screen.getByText(label).closest('.flex') as HTMLElement;

afterEach(() => {
  cleanup();
});

describe('CorpusQualityPanel', () => {
  it('shows the served topic measurement with the measured tag, not the stored live count', () => {
    render(<CorpusQualityPanel corpusQuality={response()} isLoading={false} error={null} />);

    const topics = metricRow('Has topics');
    expect(topics.textContent).toContain('88 / 100 (88%)');
    expect(topics.textContent).not.toContain('99 / 100');
    expect(topics.textContent).toContain('measured');

    const deadEnds = metricRow('No website and no topics');
    expect(deadEnds.textContent).toContain('12 / 100 (12%)');
    expect(deadEnds.textContent).toContain('measured');

    expect(screen.getByText(/Topics served average 2\.5 per row\./)).toBeTruthy();
    expect(screen.queryByText(/4\.0 per row/)).toBeNull();
  });

  it('keeps an aggregatable row live and untagged', () => {
    render(<CorpusQualityPanel corpusQuality={response()} isLoading={false} error={null} />);

    const website = metricRow('Has a research website');
    expect(website.textContent).toContain('41 / 100 (41%)');
    expect(website.textContent).not.toContain('measured');
  });
});
