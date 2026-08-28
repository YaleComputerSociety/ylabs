/**
 * Custom hook for tracking listing and fellowship view counts.
 * ResearchEntity view tracking does not have a public endpoint yet, so research
 * cards intentionally no-op.
 */
import { useRef, useCallback } from 'react';
import axios from '../utils/axios';

export function useViewTracking(entityType: 'listing' | 'fellowship' | 'researchGroup', entityId: string) {
  const viewedRef = useRef(false);

  const trackView = useCallback(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    if (entityType === 'researchGroup') return;
    const endpoint =
      entityType === 'listing' ? `listings/${entityId}/addView` : `fellowships/${entityId}/addView`;
    axios.put(endpoint, { withCredentials: true }).catch(() => {});
  }, [entityType, entityId]);

  return trackView;
}
