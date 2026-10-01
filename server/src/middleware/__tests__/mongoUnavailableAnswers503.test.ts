import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const triggerReconnect = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../db/connections', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  triggerReconnect,
}));

vi.mock('../../utils/errorTracking', () => ({
  captureServerError: vi.fn(),
}));

import { errorHandler } from '../errorHandler';
import { captureServerError } from '../../utils/errorTracking';

const createResponse = () => {
  const response = {
    headers: {} as Record<string, string>,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn(function (this: any, name: string, value: string) {
      this.headers[name] = value;
      return this;
    }),
  };
  return response as unknown as Response & {
    headers: Record<string, string>;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
};

const handle = (error: unknown) => {
  const response = createResponse();
  errorHandler(error as Error, {} as Request, response, vi.fn() as unknown as NextFunction);
  return response;
};

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

const unreachableDatabaseErrors = {
  'a server-selection timeout': named(
    'MongooseServerSelectionError',
    'connect ECONNREFUSED 127.0.0.1:27017',
  ),
  'a driver server-selection timeout': named(
    'MongoServerSelectionError',
    'Server selection timed out after 5000 ms',
  ),
  'a socket timeout': named('MongoNetworkTimeoutError', 'connection timed out'),
  'a closed client': named('MongoClientClosedError', 'Operation interrupted because client closed'),
  'a buffering timeout': named(
    'MongooseError',
    'Operation `researchentities.findOne()` buffering timed out after 5000ms',
  ),
  'a lost topology': named('MongoNotConnectedError', 'Client must be connected'),
};

describe('a request that could not reach the database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it.each(Object.entries(unreachableDatabaseErrors))(
    'answers 503 with a retry hint for %s',
    (_label, error) => {
      const response = handle(error);

      expect(response.status).toHaveBeenCalledWith(503);
      expect(response.json).toHaveBeenCalledWith({ error: 'Service temporarily unavailable' });
      expect(Number(response.headers['Retry-After'])).toBeGreaterThan(0);
    },
  );

  it('keeps every outage except a lost topology in error tracking', () => {
    handle(unreachableDatabaseErrors['a lost topology']);
    expect(captureServerError).not.toHaveBeenCalled();

    handle(unreachableDatabaseErrors['a socket timeout']);
    handle(unreachableDatabaseErrors['a server-selection timeout']);
    expect(captureServerError).toHaveBeenCalledTimes(2);
  });

  it('answers 503 when the reason is only in the cause chain', () => {
    const wrapped = Object.assign(new Error('read failed'), {
      cause: named('MongoServerSelectionError', 'Server selection timed out after 5000 ms'),
    });

    expect(handle(wrapped).status).toHaveBeenCalledWith(503);
  });

  it('forces a reconnect for a lost topology only', () => {
    handle(unreachableDatabaseErrors['a lost topology']);
    expect(triggerReconnect).toHaveBeenCalledTimes(1);

    triggerReconnect.mockClear();
    handle(unreachableDatabaseErrors['a server-selection timeout']);
    handle(unreachableDatabaseErrors['a socket timeout']);
    handle(unreachableDatabaseErrors['a buffering timeout']);
    expect(triggerReconnect).not.toHaveBeenCalled();
  });

  it('still answers 500 and reports an error that is not a database outage', () => {
    const response = handle(new Error('a genuine application fault'));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(captureServerError).toHaveBeenCalledTimes(1);
  });
});
