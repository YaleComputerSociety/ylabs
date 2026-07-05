import { describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';

import { createRateLimitHandler } from '../rateLimitResponse';

const createResponse = () => {
  const res = {
    setHeader: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };

  return res as unknown as Response;
};

describe('rateLimitResponse', () => {
  it('returns structured JSON and Retry-After when reset time is available', () => {
    const req = {
      rateLimit: {
        resetTime: new Date(Date.now() + 61_000),
      },
    } as unknown as Request;
    const res = createResponse();

    createRateLimitHandler('Slow down.')(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(res.json).toHaveBeenCalledWith({
      error: 'Slow down.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: expect.any(Number),
    });
  });
});
