import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UserContext from '../../contexts/UserContext';
import UserButton from '../UserButton';

const originalLocation = window.location;

const renderUserButton = () =>
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <UserContext.Provider
        value={{
          user: { netId: 'abc123', userType: 'student' },
          isAuthenticated: true,
          isLoading: false,
          refreshUser: vi.fn(),
        } as any}
      >
        <UserButton />
      </UserContext.Provider>
    </MemoryRouter>,
  );

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

describe('UserButton', () => {
  it('navigates logout through the safe API URL builder', () => {
    vi.stubEnv('VITE_APP_SERVER', 'https://api.example.test/api');
    const locationMock = {
      ...originalLocation,
      pathname: '/programs',
      origin: 'https://app.example.test',
      href: 'https://app.example.test/programs',
    };
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationMock,
    });

    renderUserButton();

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /logout/i }));

    expect(window.location.href).toBe('https://api.example.test/api/logout');
    expect(sessionStorage.getItem('logoutReturnPath')).toBe('/programs');
    expect(localStorage.getItem('logoutReturnPath')).toBeNull();
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

    renderUserButton();

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /logout/i }));

    expect(window.location.href).toBe('https://api.example.test/api/logout');
    expect(sessionStorage.getItem('logoutReturnPath')).toBeNull();
  });
});
