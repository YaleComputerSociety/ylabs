import { describe, expect, it } from 'vitest';
import { journeyCases, type BrowseRequest, type JourneyEvalContext } from '../journeyEvalCases';
import { checkWelcomesFilterServesTheBadge, type CorpusFingerprint } from '../journeyEvalMetrics';

const steadyCorpus: CorpusFingerprint = {
  rowCount: 3,
  latestUpdatedAt: '2026-11-10T12:00:00.000Z',
};
const movedCorpus: CorpusFingerprint = {
  rowCount: 3,
  latestUpdatedAt: '2026-11-10T12:00:05.000Z',
};

const welcomesCase = journeyCases.find(
  (candidate) => candidate.id === 'welcomes-filter-serves-the-badge',
)!;

function syntheticContext(
  cards: Array<{ slug: string; welcomesUndergrads?: boolean }>,
  window: number,
  requests: BrowseRequest[] = [],
  degraded = false,
): JourneyEvalContext {
  return {
    browse: async (request) => {
      requests.push(request);
      const page = request.page ?? 1;
      const pageSize = request.pageSize ?? window;
      return {
        researchEntities: cards.slice((page - 1) * pageSize, page * pageSize),
        estimatedTotalHits: cards.length,
        degraded,
      };
    },
    readStoredRows: async () => new Map(),
    readIndexedSortKeys: async () => new Map(),
    readCorpusFingerprint: async () => steadyCorpus,
    readOwnedSlotSurvivorWebsites: async () => ({ survivorsScanned: 0, observations: [] }),
    topicQueryJudgements: null,
    window,
    facetValuesChecked: 0,
    pagesChecked: 1,
  };
}

const invariantById = async (context: JourneyEvalContext) =>
  Object.fromEntries(
    (await welcomesCase.run(context)).invariants.map((invariant) => [invariant.id, invariant]),
  );

describe('welcomes-filter-serves-the-badge case', () => {
  it('walks every filtered page and passes when each card serves the badge', async () => {
    const requests: BrowseRequest[] = [];
    const cards = ['synthetic-a', 'synthetic-b', 'synthetic-c'].map((slug) => ({
      slug,
      welcomesUndergrads: true,
    }));
    const invariants = await invariantById(syntheticContext(cards, 2, requests));

    expect(invariants['welcomes-filter-rows-serve-the-badge']).toMatchObject({
      status: 'pass',
      detail: { filterTotal: 3, served: 3, withoutBadge: 0 },
    });
    expect(requests.map((request) => request.filters)).toEqual([
      { welcomesUndergrads: true },
      { welcomesUndergrads: true },
    ]);
  });

  it('fails when the filter returns a row whose card withholds the badge', async () => {
    const invariants = await invariantById(
      syntheticContext(
        [{ slug: 'synthetic-a', welcomesUndergrads: true }, { slug: 'synthetic-withheld' }],
        10,
      ),
    );

    expect(invariants['welcomes-filter-rows-serve-the-badge']).toMatchObject({
      status: 'fail',
      detail: { served: 2, withoutBadge: 1 },
    });
  });

  it('is inconclusive when the filter serves no row', async () => {
    const invariants = await invariantById(syntheticContext([], 10));

    expect(invariants['welcomes-filter-rows-serve-the-badge'].status).toBe('inconclusive');
  });
});

describe('checkWelcomesFilterServesTheBadge', () => {
  it('reads a missing badge on a moving corpus as inconclusive, not a defect', () => {
    const tally = { filterTotal: 2, served: 2, withoutBadge: 1 };

    expect(checkWelcomesFilterServesTheBadge(tally, steadyCorpus, movedCorpus).status).toBe(
      'inconclusive',
    );
    expect(checkWelcomesFilterServesTheBadge(tally, steadyCorpus, steadyCorpus).status).toBe(
      'fail',
    );
  });

  it('passes on a moving corpus when every row serves the badge', () => {
    expect(
      checkWelcomesFilterServesTheBadge(
        { filterTotal: 2, served: 2, withoutBadge: 0 },
        steadyCorpus,
        movedCorpus,
      ).status,
    ).toBe('pass');
  });
});

describe('works-with-filter-serves-a-signal case (#5620)', () => {
  const worksWithCase = journeyCases.find(
    (candidate) => candidate.id === 'works-with-filter-serves-a-signal',
  )!;

  const worksWithInvariants = async (cards: Array<Record<string, unknown>>, degraded = false) =>
    Object.fromEntries(
      (await worksWithCase.run(syntheticContext(cards as never, 10, [], degraded))).invariants.map(
        (invariant) => [invariant.id, invariant],
      ),
    );

  it('passes when every card serves hosted, welcomes or a mentors entry', async () => {
    const invariants = await worksWithInvariants([
      { slug: 'synthetic-hosted', hasUndergradHostingEvidence: true },
      { slug: 'synthetic-welcomes', welcomesUndergrads: true },
      {
        slug: 'synthetic-mentors',
        undergradListEvidence: [
          { signal: 'mentors', kind: 'advised', source: 'x', sourceUrl: 'https://x.example.edu/' },
        ],
      },
    ]);

    expect(invariants['works-with-filter-rows-serve-a-signal']).toMatchObject({ status: 'pass' });
  });

  it('fails on a card that serves no undergraduate signal, such as a withheld advising-now entry', async () => {
    const invariants = await worksWithInvariants([
      { slug: 'synthetic-hosted', hasUndergradHostingEvidence: true },
      { slug: 'synthetic-withheld', undergradListEvidence: [] },
    ]);

    expect(invariants['works-with-filter-rows-serve-a-signal']).toMatchObject({ status: 'fail' });
  });

  it('fails when the filtered browse is degraded, since a degraded card cannot withhold a way in', async () => {
    const invariants = await worksWithInvariants(
      [{ slug: 'synthetic-hosted', hasUndergradHostingEvidence: true }],
      true,
    );

    expect(invariants['works-with-filtered-browse-is-not-degraded']).toMatchObject({
      status: 'fail',
      detail: { pagesWalked: 1, degradedPages: 1 },
    });
  });

  it('passes the degraded check when every filtered page is served by the full search path', async () => {
    const invariants = await worksWithInvariants([
      { slug: 'synthetic-hosted', hasUndergradHostingEvidence: true },
    ]);

    expect(invariants['works-with-filtered-browse-is-not-degraded']).toMatchObject({
      status: 'pass',
    });
  });
});
