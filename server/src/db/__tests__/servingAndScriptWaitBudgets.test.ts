import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  initializeConnections,
  mongoOptions,
  scriptMongoConnectOptions,
  triggerReconnect,
} from '../connections';

const PROXY_REQUEST_CEILING_MS = 100000;
const SLOWEST_SERVED_REQUEST_MS = 10000;

describe('the serving process wait budget', () => {
  it('gives up on an unreachable database well inside a student request', () => {
    expect(Number(mongoOptions.serverSelectionTimeoutMS)).toBeLessThanOrEqual(5000);
    expect(mongoOptions.bufferTimeoutMS).toBeLessThanOrEqual(5000);
  });

  it('still leaves room for the slowest request this server makes', () => {
    expect(Number(mongoOptions.socketTimeoutMS)).toBeGreaterThan(SLOWEST_SERVED_REQUEST_MS);
    expect(Number(mongoOptions.socketTimeoutMS)).toBeLessThan(PROXY_REQUEST_CEILING_MS);
  });
});

describe('an operator entry point', () => {
  it('keeps the long waits a batch needs', () => {
    const scriptOptions = scriptMongoConnectOptions();

    expect(scriptOptions.socketTimeoutMS).toBe(0);
    expect(Number(scriptOptions.serverSelectionTimeoutMS)).toBeGreaterThan(
      Number(mongoOptions.serverSelectionTimeoutMS),
    );
    expect(scriptOptions.bufferTimeoutMS).toBeGreaterThan(mongoOptions.bufferTimeoutMS);
  });

  it('still lets a caller ask for its own budget', () => {
    expect(scriptMongoConnectOptions({ serverSelectionTimeoutMS: 1000 })).toMatchObject({
      serverSelectionTimeoutMS: 1000,
      autoIndex: false,
      autoCreate: false,
    });
  });
});

describe('connecting and reconnecting', () => {
  const originalUrl = process.env.MONGODBURL;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalUrl === undefined) delete process.env.MONGODBURL;
    else process.env.MONGODBURL = originalUrl;
  });

  const connectBudgets = async (initialize: () => Promise<void>) => {
    process.env.MONGODBURL = 'mongodb://127.0.0.1:1/budget-test';
    const connect = vi.spyOn(mongoose, 'connect').mockResolvedValue(mongoose);
    vi.spyOn(mongoose, 'disconnect').mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await initialize();
    await triggerReconnect();
    return connect.mock.calls.map(([, options]) => options);
  };

  it('gives an entry point that connects without a budget the script waits, reconnect included', async () => {
    const [initial, reconnect] = await connectBudgets(() => initializeConnections());

    expect(initial).toMatchObject({ socketTimeoutMS: 0 });
    expect(reconnect).toEqual(initial);
  });

  it('keeps the serving process on the serving budget across a reconnect', async () => {
    const [initial, reconnect] = await connectBudgets(() => initializeConnections(mongoOptions));

    expect(initial).toBe(mongoOptions);
    expect(reconnect).toBe(mongoOptions);
  });
});
