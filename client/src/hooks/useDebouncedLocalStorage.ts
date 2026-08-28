/**
 * Persist a JSON-serializable value to localStorage, debounced so rapid
 * updates (e.g. during a drag) don't thrash storage on every keystroke.
 */
import { useEffect, useRef } from 'react';

export const MAX_DEBOUNCED_STORAGE_KEY_LENGTH = 120;
export const MAX_DEBOUNCED_STORAGE_VALUE_LENGTH = 100_000;

export function useDebouncedLocalStorage(key: string, value: unknown, delayMs = 250) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const safeKey = key.trim();
    if (!safeKey || safeKey.length > MAX_DEBOUNCED_STORAGE_KEY_LENGTH) return;

    timerRef.current = setTimeout(() => {
      try {
        const serialized = JSON.stringify(value);
        if (typeof serialized !== 'string' || serialized.length > MAX_DEBOUNCED_STORAGE_VALUE_LENGTH) {
          localStorage.removeItem(safeKey);
          return;
        }
        localStorage.setItem(safeKey, serialized);
      } catch {
        // ignore quota / serialization errors
      }
    }, delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [key, value, delayMs]);
}

export default useDebouncedLocalStorage;
