import { useEffect } from 'react';

const useLoadEffect = (load: () => unknown, when: unknown = true) => {
  useEffect(() => {
    if (!when) return;
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load, when]);
};

export default useLoadEffect;
