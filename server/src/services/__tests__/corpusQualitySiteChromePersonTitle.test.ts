import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  observations: [] as Array<Record<string, unknown>>,
  researchers: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../models/observation', () => ({
  Observation: { find: () => ({ lean: async () => state.observations }) },
}));

vi.mock('../../models/researcher', () => ({
  Researcher: { find: () => ({ lean: async () => state.researchers }) },
}));

const { readSiteChromePersonTitles } = await import('../corpusQualityReport');
const { buildCorpusQualityReport } = await import('../corpusQualityReportCore');

const SYNTHETIC_MENU =
  'Home About Programs Faculty Directory Emeritus Faculty Staff Students Events News Giving Contact';
const SHARED_APPOINTMENT = 'Associate Professor of Synthetic Studies';
const LONG_REAL_TITLE =
  'Professor of Synthetic Studies and Professor of Imagined Arts in the Synthetic School of Examples';

const reading = (index: number, value: string, host = 'synthetic.example.test') => ({
  _id: `synthetic-observation-${index}`,
  entityKey: `netid:synthetic${index}`,
  value,
  sourceUrl: `https://${host}/people/synthetic-${index}`,
});

beforeEach(() => {
  state.observations = [];
  state.researchers = [];
});

describe('the site chrome person title tripwire (#6199)', () => {
  it('counts a person whose served title is text a site repeats on three or more profiles', async () => {
    state.observations = [1, 2, 3].map((index) => reading(index, SYNTHETIC_MENU));
    state.researchers = [
      { profile: { title: SYNTHETIC_MENU } },
      { profile: { title: SHARED_APPOINTMENT } },
    ];

    const { counts, hits } = await readSiteChromePersonTitles();

    expect(counts).toEqual({ withServableTitle: 2, fromSiteChromeReading: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      host: 'synthetic.example.test',
      subjects: 3,
      researchersServingIt: 1,
      observationIds: [
        'synthetic-observation-1',
        'synthetic-observation-2',
        'synthetic-observation-3',
      ],
    });
  });

  it('reports the reading with no served person as an attributed hit and a zero count', async () => {
    state.observations = [1, 2, 3, 4].map((index) => reading(index, SYNTHETIC_MENU));
    state.researchers = [{ profile: { title: SHARED_APPOINTMENT } }];

    const { counts, hits } = await readSiteChromePersonTitles();

    expect(counts.fromSiteChromeReading).toBe(0);
    expect(hits.map((hit) => [hit.subjects, hit.researchersServingIt])).toEqual([[4, 0]]);
  });

  it('never counts a short appointment many people share', async () => {
    state.observations = [1, 2, 3, 4, 5].map((index) => reading(index, SHARED_APPOINTMENT));
    state.researchers = [{ profile: { title: SHARED_APPOINTMENT } }];

    expect((await readSiteChromePersonTitles()).hits).toEqual([]);
  });

  it('never counts a long real title read on only two profiles', async () => {
    state.observations = [1, 2].map((index) => reading(index, LONG_REAL_TITLE));
    state.researchers = [{ profile: { title: LONG_REAL_TITLE } }];

    const { counts, hits } = await readSiteChromePersonTitles();

    expect(hits).toEqual([]);
    expect(counts.fromSiteChromeReading).toBe(0);
  });

  it('counts subjects per host, so one value on three hosts is not site chrome', async () => {
    state.observations = ['a', 'b', 'c'].map((host, index) =>
      reading(index, SYNTHETIC_MENU, `${host}.example.test`),
    );

    expect((await readSiteChromePersonTitles()).hits).toEqual([]);
  });

  it('counts one subject read twice once', async () => {
    state.observations = [
      reading(1, SYNTHETIC_MENU),
      { ...reading(1, SYNTHETIC_MENU), _id: 'synthetic-observation-1-again' },
      reading(2, SYNTHETIC_MENU),
    ];

    expect((await readSiteChromePersonTitles()).hits).toEqual([]);
  });

  it('counts one researcher read under a netid key and a researcher key once', async () => {
    state.researchers = [
      { _id: 'synthetic-researcher-1', identifiers: { netid: 'synthetic1' } },
      { _id: 'synthetic-researcher-2', identifiers: { netid: 'synthetic2' } },
    ];
    state.observations = [
      reading(1, SYNTHETIC_MENU),
      { ...reading(9, SYNTHETIC_MENU), entityKey: 'synthetic-researcher-1' },
      reading(2, SYNTHETIC_MENU),
    ];

    expect((await readSiteChromePersonTitles()).hits).toEqual([]);
  });

  it('records the count as an integrity failure over people with a served title', () => {
    const report = buildCorpusQualityReport({
      facts: [],
      corpus: { entities: 0, archived: 0, studentReady: 0, byTier: [] },
      personTitles: { withServableTitle: 40, fromSiteChromeReading: 2 },
    });

    expect(report.integrity.personTitleFromSiteChromeReading).toEqual({ n: 2, of: 40 });
  });
});
