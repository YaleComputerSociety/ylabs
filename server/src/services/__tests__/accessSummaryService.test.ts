import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const mocks = vi.hoisted(() => ({
  accessSignalFind: vi.fn(),
  entryPathwayFind: vi.fn(),
  postedOpportunityFind: vi.fn(),
}));

vi.mock('../../models/accessSignal', () => ({
  AccessSignal: {
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
          signalType: 'REACH_OUT_PLAUSIBLE',
          confidence: 'HIGH',
          confidenceScore: 0.9,
          excerpt: 'Questions: hidden@example.edu or 203-432-1234.',
          sourceUrl: 'mailto:hidden@example.edu',
        },
        {
          researchEntityId: entityId,
          signalType: 'CURRENT_UNDERGRADS',
          confidence: 'MEDIUM',
          excerpt: 'Undergraduates are listed on the lab page.',
          sourceUrl: 'https://lab.example.test/people',
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
        excerpt: 'Questions: [email redacted] or [phone redacted].',
        sourceUrl: undefined,
      },
      {
        signalType: 'CURRENT_UNDERGRADS',
        confidence: 'MEDIUM',
        excerpt: 'Undergraduates are listed on the lab page.',
        sourceUrl: 'https://lab.example.test/people',
      },
    ]);
    expect(summary?.bestNextStep).toBe('Email [email redacted] after reading the page.');
    expect(JSON.stringify(summary)).not.toContain('hidden@example.edu');
    expect(JSON.stringify(summary)).not.toContain('203-432-1234');
    expect(JSON.stringify(summary)).not.toContain('mailto:');
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
    const extraEntityIds = Array.from({ length: 100 }, () => new Types.ObjectId());
    Object.defineProperty(extraEntityIds, '100', {
      get: () => {
        throw new Error('access summary read past the entity id cap');
      },
      enumerable: true,
    });

    mocks.accessSignalFind.mockReturnValue(
      queryMany([
        {
          researchEntityId: entityId,
          signalType: 'CURRENT_UNDERGRADS',
          confidence: 'HIGH',
          confidenceScore: 0.9,
          excerpt: 'x'.repeat(3000),
          sourceUrl: {
            toString: () => {
              throw new Error('access summary stringified an arbitrary source URL');
            },
          },
        },
        {
          researchEntityId: entityId,
          signalType: {
            toString: () => {
              throw new Error('access summary stringified an arbitrary signal type');
            },
          },
          confidence: 'LOW',
          excerpt: 'ignored signal type',
          sourceUrl: 'https://lab.example.test/ignored',
        },
        {
          researchEntityId: unsafeEntityId,
          signalType: 'POSTED_OPENING',
          confidence: 'HIGH',
          excerpt: 'unsafe entity id row must be skipped',
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

    const summaries = await listAccessSummariesForResearchEntities([entityId, ...extraEntityIds]);
    const summary = summaries.get(entityId.toString());

    expect(summary?.evidence[0]).toMatchObject({
      signalType: 'CURRENT_UNDERGRADS',
      confidence: 'HIGH',
      sourceUrl: undefined,
    });
    expect(summary?.evidence[0].excerpt).toHaveLength(2000);
    expect(summary?.signalTypes).toEqual(['CURRENT_UNDERGRADS']);
    expect(summary?.entryPathwayTypes).toEqual(['EXPLORATORY_CONTACT']);
    expect(summary?.hasActivePostedOpportunity).toBe(false);
    expect(summary?.bestNextStep).toBe('Plan exploratory outreach');
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
});
