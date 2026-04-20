/**
 * Persist a JSON-serializable value to localStorage, debounced so rapid
 * updates (e.g. during a drag) don't thrash storage on every keystroke.
 */
import { useEffect, useRef } from 'react';

export function useDebouncedLocalStorage(key: string, value: unknown, delayMs = 250) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
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
