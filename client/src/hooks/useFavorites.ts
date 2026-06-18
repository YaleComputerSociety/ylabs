/**
 * Favorites state + optimistic toggle for saved collections.
 * Keeps load/update endpoints local so the supported kinds share orchestration.
 */
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import axios from '../utils/axios';
import swal from 'sweetalert';

type FavoritesKind = 'listings' | 'programs' | 'researchPlans';

interface Endpoints {
  load: string;
  responseKey: string;
  collectionPath: string;
  payloadKey: string;
  warnOnLoadError: boolean;
  warnOnMutationError: boolean;
}

const ENDPOINTS: Record<FavoritesKind, Endpoints> = {
  listings: {
    load: '/users/favListingsIds',
    responseKey: 'favListingsIds',
    collectionPath: '/users/favListings',
    payloadKey: 'favListings',
    warnOnLoadError: false,
    warnOnMutationError: true,
  },
  programs: {
    load: '/users/savedProgramIds',
    responseKey: 'savedProgramIds',
    collectionPath: '/users/savedPrograms',
    payloadKey: 'savedPrograms',
    warnOnLoadError: false,
    warnOnMutationError: false,
  },
  researchPlans: {
    load: '/users/savedResearchPlanIds',
    responseKey: 'savedResearchPlanIds',
    collectionPath: '/users/savedResearchPlans',
    payloadKey: 'savedResearchPlans',
    warnOnLoadError: false,
    warnOnMutationError: false,
  },
};

export const useFavorites = (kind: FavoritesKind) => {
  const config = ENDPOINTS[kind];
  const [favIds, setFavIds] = useState<string[]>([]);

  const reload = useCallback(async () => {
    try {
      const res = await axios.get(config.load, { withCredentials: true });
      setFavIds(res.data[config.responseKey] || []);
    } catch {
      console.error(`Error fetching user's favorite ${kind}.`);
      setFavIds([]);
      if (config.warnOnLoadError) {
        swal({ text: `Could not load your favorite ${kind}`, icon: 'warning' });
      }
    }
  }, [kind, config.load, config.responseKey, config.warnOnLoadError]);

  useEffect(() => {
    reload();
  }, [reload]);

  const setFavorite = useCallback(async (id: string, favorite: boolean) => {
    const previous = favIds;
    setFavIds((prev) => (favorite ? [id, ...prev.filter((x) => x !== id)] : prev.filter((x) => x !== id)));
    try {
      if (favorite) {
        await axios.put(config.collectionPath, { withCredentials: true, data: { [config.payloadKey]: [id] } });
      } else {
        await axios.delete(config.collectionPath, { withCredentials: true, data: { [config.payloadKey]: [id] } });
      }
    } catch {
      console.error(`Error ${favorite ? 'favoriting' : 'unfavoriting'} ${kind.slice(0, -1)}.`);
      setFavIds(previous);
      if (config.warnOnMutationError) {
        swal({ text: `Unable to ${favorite ? 'favorite' : 'unfavorite'} ${kind.slice(0, -1)}`, icon: 'warning' });
      }
      reload();
    }
  }, [favIds, kind, config.collectionPath, config.payloadKey, config.warnOnMutationError, reload]);

  const toggleFavorite = useCallback((id: string, e?: MouseEvent) => {
    e?.stopPropagation();
    setFavorite(id, !favIds.includes(id));
  }, [favIds, setFavorite]);

  return { favIds, setFavorite, toggleFavorite, reloadFavorites: reload };
};

export default useFavorites;
