import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PublicRoute from '../PublicRoute';
import UserContext from '../../contexts/UserContext';
import type { User } from '../../types/types';

const Protected = () => <div>research content</div>;
const Onboarding = () => <div>onboarding</div>;

const renderPublicRoute = (contextValue: {
  isLoading: boolean;
  isAuthenticated: boolean;
  user?: User;
}) =>
  render(
    <MemoryRouter initialEntries={['/research']}>
      <UserContext.Provider value={{ ...contextValue, checkContext: vi.fn() }}>
        <Routes>
          <Route
            path="/research"
            element={<PublicRoute Component={Protected} unknownBlocked={true} />}
          />
          <Route path="/unknown" element={<Onboarding />} />
        </Routes>
      </UserContext.Provider>
    </MemoryRouter>,
  );

afterEach(cleanup);

describe('PublicRoute', () => {
  it('renders the component for a logged-out visitor', () => {
    renderPublicRoute({ isLoading: false, isAuthenticated: false });

    expect(screen.getByText('research content')).toBeTruthy();
  });

  it('renders the component for a known authenticated user', () => {
    renderPublicRoute({
      isLoading: false,
      isAuthenticated: true,
      user: { userType: 'undergraduate' } as User,
    });

    expect(screen.getByText('research content')).toBeTruthy();
  });

  it('routes an unknown authenticated user to onboarding when unknownBlocked', () => {
    renderPublicRoute({
      isLoading: false,
      isAuthenticated: true,
      user: { userType: 'unknown' } as User,
    });

    expect(screen.getByText('onboarding')).toBeTruthy();
    expect(screen.queryByText('research content')).toBeNull();
  });

  it('shows a loading state while auth resolves', () => {
    renderPublicRoute({ isLoading: true, isAuthenticated: false });

    expect(screen.queryByText('research content')).toBeNull();
  });
});
