import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  getEmbedders: vi.fn(),
  getResearchSearchQueryVector: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => {
  const searchIndex = vi.fn(async () => ({
    search: mocks.search,
    getEmbedders: mocks.getEmbedders,
  }));
  return { getMeiliIndex: searchIndex, getMeiliSearchIndex: searchIndex };
});

vi.mock('../researchSearchQueryEmbedding', () => ({
  getResearchSearchQueryVector: mocks.getResearchSearchQueryVector,
}));

import { searchResearchGroupsViaMeili } from '../researchGroupService';
import {
  buildResearchEntitySearchIndexDocument,
  invalidateResearchEntitySearchEmbedderCache,
} from '../researchEntitySearchIndexService';
import type { ResearchGroupFilterInput } from '../researchGroupFilters';
import { clearResearchFilterVocabularyCache } from '../researchFilterVocabulary';

type IndexDocument = {
  id: string;
  archived: boolean;
  studentVisibilityTier: string;
  kind: string;
  entityType: string;
  schools: string[];
  departments: string[];
  researchAreas: string[];
  hasUndergradHostingEvidence: boolean;
  searchText: string;
  similarity: number;
};

const ENTITY_TYPES = ['LAB', 'FACULTY_RESEARCH_AREA', 'CENTER', 'CORE_FACILITY'];
const SCHOOLS = ['Faculty of Arts and Sciences', 'School of Medicine', 'School of the Environment'];
const DEPARTMENTS = [
  'Earth & Planetary Sciences',
  'Chemistry',
  'Ecology & Evolutionary Biology',
  'Internal Medicine',
  'Environmental Health Sciences',
];
const ROW_COUNT = 160;
const QUERY = 'coastal sediment';

const seededFraction = (index: number, salt: number): number => {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const indexDocuments: IndexDocument[] = [];

const buildDocument = (index: number, id: string): IndexDocument => {
  const keywordMatch = index % 7 === 0;
  const schools = [SCHOOLS[index % SCHOOLS.length]];
  if (index % 5 === 0) schools.push(SCHOOLS[(index + 1) % SCHOOLS.length]);
  const departments = [DEPARTMENTS[index % DEPARTMENTS.length]];
  if (index % 4 === 0) departments.push(DEPARTMENTS[(index + 2) % DEPARTMENTS.length]);
  return {
    id,
    archived: false,
    studentVisibilityTier: 'student_ready',
    kind: 'lab',
    entityType: ENTITY_TYPES[index % ENTITY_TYPES.length],
    schools,
    departments,
    researchAreas: [],
    hasUndergradHostingEvidence: false,
    searchText: keywordMatch
      ? `synthetic coastal sediment transport study ${index}`
      : `synthetic tidal chemistry study ${index}`,
    similarity: keywordMatch
      ? 0.3 + seededFraction(index, 1) * 0.5
      : seededFraction(index, 2) * 0.22,
  };
};

const splitOutsideQuotes = (text: string, separator: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let position = 0; position < text.length; position += 1) {
    const character = text[position];
    if (character === '\\' && quoted) {
      position += 1;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (quoted) continue;
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth === 0 && text.startsWith(separator, position)) {
      parts.push(text.slice(start, position));
      start = position + separator.length;
      position += separator.length - 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
};

const comparisonHolds = (document: IndexDocument, comparison: string): boolean => {
  const match = /^(\w+) = (?:"((?:[^"\\]|\\.)*)"|(true|false))$/.exec(comparison);
  if (!match) throw new Error(`fake index cannot parse filter comparison: ${comparison}`);
  const [, field, quotedValue, booleanValue] = match;
  const wanted =
    booleanValue !== undefined ? booleanValue : quotedValue.replace(/\\(.)/g, '$1').toLowerCase();
  const held = (document as Record<string, unknown>)[field];
  const values = Array.isArray(held) ? held : [held];
  return values.some((value) => String(value).toLowerCase() === wanted);
};

const documentPassesFilter = (document: IndexDocument, filter: string): boolean =>
  splitOutsideQuotes(filter, ' AND ').every((clause) => {
    const group = clause.startsWith('(') && clause.endsWith(')') ? clause.slice(1, -1) : clause;
    return splitOutsideQuotes(group, ' OR ').some((comparison) =>
      comparisonHolds(document, comparison),
    );
  });

const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

const keywordWordsMatched = (document: IndexDocument, query: string): number =>
  queryWords(query).filter((word) => document.searchText.includes(word)).length;

const facetDistributionOf = (
  documents: IndexDocument[],
  facets: string[] | undefined,
): Record<string, Record<string, number>> | undefined => {
  if (!facets) return undefined;
  return Object.fromEntries(
    facets.map((facet) => {
      const counts: Record<string, number> = {};
      for (const document of documents) {
        const held = (document as Record<string, unknown>)[facet];
        const values = new Set((Array.isArray(held) ? held : [held]).map(String));
        values.forEach((value) => {
          counts[value] = (counts[value] ?? 0) + 1;
        });
      }
      return [facet, counts];
    }),
  );
};

const toHit = (document: IndexDocument, rankingScoreDetails: Record<string, unknown>) => ({
  id: document.id,
  kind: document.kind,
  entityType: document.entityType,
  schools: document.schools,
  departments: document.departments,
  researchAreas: document.researchAreas,
  hasUndergradHostingEvidence: document.hasUndergradHostingEvidence,
  _rankingScoreDetails: rankingScoreDetails,
});

const pageOf = <T>(rows: T[], params: Record<string, any>): T[] => {
  if (params.hitsPerPage !== undefined) {
    const start = ((params.page ?? 1) - 1) * params.hitsPerPage;
    return rows.slice(start, start + params.hitsPerPage);
  }
  const offset = params.offset ?? 0;
  return rows.slice(offset, offset + (params.limit ?? 20));
};

const fakeSearch = async (query: string, params: Record<string, any>) => {
  const filtered = indexDocuments.filter((document) =>
    documentPassesFilter(document, params.filter ?? ''),
  );
  const wordCount = queryWords(query).length;
  const keywordScore = (document: IndexDocument) =>
    wordCount === 0 ? 1 : keywordWordsMatched(document, query) / wordCount;

  if (params.hybrid?.semanticRatio === 1) {
    const ranked = [...filtered].sort((a, b) => b.similarity - a.similarity);
    return {
      hits: pageOf(ranked, params).map((document) =>
        toHit(document, { vectorSort: { similarity: document.similarity } }),
      ),
    };
  }

  if (params.hybrid) {
    const blended = (document: IndexDocument) =>
      params.hybrid.semanticRatio * document.similarity +
      (1 - params.hybrid.semanticRatio) * keywordScore(document);
    const ranked = filtered
      .filter((document) => blended(document) >= (params.rankingScoreThreshold ?? 0))
      .sort((a, b) => blended(b) - blended(a));
    return {
      hits: pageOf(ranked, params).map((document) =>
        toHit(document, { vectorSort: { similarity: document.similarity } }),
      ),
      totalHits: ranked.length,
      estimatedTotalHits: ranked.length,
      facetDistribution: facetDistributionOf(ranked, params.facets),
    };
  }

  const requiredWords = params.matchingStrategy === 'all' ? wordCount : Math.min(1, wordCount);
  const matched = filtered
    .filter((document) => wordCount === 0 || keywordWordsMatched(document, query) >= requiredWords)
    .sort((a, b) => keywordWordsMatched(b, query) - keywordWordsMatched(a, query));
  return {
    hits: pageOf(matched, params).map((document) =>
      toHit(document, {
        words: {
          matchingWords: keywordWordsMatched(document, query),
          maxMatchingWords: wordCount,
        },
      }),
    ),
    totalHits: matched.length,
    estimatedTotalHits: matched.length,
    facetDistribution: facetDistributionOf(matched, params.facets),
  };
};

const FILTER_KEY_BY_FACET: Record<string, 'school' | 'departments' | 'entityType'> = {
  school: 'school',
  departments: 'departments',
  entityType: 'entityType',
};

const withOption = (
  baseFilters: ResearchGroupFilterInput,
  facet: string,
  value: string,
): ResearchGroupFilterInput | null => {
  if (facet === 'hostsUndergrads') {
    return value === 'true' ? { ...baseFilters, hostsUndergrads: true } : null;
  }
  const filterKey = FILTER_KEY_BY_FACET[facet];
  return filterKey ? { ...baseFilters, [filterKey]: [value] } : null;
};

const search = (query: string, filters: ResearchGroupFilterInput, pageSize = 24) =>
  searchResearchGroupsViaMeili(query, filters, 1, pageSize, {}, { correctSpelling: false });

const expectEveryOptionCountToEqualItsResults = async (
  query: string,
  baseFilters: ResearchGroupFilterInput,
) => {
  const result = await search(query, baseFilters);
  const facetDistribution = result.facetDistribution ?? {};
  if (!baseFilters.entityType) {
    const typeCounts = Object.values(facetDistribution.entityType ?? {});
    expect(typeCounts.reduce((sum, count) => sum + count, 0)).toBe(result.estimatedTotalHits);
  }

  const mismatches: string[] = [];
  let optionsChecked = 0;
  for (const [facet, options] of Object.entries(facetDistribution)) {
    for (const [value, count] of Object.entries(options)) {
      const filters = withOption(baseFilters, facet, value);
      if (!filters) continue;
      const applied = await search(query, filters, 100);
      optionsChecked += 1;
      if (applied.estimatedTotalHits !== count || applied.researchEntities.length !== count) {
        mismatches.push(
          `${facet}=${value}: shown ${count}, applied total ${applied.estimatedTotalHits}, rows ${applied.researchEntities.length}`,
        );
      }
    }
  }
  expect(optionsChecked).toBeGreaterThan(5);
  expect(mismatches).toEqual([]);
};

describe('a research filter option count is the number of results applying it returns (#5101)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const rows = Array.from({ length: ROW_COUNT }, (_, index) => {
      const _id = new mongoose.Types.ObjectId();
      const document = buildDocument(index, _id.toString());
      const row = {
        _id,
        slug: `synthetic-sediment-row-${index}`,
        name: `Synthetic Sediment Group ${index}`,
        kind: document.kind,
        entityType: document.entityType,
        archived: false,
        schools: document.schools,
        school: document.schools[0],
        departments: document.departments,
        researchAreas: [],
        studentVisibilityTier: 'student_ready',
        studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
        shortDescription: `Studies how coastal sediment moves through estuary channel ${index}.`,
        fullDescription: `A synthetic group studying how coastal sediment moves through estuary channel ${index}, using field cores and flume experiments.`,
        websiteUrl: `https://example.yale.edu/synthetic-sediment-${index}/`,
        sourceUrls: [`https://example.yale.edu/synthetic-sediment-${index}/`],
        pastUndergradAdvisees: index % 3 === 0 ? [{ count: 2 }] : [],
        hasUndergradHostingEvidence: false,
      };
      document.hasUndergradHostingEvidence =
        buildResearchEntitySearchIndexDocument(row)?.hasUndergradHostingEvidence === true;
      indexDocuments.push(document);
      return row;
    });
    await db.collection('research_entities').insertMany(rows);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(() => {
    invalidateResearchEntitySearchEmbedderCache();
    clearResearchFilterVocabularyCache();
    mocks.search.mockReset();
    mocks.search.mockImplementation(fakeSearch);
    mocks.getEmbedders.mockReset();
    mocks.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    mocks.getResearchSearchQueryVector.mockReset();
    mocks.getResearchSearchQueryVector.mockResolvedValue({
      vector: [0.1, 0.2, 0.3],
      semanticLegAffordable: true,
    });
  });

  it('holds for a hybrid text search, whose semantic leg is a top-K window rather than a predicate', async () => {
    await expectEveryOptionCountToEqualItsResults(QUERY, {});
  });

  it('holds for a hybrid text search with another facet already applied', async () => {
    await expectEveryOptionCountToEqualItsResults(QUERY, { departments: ['Chemistry'] });
    await expectEveryOptionCountToEqualItsResults(QUERY, {
      entityType: ['LAB'],
      school: ['School of Medicine'],
    });
    await expectEveryOptionCountToEqualItsResults(QUERY, { hostsUndergrads: true });
  });

  it('keeps the query in force under a type filter instead of admitting every row of that type', async () => {
    const unfiltered = await search(QUERY, {});
    const coreFacilityCount = unfiltered.facetDistribution?.entityType?.CORE_FACILITY ?? 0;
    const allCoreFacilities = indexDocuments.filter(
      (document) => document.entityType === 'CORE_FACILITY',
    ).length;

    const applied = await search(QUERY, { entityType: ['CORE_FACILITY'] }, 100);

    expect(coreFacilityCount).toBeLessThan(allCoreFacilities);
    expect(applied.estimatedTotalHits).toBe(coreFacilityCount);
  });

  it('filters on the evidence the served badge reads, even when the stored flag is stale', async () => {
    const browse = await search('', {}, 100);
    const badged = browse.researchEntities.filter(
      (entity: any) => entity.hasUndergradHostingEvidence === true,
    ).length;

    const applied = await search('', { hostsUndergrads: true }, 100);

    expect(badged).toBeGreaterThan(0);
    expect(browse.facetDistribution?.hostsUndergrads).toEqual({
      true: indexDocuments.filter((document) => document.hasUndergradHostingEvidence).length,
    });
    expect(applied.estimatedTotalHits).toBe(browse.facetDistribution?.hostsUndergrads?.true);
    expect(
      applied.researchEntities.every((entity: any) => entity.hasUndergradHostingEvidence === true),
    ).toBe(true);
  });

  it('drops a school no row holds and reports the filters it applied, instead of answering empty (#5146)', async () => {
    const result = await search(QUERY, {
      school: ['Synthetic Nowhere School'],
      entityType: ['LAB'],
    });
    const typeOnly = await search(QUERY, { entityType: ['LAB'] });

    expect(result.appliedFilters).toEqual({ school: [] });
    expect(result.estimatedTotalHits).toBe(typeOnly.estimatedTotalHits);
    expect(result.estimatedTotalHits).toBeGreaterThan(0);
  });

  it('searches a department under the spelling the corpus holds (#5146)', async () => {
    const result = await search('', { departments: ['chemistry'] });
    const canonical = await search('', { departments: ['Chemistry'] });

    expect(result.appliedFilters).toEqual({ departments: ['Chemistry'] });
    expect(canonical.appliedFilters).toBeUndefined();
    expect(result.estimatedTotalHits).toBe(canonical.estimatedTotalHits);
  });

  it('keeps a department no row holds when the caller opts out of resolving filter values', async () => {
    const result = await searchResearchGroupsViaMeili(
      '',
      { departments: ['Synthetic Nowhere Department'] },
      1,
      24,
      {},
      { correctSpelling: false, resolveFilterValues: false },
    );

    expect(result.appliedFilters).toBeUndefined();
    expect(result.estimatedTotalHits).toBe(0);
  });

  it('holds for a filters-only browse', async () => {
    await expectEveryOptionCountToEqualItsResults('', {});
    await expectEveryOptionCountToEqualItsResults('', { school: ['School of the Environment'] });
  });

  it('holds for a keyword-only text search when no embedder is configured', async () => {
    mocks.getEmbedders.mockResolvedValue({});
    await expectEveryOptionCountToEqualItsResults(QUERY, {});
  });
});
