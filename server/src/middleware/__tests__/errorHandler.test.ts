import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { errorHandler, notFoundHandler } from '../errorHandler';
import { NotFoundError, ObjectIdError } from '../../utils/errors';

const ORIGINAL_ENV = { ...process.env };

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

describe('errorHandler', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('preserves explicit client error statuses without leaking raw messages', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = createResponse();
    const error = Object.assign(new Error('mongodb://user:pass@example.invalid leaked'), { status: 403 });

    errorHandler(
      error,
      {} as Request,
      response,
      vi.fn() as unknown as NextFunction,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('does not leak object ids from not-found errors', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = createResponse();

    errorHandler(
      new NotFoundError('Listing not found with ObjectId: private-listing-id'),
      {} as Request,
      response,
      vi.fn() as unknown as NextFunction,
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  it('does not leak cast/object-id details from object-id errors', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = createResponse();

    errorHandler(
      new ObjectIdError('Invalid ObjectId private-listing-id for Listing'),
      {} as Request,
      response,
      vi.fn() as unknown as NextFunction,
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  it('hides internal messages for remote development-labelled runtimes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      SERVER_BASE_URL: 'https://yalelabs.io',
    };
    const response = createResponse();

    errorHandler(
      new Error('database password appeared in stack context'),
      {} as Request,
      response,
      vi.fn() as unknown as NextFunction,
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      message: undefined,
    });
  });

  it('does not leak validation details in local test responses', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
    };
    const response = createResponse();
    const error = Object.assign(
      new Error('mongodb://user:pass@example.invalid validation context'),
      { name: 'ValidationError' },
    );

    errorHandler(
      error,
      {} as Request,
      response,
      vi.fn() as unknown as NextFunction,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Validation error',
      details: undefined,
    });
  });

  it('does not leak internal messages in local test 500 responses', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
    };
    const response = createResponse();

    errorHandler(
      new Error('mongodb://user:pass@example.invalid local test context'),
      {} as Request,
      response,
      vi.fn() as unknown as NextFunction,
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      message: undefined,
    });
  });
});

describe('notFoundHandler', () => {
  it('does not echo unmatched API paths into 404 responses', () => {
    const response = createResponse();

    notFoundHandler(
      { path: '/token/mongodb://user:pass@example.invalid' } as Request,
      response,
      vi.fn() as unknown as NextFunction,
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ error: 'Not found' });
  });
});
