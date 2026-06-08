import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function importV4Backfill(relativePath: string) {
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

describe('legacy v4 identity backfill safety helpers', () => {
  it('imports faculty member backfill without running the CLI path', async () => {
    const mod = await importV4Backfill('BackfillV4FacultyMembers.ts');

    expect(typeof mod.backfillV4FacultyMembers).toBe('function');
  });

  it('imports student profile backfill without running the CLI path', async () => {
    const mod = await importV4Backfill('BackfillV4StudentProfiles.ts');

    expect(typeof mod.backfillV4StudentProfiles).toBe('function');
  });

  it('imports research group member backfill without running the CLI path', async () => {
    const mod = await importV4Backfill('BackfillV4ResearchGroupMembers.ts');

    expect(typeof mod.backfillV4ResearchGroupMembers).toBe('function');
  });
});
