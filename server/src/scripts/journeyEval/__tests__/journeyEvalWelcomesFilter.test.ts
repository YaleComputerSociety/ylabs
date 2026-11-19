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

const caseInvariants = async (
  caseId: string,
  cards: Array<Record<string, unknown>>,
  degraded = false,
  requests: BrowseRequest[] = [],
) => {
  const journeyCase = journeyCases.find((candidate) => candidate.id === caseId)!;
  return Object.fromEntries(
    (
      await journeyCase.run(syntheticContext(cards as never, 10, requests, degraded))
    ).invariants.map((invariant) => [invariant.id, invariant]),
  );
};

const mentorsEntry = {
  signal: 'mentors',
  kind: 'advised',
  source: 'x',
  sourceUrl: 'https://x.example.edu/',
};

describe('the Undergrads group has no works-with case (#5963)', () => {
  it('drops the umbrella case with the umbrella option', () => {
    expect(journeyCases.map((candidate) => candidate.id)).not.toContain(
      'works-with-filter-serves-a-signal',
    );
  });
});

describe('hosted-filter-serves-the-badge case (#5963)', () => {
  it('browses under the hosted filter and passes when every card serves the hosted badge', async () => {
    const requests: BrowseRequest[] = [];
    const invariants = await caseInvariants(
      'hosted-filter-serves-the-badge',
      [{ slug: 'synthetic-hosted', hasUndergradHostingEvidence: true }],
      false,
      requests,
    );

    expect(invariants['hosted-filter-rows-serve-the-badge']).toMatchObject({ status: 'pass' });
    expect(invariants['hosted-filtered-browse-is-not-degraded']).toMatchObject({
      status: 'pass',
    });
    expect(requests.map((request) => request.filters)).toEqual([{ hostsUndergrads: true }]);
  });

  it('fails on a card that serves only a welcomes badge', async () => {
    const invariants = await caseInvariants('hosted-filter-serves-the-badge', [
      { slug: 'synthetic-hosted', hasUndergradHostingEvidence: true },
      { slug: 'synthetic-welcomes', welcomesUndergrads: true },
    ]);

    expect(invariants['hosted-filter-rows-serve-the-badge']).toMatchObject({
      status: 'fail',
      detail: { served: 2, withoutBadge: 1 },
    });
  });
});

describe('advises-filter-serves-a-mentors-entry case (#5963)', () => {
  it('browses under the mentors filter and passes when every card serves a mentors entry', async () => {
    const requests: BrowseRequest[] = [];
    const invariants = await caseInvariants(
      'advises-filter-serves-a-mentors-entry',
      [{ slug: 'synthetic-mentors', undergradListEvidence: [mentorsEntry] }],
      false,
      requests,
    );

    expect(invariants['advises-filter-rows-serve-a-mentors-entry']).toMatchObject({
      status: 'pass',
    });
    expect(requests.map((request) => request.filters)).toEqual([{ mentorsUndergrads: true }]);
  });

  it('fails on a card whose advising-now entry was withheld, or that serves only hosting', async () => {
    const invariants = await caseInvariants('advises-filter-serves-a-mentors-entry', [
      { slug: 'synthetic-mentors', undergradListEvidence: [mentorsEntry] },
      { slug: 'synthetic-withheld', undergradListEvidence: [] },
      { slug: 'synthetic-hosted', hasUndergradHostingEvidence: true },
    ]);

    expect(invariants['advises-filter-rows-serve-a-mentors-entry']).toMatchObject({
      status: 'fail',
      detail: { served: 3, withoutBadge: 2 },
    });
  });

  it('fails when the filtered browse is degraded, since a degraded card cannot withhold a way in', async () => {
    const invariants = await caseInvariants(
      'advises-filter-serves-a-mentors-entry',
      [{ slug: 'synthetic-mentors', undergradListEvidence: [mentorsEntry] }],
      true,
    );

    expect(invariants['advises-filtered-browse-is-not-degraded']).toMatchObject({
      status: 'fail',
      detail: { pagesWalked: 1, degradedPages: 1 },
    });
  });
});

describe('undergrad-option-count-agreement case (#5963)', () => {
  const optionCase = journeyCases.find(
    (candidate) => candidate.id === 'undergrad-option-count-agreement',
  )!;

  type Row = { welcomesUndergrads?: true; hostsUndergrads?: true; mentorsUndergrads?: true };
  const rows: Row[] = [
    { welcomesUndergrads: true, hostsUndergrads: true },
    { hostsUndergrads: true, mentorsUndergrads: true },
    { mentorsUndergrads: true },
    { welcomesUndergrads: true, mentorsUndergrads: true, hostsUndergrads: true },
    {},
  ];
  const optionKeys = ['welcomesUndergrads', 'hostsUndergrads', 'mentorsUndergrads'] as const;

  const allSemanticsContext = (countFor: (matching: Row[], key: keyof Row) => number) => {
    const requests: BrowseRequest[] = [];
    const context: JourneyEvalContext = {
      ...syntheticContext([], 10),
      browse: async (request) => {
        requests.push(request);
        const selection = (request.filters ?? {}) as Row;
        const matching = rows.filter((row) =>
          optionKeys.every((key) => selection[key] !== true || row[key] === true),
        );
        return {
          researchEntities: [],
          estimatedTotalHits: matching.length,
          degraded: false,
          facetDistribution: Object.fromEntries(
            optionKeys.map((key) => [key, { true: countFor(matching, key) }]),
          ),
        };
      },
    };
    return { context, requests };
  };

  const conjunctiveCount = (matching: Row[], key: keyof Row) =>
    matching.filter((row) => row[key] === true).length;

  it('passes when every option count is the total of the selection with that option ticked', async () => {
    const { context, requests } = allSemanticsContext(conjunctiveCount);
    const [agreement, notDegraded] = (await optionCase.run(context)).invariants;

    expect(agreement).toMatchObject({
      id: 'undergrad-option-count-agrees-with-added-total',
      status: 'pass',
      detail: { checked: 9 },
    });
    expect(notDegraded).toMatchObject({ status: 'pass' });
    expect(requests.map((request) => request.filters)).toContainEqual({
      welcomesUndergrads: true,
      mentorsUndergrads: true,
    });
  });

  it('fails when an option counts rows matching it alone instead of the whole selection', async () => {
    const { context } = allSemanticsContext(
      (_matching, key) => rows.filter((row) => row[key] === true).length,
    );
    const [agreement] = (await optionCase.run(context)).invariants;

    expect(agreement.status).toBe('fail');
  });
});
