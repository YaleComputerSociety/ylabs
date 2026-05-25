import { cleanup, render } from '@testing-library/react';
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

vi.mock('../pages/home', () => ({ default: () => null }));
vi.mock('../pages/research', () => ({ default: () => null }));
vi.mock('../pages/fellowships', () => ({
  default: () => <div data-testid="programs-page">Programs & Fellowships</div>,
}));
vi.mock('../pages/labDetail', () => ({ default: () => null }));
vi.mock('../pages/pathways', () => ({ default: () => null }));
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

describe('App program routing', () => {
  it('renders the programs page at /programs', () => {
    window.history.pushState({}, '', '/programs');

    const { getByTestId } = render(<App />);

    expect(getByTestId('programs-page').textContent).toBe('Programs & Fellowships');
  });

  it('keeps /fellowships as a legacy alias for the programs page', () => {
    window.history.pushState({}, '', '/fellowships');

    const { getByTestId } = render(<App />);

    expect(getByTestId('programs-page').textContent).toBe('Programs & Fellowships');
  });
});
