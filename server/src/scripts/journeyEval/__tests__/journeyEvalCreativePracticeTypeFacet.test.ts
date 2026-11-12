import { describe, expect, it } from 'vitest';
import {
  journeyCases,
  type BrowseRequest,
  type JourneyEvalContext,
  type ServedBrowseResult,
} from '../journeyEvalCases';
import type { CorpusFingerprint } from '../journeyEvalMetrics';

const steadyCorpus: CorpusFingerprint = {
  rowCount: 5,
  latestUpdatedAt: '2026-11-12T12:00:00.000Z',
};

const RESEARCH_BODY =
  'Fixture Theorist studies how listeners perceive meter in contemporary orchestral music, combining corpus analysis of scores with experiments on rhythm cognition, and has published widely on the history of music theory.';

const storedResearchRow = (slug: string) => ({
  _id: `id-${slug}`,
  slug,
  name: `Fixture ${slug}`,
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  departments: ['Music'],
  school: 'School of Music',
  fullDescription: RESEARCH_BODY,
});

const splitCase = journeyCases.find(
  (candidate) => candidate.id === 'creative-practice-type-facet-split',
)!;

interface SyntheticCorpus {
  practice: Array<Record<string, unknown>>;
  research: Array<Record<string, unknown>>;
  facet?: Record<string, number>;
  indexLacksResearchType?: boolean;
  indexedResearchType?: Map<string, unknown>;
}

function syntheticContext(corpus: SyntheticCorpus, requests: BrowseRequest[] = []) {
  const bucketRows = (bucket: unknown) =>
    bucket === 'CREATIVE_PRACTICE' ? corpus.practice : corpus.research;
  const context: JourneyEvalContext = {
    browse: async (request): Promise<ServedBrowseResult> => {
      requests.push(request);
      const bucket = (request.filters?.entityType as string[] | undefined)?.[0];
      if (!bucket) {
        return {
          researchEntities: [],
          estimatedTotalHits: corpus.practice.length + corpus.research.length,
          degraded: false,
          facetDistribution: {
            entityType: corpus.facet ?? {
              CREATIVE_PRACTICE: corpus.practice.length,
              FACULTY_RESEARCH_AREA: corpus.research.length,
            },
          },
        };
      }
      if (corpus.indexLacksResearchType && bucket === 'CREATIVE_PRACTICE') {
        return {
          researchEntities: [...corpus.practice, ...corpus.research],
          estimatedTotalHits: corpus.practice.length + corpus.research.length,
          degraded: false,
          appliedFilters: { entityType: [] },
        };
      }
      const rows = bucketRows(bucket);
      return { researchEntities: rows, estimatedTotalHits: rows.length, degraded: false };
    },
    readStoredRows: async (keys) =>
      new Map(keys.map((key) => [key, storedResearchRow(key) as Record<string, unknown>])),
    readIndexedSortKeys: async (_attribute, keys) =>
      new Map(
        keys.map((key) => [key, corpus.indexedResearchType?.get(key) ?? 'FACULTY_RESEARCH_AREA']),
      ),
    readLeadMemberNames: async () => ({ byEntityId: new Map(), unavailable: false }),
    readCorpusFingerprint: async () => steadyCorpus,
    readOwnedSlotSurvivorWebsites: async () => ({ survivorsScanned: 0, observations: [] }),
    topicQueryJudgements: null,
    window: 10,
    facetValuesChecked: 0,
    pagesChecked: 1,
  };
  return context;
}

const invariantsOf = async (corpus: SyntheticCorpus, requests?: BrowseRequest[]) =>
  Object.fromEntries(
    (await splitCase.run(syntheticContext(corpus, requests))).invariants.map((invariant) => [
      invariant.id,
      invariant,
    ]),
  );

const practiceCards = ['synthetic-practice-a', 'synthetic-practice-b'].map((slug) => ({
  slug,
  creativePractice: true,
}));
const researchCards = ['synthetic-research-a', 'synthetic-research-b', 'synthetic-research-c'].map(
  (slug) => ({ slug }),
);

describe('creative-practice-type-facet-split case (#5141)', () => {
  it('passes when each bucket serves its label and its count is its filtered total', async () => {
    const requests: BrowseRequest[] = [];
    const invariants = await invariantsOf(
      { practice: practiceCards, research: researchCards },
      requests,
    );

    expect(invariants['type-bucket-rows-serve-its-label'].status).toBe('pass');
    expect(invariants['type-bucket-count-is-its-filtered-total'].status).toBe('pass');
    expect(requests.map((request) => request.filters)).toEqual([
      undefined,
      { entityType: ['CREATIVE_PRACTICE'] },
      { entityType: ['FACULTY_RESEARCH_AREA'] },
    ]);
  });

  it('fails on a faculty research row that serves the label while its index document is fresh', async () => {
    const invariants = await invariantsOf({
      practice: practiceCards,
      research: [...researchCards, { slug: 'synthetic-labelled', creativePractice: true }],
    });

    expect(invariants['type-bucket-rows-serve-its-label']).toMatchObject({
      status: 'fail',
      detail: { unexplained: 1 },
    });
  });

  it('attributes a mislabelled row to a stale index document rather than failing', async () => {
    const invariants = await invariantsOf({
      practice: [...practiceCards, { slug: 'synthetic-stale' }],
      research: researchCards,
      indexedResearchType: new Map([['synthetic-stale', 'CREATIVE_PRACTICE']]),
    });

    expect(invariants['type-bucket-rows-serve-its-label'].status).toBe('inconclusive');
  });

  it('fails when a bucket count is not the total its filter returns', async () => {
    const invariants = await invariantsOf({
      practice: practiceCards,
      research: researchCards,
      facet: { CREATIVE_PRACTICE: 3, FACULTY_RESEARCH_AREA: 3 },
    });

    expect(invariants['type-bucket-count-is-its-filtered-total']).toMatchObject({
      status: 'fail',
      detail: { disagreements: ['CREATIVE_PRACTICE'] },
    });
  });

  it('is inconclusive on an index that does not declare the research type', async () => {
    const invariants = await invariantsOf({
      practice: practiceCards,
      research: researchCards,
      indexLacksResearchType: true,
    });

    expect(invariants['type-bucket-rows-serve-its-label'].status).toBe('inconclusive');
    expect(invariants['type-bucket-count-is-its-filtered-total'].status).toBe('inconclusive');
  });

  it('is inconclusive when the creative practice bucket serves no row', async () => {
    const invariants = await invariantsOf({ practice: [], research: researchCards });

    expect(invariants['type-bucket-rows-serve-its-label'].status).toBe('inconclusive');
  });
});
