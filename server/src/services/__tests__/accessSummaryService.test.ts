import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const mocks = vi.hoisted(() => ({
  accessSignalFind: vi.fn(),
  entryPathwayFind: vi.fn(),
  postedOpportunityFind: vi.fn(),
}));

vi.mock('../../models/signal', () => ({
  Signal: {
    find: mocks.accessSignalFind,
  },
}));

vi.mock('../../models/entryPathway', () => ({
  EntryPathway: {
    find: mocks.entryPathwayFind,
  },
}));

vi.mock('../../models/postedOpportunity', () => ({
  PostedOpportunity: {
    find: mocks.postedOpportunityFind,
  },
}));

import { listAccessSummariesForResearchEntities } from '../accessSummaryService';

const queryMany = (records: any[]) => ({
  sort: vi.fn(() => ({
    lean: vi.fn(async () => records),
  })),
  lean: vi.fn(async () => records),
});

describe('accessSummaryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessSignalFind.mockReturnValue(queryMany([]));
    mocks.entryPathwayFind.mockReturnValue(queryMany([]));
    mocks.postedOpportunityFind.mockReturnValue(queryMany([]));
  });

  it('redacts direct contact evidence and filters unsafe source URLs from public summaries', async () => {
    const entityId = new Types.ObjectId();
    mocks.accessSignalFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          type: 'REACH_OUT_PLAUSIBLE',
          confidence: 'HIGH',
          confidenceScore: 0.9,
          source: {
            excerpt: 'Questions: hidden@example.edu or 203-432-1234.',
            url: 'mailto:hidden@example.edu',
          },
        },
        {
          researchEntityId: entityId,
          type: 'CURRENT_UNDERGRADS',
          confidence: 'MEDIUM',
          source: {
            excerpt: 'Undergraduates are listed on the lab page.',
            url: 'https://lab.example.test/people',
          },
        },
      ]),
    );
    mocks.entryPathwayFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          pathwayType: 'EXPLORATORY_CONTACT',
          bestNextStep: 'Email hidden@example.edu after reading the page.',
        },
      ]),
    );

    const summaries = await listAccessSummariesForResearchEntities([entityId]);
    const summary = summaries.get(entityId.toString());

    expect(summary?.evidence).toEqual([
      {
        signalType: 'REACH_OUT_PLAUSIBLE',
        confidence: 'HIGH',
        excerpt: undefined,
        sourceUrl: undefined,
      },
      {
        signalType: 'CURRENT_UNDERGRADS',
        confidence: 'MEDIUM',
        excerpt: 'Undergraduates are listed on the lab page.',
        sourceUrl: 'https://lab.example.test/people',
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain('[email redacted]');
    expect(JSON.stringify(summary)).not.toContain('[phone redacted]');
    expect(summary?.bestNextStep).toBe('Reach out to ask about opportunities');
    expect(JSON.stringify(summary)).not.toContain('hidden@example.edu');
    expect(JSON.stringify(summary)).not.toContain('203-432-1234');
    expect(JSON.stringify(summary)).not.toContain('mailto:');
  });

  it('keeps substantive evidence sentences while dropping redaction-marker directives (#1076)', async () => {
    const entityId = new Types.ObjectId();
    mocks.accessSignalFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          type: 'CONTACT_INSTRUCTIONS_EXIST',
          confidence: 'HIGH',
          confidenceScore: 0.9,
          source: {
            excerpt: 'We welcome undergraduate researchers year-round. Email us at intake@example.edu.',
            url: 'https://lab.example.test/join',
          },
        },
        {
          researchEntityId: entityId,
          type: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          source: {
            excerpt: 'Contact: <intake@example.edu>',
            url: 'https://lab.example.test/contact',
          },
        },
      ]),
    );

    const summaries = await listAccessSummariesForResearchEntities([entityId]);
    const summary = summaries.get(entityId.toString());

    expect(summary?.evidence).toEqual([
      {
        signalType: 'CONTACT_INSTRUCTIONS_EXIST',
        confidence: 'HIGH',
        excerpt: 'We welcome undergraduate researchers year-round.',
        sourceUrl: 'https://lab.example.test/join',
      },
      {
        signalType: 'REACH_OUT_PLAUSIBLE',
        confidence: 'MEDIUM',
        excerpt: undefined,
        sourceUrl: 'https://lab.example.test/contact',
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain('redacted');
    expect(JSON.stringify(summary)).not.toContain('intake@example.edu');
  });

  it('bounds public summary shaping without stringifying polluted record values', async () => {
    const entityId = new Types.ObjectId();
    const unsafeEntityId = {
      toString: () => {
        throw new Error('access summary stringified an arbitrary returned entity id');
      },
      toHexString: () => {
        throw new Error('access summary called arbitrary returned entity id toHexString');
      },
    };
    const queryEntityIds = [entityId, ...Array.from({ length: 99 }, () => new Types.ObjectId())];
    Object.defineProperty(queryEntityIds, '100', {
      get: () => {
        throw new Error('access summary read past the entity id cap');
      },
      enumerable: true,
    });

    mocks.accessSignalFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          type: 'CURRENT_UNDERGRADS',
          confidence: 'HIGH',
          confidenceScore: 0.9,
          source: {
            excerpt: 'x'.repeat(3000),
            url: {
              toString: () => {
                throw new Error('access summary stringified an arbitrary source URL');
              },
            },
          },
        },
        {
          researchEntityId: entityId,
          type: {
            toString: () => {
              throw new Error('access summary stringified an arbitrary signal type');
            },
          },
          confidence: 'LOW',
          source: {
            excerpt: 'ignored signal type',
            url: 'https://lab.example.test/ignored',
          },
        },
        {
          researchEntityId: unsafeEntityId,
          type: 'POSTED_OPENING',
          confidence: 'HIGH',
          source: { excerpt: 'unsafe entity id row must be skipped' },
        },
      ]),
    );
    mocks.entryPathwayFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          pathwayType: 'EXPLORATORY_CONTACT',
          bestNextStep: {
            toString: () => {
              throw new Error('access summary stringified an arbitrary next step');
            },
          },
        },
        {
          researchEntityId: unsafeEntityId,
          pathwayType: 'POSTED_ROLE',
          bestNextStep: 'unsafe entity id pathway must be skipped',
        },
      ]),
    );
    mocks.postedOpportunityFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: unsafeEntityId,
          status: 'OPEN',
        },
      ]),
    );

    const summaries = await listAccessSummariesForResearchEntities(queryEntityIds);
    const summary = summaries.get(entityId.toString());

    expect(summary?.evidence[0]).toMatchObject({
      signalType: 'CURRENT_UNDERGRADS',
      confidence: 'HIGH',
      sourceUrl: undefined,
    });
    expect(summary?.evidence[0].excerpt).toHaveLength(2000);
    expect(summary?.signalTypes).toEqual(['CURRENT_UNDERGRADS']);
    expect(summary?.bestNextStep).toBe('Reach out to ask about opportunities');
  });

  it('does not query Mongo when entity ids are only object-shaped values', async () => {
    const summaries = await listAccessSummariesForResearchEntities([
      {
        toString: () => {
          throw new Error('access summary stringified an arbitrary entity id');
        },
      } as any,
    ]);

    expect(summaries.size).toBe(0);
    expect(mocks.accessSignalFind).not.toHaveBeenCalled();
    expect(mocks.entryPathwayFind).not.toHaveBeenCalled();
    expect(mocks.postedOpportunityFind).not.toHaveBeenCalled();
  });

  it('queries only signal access evidence for the summary', async () => {
    const entityId = new Types.ObjectId();

    await listAccessSummariesForResearchEntities([entityId]);

    expect(mocks.accessSignalFind.mock.calls[0][0]).toMatchObject({
      researchEntityId: { $in: [entityId] },
      archived: false,
    });
    expect(mocks.entryPathwayFind).not.toHaveBeenCalled();
    expect(mocks.postedOpportunityFind).not.toHaveBeenCalled();
  });

  it('does not let a NOT_CURRENTLY_AVAILABLE signal override a HIGH-confidence positive (#1304)', async () => {
    const entityId = new Types.ObjectId();
    mocks.accessSignalFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          type: 'REACH_OUT_PLAUSIBLE',
          confidence: 'HIGH',
          confidenceScore: 0.9,
          source: { excerpt: 'Undergraduates are welcome to reach out.', url: 'https://lab.example.test/join' },
        },
        {
          researchEntityId: entityId,
          type: 'NOT_CURRENTLY_AVAILABLE',
          confidence: 'MEDIUM',
          confidenceScore: 0.6,
          source: { excerpt: 'Not taking undergraduates this term.' },
        },
      ]),
    );

    const summary = (await listAccessSummariesForResearchEntities([entityId])).get(
      entityId.toString(),
    );

    expect(summary?.status).toBe('reach-out-plausible');
    expect(summary?.bestNextStep).not.toBe('Check back later');
  });

  it('keeps outreach when an application form exists alongside a negative signal (#1304)', async () => {
    const entityId = new Types.ObjectId();
    mocks.accessSignalFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          type: 'APPLICATION_FORM_EXISTS',
          confidence: 'MEDIUM',
          confidenceScore: 0.6,
          source: { excerpt: 'A join, opportunities, or application page was found.' },
        },
        {
          researchEntityId: entityId,
          type: 'NOT_CURRENTLY_AVAILABLE',
          confidence: 'HIGH',
          confidenceScore: 0.9,
          source: { excerpt: 'Not accepting undergraduate students.' },
        },
      ]),
    );

    const summary = (await listAccessSummariesForResearchEntities([entityId])).get(
      entityId.toString(),
    );

    expect(summary?.status).toBe('reach-out-plausible');
    expect(summary?.bestNextStep).not.toBe('Check back later');
  });

  it('surfaces an apply-to-program next step for a projected program access shape (#1381)', async () => {
    const entityId = new Types.ObjectId();
    mocks.accessSignalFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          type: 'APPLICATION_ONLY',
          confidence: 'HIGH',
          confidenceScore: 0.9,
          source: { excerpt: 'Apply to this program through its official page.' },
        },
        {
          researchEntityId: entityId,
          type: 'RECURRING_PROGRAM',
          confidence: 'HIGH',
          confidenceScore: 0.9,
          source: { excerpt: 'Runs as a recurring research program.' },
        },
      ]),
    );

    const summary = (await listAccessSummariesForResearchEntities([entityId])).get(
      entityId.toString(),
    );

    expect(summary?.status).toBe('evidence-backed');
    expect(summary?.bestNextStep).toBe('Apply to this program');
  });

  it('surfaces not-currently-available for a negative-only entity but never dead-ends the CTA (#1304)', async () => {
    const entityId = new Types.ObjectId();
    mocks.accessSignalFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          type: 'NOT_CURRENTLY_AVAILABLE',
          confidence: 'HIGH',
          confidenceScore: 0.9,
          source: { excerpt: 'Not accepting undergraduate students at this time.' },
        },
      ]),
    );

    const summary = (await listAccessSummariesForResearchEntities([entityId])).get(
      entityId.toString(),
    );

    expect(summary?.status).toBe('not-currently-available');
    expect(summary?.bestNextStep).toBe('Reach out to confirm current availability');
  });

  it.each([
    ['REACH_OUT_PLAUSIBLE', 'the identified-lead fallback shared by faculty and lab kinds alike'],
    ['CURRENT_UNDERGRADS', 'a lab microsite listing current undergrads'],
    ['PAST_UNDERGRADS', 'a lab microsite listing past undergrad advisees'],
  ])(
    'never tells a student to "Save for later" for reach-out-plausible via %s (#1353, regression from #377)',
    async (signalType) => {
      const entityId = new Types.ObjectId();
      mocks.accessSignalFind.mockReturnValue(
        queryMany([
          {
            researchEntityId: entityId,
            type: signalType,
            confidence: 'MEDIUM',
            confidenceScore: 0.6,
            source: { excerpt: 'Evidence excerpt.' },
          },
        ]),
      );

      const summary = (await listAccessSummariesForResearchEntities([entityId])).get(
        entityId.toString(),
      );

      expect(summary?.status).toBe('reach-out-plausible');
      expect(summary?.bestNextStep).not.toBe('Save for later');
      expect(summary?.bestNextStep).toBe('Reach out to ask about opportunities');
    },
  );

  it('serves an active POSTED_OPENING as the top-tier posted-opening status (#1568)', async () => {
    const entityId = new Types.ObjectId();
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    mocks.accessSignalFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          type: 'POSTED_OPENING',
          confidence: 'HIGH',
          confidenceScore: 0.85,
          expiresAt: future,
          source: {
            excerpt: 'Summer RA - Smith Lab. Apply by 2026-12-01.',
            url: 'https://apply.example.test/smith-lab-ra',
          },
        },
      ]),
    );

    const summary = (await listAccessSummariesForResearchEntities([entityId])).get(
      entityId.toString(),
    );

    expect(summary?.status).toBe('posted-opening');
    expect(summary?.bestNextStep).toBe('Apply');
    expect(summary?.evidence[0]).toMatchObject({
      signalType: 'POSTED_OPENING',
      sourceUrl: 'https://apply.example.test/smith-lab-ra',
    });
  });

  it('degrades an expired POSTED_OPENING out of the active state (#1303/#1568)', async () => {
    const entityId = new Types.ObjectId();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mocks.accessSignalFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          type: 'POSTED_OPENING',
          confidence: 'HIGH',
          confidenceScore: 0.85,
          expiresAt: past,
          source: {
            excerpt: 'Summer RA - Smith Lab. Apply by 2024-12-01.',
            url: 'https://apply.example.test/smith-lab-ra',
          },
        },
        {
          researchEntityId: entityId,
          type: 'REACH_OUT_PLAUSIBLE',
          confidence: 'MEDIUM',
          source: { excerpt: 'Identified faculty lead with an official research page.' },
        },
      ]),
    );

    const summary = (await listAccessSummariesForResearchEntities([entityId])).get(
      entityId.toString(),
    );

    expect(summary?.status).toBe('reach-out-plausible');
    expect(summary?.bestNextStep).not.toBe('Apply');
    expect(summary?.signalTypes).not.toContain('POSTED_OPENING');
    expect(JSON.stringify(summary)).not.toContain('apply.example.test');
  });
});
