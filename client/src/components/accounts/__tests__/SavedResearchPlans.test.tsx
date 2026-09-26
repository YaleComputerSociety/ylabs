import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import SavedResearchPlans from '../SavedResearchPlans';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('sweetalert', () => ({ default: vi.fn() }));

vi.mock('../../../utils/researchAnalytics', () => ({
  trackResearchEvent: vi.fn(),
  createResearchAnalyticsInteractionId: () => 'test-interaction',
}));

vi.mock('../shared/LoadingSpinner', () => ({ default: () => <div>Loading</div> }));

vi.mock('../ResearchHomeComparison', () => ({
  default: ({ entities }: { entities: Array<{ _id: string }> }) => (
    <div data-testid="comparison">comparing {entities.length}</div>
  ),
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const withSavedPlans = () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/savedResearchEntityIds') {
      return Promise.resolve({ data: { savedResearchEntityIds: ['owner-lab', 'other-lab'] } });
    }
    if (url === '/users/savedResearchEntities') {
      return Promise.resolve({
        data: {
          savedResearchEntities: [
            { _id: 'id1', slug: 'owner-lab', name: 'Owner Lab', kind: 'lab', departments: ['CS'] },
            { _id: 'id2', slug: 'other-lab', name: 'Other Lab', kind: 'center', departments: [] },
          ],
        },
      });
    }
    if (url === '/users/savedResearchEntityPlans') {
      return Promise.resolve({
        data: {
          savedResearchEntityPlans: {
            id1: { privateNotes: 'Ask about rotations' },
            id2: { privateNotes: '' },
          },
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
};

const withManySavedPlans = (count: number) => {
  const slugs = Array.from({ length: count }, (_, index) => `lab-${index}`);
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/savedResearchEntityIds') {
      return Promise.resolve({ data: { savedResearchEntityIds: slugs } });
    }
    if (url === '/users/savedResearchEntities') {
      return Promise.resolve({
        data: {
          savedResearchEntities: slugs.map((slug, index) => ({
            _id: `id-${index}`,
            slug,
            name: `Lab ${index}`,
            kind: 'lab',
            departments: [],
          })),
        },
      });
    }
    if (url === '/users/savedResearchEntityPlans') {
      return Promise.resolve({ data: { savedResearchEntityPlans: {} } });
    }
    return Promise.resolve({ data: {} });
  });
};

const withAccessPlans = (
  entities: Array<Record<string, unknown> & { _id: string; slug: string; name: string }>,
) => {
  const slugs = entities.map((entity) => entity.slug);
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/savedResearchEntityIds') {
      return Promise.resolve({ data: { savedResearchEntityIds: slugs } });
    }
    if (url === '/users/savedResearchEntities') {
      return Promise.resolve({ data: { savedResearchEntities: entities } });
    }
    if (url === '/users/savedResearchEntityPlans') {
      return Promise.resolve({ data: { savedResearchEntityPlans: {} } });
    }
    return Promise.resolve({ data: {} });
  });
};

const withUnavailablePlans = (
  unavailableSavedResearchEntities: Array<{ _id: string; reason: string }>,
  savedResearchEntities: Array<Record<string, unknown>> = [],
) => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/savedResearchEntityIds') {
      return Promise.resolve({
        data: {
          savedResearchEntityIds: savedResearchEntities.map((entity) => entity.slug as string),
        },
      });
    }
    if (url === '/users/savedResearchEntities') {
      return Promise.resolve({
        data: { savedResearchEntities, unavailableSavedResearchEntities },
      });
    }
    if (url === '/users/savedResearchEntityPlans') {
      return Promise.resolve({ data: { savedResearchEntityPlans: {} } });
    }
    return Promise.resolve({ data: {} });
  });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SavedResearchPlans', () => {
  it('renders saved research with an openable link and reports the count', async () => {
    withSavedPlans();
    const onCountChange = vi.fn();

    render(
      <MemoryRouter>
        <SavedResearchPlans onCountChange={onCountChange} />
      </MemoryRouter>,
    );

    await screen.findByText('Owner Lab');
    expect(screen.getByText('Other Lab')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Open' })[0].getAttribute('href')).toBe(
      '/research/owner-lab',
    );
    expect(screen.getByText('Note: Ask about rotations')).toBeTruthy();
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(2));
  });

  it('describes reaching out via the official profile without promising an email to the PI', async () => {
    withSavedPlans();

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    const header = await screen.findByText(
      /Open saved research to find its official profile and reach out/,
    );
    expect(header.textContent).toContain('keep private notes');
    expect(header.textContent).not.toMatch(/email the PI/i);
  });

  it('persists an edited note to the canonical research plan on blur', async () => {
    withSavedPlans();
    mockedAxios.put.mockResolvedValue({ data: { savedResearchEntityPlans: {} } });

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('Other Lab');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const note = screen.getByRole('textbox', { name: 'Note for Other Lab' });
    fireEvent.change(note, { target: { value: 'Email the PI in September' } });
    fireEvent.blur(note);

    await waitFor(() =>
      expect(mockedAxios.put).toHaveBeenCalledWith('/users/savedResearchEntityPlans/id2', {
        data: { plan: { privateNotes: 'Email the PI in September' } },
      }),
    );
    expect(await screen.findByText('Saved', { selector: 'p' })).toBeTruthy();
  });

  it('removes a saved plan when unsaved', async () => {
    withSavedPlans();
    mockedAxios.delete.mockResolvedValue({ data: {} });

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('Owner Lab');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Owner Lab from saved plans' }));

    await waitFor(() =>
      expect(mockedAxios.delete).toHaveBeenCalledWith('/users/savedResearchEntities', {
        withCredentials: true,
        data: { savedResearchEntities: ['owner-lab'] },
      }),
    );
    await waitFor(() => expect(screen.queryByText('Owner Lab')).toBeNull());
    expect(screen.getByText('Other Lab')).toBeTruthy();
  });

  it('shows an empty state with a browse CTA when nothing is saved', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedResearchEntityIds') {
        return Promise.resolve({ data: { savedResearchEntityIds: [] } });
      }
      if (url === '/users/savedResearchEntities') {
        return Promise.resolve({ data: { savedResearchEntities: [] } });
      }
      return Promise.resolve({ data: { savedResearchEntityPlans: {} } });
    });

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No saved research plans yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Explore Research' }).getAttribute('href')).toBe(
      '/research',
    );
  });

  it('enables comparison only when two to four homes are selected', async () => {
    withSavedPlans();

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('Owner Lab');
    const compareButton = screen.getByRole('button', { name: /^Compare/ });
    expect(compareButton).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Owner Lab to compare' }));
    expect(compareButton).toBeDisabled();
    expect(screen.getByText('Select at least 2 to compare.')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Other Lab to compare' }));
    expect(compareButton).not.toBeDisabled();

    fireEvent.click(compareButton);
    expect(screen.getByTestId('comparison').textContent).toContain('comparing 2');
  });

  it('shows no availability badge when the access fields are absent', async () => {
    withAccessPlans([
      { _id: 'bare-id', slug: 'bare-lab', name: 'Bare Lab', kind: 'lab', departments: [] },
    ]);

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('Bare Lab');
    expect(screen.queryByText('Open now')).toBeNull();
    expect(screen.queryByText('Not currently available')).toBeNull();
    expect(screen.queryByText('Has hosted undergrads before')).toBeNull();
  });

  it('caps comparison selection at four saved homes', async () => {
    withManySavedPlans(5);

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('Lab 0');
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole('checkbox', { name: `Select Lab ${index} to compare` }));
    }

    expect(screen.getByText('You can compare up to 4 at once.')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Select Lab 4 to compare' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Compare/ })).not.toBeDisabled();
  });

  const withStagedPlans = (plans: Record<string, { privateNotes?: string; stage?: string }>) => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedResearchEntityIds') {
        return Promise.resolve({ data: { savedResearchEntityIds: ['owner-lab', 'other-lab'] } });
      }
      if (url === '/users/savedResearchEntities') {
        return Promise.resolve({
          data: {
            savedResearchEntities: [
              { _id: 'id1', slug: 'owner-lab', name: 'Owner Lab', kind: 'lab', departments: [] },
              { _id: 'id2', slug: 'other-lab', name: 'Other Lab', kind: 'center', departments: [] },
            ],
          },
        });
      }
      if (url === '/users/savedResearchEntityPlans') {
        return Promise.resolve({ data: { savedResearchEntityPlans: plans } });
      }
      return Promise.resolve({ data: {} });
    });
  };

  it('reads the persisted outreach stage for each saved home', async () => {
    withStagedPlans({ id1: { stage: 'CONTACTED' }, id2: {} });

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('Owner Lab');
    const ownerStage = screen.getByRole('combobox', {
      name: 'Outreach stage for Owner Lab',
    }) as HTMLSelectElement;
    const otherStage = screen.getByRole('combobox', {
      name: 'Outreach stage for Other Lab',
    }) as HTMLSelectElement;
    expect(ownerStage.value).toBe('CONTACTED');
    expect(otherStage.value).toBe('SAVED');
  });

  it('persists a stage change through the canonical plan and round-trips the value', async () => {
    withStagedPlans({ id1: {}, id2: {} });
    mockedAxios.put.mockResolvedValue({ data: { savedResearchEntityPlans: {} } });

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('Other Lab');
    const stageSelect = screen.getByRole('combobox', {
      name: 'Outreach stage for Other Lab',
    });
    fireEvent.change(stageSelect, { target: { value: 'APPLIED' } });

    await waitFor(() =>
      expect(mockedAxios.put).toHaveBeenCalledWith('/users/savedResearchEntityPlans/id2', {
        data: { plan: { stage: 'APPLIED' } },
      }),
    );
    expect((stageSelect as HTMLSelectElement).value).toBe('APPLIED');
    expect(await screen.findByText('Saved', { selector: 'p' })).toBeTruthy();
  });

  it('reverts the displayed stage and surfaces an error when a stage save fails', async () => {
    withStagedPlans({ id1: {}, id2: {} });
    mockedAxios.put.mockRejectedValue(new Error('network'));

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('Owner Lab');
    const stageSelect = screen.getByRole('combobox', {
      name: 'Outreach stage for Owner Lab',
    }) as HTMLSelectElement;
    fireEvent.change(stageSelect, { target: { value: 'CLOSED' } });

    await screen.findByText(/Not saved/);
    expect(stageSelect.value).toBe('SAVED');
  });

  it('says a saved home is held back rather than dropping it silently (#2174)', async () => {
    withUnavailablePlans([{ _id: 'id-held', reason: 'UNAVAILABLE' }]);

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('1 saved item is not showing below');
    expect(screen.getByText(/Held back from the student directory/)).toBeTruthy();
    expect(screen.queryByText('No saved research plans yet')).toBeNull();
  });

  it('never tells the owner a held research home cannot be opened (#2597)', async () => {
    withUnavailablePlans([{ _id: 'id-held', reason: 'UNAVAILABLE' }]);

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('1 saved item is not showing below');
    expect(screen.queryByText(/cannot be opened/)).toBeNull();
  });

  it('does not promise a readable note for a target that will never come back', async () => {
    withUnavailablePlans([{ _id: 'id-gone', reason: 'REMOVED' }]);

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('1 saved item is not showing below');
    expect(screen.queryByText(/note is kept/)).toBeNull();
  });

  it('counts a saved plan the list cannot show so the dashboard tally agrees (#2174)', async () => {
    withUnavailablePlans([
      { _id: 'id-gone', reason: 'REMOVED' },
      { _id: 'id-held', reason: 'UNAVAILABLE' },
    ]);
    const onCountChange = vi.fn();

    render(
      <MemoryRouter>
        <SavedResearchPlans onCountChange={onCountChange} />
      </MemoryRouter>,
    );

    await screen.findByText('2 saved items are not showing below');
    await waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(2));
  });

  it('counts held plans alongside servable ones', async () => {
    withUnavailablePlans(
      [{ _id: 'id-held', reason: 'UNAVAILABLE' }],
      [{ _id: 'id1', slug: 'owner-lab', name: 'Owner Lab', kind: 'lab', departments: ['CS'] }],
    );
    const onCountChange = vi.fn();

    render(
      <MemoryRouter>
        <SavedResearchPlans onCountChange={onCountChange} />
      </MemoryRouter>,
    );

    await screen.findByText('1 saved item is not showing below');
    await waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(2));
  });

  it('distinguishes a home that left the directory from one that is only held back', async () => {
    withUnavailablePlans([
      { _id: 'id-gone', reason: 'REMOVED' },
      { _id: 'id-held', reason: 'UNAVAILABLE' },
    ]);

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('2 saved items are not showing below');
    expect(screen.getByText(/No longer in the directory/)).toBeTruthy();
    expect(screen.getByText(/Held back from the student directory/)).toBeTruthy();
  });

  it('gives each notice row its own remove control name so two alike rows are tellable apart', async () => {
    withUnavailablePlans([
      { _id: 'id-held-one', reason: 'UNAVAILABLE' },
      { _id: 'id-held-two', reason: 'UNAVAILABLE' },
    ]);

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('2 saved items are not showing below');
    expect(screen.getByRole('button', { name: 'Remove saved item 1 from my plans' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove saved item 2 from my plans' })).toBeTruthy();
  });

  it('removes the notice row whose control the owner pressed', async () => {
    withUnavailablePlans([
      { _id: 'id-held-one', reason: 'UNAVAILABLE' },
      { _id: 'id-held-two', reason: 'UNAVAILABLE' },
    ]);
    mockedAxios.delete.mockResolvedValue({ data: { savedResearchEntityIds: [] } });

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('2 saved items are not showing below');
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved item 2 from my plans' }));

    await waitFor(() =>
      expect(mockedAxios.delete).toHaveBeenCalledWith('/users/savedResearchEntities', {
        withCredentials: true,
        data: { savedResearchEntities: ['id-held-two'] },
      }),
    );
    await screen.findByText('1 saved item is not showing below');
  });

  it('removes an unavailable plan by its entity id and drops the notice row', async () => {
    withUnavailablePlans([{ _id: 'id-gone', reason: 'REMOVED' }]);
    mockedAxios.delete.mockResolvedValue({ data: { savedResearchEntityIds: [] } });

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('1 saved item is not showing below');
    fireEvent.click(screen.getByRole('button', { name: 'Remove from my plans' }));

    await waitFor(() =>
      expect(mockedAxios.delete).toHaveBeenCalledWith('/users/savedResearchEntities', {
        withCredentials: true,
        data: { savedResearchEntities: ['id-gone'] },
      }),
    );
    await screen.findByText('No saved research plans yet');
  });

  it('orders closed homes after active ones so the pipeline reads at a glance', async () => {
    withStagedPlans({ id1: { stage: 'CLOSED' }, id2: { stage: 'EXPLORING' } });

    render(
      <MemoryRouter>
        <SavedResearchPlans />
      </MemoryRouter>,
    );

    await screen.findByText('Owner Lab');
    const openLinks = screen.getAllByRole('link', { name: 'Open' });
    expect(openLinks[0].getAttribute('href')).toBe('/research/other-lab');
    expect(openLinks[1].getAttribute('href')).toBe('/research/owner-lab');
  });
});
