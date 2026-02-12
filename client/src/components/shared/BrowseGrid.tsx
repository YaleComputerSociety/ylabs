import React, { useContext } from 'react';
import { BrowsableItem } from '../../types/browsable';
import BrowseCard from './BrowseCard';
import BrowseListItem from './BrowseListItem';
import LoadingSpinner from './LoadingSpinner';
import UIContext from '../../contexts/UIContext';

interface BrowseGridProps {
  items: BrowsableItem[];
  favIds: string[];
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onOpenModal: (item: BrowsableItem) => void;
  onAdminEdit?: (item: BrowsableItem) => void;
  // Infinite scroll (optional — omit for single-page-load views)
  sentinelRef?: React.RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  searchExhausted?: boolean;
  // Quick filter empty state
  quickFilter?: string | null;
  onClearQuickFilter?: () => void;
  // No results message
  emptyMessage?: string;
}

const BrowseGrid = ({
  items,
  favIds,
  onToggleFavorite,
  onOpenModal,
  onAdminEdit,
  sentinelRef,
  isLoading,
  searchExhausted,
  quickFilter,
  onClearQuickFilter,
  emptyMessage = 'No results match the current filter',
}: BrowseGridProps) => {
  const { viewMode } = useContext(UIContext);
  const showLoader = isLoading && items.length > 0;

  if (items.length === 0 && !isLoading) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>{emptyMessage}</p>
        {quickFilter && onClearQuickFilter && (
          <button
            onClick={onClearQuickFilter}
            className="mt-2 text-blue-600 hover:underline text-sm"
          >
            Clear filter
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center relative pb-4">
      <div className="w-full">
        {viewMode === 'card' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <BrowseCard
                key={item.data.id}
                item={item}
                isFavorite={favIds.includes(item.data.id)}
                onToggleFavorite={(e) => onToggleFavorite(item.data.id, e)}
                onOpenModal={() => onOpenModal(item)}
                onAdminEdit={onAdminEdit ? () => onAdminEdit(item) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <BrowseListItem
                key={item.data.id}
                item={item}
                isFavorite={favIds.includes(item.data.id)}
                onToggleFavorite={(e) => onToggleFavorite(item.data.id, e)}
                onOpenModal={() => onOpenModal(item)}
                onAdminEdit={onAdminEdit ? () => onAdminEdit(item) : undefined}
              />
            ))}
          </div>
        )}

        {/* Sentinel for infinite scroll */}
        {sentinelRef && !searchExhausted && (
          <div ref={sentinelRef} className="h-10 w-full" />
        )}
      </div>

      {showLoader && <LoadingSpinner size="lg" />}
    </div>
  );
};

export default BrowseGrid;
