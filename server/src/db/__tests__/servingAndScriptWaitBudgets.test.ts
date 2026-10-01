import { describe, expect, it } from 'vitest';

import { mongoOptions, scriptMongoConnectOptions } from '../connections';

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
