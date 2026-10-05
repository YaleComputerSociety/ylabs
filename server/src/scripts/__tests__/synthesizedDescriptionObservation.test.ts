import { describe, expect, it, vi } from 'vitest';
import type { CoverageEntityReport } from '../coverageSynthesis';
import type { GrantCorpusEntityReport } from '../grantCorpusSynthesis';
import { appendSynthesizedDescription } from '../synthesizedDescriptionObservation';

const observation = {
  entityType: 'researchEntity' as const,
  entityKey: 'fixture-synthesis-lane',
  field: 'fullDescription',
  value: 'The group develops single-cell sequencing methods for immune cell differentiation.',
  sourceUrl: 'https://example.edu/lab',
};

const context = {
  scrapeRunId: 'run-1',
  sourceId: 'source-1',
  sourceName: 'coverage-synthesis-llm',
  sourceWeight: 0.6,
  dryRun: false,
};

const coverageReport = (): CoverageEntityReport => ({
  slug: 'fixture-synthesis-lane',
  snippets: 1,
  synthesized: true,
  written: false,
});

const grantCorpusReport = (): GrantCorpusEntityReport => ({
  slug: 'fixture-synthesis-lane',
  grants: 1,
  snippets: 1,
  synthesized: true,
  written: false,
  gainedSchool: false,
  wouldPromoteToStudentReady: false,
});

describe('appendSynthesizedDescription (#3727)', () => {
  it.each([
    ['coverage', coverageReport],
    ['grant-corpus', grantCorpusReport],
  ])(
    'does not mark a %s row written when the store refused its observation',
    async (_lane, makeReport) => {
      const report = makeReport();
      const append = vi.fn(async () => ({ inserted: 0 }));

      const stored = await appendSynthesizedDescription(report, observation, context, append);

      expect(stored).toBe(false);
      expect(report.written).toBe(false);
      expect(report.observationDropped).toBe(true);
      expect(append).toHaveBeenCalledWith([observation], context);
    },
  );

  it.each([
    ['coverage', coverageReport],
    ['grant-corpus', grantCorpusReport],
  ])('marks a %s row written once the store kept its observation', async (_lane, makeReport) => {
    const report = makeReport();

    const stored = await appendSynthesizedDescription(report, observation, context, async () => ({
      inserted: 1,
    }));

    expect(stored).toBe(true);
    expect(report.written).toBe(true);
    expect(report.observationDropped).toBeUndefined();
  });
});
