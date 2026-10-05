/**
 * Toggle for union/intersection filter matching mode.
 */
import { FilterMode } from '../shared/CombinedFilterDropdown';

interface VennDiagramToggleProps {
  mode: FilterMode;
  setMode: (mode: FilterMode) => void;
  compact?: boolean;
}

const VennDiagramToggle = ({ mode, setMode, compact = false }: VennDiagramToggleProps) => {
  return (
    <div className={`flex items-center ${compact ? 'gap-1' : 'gap-2'}`}>
      {!compact && <span className="text-xs text-muted">Match:</span>}
      <div className="flex bg-[var(--yr-panel-muted)] rounded-card p-0.5 gap-0.5">
        <button
          type="button"
          onClick={() => setMode('union')}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-control text-xs font-medium transition-colors yr-focus-ring ${
            mode === 'union'
              ? 'bg-[var(--yr-panel)] shadow-yr-raised text-green-700'
              : 'text-muted hover:text-ink-soft'
          }`}
          title="Any (OR) - Match any of the selected items"
        >
          <svg
            width="14"
            height="12"
            viewBox="0 0 24 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="8"
              cy="8"
              r="5.5"
              stroke={mode === 'union' ? 'var(--yr-green)' : 'var(--yr-line-strong)'}
              strokeWidth="1.5"
              fill={mode === 'union' ? 'var(--yr-green-soft)' : 'none'}
            />
            <circle
              cx="16"
              cy="8"
              r="5.5"
              stroke={mode === 'union' ? 'var(--yr-green)' : 'var(--yr-line-strong)'}
              strokeWidth="1.5"
              fill={mode === 'union' ? 'var(--yr-green-soft)' : 'none'}
            />
          </svg>
          <span>Any</span>
        </button>

        <button
          type="button"
          onClick={() => setMode('intersection')}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-control text-xs font-medium transition-colors yr-focus-ring ${
            mode === 'intersection'
              ? 'bg-panel shadow-yr-raised text-brand'
              : 'text-muted hover:text-ink-soft'
          }`}
          title="All (AND) - Match all of the selected items"
        >
          <svg
            width="14"
            height="12"
            viewBox="0 0 24 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="8"
              cy="8"
              r="5.5"
              stroke={mode === 'intersection' ? 'var(--yr-blue)' : 'var(--yr-line-strong)'}
              strokeWidth="1.5"
              fill="none"
            />
            <circle
              cx="16"
              cy="8"
              r="5.5"
              stroke={mode === 'intersection' ? 'var(--yr-blue)' : 'var(--yr-line-strong)'}
              strokeWidth="1.5"
              fill="none"
            />
            <path
              d="M12 2.8C10.6 4.2 10 5.9 10 8C10 10.1 10.6 11.8 12 13.2C13.4 11.8 14 10.1 14 8C14 5.9 13.4 4.2 12 2.8Z"
              fill={mode === 'intersection' ? 'var(--yr-blue)' : 'var(--yr-line)'}
            />
          </svg>
          <span>All</span>
        </button>
      </div>
    </div>
  );
};

export default VennDiagramToggle;
