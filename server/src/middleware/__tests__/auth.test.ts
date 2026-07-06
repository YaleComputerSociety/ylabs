import { describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';

import { canSubmitListingClaimRequest } from '../auth';

const createResponse = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };

  return res as unknown as Response;
};

const createRequest = (user?: Record<string, unknown>) => ({ user }) as unknown as Request;

describe('canSubmitListingClaimRequest', () => {
  it.each([
    ['student', { netId: 'student1', userType: 'student', userConfirmed: true }],
    ['undergraduate', { netId: 'student1', userType: 'undergraduate', userConfirmed: true }],
    ['unknown', { netId: 'unknown1', userType: 'unknown', userConfirmed: true }],
    ['unconfirmed faculty', { netId: 'fac1', userType: 'faculty', userConfirmed: false }],
  ])('rejects %s users from submitting listing claim requests', (_label, user) => {
    const res = createResponse();
    const next = vi.fn();

    canSubmitListingClaimRequest(createRequest(user), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it.each([
    ['faculty', { netId: 'fac1', userType: 'faculty', userConfirmed: true }],
    ['professor', { netId: 'prof1', userType: 'professor', userConfirmed: true }],
    ['admin', { netId: 'admin1', userType: 'admin', userConfirmed: true }],
    ['staff', { netId: 'staff1', userType: 'staff', userConfirmed: true }],
  ])('allows confirmed %s users to submit listing claim requests', (_label, user) => {
    const res = createResponse();
    const next = vi.fn();

    canSubmitListingClaimRequest(createRequest(user), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 401 when no authenticated user is present', () => {
    const res = createResponse();
    const next = vi.fn();

    canSubmitListingClaimRequest(createRequest(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });
});
