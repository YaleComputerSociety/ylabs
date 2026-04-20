/**
 * Favorites state + optimistic toggle for listings or fellowships.
 * Keeps load/update endpoints local so the two kinds share all orchestration.
 */
import { useCallback, useEffect, useState } from 'react';
import axios from '../utils/axios';
import swal from 'sweetalert';

type FavoritesKind = 'listings' | 'fellowships';

interface Endpoints {
  load: string;
  responseKey: string;
  collectionPath: string;
  payloadKey: string;
  warnOnError: boolean;
}

const ENDPOINTS: Record<FavoritesKind, Endpoints> = {
  listings: {
    load: '/users/favListingsIds',
    responseKey: 'favListingsIds',
    collectionPath: '/users/favListings',
    payloadKey: 'favListings',
    warnOnError: true,
  },
  fellowships: {
    load: '/users/favFellowshipIds',
    responseKey: 'favFellowshipIds',
    collectionPath: '/users/favFellowships',
    payloadKey: 'favFellowships',
    warnOnError: false,
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
      if (config.warnOnError) {
        swal({ text: `Could not load your favorite ${kind}`, icon: 'warning' });
      }
    }
  }, [kind, config.load, config.responseKey, config.warnOnError]);

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
      if (config.warnOnError) {
        swal({ text: `Unable to ${favorite ? 'favorite' : 'unfavorite'} ${kind.slice(0, -1)}`, icon: 'warning' });
      }
      reload();
    }
  }, [favIds, kind, config.collectionPath, config.payloadKey, config.warnOnError, reload]);

  const toggleFavorite = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setFavorite(id, !favIds.includes(id));
  }, [favIds, setFavorite]);

  return { favIds, setFavorite, toggleFavorite, reloadFavorites: reload };
};

export default useFavorites;
