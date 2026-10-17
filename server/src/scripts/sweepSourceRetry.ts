import { matchesTransientMongoFailureText } from '../scrapers/utils/transientMongoError';

export const SCRAPER_SWEEP_DEADLINE_ENV = 'SCRAPER_SWEEP_DEADLINE_AT';
export const MAX_SWEEP_SOURCE_ATTEMPTS = 2;

export type SweepSourceFailureKind = 'child-exit' | 'missing-artifact' | 'artifact-contract';

export interface SweepSourceFailure {
  kind: SweepSourceFailureKind;
  exitCode: number;
  signal?: string | null;
  timedOut?: boolean;
  spawnError?: boolean;
  failureText?: string;
}

export type SweepSourceRetryDecision = { retry: true } | { retry: false; reason: string };

/**
 * A source is re-run only when its child exited on an infrastructure blip that a second run
 * can plausibly get past, and only when the hosted run's remaining time covers another run as
 * long as the one that failed. A missing or contract-breaking artifact, a timeout, a signal, or
 * any failure without the transient database signature is deterministic and would just repeat.
 */
export function decideSweepSourceRetry(input: {
  attempt: number;
  failure: SweepSourceFailure;
  attemptDurationMs: number;
  remainingBudgetMs: number | undefined;
}): SweepSourceRetryDecision {
  const { attempt, failure } = input;
  if (attempt >= MAX_SWEEP_SOURCE_ATTEMPTS) {
    return { retry: false, reason: `already ran ${attempt} time(s)` };
  }
  if (failure.kind !== 'child-exit') {
    return { retry: false, reason: `a ${failure.kind} failure is deterministic` };
  }
  if (failure.spawnError || failure.timedOut || failure.signal) {
    return { retry: false, reason: 'the child was not started, timed out, or was killed' };
  }
  if (failure.exitCode === 0) return { retry: false, reason: 'the child exited cleanly' };
  if (!matchesTransientMongoFailureText(failure.failureText)) {
    return { retry: false, reason: 'the failure has no transient database signature' };
  }
  if (input.remainingBudgetMs !== undefined && input.remainingBudgetMs < input.attemptDurationMs) {
    return {
      retry: false,
      reason: `${Math.max(0, Math.round(input.remainingBudgetMs / 60_000))} min left of the run limit cannot cover another ${Math.round(input.attemptDurationMs / 60_000)} min attempt`,
    };
  }
  return { retry: true };
}

export function remainingSweepBudgetMs(env: NodeJS.ProcessEnv, nowMs: number): number | undefined {
  const raw = env[SCRAPER_SWEEP_DEADLINE_ENV];
  if (!raw) return undefined;
  const deadline = Date.parse(raw);
  return Number.isFinite(deadline) ? deadline - nowMs : undefined;
}
