/**
 * Custom hook for tracking listing and fellowship view counts.
 */
import { useRef, useCallback } from 'react';
import axios from '../utils/axios';

export function useViewTracking(entityType: 'listing' | 'fellowship', entityId: string) {
  const viewedRef = useRef(false);

  const trackView = useCallback(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    const endpoint =
      entityType === 'listing' ? `listings/${entityId}/addView` : `fellowships/${entityId}/addView`;
    axios.put(endpoint, { withCredentials: true }).catch(() => {});
  }, [entityType, entityId]);

  return trackView;
}
