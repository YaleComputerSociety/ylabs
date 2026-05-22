import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import UserContext from '../../contexts/UserContext';
import Login from '../login';

const renderLogin = (from?: string) =>
  render(
    <UserContext.Provider
      value={{
        isLoading: false,
        isAuthenticated: false,
        checkContext: () => {},
      }}
    >
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[{ pathname: '/login', state: from ? { from } : null }]}
      >
        <Login />
      </MemoryRouter>
    </UserContext.Provider>,
  );

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Login', () => {
  it('routes retired Pathways context to Yale Labs on the CAS gate', () => {
    renderLogin('/pathways');

    expect(screen.getByRole('heading', { name: /continue to yale labs/i })).toBeTruthy();
    expect(
      screen.getByText(/browse labs, evidence, and possible ways in/i),
    ).toBeTruthy();
  });

  it('keeps Programs destination context on the CAS gate', () => {
    renderLogin('/programs');

    expect(screen.getByRole('heading', { name: /continue to programs & fellowships/i })).toBeTruthy();
    expect(screen.getByText(/structured programs, funding cycles, and planning/i)).toBeTruthy();
  });

  it('frames retired listing links as Yale Labs', () => {
    renderLogin('/listings');

    expect(screen.getByRole('heading', { name: /continue to yale labs/i })).toBeTruthy();
    expect(screen.getByText(/browse research homes, evidence, and source-backed profiles/i)).toBeTruthy();
  });

  it('keeps opportunity detail context on the CAS gate', () => {
    renderLogin('/opportunities/example-id');

    expect(screen.getByRole('heading', { name: /continue to opportunity details/i })).toBeTruthy();
    expect(screen.getByText(/review the evidence, deadline, and application next step/i)).toBeTruthy();
  });

  it('keeps profile context on the CAS gate', () => {
    renderLogin('/profile/example');

    expect(screen.getByRole('heading', { name: /continue to profile/i })).toBeTruthy();
    expect(screen.getByText(/view research interests, activity, and yale research context/i)).toBeTruthy();
  });

  it('keeps account context on the CAS gate', () => {
    renderLogin('/account');

    expect(screen.getByRole('heading', { name: /continue to your account/i })).toBeTruthy();
    expect(screen.getByText(/manage saved research plans, profile details, and program planning/i)).toBeTruthy();
  });

  it('keeps about page context on the CAS gate', () => {
    renderLogin('/about');

    expect(screen.getByRole('heading', { name: /continue to about yale research/i })).toBeTruthy();
    expect(screen.getByText(/learn how yale research is built and supported/i)).toBeTruthy();
  });
});
