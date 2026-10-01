import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Fellowships from '../fellowships';
import FellowshipModal from '../../components/fellowship/FellowshipModal';
import FellowshipSearchContext, {
  FellowshipSearchContextType,
  defaultFellowshipSearchContext,
} from '../../contexts/FellowshipSearchContext';
import UserContext from '../../contexts/UserContext';
import UIContext, { defaultUIContext } from '../../contexts/UIContext';
import type { Fellowship } from '../../types/types';
import axios from '../../utils/axios';
import { expectNoAxeViolations } from '../../testUtils/axe';

vi.mock('../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../components/admin/AdminFellowshipEditModal', () => ({ default: () => null }));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as any;

const baseFellowship = (overrides: Partial<Fellowship> = {}): Fellowship => ({
  id: 'f1',
  title: 'Summer Research Fellowship',
  programCategory: 'FELLOWSHIP',
  programKind: 'FELLOWSHIP_FUNDING',
  entryMode: 'SECURE_MENTOR_THEN_APPLY',
  studentFacingCategory: 'Funding after mentor',
  requiresMentorBeforeApply: true,
  mentorMatching: false,
  undergraduateOnly: true,
  audience: 'UNDERGRADUATE',
  yaleCollegeOnly: true,
  compensationSummary: '',
  hoursPerWeek: null,
  programDates: '',
  bestNextStep: 'Find a mentor before applying.',
  prepSteps: ['Faculty mentor', 'Research proposal'],
  competitionType: 'Fellowship',
  summary: 'Annual funding for undergraduate research projects.',
  description: '',
  applicationInformation: '',
  eligibility: '',
  restrictionsToUseOfAward: '',
  additionalInformation: '',
  links: [{ label: 'Program page', url: 'https://example.edu/fellowship' }],
  applicationLink: 'https://example.edu/apply',
  awardAmount: '',
  isAcceptingApplications: true,
  applicationOpenDate: '2026-01-01T00:00:00.000Z',
  deadline: '2099-06-30T00:00:00.000Z',
  contactName: '',
  contactEmail: 'program-contact@example.edu',
  contactPhone: '',
  contactOffice: '',
  yearOfStudy: ['Junior'],
  termOfAward: ['Summer'],
  purpose: ['Research'],
  globalRegions: [],
  citizenshipStatus: [],
  sourceName: 'Yale',
  sourceUrl: 'https://example.edu/fellowship',
  sourceKey: 'example',
  sourceFingerprint: 'fingerprint',
  sourceLastVerifiedAt: null,
  sourceLastChangedAt: null,
  archived: false,
  audited: false,
  views: 0,
  favorites: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderPage = (
  fellowships: Fellowship[],
  overrides: Partial<FellowshipSearchContextType> = {},
) => {
  mockedAxios.get.mockResolvedValue({ data: { watchedProgramIds: [] } });

  const value: FellowshipSearchContextType = {
    ...defaultFellowshipSearchContext,
    fellowships,
    isLoading: false,
    searchExhausted: true,
    page: 1,
    setPage: vi.fn(),
    pageSize: 500,
    total: fellowships.length,
    ...overrides,
  };

  return render(
    <MemoryRouter initialEntries={['/programs']}>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: true,
          user: { userType: 'student' } as any,
          checkContext: vi.fn(),
        }}
      >
        <UIContext.Provider value={defaultUIContext}>
          <FellowshipSearchContext.Provider value={value}>
            <Fellowships />
          </FellowshipSearchContext.Provider>
        </UIContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('fellowships surface accessibility', () => {
  it('has no serious or critical axe violations for a populated list', async () => {
    const { container } = renderPage([
      baseFellowship(),
      baseFellowship({
        id: 'f2',
        title: 'First-Year Summer Research',
        entryMode: 'APPLY_DIRECTLY',
      }),
    ]);
    await screen.findByText('Summer Research Fellowship');
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations for an empty list', async () => {
    const { container } = renderPage([]);
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations for a failed load', async () => {
    const { container } = renderPage([], { loadError: true, total: 0 });
    await screen.findByRole('alert');
    await expectNoAxeViolations(container);
  });

  it('offers a retry in place of the empty state and the tiles when the load failed', async () => {
    const refreshFellowships = vi.fn();
    renderPage([], { loadError: true, total: 0, refreshFellowships });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load programs and fellowships');
    expect(screen.queryByText('No program records found')).toBeNull();
    expect(screen.queryByText('Open application windows')).toBeNull();
    expect(screen.queryByText(/\d+ results?$/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refreshFellowships).toHaveBeenCalledTimes(1);
  });

  it('has no serious or critical axe violations for the program detail modal', async () => {
    const { container } = render(
      <MemoryRouter>
        <FellowshipSearchContext.Provider value={defaultFellowshipSearchContext}>
          <FellowshipModal
            fellowship={baseFellowship({
              id: 'program-detail',
              title: 'Example Research Travel Award',
              links: [{ label: 'Program page', url: 'https://program.example.edu' }],
            })}
            isOpen
            isFavorite={false}
            onClose={vi.fn()}
            toggleFavorite={vi.fn()}
          />
        </FellowshipSearchContext.Provider>
      </MemoryRouter>,
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await expectNoAxeViolations(container);
  });

  it('has no serious or critical axe violations for department research guidance (#4285)', async () => {
    const guidance = baseFellowship({
      id: 'guidance',
      title: 'Fixture Guidance Page',
      programKind: 'DEPARTMENT_RESEARCH_GUIDE',
      departmentResearchGuidance: true,
      entryMode: 'CONTACT_FACULTY',
      studentFacingCategory: 'Department research guidance',
      requiresMentorBeforeApply: false,
      isAcceptingApplications: false,
      deadline: null,
      sourceUrl: 'https://fixture.yale.edu/undergraduate-research',
    });
    const { container } = renderPage([baseFellowship(), guidance]);
    await screen.findByText('Fixture Guidance Page');
    await expectNoAxeViolations(container);
    cleanup();

    const modal = render(
      <MemoryRouter>
        <FellowshipSearchContext.Provider value={defaultFellowshipSearchContext}>
          <FellowshipModal
            fellowship={guidance}
            isOpen
            isFavorite={false}
            onClose={vi.fn()}
            toggleFavorite={vi.fn()}
          />
        </FellowshipSearchContext.Provider>
      </MemoryRouter>,
    );
    await screen.findByRole('dialog');
    await expectNoAxeViolations(modal.container);
  });
});
