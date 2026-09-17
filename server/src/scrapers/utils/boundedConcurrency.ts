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
