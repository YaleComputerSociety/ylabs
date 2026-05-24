import { describe, expect, it } from 'vitest';
import { buildSourceHealthRows } from '../sourceHealthService';

describe('sourceHealthService', () => {
  it('orders error and warning sources before healthy sources', () => {
    const rows = buildSourceHealthRows(
      [
        {
          name: 'healthy',
          displayName: 'Healthy source',
          enabled: true,
          coverage: { priority: 20, artifactTypes: ['Observation'] },
        },
        {
          name: 'broken',
          displayName: 'Broken source',
          enabled: true,
          coverage: { priority: 10, artifactTypes: ['Observation'] },
        },
        {
          name: 'never-run',
          displayName: 'Never run source',
          enabled: true,
          coverage: { priority: 5, artifactTypes: ['Observation'] },
        },
      ],
      [
        {
          _id: 'run-1',
          sourceName: 'healthy',
          status: 'success',
          startedAt: '2026-05-13T00:00:00.000Z',
          observationCount: 10,
        },
        {
          _id: 'run-2',
          sourceName: 'broken',
          status: 'failure',
          startedAt: '2026-05-13T01:00:00.000Z',
          observationCount: 0,
        },
      ],
    );

    expect(rows.map((row) => row.sourceName)).toEqual(['broken', 'never-run', 'healthy']);
    expect(rows[0].risk).toBe('error');
    expect(rows[0].action).toMatch(/failed/i);
    expect(rows[1].risk).toBe('warn');
    expect(rows[1].action).toMatch(/No recent run/i);
    expect(rows[2].risk).toBe('ok');
  });

  it('ignores invalidated and dry-run runs when choosing latest source health', () => {
    const rows = buildSourceHealthRows(
      [
        {
          name: 'access-source',
          displayName: 'Access source',
          enabled: true,
          coverage: { priority: 1, artifactTypes: ['EntryPathway', 'AccessSignal'] },
        },
      ],
      [
        {
          _id: 'old-invalidated',
          sourceName: 'access-source',
          status: 'failure',
          startedAt: '2026-05-13T03:00:00.000Z',
          invalidated: true,
        },
        {
          _id: 'new-dry-run',
          sourceName: 'access-source',
          status: 'success',
          startedAt: '2026-05-13T04:00:00.000Z',
          observationCount: 0,
          materializationErrors: 0,
          options: { dryRun: true },
        },
        {
          _id: 'latest',
          sourceName: 'access-source',
          status: 'success',
          startedAt: '2026-05-13T02:00:00.000Z',
          observationCount: 12,
          materializationErrors: 2,
        },
      ],
    );

    expect(rows[0].latestRun?.id).toBe('latest');
    expect(rows[0].recentRuns.total).toBe(1);
    expect(rows[0].risk).toBe('error');
    expect(rows[0].action).toMatch(/Materialization errors/i);
    expect(rows[0].expectedArtifactTypes).toEqual(['EntryPathway', 'AccessSignal']);
  });

  it('treats event-driven sources without scraper runs as healthy', () => {
    const rows = buildSourceHealthRows(
      [
        {
          name: 'manual-admin-edit',
          displayName: 'Manual admin edit',
          enabled: true,
          cadence: 'event',
          coverage: { priority: 0, tier: 'MANUAL_OVERRIDE', artifactTypes: ['ResearchEntity'] },
        },
      ],
      [],
    );

    expect(rows[0].risk).toBe('ok');
    expect(rows[0].action).toMatch(/Event-driven source/i);
  });

  it('does not treat resolved materialization conflict counts as source-health warnings', () => {
    const rows = buildSourceHealthRows(
      [
        {
          name: 'roster',
          displayName: 'Roster',
          enabled: true,
          coverage: { priority: 1, artifactTypes: ['ResearchEntity'] },
        },
      ],
      [
        {
          _id: 'resolved-conflicts',
          sourceName: 'roster',
          status: 'success',
          startedAt: '2026-05-13T02:00:00.000Z',
          observationCount: 12,
          materializationConflicts: 32,
          materializationErrors: 0,
        },
      ],
    );

    expect(rows[0].risk).toBe('ok');
    expect(rows[0].action).toMatch(/acceptable/i);
  });
});
