import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  getFilterableAttributes: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => {
  const searchIndex = vi.fn(async () => ({
    search: mocks.search,
    getEmbedders: vi.fn(async () => ({})),
    getFilterableAttributes: mocks.getFilterableAttributes,
  }));
  return { getMeiliIndex: searchIndex, getMeiliSearchIndex: searchIndex };
});

vi.mock('../meiliSyncService', () => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

import { searchResearchGroupsViaMeili } from '../researchGroupService';
import {
  buildResearchEntitySearchIndexDocumentsWithMemberNames,
  getResearchEntitySearchIndexSettings,
  invalidateResearchEntitySearchIndexAttributesCache,
} from '../researchEntitySearchIndexService';
import type { ResearchGroupFilterInput } from '../researchGroupFilters';

const PRACTICE_BODIES = [
  'Fixture Violinist has performed with orchestras across North America and Europe and appears regularly in recital at chamber music festivals. Her recordings of contemporary sonatas were released on two labels, and she has premiered works written for her by several living composers.',
  'Fixture Cellist has performed as a soloist with orchestras across Europe and Asia and appears in recital at chamber music festivals each summer. His recordings of the solo suites were released on two labels, and he has premiered concertos written for him by living composers.',
  'Fixture Director has directed productions on Broadway and at regional theaters across the country, and the original plays have toured internationally. Recent stage work includes new productions of classic repertory at festivals in Edinburgh and Avignon.',
];
const RESEARCH_BODY =
  'Fixture Theorist studies how listeners perceive meter in contemporary orchestral music, combining corpus analysis of scores with experiments on rhythm cognition, and has published widely on the history of music theory.';
const scienceBody = (subject: string, topic: string) =>
  `${subject} studies how example ${topic} pass signals between cells, combining imaging and computational modelling of the proteins involved.`;

const MUSIC = { departments: ['Music'], school: 'School of Music', schools: ['School of Music'] };
const DRAMA = {
  departments: [],
  school: 'David Geffen School of Drama',
  schools: ['David Geffen School of Drama'],
};
const PHYSICS = {
  departments: ['Physics'],
  school: 'Faculty of Arts and Sciences',
  schools: ['Faculty of Arts and Sciences'],
};

interface FixtureRow {
  slug: string;
  entityType: string;
  kind: string;
  body: string;
  placement: Record<string, unknown>;
}

const BASE_CORPUS: FixtureRow[] = [
  ...PRACTICE_BODIES.map((body, index) => ({
    slug: `fixture-practice-${index}`,
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: 'individual',
    body,
    placement: index === 2 ? DRAMA : MUSIC,
  })),
  {
    slug: 'fixture-research-music',
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: 'individual',
    body: RESEARCH_BODY,
    placement: MUSIC,
  },
  ...['membranes', 'cilia'].map((topic) => ({
    slug: `fixture-research-${topic}`,
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: 'individual',
    body: scienceBody('Fixture Physicist', topic),
    placement: PHYSICS,
  })),
  ...['synapses', 'organelles'].map((topic) => ({
    slug: `fixture-${topic}-lab`,
    entityType: 'LAB',
    kind: 'lab',
    body: scienceBody('The lab', topic),
    placement: PHYSICS,
  })),
  {
    slug: 'fixture-signalling-center',
    entityType: 'CENTER',
    kind: 'center',
    body: scienceBody('The center', 'tissues'),
    placement: PHYSICS,
  },
];

const CREATIVE_LAB: FixtureRow = {
  slug: 'fixture-practice-lab',
  entityType: 'LAB',
  kind: 'lab',
  body: PRACTICE_BODIES[1],
  placement: MUSIC,
};

let indexDocuments: Record<string, any>[] = [];
let liveFilterableAttributes: string[] = [];

const comparisonHolds = (document: Record<string, any>, comparison: string): boolean => {
  const match = /^(\w+) = (?:"((?:[^"\\]|\\.)*)"|(true|false))$/.exec(comparison.trim());
  if (!match) throw new Error(`fake index cannot parse filter comparison: ${comparison}`);
  const [, field, quoted, bool] = match;
  const wanted = bool !== undefined ? bool : quoted.toLowerCase();
  const held = document[field];
  return (Array.isArray(held) ? held : [held]).some(
    (value) => String(value).toLowerCase() === wanted,
  );
};

const passesFilter = (document: Record<string, any>, filter: string): boolean =>
  filter.split(' AND ').every((clause) => {
    const group = clause.startsWith('(') && clause.endsWith(')') ? clause.slice(1, -1) : clause;
    return group.split(' OR ').some((comparison) => comparisonHolds(document, comparison));
  });

const fakeSearch = async (_query: string, params: Record<string, any>) => {
  const named = [
    ...(params.facets ?? []),
    ...[...String(params.filter ?? '').matchAll(/(\w+) =/g)].map((match) => match[1]),
  ];
  const undeclared = named.find((field) => !liveFilterableAttributes.includes(field));
  if (undeclared) throw new Error(`Attribute \`${undeclared}\` is not filterable.`);
  const matched = indexDocuments.filter((document) => passesFilter(document, params.filter ?? ''));
  const offset = params.offset ?? 0;
  const facetDistribution = Object.fromEntries(
    (params.facets ?? []).map((facet: string) => {
      const counts: Record<string, number> = {};
      for (const document of matched) {
        const held = document[facet];
        for (const value of new Set((Array.isArray(held) ? held : [held]).map(String))) {
          if (value !== 'undefined') counts[value] = (counts[value] ?? 0) + 1;
        }
      }
      return [facet, counts];
    }),
  );
  return {
    hits: matched.slice(offset, offset + (params.limit ?? 20)).map(({ id }) => ({ id })),
    estimatedTotalHits: matched.length,
    totalHits: matched.length,
    facetDistribution,
  };
};

const seedCorpus = async (rows: FixtureRow[]) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  await db.collection('research_entities').deleteMany({});
  const stored = rows.map((row) => ({
    _id: new mongoose.Types.ObjectId(),
    slug: row.slug,
    name: `Fixture ${row.slug.replace(/^fixture-/, '').replace(/-/g, ' ')}`,
    kind: row.kind,
    entityType: row.entityType,
    archived: false,
    ...row.placement,
    researchAreas: ['Fixture Topic'],
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    fullDescription: row.body,
    sourceUrls: [`https://fixture.example.edu/${row.slug}`],
  }));
  await db.collection('research_entities').insertMany(stored);
  indexDocuments = await buildResearchEntitySearchIndexDocumentsWithMemberNames(stored);
};

const LEGACY_FILTERABLE = () =>
  getResearchEntitySearchIndexSettings().filterableAttributes.filter(
    (field) => field !== 'researchType' && field !== 'creativePractice',
  );

const useLiveFilterable = (attributes: string[]) => {
  liveFilterableAttributes = attributes;
  invalidateResearchEntitySearchIndexAttributesCache();
};

const browse = (filters: ResearchGroupFilterInput = {}) =>
  searchResearchGroupsViaMeili('', filters, 1, 100, {}, { correctSpelling: false });

const typeFacet = async (filters: ResearchGroupFilterInput = {}) =>
  (await browse(filters)).facetDistribution?.entityType ?? {};

const sumOf = (counts: Record<string, number>) =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

describe('the Type facet splits creative practice off faculty research and partitions the rows (#5141)', () => {
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
    mocks.search.mockReset();
    mocks.search.mockImplementation(fakeSearch);
    mocks.getFilterableAttributes.mockReset();
    mocks.getFilterableAttributes.mockImplementation(async () => liveFilterableAttributes);
    useLiveFilterable([...getResearchEntitySearchIndexSettings().filterableAttributes]);
    await seedCorpus(BASE_CORPUS);
  });

  it('makes Faculty research plus Creative practice the old Faculty research count', async () => {
    const researchTypeCounts = await typeFacet();
    useLiveFilterable(LEGACY_FILTERABLE());
    const entityTypeCounts = await typeFacet();

    expect(researchTypeCounts.CREATIVE_PRACTICE).toBe(3);
    expect(entityTypeCounts).not.toHaveProperty('CREATIVE_PRACTICE');
    expect(researchTypeCounts.FACULTY_RESEARCH_AREA + researchTypeCounts.CREATIVE_PRACTICE).toBe(
      entityTypeCounts.FACULTY_RESEARCH_AREA,
    );
    expect(researchTypeCounts.LAB).toBe(entityTypeCounts.LAB);
    expect(researchTypeCounts.CENTER).toBe(entityTypeCounts.CENTER);
    expect(sumOf(researchTypeCounts)).toBe(BASE_CORPUS.length);
    expect(sumOf(entityTypeCounts)).toBe(BASE_CORPUS.length);
  }, 60000);

  it('lands every row in exactly one Type bucket', async () => {
    const counts = await typeFacet();
    const bucketsByRow = new Map<string, string[]>();
    for (const value of Object.keys(counts)) {
      const result = await browse({ entityType: [value] });
      expect(result.estimatedTotalHits).toBe(counts[value]);
      for (const entity of result.researchEntities) {
        bucketsByRow.set(entity.slug, [...(bucketsByRow.get(entity.slug) ?? []), value]);
      }
    }

    expect(bucketsByRow.size).toBe(BASE_CORPUS.length);
    expect([...bucketsByRow.values()].every((buckets) => buckets.length === 1)).toBe(true);
  }, 60000);

  it('returns only creative practice cards under Creative practice, and none under Faculty research', async () => {
    const counts = await typeFacet();
    const practice = await browse({ entityType: ['CREATIVE_PRACTICE'] });
    const research = await browse({ entityType: ['FACULTY_RESEARCH_AREA'] });

    expect(practice.estimatedTotalHits).toBe(counts.CREATIVE_PRACTICE);
    expect(practice.researchEntities).toHaveLength(counts.CREATIVE_PRACTICE);
    expect(practice.researchEntities.every((entity) => entity.creativePractice === true)).toBe(
      true,
    );
    expect(research.estimatedTotalHits).toBe(counts.FACULTY_RESEARCH_AREA);
    expect(research.researchEntities.some((entity) => entity.creativePractice === true)).toBe(
      false,
    );
  }, 60000);

  it('keeps every Type option switchable while one is selected', async () => {
    const counts = await typeFacet();

    expect(await typeFacet({ entityType: ['CREATIVE_PRACTICE'] })).toEqual(counts);
  }, 60000);

  it('changes nothing, and says so, when an index without the field is asked for creative practice', async () => {
    useLiveFilterable(LEGACY_FILTERABLE());

    const result = await browse({ entityType: ['CREATIVE_PRACTICE'] });

    expect(result.estimatedTotalHits).toBe(BASE_CORPUS.length);
    expect(result.appliedFilters).toEqual({ entityType: [] });
    expect(result.facetDistribution?.entityType).not.toHaveProperty('CREATIVE_PRACTICE');
  }, 60000);

  it('moves a lab whose card reads creative practice into the creative practice bucket', async () => {
    await seedCorpus([...BASE_CORPUS, CREATIVE_LAB]);
    const researchTypeCounts = await typeFacet();
    const practice = await browse({ entityType: ['CREATIVE_PRACTICE'] });
    useLiveFilterable(LEGACY_FILTERABLE());
    const entityTypeCounts = await typeFacet();

    expect(practice.researchEntities.map((entity) => entity.slug)).toContain(CREATIVE_LAB.slug);
    expect(researchTypeCounts.LAB).toBe(entityTypeCounts.LAB - 1);
    expect(sumOf(researchTypeCounts)).toBe(sumOf(entityTypeCounts));
  }, 60000);
});
