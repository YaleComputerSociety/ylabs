import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import UserContext from '../../contexts/UserContext';
import PrivateRoute from '../PrivateRoute';

const Account = () => <div>Private account</div>;

const Location = () => {
  const location = useLocation();
  return <div>{`${location.pathname}:${String(location.state?.from)}`}</div>;
};

const renderRoute = (isAuthenticated: boolean) =>
  render(
    <UserContext.Provider
      value={{
        isLoading: false,
        isAuthenticated,
        user: isAuthenticated
          ? { userType: 'student', netId: 'student', userConfirmed: true }
          : undefined,
        authError: undefined,
        checkContext: async () => undefined,
      }}
    >
      <MemoryRouter
        initialEntries={['/account']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/account" element={<PrivateRoute Component={Account} />} />
          <Route path="/login" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </UserContext.Provider>,
  );

afterEach(cleanup);

describe('PrivateRoute', () => {
  it('keeps account routes protected and preserves the return path', () => {
    renderRoute(false);

    expect(screen.getByText('/login:/account')).toBeTruthy();
    expect(screen.queryByText('Private account')).toBeNull();
  });

  it('preserves authenticated access to account routes', () => {
    renderRoute(true);

    expect(screen.getByText('Private account')).toBeTruthy();
  });
});
