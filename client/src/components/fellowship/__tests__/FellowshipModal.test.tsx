import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  it('makes source-backed research application requirements scannable', () => {
    renderModal({
      researchFocused: true,
      applicationMaterials: ['Research proposal', 'Transcript', 'Faculty mentor support'],
      applicationInformation: 'Submit through the Student Grants Database.',
    });

    expect(screen.getByText('Research-focused')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Application Process' })).toBeTruthy();
    expect(screen.getByText('Research proposal')).toBeTruthy();
    expect(screen.getByText('Faculty mentor support')).toBeTruthy();
    expect(screen.getByText('Submit through the Student Grants Database.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open official application' })).toHaveAttribute(
      'href',
      fellowship.applicationLink,
    );
  });

  it('contains keyboard focus, closes on Escape, and returns focus to the exact trigger', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open program';
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();

    const { rerender } = render(
      <MemoryRouter>
        <FellowshipSearchContext.Provider value={defaultFellowshipSearchContext}>
          <FellowshipModal
            fellowship={fellowship}
            isOpen
            isFavorite={false}
            onClose={onClose}
            toggleFavorite={vi.fn()}
          />
        </FellowshipSearchContext.Provider>
      </MemoryRouter>,
    );

    const dialog = screen.getByRole('dialog', { name: fellowship.title });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: fellowship.title }));
    expect(trigger.inert).toBe(true);
    expect(trigger).toHaveAttribute('aria-hidden', 'true');

    const lastAction = screen.getByRole('link', { name: /Apply Now/i });
    lastAction.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Apply' }));

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastAction);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <MemoryRouter>
        <FellowshipSearchContext.Provider value={defaultFellowshipSearchContext}>
          <FellowshipModal
            fellowship={fellowship}
            isOpen={false}
            isFavorite={false}
            onClose={onClose}
            toggleFavorite={vi.fn()}
          />
        </FellowshipSearchContext.Provider>
      </MemoryRouter>,
    );
    expect(document.activeElement).toBe(trigger);
    expect(trigger.inert).not.toBe(true);
    expect(trigger).not.toHaveAttribute('aria-hidden');
    trigger.remove();
  });

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

  it('drops scraped site nav and footer chrome from the Links section', () => {
    const { container } = renderModal({
      applicationLink: '',
      sourceUrl: '',
      links: [
        { label: 'Campus Life', url: 'https://engineering.yale.edu/campus-life' },
        { label: "Dean's Message", url: 'https://engineering.yale.edu/dean' },
        { label: 'Accessibility >', url: 'https://usability.yale.edu' },
        { label: 'Privacy Policy >', url: 'https://privacy.yale.edu' },
        { label: 'Give Back >', url: 'https://engineering.yale.edu/give' },
        { label: 'Contact Us >', url: 'https://engineering.yale.edu/contact' },
        { label: 'Apply', url: 'https://engineering.yale.edu/apply' },
        {
          label: 'Research Internship Program',
          url: 'https://engineering.yale.edu/undergraduate-study/research-internship-program',
        },
      ],
    });

    expect(screen.queryByRole('link', { name: 'Campus Life' })).toBeNull();
    expect(screen.queryByRole('link', { name: "Dean's Message" })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Privacy Policy >' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Give Back >' })).toBeNull();
    expect(container.querySelector('a[href="https://engineering.yale.edu/apply"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Research Internship Program' })).toHaveAttribute(
      'href',
      'https://engineering.yale.edu/undergraduate-study/research-internship-program',
    );
  });

  it('hides the Links section entirely when the raw set still looks like a page menu', () => {
    renderModal({
      links: Array.from({ length: 12 }, (_unused, index) => ({
        label: `Program resource ${index}`,
        url: `https://example.edu/resource-${index}`,
      })),
    });

    expect(screen.queryByRole('heading', { name: 'Links' })).toBeNull();
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
    const regionDetailLabel = screen.getByText('Regions:');
    expect(regionDetailLabel.parentElement).toHaveTextContent('Regions: Africa');
  });

  it('answers the mentor-first question coherently instead of contradicting itself (#970)', () => {
    renderModal({ requiresMentorBeforeApply: false, mentorMatching: true });

    expect(
      screen.getByText('Not first, the program helps match you with a mentor'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('This source suggests a mentor-matching or mentored program route.'),
    ).toBeNull();
    expect(screen.queryByText('Not usually')).toBeNull();
  });

  it('still tells students to secure a mentor first when the program requires it (#970)', () => {
    renderModal({ requiresMentorBeforeApply: true, mentorMatching: true });

    expect(screen.getByText('Yes, secure a mentor before applying')).toBeInTheDocument();
    expect(
      screen.queryByText('This source suggests a mentor-matching or mentored program route.'),
    ).toBeNull();
  });

  it('falls back to the specific source page and shows legible provenance (#692)', () => {
    const specificSource =
      'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program';
    renderModal({
      applicationLink: '',
      sourceName: 'yale-college-fellowships-office',
      sourceUrl: specificSource,
    });

    expect(screen.getByRole('link', { name: /Apply Now/ })).toHaveAttribute('href', specificSource);
    const provenance = screen.getByRole('link', { name: 'Yale College Fellowships Office' });
    expect(provenance).toHaveAttribute('href', specificSource);
  });
});
