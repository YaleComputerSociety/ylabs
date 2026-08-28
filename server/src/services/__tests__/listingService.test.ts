import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => {
  const state = {
    savedDocs: [] as any[],
    findByIdDoc: null as any,
    lastFindByIdAndUpdate: null as any,
    nextListingId: '64a000000000000000000099',
  };

  class MockListing {
    _id: string;
    professorIds: string[];
    [key: string]: any;

    constructor(data: Record<string, any>) {
      Object.assign(this, data);
      this._id = state.nextListingId;
      this.professorIds = data.professorIds || [];
      this.professorNames = data.professorNames || [];
      this.emails = data.emails || [];
    }

    async save() {
      state.savedDocs.push(this.toObject());
      return this;
    }

    toObject() {
      return { ...this };
    }

    static findById(id: string) {
      if (!state.findByIdDoc) return null;
      return state.findByIdDoc._id === id ? state.findByIdDoc : null;
    }

    static async findByIdAndUpdate(id: string, data: Record<string, any>) {
      state.lastFindByIdAndUpdate = { id, data };
      if (!state.findByIdDoc || state.findByIdDoc._id !== id) return null;
      Object.assign(state.findByIdDoc, data);
      return state.findByIdDoc;
    }
  }

  return {
    state,
    MockListing,
    buildListingResearchEntityProfilePatch: vi.fn(() => ({})),
    findOrCreateForOwner: vi.fn(),
    materializePostedOpportunityFromListing: vi.fn(),
    mutateProjection: vi.fn(),
    researchEntityFindById: vi.fn(),
    researchEntityUpdateOne: vi.fn(),
    resolveResearcherIdForPersonName: vi.fn(),
    roleAssignmentFindOne: vi.fn(),
  };
});

vi.mock('../../db/connections', () => ({
  getListingModel: () => mocks.MockListing,
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    findById: mocks.researchEntityFindById,
    updateOne: mocks.researchEntityUpdateOne,
  },
}));

vi.mock('../../models/roleAssignment', () => ({
  RoleAssignment: {
    findOne: mocks.roleAssignmentFindOne,
  },
}));

vi.mock('../researcherPersonNameResolver', () => ({
  resolveResearcherIdForPersonName: mocks.resolveResearcherIdForPersonName,
}));

vi.mock('../../utils/smartTitle', () => ({
  isCustomTitle: vi.fn(() => true),
  generateSmartTitle: vi.fn(),
}));

vi.mock('../listingResearchEntityProfile', () => ({
  buildListingResearchEntityProfilePatch: mocks.buildListingResearchEntityProfilePatch,
}));

vi.mock('../postedOpportunityService', () => ({
  materializePostedOpportunityFromListing: mocks.materializePostedOpportunityFromListing,
}));

vi.mock('../adminAccessReviewProjectionService', () => ({
  mutateAndRefreshAdminAccessReviewProjection: mocks.mutateProjection,
}));

vi.mock('../researchGroupService', () => ({
  findOrCreateForOwner: mocks.findOrCreateForOwner,
}));

import { normalizeListingObjectId, updateListing } from '../listingService';

describe('listingService', () => {
  beforeEach(() => {
    mocks.state.savedDocs = [];
    mocks.state.findByIdDoc = null;
    mocks.state.lastFindByIdAndUpdate = null;
    mocks.state.nextListingId = '64a000000000000000000099';
    mocks.buildListingResearchEntityProfilePatch.mockClear();
    mocks.findOrCreateForOwner.mockReset();
    mocks.materializePostedOpportunityFromListing.mockReset();
    mocks.mutateProjection.mockReset();
    mocks.mutateProjection.mockImplementation(
      (_id: unknown, mutate: (session: mongoose.ClientSession) => unknown) => mutate({} as any),
    );
    mocks.researchEntityFindById.mockReset();
    mocks.researchEntityUpdateOne.mockReset();
    mocks.resolveResearcherIdForPersonName.mockReset();
    mocks.roleAssignmentFindOne.mockReset();
    mocks.resolveResearcherIdForPersonName.mockResolvedValue({ status: 'absent' });
    mocks.roleAssignmentFindOne.mockReturnValue({
      select: () => ({ lean: async () => null }),
    });

    mocks.researchEntityFindById.mockImplementation((id: string) => ({
      lean: async () => ({ _id: id, name: 'Entity' }),
    }));
  });

  it('normalizes listing ObjectIds without arbitrary object coercion', () => {
    const id = '64a000000000000000000001';

    expect(normalizeListingObjectId(id)).toBe(id);
    expect(normalizeListingObjectId(new mongoose.Types.ObjectId(id))).toBe(id);
    expect(
      normalizeListingObjectId({
        toString: () => id,
      }),
    ).toBeUndefined();
  });

  it('rejects object-shaped listing ids before update model work', async () => {
    await expect(
      updateListing(
        { toString: () => '64a000000000000000000001' },
        'owner1',
        { title: 'Unsafe update' },
        true,
      ),
    ).rejects.toThrow(/expected id type ObjectId/);

    expect(mocks.state.lastFindByIdAndUpdate).toBeNull();
  });

  it('does not let an owner add forged collaborators while updating a listing', async () => {
    const listingId = '64a000000000000000000008';
    mocks.state.findByIdDoc = new mocks.MockListing({
      _id: listingId,
      ownerId: 'owner123',
      ownerFirstName: 'Owner',
      ownerLastName: 'Professor',
      professorIds: [],
      professorNames: [],
      emails: [],
      title: 'Original title',
      description: 'Original description',
    });
    mocks.state.findByIdDoc._id = listingId;

    const listing = await updateListing(listingId, 'owner123', {
      title: 'Updated title',
      professorIds: ['victim123'],
      professorNames: ['Victim Professor'],
      emails: ['victim123@yale.edu'],
      ownerId: 'victim123',
      archived: true,
      confirmed: true,
    });

    expect(mocks.state.lastFindByIdAndUpdate).toMatchObject({
      id: listingId,
      data: { title: 'Updated title' },
    });
    expect(mocks.state.lastFindByIdAndUpdate.data).not.toHaveProperty('professorIds');
    expect(mocks.state.lastFindByIdAndUpdate.data).not.toHaveProperty('professorNames');
    expect(mocks.state.lastFindByIdAndUpdate.data).not.toHaveProperty('emails');
    expect(mocks.state.lastFindByIdAndUpdate.data).not.toHaveProperty('ownerId');
    expect(mocks.state.lastFindByIdAndUpdate.data).not.toHaveProperty('archived');
    expect(mocks.state.lastFindByIdAndUpdate.data).not.toHaveProperty('confirmed');
    expect(listing.professorIds).toEqual([]);
    expect(listing.professorNames).toEqual([]);
    expect(listing.emails).toEqual([]);
    expect(listing.ownerId).toBe('owner123');
  });

  it('sanitizes self-service listing update payloads before storage and indexing', async () => {
    const listingId = '64a000000000000000000013';
    mocks.state.findByIdDoc = new mocks.MockListing({
      _id: listingId,
      ownerId: 'owner123',
      ownerFirstName: 'Owner',
      ownerLastName: 'Professor',
      professorIds: [],
      title: 'Original title',
      description: 'Original description',
    });
    mocks.state.findByIdDoc._id = listingId;

    await updateListing(listingId, 'owner123', {
      title: `  ${'U'.repeat(180)}  `,
      description: `  ${'R'.repeat(5100)}  `,
      websites: [
        'https://example.yale.edu/update',
        'https://user:pass@example.yale.edu/private',
        'data:text/html,<script>alert(1)</script>',
      ],
      researchAreas: Array.from({ length: 60 }, (_, index) => `Area ${index}`),
      keywords: [' keyword ', null],
      departments: 'not-an-array',
      applicantDescription: { nested: true },
    });

    expect(mocks.state.lastFindByIdAndUpdate?.data.title).toHaveLength(160);
    expect(mocks.state.lastFindByIdAndUpdate?.data.description).toHaveLength(5000);
    expect(mocks.state.lastFindByIdAndUpdate?.data.websites).toEqual([
      'https://example.yale.edu/update',
    ]);
    expect(mocks.state.lastFindByIdAndUpdate?.data.researchAreas).toHaveLength(50);
    expect(mocks.state.lastFindByIdAndUpdate?.data.keywords).toEqual(['keyword']);
    expect(mocks.state.lastFindByIdAndUpdate?.data).not.toHaveProperty('departments');
    expect(mocks.state.lastFindByIdAndUpdate?.data).not.toHaveProperty('applicantDescription');
  });

  it('bounds admin listing update payloads before storage and collaborator linking', async () => {
    const listingId = '64a000000000000000000014';
    mocks.state.findByIdDoc = new mocks.MockListing({
      _id: listingId,
      ownerId: 'owner123',
      ownerFirstName: 'Owner',
      ownerLastName: 'Professor',
      professorIds: [],
      title: 'Original title',
      description: 'Original description',
    });
    mocks.state.findByIdDoc._id = listingId;

    const professorIds = Array.from({ length: 50 }, (_, index) => `prof${index}`);
    Object.defineProperty(professorIds, '50', {
      get: () => {
        throw new Error('admin listing sanitizer read past collaborator cap');
      },
      enumerable: true,
    });

    await updateListing(
      listingId,
      'admin123',
      {
        title: `  ${'A'.repeat(180)}  `,
        websites: ['https://example.yale.edu/admin-listing', 'javascript:alert(document.cookie)'],
        professorIds,
        professorNames: Array.from({ length: 60 }, (_, index) => ` Professor ${index} `),
        emails: ['owner123@yale.edu', { nested: true }],
        ownerId: 'NEWOWNER123',
        researchEntityId: '64a000000000000000000099',
        createdByUserId: { unsafe: true },
        views: '42',
        favorites: '1000001',
        archived: true,
        confirmed: true,
        embedding: [1, 2, 3],
        raw: { private: true },
      },
      true,
    );

    const update = mocks.state.lastFindByIdAndUpdate?.data;
    expect(update.title).toHaveLength(160);
    expect(update.websites).toEqual(['https://example.yale.edu/admin-listing']);
    expect(update.professorIds).toHaveLength(50);
    expect(update.professorNames).toHaveLength(50);
    expect(update.emails).toEqual(['owner123@yale.edu']);
    expect(update.ownerId).toBe('newowner123');
    expect(update.researchEntityId).toBe('64a000000000000000000099');
    expect(update.views).toBe(42);
    expect(update.archived).toBe(true);
    expect(update.confirmed).toBe(true);
    expect(update).not.toHaveProperty('favorites');
    expect(update).not.toHaveProperty('createdByUserId');
    expect(update).not.toHaveProperty('embedding');
    expect(update).not.toHaveProperty('raw');
  });

  it('does not let a generic owner update change listing review or archive state', async () => {
    const listingId = '64a000000000000000000009';
    mocks.state.findByIdDoc = new mocks.MockListing({
      _id: listingId,
      ownerId: 'owner123',
      ownerFirstName: 'Owner',
      ownerLastName: 'Professor',
      professorIds: [],
      title: 'Original title',
      confirmed: false,
      archived: false,
    });
    mocks.state.findByIdDoc._id = listingId;

    const listing = await updateListing(listingId, 'owner123', {
      title: 'Updated title',
      confirmed: true,
      archived: true,
    });

    expect(mocks.state.lastFindByIdAndUpdate).toMatchObject({
      id: listingId,
      data: { title: 'Updated title' },
    });
    expect(mocks.state.lastFindByIdAndUpdate.data).not.toHaveProperty('confirmed');
    expect(mocks.state.lastFindByIdAndUpdate.data).not.toHaveProperty('archived');
    expect(listing.confirmed).toBe(false);
    expect(listing.archived).toBe(false);
  });

});
