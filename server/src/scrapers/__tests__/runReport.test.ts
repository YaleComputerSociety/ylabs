import { describe, it, expect } from 'vitest';
import { buildScrapeRunReport } from '../runReport';

describe('buildScrapeRunReport', () => {
  it('summarizes observations and materialization counters', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-1',
        sourceName: 'openalex',
        status: 'success',
        triggeredBy: 'cli',
        startedAt: new Date('2026-05-01T10:00:00Z'),
        finishedAt: new Date('2026-05-01T10:01:30Z'),
        entitiesCreated: 2,
        entitiesUpdated: 3,
        entitiesArchived: 0,
        options: { useCache: true },
      },
      [
        {
          entityType: 'paper',
          entityKey: 'W1',
          field: 'title',
          value: 'Paper One',
          sourceUrl: 'https://openalex.org/W1',
        },
        {
          entityType: 'paper',
          entityKey: 'W1',
          field: 'citedByCount',
          value: 12,
          sourceUrl: 'https://openalex.org/W1',
        },
        {
          entityType: 'researchGroup',
          entityKey: 'smith-lab',
          field: 'recentPaperCount',
          value: 1,
          sourceUrl: 'https://openalex.org/W1',
        },
      ],
    );

    expect(report.run.id).toBe('run-1');
    expect(report.run.durationSeconds).toBe(90);
    expect(report.observations.total).toBe(3);
    expect(report.observations.active).toBe(3);
    expect(report.observations.superseded).toBe(0);
    expect(report.observations.duplicateRate).toBe(0);
    expect(report.observations.entitiesObserved).toBe(2);
    expect(report.observations.byEntityType).toEqual({ paper: 2, researchGroup: 1 });
    expect(report.observations.topFields[0]).toEqual({ field: 'citedByCount', count: 1 });
    expect(report.materialization).toEqual({
      created: 2,
      updated: 3,
      archived: 0,
      skipped: 0,
      conflicts: 0,
      errors: 0,
    });
    expect(report.warnings).toEqual([]);
  });

  it('flags conflict candidates and malformed observations', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-2',
        sourceName: 'lab-microsite-undergrad-llm',
        status: 'partial',
        errors: [{ message: 'one page failed', at: '2026-05-01T12:00:00Z' }],
      },
      [
        {
          entityType: 'researchGroup',
          entityKey: 'smith-lab',
          field: 'acceptingUndergrads',
          value: true,
        },
        {
          entityType: 'researchGroup',
          entityKey: 'smith-lab',
          field: 'acceptingUndergrads',
          value: false,
          confidence: 0.2,
          superseded: true,
        },
        {
          entityType: 'researchGroup',
          field: 'name',
          value: 'Missing Key Lab',
        },
      ],
    );

    expect(report.quality.conflictCandidateCount).toBe(1);
    expect(report.quality.conflictCandidates[0]).toMatchObject({
      entityType: 'researchGroup',
      entity: 'smith-lab',
      field: 'acceptingUndergrads',
      distinctValues: 2,
    });
    expect(report.quality.missingEntityIdentifierCount).toBe(1);
    expect(report.quality.missingSourceUrlCount).toBe(3);
    expect(report.quality.lowConfidenceCount).toBe(1);
    expect(report.observations.superseded).toBe(1);
    expect(report.observations.duplicateRate).toBe(1 / 3);
    expect(report.errors).toEqual([
      { message: 'one page failed', at: '2026-05-01T12:00:00.000Z', context: undefined },
    ]);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        'Run completed partially; inspect source-level logs/errors.',
        '1 observation(s) lack entityId/entityKey.',
        '1 entity-field conflict candidate(s) found within this run.',
        '1 duplicate observation(s) superseded in this run.',
      ]),
    );
  });

  it('warns on failed zero-observation runs and fills default counters', () => {
    const report = buildScrapeRunReport(
      {
        _id: 'run-3',
        sourceName: 'nih-reporter',
        status: 'failure',
        startedAt: '2026-05-01T12:00:00Z',
        finishedAt: undefined,
        invalidated: true,
        errors: [
          {
            message: 'Fetch failed',
            context: { url: 'https://example.test/feed' },
            at: '2026-05-01T12:01:00Z',
          },
          {},
        ],
      },
      [],
    );

    expect(report.run.durationSeconds).toBeUndefined();
    expect(report.run.invalidated).toBe(true);
    expect(report.observations.total).toBe(0);
    expect(report.observations.entitiesObserved).toBe(0);
    expect(report.materialization).toEqual({
      created: 0,
      updated: 0,
      archived: 0,
      skipped: 0,
      conflicts: 0,
      errors: 0,
    });
    expect(report.warnings).toEqual([
      'Run failed; do not materialize without inspecting errors.',
      'Run has been invalidated.',
      'Run produced zero observations.',
    ]);
    expect(report.errors).toEqual([
      {
        message: 'Fetch failed',
        at: '2026-05-01T12:01:00.000Z',
        context: { url: 'https://example.test/feed' },
      },
      { message: 'Unknown scrape error', at: undefined, context: undefined },
    ]);
  });
});
