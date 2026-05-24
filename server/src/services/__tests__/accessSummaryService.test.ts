import { describe, expect, it, vi, beforeEach } from 'vitest';

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

const findWithSort = (rows: any[]) => ({
  sort: () => ({
    lean: async () => rows,
  }),
});

const findLean = (rows: any[]) => ({
  lean: async () => rows,
});

describe('accessSummaryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not treat legacy listing artifacts as active posted-opening evidence', async () => {
    const entityId = '665f0b0c0b0c0b0c0b0c0b0d';

    mocks.accessSignalFind.mockReturnValue(
      findWithSort([
        {
          researchEntityId: entityId,
          signalType: 'POSTED_OPENING',
          confidence: 'HIGH',
          sourceName: 'ylabs-listing',
          derivationKey: 'listing:legacy-listing:POSTED_OPENING',
          confidenceScore: 1,
        },
      ]),
    );
    mocks.entryPathwayFind.mockReturnValue(
      findLean([
        {
          researchEntityId: entityId,
          pathwayType: 'POSTED_ROLE',
          status: 'ACTIVE',
          derivationKey: 'listing:legacy-listing:POSTED_ROLE',
          bestNextStep: 'Apply through the posted listing.',
        },
      ]),
    );
    mocks.postedOpportunityFind.mockReturnValue(
      findLean([
        {
          researchEntityId: entityId,
          status: 'ROLLING',
          listingId: 'legacy-listing',
        },
      ]),
    );

    const summaries = await listAccessSummariesForResearchEntities([entityId]);
    const summary = summaries.get(entityId);

    expect(summary).toMatchObject({
      status: 'unknown',
      hasActivePostedOpportunity: false,
      bestNextStep: 'Save for later',
      signalTypes: [],
      entryPathwayTypes: [],
    });
  });
});
