import { useCallback, useEffect, useRef, useState } from 'react';

export type PlanNoteSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface PersistNoteOptions {
  keepalive?: boolean;
}

export type PersistPlanNote = (
  id: string,
  note: string,
  options?: PersistNoteOptions,
) => Promise<void>;

const NOTE_SAVE_DEBOUNCE_MS = 700;

const usePlanNoteAutosave = (persistNote: PersistPlanNote) => {
  const [noteSaveStatuses, setNoteSaveStatuses] = useState<Record<string, PlanNoteSaveStatus>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingRef = useRef<Record<string, string>>({});
  const persistedRef = useRef<Record<string, string>>({});
  const requestedRef = useRef<Record<string, string>>({});
  const inFlightRef = useRef<Record<string, number>>({});
  const failedOnceRef = useRef<Set<string>>(new Set());

  const setStatus = (id: string, status: PlanNoteSaveStatus) =>
    setNoteSaveStatuses((statuses) => ({ ...statuses, [id]: status }));

  const markNotePersisted = useCallback((id: string, note: string) => {
    persistedRef.current[id] = note;
    requestedRef.current[id] = note;
  }, []);

  const clearPending = (id: string) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    delete pendingRef.current[id];
  };

  const cancelNoteSave = useCallback((id: string) => {
    clearPending(id);
    failedOnceRef.current.delete(id);
    requestedRef.current[id] = persistedRef.current[id];
  }, []);

  const retainNoteSaves = useCallback(
    (listedIds: string[]) => {
      const listed = new Set(listedIds);
      [...Object.keys(pendingRef.current), ...Object.keys(inFlightRef.current)]
        .filter((id) => !listed.has(id))
        .forEach(cancelNoteSave);
    },
    [cancelNoteSave],
  );

  const persistIfChanged = useCallback(
    async (id: string, note: string, options?: PersistNoteOptions) => {
      clearPending(id);
      if (requestedRef.current[id] === note) {
        setNoteSaveStatuses((statuses) =>
          statuses[id] === 'pending'
            ? { ...statuses, [id]: inFlightRef.current[id] ? 'saving' : 'saved' }
            : statuses,
        );
        return;
      }
      requestedRef.current[id] = note;
      setStatus(id, 'saving');
      inFlightRef.current[id] = (inFlightRef.current[id] ?? 0) + 1;
      try {
        await (options ? persistNote(id, note, options) : persistNote(id, note));
        persistedRef.current[id] = note;
        if (requestedRef.current[id] !== note) return;
        failedOnceRef.current.delete(id);
        setStatus(id, 'saved');
      } catch {
        if (requestedRef.current[id] !== note) return;
        requestedRef.current[id] = persistedRef.current[id];
        const isNewerEditQueued = id in pendingRef.current;
        const hasRetried = failedOnceRef.current.delete(id);
        if (!isNewerEditQueued && !hasRetried) {
          failedOnceRef.current.add(id);
          pendingRef.current[id] = note;
        }
        setStatus(id, 'error');
      } finally {
        inFlightRef.current[id] -= 1;
        if (inFlightRef.current[id] === 0) delete inFlightRef.current[id];
      }
    },
    [persistNote],
  );

  const saveNote = useCallback(
    (id: string, note: string) => persistIfChanged(id, note),
    [persistIfChanged],
  );

  const scheduleNoteSave = useCallback(
    (id: string, note: string) => {
      clearTimeout(timersRef.current[id]);
      failedOnceRef.current.delete(id);
      pendingRef.current[id] = note;
      setStatus(id, 'pending');
      timersRef.current[id] = setTimeout(() => {
        void persistIfChanged(id, note);
      }, NOTE_SAVE_DEBOUNCE_MS);
    },
    [persistIfChanged],
  );

  useEffect(() => {
    const flushPendingNotes = () => {
      Object.entries(pendingRef.current).forEach(([id, note]) => {
        void persistIfChanged(id, note, { keepalive: true });
      });
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushPendingNotes();
    };
    const holdUnloadWhileUnsaved = (event: BeforeUnloadEvent) => {
      const hasUnsavedNote =
        Object.keys(pendingRef.current).length > 0 || Object.keys(inFlightRef.current).length > 0;
      if (!hasUnsavedNote) return;
      flushPendingNotes();
      event.preventDefault();
    };
    window.addEventListener('beforeunload', holdUnloadWhileUnsaved);
    window.addEventListener('pagehide', flushPendingNotes);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('beforeunload', holdUnloadWhileUnsaved);
      window.removeEventListener('pagehide', flushPendingNotes);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      flushPendingNotes();
    };
  }, [persistIfChanged]);

  return {
    noteSaveStatuses,
    saveNote,
    scheduleNoteSave,
    cancelNoteSave,
    retainNoteSaves,
    markNotePersisted,
  };
};

export default usePlanNoteAutosave;
