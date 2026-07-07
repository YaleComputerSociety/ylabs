import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../../contexts/FellowshipSearchContext';
import { Fellowship } from '../../../types/types';
import FellowshipModal from '../FellowshipModal';

const futureDate = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const makeFellowship = (overrides: Partial<Fellowship> = {}): Fellowship => ({
  id: 'f-1',
  title: 'Summer research fellowship',
  competitionType: '',
  summary: '',
  description: 'Fellowship description',
  applicationInformation: '',
  eligibility: 'Open to Yale College students.',
  restrictionsToUseOfAward: '',
  additionalInformation: '',
  links: [],
  applicationLink: 'https://example.edu/apply',
  awardAmount: '',
  isAcceptingApplications: true,
  applicationOpenDate: null,
  deadline: futureDate(30),
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  contactOffice: '',
  yearOfStudy: ['Junior'],
  termOfAward: [],
  purpose: [],
  globalRegions: [],
  citizenshipStatus: [],
  archived: false,
  audited: false,
  views: 0,
  favorites: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderModal = (fellowship: Fellowship) => {
  render(
    <MemoryRouter>
      <FellowshipSearchContext.Provider value={defaultFellowshipSearchContext}>
        <FellowshipModal
          fellowship={fellowship}
          isOpen
          onClose={vi.fn()}
          isFavorite={false}
          toggleFavorite={vi.fn()}
        />
      </FellowshipSearchContext.Provider>
    </MemoryRouter>,
  );
};

describe('FellowshipModal', () => {
  it('does not invite students to apply before a future application window opens', () => {
    renderModal(
      makeFellowship({
        isAcceptingApplications: false,
        applicationOpenDate: futureDate(7),
        deadline: futureDate(30),
      }),
    );

    expect(screen.getAllByText('Opens soon').length).toBeGreaterThan(0);
    expect(screen.getByText(/Applications are not open yet/i)).toBeInTheDocument();
    expect(screen.getByText('Track Opening Date').closest('a')).toHaveClass('bg-gray-600');
    expect(screen.queryByRole('link', { name: /Apply Now/i })).not.toBeInTheDocument();
  });

  it('uses Apply Now only when the application window is currently open', () => {
    renderModal(makeFellowship({ applicationOpenDate: null, deadline: futureDate(30) }));

    expect(screen.queryByText(/Applications are not open yet/i)).not.toBeInTheDocument();
    expect(screen.getByText('Apply Now').closest('a')).toHaveClass('bg-blue-600');
  });

  it('does not show missing eligibility copy when purpose metadata is present', () => {
    renderModal(
      makeFellowship({
        eligibility: '',
        yearOfStudy: [],
        purpose: ['Research'],
      }),
    );

    expect(
      screen.queryByText('Eligibility requirements have not been specified.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('See the eligibility filters above for requirements.')).toBeInTheDocument();
  });

  it('does not show missing eligibility copy when region metadata is present', () => {
    renderModal(
      makeFellowship({
        eligibility: '',
        yearOfStudy: [],
        globalRegions: ['Africa'],
      }),
    );

    expect(
      screen.queryByText('Eligibility requirements have not been specified.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('See the eligibility filters above for requirements.')).toBeInTheDocument();
  });
});
