/**
 * Favorites state + optimistic toggle for listings, fellowships, or pathways.
 * Keeps load/update endpoints local so the two kinds share all orchestration.
 */
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import axios from '../utils/axios';
import swal from 'sweetalert';

type FavoritesKind = 'listings' | 'fellowships' | 'pathways' | 'researchPlans';

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
  fellowships: {
    load: '/users/favFellowshipIds',
    responseKey: 'favFellowshipIds',
    collectionPath: '/users/favFellowships',
    payloadKey: 'favFellowships',
    warnOnLoadError: false,
    warnOnMutationError: false,
  },
  pathways: {
    load: '/users/favPathwayIds',
    responseKey: 'favPathwayIds',
    collectionPath: '/users/favPathways',
    payloadKey: 'favPathways',
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
    } catch (error) {
      console.error(`Error fetching user's favorite ${kind}:`, error);
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
    } catch (error) {
      console.error(`Error ${favorite ? 'favoriting' : 'unfavoriting'} ${kind.slice(0, -1)}:`, error);
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
