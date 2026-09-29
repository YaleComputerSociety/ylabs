import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminCorrectionReports from '../AdminCorrectionReports';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const report = (id: string, name: string, status: string) => ({
  _id: id,
  category: 'wrong_description',
  status,
  entitySlug: `synthetic-${id}`,
  entitySnapshot: { name },
  reporter: {
    name: 'Synthetic Reporter',
    netId: 'synthetic',
    role: 'student',
    userType: 'student',
  },
  createdAt: '2026-09-01T00:00:00.000Z',
});

const listOf = (...reports: ReturnType<typeof report>[]) => ({
  data: { reports, total: reports.length },
});

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const openReport = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  return screen.getByRole('dialog');
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminCorrectionReports', () => {
  it('shows a failed Accept inside the dialog the operator is looking at', async () => {
    mockedAxios.get.mockResolvedValue(listOf(report('r1', 'Synthetic Entity', 'unreviewed')));
    mockedAxios.put.mockRejectedValue({ response: { data: { error: 'Synthetic save failure' } } });
    render(<AdminCorrectionReports />);

    const dialog = await openReport('Synthetic Entity');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));

    expect(await within(dialog).findByText('Synthetic save failure')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Accept' })).toBeTruthy();
  });

  it('disables the review buttons while a save is pending', async () => {
    mockedAxios.get.mockResolvedValue(listOf(report('r1', 'Synthetic Entity', 'unreviewed')));
    const save = deferred<unknown>();
    mockedAxios.put.mockReturnValue(save.promise);
    render(<AdminCorrectionReports />);

    const dialog = await openReport('Synthetic Entity');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));

    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(
      (within(dialog).getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    expect(mockedAxios.put).toHaveBeenCalledTimes(1);
    save.resolve({ data: {} });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reports a failed reload after a saved review as a refresh failure', async () => {
    mockedAxios.get
      .mockResolvedValueOnce(listOf(report('r1', 'Synthetic Entity', 'unreviewed')))
      .mockRejectedValueOnce(new Error('network'));
    mockedAxios.put.mockResolvedValue({ data: {} });
    render(<AdminCorrectionReports />);

    const dialog = await openReport('Synthetic Entity');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/review was saved/i);
    expect(alert.textContent).not.toMatch(/could not be saved/i);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('lets the latest status win when an older list response arrives last', async () => {
    const unreviewed = deferred<unknown>();
    mockedAxios.get.mockImplementation((url: string) =>
      url.includes('status=unreviewed')
        ? unreviewed.promise
        : Promise.resolve(listOf(report('r2', 'Synthetic Accepted', 'accepted'))),
    );
    render(<AdminCorrectionReports />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'accepted' } });
    await screen.findByText('Synthetic Accepted');
    unreviewed.resolve(listOf(report('r1', 'Synthetic Unreviewed', 'unreviewed')));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(screen.queryByText('Synthetic Unreviewed')).toBeNull();
    expect(screen.getByText('Synthetic Accepted')).toBeTruthy();
  });

  it('clears a load error once a later load succeeds', async () => {
    mockedAxios.get.mockImplementation((url: string) =>
      url.includes('status=unreviewed')
        ? Promise.reject(new Error('network'))
        : Promise.resolve(listOf()),
    );
    render(<AdminCorrectionReports />);

    await screen.findByText('Could not load correction reports.');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'accepted' } });
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(2));

    await waitFor(() =>
      expect(screen.queryByText('Could not load correction reports.')).toBeNull(),
    );
  });

  it('offers a retry after a failed load', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(listOf(report('r1', 'Synthetic Entity', 'unreviewed')));
    render(<AdminCorrectionReports />);

    await screen.findByText('Could not load correction reports.');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Synthetic Entity')).toBeTruthy();
    expect(screen.queryByText('Could not load correction reports.')).toBeNull();
  });
});
