import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../../data-migration/BackfillV4Grants.ts');

async function importGrantBackfill() {
  const originalMongoUrl = process.env.MONGODBURL;
  process.env.MONGODBURL = '';
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  }) as never);

  try {
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

describe('legacy v4 grant backfill safety helpers', () => {
  it('imports without running the migration CLI path', async () => {
    const mod = await importGrantBackfill();

    expect(typeof mod.backfillV4Grants).toBe('function');
  });

  it('normalizes known grant agencies conservatively', async () => {
    const { normalizeAgency } = await importGrantBackfill();

    expect(normalizeAgency('NIH/NIGMS')).toBe('NIH');
    expect(normalizeAgency('National Science Foundation')).toBe('NSF');
    expect(normalizeAgency('Department of Defense')).toBe('DOD');
    expect(normalizeAgency('Private Foundation')).toBe('other');
  });

  it('wraps saved grant backfill artifacts with target metadata and parsed options', async () => {
    const { buildV4GrantBackfillOutput } = await importGrantBackfill();

    const output = buildV4GrantBackfillOutput(
      {
        groupsScanned: 2,
        grantsSeen: 3,
        grantsUpserted: 0,
        groupsUpdated: 0,
      },
      {
        generatedAt: '2026-06-02T12:00:00.000Z',
        environment: 'beta',
        db: 'Beta',
        options: { apply: false, limit: 2, output: '/tmp/v4-grants.json' },
      },
    );

    expect(output).toEqual({
      generatedAt: '2026-06-02T12:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, limit: 2, output: '/tmp/v4-grants.json' },
      groupsScanned: 2,
      grantsSeen: 3,
      grantsUpserted: 0,
      groupsUpdated: 0,
    });
  });
});
