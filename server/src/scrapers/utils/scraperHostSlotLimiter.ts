import {
  ChainedHostSlotLimiter,
  HostConcurrencyLimiter,
  defaultHostConcurrencyLimiter,
  type HostSlotLimiter,
} from './hostConcurrencyLimiter';
import { BrokeredHostSlotLimiter, SCRAPER_HOST_SLOT_BROKER_ENV } from './hostSlotBroker';
import { MachineHostSlotLimiter } from './machineHostSlotBroker';
import { isBenchmarkReplayActive } from '../snapshotBenchmarkMode';

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
  return socketPath ? new BrokeredHostSlotLimiter(socketPath, ownProcess) : ownProcess;
}

let resolved: HostSlotLimiter | undefined;

export function scraperHostSlotLimiter(): HostSlotLimiter {
  resolved ??= resolveScraperHostSlotLimiter();
  return resolved;
}
