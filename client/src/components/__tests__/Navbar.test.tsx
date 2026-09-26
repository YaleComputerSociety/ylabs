import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Navbar from '../Navbar';
import ConfigContext, { defaultConfigContext } from '../../contexts/ConfigContext';
import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../contexts/FellowshipSearchContext';
import UIContext, { defaultUIContext } from '../../contexts/UIContext';
import UserContext from '../../contexts/UserContext';

vi.mock('@mui/material/useMediaQuery', () => ({
  default: () => mockIsMobile,
}));

let mockIsMobile = false;

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock as any;

const renderNavbar = (user: any = { userType: 'student' }) => {
  return render(
    <MemoryRouter initialEntries={['/programs']}>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: true,
          user,
          checkContext: vi.fn(),
        }}
      >
        <ConfigContext.Provider value={defaultConfigContext}>
          <FellowshipSearchContext.Provider value={defaultFellowshipSearchContext}>
            <UIContext.Provider value={defaultUIContext}>
              <Navbar />
            </UIContext.Provider>
          </FellowshipSearchContext.Provider>
        </ConfigContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );
};

const renderGuestNavbar = (initialPath = '/research') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: false,
          user: undefined,
          checkContext: vi.fn(),
        }}
      >
        <ConfigContext.Provider value={defaultConfigContext}>
          <FellowshipSearchContext.Provider value={defaultFellowshipSearchContext}>
            <UIContext.Provider value={defaultUIContext}>
              <Navbar />
            </UIContext.Provider>
          </FellowshipSearchContext.Provider>
        </ConfigContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockIsMobile = false;
});

describe('Navbar', () => {
  it('keeps desktop primary navigation in the toolbar flow without fellowship browse controls', () => {
    renderNavbar();

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(primaryNav.closest('.MuiToolbar-root')).toBeTruthy();
    expect(within(primaryNav).getByRole('link', { name: 'Research' })).toBeTruthy();
    expect(within(primaryNav).getByRole('link', { name: 'Programs & Fellowships' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Find Pathways' })).toBeNull();
    expect(screen.queryByPlaceholderText('Search programs and fellowships...')).toBeNull();
    expect(screen.queryByRole('button', { name: /filters/i })).toBeNull();
    expect(screen.queryByText(/Sort:/)).toBeNull();
  });

  it('keeps desktop primary navigation links at the WCAG 2.5.8 target minimum', () => {
    renderNavbar();

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const links = Array.from(primaryNav.querySelectorAll('a'));

    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => {
      expect(link.className).toContain('min-h-[44px]');
    });
  });

  it('shows exactly one desktop analytics dashboard link for admin users', () => {
    renderNavbar({ userType: 'admin', netId: 'devadmin', isAdmin: true });

    const analyticsLinks = screen.getAllByRole('link', { name: 'Analytics' });
    expect(analyticsLinks).toHaveLength(1);
    const [analyticsLink] = analyticsLinks;
    expect(analyticsLink.getAttribute('href')).toBe('/analytics');
    expect(analyticsLink.closest('.MuiToolbar-root')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open user menu' }));

    expect(screen.queryByRole('menuitem', { name: 'Analytics' })).toBeNull();
  });

  it('does not show analytics navigation for student users', () => {
    renderNavbar({ userType: 'student', netId: 'student1' });

    expect(screen.queryByRole('link', { name: 'Analytics' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open user menu' }));

    expect(screen.queryByRole('menuitem', { name: 'Analytics' })).toBeNull();
  });

  it('does not surface a faculty public-profile link for professor users', () => {
    renderNavbar({ userType: 'professor', netId: 'prof1' });

    fireEvent.click(screen.getByRole('button', { name: 'Open user menu' }));

    expect(screen.queryByRole('menuitem', { name: 'Public Profile' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Edit Profile' })).toBeNull();
  });

  it('gives logged-out visitors public research/about nav and a sign-in link', () => {
    renderGuestNavbar();

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(primaryNav).getByRole('link', { name: 'Research' }).getAttribute('href')).toBe(
      '/research',
    );
    expect(within(primaryNav).getByRole('link', { name: 'About' }).getAttribute('href')).toBe(
      '/about',
    );
    expect(within(primaryNav).queryByRole('link', { name: 'Programs & Fellowships' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByRole('button', { name: 'Open user menu' })).toBeNull();
  });

  it('keeps a named close-menu control inside the mobile drawer', () => {
    mockIsMobile = true;
    renderNavbar();

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Research' })).toBeTruthy();
  });
});
