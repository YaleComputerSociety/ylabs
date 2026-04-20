/**
 * Detail modal hooks: own selected-item state, mount the modal, wire favorites.
 * Callers shrink from ~12 lines of useState/onClose/onToggleFavorite to
 * `const { open, element } = useListingModal({ favIds, setFavorite })`.
 */
import { useCallback, useState } from 'react';
import { Listing, Fellowship } from '../types/types';
import ListingDetailModal from '../components/shared/ListingDetailModal';
import FellowshipModal from '../components/fellowship/FellowshipModal';

interface UseListingModalParams {
  favIds: string[];
  setFavorite: (id: string, favorite: boolean) => void;
  onNavigateToResearchArea?: (area: string) => void;
  onNavigateToDepartment?: (dept: string) => void;
}

export function useListingModal({
  favIds,
  setFavorite,
  onNavigateToResearchArea,
  onNavigateToDepartment,
}: UseListingModalParams) {
  const [selected, setSelected] = useState<Listing | null>(null);

  const open = useCallback((listing: Listing) => setSelected(listing), []);
  const close = useCallback(() => setSelected(null), []);

  const element = selected ? (
    <ListingDetailModal
      isOpen={true}
      onClose={close}
      listing={selected}
      isFavorite={favIds.includes(selected.id)}
      onToggleFavorite={(e) => {
        e.stopPropagation();
        setFavorite(selected.id, !favIds.includes(selected.id));
      }}
      onNavigateToResearchArea={
        onNavigateToResearchArea
          ? (area) => {
              onNavigateToResearchArea(area);
              close();
            }
          : undefined
      }
      onNavigateToDepartment={
        onNavigateToDepartment
          ? (dept) => {
              onNavigateToDepartment(dept);
              close();
            }
          : undefined
      }
    />
  ) : null;

  return { open, close, element, isOpen: selected !== null };
}

interface UseFellowshipModalParams {
  favIds: string[];
  setFavorite: (id: string, favorite: boolean) => void;
}

export function useFellowshipModal({ favIds, setFavorite }: UseFellowshipModalParams) {
  const [selected, setSelected] = useState<Fellowship | null>(null);

  const open = useCallback((fellowship: Fellowship) => setSelected(fellowship), []);
  const close = useCallback(() => setSelected(null), []);

  const element = selected ? (
    <FellowshipModal
      fellowship={selected}
      isOpen={true}
      onClose={close}
      isFavorite={favIds.includes(selected.id)}
      toggleFavorite={() => setFavorite(selected.id, !favIds.includes(selected.id))}
    />
  ) : null;

  return { open, close, element, isOpen: selected !== null };
}
