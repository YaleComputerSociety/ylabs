/**
 * Shared browse result view-mode toggle.
 */
import { useContext } from 'react';
import UIContext from '../../contexts/UIContext';
import { CompactViewIcon, GridViewIcon, ListViewIcon } from './icons';

const ViewModeToggle = () => {
  const { viewMode, setViewMode } = useContext(UIContext);

  return (
    <div className="flex border border-line rounded-control overflow-hidden">
      <button
        onClick={() => setViewMode('card')}
        className={`yr-focus-ring min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 transition-colors ${viewMode === 'card' ? 'bg-brand-soft text-brand' : 'text-muted hover:text-ink-soft'}`}
        aria-label="Card view"
        aria-pressed={viewMode === 'card'}
        title="Card view"
      >
        <GridViewIcon size={16} />
      </button>
      <button
        onClick={() => setViewMode('list')}
        className={`yr-focus-ring min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 transition-colors ${viewMode === 'list' ? 'bg-brand-soft text-brand' : 'text-muted hover:text-ink-soft'}`}
        aria-label="List view"
        aria-pressed={viewMode === 'list'}
        title="List view"
      >
        <ListViewIcon size={16} />
      </button>
      <button
        onClick={() => setViewMode('compact')}
        className={`yr-focus-ring min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 transition-colors ${viewMode === 'compact' ? 'bg-brand-soft text-brand' : 'text-muted hover:text-ink-soft'}`}
        aria-label="Compact view"
        aria-pressed={viewMode === 'compact'}
        title="Compact view"
      >
        <CompactViewIcon size={16} />
      </button>
    </div>
  );
};

export default ViewModeToggle;
