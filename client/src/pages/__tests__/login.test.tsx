import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UserContext from '../../contexts/UserContext';
import Login from '../login';

afterEach(() => {
  cleanup();
});

const renderLogin = (context: Partial<React.ContextType<typeof UserContext>> = {}) => {
  const checkContext = vi.fn();

  render(
    <MemoryRouter>
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
        <Login />
      </UserContext.Provider>
    </MemoryRouter>,
  );

  return { checkContext };
};

describe('Login', () => {
  it('shows Yale CAS sign in when auth is available', () => {
    renderLogin();

    expect(screen.getByRole('link', { name: /sign in with yale cas/i })).toBeTruthy();
  });

  it('replaces CAS sign in with retry when auth check fails', async () => {
    const user = userEvent.setup();
    const { checkContext } = renderLogin({
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
