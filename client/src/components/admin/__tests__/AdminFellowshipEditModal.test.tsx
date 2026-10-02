import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AdminFellowshipEditModal from '../AdminFellowshipEditModal';
import type { Fellowship } from '../../../types/types';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({ default: { put: vi.fn(), delete: vi.fn() } }));
vi.mock('sweetalert', () => ({ default: vi.fn(() => Promise.resolve(true)) }));

const fellowship = {
  id: 'f1',
  title: 'Synthetic Fellowship',
  isAcceptingApplications: true,
  archived: false,
  yearOfStudy: ['Senior'],
} as unknown as Fellowship;

describe('AdminFellowshipEditModal', () => {
  it('names each tag remove button after the value it removes', () => {
    render(<AdminFellowshipEditModal fellowship={fellowship} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Senior from Year of Study' }));

    expect(screen.queryByRole('button', { name: 'Remove Senior from Year of Study' })).toBeNull();
  });

  it('names the close button after the editor it closes', () => {
    const onClose = vi.fn();
    render(<AdminFellowshipEditModal fellowship={fellowship} onClose={onClose} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close fellowship editor' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const BROWSER_ZONES = ['America/New_York', 'UTC', 'Asia/Tokyo', 'Pacific/Honolulu'];

const datedFellowship = {
  ...fellowship,
  deadline: '2026-01-16T04:59:59.999Z',
  applicationOpenDate: '2025-12-01T05:00:00.000Z',
} as unknown as Fellowship;

const savedData = async () => {
  const put = axios.put as unknown as ReturnType<typeof vi.fn>;
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  return put.mock.calls[0][1].data as Record<string, unknown>;
};

describe.each(BROWSER_ZONES)('AdminFellowshipEditModal dates in a %s browser', (zone) => {
  const originalZone = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = zone;
  });
  afterEach(() => {
    process.env.TZ = originalZone;
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a date-only deadline as its New York date with no time', () => {
    render(
      <AdminFellowshipEditModal fellowship={datedFellowship} onClose={vi.fn()} onSave={vi.fn()} />,
    );

    const deadline = screen.getByRole('group', { name: 'Deadline' });
    expect((deadline.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(
      '2026-01-15',
    );
    expect((deadline.querySelector('input[type="time"]') as HTMLInputElement).value).toBe('');
  });

  it('does not send dates the admin left untouched', async () => {
    render(
      <AdminFellowshipEditModal fellowship={datedFellowship} onClose={vi.fn()} onSave={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    const data = await savedData();
    expect(data).not.toHaveProperty('deadline');
    expect(data).not.toHaveProperty('applicationOpenDate');
  });

  it('sends a re-dated deadline as the end of that New York day', async () => {
    render(
      <AdminFellowshipEditModal fellowship={datedFellowship} onClose={vi.fn()} onSave={vi.fn()} />,
    );

    const deadline = screen.getByRole('group', { name: 'Deadline' });
    fireEvent.change(deadline.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: '2026-03-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    const data = await savedData();
    expect(data.deadline).toBe('2026-03-21T03:59:59.999Z');
    expect(data).not.toHaveProperty('applicationOpenDate');
  });
});
