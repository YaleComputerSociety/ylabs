import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOpportunityDetail: vi.fn(),
}));

vi.mock('../../services/opportunityDetailService', () => ({
  getOpportunityDetail: mocks.getOpportunityDetail,
}));

import { getOpportunityById } from '../opportunityController';

const responseDouble = () =>
  ({
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: any, body: unknown) {
      this.body = body;
      return this;
    }),
  }) as any;

describe('opportunityController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not echo opportunity ids from missing public opportunity details', async () => {
    mocks.getOpportunityDetail.mockResolvedValue(null);

    const req = { params: { id: '507f1f77bcf86cd799439011' } } as any;
    const res = responseDouble();

    await getOpportunityById(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Opportunity not found' });
  });

  it('rejects malformed opportunity ids before service work', async () => {
    const req = { params: { id: 'private-opportunity-id' } } as any;
    const res = responseDouble();

    await getOpportunityById(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid opportunity id' });
    expect(mocks.getOpportunityDetail).not.toHaveBeenCalled();
  });

  it('rejects oversized opportunity ids before service work', async () => {
    const req = { params: { id: 'a'.repeat(4096) } } as any;
    const res = responseDouble();

    await getOpportunityById(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid opportunity id' });
    expect(mocks.getOpportunityDetail).not.toHaveBeenCalled();
  });

  it('does not leak internal service errors from public opportunity detail failures', async () => {
    mocks.getOpportunityDetail.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid opportunity detail failed'),
    );

    const req = { params: { id: '507f1f77bcf86cd799439011' } } as any;
    const res = responseDouble();

    await getOpportunityById(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch opportunity' });
  });
});
