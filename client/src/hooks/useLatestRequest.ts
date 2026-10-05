import { useCallback, useEffect, useMemo, useRef } from 'react';

export interface LatestRequestTicket {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

const useLatestRequest = () => {
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const begin = useCallback((): LatestRequestTicket => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return {
      signal: controller.signal,
      isCurrent: () => controllerRef.current === controller,
    };
  }, []);

  useEffect(() => cancel, [cancel]);

  return useMemo(() => ({ begin, cancel }), [begin, cancel]);
};

export default useLatestRequest;
