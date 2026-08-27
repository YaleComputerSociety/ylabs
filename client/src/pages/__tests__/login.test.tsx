import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextType } from 'react';
import { MemoryRouter } from 'react-router-dom';
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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Login', () => {
  it('uses the default Yale Research context for unknown retired surfaces', () => {
    renderLogin('/old-research-entry');

    expect(screen.getByRole('heading', { name: /continue to yale research/i })).toBeTruthy();
    expect(screen.getByText(/open the research discovery workspace/i)).toBeTruthy();
  });

  it('keeps Programs destination context on the CAS gate', () => {
    renderLogin('/programs');

    expect(
      screen.getByRole('heading', { name: /continue to programs & fellowships/i }),
    ).toBeTruthy();
    expect(screen.getByText(/structured programs, funding cycles, and planning/i)).toBeTruthy();
  });

  it('frames retired listing links as Yale Research', () => {
    renderLogin('/listings');

    expect(screen.getByRole('heading', { name: /continue to yale research/i })).toBeTruthy();
    expect(
      screen.getByText(/save research homes, keep private notes, and reach out/i),
    ).toBeTruthy();
  });

  it('keeps profile context on the CAS gate', () => {
    renderLogin('/profile/example');

    expect(screen.getByRole('heading', { name: /continue to profile/i })).toBeTruthy();
    expect(
      screen.getByText(/view research interests, activity, and yale research context/i),
    ).toBeTruthy();
  });

  it('keeps dashboard context on the CAS gate', () => {
    renderLogin('/dashboard');

    expect(screen.getByRole('heading', { name: /continue to your dashboard/i })).toBeTruthy();
    expect(
      screen.getByText(/manage saved research plans and program planning/i),
    ).toBeTruthy();
  });

  it('keeps about page context on the CAS gate', () => {
    renderLogin('/about');

    expect(screen.getByRole('heading', { name: /continue to about yale research/i })).toBeTruthy();
    expect(screen.getByText(/learn how yale research is built and supported/i)).toBeTruthy();
  });

  it('replaces CAS sign in with retry when auth check fails', async () => {
    const user = userEvent.setup();
    const { checkContext } = renderLogin(undefined, {
      authError: 'Unable to reach Yale Labs right now.',
    });

    expect(screen.getByRole('status').textContent).toContain(
      'Unable to reach Yale Labs right now.',
    );
    expect(screen.queryByRole('link', { name: /sign in with yale cas/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /retry connection/i }));

    expect(checkContext).toHaveBeenCalledTimes(1);
  });
});
