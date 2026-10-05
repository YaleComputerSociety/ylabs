import { useCallback, useEffect, useRef } from 'react';

const useDebouncedCallback = <Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
) => {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return useCallback(
    (...args: Args) => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => callbackRef.current(...args), delayMs);
    },
    [delayMs],
  );
};

export default useDebouncedCallback;
