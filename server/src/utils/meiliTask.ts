/**
 * Meilisearch accepts a write by enqueueing a task and processes it later, so an accepted
 * request says nothing about whether the documents or settings it carried were applied.
 * A rejected batch still returns a `taskUid` and never throws at the call site, which is how
 * a rebuild reported a full document count while the index held 250 of about 1,919 rows
 * (#817, #3720). Every write that reports an outcome confirms it here instead.
 */

export const MEILI_SETTINGS_TASK_WAIT_TIMEOUT_MS = 180_000;
export const MEILI_DOCUMENT_TASK_WAIT_TIMEOUT_MS = 60_000;

export interface MeiliTaskOutcome {
  status: string;
  error?: unknown;
}

export interface MeiliTaskWaitingIndex {
  tasks?: {
    waitForTask: (taskUid: number, options?: { timeout?: number }) => Promise<MeiliTaskOutcome>;
  };
}

export async function assertMeiliTaskSucceeded(
  index: MeiliTaskWaitingIndex,
  enqueued: unknown,
  label: string,
  timeoutMs: number,
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
  const task = await index.tasks.waitForTask(taskUid, { timeout: timeoutMs });
  if (task?.status !== 'succeeded') {
    throw new Error(
      `Meilisearch ${label} task ${taskUid} did not succeed (status: ${task?.status}): ${JSON.stringify(task?.error)}`,
    );
  }
}
