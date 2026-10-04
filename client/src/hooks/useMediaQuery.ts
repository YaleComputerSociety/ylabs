import { useCallback, useSyncExternalStore } from 'react';

const readMatches = (query: string) => window.matchMedia?.(query).matches ?? false;

const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mediaQuery = window.matchMedia?.(query);
      if (!mediaQuery) return () => {};
      mediaQuery.addEventListener?.('change', onChange);
      return () => mediaQuery.removeEventListener?.('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => readMatches(query),
    () => false,
  );
};

export default useMediaQuery;
