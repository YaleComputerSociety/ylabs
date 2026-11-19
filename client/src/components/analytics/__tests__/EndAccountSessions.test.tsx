import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EndAccountSessions from '../EndAccountSessions';
import axios from '../../../utils/axios';
import { expectNoAxeViolations } from '../../../testUtils/axe';

vi.mock('../../../utils/axios', () => ({
  default: { post: vi.fn() },
}));

const mockedPost = (axios as unknown as { post: ReturnType<typeof vi.fn> }).post;

const requestEnd = (value: string) => {
  fireEvent.change(screen.getByLabelText('NetID'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'End Sessions' }));
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EndAccountSessions (#4484)', () => {
  it('asks for confirmation, then ends the sessions through the admin endpoint', async () => {
    mockedPost.mockResolvedValue({ data: { revoked: true } });
    render(<EndAccountSessions />);

    requestEnd('  Test456 ');
    expect(mockedPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/has ended/)).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith('/admin/accounts/test456/sessions/revoke', {});
  });

  it('does nothing when the admin cancels the confirmation', () => {
    render(<EndAccountSessions />);

    requestEnd('test456');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('refuses a value that is not a NetID without calling the server', () => {
    render(<EndAccountSessions />);

    requestEnd('not a netid!');

    expect(screen.getByText('Enter the NetID whose sessions should end.')).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('shows the server error when no account holds the NetID', async () => {
    mockedPost.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { error: 'Account not found' } },
    });
    render(<EndAccountSessions />);

    requestEnd('test456');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('button', { name: 'End Sessions' })).not.toBeDisabled();
    expect(screen.getByText(/Account not found|Could not end the sessions/)).toBeInTheDocument();
  });

  it('has no serious or critical accessibility violations', async () => {
    const { container } = render(<EndAccountSessions />);
    await expectNoAxeViolations(container);
  });
});
