import { hostBackoffState, recordHostBackoff } from '../../hostPauseState';
import { machineHostBudgetLimiter } from '../../scraperHostSlotLimiter';

const host = String(process.env.FIXTURE_HOST);

function emit(line: object): void {
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ...line })}\n`);
}

const waitForStart = (): Promise<void> =>
  new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, Number(process.env.FIXTURE_START_AT ?? 0) - Date.now())),
  );

async function acquireOnce(): Promise<void> {
  await waitForStart();
  const startedAt = Date.now();
  try {
    const release = await machineHostBudgetLimiter().acquire(host);
    emit({ event: 'granted', startedAt, grantedAt: Date.now() });
    release();
  } catch (error) {
    const pausedUntil = (error as { pause?: { until?: Date } }).pause?.until;
    emit({
      event: 'refused',
      startedAt,
      error: (error as Error).name,
      pausedUntil: pausedUntil?.getTime(),
    });
  }
}

async function recordOnce(): Promise<void> {
  const stated = Number(process.env.FIXTURE_STATED_UNTIL);
  const retryAfterMs = Number(process.env.FIXTURE_RETRY_AFTER_MS);
  await waitForStart();
  const pausedUntil = await recordHostBackoff(host, {
    status: 429,
    ...(Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}),
    ...(Number.isFinite(stated) ? { statedUntil: new Date(stated) } : {}),
  });
  emit({
    event: 'recorded',
    pausedUntil: pausedUntil?.getTime(),
    level: hostBackoffState(host)?.level,
  });
}

async function main(): Promise<void> {
  if (process.env.FIXTURE_MODE === 'record') await recordOnce();
  else await acquireOnce();
  process.exit(0);
}

void main();
