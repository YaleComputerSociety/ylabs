import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requireFields, validateObjectId, validateQuery } from '../validation';

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

  it('rejects 12-byte non-hex values that mongoose would otherwise coerce as ObjectIds', () => {
    const response = createResponse();
    const next = vi.fn() as unknown as NextFunction;
    const request = {
      params: {
        id: 'abcdefghijkl',
      },
    } as unknown as Request;

    validateObjectId('id')(request, response, next);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'Invalid id' });
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts canonical 24-hex ObjectIds', () => {
    const response = createResponse();
    const next = vi.fn() as unknown as NextFunction;
    const request = {
      params: {
        id: '507f1f77bcf86cd799439011',
      },
    } as unknown as Request;

    validateObjectId('id')(request, response, next);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
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

  it('requires body fields to be own properties', () => {
    const response = createResponse();
    const next = vi.fn() as unknown as NextFunction;
    const inheritedBody = Object.create({ role: 'admin' });
    inheritedBody.name = 'Ada';
    const request = { body: inheritedBody } as unknown as Request;

    requireFields(['name', 'role'])(request, response, next);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'Missing required fields: role' });
    expect(next).not.toHaveBeenCalled();
  });
});
