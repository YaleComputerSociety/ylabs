/**
 * Kanban board for tracking lab application stages.
 */
import React, { useState } from 'react';
import BrowseCard from './BrowseCard';
import { Listing } from '../../types/types';
import { BrowsableItem } from '../../types/browsable';

export type LabStage = 'not_emailed' | 'emailed' | 'responded' | 'interview';

const COLUMNS: { key: LabStage; label: string; color: string; headerBg: string }[] = [
  {
    key: 'not_emailed',
    label: 'Not Emailed',
    color: 'border-gray-300',
    headerBg: 'bg-gray-100 text-gray-700',
  },
  {
    key: 'emailed',
    label: 'Emailed',
    color: 'border-blue-300',
    headerBg: 'bg-blue-50 text-blue-700',
  },
  {
    key: 'responded',
    label: 'Responded',
    color: 'border-amber-300',
    headerBg: 'bg-amber-50 text-amber-700',
  },
  {
    key: 'interview',
    label: 'Interview',
    color: 'border-green-300',
    headerBg: 'bg-green-50 text-green-700',
  },
];

interface KanbanBoardProps {
  items: Listing[];
  labStage: Record<string, LabStage>;
  onStageChange: (id: string, stage: LabStage) => void;
  favIds: string[];
  onToggleFavorite: (listing: Listing, id: string, favorite: boolean) => void;
  onOpenModal: (listing: Listing) => void;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({
  items,
  labStage,
  onStageChange,
  favIds,
  onToggleFavorite,
  onOpenModal,
}) => {
  const [dragOverColumn, setDragOverColumn] = useState<LabStage | null>(null);

  const getStage = (id: string): LabStage => labStage[id] || 'not_emailed';

  const columnItems = COLUMNS.map((col) => ({
    ...col,
    listings: items.filter((item) => getStage(item.id) === col.key),
  }));

  const handleDragStart = (e: React.DragEvent, listingId: string) => {
    e.dataTransfer.setData('text/plain', listingId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, colKey: LabStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(colKey);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, colKey: LabStage) => {
    e.preventDefault();
    const listingId = e.dataTransfer.getData('text/plain');
    if (listingId && getStage(listingId) !== colKey) {
      onStageChange(listingId, colKey);
    }
    setDragOverColumn(null);
  };

  const toBrowsable = (l: Listing): BrowsableItem => ({ type: 'listing', data: l });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {columnItems.map((col) => (
        <div
          key={col.key}
          className={`flex flex-col rounded-lg border-2 transition-colors min-h-[200px] ${
            dragOverColumn === col.key ? `${col.color} bg-gray-50` : 'border-gray-200 bg-white'
          }`}
          onDragOver={(e) => handleDragOver(e, col.key)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, col.key)}
        >
          <div
            className={`px-3 py-2 rounded-t-md ${col.headerBg} flex items-center justify-between`}
          >
            <span className="text-sm font-semibold">{col.label}</span>
            <span className="text-xs opacity-70">{col.listings.length}</span>
          </div>

          <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[60vh]">
            {col.listings.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-xs text-gray-400 italic">
                Drag listings here
              </div>
            ) : (
              col.listings.map((listing) => (
                <div
                  key={listing.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, listing.id)}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <BrowseCard
                    item={toBrowsable(listing)}
                    isFavorite={favIds.includes(listing.id)}
                    onToggleFavorite={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(listing, listing.id, !favIds.includes(listing.id));
                    }}
                    onOpenModal={() => onOpenModal(listing)}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default KanbanBoard;
