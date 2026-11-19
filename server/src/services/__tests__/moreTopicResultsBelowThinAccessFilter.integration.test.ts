import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  getEmbedders: vi.fn(),
  getFilterableAttributes: vi.fn(),
  getResearchSearchQueryVector: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => {
  const searchIndex = vi.fn(async () => ({
    search: mocks.search,
    getEmbedders: mocks.getEmbedders,
    getFilterableAttributes: mocks.getFilterableAttributes,
  }));
  return { getMeiliIndex: searchIndex, getMeiliSearchIndex: searchIndex };
});

vi.mock('../researchSearchQueryEmbedding', () => ({
  getResearchSearchQueryVector: mocks.getResearchSearchQueryVector,
}));

import {
  searchResearchGroupsViaMeili,
  type ResearchGroupSearchResult,
  type ResearchGroupSearchSort,
} from '../researchGroupService';
import {
  buildResearchEntitySearchIndexDocument,
  getResearchEntitySearchIndexSettings,
  invalidateResearchEntitySearchEmbedderCache,
  invalidateResearchEntitySearchIndexAttributesCache,
} from '../researchEntitySearchIndexService';
import type { ResearchGroupFilterInput } from '../researchGroupFilters';
import { clearResearchFilterVocabularyCache } from '../researchFilterVocabulary';
import { resetMeiliAvailability } from '../../utils/meiliAvailability';

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
  welcomesUndergrads: boolean;
  mentorsUndergrads?: true;
  undergradInvitationRank: number;
  leadProfessorNames: string[];
  searchText: string;
  similarity: number;
};

type SyntheticRow = {
  topic: string;
  hosts: boolean;
  welcomes: boolean;
  mentors?: boolean;
  leadName?: string;
  staleIndexHostingFlag?: boolean;
};

const THIN_TOPIC = 'glacier hydrology';
const BROAD_TOPIC = 'river delta';
const NAME_QUERY = 'zyxquill';
const OFF_TOPIC = 'synthetic unrelated ceramics';

const SEMANTIC_LEG_FILLER_ROWS = 80;

const syntheticRows: SyntheticRow[] = [
  ...Array.from({ length: 30 }, (_, index) => ({
    topic: THIN_TOPIC,
    hosts: index % 8 === 3,
    welcomes: index === 3 || index % 10 === 6,
    mentors: index % 9 === 4,
    staleIndexHostingFlag: index === 5,
  })),
  ...Array.from({ length: SEMANTIC_LEG_FILLER_ROWS }, () => ({
    topic: OFF_TOPIC,
    hosts: false,
    welcomes: false,
  })),
  ...Array.from({ length: 30 }, (_, index) => ({
    topic: BROAD_TOPIC,
    hosts: index % 2 === 0,
    welcomes: false,
  })),
  { topic: OFF_TOPIC, hosts: true, welcomes: false, leadName: 'Synthetic Zyxquill' },
  { topic: OFF_TOPIC, hosts: false, welcomes: false, leadName: 'Synthetic Zyxquill' },
];

const indexDocuments: IndexDocument[] = [];

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
  filter.trim() === '' ||
  splitOutsideQuotes(filter, ' AND ').every((clause) => {
    const group = clause.startsWith('(') && clause.endsWith(')') ? clause.slice(1, -1) : clause;
    return splitOutsideQuotes(group, ' OR ').some((comparison) =>
      comparisonHolds(document, comparison),
    );
  });

const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

const searchableText = (document: IndexDocument) =>
  `${document.searchText} ${document.leadProfessorNames.join(' ')}`.toLowerCase();

const keywordWordsMatched = (document: IndexDocument, query: string): number =>
  queryWords(query).filter((word) => searchableText(document).includes(word)).length;

const facetDistributionOf = (documents: IndexDocument[], facets: string[] | undefined) => {
  if (!facets) return undefined;
  return Object.fromEntries(
    facets.map((facet) => {
      const counts: Record<string, number> = {};
      for (const document of documents) {
        const held = (document as Record<string, unknown>)[facet];
        new Set((Array.isArray(held) ? held : [held]).map(String)).forEach((value) => {
          counts[value] = (counts[value] ?? 0) + 1;
        });
      }
      return [facet, counts];
    }),
  );
};

const leadNameMatchesPosition = (document: IndexDocument, query: string) => {
  const positions = document.leadProfessorNames.flatMap((name, nameIndex) =>
    queryWords(query).flatMap((word) => {
      const start = name.toLowerCase().indexOf(word);
      return start >= 0 ? [{ start, length: word.length, indices: [nameIndex] }] : [];
    }),
  );
  return positions.length > 0 ? { leadProfessorNames: positions } : {};
};

const toHit = (
  document: IndexDocument,
  rankingScoreDetails: Record<string, unknown>,
  params: Record<string, any>,
  query: string,
) => ({
  id: document.id,
  kind: document.kind,
  entityType: document.entityType,
  schools: document.schools,
  departments: document.departments,
  researchAreas: document.researchAreas,
  hasUndergradHostingEvidence: document.hasUndergradHostingEvidence,
  welcomesUndergrads: document.welcomesUndergrads,
  mentorsUndergrads: document.mentorsUndergrads,
  undergradInvitationRank: document.undergradInvitationRank,
  _rankingScoreDetails: rankingScoreDetails,
  ...(params.showMatchesPosition
    ? {
        leadProfessorNames: document.leadProfessorNames,
        _matchesPosition: leadNameMatchesPosition(document, query),
      }
    : {}),
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
  const similarityFor = (document: IndexDocument) =>
    keywordWordsMatched(document, query) > 0 ? document.similarity : 0.05;
  const hitOf = (document: IndexDocument, details: Record<string, unknown>) =>
    toHit(document, details, params, query);

  if (params.hybrid?.semanticRatio === 1) {
    const ranked = [...filtered].sort((a, b) => similarityFor(b) - similarityFor(a));
    return {
      hits: pageOf(ranked, params).map((document) =>
        hitOf(document, { vectorSort: { similarity: similarityFor(document) } }),
      ),
    };
  }

  if (params.hybrid) {
    const blended = (document: IndexDocument) =>
      params.hybrid.semanticRatio * similarityFor(document) +
      (1 - params.hybrid.semanticRatio) * keywordScore(document);
    const ranked = filtered
      .filter((document) => blended(document) >= (params.rankingScoreThreshold ?? 0))
      .sort((a, b) => blended(b) - blended(a));
    return {
      hits: pageOf(ranked, params).map((document) =>
        hitOf(document, { vectorSort: { similarity: similarityFor(document) } }),
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
      hitOf(document, {
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

const search = (
  query: string,
  filters: ResearchGroupFilterInput,
  {
    page = 1,
    pageSize = 24,
    sort = {},
  }: { page?: number; pageSize?: number; sort?: ResearchGroupSearchSort } = {},
) => searchResearchGroupsViaMeili(query, filters, page, pageSize, sort, { correctSpelling: false });

const idsOf = (entities: Array<{ _id: unknown }>) => entities.map((entity) => String(entity._id));

const withoutMoreTopicResults = ({ moreTopicResults: _more, ...rest }: ResearchGroupSearchResult) =>
  rest;

const searchCallsMadeBy = async (run: () => Promise<unknown>): Promise<number> => {
  const before = mocks.search.mock.calls.length;
  await run();
  return mocks.search.mock.calls.length - before;
};

const failSearchCallsAfter = (allowedCalls: number, error: Error) => {
  let calls = 0;
  mocks.search.mockImplementation(async (query: string, params: Record<string, any>) => {
    calls += 1;
    if (calls > allowedCalls) throw error;
    return fakeSearch(query, params);
  });
};

describe('a topic search thinned by an access filter lists more research on the topic (#5464)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const rows = syntheticRows.map((synthetic, index) => {
      const _id = new mongoose.Types.ObjectId();
      const row = {
        _id,
        slug: `synthetic-access-row-${index}`,
        name: `Synthetic Group ${index}`,
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        schools: ['Faculty of Arts and Sciences'],
        school: 'Faculty of Arts and Sciences',
        departments: [synthetic.topic === OFF_TOPIC ? 'Chemistry' : 'Earth & Planetary Sciences'],
        researchAreas: [],
        studentVisibilityTier: 'student_ready',
        studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
        shortDescription: `Studies ${synthetic.topic} in synthetic setting ${index}.`,
        fullDescription: `A synthetic group studying ${synthetic.topic} in setting ${index}, using field records and models.`,
        websiteUrl: `https://example.yale.edu/synthetic-access-${index}/`,
        sourceUrls: [`https://example.yale.edu/synthetic-access-${index}/`],
        pastUndergradAdvisees: synthetic.hosts ? [{ count: 2 }] : [],
        hasUndergradHostingEvidence: false,
        ...(synthetic.welcomes
          ? {
              undergradInvitation: {
                level: 'welcomes_undergrads',
                quote: 'Interested undergraduates are welcome to get in touch.',
                sourceUrl: `https://example.yale.edu/synthetic-access-${index}/join`,
              },
            }
          : {}),
        ...(synthetic.mentors
          ? {
              undergradListEvidence: [
                {
                  source: 'cs-senior-projects',
                  kind: 'advised',
                  count: 2,
                  sourceUrl: `https://example.yale.edu/synthetic-senior-projects-${index}/`,
                },
              ],
            }
          : {}),
      };
      const built = buildResearchEntitySearchIndexDocument(row);
      const onTopic = synthetic.topic !== OFF_TOPIC;
      indexDocuments.push({
        id: _id.toString(),
        archived: false,
        studentVisibilityTier: 'student_ready',
        kind: 'lab',
        entityType: 'LAB',
        schools: row.schools,
        departments: row.departments,
        researchAreas: [],
        hasUndergradHostingEvidence:
          synthetic.staleIndexHostingFlag === true || built?.hasUndergradHostingEvidence === true,
        welcomesUndergrads: built?.welcomesUndergrads === true,
        ...(built?.mentorsUndergrads === true ? { mentorsUndergrads: true as const } : {}),
        undergradInvitationRank: built?.undergradInvitationRank ?? 0,
        leadProfessorNames: synthetic.leadName ? [synthetic.leadName] : [],
        searchText: `synthetic ${synthetic.topic} study ${index}`,
        similarity: onTopic ? 0.8 - (index % 30) * 0.01 : 0.05,
      });
      return row;
    });
    await db.collection('research_entities').insertMany(rows);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(() => {
    resetMeiliAvailability();
    invalidateResearchEntitySearchEmbedderCache();
    invalidateResearchEntitySearchIndexAttributesCache();
    clearResearchFilterVocabularyCache();
    mocks.getFilterableAttributes.mockReset();
    mocks.getFilterableAttributes.mockResolvedValue([
      ...getResearchEntitySearchIndexSettings().filterableAttributes,
    ]);
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

  it('follows a thin hosting-filtered page with the unfiltered order, minus the rows it shows', async () => {
    const filtered = await search(THIN_TOPIC, { hostsUndergrads: true });
    const unfiltered = await search(THIN_TOPIC, {}, { pageSize: 100 });
    const shown = new Set(idsOf(filtered.researchEntities));

    expect(filtered.estimatedTotalHits).toBeGreaterThan(0);
    expect(filtered.estimatedTotalHits).toBeLessThan(10);
    expect(filtered.moreTopicResults).toHaveLength(10);
    expect(idsOf(filtered.moreTopicResults ?? [])).toEqual(
      idsOf(unfiltered.researchEntities)
        .filter((id) => !shown.has(id))
        .slice(0, 10),
    );
    expect(
      filtered.moreTopicResults?.some((entity) => entity.hasUndergradHostingEvidence === true),
    ).toBe(false);
  });

  it('follows a thin welcomes-filtered page with rows that carry no invitation', async () => {
    const filtered = await search(THIN_TOPIC, { welcomesUndergrads: true });
    const shown = new Set(idsOf(filtered.researchEntities));

    expect(filtered.estimatedTotalHits).toBeGreaterThan(0);
    expect(filtered.estimatedTotalHits).toBeLessThan(10);
    expect(filtered.moreTopicResults).toHaveLength(10);
    expect(idsOf(filtered.moreTopicResults ?? []).some((id) => shown.has(id))).toBe(false);
    expect(
      filtered.moreTopicResults?.some((entity) => entity.undergradInvitation !== undefined),
    ).toBe(false);
  });

  it('follows a thin mentors-filtered page with rows that carry no mentors entry (#5963)', async () => {
    const filtered = await search(THIN_TOPIC, { mentorsUndergrads: true });
    const unfiltered = await search(THIN_TOPIC, {}, { pageSize: 100 });
    const shown = new Set(idsOf(filtered.researchEntities));
    const servesMentors = (entity: any) =>
      entity.undergradListEvidence?.some((entry: any) => entry.signal === 'mentors') === true;
    const more = filtered.moreTopicResults ?? [];

    expect(filtered.estimatedTotalHits).toBeGreaterThan(0);
    expect(filtered.estimatedTotalHits).toBeLessThan(10);
    expect(filtered.researchEntities.every(servesMentors)).toBe(true);
    expect(idsOf(more)).toEqual(
      idsOf(
        unfiltered.researchEntities.filter(
          (entity) => !shown.has(String(entity._id)) && !servesMentors(entity),
        ),
      ).slice(0, 10),
    );
    expect(more.some((entity) => entity.hasUndergradHostingEvidence === true)).toBe(true);
  });

  it('never repeats a filtered row, even one whose served card does not carry the badge', async () => {
    const filtered = await search(THIN_TOPIC, { hostsUndergrads: true });
    const unbadgedShown = filtered.researchEntities.filter(
      (entity) => entity.hasUndergradHostingEvidence !== true,
    );
    const more = new Set(idsOf(filtered.moreTopicResults ?? []));

    expect(unbadgedShown.length).toBeGreaterThan(0);
    expect(idsOf(unbadgedShown).some((id) => more.has(id))).toBe(false);
  });

  it('lists only rows carrying neither signal when both access filters are on', async () => {
    const filtered = await search(THIN_TOPIC, { hostsUndergrads: true, welcomesUndergrads: true });

    expect(filtered.estimatedTotalHits).toBeGreaterThan(0);
    expect(filtered.moreTopicResults?.length).toBeGreaterThan(0);
    expect(
      filtered.moreTopicResults?.filter(
        (entity) =>
          entity.hasUndergradHostingEvidence === true || entity.undergradInvitation !== undefined,
      ),
    ).toEqual([]);
  });

  it('leaves the filtered rows, total and facet counts exactly as the filter alone serves them', async () => {
    const withMore = await search(THIN_TOPIC, { hostsUndergrads: true });
    const mainCalls = await searchCallsMadeBy(() =>
      search(THIN_TOPIC, { hostsUndergrads: true }, { page: 2, pageSize: 2 }),
    );
    failSearchCallsAfter(mainCalls, new Error('synthetic companion failure'));
    const withoutMore = await search(THIN_TOPIC, { hostsUndergrads: true });

    expect(withMore.moreTopicResults?.length).toBeGreaterThan(0);
    expect(withoutMore.moreTopicResults).toBeUndefined();
    expect(withoutMoreTopicResults(withMore)).toEqual(withoutMore);
    expect(withMore.facetDistribution?.hostsUndergrads).toEqual({
      true: withMore.estimatedTotalHits,
    });
  });

  it('answers the filtered page alone, and keeps search available, when the extra read fails', async () => {
    const mainCalls = await searchCallsMadeBy(() =>
      search(THIN_TOPIC, { hostsUndergrads: true }, { page: 2, pageSize: 2 }),
    );
    const unreachable = Object.assign(new Error('synthetic unreachable index'), {
      name: 'MeilisearchRequestError',
    });
    failSearchCallsAfter(mainCalls, unreachable);

    const result = await search(THIN_TOPIC, { hostsUndergrads: true });

    expect(result.researchEntities.length).toBeGreaterThan(0);
    expect(result.moreTopicResults).toBeUndefined();
    mocks.search.mockImplementation(fakeSearch);
    await expect(search(BROAD_TOPIC, {})).resolves.toMatchObject({
      estimatedTotalHits: expect.any(Number),
    });
  });

  it('adds nothing once the filtered result holds 10 or more rows', async () => {
    const result = await search(BROAD_TOPIC, { hostsUndergrads: true });

    expect(result.estimatedTotalHits).toBeGreaterThanOrEqual(10);
    expect(result).not.toHaveProperty('moreTopicResults');
  });

  it('adds nothing to a name search', async () => {
    const result = await search(NAME_QUERY, { hostsUndergrads: true });

    const unfiltered = await search(NAME_QUERY, {});

    expect(result.estimatedTotalHits).toBe(1);
    expect(unfiltered.estimatedTotalHits).toBe(2);
    expect(result).not.toHaveProperty('moreTopicResults');
  });

  it('adds nothing under an explicit sort', async () => {
    const result = await search(
      THIN_TOPIC,
      { hostsUndergrads: true },
      { sort: { sortBy: 'name', sortOrder: 'asc' } },
    );

    expect(result.estimatedTotalHits).toBeLessThan(10);
    expect(result).not.toHaveProperty('moreTopicResults');
  });

  it('adds nothing past page 1', async () => {
    const result = await search(THIN_TOPIC, { hostsUndergrads: true }, { page: 2, pageSize: 2 });

    expect(result.researchEntities.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('moreTopicResults');
  });

  it('adds nothing to an empty query or a search without an access filter', async () => {
    const browse = await search('', { hostsUndergrads: true, departments: ['Chemistry'] });
    const unfiltered = await search(THIN_TOPIC, { departments: ['Earth & Planetary Sciences'] });

    expect(browse).not.toHaveProperty('moreTopicResults');
    expect(unfiltered).not.toHaveProperty('moreTopicResults');
  });
});
