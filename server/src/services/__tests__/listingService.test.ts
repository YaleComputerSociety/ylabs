import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    addOwnListings: vi.fn(),
    buildListingResearchEntityProfilePatch: vi.fn(() => ({})),
    createUser: vi.fn(),
    deleteOwnListings: vi.fn(),
    fetchYalie: vi.fn(),
    findOrCreateForOwner: vi.fn(),
    getMeiliIndex: vi.fn(),
    materializePostedOpportunityFromListing: vi.fn(),
    processListingTitle: vi.fn(async (title: string) => title),
    readUser: vi.fn(),
    researchEntityFindById: vi.fn(),
    researchEntityUpdateOne: vi.fn(),
    researchGroupMemberFindOne: vi.fn(),
    userExists: vi.fn(),
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

vi.mock('../../models/researchGroupMember', () => ({
  ResearchGroupMember: {
    findOne: mocks.researchGroupMemberFindOne,
  },
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: mocks.getMeiliIndex,
}));

vi.mock('../../utils/smartTitle', () => ({
  processListingTitle: mocks.processListingTitle,
  isCustomTitle: vi.fn(() => true),
  generateSmartTitle: vi.fn(),
}));

vi.mock('../listingResearchEntityProfile', () => ({
  buildListingResearchEntityProfilePatch: mocks.buildListingResearchEntityProfilePatch,
}));

vi.mock('../postedOpportunityService', () => ({
  materializePostedOpportunityFromListing: mocks.materializePostedOpportunityFromListing,
}));

vi.mock('../researchGroupService', () => ({
  findOrCreateForOwner: mocks.findOrCreateForOwner,
}));

vi.mock('../userService', () => ({
  addOwnListings: mocks.addOwnListings,
  createUser: mocks.createUser,
  deleteOwnListings: mocks.deleteOwnListings,
  readUser: mocks.readUser,
  userExists: mocks.userExists,
}));

vi.mock('../yaliesService', () => ({
  fetchYalie: mocks.fetchYalie,
}));

import { archiveListing, createListing, updateListing } from '../listingService';

describe('listingService', () => {
  beforeEach(() => {
    mocks.state.savedDocs = [];
    mocks.state.findByIdDoc = null;
    mocks.state.lastFindByIdAndUpdate = null;
    mocks.addOwnListings.mockReset();
    mocks.buildListingResearchEntityProfilePatch.mockClear();
    mocks.createUser.mockReset();
    mocks.deleteOwnListings.mockReset();
    mocks.fetchYalie.mockReset();
    mocks.findOrCreateForOwner.mockReset();
    mocks.getMeiliIndex.mockReset();
    mocks.materializePostedOpportunityFromListing.mockReset();
    mocks.processListingTitle.mockClear();
    mocks.readUser.mockReset();
    mocks.researchEntityFindById.mockReset();
    mocks.researchEntityUpdateOne.mockReset();
    mocks.researchGroupMemberFindOne.mockReset();
    mocks.userExists.mockReset();

    mocks.getMeiliIndex.mockResolvedValue({
      addDocuments: vi.fn(),
      updateDocuments: vi.fn(),
      deleteDocument: vi.fn(),
    });
    mocks.researchEntityFindById.mockImplementation((id: string) => ({
      lean: async () => ({ _id: id, name: 'Entity' }),
    }));
    mocks.userExists.mockResolvedValue(true);
  });

  it('does not let a faculty user attach a new listing to an unrelated research entity', async () => {
    const ownerEntityId = '64a000000000000000000001';
    const forgedEntityId = '64a000000000000000000002';
    const ownerUserId = '64a000000000000000000003';

    mocks.findOrCreateForOwner.mockResolvedValue({
      group: { _id: ownerEntityId },
      created: false,
    });
    mocks.researchGroupMemberFindOne.mockReturnValue({
      select: () => ({
        lean: async () => null,
      }),
    });

    const listing = await createListing(
      {
        title: 'Research assistant',
        description: 'Help with a research project.',
        professorIds: [],
        researchEntityId: forgedEntityId,
      },
      {
        _id: ownerUserId,
        netid: 'abc123',
        email: 'abc123@yale.edu',
        fname: 'Ada',
        lname: 'Lovelace',
        userConfirmed: true,
      },
    );

    expect(mocks.findOrCreateForOwner).toHaveBeenCalledWith(
      expect.objectContaining({ _id: ownerUserId, netid: 'abc123' }),
    );
    expect(String(listing.researchEntityId)).toBe(ownerEntityId);
    expect(String(listing.researchGroupId)).toBe(ownerEntityId);
    expect(String(listing.createdByUserId)).toBe(ownerUserId);
  });

  it('keeps a supplied research entity when the owner is an authorized current member', async () => {
    const authorizedEntityId = '64a000000000000000000004';
    const ownerUserId = '64a000000000000000000005';

    mocks.researchGroupMemberFindOne.mockReturnValue({
      select: () => ({
        lean: async () => ({ _id: 'membership-1' }),
      }),
    });

    const listing = await createListing(
      {
        title: 'Research assistant',
        description: 'Help with a research project.',
        professorIds: [],
        researchEntityId: authorizedEntityId,
      },
      {
        _id: ownerUserId,
        netid: 'def456',
        email: 'def456@yale.edu',
        fname: 'Grace',
        lname: 'Hopper',
        userConfirmed: true,
      },
    );

    expect(mocks.researchGroupMemberFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: authorizedEntityId,
        $or: [{ userId: ownerUserId }],
      }),
    );
    expect(mocks.findOrCreateForOwner).not.toHaveBeenCalled();
    expect(String(listing.researchEntityId)).toBe(authorizedEntityId);
    expect(String(listing.researchGroupId)).toBe(authorizedEntityId);
  });

  it('does not let a faculty user add forged collaborators while creating a listing', async () => {
    const ownerEntityId = '64a000000000000000000006';
    const ownerUserId = '64a000000000000000000007';

    mocks.findOrCreateForOwner.mockResolvedValue({
      group: { _id: ownerEntityId },
      created: false,
    });

    const listing = await createListing(
      {
        title: 'Research assistant',
        description: 'Help with a research project.',
        professorIds: ['victim123'],
        professorNames: ['Victim Professor'],
        emails: ['victim123@yale.edu'],
      },
      {
        _id: ownerUserId,
        netid: 'ghi789',
        email: 'ghi789@yale.edu',
        fname: 'Katherine',
        lname: 'Johnson',
        userConfirmed: true,
      },
    );

    expect(listing.professorIds).toEqual([]);
    expect(listing.professorNames).toEqual([]);
    expect(listing.emails).toEqual([]);
    expect(mocks.userExists).not.toHaveBeenCalledWith('victim123');
    expect(mocks.addOwnListings).not.toHaveBeenCalledWith(
      'victim123',
      expect.arrayContaining([expect.anything()]),
    );
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
    expect(mocks.userExists).not.toHaveBeenCalledWith('victim123');
    expect(mocks.addOwnListings).not.toHaveBeenCalledWith(
      'victim123',
      expect.arrayContaining([listingId]),
    );
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

  it('keeps the explicit owner archive path working outside generic updates', async () => {
    const listingId = '64a000000000000000000010';
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

    const listing = await archiveListing(listingId, 'owner123');

    expect(mocks.state.lastFindByIdAndUpdate).toMatchObject({
      id: listingId,
      data: { archived: true },
    });
    expect(listing.archived).toBe(true);
    expect(listing.confirmed).toBe(false);
  });
});
