import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AdminFellowshipsTable from '../AdminFellowshipsTable';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock('../../../utils/appDialogs', () => ({
  showAlert: vi.fn(),
  confirmAction: vi.fn(() => Promise.resolve(true)),
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const fellowship = (id: string, title: string, archived: boolean) => ({
  _id: id,
  title,
  archived,
  audited: false,
  views: 0,
  favorites: 0,
  deadline: null,
  applicationOpenDate: null,
  isAcceptingApplications: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  yearOfStudy: ['Senior'],
  termOfAward: [],
  purpose: [],
  globalRegions: [],
  citizenshipStatus: [],
  links: [{ label: 'Program page', url: 'https://example.org/program' }],
});

const pageOf = (...fellowships: ReturnType<typeof fellowship>[]) => ({
  data: { fellowships, total: fellowships.length, totalPages: 1 },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminFellowshipsTable', () => {
  it('lets the latest filter win when an older response arrives last', async () => {
    let resolveUnfiltered: (value: unknown) => void = () => undefined;
    mockedAxios.get.mockImplementation((_url: string, config: { params: { archived?: string } }) =>
      config.params.archived === 'true'
        ? Promise.resolve(pageOf(fellowship('f2', 'Synthetic Archived', true)))
        : new Promise((resolve) => {
            resolveUnfiltered = resolve;
          }),
    );
    render(<AdminFellowshipsTable />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'true' } });
    await screen.findByText('Synthetic Archived');
    resolveUnfiltered(pageOf(fellowship('f1', 'Synthetic Active', false)));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(screen.queryByText('Synthetic Active')).toBeNull();
    expect(screen.getByText('Synthetic Archived')).toBeTruthy();
  });

  it('names each tag and link remove button after the value it removes', async () => {
    mockedAxios.get.mockResolvedValue(pageOf(fellowship('f1', 'Synthetic Active', false)));
    render(<AdminFellowshipsTable />);

    await screen.findByText('Synthetic Active');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove Senior from Year of Study' }));
    expect(screen.queryByRole('button', { name: 'Remove Senior from Year of Study' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove link Program page' }));
    expect(screen.queryByRole('button', { name: 'Remove link Program page' })).toBeNull();
  });
});

const BROWSER_ZONES = ['America/New_York', 'UTC', 'Asia/Tokyo', 'Pacific/Honolulu'];

describe.each(BROWSER_ZONES)('AdminFellowshipsTable edit dates in a %s browser', (zone) => {
  const originalZone = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = zone;
    mockedAxios.get.mockResolvedValue(
      pageOf({
        ...fellowship('f1', 'Synthetic Active', false),
        deadline: '2026-01-16T04:59:59.999Z',
        applicationOpenDate: '2025-12-01T05:00:00.000Z',
      } as unknown as ReturnType<typeof fellowship>),
    );
  });
  afterEach(() => {
    process.env.TZ = originalZone;
  });

  const openEditor = async () => {
    render(<AdminFellowshipsTable />);
    await screen.findByText('Synthetic Active');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  };

  const savedData = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mockedAxios.put).toHaveBeenCalledTimes(1));
    return mockedAxios.put.mock.calls[0][1].data as Record<string, unknown>;
  };

  it('does not send dates the admin left untouched', async () => {
    await openEditor();

    const data = await savedData();

    expect(data).not.toHaveProperty('deadline');
    expect(data).not.toHaveProperty('applicationOpenDate');
  });

  it('sends a stated deadline time as that New York instant', async () => {
    await openEditor();
    const deadline = screen.getByRole('group', { name: 'Deadline Date & Time' });
    fireEvent.change(deadline.querySelector('input[type="time"]') as HTMLInputElement, {
      target: { value: '17:00' },
    });

    const data = await savedData();

    expect(data.deadline).toBe('2026-01-15T22:00:00.000Z');
    expect(data).not.toHaveProperty('applicationOpenDate');
  });
});
