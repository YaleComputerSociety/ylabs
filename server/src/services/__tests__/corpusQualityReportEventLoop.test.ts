import { describe, expect, it, vi } from 'vitest';

const SERVED_ROW_COUNT = 120;

const servedRows = Array.from({ length: SERVED_ROW_COUNT }, (_, index) => ({
  _id: `synthetic-entity-${index}`,
  slug: `synthetic-entity-${index}`,
  name: `Synthetic Imaging Lab ${index}`,
  school: index % 2 === 0 ? 'Synthetic School A' : 'Synthetic School B',
  studentVisibilityTier: 'student_ready',
  researchAreas: ['Imaging'],
  websiteUrl: index % 3 === 0 ? 'https://example.test/lab' : '',
  shortDescription: 'The lab studies synthetic imaging methods for cell biology.',
  fullDescription:
    'The lab studies synthetic imaging methods for cell biology. Students build microscopes and analyse data.',
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    countDocuments: async () => SERVED_ROW_COUNT,
    aggregate: async () => [{ tier: 'student_ready', count: SERVED_ROW_COUNT }],
    find: () => ({ lean: async () => servedRows }),
  },
}));

vi.mock('../researchEntityMembershipAccessor', () => ({
  getResearchEntityRosterByEntityId: async () => new Map(),
}));

const { readCorpusQualityReport, readCorpusCoverageCounts, servedRowFacts } =
  await import('../corpusQualityReport');
const { buildCorpusQualityReport } = await import('../corpusQualityReportCore');

describe('readCorpusQualityReport on the serving event loop (#4193)', () => {
  it('gives the event loop a turn for every served row it measures', async () => {
    let turns = 0;
    let measuring = true;
    const countTurns = () => {
      if (!measuring) return;
      turns += 1;
      setImmediate(countTurns);
    };
    setImmediate(countTurns);

    await readCorpusQualityReport(new Date('2026-10-02T00:00:00.000Z'));
    measuring = false;

    expect(turns).toBeGreaterThanOrEqual(SERVED_ROW_COUNT);
  });

  it('records the same report as measuring every row in one synchronous pass', async () => {
    const generatedAt = new Date('2026-10-02T00:00:00.000Z');
    const reference = buildCorpusQualityReport({
      facts: servedRows.map((row) => servedRowFacts(row, [])),
      corpus: await readCorpusCoverageCounts(),
      generatedAt,
    });

    expect(await readCorpusQualityReport(generatedAt)).toEqual(reference);
  });
});
