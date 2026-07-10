import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SignOutButton from '../SignOutButton';

const originalLocation = window.location;

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllEnvs();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

describe('SignOutButton', () => {
  it('navigates to logout through the safe API URL builder', () => {
    vi.stubEnv('VITE_APP_SERVER', 'https://api.example.test/api');
    const locationMock = {
      ...originalLocation,
      pathname: '/research',
      origin: 'https://app.example.test',
      href: 'https://app.example.test/research',
    };
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationMock,
    });

    render(<SignOutButton />);

    fireEvent.click(screen.getByRole('button', { name: /logout/i }));

    expect(window.location.href).toBe('https://api.example.test/api/logout');
    expect(sessionStorage.getItem('logoutReturnPath')).toBe('/research');
    expect(localStorage.getItem('logoutReturnPath')).toBeNull();
  });

  it('falls back to the local API origin when VITE_APP_SERVER is unsafe', () => {
    vi.stubEnv('VITE_APP_SERVER', 'javascript:alert(1)');
    const locationMock = {
      ...originalLocation,
      pathname: '/account',
      origin: 'http://localhost:3000',
      href: 'http://localhost:3000/account',
    };
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationMock,
    });

    render(<SignOutButton />);

    fireEvent.click(screen.getByRole('button', { name: /logout/i }));

    expect(window.location.href).toBe('http://localhost:4000/api/logout');
  });

  it('does not persist oversized logout return paths', () => {
    vi.stubEnv('VITE_APP_SERVER', 'https://api.example.test/api');
    const locationMock = {
      ...originalLocation,
      pathname: `/${'a'.repeat(2048)}`,
      origin: 'https://app.example.test',
      href: `https://app.example.test/${'a'.repeat(2048)}`,
    };
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationMock,
    });

    render(<SignOutButton />);

    fireEvent.click(screen.getByRole('button', { name: /logout/i }));

    expect(window.location.href).toBe('https://api.example.test/api/logout');
    expect(sessionStorage.getItem('logoutReturnPath')).toBeNull();
  });
});
