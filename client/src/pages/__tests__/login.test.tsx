import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextType, useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UserContext from '../../contexts/UserContext';
import Login from '../login';

type UserContextValue = ContextType<typeof UserContext>;

const renderLogin = (from?: string, context: Partial<UserContextValue> = {}) => {
  const checkContext = vi.fn();

  render(
    <UserContext.Provider
      value={{
        isLoading: false,
        isAuthenticated: false,
        user: undefined,
        authError: undefined,
        checkContext,
        ...context,
      }}
    >
      <MemoryRouter initialEntries={[{ pathname: '/login', state: from ? { from } : null }]}>
        <Login />
      </MemoryRouter>
    </UserContext.Provider>,
  );

  return { checkContext };
};

const CurrentLocation = () => {
  const location = useLocation();
  return (
    <p data-testid="current-location">{`${location.pathname}${location.search}${location.hash}`}</p>
  );
};

const RetryHarness = ({ from, userType = 'student' }: { from: unknown; userType?: string }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <UserContext.Provider
      value={{
        isLoading: false,
        isAuthenticated,
        user: isAuthenticated ? ({ userType } as UserContextValue['user']) : undefined,
        authError: isAuthenticated ? undefined : 'Unable to reach y/labs right now.',
        checkContext: () => setIsAuthenticated(true),
      }}
    >
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from } }]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>
    </UserContext.Provider>
  );
};

const retryIntoApp = async (from: unknown, userType?: string) => {
  const user = userEvent.setup();
  render(<RetryHarness from={from} userType={userType} />);
  await user.click(screen.getByRole('button', { name: /retry connection/i }));
  return (await screen.findByTestId('current-location')).textContent;
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Login', () => {
  it('uses the default y/labs context for unknown retired surfaces', () => {
    renderLogin('/old-research-entry');

    expect(screen.getByRole('heading', { name: /continue to y\/labs/i })).toBeTruthy();
    expect(screen.getByText(/open the research discovery workspace/i)).toBeTruthy();
  });

  it('keeps Programs destination context on the CAS gate', () => {
    renderLogin('/programs');

    expect(
      screen.getByRole('heading', { name: /continue to programs & fellowships/i }),
    ).toBeTruthy();
    expect(screen.getByText(/structured programs, funding cycles, and planning/i)).toBeTruthy();
  });

  it('frames retired listing links as y/labs', () => {
    renderLogin('/listings');

    expect(screen.getByRole('heading', { name: /continue to y\/labs/i })).toBeTruthy();
    expect(screen.getByText(/save research, keep private notes, and reach out/i)).toBeTruthy();
  });

  it('falls back to default y/labs context for the retired opportunities route', () => {
    renderLogin('/opportunities/example-id');

    expect(screen.getByRole('heading', { name: /continue to y\/labs/i })).toBeTruthy();
    expect(screen.getByText(/open the research discovery workspace/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /continue to opportunity details/i })).toBeNull();
    expect(
      screen.queryByText(/review the evidence, deadline, and application next step/i),
    ).toBeNull();
  });

  it('keeps dashboard context on the CAS gate', () => {
    renderLogin('/dashboard');

    expect(screen.getByRole('heading', { name: /continue to your dashboard/i })).toBeTruthy();
    expect(screen.getByText(/manage saved research plans and program planning/i)).toBeTruthy();
  });

  it('keeps about page context on the CAS gate', () => {
    renderLogin('/about');

    expect(screen.getByRole('heading', { name: /continue to about y\/labs/i })).toBeTruthy();
    expect(screen.getByText(/learn how y\/labs is built and supported/i)).toBeTruthy();
  });

  it('replaces CAS sign in with retry when auth check fails', async () => {
    const user = userEvent.setup();
    const { checkContext } = renderLogin(undefined, {
      authError: 'Unable to reach y/labs right now.',
    });

    expect(screen.getByRole('status').textContent).toContain('Unable to reach y/labs right now.');
    expect(screen.queryByRole('link', { name: /sign in with yale cas/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /retry connection/i }));

    expect(checkContext).toHaveBeenCalledTimes(1);
  });

  it('lands on the saved destination after a login retry succeeds', async () => {
    expect(await retryIntoApp('/dashboard?tab=programs#watch')).toBe(
      '/dashboard?tab=programs#watch',
    );
  });

  it('prefers the saved destination over the professor dashboard default', async () => {
    expect(await retryIntoApp('/research/example-entity', 'professor')).toBe(
      '/research/example-entity',
    );
  });

  it.each([
    'https://evil.example.test/phish',
    '//evil.example.test/phish',
    '/\\evil.example.test',
    '/%2fevil.example.test',
    'javascript:alert(1)',
  ])('falls back to home for the unsafe saved destination %s', async (from) => {
    expect(await retryIntoApp(from)).toBe('/');
  });

  it('falls back to home when the saved destination is not a string', async () => {
    expect(await retryIntoApp({ pathname: '/dashboard' })).toBe('/');
  });

  it('keeps the professor dashboard default when no destination was saved', async () => {
    expect(await retryIntoApp(undefined, 'professor')).toBe('/dashboard');
  });
});
