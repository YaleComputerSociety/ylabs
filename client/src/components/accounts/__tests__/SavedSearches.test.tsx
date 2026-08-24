import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import SavedSearches from '../SavedSearches';
import type { SavedSearchView } from '../../../types/savedSearch';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../shared/LoadingSpinner', () => ({ default: () => <div>Loading</div> }));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const baseSearch = (overrides: Partial<SavedSearchView> = {}): SavedSearchView => ({
  _id: 's1',
  label: 'CS labs in ML',
  queryText: 'machine learning',
  filters: {
    school: [],
    departments: ['Computer Science'],
    researchAreas: [],
    entityType: [],
    currentAvailability: ['OPEN'],
    compensation: [],
    eligibleStudentLevels: [],
    hostsUndergrads: false,
    hasDocumentedWayIn: false,
  },
  urlParams: 'q=machine+learning&availability=OPEN',
  newMatchCount: 3,
  ...overrides,
});

const withSearches = (searches: SavedSearchView[]) => {
  mockedAxios.get.mockResolvedValue({ data: { savedSearches: searches } });
};

const renderComponent = (onCountChange = vi.fn()) =>
  render(
    <MemoryRouter>
      <SavedSearches onCountChange={onCountChange} />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SavedSearches', () => {
  it('renders each saved search with its summary, new-match badge, and count', async () => {
    withSearches([baseSearch()]);
    const onCountChange = vi.fn();
    renderComponent(onCountChange);

    expect(await screen.findByText('CS labs in ML')).toBeInTheDocument();
    expect(screen.getByText('3 new')).toBeInTheDocument();
    expect(screen.getByText(/"machine learning"/)).toBeInTheDocument();
    expect(screen.getByText(/Computer Science/)).toBeInTheDocument();
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(1));
  });

  it('deep-links Open to the research page and marks the search viewed', async () => {
    withSearches([baseSearch()]);
    mockedAxios.post.mockResolvedValue({ data: {} });
    renderComponent();

    const openLink = await screen.findByRole('link', { name: 'Open' });
    expect(openLink).toHaveAttribute(
      'href',
      '/research?q=machine+learning&availability=OPEN',
    );

    fireEvent.click(openLink);
    await waitFor(() =>
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/users/savedSearches/s1/viewed',
        {},
        { withCredentials: true },
      ),
    );
    expect(screen.queryByText('3 new')).not.toBeInTheDocument();
  });

  it('renames a saved search', async () => {
    withSearches([baseSearch()]);
    mockedAxios.put.mockResolvedValue({
      data: { savedSearches: [baseSearch({ label: 'Renamed' })] },
    });
    renderComponent();

    fireEvent.click(await screen.findByRole('button', { name: 'Rename CS labs in ML' }));
    const input = screen.getByLabelText('Rename saved search');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() =>
      expect(mockedAxios.put).toHaveBeenCalledWith(
        '/users/savedSearches/s1',
        { data: { label: 'Renamed' } },
        { withCredentials: true },
      ),
    );
    expect(await screen.findByText('Renamed')).toBeInTheDocument();
  });

  it('deletes a saved search', async () => {
    withSearches([baseSearch()]);
    mockedAxios.delete.mockResolvedValue({ data: { savedSearches: [] } });
    renderComponent();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete CS labs in ML' }));

    await waitFor(() =>
      expect(mockedAxios.delete).toHaveBeenCalledWith('/users/savedSearches/s1', {
        withCredentials: true,
      }),
    );
    await waitFor(() => expect(screen.queryByText('CS labs in ML')).not.toBeInTheDocument());
  });

  it('shows an empty state with a link to research when there are none', async () => {
    withSearches([]);
    renderComponent();

    expect(await screen.findByText('No saved searches yet')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Browse Research' });
    expect(cta).toHaveAttribute('href', '/research');
  });

  it('hides the badge for a search whose count could not be computed', async () => {
    withSearches([baseSearch({ newMatchCount: null })]);
    renderComponent();

    await screen.findByText('CS labs in ML');
    const row = screen.getByText('CS labs in ML').closest('li') as HTMLElement;
    expect(within(row).queryByText(/new/)).not.toBeInTheDocument();
  });

  it('reports the aggregate new-match count across saved searches', async () => {
    withSearches([
      baseSearch({ _id: 's1', newMatchCount: 2 }),
      baseSearch({ _id: 's2', newMatchCount: 3 }),
    ]);
    const onNewMatchCountChange = vi.fn();
    render(
      <MemoryRouter>
        <SavedSearches onNewMatchCountChange={onNewMatchCountChange} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(onNewMatchCountChange).toHaveBeenCalledWith(5));
  });

  it('recomputes the aggregate new-match count to zero after opening clears a search', async () => {
    withSearches([baseSearch({ newMatchCount: 3 })]);
    mockedAxios.post.mockResolvedValue({ data: {} });
    const onNewMatchCountChange = vi.fn();
    render(
      <MemoryRouter>
        <SavedSearches onNewMatchCountChange={onNewMatchCountChange} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(onNewMatchCountChange).toHaveBeenCalledWith(3));

    fireEvent.click(await screen.findByRole('link', { name: 'Open' }));

    await waitFor(() => expect(onNewMatchCountChange).toHaveBeenLastCalledWith(0));
  });
});
