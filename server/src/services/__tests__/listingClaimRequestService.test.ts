import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createListingClaimRequest,
  reviewListingClaimRequest,
  sanitizeEvidenceUrls,
  sanitizeProposedChanges,
} from '../listingClaimRequestService';
import { getListingModel } from '../../db/connections';
import { ListingClaimRequest } from '../../models/listingClaimRequest';
import { BadRequestError } from '../../utils/errors';

vi.mock('../../db/connections', () => ({
  getListingModel: vi.fn(),
}));

vi.mock('../../models/listingClaimRequest', () => ({
  ListingClaimRequest: {
    create: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

const listingId = '507f1f77bcf86cd799439011';
const requestId = '507f1f77bcf86cd799439012';

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
      requestId,
      expect.objectContaining({
        status: 'approved',
        adminNotes: 'Verified by email.',
        reviewedBy: 'admin1',
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
      message: 'Status must be approved or rejected',
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
});
