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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SavedResearchPlans', () => {
  it('renders saved research homes with an openable link and reports the count', async () => {
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
      /Open a saved research home to find its official profile and reach out/,
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
    expect(await screen.findByText('Saved')).toBeTruthy();
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
});
