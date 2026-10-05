/**
 * One bounded worker pool, shared by everything in the scraper stack that fans
 * out over a list.
 *
 * This is deliberately not a rate limiter. Politeness toward a host is
 * `HostConcurrencyLimiter`'s job and is enforced at the fetch layer, so a caller
 * may raise this bound without loosening any host's budget: work simply queues
 * on the limiter instead. That separation is what makes fanning out over lanes
 * safe.
 */
export async function runWithBoundedConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () =>
    (async () => {
      for (;;) {
        const next = queue.shift();
        if (next === undefined) return;
        await worker(next);
      }
    })(),
  );
  await Promise.all(runners);
}

/**
 * Keeps up to `lookahead` fetches in flight ahead of the item being consumed, and hands
 * every result to `consume` in input order, so a lane gains concurrency at the fetch layer
 * without reordering what it emits. Politeness is still the host limiter's job: the extra
 * fetches wait on its slots rather than going out at once.
 */
export async function forEachInOrderWithPrefetch<T, R>(
  items: readonly T[],
  lookahead: number,
  fetch: (item: T) => Promise<R>,
  consume: (item: T, result: PromiseSettledResult<R>) => Promise<void>,
): Promise<void> {
  const window = Math.max(1, Math.floor(lookahead) || 1);
  const inFlight = new Map<number, Promise<PromiseSettledResult<R>>>();
  const start = (index: number): void => {
    if (index >= items.length || inFlight.has(index)) return;
    inFlight.set(
      index,
      fetch(items[index]).then(
        (value): PromiseSettledResult<R> => ({ status: 'fulfilled', value }),
        (reason): PromiseSettledResult<R> => ({ status: 'rejected', reason }),
      ),
    );
  };
  for (let index = 0; index < items.length; index += 1) {
    for (let ahead = index; ahead < index + window; ahead += 1) start(ahead);
    const result = await inFlight.get(index)!;
    inFlight.delete(index);
    await consume(items[index], result);
  }
}
