import {
  resetSharedMachineHostBudgetForTests,
  setSharedMachineHostBudgetForTests,
} from './machineHostBudget';

/**
 * The one per-host pause record every fetch path reads (#6184), kept in the machine budget's
 * per-host state file (#6168) so every process on this machine honours one pause per exact host.
 */
export {
  HOST_BACKOFF_BASE_MS,
  HOST_BACKOFF_CAP_MS,
  HOST_BACKOFF_JITTER_RATIO,
  HOST_BACKOFF_QUIET_RESET_MS,
  HOST_CRAWL_DELAY_MAX_MS,
  HOST_CRAWL_DELAY_TTL_MS,
  hostBackoffState,
  hostPausedUntil,
  recordHostBackoff,
  recordHostSuccess,
  setHostMinInterval,
  type HostBackoffState,
  type HostBackoffVerdict as HostBackoffSignal,
} from './machineHostBudget';

export function setHostPauseStateForTests(overrides: {
  now?: () => Date;
  random?: () => number;
}): void {
  const { now, random } = overrides;
  setSharedMachineHostBudgetForTests({
    ...(now ? { now: () => now().getTime() } : {}),
    ...(random ? { random } : {}),
  });
}

export function resetHostPauseStateForTests(): void {
  resetSharedMachineHostBudgetForTests();
}
