import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Navbar from '../Navbar';
import ConfigContext, { defaultConfigContext } from '../../contexts/ConfigContext';
import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../contexts/FellowshipSearchContext';
import SearchContext, { defaultSearchContext } from '../../contexts/SearchContext';
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
  const searchContext = {
    ...defaultSearchContext,
    selectedListingResearchAreas: [],
    setSelectedListingResearchAreas: vi.fn(),
    allListingResearchAreas: [],
    listingResearchAreasFilterMode: 'union',
    setListingResearchAreasFilterMode: vi.fn(),
  } as any;

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
          <SearchContext.Provider value={searchContext}>
            <FellowshipSearchContext.Provider value={defaultFellowshipSearchContext}>
              <UIContext.Provider value={defaultUIContext}>
                <Navbar />
              </UIContext.Provider>
            </FellowshipSearchContext.Provider>
          </SearchContext.Provider>
        </ConfigContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );
};

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
    expect(primaryNav.contains(screen.getByRole('link', { name: 'Yale Labs' }))).toBe(true);
    expect(primaryNav.contains(screen.getByRole('link', { name: 'Programs & Fellowships' }))).toBe(true);
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

  it('gives professor users direct profile actions from the account menu', () => {
    renderNavbar({ userType: 'professor', netId: 'prof1' });

    fireEvent.click(screen.getByRole('button', { name: 'Open user menu' }));

    expect(screen.getByRole('menuitem', { name: 'Edit Profile' }).getAttribute('href')).toBe('/account');
    expect(screen.getByRole('menuitem', { name: 'Public Profile' }).getAttribute('href')).toBe(
      '/profile/prof1',
    );
  });

  it('keeps a named close-menu control inside the mobile drawer', () => {
    mockIsMobile = true;
    renderNavbar();

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Yale Labs' })).toBeTruthy();
  });
});
