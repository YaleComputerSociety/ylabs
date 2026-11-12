import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SCRIPT_MAX_POOL_SIZE,
  SCRIPT_POOL_WAIT_TIMEOUT_MS,
  SCRIPT_SOCKET_TIMEOUT_MS,
  WHOLE_COLLECTION_OPERATION_SOCKET_OPTIONS,
  initializeConnections,
  mongoOptions,
  scriptMongoConnectOptions,
  triggerReconnect,
} from '../connections';
import { SCRAPE_RUN_SOCKET_TIMEOUT_MS } from '../../scrapers/scrapeRunProgress';
import { MAX_MATERIALIZATION_CONCURRENCY } from '../../scrapers/entityMaterializer';

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

  it('keeps its own socket budget and the driver pool default, untouched by the script bounds', () => {
    expect(mongoOptions.socketTimeoutMS).toBe(20000);
    expect(mongoOptions).not.toHaveProperty('maxPoolSize');
  });
});

describe('an operator entry point', () => {
  it('keeps the long waits a batch needs, but never an unbounded socket wait', () => {
    const scriptOptions = scriptMongoConnectOptions();

    expect(scriptOptions.socketTimeoutMS).toBe(SCRIPT_SOCKET_TIMEOUT_MS);
    expect(SCRIPT_SOCKET_TIMEOUT_MS).toBeGreaterThan(0);
    expect(SCRIPT_SOCKET_TIMEOUT_MS).toBeGreaterThanOrEqual(SCRAPE_RUN_SOCKET_TIMEOUT_MS);
    expect(Number(scriptOptions.socketTimeoutMS)).toBeGreaterThan(
      Number(mongoOptions.socketTimeoutMS),
    );
    expect(Number(scriptOptions.serverSelectionTimeoutMS)).toBeGreaterThan(
      Number(mongoOptions.serverSelectionTimeoutMS),
    );
    expect(scriptOptions.bufferTimeoutMS).toBeGreaterThan(mongoOptions.bufferTimeoutMS);
  });

  it('keeps pool head-room above the materializer concurrency and bounds a checkout wait', () => {
    const options = scriptMongoConnectOptions();
    expect(options.maxPoolSize).toBe(SCRIPT_MAX_POOL_SIZE);
    expect(SCRIPT_MAX_POOL_SIZE).toBeGreaterThanOrEqual(2 * MAX_MATERIALIZATION_CONCURRENCY);
    expect(SCRIPT_MAX_POOL_SIZE).toBeLessThan(100);
    expect(options.waitQueueTimeoutMS).toBe(SCRIPT_POOL_WAIT_TIMEOUT_MS);
    expect(SCRIPT_POOL_WAIT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(SCRIPT_POOL_WAIT_TIMEOUT_MS).toBeLessThan(SCRIPT_SOCKET_TIMEOUT_MS);
  });

  it('lets a whole-collection operation opt back into no socket timeout', () => {
    expect(
      scriptMongoConnectOptions(WHOLE_COLLECTION_OPERATION_SOCKET_OPTIONS).socketTimeoutMS,
    ).toBe(0);
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

    expect(initial).toMatchObject({
      socketTimeoutMS: SCRIPT_SOCKET_TIMEOUT_MS,
      maxPoolSize: SCRIPT_MAX_POOL_SIZE,
      waitQueueTimeoutMS: SCRIPT_POOL_WAIT_TIMEOUT_MS,
    });
    expect(reconnect).toEqual(initial);
  });

  const socketTimeoutAScriptConnectsWith = async (run: () => Promise<unknown>) => {
    process.env.MONGODBURL = 'mongodb://127.0.0.1:1/budget-test';
    const refused = new Error('connection refused by the test');
    const connect = vi.spyOn(mongoose, 'connect').mockRejectedValue(refused);
    vi.spyOn(mongoose, 'disconnect').mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(run()).rejects.toBe(refused);
    expect(connect).toHaveBeenCalledTimes(1);
    return connect.mock.calls[0][1]?.socketTimeoutMS;
  };

  it.each([
    [
      'the declared index build',
      async () => (await import('../../scripts/buildMongoIndexes')).runBuildMongoIndexes([]),
    ],
    [
      'the collection naming migration',
      async () =>
        (await import('../../scripts/migrateMongoNaming')).migrateMongoNaming({ apply: false }),
    ],
    [
      'the dependent collection migration',
      async () =>
        (
          await import('../../scripts/migrateResearchEntityCollections')
        ).runResearchEntityCollectionMigration([]),
    ],
  ])('connects %s with no socket timeout', async (_name, run) => {
    expect(await socketTimeoutAScriptConnectsWith(run)).toBe(0);
  });

  it('connects an ordinary script with the bounded socket timeout', async () => {
    const { runLoginSignalTallyReport } = await import('../../scripts/loginSignalTallyReport');

    expect(await socketTimeoutAScriptConnectsWith(() => runLoginSignalTallyReport([]))).toBe(
      SCRIPT_SOCKET_TIMEOUT_MS,
    );
  });

  it('keeps the serving process on the serving budget across a reconnect', async () => {
    const [initial, reconnect] = await connectBudgets(() => initializeConnections(mongoOptions));

    expect(initial).toBe(mongoOptions);
    expect(reconnect).toBe(mongoOptions);
  });
});
