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
    expect(rows[1].nextCommand).toBe(
      'SCRAPER_ENV=beta yarn --cwd server scrape run --source never-run --dry-run --limit 25',
    );
    expect(rows[2].risk).toBe('ok');
  });

  it('ignores invalidated runs and flags materialization errors', () => {
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
          startedAt: '2026-05-13T01:00:00.000Z',
          invalidated: true,
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
    expect(rows[0].nextCommand).toBe(
      "SCRAPER_ENV=beta yarn --cwd server scrape report --run latest --output '/tmp/ylabs-scraper-reports/access-source-latest.json'",
    );
    expect(rows[0].latestRun?.reportCommand).toBe(rows[0].nextCommand);
    expect(rows[0].expectedArtifactTypes).toEqual(['EntryPathway', 'AccessSignal']);
  });

  it('treats resolved materialization conflicts on a successful run as healthy (informational, non-blocking)', () => {
    const rows = buildSourceHealthRows(
      [
        {
          name: 'centers-institutes-index',
          displayName: 'Centers and institutes',
          enabled: true,
          coverage: { priority: 1, artifactTypes: ['ResearchEntity'] },
        },
      ],
      [
        {
          _id: 'conflict-run',
          sourceName: 'centers-institutes-index',
          status: 'success',
          startedAt: '2026-05-13T02:00:00.000Z',
          observationCount: 120,
          materializationConflicts: 37,
        },
      ],
    );

    // Conflicts are resolved cross-source disagreements; the resolver adjudicates them and they
    // are surfaced informationally in reviewSummary. They must not raise source-health risk or
    // block promotion. Only failures / materializationErrors gate.
    expect(rows[0].risk).toBe('ok');
    expect(rows[0].action).toMatch(/conflict/i);
    expect(rows[0].action).toMatch(/non-blocking/i);
  });

  it('treats visibility repair sources without recent scraper runs as healthy manual queues', () => {
    const rows = buildSourceHealthRows(
      [
        {
          name: 'visibility-repair-queue',
          displayName: 'Visibility Repair Queue',
          enabled: true,
          cadence: 'manual-repair',
          coverage: { priority: 1, artifactTypes: ['Observation', 'EntryPathway'] },
        },
      ],
      [],
    );

    expect(rows[0]).toMatchObject({
      risk: 'ok',
      action: expect.stringMatching(/Manual visibility repair queue/i),
    });
    expect(rows[0].nextCommand).toBeUndefined();
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

  it('does not stringify arbitrary run ids while building operator commands', () => {
    const rows = buildSourceHealthRows(
      [
        {
          name: 'unsafe-id-source',
          displayName: 'Unsafe id source',
          enabled: true,
          coverage: { priority: 1, artifactTypes: ['Observation'] },
        },
      ],
      [
        {
          _id: {
            toString: () => {
              throw new Error('source health stringified an arbitrary run id');
            },
            toHexString: () => {
              throw new Error('source health hex-stringified an arbitrary run id');
            },
          },
          sourceName: 'unsafe-id-source',
          status: 'failure',
          startedAt: {
            toString: () => {
              throw new Error('source health parsed an arbitrary startedAt object');
            },
          } as any,
          observationCount: 0,
        },
      ],
    );

    expect(rows[0].latestRun?.id).toBe('');
    expect(rows[0].latestRun?.startedAt).toBeUndefined();
    expect(rows[0].nextCommand).toBeUndefined();
  });

  it('quotes unsafe source names before surfacing operator shell commands', () => {
    const rows = buildSourceHealthRows(
      [
        {
          name: "unsafe-source; touch /tmp/pwned #",
          displayName: 'Unsafe source',
          enabled: true,
          coverage: { priority: 1, artifactTypes: ['Observation'] },
        },
      ],
      [],
    );

    expect(rows[0].nextCommand).toBe(
      "SCRAPER_ENV=beta yarn --cwd server scrape run --source 'unsafe-source; touch /tmp/pwned #' --dry-run --limit 25",
    );
  });
});
