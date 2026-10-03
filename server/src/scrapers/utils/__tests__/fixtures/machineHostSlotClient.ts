import { HostConcurrencyLimiter } from '../../hostConcurrencyLimiter';
import { MachineHostSlotLimiter } from '../../machineHostSlotBroker';
import { resolveScraperHostSlotLimiter } from '../../scraperHostSlotLimiter';

const host = String(process.env.FIXTURE_HOST);
const requests = Number(process.env.FIXTURE_REQUESTS);
const holdMs = Number(process.env.FIXTURE_HOLD_MS);
const parallel = Number(process.env.FIXTURE_PARALLEL);

const machine = new MachineHostSlotLimiter({ warn: (message) => emit({ event: 'warn', message }) });
const limiter = resolveScraperHostSlotLimiter(process.env, new HostConcurrencyLimiter(4), machine);

function emit(line: object): void {
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ...line })}\n`);
}

async function worker(queue: number[]): Promise<void> {
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const release = await limiter.acquire(host);
    const grantedAt = Date.now();
    emit({ event: 'granted', request: next, role: machine.role, grantedAt });
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    const releasedAt = Date.now();
    release();
    emit({ event: 'released', request: next, grantedAt, releasedAt });
  }
}

async function main(): Promise<void> {
  const queue = Array.from({ length: requests }, (_, index) => index);
  await Promise.all(Array.from({ length: parallel }, () => worker(queue)));
  emit({ event: 'done', role: machine.role });
  machine.close();
}

void main();
