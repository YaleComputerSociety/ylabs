import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mongooseMock = vi.hoisted(() => ({
  connection: { on: vi.fn(), db: undefined as unknown },
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  createConnection: vi.fn(),
}));

vi.mock('mongoose', () => ({
  default: mongooseMock,
  Connection: class {},
}));

vi.mock('../../models/listing', () => ({
  listingSchema: {},
  Listing: {},
}));

import { isTopologyLostError, withMongoReconnect } from '../connections';

const topologyError = () => Object.assign(new Error('boom'), { name: 'MongoNotConnectedError' });

describe('isTopologyLostError', () => {
  it('matches MongoNotConnectedError by name', () => {
    expect(isTopologyLostError({ name: 'MongoNotConnectedError' })).toBe(true);
  });

  it('matches the driver message even when the name is generic', () => {
    expect(
      isTopologyLostError({
        name: 'Error',
        message: 'Client must be connected before running operations',
      }),
    ).toBe(true);
  });

  it('walks a VError cause() chain', () => {
    const wrapped = {
      name: 'VError',
      message: 'user-provided verify function failed',
      cause: () => ({ name: 'MongoNotConnectedError' }),
    };
    expect(isTopologyLostError(wrapped)).toBe(true);
  });

  it('walks a plain cause property chain', () => {
    expect(isTopologyLostError({ name: 'Wrap', cause: topologyError() })).toBe(true);
  });

  it('returns false for unrelated errors and empty values', () => {
    expect(isTopologyLostError(new Error('validation failed'))).toBe(false);
    expect(isTopologyLostError(null)).toBe(false);
    expect(isTopologyLostError(undefined)).toBe(false);
  });
});

describe('withMongoReconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MONGODBURL = 'mongodb://test-host/db';
    delete process.env.API_MODE;
  });

  afterEach(() => {
    delete process.env.MONGODBURL;
  });

  it('returns the result without retrying when the operation succeeds', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    await expect(withMongoReconnect(operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(mongooseMock.disconnect).not.toHaveBeenCalled();
  });

  it('reconnects and retries once after a topology-lost error', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(topologyError())
      .mockResolvedValueOnce('recovered');

    await expect(withMongoReconnect(operation)).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(mongooseMock.disconnect).toHaveBeenCalledTimes(1);
    expect(mongooseMock.connect).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-topology errors without reconnecting', async () => {
    const validationError = Object.assign(new Error('bad input'), { name: 'ValidationError' });
    const operation = vi.fn().mockRejectedValue(validationError);

    await expect(withMongoReconnect(operation)).rejects.toBe(validationError);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(mongooseMock.disconnect).not.toHaveBeenCalled();
  });

  it('propagates the error when the retry also fails', async () => {
    const operation = vi.fn().mockRejectedValue(topologyError());

    await expect(withMongoReconnect(operation)).rejects.toMatchObject({
      name: 'MongoNotConnectedError',
    });
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
