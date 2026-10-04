/**
 * Favorites state + optimistic toggle for saved collections.
 * Keeps load/update endpoints local so the supported kinds share orchestration.
 */
import { useCallback, useRef, useState, type MouseEvent } from 'react';
import axios from '../utils/axios';
import useLatestRequest from './useLatestRequest';
import { showWarningDialog } from '../utils/warningDialog';
import {
  createResearchAnalyticsInteractionId,
  trackResearchEvent,
  type ResearchEntityType,
  type ResearchSaveSurface,
} from '../utils/researchAnalytics';
import useLoadEffect from './useLoadEffect';

type FavoritesKind = 'researchPlans' | 'watchedPrograms';

interface Endpoints {
  load: string;
  responseKey: string;
  collectionPath: string;
  payloadKey: string;
  analyticsEntityType: ResearchEntityType;
  mutationFailureText: (favorite: boolean) => string;
}

const ENDPOINTS: Record<FavoritesKind, Endpoints> = {
  researchPlans: {
    load: '/users/savedResearchEntityIds',
    responseKey: 'savedResearchEntityIds',
    collectionPath: '/users/savedResearchEntities',
    payloadKey: 'savedResearchEntities',
    analyticsEntityType: 'research_entity',
    mutationFailureText: (favorite) =>
      favorite
        ? 'Could not save this research. Check your connection and try again.'
        : 'Could not remove this research from your plans. Check your connection and try again.',
  },
  watchedPrograms: {
    load: '/users/watchedProgramIds',
    responseKey: 'watchedProgramIds',
    collectionPath: '/users/watchedPrograms',
    payloadKey: 'watchedPrograms',
    analyticsEntityType: 'fellowship',
    mutationFailureText: (favorite) =>
      favorite
        ? 'Could not watch this program. Check your connection and try again.'
        : 'Could not stop watching this program. Check your connection and try again.',
  },
};

interface FavoriteIntent {
  favorite: boolean;
  sequence: number;
  inFlight: boolean;
}

const withFavorite = (ids: string[], id: string, favorite: boolean): string[] =>
  favorite ? [id, ...ids.filter((x) => x !== id)] : ids.filter((x) => x !== id);

export const useFavorites = (
  kind: FavoritesKind,
  {
    enabled = true,
    surface: defaultSurface = 'profile',
  }: { enabled?: boolean; surface?: ResearchSaveSurface } = {},
) => {
  const config = ENDPOINTS[kind];
  const [favIds, setFavIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const latestLoad = useLatestRequest();
  const intentSequenceRef = useRef(0);
  const intentsRef = useRef(new Map<string, FavoriteIntent>());

  const reload = useCallback(async () => {
    if (!enabled) {
      latestLoad.cancel();
      setFavIds([]);
      setLoadError(false);
      setLoaded(true);
      return;
    }
    const ticket = latestLoad.begin();
    const sequenceAtStart = intentSequenceRef.current;
    const inFlightAtStart = new Set(
      Array.from(intentsRef.current)
        .filter(([, intent]) => intent.inFlight)
        .map(([id]) => id),
    );
    try {
      const res = await axios.get(config.load, { withCredentials: true });
      if (!ticket.isCurrent()) return;
      let ids: string[] = res.data[config.responseKey] || [];
      intentsRef.current.forEach((intent, id) => {
        if (intent.sequence > sequenceAtStart || inFlightAtStart.has(id)) {
          ids = withFavorite(ids, id, intent.favorite);
        }
      });
      setFavIds(ids);
      setLoadError(false);
      setLoaded(true);
    } catch {
      if (!ticket.isCurrent()) return;
      console.error(`Error fetching user's favorite ${kind}.`);
      setLoadError(true);
      setLoaded(false);
    }
  }, [enabled, kind, config.load, config.responseKey, latestLoad]);

  useLoadEffect(reload);

  const setFavorite = useCallback(
    async (id: string, favorite: boolean, surface: ResearchSaveSurface = defaultSurface) => {
      intentSequenceRef.current += 1;
      const intent: FavoriteIntent = {
        favorite,
        sequence: intentSequenceRef.current,
        inFlight: true,
      };
      intentsRef.current.set(id, intent);
      const isLatestIntent = () => intentsRef.current.get(id) === intent;
      setFavIds((current) => withFavorite(current, id, favorite));
      try {
        const request = { withCredentials: true, data: { [config.payloadKey]: [id] } };
        if (favorite) {
          await axios.put(config.collectionPath, request);
        } else {
          await axios.delete(config.collectionPath, request);
        }
        intent.inFlight = false;
        void trackResearchEvent({
          eventType: 'research_save',
          entityType: config.analyticsEntityType,
          entityId: id,
          payload: { operation: favorite ? 'save' : 'remove', surface },
          dedupeKey: createResearchAnalyticsInteractionId('save'),
        });
        return true;
      } catch {
        console.error(`Error ${favorite ? 'favoriting' : 'unfavoriting'} ${kind.slice(0, -1)}.`);
        if (isLatestIntent()) {
          intentsRef.current.delete(id);
          setFavIds((current) => withFavorite(current, id, !favorite));
        }
        void showWarningDialog(config.mutationFailureText(favorite));
        await reload();
        return false;
      }
    },
    [defaultSurface, kind, config, reload],
  );

  const toggleFavorite = useCallback(
    (id: string, e?: MouseEvent) => {
      e?.stopPropagation();
      void setFavorite(id, !favIds.includes(id));
    },
    [favIds, setFavorite],
  );

  return { favIds, loaded, loadError, setFavorite, toggleFavorite, reloadFavorites: reload };
};

export default useFavorites;
