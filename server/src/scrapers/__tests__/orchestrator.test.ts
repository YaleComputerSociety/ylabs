import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScraperOrchestrator } from '../orchestrator';
import { ScrapeRun } from '../../models/scrapeRun';
import { appendObservations, getSourceByName } from '../observationStore';
import type { IScraper } from '../types';

vi.mock('../../models/scrapeRun', () => ({
  ScrapeRun: {
    create: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock('../observationStore', () => ({
  appendObservations: vi.fn(),
  getSourceByName: vi.fn(),
}));

describe('ScraperOrchestrator', () => {
  beforeEach(() => {
    vi.mocked(ScrapeRun.create).mockReset();
    vi.mocked(ScrapeRun.updateOne).mockReset();
    vi.mocked(getSourceByName).mockReset();
    vi.mocked(appendObservations).mockReset();
  });

  it('counts dry-run emitted observations even though the store skips persistence', async () => {
    vi.mocked(getSourceByName).mockResolvedValue({
      _id: 'source-1',
      name: 'test-source',
      defaultWeight: 0.7,
    });
    vi.mocked(ScrapeRun.create).mockResolvedValue({ _id: 'run-1' } as never);
    vi.mocked(appendObservations).mockResolvedValue({
      inserted: 0,
      skipped: 2,
      superseded: 0,
    });

    const scraper: IScraper = {
      name: 'test-source',
      displayName: 'Test Source',
      run: async (ctx) => {
        await ctx.emit([
          {
            entityType: 'researchEntity',
            entityKey: 'smith-lab',
            field: 'name',
            value: 'Smith Lab',
          },
          {
            entityType: 'researchEntity',
            entityKey: 'smith-lab',
            field: 'websiteUrl',
            value: 'https://smith.example.edu',
          },
        ]);
        return { observationCount: 2, entitiesObserved: 1 };
      },
    };

    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(scraper);

    await orchestrator.run('test-source', {
      dryRun: true,
      useCache: false,
      release: false,
    });

    expect(ScrapeRun.updateOne).toHaveBeenCalledWith(
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

  it('uses the scraper-reported entity count when observations include supporting artifact keys', async () => {
    vi.mocked(getSourceByName).mockResolvedValue({
      _id: 'source-1',
      name: 'supporting-artifacts',
      defaultWeight: 0.7,
    });
    vi.mocked(ScrapeRun.create).mockResolvedValue({ _id: 'run-1' } as never);
    vi.mocked(appendObservations).mockResolvedValue({
      inserted: 0,
      skipped: 2,
      superseded: 0,
    });

    const scraper: IScraper = {
      name: 'supporting-artifacts',
      displayName: 'Supporting Artifacts',
      run: async (ctx) => {
        await ctx.emit([
          {
            entityType: 'researchEntity',
            entityKey: 'center-one',
            field: 'name',
            value: 'Center One',
          },
          {
            entityType: 'researchGroupMember',
            entityKey: 'center-one:jane-doe',
            field: 'researchGroupKey',
            value: 'center-one',
          },
        ]);
        return { observationCount: 2, entitiesObserved: 1 };
      },
    };

    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(scraper);

    await orchestrator.run('supporting-artifacts', {
      dryRun: true,
      useCache: false,
      release: false,
    });

    expect(ScrapeRun.updateOne).toHaveBeenCalledWith(
      { _id: 'run-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          observationCount: 2,
          entitiesObserved: 1,
        }),
      }),
    );
  });
});
