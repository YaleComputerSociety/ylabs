import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EntityCorrectionReportPanel from '../EntityCorrectionReportPanel';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const slug = 'cell-systems-lab';

describe('EntityCorrectionReportPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axios.get).mockResolvedValue({ data: { reports: [] } });
  });

  it('submits a structured report and reports the non-mutating review path', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { report: { _id: 'report-1' } } });
    render(<EntityCorrectionReportPanel slug={slug} entityName="Cell Systems Lab" />);

    fireEvent.click(screen.getByRole('button', { name: /report an issue with this page/i }));
    fireEvent.change(screen.getByLabelText(/what is wrong/i), {
      target: { value: 'wrong_lead' },
    });
    fireEvent.change(screen.getByLabelText(/add details/i), {
      target: { value: 'The PI shown left the university.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(`/research/${slug}/report`, {
        category: 'wrong_lead',
        note: 'The PI shown left the university.',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('No page content was changed');
  });

  it('announces a duplicate open report', async () => {
    vi.mocked(axios.post).mockRejectedValue({ response: { status: 409 } });
    render(<EntityCorrectionReportPanel slug={slug} entityName="Cell Systems Lab" />);

    fireEvent.click(screen.getByRole('button', { name: /report an issue with this page/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    expect(await screen.findByRole('status')).toHaveTextContent('already have an open report');
  });

  const openDialog = async () => {
    render(<EntityCorrectionReportPanel slug={slug} entityName="Cell Systems Lab" />);
    const trigger = screen.getByRole('button', { name: 'Report an issue with this page' });
    trigger.focus();
    fireEvent.click(trigger);
    return { trigger, dialog: await screen.findByRole('dialog') };
  };

  it('moves focus into the dialog when it opens', async () => {
    const { dialog } = await openDialog();

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape from wherever focus is after opening and returns focus to the trigger', async () => {
    const { trigger } = await openDialog();

    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab from the last control to the first and Shift+Tab back', async () => {
    const { dialog } = await openDialog();
    const firstControl = screen.getByLabelText(/what is wrong/i);
    const lastControl = screen.getByRole('button', { name: 'Submit report' });

    lastControl.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(firstControl);

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastControl);
  });

  it('does not show the previous thank-you when reopened', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: {} });
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    await screen.findByText(/Thanks\. Your report was sent/);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Report an issue with this page' }));
    await screen.findByRole('dialog');

    expect(screen.queryByText(/Thanks\. Your report was sent/)).toBeNull();
  });

  it('renders the current user report history for this page', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        reports: [
          {
            _id: 'report-1',
            category: 'stale_availability',
            status: 'accepted',
            reviewerNote: 'Refreshed the availability.',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    });
    render(<EntityCorrectionReportPanel slug={slug} entityName="Cell Systems Lab" />);

    expect(await screen.findByText(/Availability is stale or incorrect/i)).toBeInTheDocument();
    expect(screen.getByText(/Refreshed the availability/i)).toBeInTheDocument();
  });
});
