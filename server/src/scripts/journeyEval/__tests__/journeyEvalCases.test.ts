import { describe, expect, it } from 'vitest';
import { journeyCases, type JourneyEvalContext } from '../journeyEvalCases';
import type { CorpusFingerprint } from '../journeyEvalMetrics';

const observedAt = '2026-09-30T12:00:00.000Z';
const steadyCorpus: CorpusFingerprint = { rowCount: 2, latestUpdatedAt: observedAt };
const meshProfileProvenance = {
  researchAreas: { sourceUrl: 'https://medicine.yale.edu/profile/synthetic-profile/' },
};

interface SyntheticRow {
  slug: string;
  storedAreas: string[];
  servedAreas: string[];
  fieldProvenance?: unknown;
}

const coherentRow = (row: SyntheticRow) => ({
  slug: row.slug,
  name: 'Synthetic Membrane Transport Laboratory',
  departments: ['Cellular and Molecular Physiology'],
  shortDescription: 'Studies membrane transport proteins and ion channel physiology.',
  fullDescription:
    'The laboratory studies membrane transport proteins, ion channel gating, and epithelial physiology using electrophysiology.',
  researchAreas: row.storedAreas,
  fieldProvenance: row.fieldProvenance,
  lastObservedAt: observedAt,
});

function syntheticContext(rows: SyntheticRow[]): JourneyEvalContext {
  const stored = new Map(rows.map((row) => [row.slug, coherentRow(row)]));
  return {
    browse: async () => ({
      researchEntities: rows.map((row) => ({
        slug: row.slug,
        researchAreas: row.servedAreas,
        lastObservedAt: observedAt,
      })),
    }),
    readStoredRows: async (keys) =>
      new Map(keys.flatMap((key) => (stored.has(key) ? [[key, stored.get(key)!]] : []))),
    readIndexedSortKeys: async () => new Map(),
    readCorpusFingerprint: async () => steadyCorpus,
    readOwnedSlotSurvivorWebsites: async () => ({ survivorsScanned: 0, observations: [] }),
    topicQueryJudgements: null,
    window: rows.length,
    facetValuesChecked: 0,
    pagesChecked: 1,
  };
}

const topicDropCase = journeyCases.find((candidate) => candidate.id === 'topic-drop-attribution')!;

async function invariantStatuses(rows: SyntheticRow[]) {
  const outcome = await topicDropCase.run(syntheticContext(rows));
  return Object.fromEntries(outcome.invariants.map((invariant) => [invariant.id, invariant]));
}

describe('topic-drop-attribution case', () => {
  it('attributes a drop of only place names to the MeSH geographic guard', async () => {
    const invariants = await invariantStatuses([
      {
        slug: 'synthetic-place-drop',
        storedAreas: ['Ion Channels', 'China', 'Membrane Transport Proteins', 'Connecticut'],
        servedAreas: ['Ion Channels', 'Membrane Transport Proteins'],
        fieldProvenance: meshProfileProvenance,
      },
    ]);

    expect(invariants['every-topic-drop-is-attributable']).toMatchObject({
      status: 'pass',
      detail: { dropped: 1, attributedToGuard: 1, unexplained: 0 },
    });
  });

  it('attributes a prose-length chip the served copy withholds to the prose-chip filter', async () => {
    const invariants = await invariantStatuses([
      {
        slug: 'synthetic-prose-chip-drop',
        storedAreas: [
          'Ion Channels',
          'Synthetic Interdisciplinary Training Program in Membrane Transport Biology (SITPMTB)',
        ],
        servedAreas: ['Ion Channels'],
        fieldProvenance: {
          researchAreas: { sourceUrl: 'https://physiology.example.edu/research/' },
        },
      },
    ]);

    expect(invariants['every-topic-drop-is-attributable']).toMatchObject({
      status: 'pass',
      detail: {
        dropped: 1,
        attributedToGuard: 1,
        unexplained: 0,
        drops: [{ attributed: true, withheldBy: ['filterProseResearchAreaChips'] }],
      },
    });
  });

  it('attributes a card serving no topic when every stored topic is a place name', async () => {
    const invariants = await invariantStatuses([
      {
        slug: 'synthetic-places-only',
        storedAreas: ['China', 'Connecticut'],
        servedAreas: [],
        fieldProvenance: meshProfileProvenance,
      },
    ]);

    expect(invariants['every-topic-drop-is-attributable'].status).toBe('pass');
    expect(invariants['serving-no-topic-is-attributable']).toMatchObject({
      status: 'pass',
      detail: { servedNoneWhileStoringSome: 1, servedNoneUnexplained: 0 },
    });
  });

  it('still fails a drop no served topic guard accounts for', async () => {
    const invariants = await invariantStatuses([
      {
        slug: 'synthetic-place-drop',
        storedAreas: ['Ion Channels', 'China', 'Membrane Transport Proteins'],
        servedAreas: ['Ion Channels', 'Membrane Transport Proteins'],
        fieldProvenance: meshProfileProvenance,
      },
      {
        slug: 'synthetic-unexplained-drop',
        storedAreas: ['Ion Channels', 'Membrane Transport Proteins'],
        servedAreas: ['Ion Channels'],
        fieldProvenance: meshProfileProvenance,
      },
    ]);

    expect(invariants['every-topic-drop-is-attributable']).toMatchObject({
      status: 'fail',
      detail: { dropped: 2, attributedToGuard: 1, unexplained: 1 },
    });
  });

  it('does not attribute a place-name drop when the topics were not read from a MeSH-indexed profile', async () => {
    const invariants = await invariantStatuses([
      {
        slug: 'synthetic-area-studies-places',
        storedAreas: ['Ion Channels', 'China'],
        servedAreas: ['Ion Channels'],
        fieldProvenance: {
          researchAreas: { sourceUrl: 'https://area-studies.example.edu/people/' },
        },
      },
    ]);

    expect(invariants['every-topic-drop-is-attributable']).toMatchObject({
      status: 'fail',
      detail: { unexplained: 1 },
    });
  });
});

describe('creative-practice-label-attribution case (#4519)', () => {
  const practiceRow = {
    slug: 'synthetic-practice',
    name: 'Synthetic Performer Faculty Research',
    entityType: 'FACULTY_RESEARCH_AREA',
    departments: ['Music'],
    school: 'School of Music',
    fullDescription:
      'A violinist who has performed with orchestras across Europe, she appears in recital each season and has premiered concertos by living composers.',
    lastObservedAt: observedAt,
  };
  const researchRow = {
    slug: 'synthetic-theory',
    name: 'Synthetic Theorist Faculty Research',
    entityType: 'FACULTY_RESEARCH_AREA',
    departments: ['Music'],
    school: 'School of Music',
    fullDescription:
      'Her research examines how listeners perceive meter in orchestral music, combining corpus analysis with rhythm cognition experiments.',
    lastObservedAt: observedAt,
  };

  const labelContext = (
    servedFlags: Record<string, boolean>,
    corpus: { before: CorpusFingerprint; after: CorpusFingerprint } = {
      before: steadyCorpus,
      after: steadyCorpus,
    },
  ): JourneyEvalContext => {
    const stored = new Map<string, Record<string, unknown>>([
      [practiceRow.slug, practiceRow],
      [researchRow.slug, researchRow],
    ]);
    let fingerprintReads = 0;
    return {
      browse: async () => ({
        researchEntities: [practiceRow, researchRow].map((row) => ({
          slug: row.slug,
          lastObservedAt: observedAt,
          ...(servedFlags[row.slug] ? { creativePractice: true } : {}),
        })),
      }),
      readStoredRows: async (keys) =>
        new Map(keys.flatMap((key) => (stored.has(key) ? [[key, stored.get(key)!]] : []))),
      readIndexedSortKeys: async () => new Map(),
      readCorpusFingerprint: async () => (fingerprintReads++ === 0 ? corpus.before : corpus.after),
      readOwnedSlotSurvivorWebsites: async () => ({ survivorsScanned: 0, observations: [] }),
      topicQueryJudgements: null,
      window: 2,
      facetValuesChecked: 0,
      pagesChecked: 1,
    };
  };

  const labelCase = journeyCases.find(
    (candidate) => candidate.id === 'creative-practice-label-attribution',
  )!;

  it('passes when every card serves the label exactly where the decision does', async () => {
    const outcome = await labelCase.run(labelContext({ [practiceRow.slug]: true }));

    expect(outcome.invariants[0]).toMatchObject({
      id: 'creative-practice-label-is-the-decision',
      status: 'pass',
      detail: { comparable: 2, labelled: 1, disagreeing: 0 },
    });
    expect(outcome.rates[0]).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it('fails when a card serves a label the decision does not make', async () => {
    const outcome = await labelCase.run(
      labelContext({ [practiceRow.slug]: true, [researchRow.slug]: true }),
    );

    expect(outcome.invariants[0]).toMatchObject({ status: 'fail', detail: { disagreeing: 1 } });
  });

  it('fails when a card drops a label the decision makes', async () => {
    const outcome = await labelCase.run(labelContext({}));

    expect(outcome.invariants[0]).toMatchObject({ status: 'fail', detail: { disagreeing: 1 } });
  });

  it('is inconclusive rather than failing when the corpus moved during the read', async () => {
    const outcome = await labelCase.run(
      labelContext(
        {},
        {
          before: steadyCorpus,
          after: { rowCount: 3, latestUpdatedAt: '2026-09-30T12:05:00.000Z' },
        },
      ),
    );

    expect(outcome.invariants[0].status).toBe('inconclusive');
  });
});

describe('default-browse-order-is-repeatable case', () => {
  const defaultBrowseCase = journeyCases.find(
    (candidate) => candidate.id === 'default-browse-order-is-repeatable',
  )!;
  const servedPage = (slugs: string[]) => ({
    degraded: false,
    researchEntities: slugs.map((slug) => ({ slug })),
  });
  const contextServing = (walks: string[][][]): JourneyEvalContext => {
    let call = 0;
    const pagesPerWalk = walks[0].length;
    return {
      browse: async ({ page }) => {
        const walk = walks[Math.min(Math.floor(call / pagesPerWalk), walks.length - 1)];
        call += 1;
        return servedPage(walk[(page ?? 1) - 1]);
      },
      readStoredRows: async () => new Map(),
      readIndexedSortKeys: async () => new Map(),
      readCorpusFingerprint: async () => steadyCorpus,
      readOwnedSlotSurvivorWebsites: async () => ({ survivorsScanned: 0, observations: [] }),
      topicQueryJudgements: null,
      window: 2,
      facetValuesChecked: 0,
      pagesChecked: pagesPerWalk,
    };
  };
  const invariantsOf = async (walks: string[][][]) => {
    const outcome = await defaultBrowseCase.run(contextServing(walks));
    return {
      outcome,
      byId: Object.fromEntries(outcome.invariants.map((invariant) => [invariant.id, invariant])),
    };
  };

  it('passes a fixed order', async () => {
    const pages = [
      ['row-a', 'row-b'],
      ['row-c', 'row-d'],
    ];
    const { outcome, byId } = await invariantsOf([pages, pages]);

    expect(byId['default-browse-order-is-repeatable'].status).toBe('pass');
    expect(byId['no-row-repeats-across-pages'].status).toBe('pass');
    expect(byId['default-browse-is-not-degraded'].status).toBe('pass');
    expect(outcome.rates).toEqual([]);
  });

  it('fails when a second walk over an unchanged corpus reorders rows', async () => {
    const { byId } = await invariantsOf([
      [
        ['row-a', 'row-b'],
        ['row-c', 'row-d'],
      ],
      [
        ['row-a', 'row-c'],
        ['row-b', 'row-d'],
      ],
    ]);

    expect(byId['default-browse-order-is-repeatable'].status).toBe('fail');
  });
});

describe('service-cores-rank-below-research case (#5748)', () => {
  const coreCase = journeyCases.find(
    (candidate) => candidate.id === 'service-cores-rank-below-research',
  )!;
  const storedBySlug: Record<string, Record<string, unknown>> = {
    'synthetic-lab': { entityType: 'LAB', name: 'Synthetic Lab' },
    'synthetic-profile': {
      entityType: 'FACULTY_RESEARCH_AREA',
      name: 'Synthetic Profile',
      shortDescription: 'Studies reaction mechanisms.',
    },
    'synthetic-core': { entityType: 'CORE_FACILITY', name: 'Synthetic Instrument Core' },
    'synthetic-service-profile': {
      entityType: 'FACULTY_RESEARCH_AREA',
      name: 'Synthetic Service Profile',
      shortDescription: 'Provides electron microscopy services and training for users.',
    },
  };
  const contextServing = (slugs: string[]): JourneyEvalContext => ({
    ...syntheticContext([]),
    browse: async () => ({ researchEntities: slugs.map((slug) => ({ slug })) }),
    readStoredRows: async (keys) =>
      new Map(keys.flatMap((key) => (storedBySlug[key] ? [[key, storedBySlug[key]]] : []))),
  });
  const statusOf = async (slugs: string[]) =>
    (await coreCase.run(contextServing(slugs))).invariants[0];

  it('passes when every core the guard demotes sits below the research rows', async () => {
    const invariant = await statusOf(['synthetic-lab', 'synthetic-profile', 'synthetic-core']);
    expect(invariant.status).toBe('pass');
  });

  it('fails when a core or a service-text profile outranks a research row', async () => {
    expect((await statusOf(['synthetic-core', 'synthetic-lab'])).status).toBe('fail');
    expect((await statusOf(['synthetic-service-profile', 'synthetic-lab'])).status).toBe('fail');
  });

  it('is inconclusive when no query served a core', async () => {
    expect((await statusOf(['synthetic-lab', 'synthetic-profile'])).status).toBe('inconclusive');
  });
});

describe('service-cores-rank-below-research-in-browse case (#5748)', () => {
  const browseCase = journeyCases.find(
    (candidate) => candidate.id === 'service-cores-rank-below-research-in-browse',
  )!;
  const rescored = { browseRankScorerVersion: 4, browseRankScore: 22 };
  const storedBySlug: Record<string, Record<string, unknown>> = {
    'synthetic-lab': { entityType: 'LAB', name: 'Synthetic Lab', browseRankScore: 81 },
    'synthetic-core': { entityType: 'CORE_FACILITY', name: 'Synthetic Core', ...rescored },
    'synthetic-stale-core': {
      entityType: 'CORE_FACILITY',
      name: 'Synthetic Stale Core',
      browseRankScorerVersion: 3,
      browseRankScore: 81,
    },
    'synthetic-service-profile': {
      entityType: 'FACULTY_RESEARCH_AREA',
      name: 'Synthetic Service Profile',
      shortDescription: 'Provides electron microscopy services and training for users.',
      ...rescored,
    },
  };
  const contextServing = (slugs: string[], pageSize = slugs.length): JourneyEvalContext => ({
    ...syntheticContext([]),
    window: pageSize,
    browse: async ({ page = 1, pageSize: size = pageSize }) => ({
      estimatedTotalHits: slugs.length,
      researchEntities: slugs.slice((page - 1) * size, page * size).map((slug) => ({ slug })),
    }),
    readStoredRows: async (keys) =>
      new Map(keys.flatMap((key) => (storedBySlug[key] ? [[key, storedBySlug[key]]] : []))),
    readIndexedSortKeys: async (_attribute, keys) =>
      new Map(keys.map((key) => [key, storedBySlug[key]?.browseRankScore])),
  });
  const invariantOf = async (slugs: string[], pageSize?: number) =>
    (await browseCase.run(contextServing(slugs, pageSize))).invariants[0];

  it('passes when every demoted row sits below the research rows, walking every page', async () => {
    const invariant = await invariantOf(
      ['synthetic-lab', 'synthetic-core', 'synthetic-service-profile'],
      1,
    );
    expect(invariant.status).toBe('pass');
    expect(invariant.detail).toMatchObject({
      walk: { total: 3, walked: 3 },
      demotedByReason: { 'core-facility': 1, 'core-service-text': 1 },
    });
  });

  it('fails and names a row not yet rescored by the adjustment', async () => {
    const invariant = await invariantOf(['synthetic-stale-core', 'synthetic-lab']);
    expect(invariant.status).toBe('fail');
    expect(invariant.detail).toMatchObject({
      demotedOutrankingResearch: 1,
      outrankingNotRescoredSinceAdjustment: 1,
      outrankingRescoredAndIndexed: 0,
    });
  });

  it('fails and names a rescored row that still outranks research', async () => {
    const invariant = await invariantOf(['synthetic-service-profile', 'synthetic-lab']);
    expect(invariant.status).toBe('fail');
    expect(invariant.detail).toMatchObject({ outrankingRescoredAndIndexed: 1 });
  });

  it('is inconclusive when the browse served no core', async () => {
    expect((await invariantOf(['synthetic-lab'])).status).toBe('inconclusive');
  });
});
