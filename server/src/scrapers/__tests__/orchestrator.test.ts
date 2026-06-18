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

  it('sanitizes scraper failure details before persisting run errors', async () => {
    const scraper: IScraper = {
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run() {
        throw new Error(
          'Failed https://user:pass@example.test/source?access_token=secret-token for ada@example.edu',
        );
      },
    };
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(scraper);

    await expect(
      orchestrator.run('fixture-source', {
        dryRun: false,
        dbReview: false,
        useCache: false,
        release: true,
      }),
    ).rejects.toThrow('Failed https://user:pass@example.test/source');

    const failureUpdate = mocks.scrapeRunUpdateOne.mock.calls.at(-1)?.[1] as {
      $set?: { errors?: Array<{ message?: string; stack?: string }> };
    };
    const persistedError = failureUpdate.$set?.errors?.at(-1);

    expect(persistedError?.message).toContain('https://[credentials-redacted]@example.test');
    expect(persistedError?.message).toContain('access_token=[secret-redacted]');
    expect(persistedError?.message).toContain('[email redacted]');
    expect(persistedError?.message).not.toContain('user:pass');
    expect(persistedError?.message).not.toContain('secret-token');
    expect(persistedError?.message).not.toContain('ada@example.edu');
    expect(persistedError).not.toHaveProperty('stack');
  });

  it('sanitizes scraper log messages and metadata before console output', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const scraper: IScraper = {
      name: 'fixture-source',
      displayName: 'Fixture source',
      async run(ctx) {
        ctx.log('Fetch failed for https://user:pass@example.test?access_token=secret-token', {
          Authorization: 'Bearer source-access-token',
          cookie: 'session=abc123; Path=/; HttpOnly',
          contact: 'ada@example.edu',
        });
        return { observationCount: 0, entitiesObserved: 0 };
      },
    };
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(scraper);

    await orchestrator.run('fixture-source', {
      dryRun: false,
      dbReview: false,
      useCache: false,
      release: true,
    });

    const logged = consoleLog.mock.calls.flat().join(' ');
    expect(logged).toContain('https://[credentials-redacted]@example.test');
    expect(logged).toContain('access_token=[secret-redacted]');
    expect(logged).toContain('Authorization":"[secret-redacted]"');
    expect(logged).toContain('cookie":"[secret-redacted]"');
    expect(logged).toContain('[email redacted]');
    expect(logged).not.toContain('user:pass');
    expect(logged).not.toContain('secret-token');
    expect(logged).not.toContain('source-access-token');
    expect(logged).not.toContain('abc123');
    expect(logged).not.toContain('ada@example.edu');

    consoleLog.mockRestore();
  });
});
