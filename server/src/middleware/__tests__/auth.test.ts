import { describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';

import { isAuthenticated, isAdmin } from '../auth';

const createResponse = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };

  return res as unknown as Response;
};

describe('auth middleware', () => {
  it('returns a stable 401 payload for missing sessions', () => {
    const res = createResponse();

    isAuthenticated({} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      code: 'AUTH_REQUIRED',
    });
  });

  it('does not convert forbidden admin checks into auth failures', () => {
    const req = { user: { userType: 'student' } } as unknown as Request;
    const res = createResponse();

    isAdmin(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin privileges required' });
  });
});
