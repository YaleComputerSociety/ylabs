/**
 * Provider component managing user authentication and session state.
 */
import { FC, useCallback, useEffect, useReducer } from 'react';
import swal from 'sweetalert';

import axios from '../utils/axios';
import UserContext from '../contexts/UserContext';
import { User } from '../types/types';
import { createInitialUserState, userReducer } from '../reducers/userReducer';

const UserContextProvider: FC = ({ children }) => {
  const [state, dispatch] = useReducer(userReducer, undefined, createInitialUserState);
  const { isLoading, isAuthenticated, user } = state;

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
        dispatch({ type: 'LOGOUT' });
        dispatch({ type: 'FETCH_FAILURE' });

        swal({
          text: 'Something went wrong while checking authentication status.',
          icon: 'warning',
        });
      });
  }, []);

  useEffect(() => {
    checkContext();
  }, [checkContext]);

  return (
    <UserContext.Provider value={{ isLoading, isAuthenticated, user, checkContext }}>
      {children}
    </UserContext.Provider>
  );
};

export default UserContextProvider;
