import { useEffect, useState } from 'react';
import axios from '../utils/axios';
import type { SavedSearchView } from '../types/savedSearch';
import { totalNewSavedSearchMatches } from '../utils/savedSearchSummary';

interface SavedSearchNewMatchSummary {
  totalNewMatches: number;
  hasSavedSearches: boolean;
  isLoading: boolean;
}

const IDLE_SUMMARY: SavedSearchNewMatchSummary = {
  totalNewMatches: 0,
  hasSavedSearches: false,
  isLoading: false,
};

export const useSavedSearchNewMatchSummary = (enabled: boolean): SavedSearchNewMatchSummary => {
  const [summary, setSummary] = useState<SavedSearchNewMatchSummary>(IDLE_SUMMARY);

  useEffect(() => {
    if (!enabled) {
      setSummary(IDLE_SUMMARY);
      return;
    }
    let active = true;
    setSummary((current) => ({ ...current, isLoading: true }));
    axios
      .get('/users/savedSearches', { withCredentials: true })
      .then((response) => {
        if (!active) return;
        const searches = (response.data.savedSearches || []) as SavedSearchView[];
        setSummary({
          totalNewMatches: totalNewSavedSearchMatches(searches),
          hasSavedSearches: searches.length > 0,
          isLoading: false,
        });
      })
      .catch(() => {
        if (!active) return;
        console.error('Error fetching saved-search new-match summary.');
        setSummary(IDLE_SUMMARY);
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return summary;
};

export default useSavedSearchNewMatchSummary;
