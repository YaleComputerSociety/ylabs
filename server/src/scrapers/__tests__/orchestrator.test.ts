import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IScraper } from '../types';

const mocks = vi.hoisted(() => ({
  scrapeRunCreate: vi.fn(),
  scrapeRunUpdateOne: vi.fn(),
  getSourceByName: vi.fn(),
  appendObservations: vi.fn(),
  buildEvidenceCoverageImpactReportForObservations: vi.fn(),
}));

vi.mock('../../models/scrapeRun', () => ({
  ScrapeRun: {
    create: mocks.scrapeRunCreate,
    updateOne: mocks.scrapeRunUpdateOne,
  },
}));

vi.mock('../observationStore', () => ({
  getSourceByName: mocks.getSourceByName,
  appendObservations: mocks.appendObservations,
}));

vi.mock('../../services/researchEntityEvidenceCoverage', () => ({
  buildEvidenceCoverageImpactReportForObservations:
    mocks.buildEvidenceCoverageImpactReportForObservations,
}));

import { ScraperOrchestrator } from '../orchestrator';

describe('ScraperOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scrapeRunCreate.mockResolvedValue({ _id: 'run-1' });
    mocks.scrapeRunUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    mocks.getSourceByName.mockResolvedValue({
      _id: 'source-1',
      name: 'fixture-source',
      defaultWeight: 0.8,
    });
    mocks.appendObservations.mockResolvedValue({ inserted: 0, skipped: 2, superseded: 0 });
    mocks.buildEvidenceCoverageImpactReportForObservations.mockResolvedValue({
      assessed: 0,
      improved: 0,
      rows: [],
    });
  });

  it('persists dry-run emitted observation counts even when observations are not inserted', async () => {
    const scraper: IScraper = {
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run(ctx) {
        await ctx.emit([
          {
            entityType: 'researchEntity',
            entityKey: 'fixture-lab',
            field: 'shortDescription',
            value: 'Fixture lab studies source-backed research.',
          },
          {
            entityType: 'researchEntity',
            entityKey: 'fixture-lab',
            field: 'accessEvidence',
            value: { type: 'EXPLORATORY_CONTACT' },
          },
        ]);
        return { observationCount: 2, entitiesObserved: 1 };
      },
    };
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(scraper);

    const result = await orchestrator.run('fixture-source', {
      dryRun: true,
      dbReview: true,
      useCache: false,
      release: false,
    });

    expect(result.runId).toBe('run-1');
    expect(mocks.appendObservations).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ dryRun: true }),
    );
    expect(mocks.scrapeRunUpdateOne).toHaveBeenCalledWith(
      { _id: 'run-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'success',
          observationCount: 2,
          entitiesObserved: 1,
        }),
      }),
    );
  });
});
