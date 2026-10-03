export const MEILISEARCH_UNAVAILABLE_COOLDOWN_MS = 30_000;

const UNREACHABLE_ERROR_NAMES = new Set([
  'MeilisearchRequestError',
  'MeilisearchRequestTimeOutError',
]);

export class MeilisearchKnownUnavailableError extends Error {
  readonly name = 'MeilisearchKnownUnavailableError';

  constructor(readonly retryAfterMs: number) {
    super(`Meilisearch was unreachable within the last ${MEILISEARCH_UNAVAILABLE_COOLDOWN_MS}ms`);
  }
}

export const isMeiliUnreachableError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (UNREACHABLE_ERROR_NAMES.has(String((current as { name?: unknown }).name ?? ''))) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

let unavailableUntil = 0;

export const meiliKnownUnavailableForMs = (now: number = Date.now()): number =>
  Math.max(0, unavailableUntil - now);

export const resetMeiliAvailability = (): void => {
  unavailableUntil = 0;
};

export const withMeiliAvailability = async <T>(call: () => Promise<T>): Promise<T> => {
  const remainingMs = meiliKnownUnavailableForMs();
  if (remainingMs > 0) throw new MeilisearchKnownUnavailableError(remainingMs);
  try {
    const value = await call();
    unavailableUntil = 0;
    return value;
  } catch (error) {
    if (isMeiliUnreachableError(error)) {
      unavailableUntil = Date.now() + MEILISEARCH_UNAVAILABLE_COOLDOWN_MS;
    }
    throw error;
  }
};

export const withMeiliAvailabilityGuard = <T extends object>(index: T): T =>
  new Proxy(index, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || property === 'then') return value;
      return (...args: unknown[]) => withMeiliAvailability(async () => value.apply(target, args));
    },
  });
