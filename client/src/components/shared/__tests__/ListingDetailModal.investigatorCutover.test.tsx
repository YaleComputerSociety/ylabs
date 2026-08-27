import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ConfigContext, { defaultConfigContext } from '../../../contexts/ConfigContext';
import UserContext from '../../../contexts/UserContext';
import ListingDetailModal from '../ListingDetailModal';
import { Listing } from '../../../types/types';

vi.mock('../../../utils/axios', () => ({
  default: { post: vi.fn() },
}));

const listing: Listing = {
  id: '507f1f77bcf86cd799439011',
  ownerId: 'ab123',
  ownerFirstName: 'Ada',
  ownerLastName: 'Lovelace',
  ownerEmail: '',
  ownerTitle: 'Professor',
  ownerPrimaryDepartment: 'Computer Science',
  professorIds: ['cd456'],
  professorNames: ['Grace Hopper'],
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

const renderModal = () =>
  render(
    <MemoryRouter>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: true,
          user: { userType: 'student' } as any,
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
          />
        </ConfigContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

describe('ListingDetailModal investigator hard cutover', () => {
  it('renders investigator names as plain text without any internal /profile link', () => {
    renderModal();

    const investigatorsHeading = screen.getByText('Investigators');
    const investigatorsSection = investigatorsHeading.closest('section') as HTMLElement;

    expect(within(investigatorsSection).getByText('Ada Lovelace')).toBeTruthy();
    expect(within(investigatorsSection).getByText('Grace Hopper')).toBeTruthy();

    const profileLinks = investigatorsSection.querySelectorAll('a[href*="/profile/"]');
    expect(profileLinks.length).toBe(0);
    expect(investigatorsSection.querySelectorAll('a').length).toBe(0);
  });
});
