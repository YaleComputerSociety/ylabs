/**
 * Provider component managing UI preferences with localStorage persistence.
 */
import { FC, useState, ReactNode } from 'react';
import UIContext, { ViewMode } from '../contexts/UIContext';

interface UIContextProviderProps {
  children: ReactNode;
}

const UIContextProvider: FC<UIContextProviderProps> = ({ children }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  return <UIContext.Provider value={{ viewMode, setViewMode }}>{children}</UIContext.Provider>;
};

export default UIContextProvider;
