import {
  ChainedHostSlotLimiter,
  HostConcurrencyLimiter,
  defaultHostConcurrencyLimiter,
  isScraperHostConcurrencyInterceptorInstalled,
  type HostSlotLimiter,
} from './hostConcurrencyLimiter';
import { BrokeredHostSlotLimiter, SCRAPER_HOST_SLOT_BROKER_ENV } from './hostSlotBroker';
import { MachineHostBudgetLimiter, sharedMachineHostBudget } from './machineHostBudget';
import { MachineHostSlotLimiter } from './machineHostSlotBroker';
import { isBenchmarkReplayActive } from '../snapshotBenchmarkMode';

let machineWide: HostSlotLimiter | undefined;

export function machineHostBudgetLimiter(): MachineHostBudgetLimiter {
  return sharedMachineHostBudget();
}

/**
 * The file budget's slot first, then the #4555 socket broker, then the budget's spacing, so a
 * process still running code that knows only the broker meets this one there while every newer
 * process also meets in the file budget, and the broker's grant latency cannot shorten the spacing.
 */
export function machineHostSlotLimiter(): HostSlotLimiter {
  if (!machineWide) {
    const broker = new MachineHostSlotLimiter({ isBypassed: isBenchmarkReplayActive });
    const budget = machineHostBudgetLimiter();
    machineWide = { acquire: (host) => budget.acquireAround(host, broker) };
  }
  return machineWide;
}

/**
 * The machine-wide layer for a request sent outside the scrape CLI's axios interceptor. Under the
 * interceptor every axios request already takes a machine-wide slot, so a second one here would
 * hold two slots for one request and wedge a host whose limit is one.
 */
export function machineHostSlotsForDirectRequest(): HostSlotLimiter | undefined {
  return isScraperHostConcurrencyInterceptorInstalled() ? undefined : machineHostSlotLimiter();
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
