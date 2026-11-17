import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
  filters: [] as string[],
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

const RESEARCH_AREA_CLAUSE = /researchAreas = "((?:[^"\\]|\\.)*)"/g;

const storedRowsMatching = async (filter: string): Promise<Array<Record<string, any>>> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no database connection');
  const wanted = [...filter.matchAll(RESEARCH_AREA_CLAUSE)].map((match) => match[1]);
  const rows = await db.collection('research_entities').find({ archived: false }).toArray();
  return rows.filter(
    (row) =>
      wanted.length === 0 ||
      (Array.isArray(row.researchAreas) &&
        row.researchAreas.some((value: string) => wanted.includes(value))),
  );
};

vi.mock('../../utils/meiliClient', () => ({
  getMeiliSearchIndex: vi.fn(async () => ({
    getEmbedders: vi.fn(async () => ({})),
    search: vi.fn(async (_query: string, params: { filter?: string } = {}) => {
      meiliMocks.filters.push(params.filter ?? '');
      const rows = await storedRowsMatching(params.filter ?? '');
      return {
        hits: rows.map((row) => ({ id: String(row._id) })),
        estimatedTotalHits: rows.length,
        totalHits: rows.length,
        facetDistribution: {},
      };
    }),
  })),
}));

import { setMeshNaturalOrderHeadingsForTesting } from '../../scrapers/meshNaturalOrder';
import { searchResearchGroupsViaMeili } from '../researchGroupService';
import { clearResearchFilterVocabularyCache } from '../researchFilterVocabulary';

const INVERTED = 'Neoplasms, Synthetic';
const NATURAL = 'Synthetic Neoplasms';
const UNRELATED = 'Synthetic Unrelated Topic';

const READY_SHORT =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const READY_FULL =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

const entity = (slug: string, researchAreas: string[], index: number): Record<string, unknown> => ({
  schemaVersion: 1,
  slug,
  name: `Synthetic Topic Lab ${index}`,
  displayName: `Synthetic Topic Lab ${index}`,
  kind: 'lab',
  entityType: 'LAB',
  shortDescription: READY_SHORT,
  fullDescription: READY_FULL,
  researchAreas,
  methods: ['outcome audits'],
  departments: ['Internal Medicine'],
  school: 'Yale School of Medicine',
  schools: ['Yale School of Medicine'],
  websiteUrl: `https://example.invalid/${slug}`,
  hasUndergradHostingEvidence: true,
  browseRankScore: 100 - index,
  lastObservedAt: new Date('2026-08-24T00:00:00.000Z'),
  archived: false,
  studentVisibilityTier: 'student_ready',
  studentVisibilityComputedTier: 'student_ready',
  studentVisibilityReasons: ['mesh-filter-fixture'],
});

const servedSlugs = async (
  researchAreas: string[],
  options: Record<string, unknown> = {},
): Promise<string[]> => {
  const result = (await searchResearchGroupsViaMeili(
    '',
    { researchAreas },
    1,
    24,
    {},
    options,
  )) as unknown as { researchEntities?: Array<{ slug?: string }> };
  return (result.researchEntities ?? []).map((row) => String(row.slug)).sort();
};

describe('the researchAreas filter matches a MeSH heading in either order (#6379)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no database connection');
    await db.collection('research_entities').deleteMany({});
    clearResearchFilterVocabularyCache();
    meiliMocks.filters.length = 0;
    setMeshNaturalOrderHeadingsForTesting({
      [INVERTED]: { natural: NATURAL, descriptorUI: 'D000000' },
    });
    await db
      .collection('research_entities')
      .insertMany([
        entity('mesh-not-yet-re-resolved', [INVERTED], 1),
        entity('mesh-re-resolved', [NATURAL], 2),
        entity('mesh-unrelated', [UNRELATED], 3),
      ]);
  });

  afterEach(() => {
    setMeshNaturalOrderHeadingsForTesting(null);
  });

  it('finds a row the topic pass has not re-resolved yet from the natural-order value', async () => {
    expect(await servedSlugs([NATURAL])).toEqual(['mesh-not-yet-re-resolved', 'mesh-re-resolved']);
  });

  it('still finds a re-resolved row from the inverted value', async () => {
    expect(await servedSlugs([INVERTED])).toEqual(['mesh-not-yet-re-resolved', 'mesh-re-resolved']);
  });

  it('passes a value outside the MeSH map through unchanged', async () => {
    expect(await servedSlugs([UNRELATED])).toEqual(['mesh-unrelated']);
    expect(
      meiliMocks.filters.some((filter) => filter.includes(`researchAreas = "${UNRELATED}"`)),
    ).toBe(true);
    expect(meiliMocks.filters.some((filter) => filter.includes(NATURAL))).toBe(false);
  });

  it('expands the Mongo browse path the same way', async () => {
    expect(await servedSlugs([NATURAL], { lowQualityFirst: true, includeNonPublic: true })).toEqual(
      ['mesh-not-yet-re-resolved', 'mesh-re-resolved'],
    );
  });
});
