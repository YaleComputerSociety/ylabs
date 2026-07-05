/**
 * React context for current user authentication state.
 */
import { createContext } from 'react';

import { User } from '../types/types';

export const defaultUserContext = {
  isLoading: true,
  isAuthenticated: false,
  authError: undefined,
  checkContext: () => {},
};

export default createContext<{
  isLoading: boolean;
  isAuthenticated: boolean;
  user?: User;
  authError?: string;
  checkContext: () => void;
}>(defaultUserContext);
