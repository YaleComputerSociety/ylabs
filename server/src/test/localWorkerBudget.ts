import os from 'node:os';

export const LOCAL_MAX_WORKERS = 4;

export const MAX_WORKERS_OVERRIDE_KEY = 'YLABS_VITEST_MAX_WORKERS';

const parseWorkerOverride = (raw: string): number => {
  const workers = Number(raw);
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`${MAX_WORKERS_OVERRIDE_KEY} must be a positive integer, got "${raw}"`);
  }
  return workers;
};

export function vitestMaxWorkers(
  env: NodeJS.ProcessEnv = process.env,
  parallelism: number = os.availableParallelism(),
): number | undefined {
  const override = env[MAX_WORKERS_OVERRIDE_KEY]?.trim();
  if (override) return parseWorkerOverride(override);
  if (env.CI) return undefined;
  return Math.max(1, Math.min(LOCAL_MAX_WORKERS, parallelism - 1));
}
