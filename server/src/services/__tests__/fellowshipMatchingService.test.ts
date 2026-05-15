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
  it('scores source-backed fellowship project matches with reasons and caveats', () => {
    const match = scoreFellowshipForPathway(pathway(), {
      _id: 'fellowship-1',
      title: 'Summer RNA Research Fellowship',
      summary: 'Supports undergraduate research projects in RNA biology.',
      purpose: ['Research'],
      isAcceptingApplications: true,
      deadline: '2026-06-01T00:00:00.000Z',
      applicationLink: 'https://example.edu/apply',
      contactEmail: 'fellowships@example.edu',
    }, new Date('2026-05-12T00:00:00.000Z'));

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

  it('does not mark high-scoring matches as source-confirmed without a source URL', () => {
    const match = scoreFellowshipForPathway(pathway(), {
      _id: 'fellowship-no-source',
      title: 'Summer RNA Research Fellowship',
      summary: 'Supports undergraduate research projects in RNA biology.',
      purpose: ['Research'],
      isAcceptingApplications: true,
      deadline: '2026-06-01T00:00:00.000Z',
    }, new Date('2026-05-12T00:00:00.000Z'));

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
    const match = scoreFellowshipForPathway(pathway(), {
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
    }, new Date('2026-05-12T00:00:00.000Z'));

    expect(match?.sourceUrls).toEqual(['https://example.edu/program']);
    expect(match?.applicationCycle.sourceUrls).toEqual(['https://example.edu/program']);
    expect(match?.strength).toBe('candidate');
  });

  it('keeps expired official cycles as next-cycle planning candidates', () => {
    const match = scoreFellowshipForPathway(pathway(), {
      _id: 'fellowship-expired',
      title: 'Summer RNA Research Fellowship',
      summary: 'Supports undergraduate research projects in RNA biology.',
      purpose: ['Research'],
      applicationLink: 'https://example.edu/apply',
      isAcceptingApplications: true,
      deadline: '2026-05-01T00:00:00.000Z',
    }, new Date('2026-05-12T00:00:00.000Z'));

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
