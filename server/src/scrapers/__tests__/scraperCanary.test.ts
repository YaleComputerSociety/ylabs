import { describe, expect, it } from 'vitest';
import { runScraperCanary, isScraperCanaryReport } from '../scraperCanary';
import { MongoWriteRefusedError } from '../utils/mongoWriteRefusal';
import type { IScraper, ScraperContext } from '../types';

const source = { _id: '64b000000000000000000001', name: 'fixture-lane', defaultWeight: 0.5 };

function scraperThat(run: (ctx: ScraperContext) => Promise<void>): IScraper {
  return {
    name: 'fixture-lane',
    displayName: 'Fixture lane',
    run: async (ctx) => {
      await run(ctx);
      return { observationCount: 0, entitiesObserved: 0 };
    },
  };
}

const noPriorRuns = async () => [];
const barrenPriorRuns = async () => [
  { status: 'failure', observationCount: 0 },
  { status: 'success', observationCount: 0 },
];

describe('runScraperCanary', () => {
  it('runs the lane as a bounded dry run and passes when it emits', async () => {
    let seen: ScraperContext['options'] | undefined;
    const report = await runScraperCanary({
      scraper: scraperThat(async (ctx) => {
        seen = ctx.options;
        await ctx.emit([
          { entityType: 'researchEntity', entityKey: 'a', field: 'name', value: 'A' },
          { entityType: 'researchEntity', entityKey: 'a', field: 'websiteUrl', value: 'https://a' },
        ] as never);
        await ctx.emit({
          entityType: 'researchEntity',
          entityKey: 'b',
          field: 'name',
          value: 'B',
        } as never);
      }),
      source,
      limit: 5,
      readPriorRuns: noPriorRuns,
      log: () => {},
    });
    expect(seen).toMatchObject({
      dryRun: true,
      useCache: false,
      limit: 5,
      ignoreWorkPlanner: true,
    });
    expect(report).toMatchObject({ verdict: 'passed', observationCount: 3, entitiesObserved: 2 });
    expect(isScraperCanaryReport(report)).toBe(true);
  });

  it('fails a lane that throws', async () => {
    const report = await runScraperCanary({
      scraper: scraperThat(async () => {
        throw new Error('selector .faculty-card matched nothing');
      }),
      source,
      readPriorRuns: noPriorRuns,
      log: () => {},
    });
    expect(report.verdict).toBe('failed');
    expect(report.reason).toContain('selector .faculty-card matched nothing');
  });

  it('calls a lane that writes outside emit inconclusive rather than broken', async () => {
    const report = await runScraperCanary({
      scraper: scraperThat(async () => {
        throw new MongoWriteRefusedError('collection.updateOne');
      }),
      source,
      readPriorRuns: noPriorRuns,
      refusedWrites: () => ['collection.updateOne'],
      log: () => {},
    });
    expect(report).toMatchObject({
      verdict: 'inconclusive',
      refusedWrites: ['collection.updateOne'],
    });
  });

  it('predicts the barren-streak failure when a silent lane was already barren', async () => {
    const report = await runScraperCanary({
      scraper: scraperThat(async () => {}),
      source,
      readPriorRuns: barrenPriorRuns,
      log: () => {},
    });
    expect(report.verdict).toBe('failed');
    expect(report.reason).toContain('barren-streak guard');
  });

  it('does not fail a silent lane whose history is productive', async () => {
    const report = await runScraperCanary({
      scraper: scraperThat(async () => {}),
      source,
      readPriorRuns: async () => [{ status: 'success', observationCount: 40 }],
      log: () => {},
    });
    expect(report.verdict).toBe('inconclusive');
  });

  it('does not fail a silent lane whose planner skipped every target, as the real run would not', async () => {
    const report = await runScraperCanary({
      scraper: {
        name: 'fixture-lane',
        displayName: 'Fixture lane',
        run: async () => ({
          observationCount: 0,
          entitiesObserved: 0,
          metrics: {
            workPlanner: { planned: 5, fetched: 0, skippedManualLock: 3, skippedNoIdentifier: 2 },
          } as never,
        }),
      },
      source,
      readPriorRuns: barrenPriorRuns,
      log: () => {},
    });
    expect(report.verdict).toBe('inconclusive');
  });

  it('forwards forceLlm to the lane so content-hash gated lanes re-extract', async () => {
    let seen: ScraperContext['options'] | undefined;
    await runScraperCanary({
      scraper: scraperThat(async (ctx) => {
        seen = ctx.options;
      }),
      source,
      forceLlm: true,
      readPriorRuns: noPriorRuns,
      log: () => {},
    });
    expect(seen?.forceLlm).toBe(true);
    expect(seen?.dryRun).toBe(true);
  });
});
