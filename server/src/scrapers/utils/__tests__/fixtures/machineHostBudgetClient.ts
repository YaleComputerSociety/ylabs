import { machineHostBudgetLimiter, machineHostSlotLimiter } from '../../scraperHostSlotLimiter';

const host = String(process.env.FIXTURE_HOST);
const requests = Number(process.env.FIXTURE_REQUESTS);
const holdMs = Number(process.env.FIXTURE_HOLD_MS);
const parallel = Number(process.env.FIXTURE_PARALLEL);
const limiter =
  process.env.FIXTURE_LAYERS === 'budget-only'
    ? machineHostBudgetLimiter()
    : machineHostSlotLimiter();

function emit(line: object): void {
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ...line })}\n`);
}

async function worker(queue: number[]): Promise<void> {
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const release = await limiter.acquire(host);
    const grantedAt = Date.now();
    emit({ event: 'granted', request: next, grantedAt });
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    const releasedAt = Date.now();
    release();
    emit({ event: 'released', request: next, grantedAt, releasedAt });
  }
}

async function main(): Promise<void> {
  const queue = Array.from({ length: requests }, (_, index) => index);
  await Promise.all(Array.from({ length: parallel }, () => worker(queue)));
  await new Promise((resolve) => setTimeout(resolve, 200));
  emit({ event: 'done' });
  process.exit(0);
}

void main();
