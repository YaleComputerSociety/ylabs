import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfigContext, { defaultConfigContext } from '../../../contexts/ConfigContext';
import UserContext from '../../../contexts/UserContext';
import ListingDetailModal from '../ListingDetailModal';
import { Listing } from '../../../types/types';

const postMock = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/axios', () => ({
  default: {
    post: postMock,
  },
}));

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

const renderModal = (
  options: {
    isAuthenticated?: boolean;
    onRequireAuth?: () => void;
    listingOverride?: Partial<Listing>;
  } = {},
) =>
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
            listing={{ ...listing, ...options.listingOverride }}
            isFavorite={false}
            onToggleFavorite={vi.fn()}
            onRequireAuth={options.onRequireAuth}
          />
        </ConfigContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

describe('ListingDetailModal public discovery behavior', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('prompts login for inquiry instead of rendering redacted mail links', () => {
    const onRequireAuth = vi.fn();
    renderModal({ onRequireAuth });

    expect(screen.queryByRole('link', { name: /@/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /sign in to inquire/i }));

    expect(onRequireAuth).toHaveBeenCalledTimes(1);
  });

  it('shows an authenticated fallback when contact fields are redacted', () => {
    renderModal({ isAuthenticated: true });

    expect(screen.queryByRole('link', { name: /@/ })).toBeNull();
    expect(screen.getByText(/contact details unavailable/i)).toBeTruthy();
  });

  it('records a privacy-safe contact attempt and outcome for authenticated email clicks', async () => {
    postMock.mockResolvedValue({ data: {} });
    renderModal({
      isAuthenticated: true,
      listingOverride: {
        ownerEmail: 'ada@yale.edu',
        emails: ['lab@yale.edu'],
      },
    });

    const emailLink = screen.getByRole('link', { name: /ada@yale.edu/i });
    emailLink.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(emailLink);

    expect(postMock).toHaveBeenCalledWith(
      '/listings/507f1f77bcf86cd799439011/outreach',
      {
        action: 'email_click',
        outcome: undefined,
        source: 'listing_detail_modal',
      },
      { withCredentials: true },
    );
    expect(JSON.stringify(postMock.mock.calls)).not.toContain('ada@yale.edu');

    fireEvent.click(screen.getByRole('button', { name: /emailed/i }));

    await screen.findByText(/outcome saved/i);
    expect(postMock).toHaveBeenLastCalledWith(
      '/listings/507f1f77bcf86cd799439011/outreach',
      {
        action: 'outcome',
        outcome: 'emailed',
        source: 'listing_detail_modal',
      },
      { withCredentials: true },
    );
  });
});
