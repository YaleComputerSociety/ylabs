import { useEffect, useState } from 'react';
import axios from '../utils/axios';

type WatchedProgramStages = Record<string, string | undefined>;

export const useWatchedProgramStages = (watchedIds: readonly string[]): WatchedProgramStages => {
  const [stages, setStages] = useState<WatchedProgramStages>({});
  const watchedKey = [...watchedIds].sort().join(',');

  useEffect(() => {
    if (!watchedKey) return;
    let isCurrent = true;
    axios
      .get('/users/watchedProgramPlans', { withCredentials: true })
      .then((response) => {
        if (!isCurrent) return;
        const plans = (response.data?.watchedProgramPlans || {}) as Record<
          string,
          { stage?: string }
        >;
        setStages(Object.fromEntries(Object.entries(plans).map(([id, plan]) => [id, plan?.stage])));
      })
      .catch(() => {
        if (isCurrent) setStages({});
      });
    return () => {
      isCurrent = false;
    };
  }, [watchedKey]);

  return watchedKey ? stages : {};
};
