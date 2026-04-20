/**
 * Grid/list layout switcher for browse pages.
 */
import React, { useContext } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { BrowsableItem } from '../../types/browsable';
import BrowseCard from './BrowseCard';
import BrowseListItem from './BrowseListItem';
import LoadingSpinner from './LoadingSpinner';
import UIContext from '../../contexts/UIContext';

const VIRTUALIZATION_THRESHOLD = 50;

interface BrowseGridProps {
  items: BrowsableItem[];
  favIds: string[];
  onToggleFavorite: (id: string, e: React.MouseEvent) => void;
  onOpenModal: (item: BrowsableItem) => void;
  onAdminEdit?: (item: BrowsableItem) => void;
  sentinelRef?: React.RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  searchExhausted?: boolean;
  quickFilter?: string | null;
  onClearQuickFilter?: () => void;
  emptyMessage?: string;
  onLoadMore?: () => void;
  disableVirtualization?: boolean;
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
  onLoadMore,
  disableVirtualization = false,
}: BrowseGridProps) => {
  const { viewMode } = useContext(UIContext);
  const isCompact = viewMode === 'compact';
  const showLoader = isLoading && items.length > 0;
  
  const loadingLock = React.useRef(false);
  React.useEffect(() => {
    if (!isLoading) {
      setTimeout(() => { loadingLock.current = false; }, 100);
    } else {
      loadingLock.current = true;
    }
  }, [isLoading]);

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
        {viewMode === 'card' || viewMode === 'compact' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <BrowseCard
                key={item.data.id}
                item={item}
                isCompact={isCompact}
                isFavorite={favIds.includes(item.data.id)}
                onToggleFavorite={(e) => onToggleFavorite(item.data.id, e)}
                onOpenModal={() => onOpenModal(item)}
                onAdminEdit={onAdminEdit ? () => onAdminEdit(item) : undefined}
              />
            ))}
          </div>
        ) : items.length > VIRTUALIZATION_THRESHOLD && !disableVirtualization ? (
            <Virtuoso
            useWindowScroll
            data={items}
            increaseViewportBy={600}
            endReached={() => {
              if (onLoadMore && !loadingLock.current && !searchExhausted) {
                loadingLock.current = true;
                onLoadMore();
              }
            }}
            itemContent={(_, item) => (
              <div className="pb-2">
                <BrowseListItem
                  item={item}
                  isFavorite={favIds.includes(item.data.id)}
                  onToggleFavorite={(e) => onToggleFavorite(item.data.id, e)}
                  onOpenModal={() => onOpenModal(item)}
                  onAdminEdit={onAdminEdit ? () => onAdminEdit(item) : undefined}
                />
              </div>
            )}
            computeItemKey={(_, item) => item.data.id}
          />
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

        {sentinelRef && !searchExhausted && <div ref={sentinelRef} className="h-10 w-full" />}
      </div>

      {showLoader && <LoadingSpinner size="lg" />}
    </div>
  );
};

export default BrowseGrid;
