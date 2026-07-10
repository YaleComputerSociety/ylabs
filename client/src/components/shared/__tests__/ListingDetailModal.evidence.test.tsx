import React from 'react';
import { render, screen } from '@testing-library/react';
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

const renderModal = (listingOverride: Partial<Listing> = {}) =>
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
            listing={{ ...listing, ...listingOverride }}
            isFavorite={false}
            onToggleFavorite={vi.fn()}
          />
        </ConfigContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

describe('ListingDetailModal evidence rail', () => {
  it('shows an empty evidence state when public metadata is unavailable', () => {
    renderModal();

    expect(screen.getByText(/evidence/i)).toBeTruthy();
    expect(screen.getByText(/no source metadata available yet/i)).toBeTruthy();
  });

  it('renders safe source links without showing raw private URL parts', () => {
    renderModal({
      evidence: {
        status: 'available',
        summary: 'Matched from public profile and publication records.',
        confidence: 0.92,
        lastVerifiedAt: '2026-02-03T00:00:00.000Z',
        sources: [
          {
            label: 'OpenAlex work',
            url: 'https://example.edu/path?token=secret#private',
            sourceType: 'Publication',
            lastCheckedAt: '2026-02-01T00:00:00.000Z',
          },
          {
            label: 'Unsafe script',
            url: 'javascript:alert(1)',
          },
        ],
      },
    });

    const link = screen.getByRole('link', { name: /openalex work/i });
    expect(link.getAttribute('href')).toBe('https://example.edu/path');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText(/matched from public profile/i)).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.getByText(/example.edu/i)).toBeTruthy();
    expect(screen.getByText(/unsafe script/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /unsafe script/i })).toBeNull();
    expect(screen.queryByText(/token=secret/i)).toBeNull();
  });

  it('renders loading and error evidence states', () => {
    const { rerender } = renderModal({
      evidence: { status: 'loading', sources: [] },
    });

    expect(screen.getByText(/checking evidence metadata/i)).toBeTruthy();

    rerender(
      <MemoryRouter>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <ConfigContext.Provider value={defaultConfigContext}>
            <ListingDetailModal
              isOpen
              onClose={vi.fn()}
              listing={{ ...listing, evidence: { status: 'error', sources: [] } }}
              isFavorite={false}
              onToggleFavorite={vi.fn()}
            />
          </ConfigContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText(/evidence metadata could not be loaded/i)).toBeTruthy();
  });
});
