import { cleanup, render, waitFor } from '@testing-library/react';
import type { FunctionComponent, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../App';

vi.mock('../components/PrivateRoute', () => ({
  default: ({ Component }: { Component: FunctionComponent }) => <Component />,
}));

vi.mock('../components/AdminRoute', () => ({
  default: ({ Component }: { Component: FunctionComponent }) => <Component />,
}));

vi.mock('../components/UnprivateRoute', () => ({
  default: ({ Component }: { Component: FunctionComponent }) => <Component />,
}));

vi.mock('../components/Navbar', () => ({
  default: () => null,
}));

vi.mock('../components/Footer', () => ({
  default: () => null,
}));

vi.mock('../components/shared/ScrollToTop', () => ({
  default: () => null,
}));

vi.mock('../providers/ConfigContextProvider', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../providers/SearchContextProvider', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../providers/FellowshipSearchContextProvider', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../providers/UIContextProvider', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../pages/research', () => ({
  default: () => <div data-testid="research-page">Yale Research</div>,
}));

vi.mock('../pages/fellowships', () => ({
  default: () => <div data-testid="programs-page">Programs & Fellowships</div>,
}));
vi.mock('../pages/labDetail', () => ({ default: () => null }));
vi.mock('../pages/opportunityDetail', () => ({ default: () => null }));
vi.mock('../pages/login', () => ({ default: () => null }));
vi.mock('../pages/about', () => ({ default: () => null }));
vi.mock('../pages/account', () => ({ default: () => null }));
vi.mock('../pages/profile', () => ({ default: () => null }));
vi.mock('../pages/unknown', () => ({ default: () => null }));
vi.mock('../pages/loginError', () => ({ default: () => null }));
vi.mock('../pages/analytics', () => ({ default: () => null }));
vi.mock('../pages/notFound', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

describe('App routing', () => {
  it('opts into React Router v7 route semantics without future-flag warnings', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<App />);

    const futureWarnings = warnSpy.mock.calls.filter(([message]) =>
      String(message).includes('React Router Future Flag Warning'),
    );
    expect(futureWarnings).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('retires the legacy listings board route by redirecting /listings to /research', async () => {
    window.history.pushState({}, '', '/listings');

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/research');
    });
  });

  it('renders Yale Research at /research', async () => {
    window.history.pushState({}, '', '/research');

    const { getByTestId } = render(<App />);

    expect(getByTestId('research-page').textContent).toBe('Yale Research');
  });

  it('renders Programs & Fellowships at /programs', async () => {
    window.history.pushState({}, '', '/programs');

    const { getByTestId } = render(<App />);

    expect(getByTestId('programs-page').textContent).toBe('Programs & Fellowships');
  });

  it('redirects retired /fellowships URLs to /programs', async () => {
    window.history.pushState({}, '', '/fellowships');

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/programs');
    });
  });

  it('redirects retired /pathways URLs to /research', async () => {
    window.history.pushState({}, '', '/pathways');

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/research');
    });
  });
});
