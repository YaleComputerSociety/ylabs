import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminFellowshipsTable from '../AdminFellowshipsTable';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('sweetalert', () => ({ default: vi.fn(() => Promise.resolve(true)) }));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
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
