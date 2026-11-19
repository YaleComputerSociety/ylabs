import { afterEach, describe, expect, it, vi } from 'vitest';
import { Meilisearch } from 'meilisearch';
import { assertMeiliTaskSucceeded } from '../meiliTask';

const POLLS_BEFORE_SUCCESS = 40;

function clientAnsweringProcessingThenSucceeded() {
  let polls = 0;
  const httpClient = async () => {
    polls += 1;
    const status = polls > POLLS_BEFORE_SUCCESS ? 'succeeded' : 'processing';
    return { taskUid: 7, uid: 7, status, type: 'documentAdditionOrUpdate' };
  };
  return {
    client: new Meilisearch({ host: 'http://meili.test', httpClient, timeout: 10_000 }),
    polls: () => polls,
  };
}

function trackNetAbortListeners() {
  let net = 0;
  const add = AbortSignal.prototype.addEventListener;
  const remove = AbortSignal.prototype.removeEventListener;
  vi.spyOn(AbortSignal.prototype, 'addEventListener').mockImplementation(function (
    this: AbortSignal,
    ...args: Parameters<AbortSignal['addEventListener']>
  ) {
    if (args[0] === 'abort') net += 1;
    return add.apply(this, args);
  });
  vi.spyOn(AbortSignal.prototype, 'removeEventListener').mockImplementation(function (
    this: AbortSignal,
    ...args: Parameters<AbortSignal['removeEventListener']>
  ) {
    if (args[0] === 'abort') net -= 1;
    return remove.apply(this, args);
  });
  return () => net;
}

afterEach(() => vi.restoreAllMocks());

describe('Meilisearch task waits', () => {
  it('leave no abort listener behind however many times a task is polled', async () => {
    const { client, polls } = clientAnsweringProcessingThenSucceeded();
    const netListeners = trackNetAbortListeners();

    await assertMeiliTaskSucceeded(client, { taskUid: 7 }, 'document batch', 60_000, 0);

    expect(polls()).toBeGreaterThan(POLLS_BEFORE_SUCCESS);
    expect(netListeners()).toBeLessThanOrEqual(1);
  });

  it('still reports a task that never finishes as a timeout', async () => {
    const httpClient = async () => ({ taskUid: 9, uid: 9, status: 'processing' });
    const client = new Meilisearch({ host: 'http://meili.test', httpClient, timeout: 10_000 });

    await expect(
      assertMeiliTaskSucceeded(client, { taskUid: 9 }, 'document batch', 30, 5),
    ).rejects.toThrow(/9/);
  });
});
