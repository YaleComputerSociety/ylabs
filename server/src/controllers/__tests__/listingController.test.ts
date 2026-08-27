import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/listingService', () => ({
  addView: vi.fn(),
  archiveListing: vi.fn(),
  createListing: vi.fn(),
  getSkeletonListing: vi.fn(),
  readAllListings: vi.fn(),
  readListing: vi.fn(),
  readPublicListings: vi.fn(),
  unarchiveListing: vi.fn(),
  updateListing: vi.fn(),
}));

vi.mock('../../services/userService', () => ({
  readUser: vi.fn(),
}));

import { addView } from '../../services/listingService';
import { addViewToListing } from '../listingController';

const mockedAddView = vi.mocked(addView);

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
});
