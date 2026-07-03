import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/listingService', () => ({
  addView: vi.fn(),
  archiveListing: vi.fn(),
  createListing: vi.fn(),
  deleteListing: vi.fn(),
  getSkeletonListing: vi.fn(),
  readAllListings: vi.fn(),
  readListing: vi.fn(),
  readPublicListing: vi.fn(),
  readPublicListings: vi.fn(),
  unarchiveListing: vi.fn(),
  updateListing: vi.fn(),
}));

const meiliMocks = vi.hoisted(() => ({
  getMeiliIndex: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: meiliMocks.getMeiliIndex,
}));

vi.mock('../../services/userService', () => ({
  readUser: vi.fn(),
}));

import {
  addView,
  archiveListing,
  createListing,
  deleteListing,
  getSkeletonListing,
  readListing,
  readPublicListing,
  unarchiveListing,
  updateListing,
} from '../../services/listingService';
import { readUser } from '../../services/userService';
import {
  addViewToListing,
  archiveListingForCurrentUser,
  createListingForCurrentUser,
  deleteListingForCurrentUser,
  getListingById,
  getSkeletonListingForCurrentUser,
  searchListings,
  unarchiveListingForCurrentUser,
  updateListingForCurrentUser,
} from '../listingController';

const mockedUpdateListing = vi.mocked(updateListing);
const mockedReadListing = vi.mocked(readListing);
const mockedReadPublicListing = vi.mocked(readPublicListing);
const mockedAddView = vi.mocked(addView);
const mockedCreateListing = vi.mocked(createListing);
const mockedGetSkeletonListing = vi.mocked(getSkeletonListing);
const mockedReadUser = vi.mocked(readUser);
const mockedArchiveListing = vi.mocked(archiveListing);
const mockedUnarchiveListing = vi.mocked(unarchiveListing);
const mockedDeleteListing = vi.mocked(deleteListing);

const privateListing = {
  _id: 'listing-1',
  id: 'listing-1',
  ownerTitle: 'Professor',
  ownerPrimaryDepartment: 'Computer Science',
  title: 'Research assistant',
  description: 'Help with a project.',
  applicantDescription: 'Students will learn methods.',
  websites: [
    'https://example.yale.edu/apply',
    'https://user:pass@example.yale.edu/private',
    'javascript:alert(document.cookie)',
    'mailto:owner123@yale.edu',
    'not-a-url',
  ],
  departments: ['Computer Science'],
  researchAreas: ['Systems'],
  keywords: ['systems'],
  established: '2025',
  type: 'Research Assistant',
  commitment: '5 hours/week',
  compensationType: 'Paid',
  expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-02T00:00:00.000Z'),
  ownerId: 'owner123',
  ownerEmail: 'owner123@yale.edu',
  ownerFirstName: 'Owner',
  ownerLastName: 'Professor',
  professorIds: ['victim123'],
  professorNames: ['Victim Professor'],
  emails: ['victim123@yale.edu'],
  createdByUserId: '64a000000000000000000001',
  views: 42,
  favorites: ['student123'],
  archived: false,
  confirmed: true,
  audited: true,
  embedding: [0.1, 0.2],
};

const expectPublicListing = (payload: any) => {
  expect(payload).toMatchObject({
    _id: 'listing-1',
    id: 'listing-1',
    title: 'Research assistant',
    description: 'Help with a project.',
    applicantDescription: 'Students will learn methods.',
    websites: ['https://example.yale.edu/apply'],
    departments: ['Computer Science'],
    researchAreas: ['Systems'],
    keywords: ['systems'],
    established: '2025',
    type: 'Research Assistant',
    commitment: '5 hours/week',
    compensationType: 'Paid',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  expect(payload).not.toHaveProperty('createdAt');
  expect(payload).not.toHaveProperty('updatedAt');
  expect(payload).not.toHaveProperty('ownerId');
  expect(payload).not.toHaveProperty('ownerEmail');
  expect(payload).not.toHaveProperty('ownerFirstName');
  expect(payload).not.toHaveProperty('ownerLastName');
  expect(payload).not.toHaveProperty('professorIds');
  expect(payload).not.toHaveProperty('professorNames');
  expect(payload).not.toHaveProperty('emails');
  expect(payload).not.toHaveProperty('createdByUserId');
  expect(payload).not.toHaveProperty('views');
  expect(payload).not.toHaveProperty('favorites');
  expect(payload).not.toHaveProperty('archived');
  expect(payload).not.toHaveProperty('confirmed');
  expect(payload).not.toHaveProperty('audited');
  expect(payload).not.toHaveProperty('embedding');
};

const responseDouble = () => ({
  statusCode: 200,
  body: undefined as unknown,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(body: unknown) {
    this.body = body;
    return this;
  },
});

describe('listingController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not pass collaborator identity fields through self-service listing updates', async () => {
    mockedUpdateListing.mockResolvedValue({ _id: 'listing-1', title: 'Updated title' });

    const req = {
      params: { id: 'listing-1' },
      user: { netId: 'owner123', userType: 'professor', userConfirmed: true },
      body: {
        data: {
          title: 'Updated title',
          professorIds: ['victim123'],
          professorNames: ['Victim Professor'],
          emails: ['victim123@yale.edu'],
        },
      },
    };
    const res = responseDouble();
    const next = vi.fn();

    await updateListingForCurrentUser(req as any, res as any, next);

    expect(mockedUpdateListing).toHaveBeenCalledWith('listing-1', 'owner123', {
      title: 'Updated title',
    });
    expect((res.body as any).listing).toMatchObject({ _id: 'listing-1', title: 'Updated title' });
    expect(JSON.stringify(res.body)).not.toContain('victim123');
    expect(next).not.toHaveBeenCalled();
  });

  it('allowlists Meili listing search results for authenticated readers', async () => {
    meiliMocks.getMeiliIndex.mockResolvedValue({
      search: vi.fn().mockResolvedValue({
        hits: [privateListing],
        estimatedTotalHits: 1,
      }),
    });
    const req = {
      query: { query: '', page: '1', pageSize: '10' },
    };
    const res = responseDouble();

    await searchListings(req as any, res as any);

    expect((res.body as any).totalCount).toBe(1);
    expectPublicListing((res.body as any).results[0]);
  });

  it('normalizes unsafe listing search sort fields before querying Meili', async () => {
    const search = vi.fn().mockResolvedValue({ hits: [], estimatedTotalHits: 0 });
    meiliMocks.getMeiliIndex.mockResolvedValue({ search });
    const req = {
      query: {
        query: '',
        sortBy: 'ownerEmail',
        sortOrder: '1',
        page: '1',
        pageSize: '10',
      },
    };
    const res = responseDouble();

    await searchListings(req as any, res as any);

    expect(search).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        sort: ['expiresAt:asc'],
      }),
    );
  });

  it('keeps allowed listing search sort fields before querying Meili', async () => {
    const search = vi.fn().mockResolvedValue({ hits: [], estimatedTotalHits: 0 });
    meiliMocks.getMeiliIndex.mockResolvedValue({ search });
    const req = {
      query: {
        query: '',
        sortBy: 'title',
        sortOrder: '1',
        page: '1',
        pageSize: '10',
      },
    };
    const res = responseDouble();

    await searchListings(req as any, res as any);

    expect(search).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        sort: ['title:asc'],
      }),
    );
  });

  it('clamps invalid listing search pagination before querying Meili', async () => {
    const search = vi.fn().mockResolvedValue({ hits: [], estimatedTotalHits: 0 });
    meiliMocks.getMeiliIndex.mockResolvedValue({ search });
    const req = {
      query: {
        query: '',
        page: '-10',
        pageSize: '1000000',
      },
    };
    const res = responseDouble();

    await searchListings(req as any, res as any);

    expect(search).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        limit: 100,
        offset: 0,
      }),
    );
    expect((res.body as any).page).toBe(1);
    expect((res.body as any).pageSize).toBe(100);
  });

  it('caps listing search page before building Meili offsets', async () => {
    const search = vi.fn().mockResolvedValue({ hits: [], estimatedTotalHits: 0 });
    meiliMocks.getMeiliIndex.mockResolvedValue({ search });
    const req = {
      query: {
        query: '',
        page: '999999999',
        pageSize: '100',
      },
    };
    const res = responseDouble();

    await searchListings(req as any, res as any);

    expect(search).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        limit: 100,
        offset: 99_900,
      }),
    );
    expect((res.body as any).page).toBe(1000);
    expect((res.body as any).pageSize).toBe(100);
  });

  it('does not coerce object pagination values for listing search', async () => {
    const search = vi.fn().mockResolvedValue({ hits: [], estimatedTotalHits: 0 });
    meiliMocks.getMeiliIndex.mockResolvedValue({ search });
    const page = { toString: vi.fn(() => '999999999') };
    const pageSize = { toString: vi.fn(() => '500') };
    const req = {
      query: {
        query: '',
        page,
        pageSize,
      },
    };
    const res = responseDouble();

    await searchListings(req as any, res as any);

    expect(page.toString).not.toHaveBeenCalled();
    expect(pageSize.toString).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        limit: 10,
        offset: 0,
      }),
    );
    expect((res.body as any).page).toBe(1);
    expect((res.body as any).pageSize).toBe(10);
  });

  it('bounds listing search query and filters before querying Meili', async () => {
    const search = vi.fn().mockResolvedValue({ hits: [], estimatedTotalHits: 0 });
    meiliMocks.getMeiliIndex.mockResolvedValue({ search });
    const longResearchArea = 'x'.repeat(200);
    const req = {
      query: {
        query: ` ${'q'.repeat(700)} `,
        departments: Array.from({ length: 60 }, (_, index) => `Department ${index}`).join('||'),
        researchAreas: longResearchArea,
        page: '1',
        pageSize: '10',
      },
    };
    const res = responseDouble();

    await searchListings(req as any, res as any);

    expect(search).toHaveBeenCalledWith(
      'q'.repeat(512),
      expect.objectContaining({
        filter: expect.stringContaining('departments = "Department 49"'),
      }),
    );
    const filter = String(search.mock.calls[0][1].filter);
    expect(filter).not.toContain('Department 50');
    expect(filter).toContain(`researchAreas = "${'x'.repeat(120)}"`);
    expect(filter).not.toContain(longResearchArea);
  });

  it('allowlists listing detail payloads for authenticated readers', async () => {
    mockedReadPublicListing.mockResolvedValue(privateListing);
    const req = { params: { id: 'listing-1' } };
    const res = responseDouble();

    await getListingById(req as any, res as any);

    expectPublicListing((res.body as any).listing);
  });

  it('redacts direct contact text from public listing descriptions', async () => {
    mockedReadPublicListing.mockResolvedValue({
      ...privateListing,
      description: 'Help with a project. Email owner123@yale.edu or call 203-555-1212.',
      applicantDescription: 'Questions go to applicant-contact@yale.edu.',
    });
    const req = { params: { id: 'listing-1' } };
    const res = responseDouble();

    await getListingById(req as any, res as any);

    expect((res.body as any).listing.description).toBe(
      'Help with a project. Email [email redacted] or call [phone redacted].',
    );
    expect((res.body as any).listing.applicantDescription).toBe(
      'Questions go to [email redacted].',
    );
    expect(JSON.stringify((res.body as any).listing)).not.toContain('owner123@yale.edu');
    expect(JSON.stringify((res.body as any).listing)).not.toContain('203-555-1212');
    expect(JSON.stringify((res.body as any).listing)).not.toContain('applicant-contact@yale.edu');
  });

  it('does not leak internal service errors from listing detail failures', async () => {
    mockedReadPublicListing.mockRejectedValue(new Error('mongodb://user:pass@example.invalid leaked'));
    const req = { params: { id: 'listing-1' } };
    const res = responseDouble();

    await getListingById(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch listing' });
  });

  it('does not leak internal not-found messages from listing detail failures', async () => {
    mockedReadPublicListing.mockRejectedValue(
      Object.assign(new Error('Listing not found with ObjectId: private-listing-id'), {
        name: 'NotFoundError',
        status: 404,
      }),
    );
    const req = { params: { id: 'private-listing-id' } };
    const res = responseDouble();

    await getListingById(req as any, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Listing not found' });
  });

  it('allowlists listing view payloads for authenticated readers', async () => {
    mockedAddView.mockResolvedValue(privateListing);
    const req = {
      params: { id: 'listing-1' },
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    };
    const res = responseDouble();

    await addViewToListing(req as any, res as any);

    expect(mockedAddView).toHaveBeenCalledWith('listing-1', 'student123');
    expectPublicListing((res.body as any).listing);
  });

  it('does not leak internal service errors from listing view failures', async () => {
    mockedAddView.mockRejectedValue(new Error('mongodb://user:pass@example.invalid leaked'));
    const req = {
      params: { id: 'listing-1' },
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    };
    const res = responseDouble();

    await addViewToListing(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update listing view count' });
  });

  it('does not leak internal service errors from listing create failures', async () => {
    mockedReadUser.mockResolvedValue({ netid: 'owner123' } as any);
    mockedCreateListing.mockRejectedValue(new Error('mongodb://user:pass@example.invalid leaked'));
    const req = {
      user: { netId: 'owner123', userType: 'professor', userConfirmed: true },
      body: { data: { title: 'New listing' } },
    };
    const res = responseDouble();

    await createListingForCurrentUser(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to create listing' });
  });

  it('allowlists listing skeleton payloads for authenticated creators', async () => {
    mockedGetSkeletonListing.mockResolvedValue(privateListing);
    const req = {
      user: { netId: 'owner123', userType: 'professor', userConfirmed: true },
    };
    const res = responseDouble();

    await getSkeletonListingForCurrentUser(req as any, res as any);

    expect(mockedGetSkeletonListing).toHaveBeenCalledWith('owner123');
    expectPublicListing((res.body as any).listing);
  });

  it('does not leak internal service errors from listing skeleton failures', async () => {
    mockedGetSkeletonListing.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );
    const req = {
      user: { netId: 'owner123', userType: 'professor', userConfirmed: true },
    };
    const res = responseDouble();

    await getSkeletonListingForCurrentUser(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to initialize listing' });
  });

  it('does not leak internal service errors from listing update failures', async () => {
    mockedUpdateListing.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );
    const req = {
      params: { id: 'listing-1' },
      user: { netId: 'owner123', userType: 'professor', userConfirmed: true },
      body: { data: { title: 'Updated title' } },
    };
    const res = responseDouble();
    const next = vi.fn();

    await updateListingForCurrentUser(req as any, res as any, next);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update listing' });
    expect(next).not.toHaveBeenCalled();
  });

  it('does not leak internal service errors from listing archive failures', async () => {
    mockedArchiveListing.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );
    const req = {
      params: { id: 'listing-1' },
      user: { netId: 'owner123', userType: 'professor', userConfirmed: true },
    };
    const res = responseDouble();

    await archiveListingForCurrentUser(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to archive listing' });
  });

  it('does not leak internal service errors from listing unarchive failures', async () => {
    mockedUnarchiveListing.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );
    const req = {
      params: { id: 'listing-1' },
      user: { netId: 'owner123', userType: 'professor', userConfirmed: true },
    };
    const res = responseDouble();

    await unarchiveListingForCurrentUser(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to unarchive listing' });
  });

  it('does not leak internal service errors from listing delete read failures', async () => {
    mockedReadListing.mockRejectedValue(new Error('mongodb://user:pass@example.invalid leaked'));
    const req = {
      params: { id: 'listing-1' },
      user: { netId: 'owner123', userType: 'professor', userConfirmed: true },
    };
    const res = responseDouble();

    await deleteListingForCurrentUser(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to delete listing' });
  });

  it('does not leak internal service errors from listing delete write failures', async () => {
    mockedReadListing.mockResolvedValue({ ...privateListing, ownerId: 'owner123' });
    mockedDeleteListing.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid leaked'),
    );
    const req = {
      params: { id: 'listing-1' },
      user: { netId: 'owner123', userType: 'professor', userConfirmed: true },
    };
    const res = responseDouble();

    await deleteListingForCurrentUser(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to delete listing' });
  });

  it('does not leak user or listing ids from listing delete permission failures', async () => {
    mockedReadListing.mockResolvedValue({ ...privateListing, ownerId: 'owner123' });
    const req = {
      params: { id: 'private-listing-id' },
      user: { netId: 'student123', userType: 'undergraduate', userConfirmed: true },
    };
    const res = responseDouble();

    await deleteListingForCurrentUser(req as any, res as any);

    expect(mockedDeleteListing).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
    expect(JSON.stringify(res.body)).not.toContain('student123');
    expect(JSON.stringify(res.body)).not.toContain('private-listing-id');

  });
});
