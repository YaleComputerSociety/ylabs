import {
  HostConcurrencyLimiter,
  defaultHostConcurrencyLimiter,
  type HostSlotLimiter,
} from './hostConcurrencyLimiter';
import { BrokeredHostSlotLimiter, SCRAPER_HOST_SLOT_BROKER_ENV } from './hostSlotBroker';

export function resolveScraperHostSlotLimiter(
  env: NodeJS.ProcessEnv = process.env,
  local: HostConcurrencyLimiter = defaultHostConcurrencyLimiter,
): HostSlotLimiter {
  const socketPath = env[SCRAPER_HOST_SLOT_BROKER_ENV]?.trim();
  return socketPath ? new BrokeredHostSlotLimiter(socketPath, local) : local;
}

let resolved: HostSlotLimiter | undefined;

export function scraperHostSlotLimiter(): HostSlotLimiter {
  resolved ??= resolveScraperHostSlotLimiter();
  return resolved;
}
