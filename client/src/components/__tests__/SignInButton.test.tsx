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
  sessionStorage.clear();
  vi.unstubAllEnvs();
});

describe('SignInButton', () => {
  it('preserves the requested route in the CAS redirect', async () => {
    renderSignInButton({ from: '/research?topic=ai' });

    await waitFor(() => {
      expect(signInHref()).toContain(`redirect=${encodeURIComponent('/research?topic=ai')}`);
    });
  });

  it('prefers the saved logout return path and clears it', async () => {
    sessionStorage.setItem('logoutReturnPath', '/programs');

    renderSignInButton({ from: '/research' });

    await waitFor(() => {
      expect(signInHref()).toContain(`redirect=${encodeURIComponent('/programs')}`);
    });
    expect(sessionStorage.getItem('logoutReturnPath')).toBeNull();
  });

  it('normalizes same-origin absolute return targets to path-only CAS redirects', async () => {
    sessionStorage.setItem('logoutReturnPath', `${window.location.origin}/account#plans`);

    renderSignInButton();

    await waitFor(() => {
      expect(signInHref()).toContain(`redirect=${encodeURIComponent('/account#plans')}`);
    });
    expect(sessionStorage.getItem('logoutReturnPath')).toBeNull();
  });

  it('drops external or ambiguous return targets before building the CAS redirect', async () => {
    sessionStorage.setItem('logoutReturnPath', 'https://evil.example.test/phish');

    renderSignInButton({ from: '/research' });

    await waitFor(() => {
      expect(signInHref()).toBe('http://localhost:4000/api/cas');
    });
    expect(sessionStorage.getItem('logoutReturnPath')).toBeNull();
  });

  it('drops oversized saved logout return paths before building the CAS redirect', async () => {
    sessionStorage.setItem('logoutReturnPath', `/${'a'.repeat(2049)}`);

    renderSignInButton({ from: '/research' });

    await waitFor(() => {
      expect(signInHref()).toBe('http://localhost:4000/api/cas');
    });
    expect(sessionStorage.getItem('logoutReturnPath')).toBeNull();
  });

  it('clears legacy durable logout return paths without using them', async () => {
    localStorage.setItem('logoutReturnPath', '/account?private=1');

    renderSignInButton({ from: '/research' });

    await waitFor(() => {
      expect(signInHref()).toContain(`redirect=${encodeURIComponent('/research')}`);
    });
    expect(localStorage.getItem('logoutReturnPath')).toBeNull();
    expect(sessionStorage.getItem('logoutReturnPath')).toBeNull();
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
