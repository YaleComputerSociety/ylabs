/**
 * Generic Kanban board: renders columns with drag-and-drop stage changes
 * and a keyboard-accessible "Move to" select for non-pointer users.
 */
import React, { useState } from 'react';

export interface KanbanColumn<K extends string> {
  key: K;
  label: string;
  color: string;
  headerBg: string;
  emptyText?: string;
}

interface KanbanProps<T, K extends string> {
  items: T[];
  columns: KanbanColumn<K>[];
  getItemId: (item: T) => string;
  getStage: (item: T) => K;
  onStageChange: (id: string, stage: K) => void;
  renderCard: (item: T) => React.ReactNode;
  gridClassName?: string;
  itemNoun?: string;
}

function Kanban<T, K extends string>({
  items,
  columns,
  getItemId,
  getStage,
  onStageChange,
  renderCard,
  gridClassName = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3',
  itemNoun = 'item',
}: KanbanProps<T, K>) {
  const [dragOverColumn, setDragOverColumn] = useState<K | null>(null);

  const columnItems = columns.map((col) => ({
    ...col,
    items: items.filter((item) => getStage(item) === col.key),
  }));

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, colKey: K) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(colKey);
  };

  const handleDragLeave = () => setDragOverColumn(null);

  const handleDrop = (e: React.DragEvent, colKey: K) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const item = items.find((i) => getItemId(i) === id);
    if (item && getStage(item) !== colKey) {
      onStageChange(id, colKey);
    }
    setDragOverColumn(null);
  };

  return (
    <div className={gridClassName}>
      {columnItems.map((col) => (
        <div
          key={col.key}
          className={`flex flex-col rounded-lg border-2 transition-colors min-h-[200px] ${
            dragOverColumn === col.key ? `${col.color} bg-gray-50` : 'border-gray-200 bg-white'
          }`}
          onDragOver={(e) => handleDragOver(e, col.key)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, col.key)}
          role="region"
          aria-label={`${col.label} column`}
        >
          <div className={`px-3 py-2 rounded-t-md ${col.headerBg} flex items-center justify-between`}>
            <span className="text-sm font-semibold">{col.label}</span>
            <span className="text-xs opacity-70" aria-label={`${col.items.length} ${itemNoun}${col.items.length === 1 ? '' : 's'}`}>
              {col.items.length}
            </span>
          </div>

          <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[60vh]">
            {col.items.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-xs text-gray-400 italic text-center px-2">
                {col.emptyText || `Drag ${itemNoun}s here`}
              </div>
            ) : (
              col.items.map((item) => {
                const id = getItemId(item);
                return (
                  <div
                    key={id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, id)}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <div className="mb-1 flex justify-end">
                      <label className="sr-only" htmlFor={`kanban-move-${id}`}>
                        Move {itemNoun} to another column
                      </label>
                      <select
                        id={`kanban-move-${id}`}
                        value={col.key}
                        onChange={(e) => onStageChange(id, e.target.value as K)}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-600 hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        {columns.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.key === col.key ? `${c.label} (current)` : `Move to ${c.label}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    {renderCard(item)}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default Kanban;
