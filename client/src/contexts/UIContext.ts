import { createContext } from 'react';

export type ViewMode = 'card' | 'list';

export interface UIContextType {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export const defaultUIContext: UIContextType = {
  viewMode: 'card',
  setViewMode: () => {},
};

export default createContext<UIContextType>(defaultUIContext);
