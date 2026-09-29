import { useCallback, useEffect, useRef, useState } from 'react';

/** Long enough to notice the message and reach the button, short enough not to linger. */
export const UNDO_WINDOW_MS = 10000;

interface PendingUndo<T> {
  item: T;
  removal: Promise<boolean>;
}

const useUndoableRemoval = <T>() => {
  const [pending, setPending] = useState<PendingUndo<T> | null>(null);
  const pendingRef = useRef<PendingUndo<T> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismissUndo = useCallback(() => {
    clearTimeout(timerRef.current);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const restartUndoWindow = useCallback(() => {
    if (!pendingRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(dismissUndo, UNDO_WINDOW_MS);
  }, [dismissUndo]);

  const offerUndo = useCallback(
    (item: T, removal: Promise<boolean>) => {
      const entry = { item, removal };
      pendingRef.current = entry;
      setPending(entry);
      restartUndoWindow();
      void removal.then((removed) => {
        if (!removed && pendingRef.current === entry) dismissUndo();
      });
    },
    [dismissUndo, restartUndoWindow],
  );

  const undoRemoval = useCallback(
    async (restore: (item: T) => Promise<boolean>) => {
      const entry = pendingRef.current;
      if (!entry) return;
      dismissUndo();
      if (!(await entry.removal)) return;
      if (!(await restore(entry.item))) offerUndo(entry.item, Promise.resolve(true));
    },
    [dismissUndo, offerUndo],
  );

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return {
    undoableItem: pending?.item ?? null,
    offerUndo,
    undoRemoval,
    restartUndoWindow,
    dismissUndo,
  };
};

export default useUndoableRemoval;
