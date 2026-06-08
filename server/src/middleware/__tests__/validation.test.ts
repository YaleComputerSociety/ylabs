import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { validateObjectId, validateQuery } from '../validation';

const createResponse = () => {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };

  return response as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
};

describe('validation middleware', () => {
  it('does not echo invalid object id values in responses', () => {
    const response = createResponse();
    const next = vi.fn() as unknown as NextFunction;
    const request = {
      params: {
        id: 'mongodb://user:pass@example.invalid/private-id',
      },
    } as unknown as Request;

    validateObjectId('id')(request, response, next);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'Invalid id' });
    expect(next).not.toHaveBeenCalled();
  });

  it('does not echo invalid query parameter names in responses', () => {
    const response = createResponse();
    const next = vi.fn() as unknown as NextFunction;
    const request = {
      query: {
        'mongodb://user:pass@example.invalid/private-key': '1',
      },
    } as unknown as Request;

    validateQuery(['page'])(request, response, next);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'Invalid query parameters' });
    expect(next).not.toHaveBeenCalled();
  });
});
