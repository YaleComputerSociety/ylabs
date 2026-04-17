/**
 * Kanban board for tracking fellowship application stages.
 */
import React, { useState } from 'react';
import BrowseCard from './BrowseCard';
import { Fellowship, FellowshipStage } from '../../types/types';
import { BrowsableItem } from '../../types/browsable';

const COLUMNS: { key: FellowshipStage; label: string; color: string; headerBg: string }[] = [
  {
    key: 'not_applied',
    label: 'Not Applied',
    color: 'border-gray-300',
    headerBg: 'bg-gray-100 text-gray-700',
  },
  {
    key: 'applied',
    label: 'Applied',
    color: 'border-green-300',
    headerBg: 'bg-green-50 text-green-700',
  },
];

interface FellowshipKanbanBoardProps {
  items: Fellowship[];
  fellowshipStage: Record<string, FellowshipStage>;
  onStageChange: (id: string, stage: FellowshipStage) => void;
  favIds: string[];
  onToggleFavorite: (fellowshipId: string, favorite: boolean) => void;
  onOpenModal: (fellowship: Fellowship) => void;
}

const FellowshipKanbanBoard: React.FC<FellowshipKanbanBoardProps> = ({
  items,
  fellowshipStage,
  onStageChange,
  favIds,
  onToggleFavorite,
  onOpenModal,
}) => {
  const [dragOverColumn, setDragOverColumn] = useState<FellowshipStage | null>(null);

  const getStage = (id: string): FellowshipStage => fellowshipStage[id] || 'not_applied';

  const columnItems = COLUMNS.map((col) => ({
    ...col,
    fellowships: items.filter((item) => getStage(item.id) === col.key),
  }));

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, colKey: FellowshipStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(colKey);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, colKey: FellowshipStage) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id && getStage(id) !== colKey) {
      onStageChange(id, colKey);
    }
    setDragOverColumn(null);
  };

  const toBrowsable = (f: Fellowship): BrowsableItem => ({ type: 'fellowship', data: f });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <span className="text-xs opacity-70">{col.fellowships.length}</span>
          </div>

          <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[60vh]">
            {col.fellowships.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-xs text-gray-400 italic">
                Drag fellowships here
              </div>
            ) : (
              col.fellowships.map((fellowship) => (
                <div
                  key={fellowship.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, fellowship.id)}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <BrowseCard
                    item={toBrowsable(fellowship)}
                    isFavorite={favIds.includes(fellowship.id)}
                    onToggleFavorite={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(fellowship.id, !favIds.includes(fellowship.id));
                    }}
                    onOpenModal={() => onOpenModal(fellowship)}
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

export default FellowshipKanbanBoard;
