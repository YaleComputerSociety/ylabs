import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import ProgramWatch from '../ProgramWatch';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('sweetalert', () => ({ default: vi.fn() }));

vi.mock('../../../utils/researchAnalytics', () => ({
  trackResearchEvent: vi.fn(),
  createResearchAnalyticsInteractionId: () => 'test-interaction',
}));

vi.mock('../shared/LoadingSpinner', () => ({ default: () => <div>Loading</div> }));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const withWatchedPrograms = () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/watchedProgramIds') {
      return Promise.resolve({ data: { watchedProgramIds: ['p1', 'p2'] } });
    }
    if (url === '/users/watchedPrograms') {
      return Promise.resolve({
        data: {
          watchedPrograms: [
            {
              _id: 'p1',
              id: 'p1',
              title: 'Summer Research Grant',
              deadline: '2099-06-30T00:00:00.000Z',
              isAcceptingApplications: true,
              eligibility: 'Undergraduates',
            },
            {
              _id: 'p2',
              id: 'p2',
              title: 'Travel Fellowship',
              isAcceptingApplications: false,
              eligibility: 'Seniors',
            },
          ],
        },
      });
    }
    if (url === '/users/watchedProgramPlans') {
      return Promise.resolve({
        data: {
          watchedProgramPlans: {
            p1: { privateNotes: 'Ask about housing', stage: 'SAVED' },
            p2: { privateNotes: '', stage: 'APPLIED' },
          },
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProgramWatch', () => {
  it('renders watched programs with their note and reports the summary', async () => {
    withWatchedPrograms();
    const onSummaryChange = vi.fn();

    render(
      <MemoryRouter>
        <ProgramWatch onSummaryChange={onSummaryChange} />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    expect(screen.getByText('Travel Fellowship')).toBeTruthy();
    expect(screen.getByText('Note: Ask about housing')).toBeTruthy();
    await waitFor(() =>
      expect(onSummaryChange).toHaveBeenCalledWith(
        expect.objectContaining({
          count: 2,
          nextDeadlineLabel: expect.stringContaining('Summer Research Grant'),
        }),
      ),
    );
  });

  it('persists an edited note to the canonical program plan on blur', async () => {
    withWatchedPrograms();
    mockedAxios.put.mockResolvedValue({ data: { watchedProgramPlans: {} } });

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Travel Fellowship');
    fireEvent.click(screen.getByRole('button', { name: 'Add note for Travel Fellowship' }));
    const note = screen.getByRole('textbox', { name: 'Note for Travel Fellowship' });
    fireEvent.change(note, { target: { value: 'Apply before spring' } });
    fireEvent.blur(note);

    await waitFor(() =>
      expect(mockedAxios.put).toHaveBeenCalledWith('/users/watchedProgramPlans/p2', {
        data: { plan: { privateNotes: 'Apply before spring' } },
      }),
    );
    expect(await screen.findByText('Saved', { selector: 'p' })).toBeTruthy();
  });

  it('reads the persisted outreach stage for each watched program', async () => {
    withWatchedPrograms();

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    const savedStage = screen.getByRole('combobox', {
      name: 'Outreach stage for Summer Research Grant',
    }) as HTMLSelectElement;
    const appliedStage = screen.getByRole('combobox', {
      name: 'Outreach stage for Travel Fellowship',
    }) as HTMLSelectElement;
    expect(savedStage.value).toBe('SAVED');
    expect(appliedStage.value).toBe('APPLIED');
  });

  it('persists a full-pipeline stage change through the canonical plan stage', async () => {
    withWatchedPrograms();
    mockedAxios.put.mockResolvedValue({ data: { watchedProgramPlans: {} } });

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    const stageSelect = screen.getByRole('combobox', {
      name: 'Outreach stage for Summer Research Grant',
    });
    fireEvent.change(stageSelect, { target: { value: 'CONTACTED' } });

    await waitFor(() =>
      expect(mockedAxios.put).toHaveBeenCalledWith('/users/watchedProgramPlans/p1', {
        data: { plan: { stage: 'CONTACTED' } },
      }),
    );
    expect((stageSelect as HTMLSelectElement).value).toBe('CONTACTED');
    expect(await screen.findByText('Saved', { selector: 'p' })).toBeTruthy();
  });

  it('reverts the displayed stage and surfaces an error when a stage save fails', async () => {
    withWatchedPrograms();
    mockedAxios.put.mockRejectedValue(new Error('network'));

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    const stageSelect = screen.getByRole('combobox', {
      name: 'Outreach stage for Summer Research Grant',
    }) as HTMLSelectElement;
    fireEvent.change(stageSelect, { target: { value: 'APPLIED' } });

    await screen.findByText(/Not saved/);
    expect(stageSelect.value).toBe('SAVED');
  });

  it('unwatches a program through the canonical watched-programs endpoint', async () => {
    withWatchedPrograms();
    mockedAxios.delete.mockResolvedValue({ data: { watchedProgramIds: ['p2'] } });

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from favorites' })[0]);

    await waitFor(() =>
      expect(mockedAxios.delete).toHaveBeenCalledWith('/users/watchedPrograms', {
        withCredentials: true,
        data: { watchedPrograms: ['p1'] },
      }),
    );
  });

  it('shows an empty state with a browse CTA when nothing is watched', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/watchedProgramIds') {
        return Promise.resolve({ data: { watchedProgramIds: [] } });
      }
      if (url === '/users/watchedPrograms') {
        return Promise.resolve({ data: { watchedPrograms: [] } });
      }
      return Promise.resolve({ data: { watchedProgramPlans: {} } });
    });

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No watched programs yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Programs & Fellowships' }).getAttribute('href')).toBe(
      '/programs',
    );
  });

  describe('when a load request fails', () => {
    const failing = (failedUrl: string) => {
      withWatchedPrograms();
      const succeed = mockedAxios.get.getMockImplementation() as (url: string) => Promise<unknown>;
      let shouldFail = true;
      mockedAxios.get.mockImplementation((url: string) =>
        url === failedUrl && shouldFail ? Promise.reject(new Error('network')) : succeed(url),
      );
      return {
        recover: () => {
          shouldFail = false;
        },
      };
    };

    it.each(['/users/watchedPrograms', '/users/watchedProgramPlans', '/users/watchedProgramIds'])(
      'reports a load error instead of claiming nothing is watched when %s fails',
      async (url) => {
        failing(url);

        render(
          <MemoryRouter>
            <ProgramWatch />
          </MemoryRouter>,
        );

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('Could not load your watched programs');
        expect(screen.queryByText('No watched programs yet')).toBeNull();
        expect(screen.queryByRole('link', { name: 'Programs & Fellowships' })).toBeNull();
      },
    );

    it('reports an unknown count rather than zero when the watched ids fail', async () => {
      failing('/users/watchedProgramIds');
      const onSummaryChange = vi.fn();

      render(
        <MemoryRouter>
          <ProgramWatch onSummaryChange={onSummaryChange} />
        </MemoryRouter>,
      );

      await screen.findByRole('alert');
      expect(onSummaryChange).toHaveBeenLastCalledWith(expect.objectContaining({ count: null }));
      expect(onSummaryChange).not.toHaveBeenCalledWith(expect.objectContaining({ count: 0 }));
    });

    it('loads the watched list again when the student retries', async () => {
      const request = failing('/users/watchedProgramPlans');

      render(
        <MemoryRouter>
          <ProgramWatch />
        </MemoryRouter>,
      );

      await screen.findByRole('alert');
      request.recover();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('Summer Research Grant')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
