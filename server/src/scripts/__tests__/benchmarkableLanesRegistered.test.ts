import { describe, expect, it } from 'vitest';
import { buildOrchestrator } from '../../scrapers/registry';
import { BENCHMARKABLE_LANES, SOURCE_CONCURRENCY_LANES } from '../laneBenchmarkRun';

describe('benchmarkable lanes', () => {
  it('names only lanes the orchestrator registers, so every admitted lane can be captured and replayed', () => {
    const registered = new Set(
      buildOrchestrator()
        .list()
        .map((scraper) => scraper.name),
    );
    expect([...BENCHMARKABLE_LANES].filter((lane) => !registered.has(lane))).toEqual([]);
    expect([...SOURCE_CONCURRENCY_LANES].filter((lane) => !BENCHMARKABLE_LANES.has(lane))).toEqual(
      [],
    );
  });
});
