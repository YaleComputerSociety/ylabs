import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UserContext from '../contexts/UserContext';
import App from '../App';

vi.mock('../pages/home', () => ({
  default: () => <div>Research browse page</div>,
}));

vi.mock('../pages/login', () => ({
  default: () => <div>Login page</div>,
}));

vi.mock('../components/Navbar', () => ({
  default: () => <div />,
}));

vi.mock('../components/Footer', () => ({
  default: () => <div />,
}));

vi.mock('../components/shared/ScrollToTop', () => ({
  default: () => null,
}));

vi.mock('../providers/ConfigContextProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../providers/SearchContextProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../providers/FellowshipSearchContextProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../providers/UIContextProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('public research routes', () => {
  it('lets logged-out visitors open a shared research detail URL', () => {
    window.history.pushState({}, '', '/research/507f1f77bcf86cd799439011');

    render(
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: false,
          checkContext: vi.fn(),
        }}
      >
        <App />
      </UserContext.Provider>,
    );

    expect(screen.getByText('Research browse page')).toBeTruthy();
    expect(screen.queryByText('Login page')).toBeNull();
  });
});
