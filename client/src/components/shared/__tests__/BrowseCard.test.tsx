import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BrowseCard from '../BrowseCard';
import BrowseListItem from '../BrowseListItem';
import ConfigContext, { defaultConfigContext } from '../../../contexts/ConfigContext';
import UserContext, { defaultUserContext } from '../../../contexts/UserContext';
import type { BrowsableItem } from '../../../types/browsable';
import type { Fellowship } from '../../../types/types';

vi.mock('../../../utils/axios', () => ({
  default: {
    put: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

afterEach(() => {
  cleanup();
});

const fellowship: Fellowship = {
  id: 'program-1',
  title: 'Summer Research Fellowship',
  programCategory: 'FELLOWSHIP',
  competitionType: 'Fellowship',
  summary: 'Funding for undergraduate research projects.',
  description: '',
  applicationInformation: '',
  eligibility: '',
  restrictionsToUseOfAward: '',
  additionalInformation: '',
  links: [],
  applicationLink: '',
  awardAmount: '',
  isAcceptingApplications: true,
  applicationOpenDate: null,
  deadline: null,
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  contactOffice: '',
  yearOfStudy: [],
  termOfAward: [],
  purpose: [],
  globalRegions: [],
  citizenshipStatus: [],
  sourceName: 'Yale',
  sourceUrl: '',
  sourceKey: 'test',
  sourceFingerprint: 'test',
  sourceLastVerifiedAt: null,
  sourceLastChangedAt: null,
  archived: false,
  audited: false,
  views: 0,
  favorites: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const item: BrowsableItem = {
  type: 'fellowship',
  data: fellowship,
};

const renderAdmin = (children: ReactNode) =>
  render(
    <UserContext.Provider
      value={{
        ...defaultUserContext,
        isLoading: false,
        isAuthenticated: true,
        user: { userType: 'admin' } as any,
      }}
    >
      <ConfigContext.Provider value={defaultConfigContext}>{children}</ConfigContext.Provider>
    </UserContext.Provider>,
  );

describe('Browse admin controls', () => {
  it('keeps card admin edit controls large enough for touch input', () => {
    renderAdmin(
      <BrowseCard item={item} isFavorite={false} onOpenModal={vi.fn()} onAdminEdit={vi.fn()} />,
    );

    const button = screen.getByRole('button', { name: 'Admin edit' });
    expect(button.className).toContain('min-h-[44px]');
    expect(button.className).toContain('min-w-[44px]');
  });

  it('keeps list admin edit controls large enough for touch input', () => {
    renderAdmin(
      <BrowseListItem item={item} isFavorite={false} onOpenModal={vi.fn()} onAdminEdit={vi.fn()} />,
    );

    const button = screen.getByRole('button', { name: 'Admin edit' });
    expect(button.className).toContain('min-h-[44px]');
    expect(button.className).toContain('min-w-[44px]');
  });
});
