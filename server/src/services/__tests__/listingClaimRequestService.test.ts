import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyListingClaimRequestDecision,
  createListingClaimRequest,
  reviewListingClaimRequest,
  sanitizeEvidenceUrls,
  sanitizeProposedChanges,
} from '../listingClaimRequestService';
import { getListingModel } from '../../db/connections';
import { ListingClaimRequest } from '../../models/listingClaimRequest';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import { appendObservations, getSourceByName } from '../../scrapers/observationStore';
import { materializeEntity } from '../../scrapers/entityMaterializer';
import { runStudentVisibilityGate } from '../studentVisibilityGateService';
import { syncEntity } from '../meiliSyncService';
import { BadRequestError } from '../../utils/errors';

vi.mock('../../db/connections', () => ({
  getListingModel: vi.fn(),
}));

vi.mock('../../models/listingClaimRequest', () => ({
  ListingClaimRequest: {
    create: vi.fn(),
    findOne: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: { findById: vi.fn() },
}));

vi.mock('../../models/scrapeRun', () => ({
  ScrapeRun: { create: vi.fn(), updateOne: vi.fn() },
}));

vi.mock('../../scrapers/observationStore', () => ({
  appendObservations: vi.fn(),
  getSourceByName: vi.fn(),
}));

vi.mock('../../scrapers/entityMaterializer', () => ({
  materializeEntity: vi.fn(),
}));

vi.mock('../studentVisibilityGateService', () => ({
  runStudentVisibilityGate: vi.fn(),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntity: vi.fn(),
}));

const listingId = '507f1f77bcf86cd799439011';
const requestId = '507f1f77bcf86cd799439012';
const researchEntityId = '507f1f77bcf86cd799439013';

const makeRequestDoc = (data: Record<string, unknown>) => {
  const doc: any = { ...data };
  doc.set = (patch: Record<string, unknown>) => Object.assign(doc, patch);
  doc.save = vi.fn(async () => doc);
  doc.toObject = () => {
    const { set: _set, save: _save, toObject: _toObject, ...rest } = doc;
    return rest;
  };
  return doc;
};

const mockListingFindById = (listing: Record<string, unknown> | null) => {
  vi.mocked(getListingModel).mockReturnValue({
    findById: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(listing),
      }),
    }),
  } as any);
};

describe('listingClaimRequestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ListingClaimRequest.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
    } as any);
  });

  it('sanitizes proposed changes to known listing fields only', () => {
    expect(
      sanitizeProposedChanges({
        title: ' Updated lab ',
        departments: [' MCDB ', '', 42, 'BENG'],
        hiringStatus: '2',
        ownerId: ' faculty1 ',
        $set: { ownerId: 'attacker' },
        unknown: 'ignored',
      }),
    ).toEqual({
      title: 'Updated lab',
      departments: ['MCDB', 'BENG'],
      hiringStatus: 2,
      ownerId: 'faculty1',
    });
  });

  it('keeps only http evidence URLs', () => {
    expect(
      sanitizeEvidenceUrls([' https://example.yale.edu/proof ', 'javascript:alert(1)', 'notaurl']),
    ).toEqual(['https://example.yale.edu/proof']);
  });

  it('creates a pending untrusted request without mutating the listing', async () => {
    mockListingFindById({
      _id: listingId,
      title: 'Old title',
      ownerId: 'old1',
      ownerEmail: 'old1@yale.edu',
      ownerFirstName: 'Old',
      ownerLastName: 'Owner',
    });

    vi.mocked(ListingClaimRequest.create).mockResolvedValue({
      _id: requestId,
      toObject: () => ({ _id: requestId, status: 'pending' }),
    } as any);

    const request = await createListingClaimRequest(
      listingId,
      {
        requestType: 'claim',
        message: 'I am the current PI for this lab.',
        proposedChanges: {
          ownerId: 'new1',
          title: 'New title',
          confirmed: true,
        },
      },
      {
        netId: 'new1',
        email: 'new1@yale.edu',
        fname: 'New',
        lname: 'Owner',
        userType: 'faculty',
        userConfirmed: true,
        profileVerified: true,
      },
    );

    expect(request).toEqual({ _id: requestId, status: 'pending' });
    expect(ListingClaimRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId,
        requestType: 'claim',
        requester: expect.objectContaining({ netId: 'new1', userType: 'faculty' }),
        listingSnapshot: {
          title: 'Old title',
          ownerId: 'old1',
          ownerEmail: 'old1@yale.edu',
          ownerName: 'Old Owner',
        },
        proposedChanges: {
          ownerId: 'new1',
          title: 'New title',
        },
      }),
    );
  });

  it('rejects unsupported request types with a 400-level error', async () => {
    await expect(
      createListingClaimRequest(
        listingId,
        { requestType: 'takeover', message: 'Please review this listing.' },
        { netId: 'fac1' },
      ),
    ).rejects.toMatchObject({
      message: 'Invalid request type',
      status: 400,
    });

    await expect(
      createListingClaimRequest(
        listingId,
        { requestType: 'takeover', message: 'Please review this listing.' },
        { netId: 'fac1' },
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(getListingModel).not.toHaveBeenCalled();
    expect(ListingClaimRequest.create).not.toHaveBeenCalled();
  });

  it('rejects missing messages with a 400-level error', async () => {
    await expect(
      createListingClaimRequest(
        listingId,
        { requestType: 'correction', message: '   ' },
        {
          netId: 'fac1',
        },
      ),
    ).rejects.toMatchObject({
      message: 'Message is required',
      status: 400,
    });

    await expect(
      createListingClaimRequest(
        listingId,
        { requestType: 'correction', message: '   ' },
        {
          netId: 'fac1',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(getListingModel).not.toHaveBeenCalled();
    expect(ListingClaimRequest.create).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'invalid', []])(
    'rejects malformed claim request bodies with a 400-level error',
    async (body) => {
      await expect(
        createListingClaimRequest(listingId, body, {
          netId: 'fac1',
        }),
      ).rejects.toMatchObject({
        message: 'Message is required',
        status: 400,
      });

      expect(getListingModel).not.toHaveBeenCalled();
      expect(ListingClaimRequest.create).not.toHaveBeenCalled();
    },
  );

  it('reviews a request by updating only request review metadata', async () => {
    const lean = vi.fn().mockResolvedValue({
      _id: requestId,
      status: 'approved',
      reviewedBy: 'admin1',
    });
    vi.mocked(ListingClaimRequest.findByIdAndUpdate).mockReturnValue({ lean } as any);

    const request = await reviewListingClaimRequest(requestId, 'admin1', {
      status: 'approved',
      adminNotes: 'Verified by email.',
    });

    expect(request).toMatchObject({ _id: requestId, status: 'approved', reviewedBy: 'admin1' });
    expect(ListingClaimRequest.findByIdAndUpdate).toHaveBeenCalledWith(
      { _id: requestId, status: { $in: ['pending', 'changes_requested'] } },
      expect.objectContaining({
        status: 'approved',
        adminNotes: 'Verified by email.',
        reviewedBy: 'admin1',
        $push: {
          reviewHistory: expect.objectContaining({
            status: 'approved',
            rationale: 'Verified by email.',
            reviewedBy: 'admin1',
          }),
        },
      }),
      { new: true, runValidators: true },
    );
  });

  it('rejects invalid review statuses with a 400-level error', async () => {
    await expect(
      reviewListingClaimRequest(requestId, 'admin1', {
        status: 'pending',
        adminNotes: 'Cannot move back to pending.',
      }),
    ).rejects.toMatchObject({
      message: 'Status must be approved, rejected, or changes_requested',
      status: 400,
    });

    await expect(
      reviewListingClaimRequest(requestId, 'admin1', {
        status: 'pending',
        adminNotes: 'Cannot move back to pending.',
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(ListingClaimRequest.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'invalid', []])(
    'rejects malformed review request bodies with a 400-level error',
    async (body) => {
      await expect(reviewListingClaimRequest(requestId, 'admin1', body)).rejects.toMatchObject({
        message: 'Status must be approved, rejected, or changes_requested',
        status: 400,
      });

      expect(ListingClaimRequest.findByIdAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('rejects a duplicate pending request before creating another record', async () => {
    mockListingFindById({ _id: listingId, title: 'Existing listing' });
    vi.mocked(ListingClaimRequest.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: requestId }) }),
    } as any);

    await expect(
      createListingClaimRequest(
        listingId,
        { requestType: 'claim', message: 'Please review ownership.' },
        { netId: 'fac1' },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(ListingClaimRequest.create).not.toHaveBeenCalled();
  });

  it('requires a reviewer rationale', async () => {
    await expect(
      reviewListingClaimRequest(requestId, 'admin1', { status: 'changes_requested' }),
    ).rejects.toMatchObject({ message: 'Reviewer rationale is required', status: 400 });
    expect(ListingClaimRequest.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  describe('applyListingClaimRequestDecision', () => {
    beforeEach(() => {
      vi.mocked(getSourceByName).mockResolvedValue({
        _id: 'source-1',
        name: 'manual-admin-edit',
        defaultWeight: 0.9,
      } as any);
      vi.mocked(ScrapeRun.create).mockResolvedValue({ _id: 'run-1' } as any);
      vi.mocked(ScrapeRun.updateOne).mockResolvedValue({} as any);
      vi.mocked(appendObservations).mockResolvedValue({
        inserted: 1,
        skipped: 0,
        superseded: 0,
      });
      vi.mocked(materializeEntity).mockResolvedValue({} as any);
      vi.mocked(runStudentVisibilityGate).mockResolvedValue({} as any);
      vi.mocked(ResearchEntity.findById).mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: researchEntityId }),
      } as any);
      vi.mocked(syncEntity).mockResolvedValue(undefined);
    });

    it('requires explicit confirmation before applying', async () => {
      await expect(
        applyListingClaimRequestDecision(requestId, 'admin1', {}),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(ListingClaimRequest.findById).not.toHaveBeenCalled();
    });

    it('rejects apply attempts on requests that are not approved', async () => {
      vi.mocked(ListingClaimRequest.findById).mockResolvedValue(
        makeRequestDoc({
          _id: requestId,
          status: 'rejected',
          applyStatus: 'not_applicable',
          listingId,
          proposedChanges: { description: 'Corrected description.' },
        }),
      );

      await expect(
        applyListingClaimRequestDecision(requestId, 'admin1', { confirmApply: true }),
      ).rejects.toMatchObject({
        message: 'Only approved requests can be applied to canonical data',
        status: 400,
      });
      expect(appendObservations).not.toHaveBeenCalled();
    });

    it('applies a mapped field change through the manual-admin-edit channel and re-gates + re-syncs', async () => {
      mockListingFindById({ _id: listingId, researchEntityId });
      const doc = makeRequestDoc({
        _id: requestId,
        status: 'approved',
        applyStatus: 'not_applicable',
        listingId,
        proposedChanges: { description: 'Corrected description.', hiringStatus: 1 },
      });
      vi.mocked(ListingClaimRequest.findById).mockResolvedValue(doc);

      const result = await applyListingClaimRequestDecision(requestId, 'admin1', {
        confirmApply: true,
      });

      expect(appendObservations).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            entityType: 'researchEntity',
            entityId: researchEntityId,
            field: 'fullDescription',
            value: 'Corrected description.',
          }),
        ],
        expect.objectContaining({ sourceName: 'manual-admin-edit', dryRun: false }),
      );
      expect(materializeEntity).toHaveBeenCalledWith('researchEntity', {
        entityId: researchEntityId,
      });
      expect(runStudentVisibilityGate).toHaveBeenCalledWith({
        collection: 'research',
        mode: 'apply',
        recordIds: [researchEntityId],
      });
      expect(syncEntity).toHaveBeenCalledWith('researchEntity', { _id: researchEntityId });
      expect(result).toMatchObject({ applyStatus: 'applied', appliedFields: ['description'] });
    });

    it('is idempotent: re-invoking an already-applied decision does not write again', async () => {
      const doc = makeRequestDoc({
        _id: requestId,
        status: 'approved',
        applyStatus: 'applied',
        appliedFields: ['description'],
        listingId,
        proposedChanges: { description: 'Corrected description.' },
      });
      vi.mocked(ListingClaimRequest.findById).mockResolvedValue(doc);

      const result = await applyListingClaimRequestDecision(requestId, 'admin1', {
        confirmApply: true,
      });

      expect(appendObservations).not.toHaveBeenCalled();
      expect(getListingModel).not.toHaveBeenCalled();
      expect(result).toMatchObject({ applyStatus: 'applied' });
    });

    it('resolves cleanly without a mutation when no proposed field has a canonical mapping', async () => {
      const doc = makeRequestDoc({
        _id: requestId,
        status: 'approved',
        applyStatus: 'not_applicable',
        listingId,
        proposedChanges: { ownerId: 'new-owner' },
      });
      vi.mocked(ListingClaimRequest.findById).mockResolvedValue(doc);

      const result = await applyListingClaimRequestDecision(requestId, 'admin1', {
        confirmApply: true,
      });

      expect(appendObservations).not.toHaveBeenCalled();
      expect(getListingModel).not.toHaveBeenCalled();
      expect(result).toMatchObject({ applyStatus: 'not_applicable', appliedFields: [] });
    });

    it('surfaces a failure without throwing when there is no linked canonical entity', async () => {
      mockListingFindById({ _id: listingId, researchEntityId: undefined });
      const doc = makeRequestDoc({
        _id: requestId,
        status: 'approved',
        applyStatus: 'not_applicable',
        listingId,
        proposedChanges: { description: 'Corrected description.' },
      });
      vi.mocked(ListingClaimRequest.findById).mockResolvedValue(doc);

      const result = await applyListingClaimRequestDecision(requestId, 'admin1', {
        confirmApply: true,
      });

      expect(appendObservations).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        applyStatus: 'failed',
        applyError: 'No linked canonical research entity to apply changes to.',
      });
    });

    it('surfaces a failure without throwing when the write pipeline errors', async () => {
      mockListingFindById({ _id: listingId, researchEntityId });
      vi.mocked(materializeEntity).mockRejectedValue(new Error('materialize exploded'));
      const doc = makeRequestDoc({
        _id: requestId,
        status: 'approved',
        applyStatus: 'not_applicable',
        listingId,
        proposedChanges: { description: 'Corrected description.' },
      });
      vi.mocked(ListingClaimRequest.findById).mockResolvedValue(doc);

      const result = await applyListingClaimRequestDecision(requestId, 'admin1', {
        confirmApply: true,
      });

      expect(result).toMatchObject({ applyStatus: 'failed', applyError: 'materialize exploded' });
      expect(ScrapeRun.updateOne).toHaveBeenCalledWith(
        { _id: 'run-1' },
        expect.objectContaining({ $set: expect.objectContaining({ status: 'failure' }) }),
      );
    });
  });
});
