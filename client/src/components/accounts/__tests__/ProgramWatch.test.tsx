import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import ProgramWatch from '../ProgramWatch';
import { trackResearchEvent } from '../../../utils/researchAnalytics';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../../utils/appDialogs', () => ({ showAlert: vi.fn(), confirmAction: vi.fn() }));

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

  it('drops the closing-soon urgency from a program the student already applied to', async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/watchedProgramIds') {
        return Promise.resolve({ data: { watchedProgramIds: ['p1', 'p2'] } });
      }
      if (url === '/users/watchedPrograms') {
        return Promise.resolve({
          data: {
            watchedPrograms: [
              { _id: 'p1', id: 'p1', title: 'Applied Grant', deadline: soon },
              { _id: 'p2', id: 'p2', title: 'Open Grant', deadline: soon },
            ].map((program) => ({ ...program, isAcceptingApplications: true })),
          },
        });
      }
      if (url === '/users/watchedProgramPlans') {
        return Promise.resolve({
          data: { watchedProgramPlans: { p1: { stage: 'APPLIED' }, p2: { stage: 'SAVED' } } },
        });
      }
      return Promise.resolve({ data: {} });
    });
    const onSummaryChange = vi.fn();

    render(
      <MemoryRouter>
        <ProgramWatch onSummaryChange={onSummaryChange} />
      </MemoryRouter>,
    );

    const appliedCard = (await screen.findByText('Applied Grant')).closest('li') as HTMLElement;
    const openCard = screen.getByText('Open Grant').closest('li') as HTMLElement;
    expect(appliedCard.textContent).not.toMatch(/Closing soon|days left/);
    expect(within(appliedCard).getByText('Applied', { selector: 'span' })).toBeTruthy();
    expect(openCard.textContent).toMatch(/Closing soon|days left/);
    expect(appliedCard.querySelector('.text-amber-700')).toBeNull();
    expect(openCard.querySelector('.text-amber-700')).not.toBeNull();
    await waitFor(() =>
      expect(onSummaryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          approachingCount: 1,
          notStartedCount: 1,
          nextDeadlineLabel: expect.stringContaining('Open Grant'),
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
    fireEvent.click(screen.getAllByRole('button', { name: /^Stop watching / })[0]);

    await waitFor(() =>
      expect(mockedAxios.delete).toHaveBeenCalledWith('/users/watchedPrograms', {
        withCredentials: true,
        data: { watchedPrograms: ['p1'] },
      }),
    );
  });

  it('offers an undo after the unwatch that the server answers by clearing the plan', async () => {
    withWatchedPrograms();
    mockedAxios.delete.mockResolvedValue({ data: {} });

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Travel Fellowship');
    fireEvent.click(screen.getAllByRole('button', { name: /^Stop watching / })[1]);

    await waitFor(() => expect(mockedAxios.delete).toHaveBeenCalled());
    expect(
      screen.queryByRole('combobox', { name: 'Outreach stage for Travel Fellowship' }),
    ).toBeNull();
    const undo = await screen.findByRole('button', { name: 'Undo' });
    const region = undo.closest('[role="status"]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.textContent).toContain('Travel Fellowship');
    expect(region?.textContent).toContain('Undo restores your stage too');
  });

  it('re-posts the captured note and stage when the unwatch is undone', async () => {
    withWatchedPrograms();
    mockedAxios.delete.mockResolvedValue({ data: {} });
    mockedAxios.put.mockResolvedValue({ data: {} });

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Outreach stage for Summer Research Grant' }),
      { target: { value: 'APPLIED' } },
    );
    await waitFor(() => expect(mockedAxios.put).toHaveBeenCalledTimes(1));
    mockedAxios.put.mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: /^Stop watching / })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(() =>
      expect(mockedAxios.put).toHaveBeenCalledWith('/users/watchedProgramPlans/p1', {
        data: { plan: { privateNotes: 'Ask about housing', stage: 'APPLIED' } },
      }),
    );
    expect(mockedAxios.put).toHaveBeenCalledWith('/users/watchedPrograms', {
      withCredentials: true,
      data: { watchedPrograms: ['p1'] },
    });
    const watchCall = mockedAxios.put.mock.calls.findIndex(
      ([url]) => url === '/users/watchedPrograms',
    );
    const planCall = mockedAxios.put.mock.calls.findIndex(
      ([url]) => url === '/users/watchedProgramPlans/p1',
    );
    expect(watchCall).toBeLessThan(planCall);
    expect(await screen.findByText('Summer Research Grant')).toBeTruthy();
    expect(screen.getByText('Note: Ask about housing')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
  });

  it('withdraws the undo offer when the unwatch itself failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    withWatchedPrograms();
    mockedAxios.delete.mockRejectedValue(new Error('offline'));

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    fireEvent.click(screen.getAllByRole('button', { name: /^Stop watching / })[0]);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
    expect(await screen.findByText('Summer Research Grant')).toBeTruthy();
  });

  it('sends no plan write when a note is focused and left unchanged', async () => {
    withWatchedPrograms();
    mockedAxios.put.mockResolvedValue({ data: {} });

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    fireEvent.click(screen.getByRole('button', { name: 'Edit note for Summer Research Grant' }));
    const note = screen.getByRole('textbox', { name: 'Note for Summer Research Grant' });
    act(() => note.focus());
    fireEvent.blur(note);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockedAxios.put).not.toHaveBeenCalled();
    expect(trackResearchEvent).not.toHaveBeenCalled();
  });

  it('sends one plan write for a typed edit that is saved before the blur', async () => {
    withWatchedPrograms();
    mockedAxios.put.mockResolvedValue({ data: {} });

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Travel Fellowship');
    fireEvent.click(screen.getByRole('button', { name: 'Add note for Travel Fellowship' }));
    const note = screen.getByRole('textbox', { name: 'Note for Travel Fellowship' });
    fireEvent.change(note, { target: { value: 'Apply before spring' } });
    await waitFor(() => expect(mockedAxios.put).toHaveBeenCalledTimes(1), { timeout: 2000 });
    fireEvent.blur(note);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockedAxios.put).toHaveBeenCalledTimes(1);
    expect(trackResearchEvent).toHaveBeenCalledTimes(1);
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

describe('ProgramWatch control containment', () => {
  const cardOf = (title: string) =>
    screen
      .getByRole('button', { name: `View details for ${title}` })
      .closest('.rounded-card') as HTMLElement | null;

  it("keeps each watched program's note and stage controls inside its own card", async () => {
    withWatchedPrograms();

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    for (const title of ['Summer Research Grant', 'Travel Fellowship']) {
      const card = cardOf(title);
      expect(card).toBeTruthy();
      const noteButton = screen.getByRole('button', { name: new RegExp(`^(Add|Edit) note for ${title}$`) });
      const stageControl = screen.getByLabelText(`Outreach stage for ${title}`);
      expect(card?.contains(noteButton)).toBe(true);
      expect(card?.contains(stageControl)).toBe(true);
    }
  });

  it('keeps an opened note editor inside the card it belongs to', async () => {
    withWatchedPrograms();

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    fireEvent.click(screen.getByRole('button', { name: 'Add note for Travel Fellowship' }));

    const editor = screen.getByLabelText('Note for Travel Fellowship');
    expect(cardOf('Travel Fellowship')?.contains(editor)).toBe(true);
    expect(cardOf('Summer Research Grant')?.contains(editor)).toBe(false);
  });

  it('marks a program that has a note with the gold tokens rather than a raw hue', async () => {
    withWatchedPrograms();

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    const withNote = screen.getByRole('button', { name: 'Edit note for Summer Research Grant' });
    const withoutNote = screen.getByRole('button', { name: 'Add note for Travel Fellowship' });

    expect(withNote.className).not.toMatch(/\byellow-/);
    expect(withNote.className).toContain('border-gold');
    expect(withNote.className).toContain('bg-gold-soft');
    expect(withoutNote.className).not.toContain('bg-gold-soft');
  });

  it('shows a program watched in another tab once this tab is visible again', async () => {
    let ids = ['p1'];
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/watchedProgramIds') {
        return Promise.resolve({ data: { watchedProgramIds: ids } });
      }
      if (url === '/users/watchedPrograms') {
        const all = [
          { _id: 'p1', id: 'p1', title: 'Summer Research Grant', isAcceptingApplications: true },
          { _id: 'p2', id: 'p2', title: 'Travel Fellowship', isAcceptingApplications: true },
        ];
        return Promise.resolve({
          data: { watchedPrograms: all.filter((program) => ids.includes(program.id)) },
        });
      }
      if (url === '/users/watchedProgramPlans') {
        return Promise.resolve({ data: { watchedProgramPlans: {} } });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');
    expect(screen.queryByText('Travel Fellowship')).toBeNull();

    ids = ['p1', 'p2'];
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(await screen.findByText('Travel Fellowship')).toBeTruthy();
  });

  it('retries loading a program watched in another tab after a failed refresh', async () => {
    let ids = ['p1'];
    let failPrograms = false;
    const all = [
      { _id: 'p1', id: 'p1', title: 'Summer Research Grant', isAcceptingApplications: true },
      { _id: 'p2', id: 'p2', title: 'Travel Fellowship', isAcceptingApplications: true },
    ];
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/watchedProgramIds') {
        return Promise.resolve({ data: { watchedProgramIds: [...ids] } });
      }
      if (url === '/users/watchedPrograms') {
        if (failPrograms) return Promise.reject(new Error('network'));
        return Promise.resolve({
          data: { watchedPrograms: all.filter((program) => ids.includes(program.id)) },
        });
      }
      if (url === '/users/watchedProgramPlans') {
        return Promise.resolve({ data: { watchedProgramPlans: {} } });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');

    ids = ['p1', 'p2'];
    failPrograms = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() =>
      expect(
        mockedAxios.get.mock.calls.filter(([url]) => url === '/users/watchedPrograms'),
      ).toHaveLength(2),
    );
    expect(screen.queryByText('Travel Fellowship')).toBeNull();

    failPrograms = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(await screen.findByText('Travel Fellowship')).toBeTruthy();
  });
});
