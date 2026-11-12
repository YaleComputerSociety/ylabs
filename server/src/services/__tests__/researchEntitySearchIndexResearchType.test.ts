import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  optionalPublicLeadMemberNames: vi.fn(),
}));

vi.mock('../researchGroupService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../researchGroupService')>()),
  optionalPublicLeadMemberNames: mocks.optionalPublicLeadMemberNames,
}));

const {
  buildResearchEntitySearchIndexDocument,
  fetchResearchEntitySearchServedLeads,
  getResearchEntitySearchIndexSettings,
} = await import('../researchEntitySearchIndexService');
const {
  decideServedResearchEntityCreativePractice,
  researchEntityListServedSource,
  toPublicResearchEntityDto,
} = await import('../researchEntityDto');

const PRACTICE_BODY =
  'Fixture Violinist has performed with orchestras across North America and Europe and appears regularly in recital at chamber music festivals. Her recordings of contemporary sonatas were released on two labels, and she has premiered works written for her by several living composers.';
const RESEARCH_BODY =
  'Fixture Theorist studies how listeners perceive meter in contemporary orchestral music, combining corpus analysis of scores with experiments on rhythm cognition, and has published widely on the history of music theory.';
const LAB_BODY =
  'The lab studies how example membranes pass signals between cells, combining imaging and computational modelling of membrane proteins.';

const musicRow = (id: string, fullDescription: string) => ({
  _id: id,
  slug: `fixture-${id}`,
  name: `Fixture ${id} Faculty Research`,
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  archived: false,
  departments: ['Music'],
  school: 'School of Music',
  researchAreas: ['Music'],
  studentVisibilityTier: 'student_ready',
  studentVisibilityReasons: ['source_backed_description'],
  fullDescription,
  sourceUrls: [`https://music.example.edu/people/${id}`],
});

const PRACTICE_ROW = musicRow('practice-violin', PRACTICE_BODY);
const RESEARCH_ROW = musicRow('research-theory', RESEARCH_BODY);
const LAB_ROW = {
  _id: 'membrane-lab',
  slug: 'fixture-membrane-lab',
  name: 'Fixture Membrane Signalling Lab',
  kind: 'lab',
  entityType: 'LAB',
  archived: false,
  departments: ['Physics'],
  studentVisibilityTier: 'student_ready',
  studentVisibilityReasons: ['source_backed_description'],
  fullDescription: LAB_BODY,
  sourceUrls: ['https://membranes.example.edu/'],
};

afterEach(() => {
  mocks.optionalPublicLeadMemberNames.mockReset();
});

describe('the research type index fields (#5141)', () => {
  it('indexes a creative practice row under the creative practice research type', () => {
    expect(buildResearchEntitySearchIndexDocument(PRACTICE_ROW)).toMatchObject({
      entityType: 'FACULTY_RESEARCH_AREA',
      researchType: 'CREATIVE_PRACTICE',
      creativePractice: true,
    });
  });

  it.each([
    [RESEARCH_ROW, 'FACULTY_RESEARCH_AREA'],
    [LAB_ROW, 'LAB'],
  ])('indexes any other row under its own entity type: %s', (row, researchType) => {
    const document = buildResearchEntitySearchIndexDocument(row);

    expect(document?.researchType).toBe(researchType);
    expect(document).not.toHaveProperty('creativePractice');
  });

  it.each([PRACTICE_ROW, RESEARCH_ROW, LAB_ROW])(
    'buckets a row where its browse card label puts it: %s',
    (row) => {
      const leadMemberNames = ['Fixture Lead'];
      const document = buildResearchEntitySearchIndexDocument(row, undefined, { leadMemberNames });
      const card = toPublicResearchEntityDto(
        researchEntityListServedSource(row, leadMemberNames, false),
        { forList: true, leadMemberNames },
      );
      const decision = decideServedResearchEntityCreativePractice(
        researchEntityListServedSource(row, leadMemberNames, false),
        leadMemberNames,
      );

      expect(document?.creativePractice === true).toBe(card.creativePractice === true);
      expect(document?.creativePractice === true).toBe(decision.creativePractice);
    },
  );

  it('declares both derived fields filterable', () => {
    expect(getResearchEntitySearchIndexSettings().filterableAttributes).toEqual(
      expect.arrayContaining(['researchType', 'creativePractice']),
    );
  });
});

describe('the served lead read the index builds from', () => {
  it('carries the browse route lead names, director flag and emeritus way-in per row', async () => {
    mocks.optionalPublicLeadMemberNames.mockResolvedValue({
      byEntityId: new Map([['row-a', ['Fixture Lead A']]]),
      identityLeadDirectorEntityIds: new Set(['row-b']),
      emeritusWayInByEntityId: new Map([['row-c', { emeritusLed: true, wayInWithheld: true }]]),
      unavailable: false,
    });

    const read = await fetchResearchEntitySearchServedLeads([{ _id: 'row-a' }]);

    expect(mocks.optionalPublicLeadMemberNames).toHaveBeenCalledWith([{ _id: 'row-a' }], {
      withEmeritusWayIn: true,
    });
    expect(read.get('row-a')).toEqual({
      leadMemberNames: ['Fixture Lead A'],
      identityLeadDirectsOrganization: false,
      emeritusWayIn: undefined,
    });
    expect(read.get('row-b')?.identityLeadDirectsOrganization).toBe(true);
    expect(read.get('row-c')?.emeritusWayIn).toEqual({ emeritusLed: true, wayInWithheld: true });
  });

  it('fails the build when the read cannot decide', async () => {
    mocks.optionalPublicLeadMemberNames.mockResolvedValue({
      byEntityId: new Map(),
      unavailable: true,
    });

    await expect(fetchResearchEntitySearchServedLeads([{ _id: 'row-a' }])).rejects.toThrow(
      /served lead read failed/,
    );
  });
});
