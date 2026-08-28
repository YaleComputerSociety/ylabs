import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function importDeprecatedV4Backfill(relativePath: string) {
  const originalMongoUrl = process.env.MONGODBURL;
  process.env.MONGODBURL = '';
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  }) as never);

  try {
    const modulePath = path.resolve(__dirname, '../../../../data-migration', relativePath);
    return await import(pathToFileURL(modulePath).href);
  } finally {
    exitSpy.mockRestore();
    if (originalMongoUrl === undefined) {
      delete process.env.MONGODBURL;
    } else {
      process.env.MONGODBURL = originalMongoUrl;
    }
  }
}

describe('deprecated v4 backfill safety helpers', () => {
  it('imports the removed PaperGroupLink backfill without loading deleted models', async () => {
    const mod = await importDeprecatedV4Backfill('BackfillV4PaperGraph.ts');

    expect(typeof mod.buildV4PaperGraphBlockedOutput).toBe('function');
    expect(typeof mod.backfillV4PaperGraph).toBe('function');
  });

  it('imports the removed ResearchGroupStats backfill without loading deleted models', async () => {
    const mod = await importDeprecatedV4Backfill('BackfillV4ResearchGroupStats.ts');

    expect(typeof mod.buildV4ResearchGroupStatsBlockedOutput).toBe('function');
    expect(typeof mod.backfillV4ResearchGroupStats).toBe('function');
  });

  it('returns a structured blocked artifact for the removed paper graph surface', async () => {
    const { buildV4PaperGraphBlockedOutput } = await importDeprecatedV4Backfill(
      'BackfillV4PaperGraph.ts',
    );

    const output = buildV4PaperGraphBlockedOutput({
      generatedAt: '2026-06-02T12:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, limit: 10, output: '/tmp/v4-paper-graph.json' },
    });

    expect(output).toMatchObject({
      generatedAt: '2026-06-02T12:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, limit: 10, output: '/tmp/v4-paper-graph.json' },
      status: 'blocked',
      deprecatedSurface: 'PaperGroupLink',
      requiresNewImplementation: true,
    });
    expect(output.blockedReason).toMatch(/PaperGroupLink/);
  });

  it('returns a structured blocked artifact for the removed stats surface', async () => {
    const { buildV4ResearchGroupStatsBlockedOutput } = await importDeprecatedV4Backfill(
      'BackfillV4ResearchGroupStats.ts',
    );

    const output = buildV4ResearchGroupStatsBlockedOutput({
      generatedAt: '2026-06-02T12:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, limit: 10, output: '/tmp/v4-stats.json' },
    });

    expect(output).toMatchObject({
      generatedAt: '2026-06-02T12:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, limit: 10, output: '/tmp/v4-stats.json' },
      status: 'blocked',
      deprecatedSurface: 'ResearchGroupStats',
      requiresNewImplementation: true,
    });
    expect(output.blockedReason).toMatch(/ResearchGroupStats/);
  });
});
