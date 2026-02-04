import { useContext } from 'react';
import ConfigContext from '../contexts/ConfigContext';

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig must be used within a ConfigContextProvider');
  }
  return context;
};

export default useConfig;
