import fs from 'fs';
import {
  ChainedHostSlotLimiter,
  HostConcurrencyLimiter,
  defaultHostConcurrencyLimiter,
  type HostSlotLimiter,
  type HostSlotRelease,
} from './hostConcurrencyLimiter';
import { BrokeredHostSlotLimiter, SCRAPER_HOST_SLOT_BROKER_ENV } from './hostSlotBroker';
import { MachineHostSlotLimiter } from './machineHostSlotBroker';
import { isBenchmarkReplayActive } from '../snapshotBenchmarkMode';

export const SCRAPER_HOST_SLOT_TRACE_ENV = 'SCRAPER_HOST_SLOT_TRACE';

let machineWide: MachineHostSlotLimiter | undefined;

export function machineHostSlotLimiter(): MachineHostSlotLimiter {
  machineWide ??= new MachineHostSlotLimiter({ isBypassed: isBenchmarkReplayActive });
  return machineWide;
}

export function resolveScraperHostSlotLimiter(
  env: NodeJS.ProcessEnv = process.env,
  local: HostConcurrencyLimiter = defaultHostConcurrencyLimiter,
  machine: HostSlotLimiter = machineHostSlotLimiter(),
): HostSlotLimiter {
  const ownProcess = new ChainedHostSlotLimiter([local, machine]);
  const socketPath = env[SCRAPER_HOST_SLOT_BROKER_ENV]?.trim();
  const limiter = socketPath ? new BrokeredHostSlotLimiter(socketPath, ownProcess) : ownProcess;
  const tracePath = env[SCRAPER_HOST_SLOT_TRACE_ENV]?.trim();
  return tracePath ? new TracingHostSlotLimiter(limiter, tracePath) : limiter;
}

export class TracingHostSlotLimiter implements HostSlotLimiter {
  constructor(
    private readonly inner: HostSlotLimiter,
    private readonly tracePath: string,
  ) {}

  async acquire(host: string): Promise<HostSlotRelease> {
    const requestedAt = Date.now();
    const release = await this.inner.acquire(host);
    const grantedAt = Date.now();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
      const line = { pid: process.pid, host, requestedAt, grantedAt, releasedAt: Date.now() };
      fs.appendFileSync(this.tracePath, `${JSON.stringify(line)}\n`);
    };
  }
}

let resolved: HostSlotLimiter | undefined;

export function scraperHostSlotLimiter(): HostSlotLimiter {
  resolved ??= resolveScraperHostSlotLimiter();
  return resolved;
}
