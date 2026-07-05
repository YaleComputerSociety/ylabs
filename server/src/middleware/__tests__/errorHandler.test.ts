import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';

import { errorHandler } from '../errorHandler';
import { captureServerError } from '../../utils/errorTracking';
import { NotFoundError } from '../../utils/errors';

vi.mock('../../utils/errorTracking', () => ({
  captureServerError: vi.fn(),
}));

const createResponse = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };

  return res as unknown as Response;
};

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures unexpected server errors after mapping them to responses', () => {
    const error = new Error('boom');
    const req = {
      method: 'GET',
      path: '/api/test',
      originalUrl: '/api/test?debug=true',
    } as Request;
    const res = createResponse();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    errorHandler(error, req, res, vi.fn());

    expect(captureServerError).toHaveBeenCalledWith(error, req);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      message: undefined,
    });

    consoleError.mockRestore();
  });

  it('does not capture expected operational errors', () => {
    const error = new NotFoundError('missing');
    const req = {
      method: 'GET',
      path: '/api/test',
      originalUrl: '/api/test?debug=true',
    } as Request;
    const res = createResponse();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    errorHandler(error, req, res, vi.fn());

    expect(captureServerError).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'missing' });

    consoleError.mockRestore();
  });
});
