/**
 * Shared browse result view-mode toggle.
 */
import { useContext } from 'react';
import UIContext from '../../contexts/UIContext';

const ViewModeToggle = () => {
  const { viewMode, setViewMode } = useContext(UIContext);

  return (
    <div className="flex border border-line rounded overflow-hidden">
      <button
        onClick={() => setViewMode('card')}
        className={`yr-focus-ring min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 transition-colors ${viewMode === 'card' ? 'bg-brand-soft text-brand' : 'text-gray-400 hover:text-gray-600'}`}
        aria-label="Card view"
        aria-pressed={viewMode === 'card'}
        title="Card view"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      </button>
      <button
        onClick={() => setViewMode('list')}
        className={`yr-focus-ring min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 transition-colors ${viewMode === 'list' ? 'bg-brand-soft text-brand' : 'text-gray-400 hover:text-gray-600'}`}
        aria-label="List view"
        aria-pressed={viewMode === 'list'}
        title="List view"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>
      <button
        onClick={() => setViewMode('compact')}
        className={`yr-focus-ring min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 transition-colors ${viewMode === 'compact' ? 'bg-brand-soft text-brand' : 'text-gray-400 hover:text-gray-600'}`}
        aria-label="Compact view"
        aria-pressed={viewMode === 'compact'}
        title="Compact view"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="8" y1="4" x2="21" y2="4" />
          <line x1="8" y1="9" x2="21" y2="9" />
          <line x1="8" y1="14" x2="21" y2="14" />
          <line x1="8" y1="19" x2="21" y2="19" />
          <line x1="3" y1="4" x2="3.01" y2="4" />
          <line x1="3" y1="9" x2="3.01" y2="9" />
          <line x1="3" y1="14" x2="3.01" y2="14" />
          <line x1="3" y1="19" x2="3.01" y2="19" />
        </svg>
      </button>
    </div>
  );
};

export default ViewModeToggle;
