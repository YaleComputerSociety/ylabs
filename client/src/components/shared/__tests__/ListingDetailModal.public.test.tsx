import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

const renderModal = (onRequireAuth = vi.fn()) =>
  render(
    <MemoryRouter>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: false,
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
            onRequireAuth={onRequireAuth}
          />
        </ConfigContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

describe('ListingDetailModal public discovery behavior', () => {
  it('prompts login for inquiry instead of rendering redacted mail links', () => {
    const onRequireAuth = vi.fn();
    renderModal(onRequireAuth);

    expect(screen.queryByRole('link', { name: /@/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /sign in to inquire/i }));

    expect(onRequireAuth).toHaveBeenCalledTimes(1);
  });
});
