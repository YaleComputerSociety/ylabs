export const DEFAULT_SOURCE_CONCURRENCY = 5;

export function resolveSourceConcurrency(requested: number | undefined, fallback: number): number {
  const candidate =
    typeof requested === 'number' && Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : fallback;
  return Math.max(1, candidate);
}

export async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const lanes = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  let cursor = 0;
  const runners = Array.from({ length: lanes }, () =>
    (async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    })(),
  );
  await Promise.all(runners);
}
