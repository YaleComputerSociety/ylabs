import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AdminRoute from '../AdminRoute';
import UserContext from '../../contexts/UserContext';
import type { User } from '../../types/types';

const AnalyticsPage = () => <div>analytics content</div>;

const LoginProbe = () => {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? 'none';
  return <div>login page from {from}</div>;
};

const BackButton = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      Browser back
    </button>
  );
};

const renderAdminRoute = (contextValue: {
  isLoading: boolean;
  isAuthenticated: boolean;
  user?: User;
}) =>
  render(
    <MemoryRouter initialEntries={['/previous', '/analytics?range=7d#funnel']} initialIndex={1}>
      <UserContext.Provider value={{ ...contextValue, checkContext: vi.fn() }}>
        <BackButton />
        <Routes>
          <Route path="/previous" element={<div>previous page</div>} />
          <Route path="/analytics" element={<AdminRoute Component={AnalyticsPage} />} />
          <Route path="/login" element={<LoginProbe />} />
          <Route path="/" element={<div>home page</div>} />
        </Routes>
      </UserContext.Provider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.stubEnv('DEV', false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('AdminRoute', () => {
  it('sends a signed-out visitor to login with the admin page as the return path', () => {
    renderAdminRoute({ isLoading: false, isAuthenticated: false });

    expect(screen.getByText('login page from /analytics?range=7d#funnel')).toBeTruthy();
    expect(screen.queryByText('analytics content')).toBeNull();
  });

  it('replaces the admin entry so Back leaves login instead of looping through it', async () => {
    renderAdminRoute({ isLoading: false, isAuthenticated: false });

    await userEvent.click(screen.getByRole('button', { name: 'Browser back' }));

    expect(screen.getByText('previous page')).toBeTruthy();
  });

  it('replaces the admin entry when a signed-in non-admin is sent home', async () => {
    renderAdminRoute({
      isLoading: false,
      isAuthenticated: true,
      user: { userType: 'undergraduate', isAdmin: false } as User,
    });

    expect(screen.getByText('home page')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Browser back' }));

    expect(screen.getByText('previous page')).toBeTruthy();
  });

  it('renders the admin page for an admin', () => {
    renderAdminRoute({
      isLoading: false,
      isAuthenticated: true,
      user: { userType: 'undergraduate', isAdmin: true } as User,
    });

    expect(screen.getByText('analytics content')).toBeTruthy();
  });
});
