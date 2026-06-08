import { describe, expect, it } from 'vitest';
import {
  backfillPostedOpportunitiesFromListings,
  getEntryPathwayStatusForPostedOpportunity,
  getPostedOpportunityStatusForListing,
  mapListingCompensationToAccessCompensation,
  reapExpiredPostedOpportunities,
  upsertPostedOpportunity,
} from '../postedOpportunityService';

describe('postedOpportunityService', () => {
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

  it('rejects unsafe reaping limits before querying posted opportunities', async () => {
    let findCalls = 0;
    const model = {
      find: () => {
        findCalls += 1;
        return {
          select: () => ({
            sort: () => ({
              limit: () => ({
                lean: async () => [],
              }),
            }),
          }),
        };
      },
    };

    await expect(
      reapExpiredPostedOpportunities({ limit: 9007199254740992 }, { model: model as any }),
    ).rejects.toThrow('--limit must be a safe positive integer');

    expect(findCalls).toBe(0);
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

  it('dry-runs listing backfill without materializing candidates', async () => {
    const materialized: any[] = [];
    const listingModel = {
      find: () => ({
        select: () => ({
          sort: () => ({
            limit: () => ({
              lean: async () => [
                {
                  _id: 'listing-1',
                  researchEntityId: 'entity-1',
                  title: 'Research assistant',
                },
              ],
            }),
          }),
        }),
      }),
    };
    const postedOpportunityModel = {
      distinct: async () => [],
    };

    const result = await backfillPostedOpportunitiesFromListings(
      { dryRun: true, now: new Date('2026-05-26T00:00:00.000Z') },
      {
        listingModel: listingModel as any,
        model: postedOpportunityModel as any,
        materializeListing: async (listing) => {
          materialized.push(listing);
          return { postedOpportunityId: 'posted-1' };
        },
      },
    );

    expect(result).toMatchObject({
      dryRun: true,
      scanned: 1,
      candidates: 1,
      materialized: 0,
      skipped: 0,
      candidateListingIds: ['listing-1'],
    });
    expect(materialized).toEqual([]);
  });

  it('rejects unsafe listing backfill limits before querying listings', async () => {
    let findCalls = 0;
    const listingModel = {
      find: () => {
        findCalls += 1;
        return {
          select: () => ({
            sort: () => ({
              limit: () => ({
                lean: async () => [],
              }),
            }),
          }),
        };
      },
    };

    await expect(
      backfillPostedOpportunitiesFromListings(
        { limit: 9007199254740992 },
        { listingModel: listingModel as any, model: { distinct: async () => [] } as any },
      ),
    ).rejects.toThrow('--limit must be a safe positive integer');

    expect(findCalls).toBe(0);
  });

  it('applies listing backfill only for listings without posted opportunities', async () => {
    const materialized: any[] = [];
    const listingModel = {
      find: () => ({
        select: () => ({
          sort: () => ({
            limit: () => ({
              lean: async () => [
                {
                  _id: 'listing-1',
                  researchEntityId: 'entity-1',
                  title: 'Research assistant',
                },
                {
                  _id: 'listing-2',
                  researchEntityId: 'entity-2',
                  title: 'Already bridged',
                },
              ],
            }),
          }),
        }),
      }),
    };
    const postedOpportunityModel = {
      distinct: async () => ['listing-2'],
    };

    const result = await backfillPostedOpportunitiesFromListings(
      { dryRun: false, now: new Date('2026-05-26T00:00:00.000Z') },
      {
        listingModel: listingModel as any,
        model: postedOpportunityModel as any,
        materializeListing: async (listing) => {
          materialized.push(listing);
          return { postedOpportunityId: 'posted-1' };
        },
      },
    );

    expect(result).toMatchObject({
      dryRun: false,
      scanned: 2,
      candidates: 1,
      materialized: 1,
      skipped: 0,
      candidateListingIds: ['listing-1'],
      materializedListingIds: ['listing-1'],
    });
    expect(materialized.map((listing) => listing._id)).toEqual(['listing-1']);
  });
});
