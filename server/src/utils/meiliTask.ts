import { MeilisearchTaskTimeOutError } from 'meilisearch';

/**
 * Meilisearch accepts a write by enqueueing a task and processes it later, so an accepted
 * request says nothing about whether the documents or settings it carried were applied.
 * A rejected batch still returns a `taskUid` and never throws at the call site, which is how
 * a rebuild reported a full document count while the index held 250 of about 1,919 rows
 * (#817, #3720). Every write that reports an outcome confirms it here instead.
 */

export const MEILI_SETTINGS_TASK_WAIT_TIMEOUT_MS = 180_000;
export const MEILI_DOCUMENT_TASK_WAIT_TIMEOUT_MS = 60_000;
// A full rebuild embeds every document it adds: one 250-document Beta page measured 73s on
// 2026-10-12, so the request-path limit above abandoned a task that went on to succeed (#5009).
export const MEILI_REBUILD_DOCUMENT_TASK_WAIT_TIMEOUT_MS = 900_000;

export interface MeiliTaskOutcome {
  status: string;
  error?: unknown;
}

export const MEILI_TASK_POLL_INTERVAL_MS = 50;

export interface MeiliTaskWaitingIndex {
  tasks?: {
    getTask?: (taskUid: number) => Promise<MeiliTaskOutcome>;
    waitForTask: (taskUid: number, options?: { timeout?: number }) => Promise<MeiliTaskOutcome>;
  };
}

const isPendingTaskStatus = (status: unknown): boolean =>
  status === 'enqueued' || status === 'processing';

/**
 * Polls a task to a final status. meilisearch 0.62's own `waitForTask` hands every poll the
 * same abort signal, and its per-request timeout leaves one abort listener on that signal per
 * poll, so a rebuild's long embedding tasks stacked thousands and tripped Node's
 * MaxListenersExceededWarning. Polling `getTask` without a caller signal leaves nothing behind.
 */
export async function waitForMeiliTask(
  tasks: NonNullable<MeiliTaskWaitingIndex['tasks']>,
  taskUid: number,
  timeoutMs: number,
  intervalMs: number = MEILI_TASK_POLL_INTERVAL_MS,
): Promise<MeiliTaskOutcome> {
  if (typeof tasks.getTask !== 'function')
    return tasks.waitForTask(taskUid, { timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = await tasks.getTask(taskUid);
    if (!isPendingTaskStatus(task?.status)) return task;
    if (Date.now() >= deadline) throw new MeilisearchTaskTimeOutError(taskUid, timeoutMs);
    if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function assertMeiliTaskSucceeded(
  index: MeiliTaskWaitingIndex,
  enqueued: unknown,
  label: string,
  timeoutMs: number,
  intervalMs: number = MEILI_TASK_POLL_INTERVAL_MS,
): Promise<void> {
  const taskUid = (enqueued as { taskUid?: unknown } | null | undefined)?.taskUid;
  if (typeof taskUid !== 'number') {
    throw new Error(`Meilisearch ${label} returned no task, so its outcome cannot be confirmed.`);
  }
  if (typeof index.tasks?.waitForTask !== 'function') {
    throw new Error(
      `Meilisearch ${label} task ${taskUid} cannot be confirmed: the index exposes no task client.`,
    );
  }
  const task = await waitForMeiliTask(index.tasks, taskUid, timeoutMs, intervalMs);
  if (task?.status !== 'succeeded') {
    throw new Error(
      `Meilisearch ${label} task ${taskUid} did not succeed (status: ${task?.status}): ${JSON.stringify(task?.error)}`,
    );
  }
}
