/**
 * The admin funnel renders `research_plan_update` as its "Updated a plan" stage, so a
 * plan edit that never emits leaves that bar permanently at zero with no way to tell a
 * missing instrumentation call from genuine student inaction. These tests assert the
 * event is emitted from every surface that persists a plan change.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import { trackResearchEvent } from '../../../utils/researchAnalytics';
import ProgramWatch from '../ProgramWatch';
import SavedResearchPlans from '../SavedResearchPlans';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('sweetalert', () => ({ default: vi.fn() }));

vi.mock('../../../utils/researchAnalytics', () => ({
  trackResearchEvent: vi.fn(),
  createResearchAnalyticsInteractionId: () => 'test-interaction',
}));

vi.mock('../../shared/LoadingSpinner', () => ({ default: () => <div>Loading</div> }));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const mockedTrack = trackResearchEvent as unknown as ReturnType<typeof vi.fn>;

const withWatchedProgram = () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/watchedProgramIds') {
      return Promise.resolve({ data: { watchedProgramIds: ['p1'] } });
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
            },
          ],
        },
      });
    }
    if (url === '/users/watchedProgramPlans') {
      return Promise.resolve({
        data: { watchedProgramPlans: { p1: { privateNotes: '', stage: 'SAVED' } } },
      });
    }
    return Promise.resolve({ data: {} });
  });
  mockedAxios.put.mockResolvedValue({ data: {} });
};

const withSavedResearchEntity = () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/savedResearchEntityIds') {
      return Promise.resolve({ data: { savedResearchEntityIds: ['synthetic-home'] } });
    }
    if (url === '/users/savedResearchEntities') {
      return Promise.resolve({
        data: {
          savedResearchEntities: [
            { _id: 'e1', id: 'e1', name: 'Synthetic Research Home', slug: 'synthetic-home' },
          ],
        },
      });
    }
    if (url === '/users/savedResearchEntityPlans') {
      return Promise.resolve({
        data: { savedResearchEntityPlans: { e1: { privateNotes: '', stage: 'SAVED' } } },
      });
    }
    return Promise.resolve({ data: {} });
  });
  mockedAxios.put.mockResolvedValue({ data: {} });
};

const planUpdateCalls = () =>
  mockedTrack.mock.calls
    .map(([event]) => event)
    .filter((event) => event?.eventType === 'research_plan_update');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('research_plan_update is emitted when a plan is persisted', () => {
  it('emits for a watched program stage change', async () => {
    withWatchedProgram();

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    const select = await screen.findByLabelText('Outreach stage for Summer Research Grant');
    fireEvent.change(select, { target: { value: 'APPLIED' } });

    await waitFor(() => expect(planUpdateCalls().length).toBe(1));
    expect(planUpdateCalls()[0]).toMatchObject({
      eventType: 'research_plan_update',
      entityType: 'fellowship',
      entityId: 'p1',
      payload: { field: 'stage' },
    });
  });

  it('emits for a saved research home stage change', async () => {
    withSavedResearchEntity();

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    const select = await screen.findByLabelText('Outreach stage for Synthetic Research Home');
    fireEvent.change(select, { target: { value: 'CONTACTED' } });

    await waitFor(() => expect(planUpdateCalls().length).toBe(1));
    expect(planUpdateCalls()[0]).toMatchObject({
      eventType: 'research_plan_update',
      entityType: 'research_entity',
      entityId: 'e1',
      payload: { field: 'stage' },
    });
  });

  it('never puts note text in the payload, only its presence', async () => {
    withWatchedProgram();

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    const select = await screen.findByLabelText('Outreach stage for Summer Research Grant');
    fireEvent.change(select, { target: { value: 'APPLIED' } });

    await waitFor(() => expect(planUpdateCalls().length).toBe(1));
    for (const event of planUpdateCalls()) {
      expect(Object.keys(event.payload || {})).toEqual(['field']);
      expect(['stage', 'note_presence']).toContain(event.payload.field);
    }
  });

  it('does not emit when the save request fails', async () => {
    withWatchedProgram();
    mockedAxios.put.mockRejectedValue(new Error('network'));

    render(
      <MemoryRouter>
        <ProgramWatch />
      </MemoryRouter>,
    );

    const select = await screen.findByLabelText('Outreach stage for Summer Research Grant');
    fireEvent.change(select, { target: { value: 'APPLIED' } });

    await waitFor(() => expect(mockedAxios.put).toHaveBeenCalled());
    expect(planUpdateCalls()).toEqual([]);
  });
});
