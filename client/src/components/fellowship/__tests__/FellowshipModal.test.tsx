import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FellowshipSearchContext, {
  defaultFellowshipSearchContext,
} from '../../../contexts/FellowshipSearchContext';
import type { Fellowship } from '../../../types/types';
import FellowshipModal from '../FellowshipModal';
import { trackResearchEvent } from '../../../utils/researchAnalytics';

vi.mock('../../../utils/researchAnalytics', async () => ({
  ...(await vi.importActual<typeof import('../../../utils/researchAnalytics')>(
    '../../../utils/researchAnalytics',
  )),
  trackResearchEvent: vi.fn(),
}));

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
  audience: 'UNDERGRADUATE',
  yaleCollegeOnly: true,
  compensationSummary: 'Travel funding',
  hoursPerWeek: null,
  programDates: 'Summer',
  bestNextStep: 'Confirm a research plan and mentor before applying.',
  prepSteps: ['Research plan', 'Faculty sponsor'],
  title: 'Example Research Travel Award',
  competitionType: 'Competitive',
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

const LocationProbe = () => {
  const location = useLocation();
  return <span data-testid="current-location">{`${location.pathname}${location.search}`}</span>;
};

const renderModalAt = (path: string, onClose: () => void) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
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

describe('FellowshipModal', () => {
  it('sets every section heading and field label in sentence case, with no internal field names', () => {
    renderModal({ requiresMentorBeforeApply: false, programKind: 'STRUCTURED_PROGRAM' });

    const dialog = screen.getByRole('dialog');
    const labels = [
      ...within(dialog).getAllByRole('heading', { level: 3 }),
      ...dialog.querySelectorAll('span.text-xs'),
    ]
      .map((element) => element.textContent?.trim() || '')
      .filter((text) => /^[A-Z]/.test(text) && text.split(/\s+/).length > 1);
    const titleCased = labels.filter((label) =>
      label
        .split(/\s+/)
        .slice(1)
        .some((word) => /^[A-Z][a-z]/.test(word) && word !== 'Yale'),
    );

    expect(labels.length).toBeGreaterThan(0);
    expect(titleCased).toEqual([]);
    expect(within(dialog).queryByText('Entry mode')).toBeNull();
    expect(within(dialog).queryByText('Program Route')).toBeNull();
  });

  it('leaves the programs page URL to the host when a filter chip closes the modal', () => {
    const onClose = vi.fn();
    renderModalAt('/programs?program=program-1', onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Master’s Student' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('current-location').textContent).toBe('/programs?program=program-1');
  });

  it('opens the programs page when a filter chip is chosen from another page', () => {
    const onClose = vi.fn();
    renderModalAt('/dashboard', onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Master’s Student' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('current-location').textContent).toBe('/programs');
  });

  it('makes source-backed research application requirements scannable', () => {
    renderModal({
      researchFocused: true,
      applicationMaterials: ['Research proposal', 'Transcript', 'Faculty mentor support'],
      applicationInformation: 'Submit through the Student Grants Database.',
    });

    expect(screen.getByText('Research-focused')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Application process' })).toBeTruthy();
    expect(screen.getByText('Research proposal')).toBeTruthy();
    expect(screen.getByText('Faculty mentor support')).toBeTruthy();
    expect(screen.getByText('Submit through the Student Grants Database.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open official application' })).toHaveAttribute(
      'href',
      fellowship.applicationLink,
    );
  });

  it('records one application event per application-link click', () => {
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
    vi.mocked(trackResearchEvent).mockClear();

    fireEvent.click(screen.getByRole('link', { name: /Apply now/i }));

    expect(vi.mocked(trackResearchEvent).mock.calls.map(([event]) => event)).toEqual([
      {
        eventType: 'ways_in_click',
        entityType: 'fellowship',
        entityId: fellowship.id,
        payload: { waysInKind: 'apply', label: 'Apply' },
      },
    ]);
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

    const lastAction = screen.getByRole('link', { name: /Apply now/i });
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
      screen.getByRole('link', { name: /Apply now/i }),
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
    expect(screen.queryByRole('link', { name: /Apply now/i })).toBeNull();
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

    expect(screen.getByText('Opens soon', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/Applications are not open yet/i)).toBeInTheDocument();
    const closedWindowAction = screen.getByText('Track the opening date').closest('a');
    expect(closedWindowAction).toHaveClass('bg-muted');
    expect(closedWindowAction).not.toHaveClass('bg-brand');
    expect(screen.queryByText('Apply now')).not.toBeInTheDocument();
  });

  it('uses Apply now only while the application window is actually open', () => {
    renderModal({
      isAcceptingApplications: true,
      applicationOpenDate: '2026-05-01T12:00:00.000Z',
      deadline: '2026-07-01T12:00:00.000Z',
    });

    expect(screen.getByText('Apply now').closest('a')).toHaveClass('bg-brand');
    expect(screen.queryByText(/Applications are not open yet/i)).not.toBeInTheDocument();
  });

  it('shows the deadline time in New York with an ET label only when the source stated one', () => {
    renderModal({
      isAcceptingApplications: true,
      applicationOpenDate: '2026-05-01T04:00:00.000Z',
      deadline: '2026-07-01T17:00:00.000Z',
    });

    expect(screen.getByText('Jul 1, 2026, 1:00 PM ET')).toBeInTheDocument();
    expect(screen.getByText('May 1, 2026')).toBeInTheDocument();
  });

  it('shows a date-only deadline as its New York date with no time', () => {
    renderModal({
      isAcceptingApplications: true,
      deadline: '2026-07-02T03:59:59.999Z',
    });

    expect(screen.getByText('Jul 1, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/Jul 1, 2026, \d/)).toBeNull();
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

  it('renders a single Description heading when summary duplicates description (#1021)', () => {
    const sharedText =
      'This fellowship supports independent field research across a full summer term. ' +
      'Awardees complete a mentored project and present written findings to the sponsoring office.';
    renderModal({ summary: sharedText, description: sharedText });

    expect(screen.getByRole('heading', { name: 'Description' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Brief description' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Full description' })).toBeNull();
    expect(screen.getByText(sharedText)).toBeTruthy();
  });

  it('treats whitespace-only differences between summary and description as duplicates (#1021)', () => {
    renderModal({
      summary: 'Support for a mentored summer research project.\n \nApplicants present findings.',
      description: 'Support for a mentored summer research project. Applicants present findings.',
    });

    expect(screen.getByRole('heading', { name: 'Description' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Brief description' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Full description' })).toBeNull();
  });

  it('keeps Brief and Full Description headings when the two fields genuinely differ (#1021)', () => {
    renderModal({
      summary: 'A short teaser for the program.',
      description:
        'A much longer description with substantially more detail than the teaser above.',
    });

    expect(screen.getByRole('heading', { name: 'Brief description' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Full description' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Description' })).toBeNull();
  });

  it('gives the source provenance link a 44px target like the other detail links', () => {
    renderModal({
      sourceName: 'example-programs-office',
      sourceUrl: 'https://programs.example.edu/award',
    });

    const provenance = screen.getByRole('link', { name: 'Example Programs Office' });
    expect(provenance.className).toContain('min-h-[44px]');
  });

  it('falls back to the specific source page and shows legible provenance (#692)', () => {
    const specificSource =
      'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program';
    renderModal({
      applicationLink: '',
      sourceName: 'yale-college-fellowships-office',
      sourceUrl: specificSource,
    });

    expect(screen.getByRole('link', { name: /Apply now/ })).toHaveAttribute('href', specificSource);
    const provenance = screen.getByRole('link', { name: 'Yale College Fellowships Office' });
    expect(provenance).toHaveAttribute('href', specificSource);
  });

  it('renders the official-source link when link health is healthy (#1022)', () => {
    const source = 'https://wff.yale.edu/grants-awards/seed-grants/seed-grant-application';
    renderModal({
      sourceName: 'yale-women-faculty-forum',
      sourceUrl: source,
      sourceLinkHealth: { url: source, healthStatus: 'HEALTHY' },
    });

    expect(screen.getByRole('link', { name: 'Yale Women Faculty Forum' })).toHaveAttribute(
      'href',
      source,
    );
  });

  it('drops the official-source link when the stored source url is known dead (#1022)', () => {
    const deadSource = 'https://wff.yale.edu/grants-awards/seed-grants/seed-grant-application';
    renderModal({
      sourceName: 'yale-women-faculty-forum',
      sourceUrl: deadSource,
      sourceLinkHealth: { url: deadSource, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
    });

    expect(screen.queryByRole('link', { name: 'Yale Women Faculty Forum' })).toBeNull();
    expect(screen.getByText('Yale Women Faculty Forum')).toBeTruthy();
  });

  it('does not fall back to a dead source url for the primary apply CTA (#1022)', () => {
    const deadSource = 'https://ypsa.yale.edu/academics/student-research-grants';
    renderModal({
      applicationLink: '',
      sourceName: 'yale-poorvu-center',
      sourceUrl: deadSource,
      sourceLinkHealth: { url: deadSource, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
    });

    expect(screen.queryByRole('link', { name: /Apply now/ })).toBeNull();
    expect(
      screen.queryAllByRole('link').some((node) => node.getAttribute('href') === deadSource),
    ).toBe(false);
  });
});

describe('FellowshipModal for a program whose served deadline is stale (#4363)', () => {
  const officialPage = 'https://funding.example.edu/fixture-award';
  const staleProgram: Partial<Fellowship> = {
    deadlineStale: true,
    deadline: null,
    applicationOpenDate: null,
    isAcceptingApplications: false,
    sourceUrl: officialPage,
  };

  it('points to the official page for the current deadline and shows no date', () => {
    renderModal(staleProgram);
    const dialog = screen.getByRole('dialog');

    const message = within(dialog).getByRole('link', {
      name: 'Check the official page for the current deadline',
    });
    expect(message.getAttribute('href')).toBe(officialPage);
    expect(within(dialog).getAllByText('Dates not confirmed')).toHaveLength(2);
    expect(within(dialog).queryByText('Deadline')).toBeNull();
    expect(within(dialog).queryByText('Application opens')).toBeNull();
    expect(dialog.textContent).not.toMatch(/passed|not currently open|Not accepting|Closed/i);
    expect(dialog.textContent).not.toMatch(/\b20\d\d\b/);
  });

  it('never shows a stated date even when an older client payload still carries one', () => {
    renderModal({ ...staleProgram, deadline: '2019-11-15T23:59:59.999Z' });
    const dialog = screen.getByRole('dialog');

    expect(dialog.textContent).not.toContain('2019');
    expect(dialog.textContent).not.toMatch(/passed/i);
  });

  it('states the message as plain text when the program has no official page link', () => {
    renderModal({ ...staleProgram, sourceUrl: '' });
    const dialog = screen.getByRole('dialog');

    expect(
      within(dialog).getAllByText(/Check the official page for the current deadline/).length,
    ).toBeGreaterThan(0);
    expect(
      within(dialog).queryByRole('link', {
        name: 'Check the official page for the current deadline',
      }),
    ).toBeNull();
  });

  it('labels the bottom action for the official page instead of a closed window', () => {
    renderModal(staleProgram);
    const dialog = screen.getByRole('dialog');

    expect(
      within(dialog).getByText('Check the official page for the current deadline.'),
    ).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: /Open the official page/ })).toBeTruthy();
  });
});
