/**
 * React context for UI preferences (view mode, sidebar state).
 */
import { createContext } from 'react';

export type ViewMode = 'card' | 'list' | 'compact';

export interface UIContextType {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export const defaultUIContext: UIContextType = {
  viewMode: 'card',
  setViewMode: () => {},
};

export default createContext<UIContextType>(defaultUIContext);
