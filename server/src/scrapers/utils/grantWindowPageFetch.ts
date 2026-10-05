import { sanitizeLogValue } from '../../utils/logSanitizer';

export const GRANT_WINDOW_PAGE_ATTEMPTS = 3;
export const GRANT_WINDOW_PAGE_BACKOFF_MS = 2_000;

export interface GrantWindowPageRetryOptions {
  attempts?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  label: string;
}

export type GrantWindowPageOutcome<T> =
  { status: 'fetched'; value: T } | { status: 'failed'; error: string };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchGrantWindowPage<T>(
  fetchOnce: () => Promise<T>,
  options: GrantWindowPageRetryOptions,
): Promise<GrantWindowPageOutcome<T>> {
  const attempts = Math.max(1, options.attempts ?? GRANT_WINDOW_PAGE_ATTEMPTS);
  const backoffMs = options.backoffMs ?? GRANT_WINDOW_PAGE_BACKOFF_MS;
  const sleep = options.sleep ?? realSleep;
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return { status: 'fetched', value: await fetchOnce() };
    } catch (err: unknown) {
      lastError = sanitizeLogValue(err instanceof Error ? err.message : err);
      options.log?.(`${options.label}: attempt ${attempt} of ${attempts} failed: ${lastError}`);
      if (attempt < attempts) await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }
  return { status: 'failed', error: lastError };
}
