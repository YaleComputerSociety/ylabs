import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getEntryPathwayStatusForPostedOpportunity,
  getPostedOpportunityStatusForListing,
  mapListingCompensationToAccessCompensation,
  materializeListingEvidenceFromListing,
  reapExpiredPostedOpportunities,
  upsertPostedOpportunity,
} from '../postedOpportunityService';

const mocks = vi.hoisted(() => ({
  upsertEntryPathway: vi.fn(),
  upsertAccessSignal: vi.fn(),
  postedOpportunityUpdateMany: vi.fn(),
}));

vi.mock('../entryPathwayService', () => ({
  upsertEntryPathway: mocks.upsertEntryPathway,
}));

vi.mock('../accessSignalService', () => ({
  upsertAccessSignal: mocks.upsertAccessSignal,
}));

vi.mock('../../models/postedOpportunity', () => ({
  PostedOpportunity: {
    updateMany: mocks.postedOpportunityUpdateMany,
  },
}));

describe('postedOpportunityService', () => {
  const listingWebsite = 'https://example-lab.test/openings';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsertEntryPathway.mockResolvedValue({ pathwayId: 'pathway-1' });
    mocks.upsertAccessSignal.mockResolvedValue({ signalId: 'signal-1' });
    mocks.postedOpportunityUpdateMany.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
  });

  it('maps legacy listing compensation into pathway compensation facets', () => {
    expect(mapListingCompensationToAccessCompensation('paid')).toBe('PAID');
    expect(mapListingCompensationToAccessCompensation('volunteer')).toBe('VOLUNTEER');
    expect(mapListingCompensationToAccessCompensation('course-credit')).toBe('COURSE_CREDIT');
    expect(mapListingCompensationToAccessCompensation('fellowship-eligible')).toBe(
      'FELLOWSHIP_ELIGIBLE',
    );
    expect(mapListingCompensationToAccessCompensation(undefined)).toBe('UNKNOWN');
  });

  it('keeps listing-derived opportunity status deadline-aware', () => {
    const now = new Date('2026-05-11T12:00:00.000Z');

    expect(
      getPostedOpportunityStatusForListing({ archived: true, expiresAt: '2026-06-01' }, now),
    ).toBe('ARCHIVED');
    expect(
      getPostedOpportunityStatusForListing({ confirmed: false, expiresAt: '2026-06-01' }, now),
    ).toBe('CLOSED');
    expect(getPostedOpportunityStatusForListing({ expiresAt: '2026-06-01' }, now)).toBe('OPEN');
    expect(getPostedOpportunityStatusForListing({ expiresAt: '2026-01-01' }, now)).toBe('CLOSED');
    expect(getPostedOpportunityStatusForListing({}, now)).toBe('ROLLING');
  });

  it('marks pathways active only for open or rolling posted opportunities', () => {
    expect(getEntryPathwayStatusForPostedOpportunity('OPEN')).toBe('ACTIVE');
    expect(getEntryPathwayStatusForPostedOpportunity('ROLLING')).toBe('ACTIVE');
    expect(getEntryPathwayStatusForPostedOpportunity('CLOSED')).toBe('NOT_CURRENTLY_AVAILABLE');
    expect(getEntryPathwayStatusForPostedOpportunity('ARCHIVED')).toBe('NOT_CURRENTLY_AVAILABLE');
  });

  it('materializes legacy listings as professor-submitted profile evidence, not posted openings', async () => {
    const result = await materializeListingEvidenceFromListing({
      _id: 'listing-1',
      researchEntityId: 'entity-1',
      title: 'Example Lab',
      websites: [listingWebsite],
      compensationType: 'paid',
      updatedAt: '2026-05-10T12:00:00.000Z',
    });

    expect(result).toEqual({ entryPathwayId: 'pathway-1' });
    expect(mocks.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        studentFacingLabel: 'Professor-submitted research profile',
        compensation: 'PAID',
        sourceUrls: [listingWebsite],
        archived: false,
      }),
    );
    expect(mocks.upsertAccessSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        entryPathwayId: 'pathway-1',
        signalType: 'REACH_OUT_PLAUSIBLE',
        confidence: 'MEDIUM',
        excerpt: 'Professor-submitted research profile: Example Lab',
        sourceUrl: listingWebsite,
        archived: false,
      }),
    );
  });

  it('filters listing website source URLs through the public source boundary', async () => {
    const blockedUrl =
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-person';

    await materializeListingEvidenceFromListing({
      _id: 'listing-1',
      researchEntityId: 'entity-1',
      title: 'Example Lab',
      websites: [
        'mailto:private@example.edu',
        blockedUrl,
        listingWebsite,
        'https://yale.edu\n.evil.example/source',
      ],
    });

    expect(mocks.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrls: [listingWebsite],
      }),
    );
    expect(mocks.upsertAccessSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: listingWebsite,
      }),
    );
  });

  it('archives professor-submitted profile evidence when the source listing is archived or unconfirmed', async () => {
    await materializeListingEvidenceFromListing({
      _id: 'listing-archived',
      researchEntityId: 'entity-1',
      archived: true,
      confirmed: false,
    });

    expect(mocks.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        derivationKey: 'listing:listing-archived:EXPLORATORY_CONTACT',
        archived: true,
      }),
    );
    expect(mocks.upsertAccessSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        derivationKey: 'listing:listing-archived:REACH_OUT_PLAUSIBLE',
        archived: true,
      }),
    );
  });

  it('archives existing listing-backed posted opportunities once listing evidence has been migrated', async () => {
    mocks.postedOpportunityUpdateMany.mockResolvedValue({ matchedCount: 2, modifiedCount: 2 });

    await materializeListingEvidenceFromListing({
      _id: 'listing-1',
      researchEntityId: 'entity-1',
      title: 'Example Lab',
    });

    expect(mocks.postedOpportunityUpdateMany).toHaveBeenCalledWith(
      {
        $or: [{ listingId: 'listing-1' }, { derivationKey: 'listing:listing-1' }],
        archived: { $ne: true },
      },
      {
        $set: {
          archived: true,
          status: 'ARCHIVED',
        },
      },
    );
  });

  it('does not set archived in conflicting upsert operators', async () => {
    let capturedUpdate: any;
    const model = {
      findOneAndUpdate: (_filter: any, update: any) => {
        capturedUpdate = update;
        return {
          lean: async () => ({ _id: 'posted-1' }),
        };
      },
    };

    await upsertPostedOpportunity(
      {
        entryPathwayId: 'entry-1',
        researchEntityId: 'research-1',
        listingId: 'listing-1',
        title: 'Research role',
        status: 'ROLLING',
        derivationKey: 'listing:listing-1',
        archived: false,
      },
      { model: model as any },
    );

    expect(capturedUpdate.$set.archived).toBe(false);
    expect(capturedUpdate.$setOnInsert.archived).toBeUndefined();
  });

  it('dry-runs expired opportunity status reaping without writes', async () => {
    const updates: any[] = [];
    const model = {
      find: () => ({
        select: () => ({
          sort: () => ({
            limit: () => ({
              lean: async () => [
                {
                  _id: 'opportunity-1',
                  entryPathwayId: 'pathway-1',
                  review: { lockedFields: [] },
                },
              ],
            }),
          }),
        }),
      }),
      updateOne: async (...args: any[]) => {
        updates.push(args);
        return { matchedCount: 1, modifiedCount: 1 };
      },
    };

    const result = await reapExpiredPostedOpportunities(
      { now: new Date('2026-05-14T00:00:00.000Z'), dryRun: true },
      { model: model as any },
    );

    expect(result).toMatchObject({
      dryRun: true,
      expiredCandidates: 1,
      closedOpportunities: 1,
      skippedLocked: 0,
      updatedPathways: 0,
      affectedPathwayIds: ['pathway-1'],
    });
    expect(updates).toEqual([]);
  });

  it('closes expired opportunities and marks posted-role pathways unavailable', async () => {
    const opportunityUpdates: any[] = [];
    const pathwayUpdates: any[] = [];
    const model = {
      find: () => ({
        select: () => ({
          sort: () => ({
            limit: () => ({
              lean: async () => [
                {
                  _id: 'opportunity-1',
                  entryPathwayId: 'pathway-1',
                  review: { lockedFields: [] },
                },
                {
                  _id: 'opportunity-locked',
                  entryPathwayId: 'pathway-2',
                  review: { lockedFields: ['status'] },
                },
              ],
            }),
          }),
        }),
      }),
      updateOne: async (...args: any[]) => {
        opportunityUpdates.push(args);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      countDocuments: async () => 0,
    };
    const entryPathwayModel = {
      findOne: () => ({
        select: () => ({
          lean: async () => ({ _id: 'pathway-1', review: { lockedFields: [] } }),
        }),
      }),
      updateOne: async (...args: any[]) => {
        pathwayUpdates.push(args);
        return { matchedCount: 1, modifiedCount: 1 };
      },
    };

    const result = await reapExpiredPostedOpportunities(
      { now: new Date('2026-05-14T00:00:00.000Z'), dryRun: false },
      { model: model as any, entryPathwayModel: entryPathwayModel as any },
    );

    expect(result.closedOpportunities).toBe(1);
    expect(result.skippedLocked).toBe(1);
    expect(result.updatedPathways).toBe(1);
    expect(opportunityUpdates[0][1]).toEqual({ $set: { status: 'CLOSED' } });
    expect(pathwayUpdates[0][1].$set).toMatchObject({
      status: 'NOT_CURRENTLY_AVAILABLE',
    });
  });
});
