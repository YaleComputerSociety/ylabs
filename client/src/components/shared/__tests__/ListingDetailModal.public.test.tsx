import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ConfigContext, { defaultConfigContext } from '../../../contexts/ConfigContext';
import UserContext from '../../../contexts/UserContext';
import ListingDetailModal from '../ListingDetailModal';
import { Listing } from '../../../types/types';

const listing: Listing = {
  id: '507f1f77bcf86cd799439011',
  ownerId: '',
  ownerFirstName: 'Ada',
  ownerLastName: 'Lovelace',
  ownerEmail: '',
  ownerTitle: 'Professor',
  ownerPrimaryDepartment: 'Computer Science',
  professorIds: [],
  professorNames: [],
  title: 'Computing lab',
  departments: ['Computer Science'],
  emails: [],
  websites: [],
  description: 'Research description',
  applicantDescription: '',
  keywords: [],
  researchAreas: ['Algorithms'],
  established: '',
  views: 0,
  favorites: 0,
  hiringStatus: 1,
  archived: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  confirmed: true,
  audited: false,
};

const renderModal = (options: { isAuthenticated?: boolean; onRequireAuth?: () => void } = {}) =>
  render(
    <MemoryRouter>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: options.isAuthenticated || false,
          user: options.isAuthenticated ? ({ userType: 'student' } as any) : undefined,
          checkContext: vi.fn(),
        }}
      >
        <ConfigContext.Provider
          value={{
            ...defaultConfigContext,
            departments: [],
            departmentCategories: [],
            researchAreas: [],
            researchFields: [],
            fieldOrder: [],
            isLoading: false,
            isLoaded: true,
            error: null,
            getDepartmentByAbbr: () => undefined,
            getColorForResearchArea: () => ({
              bg: 'bg-blue-50',
              text: 'text-blue-700',
              border: 'border-blue-100',
            }),
          }}
        >
          <ListingDetailModal
            isOpen
            onClose={vi.fn()}
            listing={listing}
            isFavorite={false}
            onToggleFavorite={vi.fn()}
            onRequireAuth={options.onRequireAuth}
          />
        </ConfigContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

describe('ListingDetailModal public discovery behavior', () => {
  it('prompts login for inquiry instead of rendering redacted mail links', async () => {
    const user = userEvent.setup();
    const onRequireAuth = vi.fn();
    renderModal({ onRequireAuth });

    expect(screen.queryByRole('link', { name: /@/ })).toBeNull();

    await user.click(screen.getAllByRole('button', { name: /sign in to inquire/i })[0]);

    expect(onRequireAuth).toHaveBeenCalledTimes(1);
  });

  it('shows an authenticated fallback when contact fields are redacted', () => {
    renderModal({ isAuthenticated: true });

    expect(screen.queryByRole('link', { name: /@/ })).toBeNull();
    expect(screen.getByText(/contact details unavailable/i)).toBeTruthy();
  });

  it('renders as a named modal dialog and closes on Escape', () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: false,
            user: undefined,
            checkContext: vi.fn(),
          }}
        >
          <ConfigContext.Provider value={defaultConfigContext}>
            <ListingDetailModal
              isOpen
              onClose={onClose}
              listing={{ ...listing, websites: ['example.com'] }}
              isFavorite={false}
              onToggleFavorite={vi.fn()}
              onRequireAuth={vi.fn()}
            />
          </ConfigContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    const dialog = screen.getByRole('dialog', { name: /ada lovelace/i });

    expect(dialog).toHaveFocus();
    expect(screen.getByRole('link', { name: /visit ada lovelace's website/i })).toHaveAttribute(
      'href',
      'https://example.com/',
    );
    expect(screen.getByRole('button', { name: /close listing details/i })).toBeTruthy();

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the opener when the dialog unmounts', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <button type="button">Open listing</button>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: false,
            user: undefined,
            checkContext: vi.fn(),
          }}
        >
          <ConfigContext.Provider value={defaultConfigContext}>
            <ListingDetailModal
              isOpen={false}
              onClose={onClose}
              listing={listing}
              isFavorite={false}
              onToggleFavorite={vi.fn()}
              onRequireAuth={vi.fn()}
            />
          </ConfigContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    const opener = screen.getByRole('button', { name: /open listing/i });
    opener.focus();

    rerender(
      <MemoryRouter>
        <button type="button">Open listing</button>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: false,
            user: undefined,
            checkContext: vi.fn(),
          }}
        >
          <ConfigContext.Provider value={defaultConfigContext}>
            <ListingDetailModal
              isOpen
              onClose={onClose}
              listing={listing}
              isFavorite={false}
              onToggleFavorite={vi.fn()}
              onRequireAuth={vi.fn()}
            />
          </ConfigContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('dialog', { name: /ada lovelace/i })).toHaveFocus();

    rerender(
      <MemoryRouter>
        <button type="button">Open listing</button>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: false,
            user: undefined,
            checkContext: vi.fn(),
          }}
        >
          <ConfigContext.Provider value={defaultConfigContext}>
            <ListingDetailModal
              isOpen={false}
              onClose={onClose}
              listing={listing}
              isFavorite={false}
              onToggleFavorite={vi.fn()}
              onRequireAuth={vi.fn()}
            />
          </ConfigContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: /open listing/i })).toHaveFocus();
  });
});
