import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../../contexts/FellowshipSearchContext';
import type { Fellowship } from '../../../types/types';
import FellowshipModal from '../FellowshipModal';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const fellowship: Fellowship = {
  id: 'program-1',
  programCategory: 'FELLOWSHIP',
  programKind: 'TRAVEL_RESEARCH_GRANT',
  entryMode: 'SECURE_MENTOR_THEN_APPLY',
  studentFacingCategory: 'Research travel funding',
  requiresMentorBeforeApply: true,
  mentorMatching: false,
  undergraduateOnly: true,
  yaleCollegeOnly: true,
  compensationSummary: 'Travel funding',
  hoursPerWeek: null,
  programDates: 'Summer',
  bestNextStep: 'Confirm a research plan and mentor before applying.',
  prepSteps: ['Research plan', 'Faculty sponsor'],
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

const renderModal = (override: Partial<Fellowship> = {}) =>
  render(
    <MemoryRouter>
      <FellowshipSearchContext.Provider value={defaultFellowshipSearchContext}>
        <FellowshipModal
          fellowship={{ ...fellowship, ...override }}
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

  it('does not render an application action for unsafe application links', () => {
    const { container } = renderModal({ applicationLink: 'javascript:alert(1)' });

    expect(
      screen.getByRole('dialog', {
        name: 'Example Research Travel Award',
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Apply' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Apply Now/i })).toBeNull();
    expect(container.querySelector('a[aria-label="Apply"]')).toBeNull();
    expect(container.querySelector('a[href=""]')).toBeNull();
  });

  it('does not render unsafe supplemental fellowship links', () => {
    const { container } = renderModal({
      links: [{ label: 'Unsafe link', url: 'data:text/html,<script>alert(1)</script>' }],
    });

    expect(screen.queryByText('Unsafe link')).toBeNull();
    expect(container.querySelector('a[href=""]')).toBeNull();
  });

  it('does not render mailto actions for unsafe contact email values', () => {
    const { container } = renderModal({
      contactEmail: 'program-contact@example.edu?bcc=attacker@example.test',
    });

    expect(screen.queryByRole('link', { name: 'Email contact' })).toBeNull();
    expect(screen.queryByText('program-contact@example.edu?bcc=attacker@example.test')).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('does not invite students to apply before a future application window opens', () => {
    renderModal({
      isAcceptingApplications: false,
      applicationOpenDate: '2026-06-01T12:00:00.000Z',
      deadline: '2026-07-01T12:00:00.000Z',
    });

    expect(screen.getByText('Opens Soon')).toBeInTheDocument();
    expect(screen.getByText(/Applications are not open yet/i)).toBeInTheDocument();
    expect(screen.getByText('Track Opening Date').closest('a')).toHaveClass('bg-gray-600');
    expect(screen.queryByText('Apply Now')).not.toBeInTheDocument();
  });

  it('uses Apply Now only while the application window is actually open', () => {
    renderModal({
      isAcceptingApplications: true,
      applicationOpenDate: '2026-05-01T12:00:00.000Z',
      deadline: '2026-07-01T12:00:00.000Z',
    });

    expect(screen.getByText('Apply Now').closest('a')).toHaveClass('bg-blue-600');
    expect(screen.queryByText(/Applications are not open yet/i)).not.toBeInTheDocument();
  });

  it('does not show missing eligibility copy when structured region metadata is present', () => {
    renderModal({
      eligibility: '',
      yearOfStudy: [],
      termOfAward: [],
      purpose: [],
      globalRegions: ['Africa'],
      citizenshipStatus: [],
    });

    expect(screen.queryByText('Eligibility requirements have not been specified.')).toBeNull();
    expect(screen.getByText('See the eligibility filters above for requirements.')).toBeTruthy();
  });
});
