import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SignInButton from '../SignInButton';

const renderSignInButton = (state?: { from?: string }) =>
  render(
    <MemoryRouter
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      initialEntries={[{ pathname: '/login', state }]}
    >
      <SignInButton />
    </MemoryRouter>,
  );

const signInHref = () =>
  screen.getByRole('link', { name: /sign in with yale cas/i }).getAttribute('href') || '';

const signInLink = () => screen.getByRole('link', { name: /sign in with yale cas/i });

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllEnvs();
});

describe('SignInButton', () => {
  it('preserves the requested route in the CAS redirect', async () => {
    renderSignInButton({ from: '/research?topic=ai' });

    await waitFor(() => {
      expect(signInHref()).toContain(
        `redirect=${encodeURIComponent(`${window.location.origin}/research?topic=ai`)}`,
      );
    });
  });

  it('prefers the saved logout return path and clears it', async () => {
    localStorage.setItem('logoutReturnPath', '/programs');

    renderSignInButton({ from: '/research' });

    await waitFor(() => {
      expect(signInHref()).toContain(
        `redirect=${encodeURIComponent(`${window.location.origin}/programs`)}`,
      );
    });
    expect(localStorage.getItem('logoutReturnPath')).toBeNull();
  });

  it('renders a 44px minimum target for the CAS link', () => {
    renderSignInButton();

    expect(signInLink().className).toContain('min-h-[44px]');
  });

  it('does not duplicate the api prefix when the configured server already includes it', () => {
    vi.stubEnv('VITE_APP_SERVER', 'http://localhost:4000/api');

    renderSignInButton();

    expect(signInHref()).toBe('http://localhost:4000/api/cas');
  });
});
