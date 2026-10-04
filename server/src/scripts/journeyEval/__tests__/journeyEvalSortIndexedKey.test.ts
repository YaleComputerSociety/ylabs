import { describe, expect, it } from 'vitest';
import { journeyCases, type JourneyCase, type JourneyEvalContext } from '../journeyEvalCases';
import type { CorpusFingerprint } from '../journeyEvalMetrics';
import { researchEntitySortTitle } from '../../../utils/servedResearchEntityTitle';

const settledAt = '2026-09-01T00:00:00.000Z';
const steadyCorpus: CorpusFingerprint = { rowCount: 2, latestUpdatedAt: settledAt };

const sortedCase = journeyCases.find((candidate) => candidate.id === 'sorted-browse-keeps-order')!;
const titleCase = journeyCases.find(
  (candidate) => candidate.id === 'title-sorted-browse-follows-card-title',
)!;

interface SortedRow {
  slug: string;
  name: string;
  servedName?: string;
  lastObservedAt: string;
  indexed: Record<string, unknown>;
  updatedAt?: string;
}

const storedRow = (row: SortedRow, index: number) => ({
  _id: `00000000000000000000000${index}`,
  slug: row.slug,
  name: row.name,
  lastObservedAt: new Date(row.lastObservedAt),
  updatedAt: new Date(row.updatedAt ?? settledAt),
});

const contextServing = (rows: SortedRow[]): JourneyEvalContext => ({
  browse: async () => ({
    degraded: false,
    researchEntities: rows.map((row) => ({
      slug: row.slug,
      name: row.servedName ?? row.name,
      lastObservedAt: row.lastObservedAt,
    })),
  }),
  readStoredRows: async (keys) =>
    new Map(
      rows.flatMap((row, index) =>
        keys.includes(row.slug) ? [[row.slug, storedRow(row, index)] as const] : [],
      ),
    ),
  readIndexedSortKeys: async (sortAttribute, keys) =>
    new Map(
      rows
        .filter((row) => keys.includes(row.slug) && sortAttribute in row.indexed)
        .map((row) => [row.slug, row.indexed[sortAttribute]]),
    ),
  readCorpusFingerprint: async () => steadyCorpus,
  readOwnedSlotSurvivorWebsites: async () => ({ survivorsScanned: 0, observations: [] }),
  topicQueryJudgements: null,
  window: rows.length,
  facetValuesChecked: 0,
  pagesChecked: 1,
});

const invariantsOf = async (testCase: JourneyCase, rows: SortedRow[]) => {
  const outcome = await testCase.run(contextServing(rows));
  return Object.fromEntries(outcome.invariants.map((invariant) => [invariant.id, invariant]));
};

describe('sorted browse cases check the index holds the sort key the stored row derives', () => {
  it('passes when every served row is indexed with its current sort key', async () => {
    const byId = await invariantsOf(sortedCase, [
      {
        slug: 'row-a',
        name: 'Synthetic Alpha Lab',
        lastObservedAt: '2026-09-02T00:00:00.000Z',
        indexed: { lastObservedAt: '2026-09-02T00:00:00.000Z' },
      },
      {
        slug: 'row-b',
        name: 'Synthetic Beta Lab',
        lastObservedAt: '2026-09-01T00:00:00.000Z',
        indexed: { lastObservedAt: '2026-09-01T00:00:00.000Z' },
      },
    ]);

    expect(byId['sort-desc-is-ordered'].status).toBe('pass');
    expect(byId['indexed-sort-key-is-fresh']).toMatchObject({
      status: 'pass',
      detail: { sortAttribute: 'lastObservedAt', compared: 2, stale: 0 },
    });
  });

  it('fails and names the stale index when a row sorts on an older indexed value than it stores', async () => {
    const byId = await invariantsOf(sortedCase, [
      {
        slug: 'row-a',
        name: 'Synthetic Alpha Lab',
        lastObservedAt: '2026-09-02T00:00:00.000Z',
        indexed: { lastObservedAt: '2026-09-02T00:00:00.000Z' },
      },
      {
        slug: 'row-stale',
        name: 'Synthetic Stale Lab',
        lastObservedAt: '2026-09-03T00:00:00.000Z',
        indexed: { lastObservedAt: '2026-09-01T12:00:00.000Z' },
      },
    ]);

    expect(byId['sort-desc-is-ordered'].status).toBe('fail');
    expect(byId['indexed-sort-key-is-fresh']).toMatchObject({
      status: 'fail',
      detail: { sortAttribute: 'lastObservedAt', compared: 2, stale: 1 },
    });
    expect(String(byId['indexed-sort-key-is-fresh'].detail.remedy)).toMatch(/rebuild/);
  });

  it('does not count a row written while the browse was read', async () => {
    const byId = await invariantsOf(sortedCase, [
      {
        slug: 'row-in-flight',
        name: 'Synthetic In Flight Lab',
        lastObservedAt: '2026-09-03T00:00:00.000Z',
        indexed: { lastObservedAt: '2026-09-01T00:00:00.000Z' },
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(byId['indexed-sort-key-is-fresh']).toMatchObject({
      status: 'pass',
      detail: { compared: 0, stale: 0, writtenDuringRead: 1 },
    });
  });

  it('reads the indexed sortTitle and flags a row renamed since it was indexed', async () => {
    const byId = await invariantsOf(titleCase, [
      {
        slug: 'row-a',
        name: 'Synthetic Alpha Lab',
        lastObservedAt: settledAt,
        indexed: { sortTitle: researchEntitySortTitle({ name: 'Synthetic Alpha Lab' }) },
      },
      {
        slug: 'row-renamed',
        name: 'Synthetic Gamma Lab',
        lastObservedAt: settledAt,
        indexed: { sortTitle: researchEntitySortTitle({ name: 'Synthetic Beta Lab' }) },
      },
    ]);

    expect(byId['sort-title-asc-follows-card-title'].status).toBe('pass');
    expect(byId['indexed-sort-key-is-fresh']).toMatchObject({
      status: 'fail',
      detail: { sortAttribute: 'sortTitle', compared: 2, stale: 1 },
    });
  });

  it('does not flag the page-local disambiguation suffix the index cannot store', async () => {
    const byId = await invariantsOf(titleCase, [
      {
        slug: 'row-a',
        name: 'Synthetic Shared Lab',
        servedName: 'Synthetic Shared Lab (Synthetic Department)',
        lastObservedAt: settledAt,
        indexed: { sortTitle: researchEntitySortTitle({ name: 'Synthetic Shared Lab' }) },
      },
    ]);

    expect(byId['indexed-sort-key-is-fresh']).toMatchObject({
      status: 'pass',
      detail: { sortAttribute: 'sortTitle', compared: 1, stale: 0 },
    });
  });
});
