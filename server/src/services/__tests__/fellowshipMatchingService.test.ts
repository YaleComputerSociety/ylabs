import { describe, expect, it } from 'vitest';
import {
  matchFellowshipsForPathways,
  scoreFellowshipForPathway,
} from '../fellowshipMatchingService';
import type { PathwaySearchHit } from '../pathwaySearchService';

const pathway = (overrides: Partial<PathwaySearchHit> = {}): PathwaySearchHit => ({
  _id: 'pathway-1',
  pathwayType: 'EXPLORATORY_CONTACT',
  status: 'PLAUSIBLE',
  evidenceStrength: 'INDIRECT',
  studentFacingLabel: 'Exploratory outreach',
  bestNextStepCategory: 'plan-outreach',
  compensation: 'UNKNOWN',
  sourceUrls: [],
  researchEntity: {
    _id: 'entity-1',
    slug: 'smith-lab',
    name: 'Smith Lab',
    departments: ['Molecular Biophysics and Biochemistry'],
    researchAreas: ['RNA Biology'],
  },
  evidence: [{ signalType: 'FELLOWSHIP_COMPATIBLE', confidence: 'HIGH' }],
  ...overrides,
});

describe('fellowshipMatchingService', () => {
  it('rejects graduate-only awards for an undergraduate', () => {
    expect(scoreFellowshipForPathway(pathway(), {
      _id: 'graduate-only', title: 'Graduate Research Award', yearOfStudy: ['Graduate students'],
      summary: 'RNA biology research project', applicationLink: 'https://example.edu/apply',
    }, new Date('2026-01-01'), { userType: 'undergraduate', classYear: 2029 })).toBeNull();
  });

  it('uses class year and term metadata without treating missing metadata as ineligible', () => {
    const firstYear = scoreFellowshipForPathway(pathway(), {
      _id: 'first-year', title: 'RNA Summer Research Award', yearOfStudy: ['First-year'],
      termOfAward: ['Summer'], summary: 'RNA biology research', applicationLink: 'https://example.edu/apply',
    }, new Date('2026-01-01'), { userType: 'undergraduate', classYear: 2030 });
    const unknown = scoreFellowshipForPathway(pathway(), {
      _id: 'unknown-level', title: 'RNA Research Award', summary: 'RNA biology research',
      applicationLink: 'https://example.edu/apply',
    }, new Date('2026-01-01'), { userType: 'undergraduate', classYear: 2029 });
    expect(firstYear?.reasons).toContain('This program lists first-year students among the years it considers.');
    expect(unknown).not.toBeNull();
  });

  it.each([
    [2029, 'sophomore'],
    [2027, 'senior'],
  ])('explains a matching class year for %s', (classYear, label) => {
    const match = scoreFellowshipForPathway(pathway(), {
      _id: `level-${label}`, title: 'RNA Research Award', yearOfStudy: [label],
      summary: 'RNA biology research', applicationLink: 'https://example.edu/apply',
    }, new Date('2026-01-01'), { userType: 'undergraduate', classYear });
    expect(match?.reasons).toContain(`This program lists ${label} students among the years it considers.`);
  });

  it('prefers academic-year awards for thesis plans and demotes summer-only awards', () => {
    const base = { summary: 'RNA biology research project', applicationLink: 'https://example.edu/apply' };
    const academic = scoreFellowshipForPathway(pathway({ pathwayType: 'SENIOR_THESIS' }),
      { ...base, _id: 'academic', title: 'Academic Year RNA Award', termOfAward: ['Academic year'] });
    const summer = scoreFellowshipForPathway(pathway({ pathwayType: 'SENIOR_THESIS' }),
      { ...base, _id: 'summer', title: 'Summer RNA Award', termOfAward: ['Summer'] });
    expect(academic!.score).toBeGreaterThan(summer!.score);
    expect(summer?.caveats).toContain('This is listed as a summer award, which may not fit an academic-year thesis plan.');
  });

  it.each(['', 'Menu', 'AAAAAAA!!!!!!!!', 'x'.repeat(241)])('never surfaces a garbage title: %s', (title) => {
    expect(scoreFellowshipForPathway(pathway(), { _id: 'junk', title, summary: 'RNA biology research project' })).toBeNull();
  });
  it('scores source-backed fellowship project matches with reasons and caveats', () => {
    const match = scoreFellowshipForPathway(
      pathway(),
      {
        _id: 'fellowship-1',
        title: 'Summer RNA Research Fellowship',
        summary: 'Supports undergraduate research projects in RNA biology.',
        purpose: ['Research'],
        isAcceptingApplications: true,
        deadline: '2026-06-01T00:00:00.000Z',
        applicationLink: 'https://example.edu/apply',
        contactEmail: 'fellowships@example.edu',
      },
      new Date('2026-05-12T00:00:00.000Z'),
    );

    expect(match).toMatchObject({
      fellowshipId: 'fellowship-1',
      pathwayId: 'pathway-1',
      strength: 'confirmed_by_source',
      isAcceptingApplications: true,
      sourceUrls: ['https://example.edu/apply'],
      applicationCycle: {
        sourceBacked: true,
        activeCycle: true,
        nextCycleSignal: false,
        supportsFellowshipFundedProject: true,
        supportsFellowshipCompatible: true,
        supportsOfficialApplicationRoute: true,
        deadlineHasNotPassed: true,
      },
    });
    expect(match?.applicationCycle).not.toHaveProperty('contactEmail');
    expect(match?.score).toBeGreaterThanOrEqual(70);
    expect(match?.reasons).toEqual(
      expect.arrayContaining([
        'Saved pathway has evidence that past student projects were fellowship-compatible.',
      ]),
    );
    expect(match?.caveats).toContain(
      'Text and source overlap do not confirm eligibility; verify the fellowship source.',
    );
  });

  it('redacts direct contact text from public fellowship funding matches', () => {
    const match = scoreFellowshipForPathway(
      pathway(),
      {
        _id: 'fellowship-contact',
        title: 'Summer RNA Research Fellowship',
        summary: 'Supports undergraduate research projects in RNA biology.',
        purpose: ['Research'],
        applicationLink: 'https://example.edu/apply',
        contactOffice: 'Office contact: fellowships@example.edu or 203-555-1212.',
        isAcceptingApplications: true,
        deadline: '2026-06-01T00:00:00.000Z',
      },
      new Date('2026-05-12T00:00:00.000Z'),
    );

    expect(match?.contactOffice).toBe('Office contact: [email redacted] or [phone redacted].');
    expect(match?.applicationCycle.contactOffice).toBe(
      'Office contact: [email redacted] or [phone redacted].',
    );
  });

  it('does not mark high-scoring matches as source-confirmed without a source URL', () => {
    const match = scoreFellowshipForPathway(
      pathway(),
      {
        _id: 'fellowship-no-source',
        title: 'Summer RNA Research Fellowship',
        summary: 'Supports undergraduate research projects in RNA biology.',
        purpose: ['Research'],
        isAcceptingApplications: true,
        deadline: '2026-06-01T00:00:00.000Z',
      },
      new Date('2026-05-12T00:00:00.000Z'),
    );

    expect(match).toMatchObject({
      fellowshipId: 'fellowship-no-source',
      strength: 'candidate',
      sourceUrls: [],
      applicationCycle: {
        sourceBacked: false,
        activeCycle: false,
        nextCycleSignal: false,
        supportsFellowshipFundedProject: false,
      },
    });
    expect(match?.caveats).toContain('No fellowship source URL is available in the record.');
  });

  it('uses official link rows as fellowship source URLs', () => {
    const match = scoreFellowshipForPathway(
      pathway(),
      {
        _id: 'fellowship-links',
        title: 'Summer RNA Research Fellowship',
        summary: 'Supports undergraduate research projects in RNA biology.',
        purpose: ['Research'],
        links: [
          { label: 'Program page', url: 'https://example.edu/program' },
          { label: 'Duplicate', url: 'https://example.edu/program' },
        ],
        isAcceptingApplications: true,
        deadline: '2026-06-01T00:00:00.000Z',
      },
      new Date('2026-05-12T00:00:00.000Z'),
    );

    expect(match?.sourceUrls).toEqual(['https://example.edu/program']);
    expect(match?.applicationCycle.sourceUrls).toEqual(['https://example.edu/program']);
    expect(match?.strength).toBe('candidate');
  });

  it('does not return unsafe raw fellowship application links in matches', () => {
    const match = scoreFellowshipForPathway(
      pathway(),
      {
        _id: 'fellowship-unsafe-application',
        title: 'Summer RNA Research Fellowship',
        summary: 'Supports undergraduate research projects in RNA biology.',
        purpose: ['Research'],
        applicationLink: 'javascript:alert(document.cookie)',
        links: [{ label: 'Program page', url: 'https://example.edu/program' }],
        isAcceptingApplications: true,
        deadline: '2026-06-01T00:00:00.000Z',
      },
      new Date('2026-05-12T00:00:00.000Z'),
    );

    expect(match?.sourceUrls).toEqual(['https://example.edu/program']);
    expect(match?.applicationCycle.applicationLink).toBeUndefined();
    expect(match?.applicationLink).toBeUndefined();
  });

  it('bounds polluted fellowship match text before tokenization', () => {
    const purpose = Array.from({ length: 50 }, (_, index) =>
      index === 0 ? 'RNA biology research project' : `Purpose ${index}`,
    );
    Object.defineProperty(purpose, '50', {
      get: () => {
        throw new Error('fellowship matching read past the text array cap');
      },
      enumerable: true,
    });

    const researchAreas = Array.from({ length: 50 }, (_, index) =>
      index === 0 ? 'RNA Biology' : `Area ${index}`,
    );
    Object.defineProperty(researchAreas, '50', {
      get: () => {
        throw new Error('fellowship matching read past the pathway array cap');
      },
      enumerable: true,
    });

    const match = scoreFellowshipForPathway(
      pathway({
        researchEntity: {
          _id: 'entity-1',
          slug: 'smith-lab',
          name: 'Smith Lab',
          departments: [],
          researchAreas,
        },
      }),
      {
        _id: 'fellowship-bounded-match',
        title: 'Summer RNA Research Fellowship',
        summary: 'x'.repeat(6000),
        purpose,
        applicationLink: 'https://example.edu/apply',
        isAcceptingApplications: true,
        deadline: '2026-06-01T00:00:00.000Z',
      },
      new Date('2026-05-12T00:00:00.000Z'),
    );

    expect(match?.fellowshipId).toBe('fellowship-bounded-match');
    expect(match?.score).toBeGreaterThanOrEqual(70);
  });

  it('does not stringify arbitrary fellowship ids while matching', () => {
    const match = scoreFellowshipForPathway(pathway(), {
      _id: {
        toString: () => {
          throw new Error('fellowship matcher stringified an arbitrary object id');
        },
        toHexString: () => {
          throw new Error('fellowship matcher called arbitrary object id toHexString');
        },
      },
      title: 'Summer RNA Research Fellowship',
      summary: 'Supports undergraduate research projects in RNA biology.',
      applicationLink: 'https://example.edu/apply',
    });

    expect(match).toBeNull();
  });

  it('keeps expired official cycles as next-cycle planning candidates', () => {
    const match = scoreFellowshipForPathway(
      pathway(),
      {
        _id: 'fellowship-expired',
        title: 'Summer RNA Research Fellowship',
        summary: 'Supports undergraduate research projects in RNA biology.',
        purpose: ['Research'],
        applicationLink: 'https://example.edu/apply',
        isAcceptingApplications: true,
        deadline: '2026-05-01T00:00:00.000Z',
      },
      new Date('2026-05-12T00:00:00.000Z'),
    );

    expect(match).toMatchObject({
      fellowshipId: 'fellowship-expired',
      strength: 'candidate',
      applicationCycle: {
        sourceBacked: true,
        activeCycle: false,
        nextCycleSignal: true,
        deadlineHasNotPassed: false,
      },
    });
    expect(match?.reasons).toContain(
      'Past deadline still provides evidence for a likely recurring application cycle.',
    );
    expect(match?.caveats).toContain(
      'Current fellowship deadline appears to have passed; verify the next cycle before applying.',
    );
  });

  it('does not return weak text overlap below the minimum score', () => {
    const match = scoreFellowshipForPathway(
      pathway({
        pathwayType: 'EXPLORATORY_CONTACT',
        bestNextStepCategory: 'plan-outreach',
        compensation: 'UNKNOWN',
      }),
      {
        _id: 'fellowship-2',
        title: 'Travel Award',
        summary: 'Supports travel.',
        isAcceptingApplications: false,
      },
    );

    expect(match).toBeNull();
  });

  it('uses canonical topic aliases to match an AI plan to an AI award', () => {
    const match = scoreFellowshipForPathway(
      pathway({
        compensation: 'VOLUNTEER',
        researchEntity: {
          _id: 'entity-ai',
          slug: 'intelligent-systems',
          name: 'Intelligent Systems Lab',
          departments: ['Computer Science'],
          researchAreas: ['Machine learning systems'],
        },
      }),
      {
        _id: 'schmidt-ai',
        title: 'Schmidt Artificial Intelligence Award',
        summary: 'Funding for AI projects across disciplines.',
        applicationLink: 'https://example.edu/schmidt-ai',
        isAcceptingApplications: true,
        deadline: '2026-09-01T00:00:00.000Z',
      },
      new Date('2026-07-01T00:00:00.000Z'),
    );

    expect(match?.reasons).toContain('Topic match: Artificial Intelligence.');
    expect(match?.score).toBeGreaterThanOrEqual(45);
  });

  it('returns top matches grouped by pathway id', async () => {
    const result = await matchFellowshipsForPathways(['pathway-1'], {
      pathwayReader: async () => [pathway()],
      fellowshipReader: async () => [
        {
          _id: 'fellowship-1',
          title: 'RNA Research Fellowship',
          summary: 'Research project funding for RNA biology.',
          isAcceptingApplications: true,
          deadline: '2026-06-01T00:00:00.000Z',
        },
      ],
    });

    expect(result['pathway-1']).toHaveLength(1);
    expect(result['pathway-1'][0]).toMatchObject({
      fellowshipId: 'fellowship-1',
      pathwayId: 'pathway-1',
    });
  });
});
