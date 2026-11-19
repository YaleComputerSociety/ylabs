import { afterAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { mongoMemoryLaunchBudgetForTest } from '../mongoMemoryLaunchBudget';
import {
  MONGO_MEMORY_MAX_POOL_ID,
  MONGO_MEMORY_PORTS_PER_WORKER,
  MONGO_MEMORY_PORT_CEILING,
  MONGO_MEMORY_PORT_FLOOR,
  createWorkerPortAllocator,
  vitestPoolId,
  workerPortRange,
} from '../mongoMemoryPortRange';

const LINUX_EPHEMERAL_FLOOR = 32768;

const allPoolIds = Array.from({ length: MONGO_MEMORY_MAX_POOL_ID }, (_unused, index) => index + 1);

const inRange = (port: number | undefined, poolId: number): boolean => {
  const { first, last } = workerPortRange(poolId);
  return typeof port === 'number' && port >= first && port <= last;
};

describe('in-memory MongoDB ports are split per vitest worker (#5646)', () => {
  it('gives every pool id a range that no other pool id overlaps', () => {
    const owners = new Map<number, number>();
    for (const poolId of allPoolIds) {
      const { first, last } = workerPortRange(poolId);
      for (let port = first; port <= last; port += 1) {
        expect(owners.get(port)).toBeUndefined();
        owners.set(port, poolId);
      }
    }
    expect(owners.size).toBe(MONGO_MEMORY_MAX_POOL_ID * MONGO_MEMORY_PORTS_PER_WORKER);
  });

  it('keeps every range below the ephemeral ports the library falls back to', () => {
    const highest = workerPortRange(MONGO_MEMORY_MAX_POOL_ID).last;
    expect(workerPortRange(1).first).toBe(MONGO_MEMORY_PORT_FLOOR);
    expect(highest).toBeLessThan(MONGO_MEMORY_PORT_CEILING);
    expect(highest).toBeLessThan(LINUX_EPHEMERAL_FLOOR);
  });

  it('never hands two workers the same port, even when both draw the same random start', () => {
    const draws = MONGO_MEMORY_PORTS_PER_WORKER * 3;
    const firstWorker = createWorkerPortAllocator(1, 7);
    const secondWorker = createWorkerPortAllocator(2, 7);
    const firstPorts = new Set(Array.from({ length: draws }, firstWorker));
    const secondPorts = Array.from({ length: draws }, secondWorker);

    expect(secondPorts.filter((port) => firstPorts.has(port))).toEqual([]);
    expect([...firstPorts].every((port) => inRange(port, 1))).toBe(true);
    expect(secondPorts.every((port) => inRange(port, 2))).toBe(true);
  });

  it('walks a worker range in turn and wraps rather than leaving it', () => {
    const next = createWorkerPortAllocator(3, MONGO_MEMORY_PORTS_PER_WORKER - 1);
    const { first, last } = workerPortRange(3);

    expect([next(), next(), next()]).toEqual([last, first, first + 1]);
  });

  it('reads the worker from VITEST_POOL_ID and refuses one the port space cannot hold', () => {
    expect(vitestPoolId({ VITEST_POOL_ID: '4' })).toBe(4);
    expect(vitestPoolId({})).toBe(1);
    expect(() => vitestPoolId({ VITEST_POOL_ID: 'zero' })).toThrow('positive integer');
    expect(() => vitestPoolId({ VITEST_POOL_ID: String(MONGO_MEMORY_MAX_POOL_ID + 1) })).toThrow(
      'lower maxWorkers',
    );
  });
});

describe('the shared launch wrapper starts every instance inside this worker range', () => {
  const { withServerLaunchBudget, withReplSetLaunchBudget } = mongoMemoryLaunchBudgetForTest;
  const poolId = vitestPoolId();

  it('assigns a standalone server a port from this worker range', () => {
    expect(inRange(withServerLaunchBudget().instance?.port, poolId)).toBe(true);
  });

  it('assigns every replica-set member its own port from this worker range', () => {
    const ports = withReplSetLaunchBudget({ replSet: { count: 3 } }).instanceOpts?.map(
      (member) => member.port,
    );

    expect(ports).toHaveLength(3);
    expect(ports?.every((port) => inRange(port, poolId))).toBe(true);
    expect(new Set(ports).size).toBe(3);
  });

  it('leaves a port a suite chose itself alone', () => {
    expect(withServerLaunchBudget({ instance: { port: 41000 } }).instance?.port).toBe(41000);
    expect(
      withReplSetLaunchBudget({ instanceOpts: [{ port: 41001 }] }).instanceOpts?.[0].port,
    ).toBe(41001);
  });

  describe('against a real mongod', () => {
    let server: MongoMemoryServer | undefined;
    let replSet: MongoMemoryReplSet | undefined;

    afterAll(async () => {
      await replSet?.stop();
      await server?.stop();
    });

    it('listens where the wrapper said, for a server and for a replica set', async () => {
      server = await MongoMemoryServer.create();
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

      expect(inRange(Number(new URL(server.getUri()).port), poolId)).toBe(true);
      expect(inRange(replSet.servers[0].instanceInfo?.port, poolId)).toBe(true);
    });
  });
});
