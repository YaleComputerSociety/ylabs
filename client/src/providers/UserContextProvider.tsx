/**
 * Provider component managing user authentication and session state.
 */
import { PropsWithChildren, useCallback, useEffect, useReducer } from 'react';

import axios from '../utils/axios';
import UserContext from '../contexts/UserContext';
import { User } from '../types/types';
import { createInitialUserState, userReducer } from '../reducers/userReducer';

const UserContextProvider = ({ children }: PropsWithChildren) => {
  const [state, dispatch] = useReducer(userReducer, undefined, createInitialUserState);
  const { isLoading, isAuthenticated, user, authError } = state;

  const checkContext = useCallback(() => {
    dispatch({ type: 'FETCH_START' });
    axios
      .get<{ auth: boolean; user?: User }>('/check', { withCredentials: true })
      .then(({ data }) => {
        if (data.auth) {
          dispatch({
            type: 'FETCH_SUCCESS',
            payload: { isAuthenticated: true, user: data.user },
          });
        } else {
          dispatch({
            type: 'FETCH_SUCCESS',
            payload: { isAuthenticated: false },
          });
        }
      })
      .catch((error) => {
        console.error('Auth check failed:', error);
        dispatch({
          type: 'FETCH_FAILURE',
          error: 'Unable to reach Yale Labs right now. Please try again in a moment.',
        });
      });
  }, []);

  useEffect(() => {
    checkContext();
  }, [checkContext]);

  return (
    <UserContext.Provider value={{ isLoading, isAuthenticated, user, authError, checkContext }}>
      {children}
    </UserContext.Provider>
  );
};

export default UserContextProvider;
