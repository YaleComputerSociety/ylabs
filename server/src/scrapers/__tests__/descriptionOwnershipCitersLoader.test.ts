import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Observation } from '../../models/observation';
import {
  loadDescriptionSourceCiters,
  resetDescriptionOwnershipCitersCache,
} from '../descriptionOwnershipResolverScreen';
import { normalizeEvidenceUrl } from '../utils/sharedEvidenceUrls';

interface StoredRow {
  sourceUrl: string;
  entityKey?: string;
  entityId?: string;
}

const STORE: StoredRow[] = [
  { sourceUrl: 'https://medicine.yale.edu/psychiatry/research/', entityKey: 'row-a' },
  { sourceUrl: 'https://www.medicine.yale.edu/psychiatry/research', entityKey: 'row-b' },
  { sourceUrl: 'HTTPS://Medicine.Yale.edu/psychiatry/research/?utm=x', entityId: 'row-c' },
  { sourceUrl: 'https://medicine.yale.edu/surgery/directory/', entityKey: 'row-d' },
  { sourceUrl: 'https://medicine.yale.edu:8443/surgery/directory/', entityKey: 'row-port' },
  { sourceUrl: 'https://economics.yale.edu/people-economics?person_type=2', entityKey: 'row-e' },
  { sourceUrl: 'https://economics.yale.edu/people-economics', entityKey: 'row-f' },
  { sourceUrl: 'https://economics.yale.edu/people-economics', entityKey: '' },
];

const matchesQuery = (row: StoredRow, filter: any): boolean =>
  !filter.$or ||
  filter.$or.some((clause: any) =>
    new RegExp(clause.sourceUrl.$regex, clause.sourceUrl.$options).test(row.sourceUrl),
  );

const referenceCitersFor = (url: string): Set<string> => {
  const host = new URL(url).hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = {
    $or: [{ sourceUrl: { $regex: `^https?://(www\\.)?${host}(/|$|\\?)`, $options: 'i' } }],
  };
  const keys = STORE.filter(
    (row) => matchesQuery(row, filter) && normalizeEvidenceUrl(row.sourceUrl) === url,
  )
    .map((row) => String(row.entityKey || row.entityId || ''))
    .filter(Boolean);
  return new Set(keys);
};

let findCalls = 0;

beforeEach(() => {
  resetDescriptionOwnershipCitersCache();
  findCalls = 0;
  vi.spyOn(Observation, 'find').mockImplementation(((filter: any) => {
    findCalls += 1;
    return { lean: async () => STORE.filter((row) => matchesQuery(row, filter)) };
  }) as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadDescriptionSourceCiters (#3568)', () => {
  const lookups = [
    ['https://medicine.yale.edu/psychiatry/research/'],
    ['https://medicine.yale.edu/surgery/directory'],
    ['https://economics.yale.edu/people-economics?person_type=6'],
    ['https://medicine.yale.edu/never-cited/', 'https://economics.yale.edu/other'],
    ['https://medicine.yale.edu/psychiatry/research', 'not a url'],
  ];

  it('answers every lookup exactly as a fresh per-lookup query of an unchanged store would', async () => {
    for (const batch of lookups) {
      const result = await loadDescriptionSourceCiters(batch);
      const wanted = batch.map((url) => normalizeEvidenceUrl(url)).filter(Boolean);
      expect([...result.keys()].sort()).toEqual([...new Set(wanted)].sort());
      for (const url of wanted) {
        expect([...(result.get(url) ?? [])].sort()).toEqual([...referenceCitersFor(url)].sort());
      }
    }
  });

  it('reads the store once, however many hosts and pages are looked up', async () => {
    for (const batch of lookups) await loadDescriptionSourceCiters(batch);

    expect(findCalls).toBe(1);
  });

  it('reads the store again after the cache is reset', async () => {
    await loadDescriptionSourceCiters(['https://medicine.yale.edu/psychiatry/research/']);
    resetDescriptionOwnershipCitersCache();
    await loadDescriptionSourceCiters(['https://medicine.yale.edu/surgery/directory/']);

    expect(findCalls).toBe(2);
  });

  it('issues no read for a batch with no parseable url', async () => {
    const result = await loadDescriptionSourceCiters(['', 'not a url']);

    expect(result.size).toBe(0);
    expect(findCalls).toBe(0);
  });
});
