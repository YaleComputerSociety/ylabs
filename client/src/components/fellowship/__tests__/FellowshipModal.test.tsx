import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../../contexts/FellowshipSearchContext';
import type { Fellowship } from '../../../types/types';
import FellowshipModal from '../FellowshipModal';

afterEach(() => {
  cleanup();
});

const fellowship: Fellowship = {
  id: 'program-1',
  programCategory: 'FELLOWSHIP',
  title: 'Example Research Travel Award',
  competitionType: 'Closing Soon',
  summary: 'Support for research trips or conference travel.',
  description: '',
  applicationInformation: '',
  eligibility: '',
  restrictionsToUseOfAward: '',
  additionalInformation: '',
  links: [],
  applicationLink: 'https://program.example.edu/apply',
  awardAmount: '',
  isAcceptingApplications: true,
  applicationOpenDate: '2025-09-01T00:00:00.000Z',
  deadline: '2026-05-31T00:00:00.000Z',
  contactName: '',
  contactEmail: 'program-contact@example.edu',
  contactPhone: '',
  contactOffice: '',
  yearOfStudy: ['Master’s Student'],
  termOfAward: ['Summer'],
  purpose: ['Research'],
  globalRegions: ['Africa'],
  citizenshipStatus: ['U.S. citizens are eligible'],
  sourceName: '',
  sourceUrl: '',
  sourceKey: '',
  sourceFingerprint: '',
  sourceLastVerifiedAt: null,
  sourceLastChangedAt: null,
  archived: false,
  audited: false,
  views: 0,
  favorites: 0,
  updatedAt: '2026-05-01T00:00:00.000Z',
  createdAt: '2026-05-01T00:00:00.000Z',
};

const renderModal = () =>
  render(
    <MemoryRouter>
      <FellowshipSearchContext.Provider value={defaultFellowshipSearchContext}>
        <FellowshipModal
          fellowship={fellowship}
          isOpen
          isFavorite={false}
          onClose={vi.fn()}
          toggleFavorite={vi.fn()}
        />
      </FellowshipSearchContext.Provider>
    </MemoryRouter>,
  );

describe('FellowshipModal', () => {
  it('keeps detail actions and filter chips large enough for touch input', () => {
    renderModal();

    expect(
      screen.getByRole('dialog', {
        name: 'Example Research Travel Award',
      }),
    ).toBeTruthy();

    const controls = [
      screen.getByRole('link', { name: 'Apply' }),
      screen.getByRole('link', { name: 'Email contact' }),
      screen.getByRole('button', { name: 'Close' }),
      screen.getByRole('link', { name: 'program-contact@example.edu' }),
      screen.getByRole('button', { name: 'Master’s Student' }),
      screen.getByRole('button', { name: 'Summer' }),
      screen.getByRole('button', { name: 'Research' }),
      screen.getByRole('button', { name: 'Africa' }),
      screen.getByRole('button', { name: 'U.S. citizens are eligible' }),
      screen.getByRole('link', { name: /Apply Now/i }),
    ];

    for (const control of controls) {
      expect(control.className).toContain('min-h-[44px]');
    }
  });
});
