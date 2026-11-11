import { randomInt } from 'node:crypto';

/**
 * The ports an in-memory MongoDB may listen on, split so that no two vitest workers of one run
 * can ever be handed the same one (#5646).
 *
 * `mongodb-memory-server` picks a port with `net.listen(0)` and remembers the ports it handed out
 * only inside its own process. Two workers can therefore pick the same port, and the loser does
 * more than fail: its replica-set member's error handler calls `stop()`, which connects to that
 * port and sends `shutdown: 1, force: true` to the winner, killing another suite's live server.
 *
 * The floor and ceiling sit below both the Linux (32768) and the macOS (49152) ephemeral ranges,
 * so a port from here can never equal one the operating system hands to `net.listen(0)`.
 */
export const MONGO_MEMORY_PORT_FLOOR = 20000;
export const MONGO_MEMORY_PORT_CEILING = 32768;
export const MONGO_MEMORY_PORTS_PER_WORKER = 128;
export const MONGO_MEMORY_MAX_POOL_ID = Math.floor(
  (MONGO_MEMORY_PORT_CEILING - MONGO_MEMORY_PORT_FLOOR) / MONGO_MEMORY_PORTS_PER_WORKER,
);

export interface PortRange {
  first: number;
  last: number;
}

export function vitestPoolId(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.VITEST_POOL_ID ?? env.VITEST_WORKER_ID ?? '1';
  const poolId = Number(raw);
  if (!Number.isInteger(poolId) || poolId < 1) {
    throw new Error(`VITEST_POOL_ID must be a positive integer, got "${raw}"`);
  }
  if (poolId > MONGO_MEMORY_MAX_POOL_ID) {
    throw new Error(
      `VITEST_POOL_ID ${poolId} exceeds the ${MONGO_MEMORY_MAX_POOL_ID} workers the in-memory MongoDB port space holds; lower maxWorkers`,
    );
  }
  return poolId;
}

export function workerPortRange(poolId: number): PortRange {
  const first = MONGO_MEMORY_PORT_FLOOR + (poolId - 1) * MONGO_MEMORY_PORTS_PER_WORKER;
  return { first, last: first + MONGO_MEMORY_PORTS_PER_WORKER - 1 };
}

/**
 * Hands out this worker's ports in turn. The starting point is random so that two concurrent
 * runs on one machine, whose workers share pool ids, do not walk the same ports in lockstep.
 */
export function createWorkerPortAllocator(
  poolId: number,
  startOffset: number = randomInt(MONGO_MEMORY_PORTS_PER_WORKER),
): () => number {
  const { first } = workerPortRange(poolId);
  let cursor = startOffset;
  return () => {
    const port = first + (cursor % MONGO_MEMORY_PORTS_PER_WORKER);
    cursor += 1;
    return port;
  };
}
