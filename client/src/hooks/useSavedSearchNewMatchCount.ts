import { useEffect, useState } from 'react';
import axios from '../utils/axios';
import type { SavedSearchView } from '../types/savedSearch';

export const useSavedSearchNewMatchCount = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const [newMatchCount, setNewMatchCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setNewMatchCount(0);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const response = await axios.get('/users/savedSearches', { withCredentials: true });
        if (!active) return;
        const searches = (response.data.savedSearches || []) as SavedSearchView[];
        setNewMatchCount(
          searches.reduce((sum, search) => sum + Math.max(0, search.newMatchCount ?? 0), 0),
        );
      } catch {
        if (!active) return;
        console.error('Error fetching saved-search new-match count.');
        setNewMatchCount(0);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [enabled]);

  return newMatchCount;
};

export default useSavedSearchNewMatchCount;
