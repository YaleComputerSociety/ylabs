/**
 * Provider component managing user authentication and session state.
 */
import { PropsWithChildren, useCallback, useEffect, useReducer } from 'react';

import axios from '../utils/axios';
import UserContext from '../contexts/UserContext';
import { User } from '../types/types';
import { createInitialUserState, userReducer } from '../reducers/userReducer';
import { setResearchAnalyticsEnabled } from '../utils/researchAnalytics';
import { rememberSignedIn } from '../utils/lastKnownSession';
import { HTTP_AUTH_REQUIRED_EVENT } from '../utils/httpStatusEvents';

const UserContextProvider = ({ children }: PropsWithChildren) => {
  const [state, dispatch] = useReducer(userReducer, undefined, createInitialUserState);
  const { isLoading, isAuthenticated, user, authError } = state;

  const checkContext = useCallback(() => {
    dispatch({ type: 'FETCH_START' });
    axios
      .get<{ auth: boolean; user?: User }>('/check', { withCredentials: true })
      .then(({ data }) => {
        setResearchAnalyticsEnabled(data.auth === true);
        rememberSignedIn(data.auth === true);
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
      .catch(() => {
        console.error('Auth check failed.');
        setResearchAnalyticsEnabled(false);
        dispatch({
          type: 'FETCH_FAILURE',
          error: 'Unable to reach y/labs right now. Please try again in a moment.',
        });
      });
  }, []);

  useEffect(() => {
    checkContext();
  }, [checkContext]);

  useEffect(() => {
    const onAuthRequired = () => {
      setResearchAnalyticsEnabled(false);
      rememberSignedIn(false);
      dispatch({ type: 'LOGOUT' });
    };
    window.addEventListener(HTTP_AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(HTTP_AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  return (
    <UserContext.Provider value={{ isLoading, isAuthenticated, user, authError, checkContext }}>
      {children}
    </UserContext.Provider>
  );
};

export default UserContextProvider;
