import type { ReactNode } from 'react';

interface UndoRemovalBannerProps {
  children: ReactNode;
  onUndo: () => void;
  floating?: boolean;
}

const UndoRemovalBanner = ({ children, onUndo, floating = false }: UndoRemovalBannerProps) => (
  <div
    className={`flex flex-wrap items-center justify-between gap-3 rounded-card border border-line px-4 py-3 ${
      floating ? 'bg-panel shadow-yr-lifted' : 'mb-4 bg-panel-muted'
    }`}
    role="status"
    aria-live="polite"
  >
    <p className="text-sm text-ink-soft">{children}</p>
    <button
      type="button"
      onClick={onUndo}
      className="yr-focus-ring inline-flex min-h-[44px] flex-shrink-0 items-center rounded-control border border-line-brand bg-brand-soft px-3 py-2 text-xs font-semibold text-brand transition-colors hover:bg-panel"
    >
      Undo
    </button>
  </div>
);

export default UndoRemovalBanner;
