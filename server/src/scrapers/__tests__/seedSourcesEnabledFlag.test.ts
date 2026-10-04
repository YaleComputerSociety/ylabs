import { beforeEach, describe, expect, it, vi } from 'vitest';

const sourceModel = vi.hoisted(() => ({
  storedRows: new Map<string, Record<string, unknown>>(),
  writes: [] as Array<{ name: string; enabled: unknown }>,
}));

vi.mock('../../models/source', () => ({
  Source: {
    findOne: vi.fn(({ name }: { name: string }) => ({
      lean: async () => sourceModel.storedRows.get(name) ?? null,
    })),
    updateOne: vi.fn(
      async ({ name }: { name: string }, update: { $set: { enabled?: unknown } }) => {
        sourceModel.writes.push({ name, enabled: update.$set.enabled });
      },
    ),
    create: vi.fn(async (row: { name: string; enabled?: unknown }) => {
      sourceModel.writes.push({ name: row.name, enabled: row.enabled });
    }),
    replaceOne: vi.fn(async ({ name }: { name: string }, row: { enabled?: unknown }) => {
      sourceModel.writes.push({ name, enabled: row.enabled });
    }),
    countDocuments: vi.fn(async () => 0),
    updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
  },
}));

import { ACTIVE_SOURCE_NAMES, seedSources } from '../seedSources';
import { isRetiredSourceName } from '../sourceDispatch';
import { MANUAL_ONLY_SWEEP_SOURCES } from '../manualOnlySweepSources';
import { FELLOWSHIP_SWEEP_SOURCES, RESEARCH_SWEEP_SOURCES } from '../../scripts/runScraperSweep';

const SWEEP_LISTED_SOURCE_NAMES = [
  ...RESEARCH_SWEEP_SOURCES.map((source) => source.name),
  ...FELLOWSHIP_SWEEP_SOURCES.map((source) => source.name),
  ...MANUAL_ONLY_SWEEP_SOURCES,
];

const APPLY = { apply: true, confirmSeedApply: true, reset: false };

function writtenEnabledByName(): Map<string, unknown> {
  return new Map(sourceModel.writes.map((write) => [write.name, write.enabled]));
}

describe('seedSources derives enabled from retirement (#4025)', () => {
  beforeEach(() => {
    sourceModel.storedRows.clear();
    sourceModel.writes.length = 0;
  });

  it('seeds every sweep-listed and manual-only source as a row the sweep can run', () => {
    for (const name of SWEEP_LISTED_SOURCE_NAMES) {
      expect(ACTIVE_SOURCE_NAMES, name).toContain(name);
      expect(isRetiredSourceName(name), name).toBe(false);
    }
  });

  it('writes enabled = not retired on create for every seed', async () => {
    await seedSources(APPLY);
    const written = writtenEnabledByName();

    expect(written.size).toBe(ACTIVE_SOURCE_NAMES.length);
    for (const name of ACTIVE_SOURCE_NAMES) {
      expect(written.get(name), name).toBe(!isRetiredSourceName(name));
    }
    for (const name of SWEEP_LISTED_SOURCE_NAMES) {
      expect(written.get(name), name).toBe(true);
    }
  });

  it('rewrites a stored disabled flag on update, so a stale row cannot keep a live source disabled', async () => {
    for (const name of ACTIVE_SOURCE_NAMES) {
      sourceModel.storedRows.set(name, { name, enabled: false });
    }

    const report = await seedSources(APPLY);
    const written = writtenEnabledByName();

    for (const name of ACTIVE_SOURCE_NAMES) {
      expect(written.get(name), name).toBe(!isRetiredSourceName(name));
    }
    for (const name of SWEEP_LISTED_SOURCE_NAMES) {
      expect(written.get(name), name).toBe(true);
    }
    for (const row of report.sources) {
      expect(row.changedFields, row.name).toContain('enabled');
    }
  });

  it('writes enabled = not retired when a reset replaces every row', async () => {
    await seedSources({ ...APPLY, reset: true });
    const written = writtenEnabledByName();

    for (const name of ACTIVE_SOURCE_NAMES) {
      expect(written.get(name), name).toBe(!isRetiredSourceName(name));
    }
  });

  it('reports no planned enabled change for a row that already matches retirement', async () => {
    for (const name of ACTIVE_SOURCE_NAMES) {
      sourceModel.storedRows.set(name, { name, enabled: true });
    }

    const report = await seedSources({ ...APPLY, apply: false });

    expect(sourceModel.writes).toEqual([]);
    for (const row of report.sources) {
      expect(row.changedFields, row.name).not.toContain('enabled');
    }
  });
});
