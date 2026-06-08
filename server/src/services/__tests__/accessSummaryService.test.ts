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
});
