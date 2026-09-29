import { useCallback, useEffect, useRef, useState } from 'react';

export type PlanNoteSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const NOTE_SAVE_DEBOUNCE_MS = 700;

const usePlanNoteAutosave = (persistNote: (id: string, note: string) => Promise<void>) => {
  const [noteSaveStatuses, setNoteSaveStatuses] = useState<Record<string, PlanNoteSaveStatus>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const persistedRef = useRef<Record<string, string>>({});
  const requestedRef = useRef<Record<string, string>>({});

  const setStatus = (id: string, status: PlanNoteSaveStatus) =>
    setNoteSaveStatuses((statuses) => ({ ...statuses, [id]: status }));

  const markNotePersisted = useCallback((id: string, note: string) => {
    persistedRef.current[id] = note;
    requestedRef.current[id] = note;
  }, []);

  const cancelNoteSave = useCallback((id: string) => {
    clearTimeout(timersRef.current[id]);
  }, []);

  const saveNote = useCallback(
    async (id: string, note: string) => {
      clearTimeout(timersRef.current[id]);
      if (requestedRef.current[id] === note) return;
      requestedRef.current[id] = note;
      setStatus(id, 'saving');
      try {
        await persistNote(id, note);
        persistedRef.current[id] = note;
        if (requestedRef.current[id] === note) setStatus(id, 'saved');
      } catch {
        if (requestedRef.current[id] !== note) return;
        requestedRef.current[id] = persistedRef.current[id];
        setStatus(id, 'error');
      }
    },
    [persistNote],
  );

  const scheduleNoteSave = useCallback(
    (id: string, note: string) => {
      clearTimeout(timersRef.current[id]);
      setStatus(id, 'idle');
      timersRef.current[id] = setTimeout(() => {
        void saveNote(id, note);
      }, NOTE_SAVE_DEBOUNCE_MS);
    },
    [saveNote],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  return { noteSaveStatuses, saveNote, scheduleNoteSave, cancelNoteSave, markNotePersisted };
};

export default usePlanNoteAutosave;
